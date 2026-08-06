# HANDOFF — Tutor IA (para retomar en un chat nuevo)

> Estado al **2026-08-05**. Corre en la Mac del usuario (**Apple M4, 16 GB**).
> Proyecto en `/Users/dusan/Documents/ia`. Rama `feat/bloques-aurora-plan-prueba`.
> **Leé también la memoria del proyecto** (`tutor-ia-estado.md` y las notas por feature).

---

## 1. Qué es

Tutor de estudio para el material oficial del alumno. **Facilitador del aprendizaje
conceptual**: explica los temas con sus propias palabras y ejemplos, **cita la fuente o
lo dice**, verifica comprensión y **se adapta** si el alumno no entiende.

**NO resuelve ejercicios ni matemática/cálculo** — FUERA DE SCOPE. Medido en su momento
(`exp5`, con el 7B local): lo tenía topado (grading ~78%, math ~75%) y el scaffolding no
lo rescata. SymPy quedó solo como verificación opcional (`grading.ts`/`sympy_check.py`
parkeados). El script `exp5` se borró junto con el proveedor local; la decisión de scope
sigue en pie.

**Arquitectura clave — RAG de DOBLE CORPUS TIPADO:** el material viene en pares por
materia/grado: **Texto del Estudiante** (`corpus_role='content'`, el "qué" citable) +
**Guía Didáctica del Docente / GDD** (`corpus_role='pedagogy'`, el "cómo": ideas_previas,
evaluacion, errores_frecuentes, proposito, habilidad, solucionario…, anclados al OA).
El link es por **OA + relevancia semántica**, NO por (unit,lesson) — TE y GDD numeran distinto.

**El tutor YA NO SE NIEGA (2026-08-03).** Antes, cuando el gate no pasaba, el alumno
recibía una frase fija y **el modelo ni se llamaba**. Hoy responde siempre; la única
abstención que queda es de INFRAESTRUCTURA (reranker caído). Lo que cambia no es *si*
responde sino **cómo lo encuadra**, y eso son DOS EJES INDEPENDIENTES:

| eje | valores | qué contesta |
|---|---|---|
| `mode` | `libro` · `apoyado` · `general` | ¿hay material que respalde esto? |
| `scope` | `curso` · `otro_curso` · `otra_materia` · `ninguno` | ¿de dónde salió ese material? |

Meterlos en un solo campo obliga a mentir en uno: "¿qué es la fotosíntesis?" preguntada
desde Lengua es `libro` (el material existe y la respalda) **y** `otra_materia` (pero no es
el libro de esta materia). El chico lee *"esto no está en el libro de esta materia, lo saqué
de Ciencias Naturales 6º"*.

**CASCADA DE ALCANCE** (`packages/rag/src/retrieve-teaching.ts`) — el gate dejó de ser
cortacircuito y pasó a ser el disparador de la etapa siguiente:

| etapa | dónde busca | umbral |
|---|---|---|
| `curso` | el libro de la materia | 0,18 |
| `otro_curso` | misma asignatura, TODOS los cursos (`subjects.family`) | 0,18 |
| `otra_materia` | corpus completo | 0,50 |
| — | sin material → modo `general` | — |

⚠️ **La cascada NO es "el primero que pasa gana", y eso costó un bug en producción.** Con
umbrales distintos por etapa, frenar en la primera que supera EL SUYO hacía que un 0,18
flojo le ganara a un 0,99 excelente por venir antes en el código. Real: un chico en Lengua
8º preguntaba por la fotosíntesis y recibía *"los restos nudosos de un antiquísimo tocón"*
(Lengua 7º, 0,18) mientras Ciencias Naturales 6º pág. 83 esperaba con 0,99. Ahora, si lo de
la asignatura propia queda por debajo del listón alto, se sigue buscando y gana el mejor por
`rerankScore`. Si lo flojo vino del libro del PROPIO curso se queda igual: ése es el libro
que el chico tiene sobre la mesa.

> ⚠️ **Cambio de premisa, en dos pasos.**
> **(2026-07-30)** dejó de ser necesariamente "100% local": la generación podía apuntar a
> una API remota con una env var, y con `LLM_PROVIDER=ollama` (default de entonces) nada
> salía de la máquina.
> **Ahora el paso está completo: NO hay motor local.** Se eliminó el proveedor Ollama
> (`packages/core/src/llm/ollama.ts` borrado); el único es `OpenAICompatProvider` y
> `LLM_PROVIDER` solo acepta `deepinfra` — si dice `ollama` tira un error explicando que
> se eliminó. **Los embeddings también son remotos** (`packages/rag/src/embeddings.ts` →
> `POST {base}/embeddings`, `BAAI/bge-m3`). Siguen locales: el sidecar de reranker + NLI
> (:8790) y Postgres/pgvector.
>
> 🔌 **Consecuencia que hay que tener presente al operar:** antes, sin internet, se caía la
> generación pero **la BÚSQUEDA seguía andando** (embeddings y reranker locales). Ahora un
> corte de red deja al alumno **sin nada**, porque los embeddings salen a la API.
> Y la otra cara: lo que el alumno pregunta y los fragmentos de su libro **viajan al
> proveedor**. La promesa de privacidad que queda en pie es la interna (el docente no ve
> las conversaciones, §4), no la de "nada sale de la máquina".

> **No hizo falta re-embeber los 28.986 chunks.** Se midió el mismo texto por los dos
> caminos (Ollama local vs API): coseno **0,999993**, norma 1,0000 en ambos. Es el mismo
> `bge-m3` servido en otro lado, así que los vectores viejos siguen siendo válidos. Ese
> resultado vale para bge-m3 y para nadie más: cambiar `EMBEDDING_MODEL` sí obliga a
> re-embeber todo (la dimensión coincidente NO prueba nada).

---

## 2. Stack y servicios (CRÍTICO para arrancar)

```bash
cd /Users/dusan/Documents/ia
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"   # Postgres es keg-only

# 1) Postgres 17 (nativo, SIN Docker). Base 'tutor' con TODO ingestado.
brew services start postgresql@17
# psql "postgresql://localhost:5432/tutor" -tAc "select count(*) from chunks"  # ~30k

# 2) DEEPINFRA_API_KEY en el .env de la raíz + conexión a internet.
#    Es requisito DURO: sin eso no hay generación NI embeddings, y sin embeddings
#    no hay retrieval. Ya no queda nada que funcione offline salvo la voz.
# 3) Sidecar reranker + NLI (LOCAL, ARRANCAR A MANO; sirve /rerank y /nli en :8790, MPS):
nohup ./packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py \
  > packages/ingest-py/rerank_server.log 2>&1 &
curl -s http://127.0.0.1:8790/health   # {"status":"ok"...}

# 4) Web. Desde Claude Code: preview_start {name:"web"}.
#    O: pnpm --filter @tutor-ia/web dev
```

Ya **no hay que instalar ni arrancar Ollama**: se eliminó del proyecto. El sidecar de
:8790 NO es Ollama y NO es un LLM — es el reranker/NLI en Python, y sigue siendo local.

**Voz (100% local):** `whisper.cpp` (brew `whisper-cpp` → `whisper-cli`) + modelo
`packages/ingest-py/whisper-models/ggml-base.bin` (gitignored, 141MB) para STT;
macOS `say` + `ffmpeg` para TTS. Todo instalado.

La voz **no se fija a mano**: `/api/voice/tts` elige la mejor instalada (prefiere las
"Mejorada/Premium", si no Paulina es_MX — el corpus es chileno, Mónica es de España).
Se puede forzar con `TTS_VOICE` y el ritmo con `TTS_RATE`. **Todo lo que se habla pasa
antes por `apps/web/lib/speech.ts`**: saca emojis (medido: 4 emojis = +4s de audio porque
`say` los NOMBRA), markdown y abreviaturas, y mete pausas `[[slnc]]` entre oraciones.
⚠️ Ese módulo también borra los corchetes del texto del modelo: `say` ejecuta cualquier
`[[…]]` como comando, así que sin eso el LLM podría bajarle el volumen al audio.

### Entorno — leer esto antes de tocar env vars

Hay **UN solo `.env` en la raíz** (gitignored). Cómo llega a cada lado:

| Consumidor | Cómo carga el `.env` |
|---|---|
| Web (Next) | `apps/web/next.config.mjs` hace `process.loadEnvFile()` de la raíz (Next solo lee `apps/web/.env*` por su cuenta) |
| Scripts de eval | `tsx --env-file-if-exists=../../.env` en cada script de `packages/eval/package.json` |
| Turborepo | `turbo.json` → `globalEnv` (envMode strict en turbo 2.x) + `globalDependencies: [".env"]` |

**Tres trampas ya desactivadas (no las reintroduzcas):**

1. **`.claude/launch.json` ESTÁ TRACKEADO en git** → jamás poner secretos ahí.
2. **`process.loadEnvFile` NO pisa variables ya seteadas.** Por eso se **sacó `LLM_MODEL`
   de `launch.json`**: cuando convivían los dos motores, si quedaba ahí el tag de Ollama
   (`qwen2.5:7b`), el provider remoto lo recibía y devolvía 404. El motor local ya no
   existe, pero la trampa del `.env` sí: `LLM_MODEL` seteado en cualquier lado gana, y
   dejarlo **vacío** es lo que hace que el provider use su propio default.
3. `.env.example` decía `RERANK_MIN_SCORE=0.3` mientras el código usa **0.18** — copiarlo
   revertía el gate en silencio. Ya corregido.

`.gitignore` cubre `.env`, `.env.*` y exceptúa `.env.example`.

Datos no obvios: el reranker usa `transformers` directo (NO FlagEmbedding); Python del venv
es 3.14 (por eso la voz usa binarios, NO faster-whisper).

> Histórico: la latencia de ~2 min por turno que se sufría antes venía de `keep_alive:0` en
> Ollama (recargaba el 7B en cada llamada; era eso o quedarse sin RAM). Se fue con el motor
> local; hoy el costo por turno es de red, no de recarga de modelo.

---

## 3. Capa de proveedores de LLM (`packages/core/src/llm/`)

Toda la generación pasa por una interfaz `LLMProvider` con tres métodos
(`generate`, `generateStructured`, `generateStream`). `client.ts` quedó como **shim delgado**
→ los **13 call sites (en 8 archivos) no se tocaron**.

```
LLM_PROVIDER=deepinfra   # ÚNICO valor válido (vacío = lo mismo). API remota
                         # compatible con OpenAI; LLM_BASE_URL apunta a cualquiera.
LLM_PROVIDER=ollama      # ❌ error explícito: el proveedor local se eliminó
```

Se borró `llm/ollama.ts`. El proyecto ya venía corriendo con `deepinfra`, así que la rama
local era código muerto que igual había que mantener y explicar. `activeProviderName()`
rechaza cualquier otro valor con un `LLMError` en vez de caer en un fallback mudo.

- **`OpenAICompatProvider`** sirve a cualquier API estilo OpenAI: `LLM_BASE_URL` +
  `LLM_API_KEY` (fallback `DEEPINFRA_API_KEY`). **Sin failover automático** a propósito:
  si un proveedor tira 429 tras los reintentos, falla con `LLMError` tipado, para saber
  qué proveedor produjo cada número.
- **Params canónicos explícitos** (`params.ts`): si se dejaran implícitos, DeepInfra
  usaría `temperature 1.0` en vez del `0.1` que fija el proyecto y el golden set dejaría
  de ser reproducible. `generateStructured` fuerza `temperature 0`. (Nacieron para que los
  dos motores midieran igual; siguen valiendo para comparar endpoints entre sí.)
- **El normalizador de consultas** (`query-normalize.ts`) usaba un `qwen2.5:3b` local;
  ahora usa el default del proveedor (`QUERY_NORMALIZER_MODEL` vacío). Es más grande de lo
  que la tarea pide, pero solo se paga cuando la búsqueda con la formulación cruda del
  alumno ya falló.
- **Timeouts renombrados** en `config.ts`: `ollamaStreamTimeoutMs` → `llmStreamTimeoutMs`,
  `ollamaJsonTimeoutMs` → `llmJsonTimeoutMs`. Se fue `ollamaBaseUrl`.
- **Errores tipados** (`LLMError`): `timeout | rate_limit | server | client | auth |
  network | bad_response | bad_schema | budget_exceeded | reasoning_overflow`.
  Reintentos **solo en 429/5xx** (2, backoff exponencial); en streaming solo **antes del
  primer token**.
- ⚠️ **No clasifiques el abort por el error** (bug encontrado y corregido el 2026-07-30):
  el SDK de OpenAI envuelve el abort en un error propio (`"Request was aborted."`) cuyo
  `name` NO es `AbortError`, así que `isAbort()` no lo veía y un **timeout caía en
  `kind:"network"` → retryable → 3 intentos**, pagando 3x y reportando "fallo de red".
  Ahora el handle de `withTimeout` expone `timedOut()`/`cancelled()` y **él** decide:
  timeout y cancelación externa son **no reintentables**. `withRetry` además reporta los
  intentos **reales**, no el máximo.
- **Tope de gasto** (`budget.ts`): `LLM_MAX_TOKENS_PER_RUN` aborta antes de gastar de más.
  El golden set son 133 preguntas × 2 llamadas = 266 base, hasta ~800 con reintentos.
- **Logging** sin contenido: `[llm] deepinfra@api.deepinfra.com <modelo> generate 1422ms
  in=35 out=120 reason=0 temp=0.1 …`. Nunca prompt ni respuesta.

### Razonamiento ("thinking") — medido contra el endpoint real

Los Qwen3.x razonan por defecto y **queman el presupuesto sin responder**.
Verificado en DeepInfra con `Qwen/Qwen3.6-35B-A3B`:

| Config | tokens salida | resultado |
|---|---|---|
| thinking ON (default del modelo) | 191 | 3 tokens útiles, 188 invisibles |
| **thinking OFF** | **3** | `42` |

Mecanismos probados (⚠️ **no asumir, medir**):

| Mecanismo | DeepInfra |
|---|---|
| `chat_template_kwargs:{enable_thinking:false}` | ✅ |
| `reasoning:{enabled:false}` | ✅ |
| `reasoning_effort:"none"` | ✅ |
| `enable_thinking:false` (raíz) | ❌ ignorado (pero es el que necesitan **Novita/Alibaba**) |
| `/no_think` en el prompt | ❌ sin efecto en 3.6 |

Por eso `LLM_REASONING=off` (default) manda **los 4 combinados**, con escape hatch
`LLM_REASONING_PARAMS`. `generateStructured` fuerza `off` siempre (un bloque de pensamiento
rompe el parseo del JSON).

**⚠️ Trampa crítica:** un **typo en la clave NO da error** — da un modelo que piensa
(`enable_thinkingg` → HTTP 200 con 237 tokens de razonamiento). Verificar por **tokens**,
nunca por status code. Para eso está la columna `LEAK` del smoke.

**Filtro (defensa en profundidad, `llm/reasoning.ts`)** — el razonamiento no llega jamás al
call site, aunque el switch falle:
- Campo separado `reasoning_content` **y** `reasoning` (vLLM lo renombró; hay que leer los dos).
- Bloques `<think>…</think>` inline, con máquina de estados en streaming: nunca emite tags
  parciales; cubre **tag partido entre deltas**, **`</think>` huérfano** (lo que produce la
  plantilla Jinja de Qwen3.6) y **`<think>` sin cerrar** → `LLMError reasoning_overflow`.
- `reasoningTokens` se reporta aparte (visibilidad) pero **NO se re-suma al presupuesto**:
  ya está dentro de `outputTokens`.

**Dónde aparece el razonamiento cambia según el modelo:** Qwen3.6 → campo `reasoning_content`;
Qwen3-30B → `<think>` inline; con `reasoning.enabled=true` → **ambos a la vez**.

**⚠️ Caveat:** la doc de razonamiento de DeepInfra solo cubre oficialmente DeepSeek-R1. Que
funcione en Qwen3.6 es hallazgo empírico, **no promesa del proveedor**.

**Los model ID NO son iguales entre proveedores:** `Qwen/Qwen3.6-35B-A3B` (DeepInfra, GMI) ·
`qwen/qwen3.6-35b-a3b` (Novita) · `qwen/qwen3.6-35b-a3b:fp8` (Scaleway) · `qwen3.6-35b-a3b`
(Alibaba). Cambiar `LLM_BASE_URL` implica cambiar también `LLM_MODEL`. Los baseURL están
listados en `.env.example`.

---

## 4. Estado — QUÉ ESTÁ HECHO

**Núcleo (Plan v3)**
- Anti-alucinación: gate por reranker, verificación NLI direccional, premisa falsa,
  mensajes sociales sin abstención.
- Facilitador con flujo activar→objetivo→explicar→verificar→adaptar. Piloto E2E pasó.
- **Corpus:** 73 materias, **16.974 chunks de contenido + 13.069 de pedagogía**,
  55/73 con GDD (verificado en DB).

**UI — sistema de diseño "Bloques & Aurora"** (claro, 100% offline, fuentes de sistema)
- **Panel + onboarding = "Bloques"**: bloques con borde de tinta 2px `#191621` + sombra dura
  (`4px 4px 0`), color por materia, CTA cobalto `#2B44FF`.
- **Conversación = "Aurora"**: burbujas suaves con sombra difusa, acento lavanda `#6C5CE7`,
  orbe aurora, chip de cita con esquina doblada.
- Fondo **blanco** `#FFFFFF`; display `ui-rounded` (SF Pro Rounded), cuerpo `-apple-system`,
  citas `ui-monospace`. Cuerpo de lectura `#201C2B` (AAA).
- Onboarding: barra de progreso arriba, contenido centrado (todo alineado al eje central).

**Cuentas, roles y sesión (en la base — ya NO localStorage)**
- **Login anónimo**: usuario + contraseña, sin registro. Las cuentas las crea el equipo
  con el CLI y el colegio las reparte en papel. `users.name` **no existe**: el mapeo de
  "7b-01" a una persona vive fuera de la base.
- Sesión con token opaco en cookie y estado en `auth_sessions` (sha256 del token, nunca
  el token). Se puede **revocar**, que es el requisito real con credenciales en papel.
- Tres roles: `student` · `teacher` · `admin`. `packages/admin/src/users.ts` valida el
  `--rol` contra esa lista.
- **La frontera de seguridad es `lib/auth.ts`, no el middleware**: el middleware corre en
  Edge y solo puede ver si existe la cookie.

**Panel del docente** (`/docente` + `/api/teacher/overview`) — avance y puntos débiles
del curso. Bloques, en orden de utilidad: qué le cuesta a la CLASE (temas agregados por
cuántos alumnos distintos los fallaron), avance por materia, y la fila de cada alumno
(expandible por materia).
- **No muestra conversaciones, y eso es estructural**: ninguna ruta bajo `/api/teacher`
  consulta `messages`. Si un chico sospecha que su profe lee lo que le pregunta al tutor,
  deja de preguntar con honestidad.
- El denominador del avance sale de `book_sections` (level=2, tope 14 = el mismo de
  `getPlanTopics`), **no** de `subject_plans`: esa cache se escribe recién cuando alguien
  aprieta "armar plan", así que arranca vacía.
- Datos para verlo con contenido: `pnpm --filter @tutor-ia/admin seed-demo --curso 1M`
  (solo toca cuentas `demo-…`; `--limpiar` las borra).

**Perfil del alumno** (`student_profiles`) — grado → materias prioritarias → panel
personal. El paso del NOMBRE se eliminó: las cuentas son anónimas.

**Plan de estudio** — se arma desde el **ÍNDICE REAL del libro**; el LLM solo redacta.
La lógica vive en `packages/core/src/study-plan.ts` (`buildStudyPlan`), que usan tanto
`/api/plan` como el CLI: dos copias del prompt darían planes distintos según quién lo
generó. Cacheado por materia en `subject_plans`; el avance por alumno en
`student_plan_progress`, por clave estable del tema.
- Cada lección trae **3 puntos clave** — qué tenés que poder explicar al terminar.
  Salen de una muestra que **recorre la lección entera** (4 fragmentos repartidos);
  con los primeros 700 chars de antes solo se podía titular.
- Se genera **en tandas de 5 lecciones**: se midió con el 7B local de entonces que con
  14 ítems × 5 campos el modelo acorta, repite el título como punto y pierde el orden.
  No se volvió a probar el lote grande contra el modelo remoto.
- `limpiarPuntos` descarta los puntos vacíos ("comprender los conceptos principales"),
  los que repiten el título y los de menos de 3 palabras. Un plan lleno de puntos vagos
  se ve igual de completo que uno bueno — por eso es peligroso.
- **Pre-generado para las 44 materias con índice legible** (493 lecciones, 1.472 puntos)
  con `admin plans generar`. Sin eso, el primer alumno de cada materia paga la espera.
**Estudio dirigido:** al tocar un tema viaja `unit`/`lesson` y el retrieval trae los chunks
reales de esa lección, **saltando el gate semántico** (sin esto se abstenía porque el título
es una paráfrasis floja).

**Simulación de prueba** (`/api/test`, se corrige en `/api/test/submit`) — ~6 preguntas de
opción múltiple, una por unidad, **alineadas a lo que evalúa la GDD**. Corrección
**determinística**. Feedback: score, "📌 Para reforzar" (con botón **Estudiar** → estudio
dirigido) y "💪 Lo que dominás". Lo fallado queda en `student_weak_topics`, que es también
de donde sale el ranking del panel del docente.

**TRAMPA de `jsonb` — leer antes de escribir en una columna json.** Usar
`toJson(sql, x)` de `@tutor-ia/db`, **nunca** `${JSON.stringify(x)}::jsonb`: con esta
conexión (postgres.js, `prepare: false`) lo segundo guarda el TEXTO del json entre
comillas, `jsonb_typeof` devuelve `'string'` y todo lo que trate la columna como
estructura falla con *"cannot get array length of a scalar"*. Así se rompía `/api/progress`
apenas un alumno rendía su primera prueba. Reparación de lo ya escrito:
`packages/db/repair_jsonb_double_encoded.sql` (idempotente).

**Tutor flexible** (rework tras "Fuera de tu material" excesivo)
- Gate `RERANK_MIN_SCORE` **0.3 → 0.18**.
- `needsTopicReply()`: un pedido vago sin tema ("dame un ejemplo") **pide el tema** en vez
  de abstenerse. Era el bug exacto de los chips de la pantalla inicial.
- `retrievalQuery` descarta la muletilla y usa el tema previo en follow-ups vagos.
- Prompt flexible: "enseñá con tus palabras/ejemplos; lo único que no inventás son datos
  duros". Abstención conversacional; se quitó el cartel rojo.
- Usa la GDD para anticipar `errores_frecuentes` y contar qué se evalúa.

**Verificación relajada para el facilitador** — el NLI marcaba **analogías** como
"tu material dice lo contrario" (contradiction 0.86–1.0). Ahora se saltan andamiaje,
aliento y analogías; **no se surfacean alertas por oración**, solo deriva sistemática
(`supported===0 && strong>=3`).

**Citas** — el tutor **no cita en el texto**; las páginas van en una **pestaña colapsable**
("Fuentes en tu material"), cerrada por defecto. `cleanTutorText()` limpia en el cliente lo
que el modelo igual meta.

**Plan A MEDIDA del alumno** (`/api/plan/custom`, `student_custom_plans`) — además del plan
sugerido (que sale del índice del libro y es igual para todo el curso), el alumno pide los
contenidos que quiere. Los temas **no los inventa el modelo**: salen del retrieval y son
lecciones reales, con título y páginas. Reusa `redactarPlan` entero — el mismo prompt, las
mismas tandas, el mismo filtro de puntos vacíos que el sugerido; dos prompts "parecidos" es
la forma más rápida de que los dos planes empiecen a diferir sin que nadie lo decida.
⚠️ Las `topic_key` van prefijadas con el id del plan: `student_plan_progress` tiene PK
`(user_id, topic_key)`, así que sin el prefijo marcar un tema en un plan lo marcaría en otro.

**El sello `apoyado` casi no existe** — de 101 preguntas: 88 `libro`, 10 `general`, **2
`apoyado`**. La condición de deriva (`verify.ts`) exige `supportedFrac <= 0` —ninguna
oración respaldada— MÁS 3 contradicciones fuertes. Estuvo en 0 disparos mucho tiempo por un
bug del eval (corría sin la etapa de familia), pero aun arreglado dispara poquísimo. Sin
calibrar: `drift-sweep` existe para eso y hay 88 preguntas con `prodVerdicts` guardados.

**La pregunta de cierre no puede venir contestada** (`prompts.ts`) — medido sobre los 25
turnos reales que había en la base, **el 40% se contestaba solo**: el tutor decía "el tamaño
del pico es la variable dependiente" y dos renglones después preguntaba cuál era la variable
dependiente. El chico copiaba. Se agregó la regla explícita (releé lo que dijiste; si se
responde copiando, cambiala) más la prohibición de las de sí/no —"¿te hace sentido?"— que
eran 8 de las 10 rotas. Regenerando esas 10 con el prompt nuevo, **6 quedaron sanas**.
Las 4 que siguen son dos patrones: el caso "nuevo" que es el mismo con una palabra cambiada,
y la conclusión que el propio mensaje ya sacó. Falta medir sobre las 25 para una tasa
comparable — con 10 casos elegidos por ser los peores no se puede afirmar una global.

**El camino de voz le contestaba al silencio** — whisper NO devuelve vacío cuando no hay
voz: devuelve `[Música]` / `[BLANK_AUDIO]` con confianza alta (0,918 sobre ruido rosa puro).
Se filtra en `stt/route.ts`. Lo que igual pasa (transcripción inventada: son palabras) se
ataja con una regla del prompt: si no entendés, no adivines.
⚠️ **NO filtrar por confianza**, aunque whisper la exponga: medido sobre la misma frase
degradada, limpio 0,924 · error plausible 0,808 · **transcripción completamente inventada
0,829**. El caso peor puntúa más alto que uno bueno-con-un-error.

**Schemas y modo estricto** — `CLAIMS_SCHEMA` y el inline de `/api/test` **corregidos**
(pasan `strict:true`). `EXAM_SCHEMA` **sigue sin cumplir** a propósito (exams está parkeado);
el guard `strict-schema.ts` lo señala con la violación exacta en vez de un error opaco.

---

## 5. Comandos útiles

```bash
pnpm -r typecheck                                          # 5 paquetes
pnpm --filter @tutor-ia/eval llm-smoke                     # compara endpoints remotos lado a lado
pnpm --filter @tutor-ia/eval llm-smoke -- --only=deepinfra
pnpm --filter @tutor-ia/eval llm-smoke -- --base-urls=https://api.deepinfra.com/v1/openai,https://api.scaleway.ai/v1
pnpm --filter @tutor-ia/eval batch-ingest [rootDir]        # ingesta (RESUMABLE); BATCH_DRY=1 = solo clasificar
pnpm --filter @tutor-ia/eval eval                          # golden set 101 (~2,5 h, background)
EVAL_HALLUCINATION=0 pnpm --filter @tutor-ia/eval eval     # sin el juez de claims (igual GENERA)
pnpm --filter @tutor-ia/eval exp6                          # eval pedagógico
pnpm --filter @tutor-ia/eval nli-validate                  # A3 relevancia vs NLI
pnpm --filter @tutor-ia/eval a3-validate                   # ⚠️ hoy evalúa 0: el set está muerto

# Herramientas para DECIDIR con el material a la vista, no a ojo
pnpm --filter @tutor-ia/eval scope-audit                   # vuelca must_abstain + sus fragmentos
pnpm --filter @tutor-ia/eval scope-audit -- --todas        # las 101 (para validar un filtro)
pnpm --filter @tutor-ia/eval claims-audit                  # las afirmaciones sin respaldo + su material
                                                           # (reusa las respuestas ya guardadas: NO regenera)
pnpm --filter @tutor-ia/eval answerability                 # compara discriminadores de "¿contesta?"
ANSW_JUEZ=1 pnpm --filter @tutor-ia/eval answerability     # + el juez LLM (1 llamada por pregunta)
pnpm --filter @tutor-ia/eval pregunta-final preguntas.json # regenera turnos para medir el cierre
pnpm --filter @tutor-ia/eval drift-sweep eval-results.json # calibrar la deriva (sello `apoyado`)

# Huecos de material: qué preguntan los alumnos que su libro NO cubre.
# Sale de content_gaps, que llena /api/chat cuando scope != 'curso'. Es la lista
# de compras de material con demanda real. SOLO admin: nunca exponer en /docente.
pnpm --filter @tutor-ia/admin gaps listar [--dias 30] [--top 40]

# Cuentas (anónimas: solo usuario y contraseña; sin registro en la app)
pnpm --filter @tutor-ia/admin users crear  --usuario 7b-01 [--rol student|teacher|admin]
pnpm --filter @tutor-ia/admin users lote   --prefijo 7b --cantidad 35
pnpm --filter @tutor-ia/admin users listar
pnpm --filter @tutor-ia/admin users resetear --usuario 7b-01   # + cierra sus sesiones
pnpm --filter @tutor-ia/admin seed-demo --curso 1M             # curso de juguete (SOLO dev)

# Planes de estudio cacheados por materia (resumible e idempotente)
pnpm --filter @tutor-ia/admin plans estado
pnpm --filter @tutor-ia/admin plans generar [--curso 1M] [--forzar]

# Volver al "primer día" para probar el recorrido completo. Sin --confirmar solo
# informa. NO toca las cuentas, los planes cacheados ni el corpus.
pnpm --filter @tutor-ia/admin reset
pnpm --filter @tutor-ia/admin reset --confirmar [--borrar-demo]

# Sacar materias de circulación sin borrarlas (subjects.disabled_at). El patrón
# matchea el nombre SIN el curso, así que "Inglés" apaga las 12 de una.
pnpm --filter @tutor-ia/admin subjects listar
pnpm --filter @tutor-ia/admin subjects desactivar --materia "Inglés" --materia "Física"
pnpm --filter @tutor-ia/admin subjects activar --todas

./scripts/backup-db.sh                                     # pg_dump -Fc verificado + rotación
psql "$DATABASE_URL" -f packages/db/repair_jsonb_double_encoded.sql
```

El smoke imprime `REASON` (tokens de razonamiento) y `LEAK` (si hubo que filtrar) — es la
única forma de detectar que el switch de thinking no llegó.

Libros: `/Users/dusan/Documents/libros/{basica,media}/<grado>/<materia>/*.pdf`. Clasificación
por nombre: texto_del_estudiante/leo_primero/student's_book → content; guía_didáctica/
teacher's_guide → pedagogy; cuaderno/láminas/activity → descarta.

---

## 6. Mapa de archivos

```
packages/core/src/llm/               ← CAPA DE PROVEEDORES (un solo proveedor: remoto)
  types.ts            LLMProvider, LLMPrompt, LLMError, LLMUsage
  index.ts            getLLM() (valida LLM_PROVIDER), makeProvider()
  openai-compat.ts    OpenAICompatProvider — EL ÚNICO (DeepInfra/Scaleway/Novita/…)
  params.ts           params canónicos explícitos + switches de reasoning
  reasoning.ts        filtro de <think> (streaming + no streaming) y campos reasoning_*
  retry.ts            backoff, clasificación 429/5xx, timeouts
  budget.ts           contador de tokens + tope por corrida
  logging.ts          log por llamada (sin contenido), con host del baseURL
  strict-schema.ts    valida JSON Schema para strict mode y dice qué regla se rompe
packages/core/src/
  client.ts           SHIM: chatStream/chatJSON/chatText → getLLM()
  teaching.ts         getTeachingContext, streamTeaching, socialReply, needsTopicReply
  verify.ts           verifyAnswerA3 (relajado para analogías)
  prompts.ts          TEACHING_SYSTEM (flexible, sin citar en el texto)
  groundedness.ts     CLAIMS_SCHEMA (strict-compatible)
packages/rag/src/
  retrieve-teaching.ts  contenido gated + pedagogía por tipo/OA + ESTUDIO DIRIGIDO por unit/lesson
  embeddings.ts         ⚠️ REMOTOS (POST {base}/embeddings, BAAI/bge-m3) — sin red no hay búsqueda
  nli.ts / rerank.ts    NLI direccional / gate del reranker (sidecar LOCAL :8790)
apps/web/app/
  ui.tsx              SISTEMA VISUAL COMPARTIDO (tokens, iconos, piezas). Las 3 pantallas
  page.tsx            UI del alumno: onboarding, panel, chat, plan, prueba, voz
  login/page.tsx      ingreso (sin registro)
  docente/page.tsx    panel del curso: temas difíciles, avance por materia, alumnos
  api/chat/route.ts   teaching + social + vago-sin-tema + verificación (frames \x1e)
  api/plan/route.ts   plan de estudio desde la estructura del libro
  api/test/route.ts   simulación de prueba (alineada a la GDD)
  api/teacher/overview  datos del panel del docente — NUNCA lee `messages`
  api/voice/{stt,tts} whisper.cpp / macOS say
  next.config.mjs     carga el .env de la raíz (loadEnvFile)
apps/web/lib/
  auth.ts             ⚠️ LA FRONTERA DE SEGURIDAD: requireUser / requireTeacher
  session.ts          token opaco en cookie, estado en auth_sessions (revocable)
  middleware.ts (app/) chequeo OPTIMISTA en Edge: solo mira si la cookie existe
packages/admin/src/
  users.ts            alta/baja/reset de cuentas anónimas (roles validados)
  seed-demo.ts        curso de juguete para desarrollo (solo cuentas "demo-")
packages/eval/src/
  llm-smoke.ts        comparación de endpoints remotos (REASON/LEAK)
  golden-scope-audit.ts  vuelca cada pregunta con sus fragmentos, libro y página →
                      para etiquetar `expect_scope` LEYENDO, no adivinando
  claims-audit.ts     las afirmaciones sin respaldo + el material completo contra el
                      que se las juzgó. Reusa las respuestas guardadas: NO regenera
  answerability-sweep.ts  compara discriminadores de "¿el fragmento CONTESTA?" con la
                      tabla de costo en las DOS direcciones (la accuracy sola engaña)
  pregunta-final.ts   regenera turnos por el camino real, para medir el antes/después
                      de un cambio de prompt sobre las MISMAS preguntas
```

Borrados con el motor local: `llm/ollama.ts`, `packages/eval/src/ollama.ts` y los
experimentos que medían SOLO ese motor — `exp2-benchmark`, `exp3-latency`, `exp4-ram`,
`exp5-correcto` (y sus scripts `exp2`..`exp5` en `packages/eval/package.json`). Los
hallazgos que produjeron quedan como registro en `docs/exp2-4-hallazgos.md`.

---

## 6.b FASE 0 de la auditoría (2026-08-05) — qué cambió

Auditoría crítica del motor (6 auditores + verificación en DB). El informe completo
está en la memoria del proyecto (`auditoria-motor-ia.md`); esto es lo que YA se hizo.

**El hallazgo que reordena las prioridades:** verificado con psql, **0 de 16.548
chunks de contenido tienen `heading_path` y 0 tienen `oa`**. `extract_curriculum.py`
entrega texto plano (no markdown), así que el chunking estructural nunca corre y el
"link por OA" de §1 **es imposible por construcción** — `oasContent` en
`retrieve-teaching.ts` siempre sale vacío y el boost de OA no puede disparar jamás.
El recall@5 de 88% y la precisión de 71% no son un misterio de ranking: los chunks
se embeben pelados, sin saber de qué libro ni lección son. **Eso es la Fase 1
(re-ingesta estructural), que es lo que de verdad mueve la aguja.**

Lo aplicado en Fase 0 (todo con `pnpm -r typecheck` en verde):

| # | Cambio | Dónde |
|---|---|---|
| 1 | Perfil `8B` para `EVAL_USER_ID` + `familyIds`/`studentGrade` en claims-audit | DB + `claims-audit.ts` |
| 2 | La vía del MARGEN ya no perfora el listón 0.50 de `otra_materia` (`gateMargin: 0`) | `rerank.ts` · `retrieve-teaching.ts` |
| 3 | Gate de score para la pedagogía (`RAG_PEDAGOGY_MIN_SCORE`, 0.05) + se conserva el rótulo `[Unidad X]` | `retrieve-teaching.ts` · `teaching.ts` |
| 4 | El error crudo del proveedor ya no llega a la burbuja del alumno; el turno fallado se persiste | `api/chat/route.ts` |
| 5 | Registro de HUECOS DE MATERIAL (`content_gaps` + `admin gaps listar`) | `schema_content_gaps.sql` · `admin/gaps.ts` |
| 6 | Simulación de prueba: clave verificada, clave fuera del cliente, shuffle, todo el libro, 503 en vez de prueba vacía | `api/test/*` · `sections.ts` · `page.tsx` |
| 7 | Validador de la PREGUNTA DE CIERRE en runtime (`CLOSING_QUESTION_CHECK`) | `closing-question.ts` · `teaching.ts` |
| 8 | Discriminador de ANSWERABILITY cableado tras `RAG_ANSWERABILITY` (solo cross-scope) | `answerability.ts` · `retrieve-teaching.ts` |

**Mediciones nuevas que valen más que el código:**

- **La pedagogía entraba al prompt casi toda como ruido.** Medido sobre Lengua 8º con
  5 consultas reales, los scores de los bloques que ENTRABAN (top-2 por tipo):
  relevantes en **0.12–0.70**, ruido en **≤0.016**, y un **hueco vacío en el medio**.
  Dos de las cinco consultas no tenían NI UN bloque relevante y aun así el prompt
  recibía 8. El umbral 0.05 cae dentro del hueco: no hay nada que afinar. Efecto
  real: `nPeda` pasa de ~7-8 por turno a 0-2, y los que quedan son los buenos.
- **El caso "¿cuánto hervir un huevo?" ya no se cuela** (era el ejemplo de la puerta
  trasera del margen): antes entraba con topScore 0.16 pese al listón 0.50; ahora
  `scope=ninguno`, score 0.000.
- **El discriminador no daña el caso bueno**: "¿qué es la fotosíntesis?" desde Lengua
  8º da entailment **0.991** (pasa cómodo) con el material de Ciencias que sí contesta.
- **El validador de cierre acierta 4/4** en los casos conocidos: detecta y reemplaza
  la auto-contestada del pinzón y el "¿te hace sentido?", y deja intactas la buena y
  la que no tiene pregunta final. Costo: ~0.4-1.7 s cuando la pregunta ya está bien.
- ⚠️ **q123 (Sherlock) sigue pasando y es por diseño**: ahora entra como `scope=curso`
  con 0.146 por la vía del margen. Su entailment es 0.831 (el discriminador lo
  frenaría), pero el discriminador **no gobierna el libro del propio curso** — filtrar
  ahí rompería la promesa del producto para arreglar el problema de al lado.

**Cómo revertir para reproducir el baseline viejo:** `RAG_ANSWERABILITY=0`
(default), `CLOSING_QUESTION_CHECK=0`, `RAG_PEDAGOGY_MIN_SCORE=0`. Los cambios 2, 4,
5 y 6 no tienen flag: son correcciones, no experimentos.

### Corrida de validación (101 preguntas, `RAG_ANSWERABILITY=1`) y su AUDITORÍA

| métrica | baseline 04-08 | F0 | |
|---|---|---|---|
| recall@5 | 88,0% | 88,0% | = |
| precision@gold | 71,1% | 71,1% | = |
| alucinación (tasa, modo libro) | 15,5% | 13,3% | ⚠ ver abajo |
| false_abstention | 1,3% | 0,0% | ⚠ ver abajo |
| false_book_claim | 4,2% | 4,2% | = |
| **correct_mode** | **62,5%** | **95,8%** | ⚠ ver abajo |

**⚠️ NO CITES ESOS NÚMEROS SIN LEER ESTO.** Cuatro escépticos independientes
auditaron el salto y encontraron que la lectura ingenua es falsa en tres puntos:

1. **El crédito del discriminador es +20,8 pts, no +33,3.** El denominador de
   `correct_mode` son **24 preguntas** (las únicas con `expect_mode`, todas
   `must_abstain`), así que cada pregunta vale 4,17 puntos y el salto son 8
   preguntas: 15/24 → 23/24. Y de esas 8, **solo 5 son del discriminador**: q032
   la mató `gateMargin:0` (cambio 2, sin flag) y q124/q125 las volteó una
   **deriva de retrieval** por el cambio de proveedor de embeddings (commit
   cc0b629, Ollama local → API), que nadie había detectado. El contrafáctico
   honesto del flag es **75,0% → 95,8%**.
2. **La alucinación NO bajó.** Es composición: las 8 preguntas que salieron del
   bucket `libro` llevaban 12 de 34 afirmaciones sin respaldo. Sobre la MISMA
   población medible en ambas corridas, la tasa va de 13,28% a 13,35% — o sea
   nada. Y `hallucinationRate` global **subió** (49,0% → 50,5%).
   `generalSinMedir` pasó de 10 a 18: parte de la "mejora" es dejar de mirar.
3. **`false_abstention` no puede ver el daño del discriminador, por
   construcción.** `eval.ts:292` define `abstained = !!res.rerankerDown` — solo
   infraestructura. Cuando el discriminador rechaza, el tutor **responde igual**
   en modo general, así que nunca produce una abstención. El 1,3%→0% era q041
   con `cause=reranker_down`, un hipo del sidecar. La red de seguridad que este
   HANDOFF prometía ("si daña las answerable se ve en false_abstention y en
   recall") **no existe**: ninguna pregunta `answerable` pasa por el filtro, y
   por eso recall y precisión salen idénticas al bit.

**El costo real, con un caso probado.** q035 ("¿resultado de las últimas
elecciones presidenciales en Chile?"): el baseline citaba Educación Ciudadana con
**0/4 afirmaciones sin respaldo** y reconocía su límite ("el material se centra en
participación… sí menciona que en 2017 resultó electo Piñera"). En F0 cae a modo
general y responde *"la última se realizó en noviembre de 2021… la próxima será en
2025"* — **falso al 2026-08-05, dicho con confianza, con 5/5 sin respaldo**, y
`correct_mode` lo cuenta como ACIERTO. No es culpa del discriminador (el material
no contestaba la pregunta y la etiqueta `must_abstain` es correcta): es que **el
modo general no sabe en qué año vive y nadie mide su corrección factual**. Con 18
preguntas ahí en vez de 10, ese agujero creció 80%.

**Umbral bajado a 0,85 (era 0,91), y esta vez BARRIDO de verdad.** Con
`retrieval-guard` (ver abajo), sobre las 24, con los entailments de RUNTIME:

| umbral | correct_mode | qué falla |
|---|---|---|
| 0,80 | 87,5% (21/24) | q035 · q120 · q123 |
| **0,85** | **91,7% (22/24)** | q120 · q123 |
| 0,91 | 95,8% (23/24) | q123 |

Los entailments reales, ordenados — arriba el material que DEBE pasar, abajo el
ruido que debe frenarse:

```
material bueno:  q034 0,9946 · q030 0,9907 · q121 0,9774 · q128 0,9478 · q036 0,9326 · q126 0,9314
ruido on-topic:  q120 0,9017 · q035 0,8076 · q029 0,6624 · q122 0,2541 · q129 0,1475
```

Las dos poblaciones se separan por **0,0297** (q120 → q126) y ahí es donde el sweep
puso el 0,91 — con las mismas 14 preguntas que después lo puntúan. A 0,91 el margen
hasta el material bueno más bajo es **0,021**; a 0,85 es **0,081**. Cuatro veces más
aire, y eso importa porque toda la deriva del uso real (registro coloquial,
hipótesis compuesta en multiturno) empuja el entailment HACIA ABAJO, o sea contra el
material bueno. Los 4,2 puntos que cuesta son **una sola pregunta** (q120). q123
(Sherlock) falla en los tres umbrales: es `scope=curso` y el discriminador no
gobierna el libro propio, por diseño.

⚠️ **Y el barrido dejó ver un problema de la ETIQUETA, no del motor.** q035
(elecciones) tiene entailment 0,8076: a 0,80 pasa y sirve el material de Educación
Ciudadana; a 0,85 se bloquea. El golden marca el bloqueo como ACIERTO
(`must_abstain`) — pero la respuesta bloqueada era mejor para el alumno: *"el
material se centra en participación más que en resultados; sí menciona que en 2017
resultó electo Piñera"*, 0/4 afirmaciones sin respaldo. Lo que la reemplaza es
conocimiento del modelo desactualizado. **El golden premia la peor de las dos
respuestas**, porque su vocabulario es binario (hay material / no hay) y el caso
pide el tercero: material PARCIAL, servido con su límite a la vista. Ese tercero ya
existe y se llama modo `apoyado` — dispara 2 veces en 101 y nadie lo calibró.

**Dos defensas nuevas que la auditoría motivó:**
- **Bypass en turnos vagos/struggling** (`vagueTurn`): con "no entendí" la query es
  el turno previo pegado al actual, y `comoAfirmacion()` produce hipótesis
  compuestas o degeneradas ("El texto explica no cacho, me lo explicás más fácil
  porfa.") cuyo entailment se hunde por la FORMA, no por el material. Sin esto, un
  "no entendí" en una charla cross-scope le arranca el material al chico a mitad de
  la conversación. **El golden no puede verlo: corre con `history: []`.**
- **El entailment se PERSISTE** (`answerabilityEntail` → `answEntail` en el log).
  Antes se descartaba: cuando el filtro bloqueaba, no quedaba rastro del número con
  que decidió. Es la diferencia entre auditar y adivinar.

### El tercer casillero: modo `apoyado` por material PARCIAL (2026-08-05)

Calibrado con `pnpm --filter @tutor-ia/eval apoyado-sweep`, que vuelca el par
(relevancia, entailment) de cada etapa cross-scope. Lo que NO contesta:

```
q120 Cien años de soledad   rerank 0,894   entail 0,902   → pasa el discriminador (libro)
q035 elecciones en Chile    rerank 0,833   entail 0,808   → APOYADO
q129 Pitágoras              rerank 0,847   entail 0,147   → general
q122 Sancho Panza           rerank 0,570   entail 0,254   → general
q029 huesos del cuerpo      rerank 0,152   entail 0,662   → general
```

**La relevancia sola NO alcanza, y ese fue el hallazgo del sweep.** q129 puntúa
0,847 —más alto que q035— con entailment 0,147: un texto sobre el teorema de
Euclides que del de Pitágoras no dice nada. El cross-encoder ve "geometría" y lo
llama del tema. Servirlo como parcial sería el mismo ruido con cara de respuesta,
un nivel más abajo. Por eso `apoyado` exige LAS DOS señales: relevancia ≥ 0,8 Y
entailment ≥ 0,5.

⚠️ **Trampa en la que se cayó igual, teniéndola documentada:** la primera versión
de `apoyadoMinEntailFromEnv` hacía `Number(process.env.X ?? "")` y aceptaba
`n >= 0`. `Number("")` es **0**, así que con la env var ausente el piso valía 0 —
o sea ningún piso, y q129 entraba como parcial. Es exactamente la trampa que
`core/config.ts` ya advierte para `RERANK_MIN_SCORE`. La cadena vacía se descarta
ANTES de convertir, siempre.

**Costo medido, y la tensión que hay que tener a la vista:**

| | correct_mode |
|---|---|
| sin `apoyado` | 22/24 (91,7%) |
| con `apoyado` | 21/24 (87,5%) |

La diferencia es UNA pregunta —q035— y **la métrica la cuenta mal a propósito**:
el golden solo tiene dos etiquetas (`libro` / `general`) y para q035 eligió
`general`, pero eso es lo que produce *"la próxima elección será en 2025"* en
agosto de 2026. Con `apoyado` el chico recibe *"el material llega hasta 2021 y no
puedo saber quién ganó la última; es muy probable que ya haya habido otra,
confirmalo"* — más el material electoral real de su libro de Educación Ciudadana,
que antes se tiraba. **El golden penaliza la mejor de las dos respuestas** porque
su vocabulario no tiene el tercer estado. Corregir la etiqueta a `apoyado` sería
lo correcto, pero no se hace acá: cambiar el golden para que apruebe la feature
que se acaba de escribir es cómo se fabrica un instrumento que miente.

`RAG_APOYADO=0` lo apaga sin tocar el discriminador. **Nada de esto corre en
producción hoy**: todo cuelga de `RAG_ANSWERABILITY`, que sigue apagado por
default a la espera de la decisión.

**Herramienta nueva — `pnpm --filter @tutor-ia/eval retrieval-guard`.** Mide
`correct_mode` y todo el encuadre SIN generación (minutos, no 2,5 h: el modo lo
decide el retrieval). Permite barrer umbrales (`--min 0.80,0.85,0.91`) y, sobre
todo, **detectar deriva de infraestructura** — que es lo que dejó pasar el cambio
de embeddings: `recall@5` y `precision@gold` se promedian sobre las 72 preguntas
con `expect_chunks` y **ninguna es cross-scope**, así que salieron idénticas al bit
mientras el retrieval cross-scope se movía por debajo.

---

## 6.c FASE 1 — lo que el diseño encontró ANTES de tocar el corpus (2026-08-06)

Cuatro análisis en paralelo + verificación propia. **El plan cambió por completo
y la premisa de la Fase 1 estaba mal formulada.**

### 🔴 LO PRIMERO: re-ingestar HOY le borra el progreso a los alumnos

`batch-ingest.ts:225` hace `delete from documents ... where title=` + insert, así
que **el uuid del documento cambia en cada re-ingesta**. Y la identidad del
progreso es `topic_key = hash(documentId|ord|title)` (`sections.ts:91`). En la
base hay **94 filas en `student_plan_progress` y 29 en `student_weak_topics`**,
sin FK que las proteja, y `book_sections` cascadea al borrar el documento.

Consecuencia: la próxima re-ingesta —por el motivo que sea, incluso cambiar el
nombre visible de una materia (§7)— vacía la barra de progreso y la lista de
"Para reforzar" de todos los alumnos, **en silencio y sin error**. Y
`documents.storage_path` está vacío en **213 de 218** documentos, así que ni
siquiera hay una llave estable a la que migrar sin backfill previo.

**Desacoplar la ingesta del título (UPSERT por `storage_path`) es prerrequisito
BLOQUEANTE de cualquier re-ingesta.** No es una mejora opcional ni algo para
hacer "de paso". Backup hecho antes de tocar nada:
`~/tutor-backups/tutor-2026-08-06_0104.dump` (160 MB, 28.986 chunks, verificado).

### La premisa estaba mal: no es el "embedding pelado", es el CORTE

La auditoría dijo "los chunks se embeben pelados, sin contexto". Es cierto
(`ingest-curriculum.ts:167` embebe `r.content` a secas, mientras la pedagogía sí
lleva rótulo en `:124-127`) **pero no explica el recall**: 56 de 66 materias
tienen UN solo documento de contenido, así que para **13.414 de 16.548 chunks
(81,1%)** el prefijo "libro · curso" es una CONSTANTE dentro de su pool y no
reordena nada. Y las 72 preguntas con `expect_chunks` no incluyen ninguna
cross-scope, que es donde ese prefijo sí ayudaría — o sea que recall@5 y
precision@gold son ciegas, por construcción, a lo único que el prefijo arregla.

**El problema real está en la línea 111 del extractor.** `get_text()` devuelve la
página como un bloque plano: medido, `clean.ts` ve **1 párrafo por página**
(mediana 1, máx 1), así que `chunkStructural` corre ciego y queda degradado a un
cortador de 500 tokens — se ve en la distribución de longitudes, apretada contra
el techo (p50 1.795, p75 1.927, p90 1.969 chars).

La misma página con `get_text("blocks")` tiene **15-26 bloques visuales**.
Verificado en Biología 1º Medio, página 137 — esto es UN chunk y UN vector hoy:

```
[ 20c] Neurona presináptica          [ 17c] Neurotransmisores
[ 21c] Neurona postsináptica         [ 18c] Botón presináptico
[ 41c] Vesícula presináptica con neurotransmisor
[364c] La forma de las neuronas está especializada para establecer redes…
[245c] Cuando el impulso nervioso llega al botón sináptico provoca…
[ 10c] Reflexiona                    [ 74c] 1. Considera las propiedades…
```

Ocho etiquetas de un diagrama + dos párrafos + una consigna + una pregunta,
promediados en un solo vector. Ésa es la forma exacta del fallo que §7 documenta
("el pasaje estaba TEXTUAL en el corpus y no se recuperó").

**Y el arreglo es gratis:** `get_text("blocks")` mide **0,65× el costo** de
`get_text()` — más barato, no más caro. Las 17.621 páginas de contenido se
re-extraen en ~1 minuto. La Fase 1 no es "1-2 semanas": es ~1 h de máquina y
centavos de embeddings. **Lo caro es el riesgo de destruir datos, no el cómputo.**

### Descartado con evidencia: pymupdf4llm

100× más lento (0,289 s/pág con OCR, que es el default de la 1.28) y sus headings
son **mobiliario de página** ("Exploro", "Aplica", "Modelamiento") con niveles que
reflejan tamaño de fuente, no jerarquía: `######` para el autor de un poema, `#`
para basura de OCR (`# OO <u><mark>OSOOY</mark></u>`). Extrae además **30% menos
texto**. La jerarquía real ya está en `book_sections`, gratis y en la base.

### Descartado con evidencia: el OA

`extract_curriculum.py:106` dice `plan = parse_plan(doc) if kind == "pedagogy"
else {}` — el contenido tiene `oa=None` por un **`else {}` hard-codeado**, no por
un fallo de extracción. Y aunque funcionara: el boost de OA solo toca la
pedagogía, así que **no puede mover recall@5 ni precision@gold ni en principio**,
y `ctx.oas` no llega ni al prompt ni a la UI. El §1 de este documento describe
como "arquitectura central" un mecanismo que nunca ejecutó y que nadie extrañó.

### Fuera de alcance, dicho explícitamente

Los **47 libros sin índice parseado** (19,4% del contenido: Inglés, Leo Primero,
Sumo Primero) tienen 0,39-0,70 chunks por página contra 1,28 de los indexados:
**el texto no está en el PDF**. Ningún paso de esta fase le cambia nada a un chico
de 1º con Leo Primero, y prometer "cobertura estructural del corpus" sería falso.

### Orden de trabajo

| # | Qué | Valida | Aborta si |
|---|---|---|---|
| 0 | ✅ **HECHO** — Backup | 160 MB · 28.986 chunks · verificado | — |
| 1 | ✅ **HECHO** — Desacoplar ingesta de `title` (UPSERT por `storage_path`) | 0 huérfanos (eran 158) · 94/94 `topic_key` · 218/218 uuids | — |
| 2 | ✅ **HECHO** — Anclas del golden por TEXTO (no por uuid) | 72/72 resueltas, 0% de inflación, idénticas al jsonl | — |
| 3 | Backfill `heading_path` desde `book_sections` (solo span ≤20 págs = 43,8%) | ≤2/20 citas nombran la lección equivocada | más de 2/20 |
| 4 | `get_text("blocks")` en UN libro (Lengua 8º TE) | pérdida de chars <3%; 68/68 re-anclan; recall@5 no baja | recall baja o pérdida >5% |
| 5 | Rollout a los 93 documentos de contenido | recall@5 ≥91%, precision@gold ≥75% | cualquier métrica retrocede → `pg_restore` |

**Estado del paso 1 (2026-08-06).** `documents.storage_path` está lleno en 218/218
y tiene índice único parcial sobre el corpus global. `batch-ingest` hace UPSERT
por ruta: conserva el uuid, refresca título/materia y borra solo los chunks.
`book_sections` NO se toca en la ingesta — su `ord`/`title` entran en la clave del
progreso. Probado en transacción con rollback: cambiando el título a propósito, el
uuid y las secciones sobreviven y se borran únicamente los chunks.

Efecto colateral útil: los 158 documentos con la capitalización rota tras el
acento ("MatemáTica", "IngléS") dejaron de figurar como huérfanos, así que la
ingesta ya no está bloqueada. Quedan 5 documentos en `status='error'` de siempre
(4 guías docentes de inglés + 1 de Leo Primero) que ahora sí se pueden ingerir.

**Estado del paso 2 (2026-08-06).** `golden/gold-anchors.jsonl` — 122 anclas de
72 preguntas, con el TEXTO del pasaje en vez del uuid. Se resuelven por
containment de 4-gramas con **cobertura acumulada**: se juntan chunks en orden de
4-gramas nuevos aportados hasta cubrir el 90% del ancla. Medido: 0% de inflación
(1,69 ids por pregunta, exactamente el gold real) y 72/72 resueltas, estable entre
0,80 y 1,00 — el parámetro no es sensible. Un umbral fijo por chunk no servía: con
0,25 inflaba 32% (y un gold inflado sube recall@5 solo), con 0,60 iba a
subestimar apenas el re-chunk partiera el pasaje en pedazos.

Regenerarlas: `pnpm --filter @tutor-ia/eval extract-gold-anchors` (exige que los
uuids actuales existan — se corre ANTES de re-chunkear, no después). El eval las
carga solo y avisa si alguna resolvió a chunks distintos de los del jsonl.

⚠️ **`buildSectionsForDocument` dice en un comentario que "las secciones son
derivadas, no hay estado que preservar". Es FALSO** y hay que corregirlo: `ord` y
`title` entran en `topic_key`. Reconstruir `book_sections` sin migrar las claves
le borra el progreso al alumno igual que lo hacía la re-ingesta. Vale también para
el fix de `esAuxiliar` del commit anterior: su efecto se materializa recién al
reconstruir, y eso hay que hacerlo con migración de `topic_key`, no a mano.

⚠️ **Nunca dos cambios en la misma corrida.** El precedente está en §6.b: el salto
de `correct_mode` que parecía del discriminador era en un tercio deriva de
retrieval y `gateMargin:0`.

⚠️ **El prefijo de contexto NUNCA va en `content`.** `chunks.content_tsv` es
`GENERATED ALWAYS AS to_tsvector('spanish', content)` y `match_chunks_lexical` une
los lexemas con OR: cualquier pregunta con "lengua", "unidad" o "lección"
matchearía miles de chunks, y el síntoma se leería como MEJORA (`nLexical` sube,
`lexEmpty` baja). Va en columna aparte o en tiempo de consulta.

---

## 7. Deuda conocida / próximos pasos

- 🟢 **RESUELTA — latencia local de ~2 min por turno.** Venía de `keep_alive:0`
  recargando el 7B en cada llamada; era el peor problema de experiencia. Se fue al
  eliminar el motor local (medido en su momento: 1,4s remoto vs 8,3s local).
- 🔴 **Sin red no hay NADA — ni siquiera búsqueda.** Los embeddings pasaron a la API, así
  que un corte de internet ya no degrada la experiencia: la corta. Antes el retrieval
  seguía funcionando offline con embeddings y reranker locales. Si alguna vez importa el
  modo offline (colegio con conexión mala), esto es lo primero a reponer: un embedder
  local detrás de `EMBEDDING_BASE_URL`.
- 🟢 **BASELINE VIGENTE — 2026-08-05, cascada arreglada (101 preguntas).**
  Es el primero que corre el MOTOR REAL: con `familyIds` (o sea las tres etapas de la
  cascada) y con generación de verdad. Contra este se compara.

  | métrica | valor | objetivo | |
  |---|---|---|---|
  | recall@5 | 88,0% | ≥90% | ❌ |
  | precision@gold | 71,1% | ≥80% | ❌ |
  | alucinación (modo libro, TASA) | **15,5%** | ≤2% | ❌ |
  | false_abstention | **1,3%** | ≤10% | ✅ |
  | false_book_claim | 4,2% | ≤2% | ❌ |
  | correct_mode | 62,5% | ≥90% | ❌ |

  Alcances servidos: 75 `curso` · 7 `otro_curso` · 6 `otra_materia` · 10 `ninguno`.
  Modos: 88 `libro` · 10 `general` · 2 `apoyado`.

  **Cómo leer estos números, que es más importante que los números:**

  · **El 15,5% es un TECHO, no una tasa.** Se auditaron 14 afirmaciones marcadas sin
    respaldo con 8 jueces independientes y un escéptico por cada acusación de invento:
    5 estaban en el material (el NLI se equivocó), 3 eran inferencias razonables, 3 las
    rescató el escéptico y **solo 3 eran inventos reales**. O sea ~79% es ruido del
    instrumento y la alucinación real ronda **2,6%**. Un mecanismo concreto del ruido:
    cuando el extractor declara un `chunkIndex`, el verificador mira SOLO ese chunk — 9
    de las 14 se juzgaron contra un único fragmento.
  · Y de los 3 reales, **uno no era alucinación sino fallo de retrieval**: el pasaje
    estaba TEXTUAL en el corpus, en el mismo libro y lección, y no se recuperó para esa
    pregunta. Apunta al recall, no al prompt.
  · **`correct_mode` 62,5% son 9 fallos y UN solo bug**, no nueve problemas: las nueve
    esperaban `general/ninguno` y las nueve respondieron con material que no contesta.
    Ver la entrada del discriminador más abajo.
  · `false_book_claim` 4,2% = una pregunta (q123, el near-miss de Sherlock).
  · ⛔ **`recall@5` NO es comparable con corridas anteriores al 2026-08-03**: cambió de
    definición. Antes se calculaba sobre las citas DESPUÉS del gate, así que relajar el
    gate lo subía solo, sin que el ranking hubiera mejorado en nada.

- 🔴 **EL INSTRUMENTO TENÍA TRES BUGS Y LOS TRES MEDÍAN UN MOTOR QUE NO EXISTÍA.**
  Vale la pena leerlo entero porque es un patrón, no tres accidentes.
  1. `recall@5` se calculaba sobre `citable` (post-gate) en vez de `retrieved`. Aflojar
     el gate mejoraba la métrica sola.
  2. `EVAL_HALLUCINATION=0` no apagaba al juez: apagaba **la generación entera**. La
     corrida del 2026-08-03 guardó `answer: ""` en las 101 preguntas y su
     `hallucination_rate: 0,0% ✅` significaba SIN MEDIR — el peor modo de fallar de una
     métrica de seguridad, porque se lee como un aprobado.
  3. El eval nunca pasaba `familyIds`, así que la etapa `otro_curso` **no corría jamás**
     y todo saltaba directo al listón de 0,50. El síntoma estaba a la vista (0 respuestas
     con alcance `otro_curso` en 101) y se leyó como "esta etapa no hace falta acá".
     Ese bug ESCONDÍA el bug de producción de la cascada (§1).
  Hoy el arranque del eval imprime curso y tamaño de familia y avisa si la etapa no va a
  correr. **Antes de creerle a una métrica, verificá que mida el motor que sirve al
  alumno.** Sigue pendiente lo mismo con `studentGrade`: el usuario del eval no tiene fila
  en `student_profiles`, así que la penalización por grado y el nivel de lectura del
  prompt **todavía no se ejercen**.

- 🔴 **`golden/a3-set.jsonl` ESTÁ MUERTO.** Los 60 claims etiquetados a mano conservan
  texto, etiqueta y fundamento, pero sus `chunk_id` no sobrevivieron a la reingesta:
  `a3-validate` reporta "60 triples con chunk_id inexistente" y evalúa **0**. Sin eso no
  hay forma barata de saber cuánto de cada corrida es ruido del NLI, y el objetivo ≤2% no
  se puede interpretar. Re-anclar por contenido, como hace `reanchor-golden.ts` con las
  preguntas. **Es lo que desbloquea creerle a los números.**

- 📐 **Contra qué se mide** (vale para el baseline vigente y para cualquier corrida nueva):
  materia `Lengua Y Literatura 8º` = el libro oficial del corpus (`texto del estudiante`,
  266 chunks) + sus 2 guías docentes (129 + 124). NO contra
  `Tomo_I_Lengua_y_Literatura8vo.pdf` (el macrotipo del Tomo I), que es lo que medían las
  corridas anteriores al 2026-07-31. Umbral `RERANK_MIN_SCORE=0.18`, prompt de producción
  (`TEACHING_SYSTEM` + `streamTeaching`), `Qwen/Qwen3.6-35B-A3B` con thinking off.
  `EVAL_USER_ID` / `EVAL_SUBJECT_ID` en el `.env` de la raíz.

  Baselines archivados en `packages/eval/baselines/`, uno por fecha. Los del 2026-08-04
  en adelante incluyen la respuesta generada de cada pregunta (`answer`), que es lo que
  permite RE-JUZGAR sin volver a pagar la generación — `claims-audit` vive de eso.

- 🟡 **`true_abstention` se retiró como objetivo.** El tutor ya no se abstiene por falta de
  material, así que por diseño va a ~0 y dejó de significar algo. Se sigue calculando para
  poder releer corridas viejas. La reemplazan `false_book_claim` y `correct_mode`.

- 🔴 **EL BASELINE ANTERIOR (133 preguntas) QUEDÓ OBSOLETO. NO LO COMPARES.**
  Los números `recall@5 66,3% · precision@gold 58,7% · hallucination_rate 46,2%
  (PROD 6,3%) · false_abstention 31,1% · true_abstention 100%` **ya no describen
  nada medible**. Se midieron contra un corpus que dejó de existir:
  1. El golden estaba anclado a `Tomo_I_Lengua_y_Literatura8vo.pdf`, que NO es el
     libro que se vende: es la transcripción **MACROTIPO** de la Biblioteca Central
     Para Ciegos (2024), y solo el **Tomo I** — Unidades 1 y 2 de 4. El libro
     oficial (`basica/8_básico/lengua_y_literatura/texto_del_estudiante.pdf`, 266
     chunks) cubre las 4 unidades. Es la misma edición (mismos autores, mismos
     códigos internos, misma errata "Wislawa Szmborska"), pero otro recorte.
  2. **32 de las 133 preguntas (24%)** estaban ancladas a `Apuntes de Matemática
     8vo`, un fixture escrito a mano de 8 chunks / 2,6 KB. Archivadas el
     2026-07-31 en `golden/golden-matematica-archivado.jsonl`.
  3. El corpus perdió 841 chunks el 2026-07-31 (3 duplicados de Ciencias Naturales
     1º + 4 cuadernos de ejercicios que estaban indexados como contenido citable).
     Ese último punto **cambia el retrieval de Lenguaje 3º y 4º**.
  El golden operativo quedó en **101 preguntas** y hay que re-medir desde cero. El
  original vive intacto en `golden/golden-macrotipo.jsonl` por si hace falta releer
  una corrida vieja — pero sus números NO son comparables con los nuevos.
- 🔵 **PISTA para el trabajo de retrieval — los ejercicios le ganan al libro.**
  Medido el 2026-07-31 con `match_chunks_lexical` sobre Lenguaje 3º, pregunta
  "escribir texto narrativo personajes": un chunk de CONSIGNA puntuó **0.0333** y
  el texto explicativo real **0.0042** — 8× más alto, primer lugar del ranking.
  Hipótesis: los chunks de ejercicio son CORTOS y comparten vocabulario con la
  pregunta del alumno (ambos están en registro de consigna), mientras la
  explicación del libro está en el registro expositivo del autor y comparte menos
  términos literales. El scoring premia el solapamiento léxico y la brevedad.
  **Es la misma forma que el recall@5 de 66,3% del golden**: la pregunta parafrasea
  y el pasaje correcto no comparte superficie. Los ejercicios ya salieron del
  índice (manifiesto, `indexado=no`), así que este caso puntual está tapado — pero
  el sesgo del scoring sigue vivo para todo el corpus. Sin perseguir por ahora.

  **Y lo peor: las dos poblaciones están SOLAPADAS.** Medido el 2026-07-31 contra
  `Lengua Y Literatura 8º`:

  | caso | qué es | topScore |
  |---|---|---|
  | q123 "¿qué se cuenta sobre Sherlock Holmes y su creador?" | IRRELEVANTE — el libro no lo menciona nunca (0 chunks con "Conan Doyle") | **0.5052** |
  | "¿diferencia entre quien cuenta la historia y quien la vive?" | LEGÍTIMA — es el narrador, tema central del libro | **0.007** |

  Una pregunta que debe abstenerse puntúa **70× más alto** que una legítima
  parafraseada. **El score no ordena por relevancia**, así que NINGÚN umbral
  separa bien las dos poblaciones: subirlo mata preguntas buenas, bajarlo deja
  pasar irrelevantes. **Mover el umbral no puede arreglar el recall.**
  El barrido 0.18 → 0.12 → 0.09 sigue valiendo como DATO (dice cuánto ruido entra
  por cada abstención recuperada) pero **no es la solución**: el problema está en
  cómo se calcula el score, no en dónde se pone el corte.

- 🔴 **LO QUE MÁS LE PEGA AL ALUMNO HOY: el score no distingue "lo cubre" de "habla del
  tema".** Es el mismo fenómeno de arriba, ahora medido sobre las 13 preguntas que la
  cascada respondió con material de fuera del libro del curso, con veredicto humano de si
  el material GENUINAMENTE contesta:

  ```
  cubiertas de verdad: 0.99  0.99  0.81  0.80  0.69  0.63
  ruido on-topic:      0.89  0.85  0.83  0.75  0.57  0.51
  ```

  Se solapan por completo: **ningún umbral las separa**. La causa es de diseño — el
  cross-encoder mide RELEVANCIA, no si el fragmento CONTESTA. Una ficha catalográfica que
  nombra "Cien años de soledad" es máximamente relevante a una pregunta sobre esa novela y
  no responde nada. Explica el **100%** de la brecha de `correct_mode`.

  **Candidatos medidos** (`pnpm --filter @tutor-ia/eval answerability`, 91 preguntas con
  material volcadas por `scope-audit --todas`):

  | señal | frena ruido | pierde material bueno |
  |---|---|---|
  | NLI con la pregunta como AFIRMACIÓN @0,91 | 7/8 | **0/6** |
  | juez de answerability (LLM) | 7/8 | 1/6 |
  | `rerankScore` (lo de hoy) | — | no separa |

  ⚠️ **Dos trampas de medición que costaron horas y conviene no repetir:**
  · Medir sobre las 91 daba "el NLI destroza el 52% del material bueno" — cierto e
    IRRELEVANTE: 77 de esas 91 son del libro del propio curso y **nunca pasarían por este
    filtro**. Un discriminador de la cascada gobierna `otro_curso` y `otra_materia`, nada
    más. Medir sobre la población equivocada enterró la señal.
  · La **accuracy no significa nada acá**: con 82 positivas y 9 negativas, decir que sí
    siempre da 90%. Por eso el reporte lleva al lado la tabla de costo en las dos
    direcciones. Sin ella el `rerankScore` "gana" con 92%.
  · Y el error propio: el NLI dio **100% sobre 13 puntos** y se derrumbó al ampliar. Era
    sobreajuste — se eligió el umbral sobre los mismos puntos con los que se medía.

  **Estado: NO cableado.** Son 14 puntos de evidencia, el mismo tamaño de muestra que ya
  engañó una vez. El paso siguiente es meterlo detrás de un flag (solo etapas cross-scope)
  y dejar que la corrida de 101 lo juzgue: si daña las `answerable` se ve en
  `false_abstention` y en `recall`.
- 🟡 **El nombre visible de la materia está ACOPLADO al título del documento.**
  `subjectNameFor()` (corpus-manifest.ts) alimenta a la vez `subjects.name` —lo que
  ve el alumno— y el prefijo de `titleFor()`, que es la clave con la que el
  ingestor decide si un documento ya está ingerido. Consecuencia: **cambiar el
  texto que ve el alumno dispara una re-ingesta**. Medido el 2026-07-31: poner
  "Sumo Primero (Matemática)" en vez de "Sumo Primero" llevaba el delta de 5 a 29
  documentos (807 chunks, ~10 min de embeddings) por un cambio puramente
  cosmético. Por eso quedó "Sumo Primero" a secas.
  Arreglarlo de verdad = que `titleFor` use una clave estable (materia_canonica +
  curso + archivo) independiente del nombre visible; eso cambia los 218 títulos
  una vez, así que conviene hacerlo junto con la próxima re-ingesta completa.
  NO parchear con un `UPDATE subjects set name=…`: una corrida futura del ingestor
  lo revierte en silencio.
- 🟡 **El tope de gasto NO es fiable en la web.** `budget.ts` es un contador a nivel de
  módulo pensado "por corrida" (scripts). En Next dev cada bundle de ruta tiene su
  instancia y el acumulado se reinicia al recompilar (observado: `acum` bajó de 5341 a
  1653). Sirve para el golden set; **no lo uses como freno de gasto del servidor**.
- 🟢 **RESUELTA — el segundo cliente de eval.** `packages/eval/src/ollama.ts` era un
  cliente propio cableado al motor local (`exp2`/`exp3`/`exp5` no respetaban
  `LLM_PROVIDER`). Se borró junto con esos experimentos: medían métricas nativas de
  Ollama (prefill, RAM) que la API remota no expone y que ya no hay cómo obtener. Todo
  lo que queda mide por el provider.
- 🟡 **Continuidad de tema**: `unit/lesson` solo viaja en el primer turno; un "no entendí"
  posterior vuelve al retrieval normal y puede abstenerse.
- 🟡 **Saturación intermitente del proveedor**: `Qwen/Qwen3.6-35B-A3B` dio 429
  `engine_overloaded` varias veces (el reintento lo salva a veces). Para eso está
  `LLM_BASE_URL` configurable.
- 🟡 **Materias sin GDD (18/73)**: funcionan solo con contenido, sin "qué se evalúa".
- 🟡 **Voz**: sin barge-in; VAD (`SPEECH_THRESH=6`, `SILENCE_MS=1200` en page.tsx) **nunca
  calibrado con micrófono real** (el sandbox lo bloquea; STT/TTS sí validados por curl).
- 🟢 **`EXAM_SCHEMA` no cumple strict** (2 violaciones) — intencional, exams parkeado.
- 🟢 **Eval pedagógico (exp6)** mide bien lo determinístico; lo subjetivo es ruidoso
  (juez = el mismo modelo que responde, n chico). No usarlo como veredicto.
- 🟢 **Producto**: auth stub mono-usuario; sin backup de DB; inyección de prompt vía PDF
  subido no considerada; nombres de materia con "Y" mayúscula (cosmético).

**Próximo con mejor retorno, en orden:**

1. **El discriminador de answerability** (entrada 🔴 de arriba). Es lo único que le cambia
   la experiencia al chico: hoy, preguntando algo fuera de su libro, tiene ~1 de 3 chances
   de recibir ruido con cara de respuesta. Hay candidato medido y falta cablearlo detrás de
   un flag y correr las 101.
2. **Re-anclar `a3-set.jsonl`**. Es lo que permite creerle a la alucinación después.
3. **Calibrar la deriva** con `drift-sweep` — el sello `apoyado` dispara 2 de 101 y nadie
   sabe si son las correctas. Los datos ya están guardados.
4. **Corrección factual del modo `general`** — 10 respuestas salen del conocimiento del
   modelo y NO están medidas. No se puede medir con groundedness (en modo `general` no hay
   material, así que da 100% "sin respaldo" por construcción, y se reporta como hueco
   declarado, no como cero). Necesita un juez de conocimiento del mundo sobre un set chico.
   Ojo con el precedente de la trutruca: "es como una trompeta larga de madera" es verdad
   en el mundo y falsa respecto del libro — en modo `general` el criterio correcto es el
   primero.
5. `rank-sweep` nunca corrió y las capturas siguen siendo de una sola materia. La
   penalización por grado (0,02/0,05), el umbral 0,50 y la regla de "seguir si quedó flojo"
   están puestas **a criterio**, no barridas.

Multiusuario real si se apunta a un colegio. El eje "correcto" NO conviene (medido en su
momento con `exp5`). Historia de fases previas en `docs/` — ojo que varias de esas fases se
midieron con el motor local, que ya no está en el proyecto.
