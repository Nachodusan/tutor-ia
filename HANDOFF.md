# HANDOFF — Tutor IA local (para retomar en un chat nuevo)

> Documento de traspaso. Leé esto primero. Corre TODO en la Mac del usuario
> (**Apple M4, 16 GB**). El proyecto vive en `/Users/dusan/Documents/ia`.

> ⚠️ **REENFOQUE (Plan v3, 2026-07-16) — leer la memoria `tutor-ia-estado.md` para el estado vivo.**
> El tutor **NO resuelve ejercicios ni matemática** (medido en `exp5`: el 7B lo tiene topado). ES un
> **facilitador conceptual con enseñanza adaptativa**: explica el material, cita, verifica comprensión
> y **cambia de método si el alumno no entiende**. Anti-alucinación intacto. Arquitectura nueva: **RAG de
> DOBLE CORPUS TIPADO** — Texto del Estudiante (contenido, el "qué" citable) + Guía Didáctica (pedagogía,
> el "cómo", chunks tipados por bloque anclados al OA). **Piloto E2E validado** (Ciencias Naturales 1º
> Básico). Las secciones de abajo describen el Plan v2 (fundamentado/correcto) — la maquinaria
> anti-alucinación sigue vigente; los exámenes/corrección/voz salieron o se reordenaron. Ver README y memoria.

---

## 1. Qué es (Plan v2 — base, ver banner arriba para el reenfoque)

Tutor de estudio **100% local y privado**: el estudiante estudia **solo con su material** (RAG).
Diferenciador: **no alucina** — responde citando la fuente o **se abstiene**. Modelo
conservador. Nada sale de la máquina (sin nube).

**Idea central del Plan v2:** separar **fundamentado** (¿la respuesta está en el material?)
de **correcto** (¿está bien?). En Plan v3 el eje "correcto" salió de scope (medido) y el foco
pasó a **facilitar la comprensión conceptual**.

---

## 2. Stack (todo local)

| Capa | Qué | Detalle importante |
|---|---|---|
| Monorepo | pnpm + Turborepo, TypeScript **ESM** | imports relativos **SIN extensión** (`./x`, no `./x.js`); moduleResolution Bundler + tsx |
| LLM | **Ollama** | tag instalado es **`qwen2.5:7b`** (NO `...-instruct`) para tareas; `qwen2.5:3b` para voz (Fase 5) |
| Embeddings | **`bge-m3`** (Ollama, 1024 dims) | `POST /api/embed` |
| Reranker | **`bge-reranker-v2-m3`** vía sidecar Python | `transformers` DIRECTO (NO FlagEmbedding, que crashea con transformers 5.x). Sirve HTTP `127.0.0.1:8790`, corre en **MPS (GPU)** |
| DB | **Postgres 17 nativo** (brew) + pgvector | keg-only: bin en `/opt/homebrew/opt/postgresql@17/bin`. Base `tutor`. **SIN Docker** |
| Ingesta | sidecar Python `pymupdf4llm` + OCR `tesseract` | venv en `packages/ingest-py/.venv` (Python 3.14) |
| Web | Next.js (`apps/web`) | endpoints chat/exams/documents; auth es **stub mono-usuario** |

Node 24, Python 3.14. `torch 2.13` (trae **sympy** de regalo, para Fase 2 matemática).

---

## 3. Estructura de paquetes

```
packages/
  db/    schema.sql · schema_student_model.sql · schema_hybrid.sql · seed.sql
         src/index.ts (getSql, toVectorLiteral)
  rag/   clean.ts (limpieza) · chunk-structural.ts (chunking) · ingest-v2.ts (ingesta a DB)
         retrieve-hybrid.ts (denso+léxico+RRF) · rerank.ts (reranker + gate: retrieveRanked)
         embeddings.ts (bge-m3) · [legacy: chunk.ts, extract.ts, ingest.ts, retrieve.ts]
  core/  client.ts (Ollama: chatStream/chatJSON/chatText) · config.ts · prompts.ts
         tutor.ts (getTutorContext = gate de abstención) · exams.ts · groundedness.ts (A2)
         schemas.ts · types.ts
  eval/  exp1..exp4 · exp1b (comparador ingesta) · index-book · retrieve-test · rerank-test
         calibrate · eval (§9.2) · lib/{signals,score,metrics}.ts · golden/questions.jsonl
  ingest-py/  extract.py (PDF→md) · rerank_server.py · requirements.txt · .venv
apps/web/  Next.js: app/api/{chat,exams,documents}/route.ts · app/page.tsx · lib/auth.ts
docs/  exp1-hallazgos.md · exp2-4-hallazgos.md · fase-05-hallazgos.md · fase-1-hallazgos.md
       anti-alucinaciones.md
```

---

## 4. Estado por fase (Plan v2)

- **Fase 0 (fundaciones)** ✅
- **Fase −1 (validar supuestos, 4 experimentos)** ✅ — corridos con datos reales.
  `docs/exp1-hallazgos.md`, `docs/exp2-4-hallazgos.md`.
  - exp1: `pdf-parse` inadecuado (40% palabras partidas, 99% headers pegados). → reemplazado.
  - exp2 (benchmark 7B): grounding 95% ✅, exam 100% ✅, **grading 78% ❌**, **math ~75% ❌**.
  - exp3 (latencia voz): **budget inviable** en esta Mac (prefill 3B ~2.2s vs objetivo 600ms).
  - exp4 (RAM): 16 GB justos; `keep_alive:0`, sin Docker.
- **Fase 0.5 (ingesta + retrieval)** ✅ — `docs/fase-05-hallazgos.md`.
  - Ingesta nueva: `pymupdf4llm` → `cleanPages` → `chunkStructural` → `bge-m3` → pgvector,
    con metadata (heading_path, content_type, page_start/end). Libro real indexado (**208 chunks**).
  - Retrieval **híbrido** (denso+léxico+RRF) + **reranker** (gate de abstención).
  - El reranker separa dentro/fuera con **margen 0.74** (el coseno solo daba 0.10).
  - **Auditoría adversarial → 9 bugs encontrados y arreglados** (overlap duplicaba chunks,
    reranker caído→500 sin fallback, re-ingesta no reemplazaba, timeouts, etc.).
- **Fase 1 (eval + calibración)** ✅ — `docs/fase-1-hallazgos.md`.
  - Golden set: **41 preguntas** ancladas a chunk_ids reales (15 answerable, 6 adversarial,
    5 multi_hop, 10 must_abstain, 5 false_premise): `packages/eval/golden/questions.jsonl`.
  - Calibración → **`RERANK_MIN_SCORE=0.3`** (plateau seguro; separación limpia).
  - `pnpm eval`: **recall@5 94% ✅ · gold@1 81% ✅ · true_abstention 100% ✅ ·
    false_abstention 3% ✅ · hallucination_rate 30% ❌**.

---

## 5. EL HALLAZGO que define la Fase 2 (próximo paso)

**`hallucination_rate 30%` NO es que el modelo invente.** En answerable/multi_hop la respuesta
SÍ está en el material (recall 94%). El 30% es porque la verificación **A2 (cita literal
exacta, `chunk.includes(quote)`)** es demasiado estricta para un 7B que **parafrasea** (exp2:
solo 36% de citas literales). El multi_hop es el peor (80%) porque sintetiza entre chunks.

**Fase 2 — arreglo (§4-A3 del plan):** reemplazar la cita literal por **entailment con el
cross-encoder que YA tenemos** (el reranker `bge-reranker-v2-m3`). En vez de string-match,
puntuar si el chunk *implica* la afirmación. Debería tirar el 30% para abajo.
Otros items de Fase 2: **grading descompuesto** (checks binarios por punto clave; §4-C) y
**SymPy para matemática** (§4-B; sympy ya está en el venv por torch).

---

## 6. Cómo levantar los servicios (CRÍTICO para retomar)

```bash
cd /Users/dusan/Documents/ia

# 1) Postgres (keg-only → agregar al PATH)
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
brew services start postgresql@17
# La base 'tutor' YA tiene esquema + 208 chunks del libro indexados.
# psql "postgresql://localhost:5432/tutor" -tAc "select count(*) from chunks"  # → 208

# 2) Ollama (suele estar corriendo). Modelos: qwen2.5:7b, qwen2.5:3b, bge-m3
ollama list

# 3) Reranker sidecar (HAY QUE ARRANCARLO A MANO; no es servicio)
nohup ./packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py \
  > packages/ingest-py/rerank_server.log 2>&1 &
# Esperar a "listo en" en el log. Sirve en 127.0.0.1:8790.
curl -s http://127.0.0.1:8790/health
```

### Variables de entorno para correr scripts
```
DATABASE_URL=postgresql://localhost:5432/tutor
EMBEDDING_MODEL=bge-m3
LLM_MODEL=qwen2.5:7b
RERANK_BASE_URL=http://127.0.0.1:8790
RERANK_MIN_SCORE=0.3
EVAL_USER_ID=00000000-0000-0000-0000-000000000001   # usuario dev (ya seedeado)
```

---

## 7. Comandos útiles

```bash
pnpm install
pnpm -r typecheck                                   # 5 paquetes, debe dar todo Done

# RAG / eval (con las env vars de arriba exportadas):
pnpm --filter @tutor-ia/eval retrieve "¿qué es el amor cortés?"   # test híbrido+rerank
pnpm --filter @tutor-ia/eval rerank-test            # separación dentro/fuera
pnpm --filter @tutor-ia/eval calibrate              # curva del umbral
pnpm --filter @tutor-ia/eval eval                   # métricas §9.2 (genera con el 7B; ~min)
pnpm --filter @tutor-ia/eval index-book <pdf> [--subject X] [--sidecar json]

# Fase −1 (offline salvo exp2/3/4 que necesitan Ollama):
pnpm --filter @tutor-ia/eval exp1 <pdf>             # inspección de chunks
pnpm --filter @tutor-ia/eval exp1b <pdf> <sidecar.json>   # comparador viejo vs nuevo
```

**Gotchas:**
- `pnpm --filter` cambia el cwd al paquete → rutas relativas resuelven ahí. Los scripts
  resuelven el input contra `process.env.INIT_CWD`. Pasá **rutas absolutas** al invocar desde otro cwd.
- El eval genera con el 7B por cada pregunta answerable → corré en background si tarda
  (>3 min excede el límite del foreground). El runner es **resiliente**: un timeout del LLM
  no tumba la corrida (marca la pregunta como no-evaluada).
- Libro de prueba: `/Users/dusan/Desktop/Tomo_I_Lengua_y_Literatura8vo.pdf`.
  Sidecar pre-extraído (evita re-OCR de minutos): `packages/eval/sidecar-libro.json`.

---

## 8. Limitaciones / deuda conocida (no bloquean, pero anotalas)

- **`exams.ts` sigue en el retrieval LEGACY** (`retrieve` denso + `config.minSimilarity`),
  no en el híbrido+reranker. Migrar a `retrieveRanked` cuando se toque exámenes (Fase 2).
- **Golden set: las `must_abstain` son "lejanas"** (matemática, deportes, cocina) → puntúan ~0,
  no estresan el borde *near-miss* (p.ej. "¿quién escribió Cien años de soledad?" — literatura,
  fuera de ESTE libro). Agregar must_abstain adversariales cercanas para calibrar mejor el 0.3.
- **`citation_precision` real** (¿el modelo citó la fuente correcta?) todavía no se mide; hoy se
  reporta `precision@gold` (proxy de ranking = 81%). La real llega con A3 (Fase 2).
- **Voz (Fase 5)**: budget de latencia inviable en esta Mac tal como está el plan; replantear
  (modelo más chico / MLX / aceptar ~2-3s) ANTES de construirla. Movida al final por eso.
- **Auth**: stub mono-usuario a propósito (`apps/web/lib/auth.ts` devuelve un DEV_USER_ID).
- Columna `chunks.page` es legacy; las reales son `page_start`/`page_end`.
- El 7B en exámenes devuelve `"answer":"a"/"b"` (letra) en vez del índice `"0"/"1"` del schema
  → normalizar en la corrección (Fase 2, §4-C).

---

## 9. Primer movimiento sugerido en el chat nuevo

**Fase 2 — verificación A3.** En `packages/rag/rerank.ts` (o un módulo nuevo) exponer una
función `entails(claim, chunkText): Promise<number>` que use el rerank_server (el cross-encoder
ya distingue relevancia). Cablearla en el verificador de alucinación (`eval.ts` y el chat),
reemplazando/complementando el `verifyClaims` literal de `groundedness.ts` (A2). Objetivo:
bajar el `hallucination_rate` del 30% (que hoy es mayormente falsos positivos por parafraseo).
Medir el antes/después con `pnpm eval` sobre el golden set que ya existe.

> Verificá siempre con datos reales sobre el libro ya indexado, no solo typecheck. El estilo de
> este proyecto: cada afirmación de "funciona" se respalda con una corrida medida.
