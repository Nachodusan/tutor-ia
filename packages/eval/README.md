# @tutor-ia/eval

Harness de evaluación del tutor. Nació para la **Fase −1** (validar los supuestos
del proyecto midiendo en la Mac: calidad del 7B, calidad de la ingesta, latencia de
prefill, RAM) y hoy su centro es el **golden set** contra el pipeline real. No es un
paquete de librería: son **scripts CLI** que se corren con `tsx`.

> Guía operativa de aquella fase (prerrequisitos, criterios de éxito y ramas "si
> falla"): **[`docs/fase-menos-1.md`](../../docs/fase-menos-1.md)** — **registro
> histórico**, no procedimiento vigente.

**Requisitos hoy:** `DEEPINFRA_API_KEY` en el `.env` de la raíz (la generación **y
los embeddings** son remotos) y, para lo que consulta el corpus, Postgres con el
material ingestado. **Sin red no corre nada**, ni siquiera el retrieval.

## Correr los que tardan (y no quedarse colgado esperándolos)

Varios de estos scripts duran más que el timeout de quien los lanza: la guarda
~5 min, el banco de answerability ~15, el golden completo ~2,5 h. Lanzarlos con
`nohup … &` y esperar con `until [ -f marcador ]` **se cuelga**, y pasó cuatro
veces en una sola sesión — una de ellas 11 horas.

```bash
scripts/tarea.sh guarda pnpm --filter @tutor-ia/eval retrieval-guard   # devuelve el PID al instante
scripts/esperar.sh guarda --tope-min 15                                # espera con tope
tail -f .tareas/guarda.log                                             # o mirarla en vivo
```

`esperar.sh` tiene **cuatro salidas y ninguna infinita**:

| código | qué pasó |
|---|---|
| 0-N | terminó; es el código de salida de la tarea |
| 3 | el proceso murió sin dejar marcador |
| 4 | se agotó el tope (la tarea sigue viva) |
| 5 | la tarea nunca se lanzó |

Por qué así, en una línea: la liveness se comprueba con `kill -0 <pid>`, que
pregunta por un PID concreto. `pgrep -f <patrón>` **encuentra al propio vigía**
—su línea de comandos contiene el patrón— y espera para siempre.

Los logs y marcadores van a `.tareas/`, que está gitignoreada.

## Scripts

Todos se corren con `pnpm --filter @tutor-ia/eval <script>`:

| Script | Comando | Qué hace | ¿API remota? |
|---|---|---|---|
| `exp1` | `pnpm --filter @tutor-ia/eval exp1 <archivo> [N]` | Pasa un PDF/`.txt`/`.md` real por la ingesta actual y vuelca los primeros `N` chunks (default 50) con banderas de calidad. Inspección con tus ojos. | No (offline) |
| `eval` | `pnpm --filter @tutor-ia/eval eval` | Corre el golden set por el pipeline real y reporta métricas agregadas. | Sí (+ Postgres) |
| `llm-smoke` | `pnpm --filter @tutor-ia/eval llm-smoke` | Compara endpoints remotos lado a lado; imprime `REASON`/`LEAK` (tokens de razonamiento y si hubo que filtrarlos). | Sí |
| `typecheck` | `pnpm --filter @tutor-ia/eval typecheck` | `tsc --noEmit`. | No |

La lista completa está en `package.json` (`exp6`, `batch-ingest`, `nli-validate`,
`scope-audit`, `plan-audit`, …).

> **Borrados con el proveedor local:** `exp2` (benchmark del 7B en las 4 tareas),
> `exp3` (curva de prefill), `exp4` (presupuesto de RAM), `exp5` (eje "correcto") y
> el helper `src/ollama.ts`, que hablaba directo con `/api/chat` para exponer
> `prompt_eval_duration` / `eval_duration`. Medían el motor que corría en la máquina;
> sin ese motor no hay qué medir, y la API remota no expone esas métricas. Los
> hallazgos quedan en [`docs/exp2-4-hallazgos.md`](../../docs/exp2-4-hallazgos.md).

## Formato de los casos de Fase −1 (histórico)

Los casos de aquellos experimentos llevaban su **contexto embebido** (los fragmentos
del material) además de la pregunta o tarea y lo esperado, así corrían **sin
retrieval ni base de datos**: lo que se medía era el modelo, no el pipeline de
recuperación. Cuatro familias: **grounding** (respuesta respaldada o `ABSTENTION`,
auditada con `verifyClaims` por cita literal), **examen** (JSON contra
`EXAM_SCHEMA`), **corrección** (JSON contra `GRADING_SCHEMA`, calificada a mano
contra la rúbrica) y **matemática** (calificada a mano).

Se apoyaban en piezas de `@tutor-ia/core` que siguen existiendo: `TUTOR_SYSTEM`
(hoy deprecado), `ABSTENTION`, `buildTutorUserTurn`, los prompts de examen y
corrección, `EXAM_SCHEMA`, `GRADING_SCHEMA`, `CLAIMS_SCHEMA`, `verifyClaims`.

## Golden set

El golden set vive en `golden/` y su estructura está descrita en
**[`golden/README.md`](golden/README.md)**. Los casos se parsean como **JSONL**
(un caso por línea, leído con `readFile` + `split('\n')`).

## Fixtures

`fixtures/` trae material de ejemplo para probar los scripts sin un libro real
(p. ej. `fixtures/muestra.md`, un capítulo de cálculo con fórmulas ε-δ).

---

Parte del roadmap: **Fase −1** (cerrada, y medida contra un motor local que ya no
está en el proyecto) → **Fase 1** (eval harness completo + calibración del umbral).
Ver [`docs/fase-menos-1.md`](../../docs/fase-menos-1.md).
