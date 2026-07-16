# @tutor-ia/eval

Harness de evaluación **local** del tutor. Su primer objetivo es la **Fase −1**:
validar los supuestos del proyecto midiendo en tu Mac con Ollama corriendo
(calidad del 7B, calidad de la ingesta, latencia de prefill, RAM). No es un
paquete de librería: son **scripts CLI** que se corren con `tsx`.

> Guía operativa completa (prerrequisitos, criterios de éxito y ramas "si falla"):
> **[`docs/fase-menos-1.md`](../../docs/fase-menos-1.md)**.

Los scripts de Fase −1 **no requieren base de datos**: el contexto de cada caso
viene **embebido** en el propio caso. Si Ollama no está corriendo, los que lo
necesitan fallan con un mensaje claro.

## Scripts

Todos se corren con `pnpm --filter @tutor-ia/eval <script>`:

| Script | Comando | Qué hace | ¿Ollama? |
|---|---|---|---|
| `exp1` | `pnpm --filter @tutor-ia/eval exp1 <archivo> [N]` | Pasa un PDF/`.txt`/`.md` real por la ingesta actual y vuelca los primeros `N` chunks (default 50) con banderas de calidad. Inspección con tus ojos. | No (offline) |
| `exp2` | `pnpm --filter @tutor-ia/eval exp2` | Benchmark del 7B en las 4 tareas (grounding, JSON de examen, corrección con rúbrica, matemática). Vuelca `exam-review` para calificación **manual**. | Sí |
| `exp3` | `pnpm --filter @tutor-ia/eval exp3` | Curva de prefill real (`promptEvalMs`) con 1k / 2k / 4k tokens de contexto. Define el budget de voz. | Sí |
| `exp4` | `pnpm --filter @tutor-ia/eval exp4` | Mide la RAM con todo cargado; detecta swapping. | Sí |
| `eval` | `pnpm --filter @tutor-ia/eval eval` | Corre el golden set contra el modelo y reporta métricas agregadas. | Sí |
| `typecheck` | `pnpm --filter @tutor-ia/eval typecheck` | `tsc --noEmit`. | No |

## Helper de Ollama

`src/ollama.ts` habla directo con `/api/chat` y **expone los tiempos** que el
cliente de core no da (`prompt_eval_duration`, `eval_duration`), convertidos de
nanosegundos a **ms**. Los experimentos 2 y 3 los necesitan para medir el prefill
(el asesino de la latencia de voz).

```ts
import { generate, listModels } from "./ollama";

const r = await generate(prompt, { model: process.env.LLM_MODEL ?? "qwen2.5:7b-instruct" });
// r.promptEvalMs = prefill · r.evalMs = generación · r.promptTps / r.evalTps = tokens/s
```

Modelos (por env, con defaults): `LLM_MODEL` (`qwen2.5:7b-instruct`),
`LLM_VOICE_MODEL` (`qwen2.5:3b-instruct`), `OLLAMA_BASE_URL`
(`http://localhost:11434`).

## Formato de los casos

Cada caso de prueba lleva su **contexto embebido** (los fragmentos del material)
además de la pregunta o tarea y lo esperado. Así los scripts corren **sin
retrieval ni base de datos**: lo que se mide es el modelo, no el pipeline de
recuperación.

- **grounding:** contexto + pregunta; se espera respuesta respaldada o la frase de
  abstención (`ABSTENTION`). Se audita con `verifyClaims(rawClaims, chunkTexts)`
  (cita literal por string-match, sin costo, determinística).
- **examen:** contexto → JSON validado contra `EXAM_SCHEMA`
  (`buildExamGenerationPrompt`).
- **corrección:** examen + respuestas → JSON validado contra `GRADING_SCHEMA`
  (`buildGradingPrompt`), calificado a mano contra la rúbrica.
- **matemática:** contexto + problema → respuesta calificada a mano.

Reusa piezas de `@tutor-ia/core`: `TUTOR_SYSTEM`, `ABSTENTION`,
`buildTutorUserTurn`, los prompts de examen/corrección, `EXAM_SCHEMA`,
`GRADING_SCHEMA`, `CLAIMS_SCHEMA`, `verifyClaims`, y los tipos `Exam`,
`ExamQuestion`, `GradingResult`, `StudentAnswer`.

## Golden set

El golden set (20 casos por tarea) vive en `golden/` y su estructura está descrita
en **[`golden/README.md`](golden/README.md)**. Los casos se parsean como **JSONL**
(un caso por línea, leído con `readFile` + `split('\n')`). Las salidas del modelo
en `exp2` se vuelcan a un archivo `exam-review` para **calificación manual de
calidad** — las métricas automáticas son solo el primer filtro.

## Fixtures

`fixtures/` trae material de ejemplo para probar los scripts sin un libro real
(p. ej. `fixtures/muestra.md`, un capítulo de cálculo con fórmulas ε-δ).

---

Parte del roadmap: **Fase −1** (esta) → **Fase 1** (eval harness completo +
calibración del umbral). Ver [`docs/fase-menos-1.md`](../../docs/fase-menos-1.md).
