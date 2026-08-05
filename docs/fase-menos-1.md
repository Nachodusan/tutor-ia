# Fase −1 — Validar supuestos en tu Mac

> ⚠️ **REGISTRO HISTÓRICO — fase cerrada, y el motor que validaba ya no existe.**
> Esta guía se escribió para correr los 4 experimentos **contra el proveedor local
> (Ollama)**, que después se eliminó del proyecto: hoy la generación y los embeddings
> van a una API remota compatible con OpenAI. La fase se corrió, sus resultados están
> en [`exp2-4-hallazgos.md`](exp2-4-hallazgos.md) y las decisiones que disparó siguen
> vigentes. **Lo que sigue no es un procedimiento a ejecutar**: `exp2`, `exp3`, `exp4`
> y `exp5` se borraron junto con el motor local (y con ellos el cliente
> `packages/eval/src/ollama.ts` y sus entradas en `packages/eval/package.json`). El
> único que todavía corre es **exp1**, que es offline y no toca ningún modelo.
> Se conserva el documento porque explica **qué se midió y por qué**, que es lo que
> hace falta para entender de dónde salieron las decisiones de scope.

Guía operativa para correr los **4 experimentos** de la Fase −1 (§10 del plan) en
tu máquina, con el motor local corriendo. Es la fase que arregla los riesgos **E11**
("el 7B es el eslabón débil, sin testear") y **E16** ("Fase 0 'hecha' sin ejecutarse
nunca").

> **Fase 0 está "hecha" y nunca procesó un PDF real.** `typecheck ✓` y
> `next build ✓` no prueban nada sobre el RAG ni sobre la calidad del 7B. Esta
> fase mide en vez de suponer.

## Esto es un GATE, no un trámite

La Fase −1 es una **compuerta**. Si el 7B no pasa el experimento 2, **se replantea
el producto antes de seguir** (descomponer tareas, cambiar el modelo, o cambiar el
alcance). Mejor enterarse ahora que en la fase de voz. Los 4 experimentos tardan
3-4 días entre correrlos y calificar a mano.

---

## Prerrequisitos

1. **Postgres nativo corriendo** (sin Docker — cuesta 2-3 GB de RAM que necesitan
   los modelos, §1.3). Postgres.app o:
   ```bash
   brew install postgresql@17 pgvector
   brew services start postgresql@17
   ```
   > Los scripts de Fase −1 **no tocan la base de datos**: el contexto viene
   > embebido en los casos de prueba. Postgres solo hace falta para que el resto
   > del proyecto arranque y para el experimento 4 (medir RAM con todo cargado).

2. **El motor local con sus tres modelos** — `qwen2.5:7b-instruct` (tareas),
   `qwen2.5:3b-instruct` (voz) y `bge-m3` (embeddings, 1024 dims, multilingüe),
   servidos en `http://localhost:11434`. **Esto ya no aplica**: el proveedor local
   se eliminó del proyecto, así que no hay nada que instalar ni descargar. Hoy el
   requisito equivalente es una `DEEPINFRA_API_KEY` en el `.env` y conexión a
   internet, pero los experimentos que la usaban ya no existen.

3. **Dependencias instaladas:**
   ```bash
   pnpm install
   ```

> **exp1 corre offline** (solo lee un archivo y lo trocea) y **es el único que
> todavía se puede correr**. exp2, exp3 y exp4 necesitaban el motor local y se
> borraron con él.

---

## Los 4 experimentos

Cada uno trae su **comando exacto**, su **criterio de éxito** y la rama **"si
falla"** (tabla del §10 del plan).

### Experimento 1 — Un libro real por el pipeline

Toma un PDF (o `.txt`/`.md`) real, lo pasa por la ingesta **actual** (`pdf-parse`
+ chunking naïve) y vuelca los primeros `N` chunks a un archivo para que los mires
**con tus ojos**. No toca la base de datos ni genera embeddings. **Corre offline.**

```bash
pnpm --filter @tutor-ia/eval exp1 <libro.pdf> [N]
# ejemplo:
pnpm --filter @tutor-ia/eval exp1 ~/Downloads/calculo-stewart.pdf 50
```

Genera `exp1-<archivo>.chunks.txt` con los primeros `N` chunks (default 50) y sus
banderas de calidad: `MOJIBAKE`, `FÓRMULA`, `HEADER?`, `CORTO`, `CORTE-PALABRA`.

- **Criterio de éxito:** los chunks son legibles, las fórmulas están enteras, no
  hay headers/footers en medio de los párrafos.
- **Si falla:** tirás `pdf-parse` (vas a tirarlo). Es el disparador de la **Fase
  0.5**: rehacer la ingesta con sidecar Python + Apple Vision + chunking
  estructural.

### Experimento 2 — Benchmark del 7B en las 4 tareas

Corre el 7B contra un golden set de **20 casos por tarea** en las cuatro tareas
críticas: **grounding** (respetar el material / abstenerse), **JSON de examen**,
**corrección con rúbrica** y **matemática**. El contexto de cada caso viene
embebido en el propio caso — no hay retrieval ni base de datos.

```bash
pnpm --filter @tutor-ia/eval exp2   # ⚠️ SCRIPT BORRADO junto con el motor local
```

- **Criterio de éxito:** **≥ 80% en cada suite** (no en promedio: en *cada una* de
  las cuatro).
- **Si falla:** descomponer la tarea (§4-C3: dividir en pasos más chicos). **Si la
  rúbrica sigue calificando mal después de descomponer, se replantea el producto.**

> **Calificación MANUAL de calidad.** exp2 **vuelca un archivo `exam-review`** con
> las salidas del modelo para que las **corrijas a mano**. Las verificaciones
> automáticas (JSON válido, `verifyClaims` por string-match) son solo el primer
> filtro; la calidad real de grounding, de las preguntas de examen y de la
> corrección con rúbrica se juzga leyendo, no con una métrica. Reservá tiempo para
> esto.

### Experimento 3 — Curva de prefill real

Mide el **`prompt_eval_duration`** (el prefill: procesar el prompt, el asesino de
la latencia de voz) con contextos de **1k / 2k / 4k tokens** en tu Mac. Usa los
tiempos reales que expone `ollama.ts` (`promptEvalMs`), no estimaciones (§8.2:
"medilo, no lo estimes").

```bash
pnpm --filter @tutor-ia/eval exp3   # ⚠️ SCRIPT BORRADO junto con el motor local
```

> Este no se puede rehacer ni adaptando: `prompt_eval_duration` es una métrica que
> devolvía el motor local, y la API remota no expone nada equivalente.

- **Criterio de éxito:** la curva **define** tu budget de voz. No hay un número
  fijo que "pasar": el resultado es la curva misma, que condiciona cuánto contexto
  podés permitirte en la ruta de voz.
- **Si no entra en el budget:** bajás a **3B en voz** y **recortás el contexto**.

### Experimento 4 — RAM con todo cargado

Mide la RAM con **todo cargado a la vez** (Postgres + el motor local con el/los
modelo/s). El objetivo es detectar si la Mac empieza a **swapear**.

```bash
pnpm --filter @tutor-ia/eval exp4   # ⚠️ SCRIPT BORRADO junto con el motor local
```

> Perdió su objeto: ya no hay ningún modelo cargado en la máquina, así que el
> presupuesto de RAM dejó de ser una restricción del proyecto.

- **Criterio de éxito:** **no swapea.**
- **Si swapea:** `keep_alive: 0` en el modelo que no estés usando (no tengas el 3B
  y el 7B cargados a la vez), **3B en todo**, o **sin Docker** (Postgres nativo, ya
  aplicado).

---

## Qué hacer con los resultados

| Experimento | Necesitaba el motor local | Resultado esperado | Acción si falla |
|---|---|---|---|
| 1 · libro real | No (offline) — **sigue existiendo** | chunks legibles, fórmulas enteras | tirar `pdf-parse` → Fase 0.5 |
| 2 · benchmark 7B | **Sí** — script borrado | ≥ 80% en cada suite | descomponer (§4-C3); si la rúbrica sigue mal, replantear |
| 3 · curva prefill | **Sí** — script borrado | la curva define el budget de voz | 3B en voz, recortar contexto |
| 4 · RAM | **Sí** — script borrado | no swapea | `keep_alive: 0` / 3B / sin Docker |

**Recordá que esto es un GATE.** El experimento 2 es el crítico: **si el 7B no
llega al 80% en alguna de las cuatro tareas, se replantea el enfoque antes de
avanzar a la Fase 0.5.** No sirve seguir construyendo sobre un modelo que no pasa
el piso de calidad.

Cuando los 4 experimentos pasen (o cuando hayas decidido los cambios que dispara
el que falle), la Fase −1 queda cerrada y se abre la **Fase 0.5** (rehacer ingesta
+ retrieval).

---

Ver también: [`packages/eval/README.md`](../packages/eval/README.md) ·
[`docs/anti-alucinaciones.md`](anti-alucinaciones.md)
