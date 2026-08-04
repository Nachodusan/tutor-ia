# Golden set — cómo armar el set real (Fase 1, §9)

Este directorio contiene el **golden set**: el conjunto de preguntas etiquetadas
a mano contra el que medimos si el tutor recupera bien, cita bien y —sobre todo—
**se abstiene cuando debe**. `questions.example.jsonl` es la plantilla del §9.1
(6 preguntas, formato exacto). El set real es tuyo: se arma con TUS PDFs.

## 1. Elegí 2-3 PDFs reales y hacé la ingesta

Tomá 2 o 3 apuntes/libros reales del dominio que vas a evaluar (por ejemplo, un
capítulo de Cálculo). Ingestalos por el pipeline real para que queden en Postgres
con embeddings:

```bash
# desde la raíz del monorepo, con DATABASE_URL y Ollama configurados
pnpm --filter @tutor-ia/rag ingest ruta/al/calculo.pdf   # (o el script que uses)
```

El golden set **solo tiene sentido contra un corpus ingestado**: los `expect_chunks`
son ids de chunks que existen en TU base. Si reingestás y cambian los ids, hay que
actualizar el golden.

## 2. Conseguí los chunk ids reales para `expect_chunks`

Para cada pregunta *answerable* / *multi_hop*, necesitás saber qué chunk(s)
contienen la respuesta correcta. Dos formas:

- **Por retrieval**: corré la pregunta por el retrieval y mirá los `chunkId` que
  vuelven; confirmá con tus ojos cuál(es) contienen realmente la respuesta y
  copiá esos ids a `expect_chunks`.
- **Por SQL**: buscá el texto en la tabla de chunks
  (`select chunk_id, content from chunks where content ilike '%definición ... límite%'`)
  y copiá el `chunk_id`.

Los ids del ejemplo (`c_0412`, `c_0533`) son **placeholders**: reemplazalos por los
ids reales de tu corpus. Una pregunta *answerable* sin `expect_chunks` reales no
mide recall (queda excluida del promedio de recall/precisión).

## 3. Las 5 categorías (y por qué son las que salvan)

| type            | qué mide                                              | gold |
|-----------------|------------------------------------------------------|------|
| `answerable`    | recall + precisión: ¿trae el chunk correcto y cita bien? | `expect_chunks` |
| `multi_hop`     | recall cuando la respuesta vive en 2+ chunks         | `expect_chunks` (varios) |
| `must_abstain`  | el libro de **esta materia** no lo cubre → el tutor no puede presentarlo como propio | `expect_mode` + `expect_scope` |
| `false_premise` | la pregunta afirma algo falso → no debe "confirmar" la premisa | (ninguno) |
| `adversarial`   | el material usa otro nombre para el concepto (`note`) → ¿lo encuentra igual? | opcional |
| `computational` | cálculo con respuesta verificable (`expect_answer`)  | `expect_answer` |

Las que **salvan** el producto no son las *answerable* (esas todo RAG las aprueba):
son **`must_abstain`, `false_premise` y `adversarial`**. Un tutor que inventa
cuando no sabe, o que "le sigue la corriente" a una premisa falsa, es peor que
inútil para estudiar. Medimos el fracaso, no el éxito fácil. Un golden set sano
tiene **al menos 30-40% de preguntas trampa** (must_abstain / false_premise), no
solo answerable.

### `must_abstain` ya no significa "debe negarse"

Cambió con el motor: el tutor **responde siempre** y lo que se evalúa es cómo
encuadra la respuesta. `true_abstention` se retiró (por diseño va a ~0 y dejó de
significar algo); lo reemplazan `false_book_claim` y `correct_mode`.

**Modo y alcance son dos ejes independientes y se declaran por separado:**

| campo | valores | qué dice |
|---|---|---|
| `expect_mode`  | `libro` · `apoyado` · `general` | ¿hay material que respalde la respuesta? |
| `expect_scope` | `curso` · `otro_curso` · `otra_materia` · `ninguno` | ¿de dónde salió ese material? |

Una pregunta cuyo tema vive en OTRA materia del corpus —"¿qué es la
fotosíntesis?" preguntada desde Lengua— espera `("libro", "otra_materia")`: el
material existe y la respalda, pero no es el libro de esta materia, y el alumno
lee *"esto no está en el libro de esta materia, lo saqué de Ciencias Naturales
6º"*. Eso **es** la conducta correcta. Solo espera `("general", "ninguno")` lo
que ningún libro del corpus cubre.

⚠️ **La etiqueta se decide por lo que el corpus contiene, nunca por lo que el
tutor hace hoy.** Etiquetar según la conducta observada convierte la métrica en
un espejo: siempre da bien y no puede detectar una regresión. Para decidirlo con
el material a la vista: `pnpm --filter @tutor-ia/eval scope-audit`, que vuelca
cada pregunta con los fragmentos recuperados y de qué libro y página salieron.

## 4. Calibración del umbral (§9.3)

El único perno grande que tenés para negociar recall vs. abstención es
`RAG_MIN_SIMILARITY` (config de core, capa 1 anti-alucinación): el score de
similitud por debajo del cual un chunk se descarta y, si no queda ninguno, el
tutor se abstiene.

- Umbral **muy bajo** → recuperás basura → sube `hallucination_rate` y baja
  `citation_precision`.
- Umbral **muy alto** → descartás material bueno → sube `false_abstention_rate`.

La calibración se hace **barriendo el umbral sobre este golden set**: corré el
eval con distintos valores (`RAG_MIN_SIMILARITY=0.25 pnpm eval`,
`0.30`, `0.35`, `0.40`, ...) y elegí el punto que cumple simultáneamente los
objetivos del §9.2 (recall@5 ≥ 0.90, citation_precision ≥ 0.95,
hallucination_rate ≤ 0.02, false_abstention ≤ 0.10, true_abstention ≥ 0.95).
Ese punto es el umbral de producción. Sin golden set no hay calibración: estarías
eligiendo el umbral a ojo.

## 5. Correr el eval

```bash
# usa golden/questions.jsonl si existe; si no, cae al .example (placeholders)
EVAL_USER_ID=<uuid-del-usuario-con-los-PDFs> pnpm --filter @tutor-ia/eval eval

# o un path explícito
EVAL_USER_ID=<uuid> pnpm --filter @tutor-ia/eval eval golden/questions.jsonl
```

Requiere **Postgres con los PDFs ya ingestados** + **Ollama corriendo**. Nombrá tu
set real `questions.jsonl` (git lo ignora si querés mantenerlo privado); el
`.example` queda como plantilla versionada.
