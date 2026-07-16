# Fase 0.5 — Ingesta nueva: resultados (antes/después sobre el libro real)

**Libro:** *Lengua y Literatura 8° básico, Tomo I* (344 págs).
**Pipeline viejo:** `pdf-parse` + chunking por caracteres.
**Pipeline nuevo:** sidecar `pymupdf4llm` (`packages/ingest-py/extract.py`) →
`cleanPages` (`packages/rag/src/clean.ts`) → `chunkStructural`
(`packages/rag/src/chunk-structural.ts`).
**Medido con:** `pnpm --filter @tutor-ia/eval exp1b <pdf> <sidecar.json>` — mismos
detectores para ambos pipelines. **Fecha:** 2026-07-14.

## Tabla final (después del fix pass post-revisión)

| Señal | Viejo | Nuevo | Δ |
|---|---|---|---|
| chunks totales | 344 | **207** | −137 (chunks más densos y coherentes) |
| tokens/chunk (prom) | 121 | 191 | +70 |
| **palabra partida `"x - y"`** | 139 (40%), 357 casos | **0 (0%)** | ✅ eliminada |
| **encabezado pegado** | 340 (99%) | **0 (0%)** | ✅ eliminado |
| **folio al final** | 285 (83%) | 6 (3%) | ✅ |
| códigos BDA/U_ | 78 casos | 2 casos | ✅ |
| letras espaciadas | (9) | **0** | ✅ |
| **idea cortada** | 130 (38%) | 26 (13%)* | ✅ cortes genuinos ≈1.7% |
| muy cortos (<40 chars) | 0 | 9 (4%) | aceptable (≥15 chars, con letras) |

\* El 13% restante es mayormente proxy débil del detector (captions/índices sin
punto final); la inspección profunda del verificador halló solo **3/181 cortes
genuinos (1.7%)**, los tres en bloques OCR.

**Estructura ganada (no existía en el pipeline viejo):**
- `headingPath` en **100%** de los chunks ("Unidad 1 › Lección 1 › Amplío mi vocabulario").
- `contentType`: 170 prose · **36 figure_caption** (OCR de imágenes filtrado y tipado) · 1 table.
- `pageStart/pageEnd` reales (con unión de oraciones entre páginas).

## El proceso importó tanto como el resultado

1. El workflow construyó las piezas y la **revisión adversarial** encontró la
   regresión clave: la basura OCR de páginas-imagen entraba al índice (la tapa
   = 287 tokens de ruido; marcadores `<!-- picture text -->` sueltos).
2. Fix pass: segmentación de regiones OCR → captions filtrados por línea
   (`looksLikeCaptionLine`), filtro `isGibberish` para ruido sin delimitar,
   strip de HTML residual y de `**`, guardia final de chunks basura.
3. **Segunda vuelta del verificador manual**: la tapa seguía viva — el rescate
   por stopwords fallaba porque 326 tokens de ruido contienen "y"/"o" sueltas
   por azar. Fix: stopwords ≥2 letras y **densidad** (<15%) en vez de conteo
   absoluto. Validado contra: tapa (gibberish ✓), 185 párrafos de prosa real
   (0 falsos positivos ✓), poemas (no gibberish ✓).
4. Detectores del eval también afinados (bullets no son hifenación; romanos
   "siglo V a. C." no son letter-spacing; captions cortos no son "idea cortada").

## Retrieval híbrido cableado a la DB (segunda entrega)

Ingesta v2 (`ingestDocumentV2`) + retrieval híbrido (`retrieveHybrid`, denso
bge-m3 + léxico tsvector, fusión RRF) contra Postgres nativo. Libro real
indexado: **207 chunks, todos con embedding + tsvector, en 13,6 s**.

**Funciona para rankear.** Ejemplo real (`pnpm --filter @tutor-ia/eval retrieve`):
- *"¿Qué es el amor cortés y los trovadores provenzales?"* → el chunk correcto
  ("El amor cortés es un tópico literario de la época…", págs. 48-52) sube al top
  porque aparece en **denso#2 + léxico#1** → RRF lo premia (rrf=0.0325 vs 0.0164
  del resto). **La fusión híbrida hace justo lo que promete el plan.**
- Citas legibles gracias a la Fase 0.5: *"págs. 28-30 · La historia de Tristán e
  Isolda … Capítulo IV. El filtro"* en vez de "chunk #4712".

**⚠ Hallazgo clave (confirma §2 del plan): el score NO sirve para abstención.**

| Query | ¿en material? | coseno top-1 |
|---|---|---|
| ¿amor cortés y trovadores? | SÍ | 0.539 |
| ¿Tristán e Isolda? | SÍ | 0.683 |
| ¿interpretar una obra? | SÍ | 0.650 |
| **¿mundial 2022?** | **NO** | **0.432** |
| **receta de tortilla?** | **NO** | **0.375** |
| **cotización del dólar?** | **NO** | **0.374** |

Dos problemas:
1. **RRF descarta el score** (usa solo el rank): el top-1 de *cualquier* query
   —incluso "mundial 2022"— recibe rrf=1/(60+1)=0.0164. **Inservible como señal
   de abstención.** El gate debe usar el score crudo, no el RRF.
2. **El coseno de bge-m3 está comprimido** (todo cae en 0.35–0.68) y el margen
   dentro/fuera es fino (~0.10). El `RAG_MIN_SIMILARITY=0.35` actual dejaría
   pasar TODAS estas (incluido "mundial 2022" a 0.432) → **nunca abstendría**.

**Conclusión:** para una abstención robusta hace falta el **reranker
cross-encoder** (§2, capa A1) cuyo score sí discrimina relevancia, y **calibrar
el umbral sobre un golden set** (§9.3) — no elegirlo a ojo. Es la última pieza de
retrieval de Fase 0.5.

## Reranker cross-encoder → gate de abstención (tercera entrega)

Sidecar `rerank_server.py` (bge-reranker-v2-m3 vía `transformers` directo — nota:
FlagEmbedding rompe con transformers nuevo, `prepare_for_model` removido) sirviendo
por HTTP local en **MPS (GPU del M4)**. Cliente `retrieveRanked` (rag): híbrido trae
candidatos → reranker los ordena y su score gatea la abstención.

**El reranker resuelve el problema del coseno comprimido — con margen enorme:**

| Query | ¿en material? | coseno top-1 | **reranker top-1** |
|---|---|---|---|
| amor cortés / Tristán / interpretar / Yuriko | SÍ | 0.54–0.68 | **0.75–0.9982** |
| discontinuidad / mundial 2022 / receta / dólar | NO | 0.37–0.43 | **0.0005–0.0064** |
| **margen dentro/fuera** | | **~0.10 (frágil)** | **0.7449 (robusto)** |

**Cableado al chat real** (`getTutorContext` de core, `RERANK_MIN_SCORE=0.5`),
verificado end-to-end:
- *"¿Qué es el amor cortés según el material?"* → grounded, cita *"pág 48 · 3. Visión
  del amor de la época"* (score 0.953).
- *"¿Cuánto sale el dólar blue hoy?"* → **abstención** (0.0002).

**Latencia:** 490 ms para 25 candidatos en MPS. Aceptable para chat (~+0.5 s);
para voz (Fase 5, ya en replanteo) habría que usar menos candidatos.

**Conclusión Fase 0.5 retrieval:** el pipeline de abstención del plan
(híbrido → reranker → umbral) funciona con datos reales. `RAG_MIN_SIMILARITY`
(coseno) queda como legacy; el gate real es el score del reranker.

## Auditoría adversarial + fixes (cuarta entrega)

Antes de Fase 1, una revisión adversarial (workflow: 3 revisores por dimensión →
verificación de cada finding) encontró **9 bugs reales**, los 9 arreglados y
verificados con datos:

| # | Sev | Bug | Fix verificado |
|---|---|---|---|
| 1 | major | `overlapTail` duplicaba el chunk entero en listas sin puntuación | guardia `<2 oraciones→null` + tope 50%; max_tok 499 (sin gigantes) |
| 2 | major | reranker caído → chat 500 (sin fallback) | degrada a **abstención segura** (`rerankerDown`); probado con puerto muerto |
| 3 | minor | re-ingesta conservaba chunks viejos (`do nothing`) | `delete` antes de insertar; reindex → 208, 0 colisiones (no 414) |
| 4/7 | minor | `fetch` sin timeout (rerank/embed/chatJSON) colgaba el pipeline | `AbortSignal.timeout` acotado (streaming del chat queda libre) |
| 5 | minor | filtro ≥15 chars descartaba captions/tablas cortas válidas | piso 4 para figure_caption/table (37+1 sobreviven) |
| 6 | minor | `dehyphenate` unía guiones-dash reales ("rojo - azul") | quitada la regla de espacios a ambos lados |
| 8 | minor | abstención mostraba citas de fragmentos bajo el umbral | citas vacías cuando `grounded=false` (verificado) |
| 9 | minor | `RERANK_MIN_SCORE=""` daba 0 → desactivaba el gate en silencio | `""`/espacios = ausente → usa el default |

Todo re-verificado: typecheck ×5 ✅, exp1b (calidad de chunking intacta), gate
dentro/fuera ✅, reindex sin duplicar ✅, reranker-caído → abstiene sin tirar ✅.

## Qué queda de Fase 0.5 (pendiente)

- **Retrieval híbrido**: denso (bge-m3) + `tsvector` español + fusión RRF —
  necesita Postgres corriendo con el esquema aplicado.
- **Reranker** (`bge-reranker-v2-m3`) para el gate de abstención calibrado.
- **Cablear ingest v2 a la DB**: `ingestDocument` debe usar sidecar → clean →
  chunkStructural y guardar la metadata nueva (heading_path, content_type,
  page_start/end) que el esquema ya soporta (`schema_student_model.sql`).
- **Contextual retrieval y extracción de conceptos** (batch con el 7B) — después
  de cablear la DB.
- Los 2 casos residuales de códigos y los 6 folios: marginales, no bloquean.
