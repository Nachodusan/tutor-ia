# Fase −1 — Cierre del gate (exp2, exp3, exp4)

> ⚠️ **REGISTRO HISTÓRICO — el motor que se midió acá ya no está en el proyecto.**
> Todo lo de abajo se corrió el **2026-07-14** contra el proveedor **local (Ollama)**,
> que después se eliminó: hoy la generación y los embeddings van a una API remota
> compatible con OpenAI. Estos números **pasaron de verdad** y se conservan porque
> explican decisiones que siguen vigentes (rediseño de A2, corrección descompuesta,
> SymPy obligatorio, replanteo del objetivo de voz). Pero **no son instrucciones ni
> describen el rendimiento actual**: la latencia de prefill y el presupuesto de RAM
> medían una máquina corriendo el modelo, cosa que ya no ocurre.
>
> **Los scripts que produjeron estos números se borraron** junto con el motor local
> (`exp2-benchmark`, `exp3-latency`, `exp4-ram`, `exp5-correcto` y el cliente
> `packages/eval/src/ollama.ts`, más sus entradas `exp2`..`exp5` en
> `packages/eval/package.json`). **No hay forma de reproducir esta corrida**, y no
> tendría sentido: `exp3` medía `prompt_eval_duration` y `exp4` la RAM del modelo
> cargado, dos métricas nativas de Ollama que la API remota no expone.

**Máquina:** MacBook Apple **M4, 16 GB**. **Ollama** 0.30.10.
**Modelos:** `qwen2.5:7b` (tareas), `qwen2.5:3b` (voz). **Fecha:** 2026-07-14.
(exp1 en `docs/exp1-hallazgos.md`.)

---

## exp2 · Benchmark del 7B (`qwen2.5:7b`)

| Suite | Score | Gate ≥80% |
|---|---|---|
| GROUNDING | 19/20 = **95%** | ✅ PASA |
| EXAM (estructura) | 16/16 = **100%** | ✅ PASA |
| GRADING | 14/18 = **78%** | ❌ NO PASA |
| MATH | 13/20 = **65%** (real ~75%) | ❌ NO PASA |

### Hallazgos
1. **A2 (cita literal) solo 36% verificadas.** En los casos *answerable*, el 7B
   responde bien (95%) pero **parafrasea** en vez de citar textual → `chunk.includes(quote)`
   solo matchea el 36%. La cita literal, tal cual está diseñada, marcaría ~64% de
   afirmaciones correctas como "fuera del material". **A2 necesita rediseño:** anclar la
   verificación al *chunk* recuperado y usar matching difuso / entailment (A3), no la
   cita exacta del modelo. (Y la de-hyphenation de exp1 empeora aún más el match exacto.)
2. **EXAM: estructura 100% + claves correctas** (revisión manual de e01–e03: preguntas
   respondibles, claves bien). Único detalle: las `mcq` devuelven `answer:"a"/"b"` (letra)
   en vez del índice `"0"/"1"` del schema — inconsistencia menor a normalizar. → **Luz
   verde al banco de preguntas precomputado (§1.4).**
3. **GRADING falla por severidad** (78%): los 4 errores son "correcta → marcada incorrecta"
   (falsos negativos). El 7B es demasiado estricto en corrección holística. → Confirma
   §4-C: descomponer en checks **binarios por punto clave**, no una llamada holística.
4. **MATH: SymPy es obligatorio.** De 7 fallos, **2 son artefactos de scoring** (el modelo
   acertó pero el comparador textual no lo ve): `cos(0)`≡1 y `cos(x²)·2x`≡`2x·cos(x²)`.
   Los otros 5 son **errores reales** del 7B (m07,m11,m14,m15,m20). Conclusión doble: se
   necesita CAS **para puntuar** y **para atrapar** los errores del modelo (Eje B, §4-B).

---

## exp3 · Curva de prefill real (§8.2)  ⚠ el hallazgo más duro

> Nota metodológica: la 1ª versión de exp3 tenía un bug (reusaba el mismo prompt → el
> KV-cache de Ollama daba prefill ≈0ms, falso). Corregido con warm-up + **prompts únicos
> por medición** + mediana. Estos números son limpios.

Prefill medido (mediana, modelo pre-cargado):

| Modelo | ~tok | prefill | prompt t/s | gen t/s | TTFT | 1ª oración |
|---|---|---|---|---|---|---|
| **3B (voz)** | 1000 | **2202ms** | 527 | 41 | 2227ms | 2641ms |
| 3B | 2000 | 4556ms | 490 | 39 | 4581ms | 5012ms |
| 3B | 4000 | 10634ms | 413 | 37 | 10662ms | 11123ms |
| 7B (tareas) | 1000 | 5209ms | 223 | 20 | 5258ms | 6095ms |
| 7B | 2000 | 10573ms | 211 | 20 | — | 11482ms |
| 7B | 4000 | 22394ms | 196 | 19 | — | 23345ms |

**Budget de voz §8.2:** prefill ≤ 600ms, 1ª oración ≤ 400ms, TTFA ≤ 1.7s.

**Veredicto: el budget de voz NO se cumple en esta máquina.**
- 3B @ 1000 tok: prefill **2202ms = 3.7× el budget**; 1ª oración **2641ms = 6.6×**.
- **Es estructural, no de contexto:** aun con prefill instantáneo, generar 18 tokens a
  41 tok/s = **439ms**, ya por encima del budget de 400ms de la 1ª oración. Recortar el
  contexto ayuda al prefill, pero la velocidad de generación sola ya rompe el budget.

**Implicancia (Fase 5 — Voz):** hay que replantear el objetivo de voz *antes* de construirlo:
- modelo más chico/rápido (qwen2.5:1.5b / 0.5b), o
- stack de inferencia más rápido en Apple Silicon (MLX / llama.cpp afinado, speculative decoding), o
- **aceptar ~2–3s de latencia** (se siente lento pero es usable), o
- postergar/replantear voz. El plan ya la puso al final (Fase 5) por buenas razones.

> Cautela honesta: la Mac estaba con RAM casi llena (ver exp4), lo que puede deprimir el
> prefill. En su momento se anotó "conviene re-correr exp3 con la máquina liberada para ver
> el techo" — **eso quedó sin hacer y ya no se puede**: el script y el motor local se
> eliminaron. Pero la conclusión se sostiene: la velocidad de *generación* (independiente
> de la presión de RAM) ya no alcanzaba el budget de 1ª oración.
>
> Nota posterior: el proyecto terminó por el otro camino de la lista, "stack de inferencia
> más rápido" llevado al extremo — se sacó la inferencia de la máquina. La voz que quedó
> (whisper.cpp + `say`) **sí es local**; lo que viaja es el turno del tutor.

---

## exp4 · Presupuesto de RAM (§8.3)

- Sistema: 16 GB. Al momento de medir: **0.07 GB libres** (Ollama + apps del usuario).
- Cargado: `qwen2.5:7b` = 4.32 GB.
- Presupuesto teórico: infra+7B = 9.3 GB (margen 6.7), infra+3B+7B = 11.5 GB (margen 4.5).
- **Veredicto:** entran en el papel, pero el margen real es fino (freemem ≈ 0). El 3B y el
  7B **no** deben estar cargados a la vez sin `keep_alive:0`. Y sin Docker (ya eliminado)
  se recuperan 2–3 GB. Criterio: que no swapee bajo carga real (Next + browser + Postgres +
  embeddings + modelo simultáneos).

---

## Veredicto global del gate de Fase −1

| Experimento | Resultado | Acción |
|---|---|---|
| exp1 ingesta | ❌ pdf-parse inadecuado | **Fase 0.5** (ya especificada con 6 requisitos) |
| exp2 grounding/exam | ✅ el 7B sirve para el núcleo | Seguir |
| exp2 A2 literal | ⚠ 36% | **Rediseñar A2** (anclar a chunk + entailment) |
| exp2 grading | ❌ 78% (severo) | **Descomponer** corrección (§4-C) |
| exp2 math | ❌ ~75% + incalificable | **SymPy** obligatorio (§4-B) |
| exp3 voz | ❌ budget imposible acá | **Replantear voz** antes de Fase 5 |
| exp4 RAM | ⚠ margen fino | `keep_alive:0`, sin Docker |

**Conclusión:** el producto **núcleo es viable** (grounding + generación de exámenes con
el 7B son sólidos). Pero el gate confirma que **tres piezas del plan pasan de "deseables"
a obligatorias**: (1) verificación descompuesta + SymPy (Fase 2), (2) rediseño de A2, y
(3) replanteo del objetivo de voz. Ninguna es "cambiar el producto"; todas ya estaban
previstas en el plan v2 — ahora tienen número que las justifica.
