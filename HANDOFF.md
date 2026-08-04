# HANDOFF — Tutor IA (para retomar en un chat nuevo)

> Estado al **2026-07-30**. Corre en la Mac del usuario (**Apple M4, 16 GB**).
> Proyecto en `/Users/dusan/Documents/ia`. Rama `feat/bloques-aurora-plan-prueba`.
> **Leé también la memoria del proyecto** (`tutor-ia-estado.md` y las notas por feature).

---

## 1. Qué es

Tutor de estudio **local-first y privado**. **Facilitador del aprendizaje conceptual**:
explica los temas del material oficial con sus propias palabras y ejemplos, **cita la
fuente o lo dice**, verifica comprensión y **se adapta** si el alumno no entiende.

**NO resuelve ejercicios ni matemática/cálculo** — FUERA DE SCOPE. Medido (`exp5`): el 7B
lo tiene topado (grading ~78%, math ~75%) y el scaffolding no lo rescata. SymPy quedó solo
como verificación opcional (`grading.ts`/`sympy_check.py` parkeados).

**Arquitectura clave — RAG de DOBLE CORPUS TIPADO:** el material viene en pares por
materia/grado: **Texto del Estudiante** (`corpus_role='content'`, el "qué" citable) +
**Guía Didáctica del Docente / GDD** (`corpus_role='pedagogy'`, el "cómo": ideas_previas,
evaluacion, errores_frecuentes, proposito, habilidad, solucionario…, anclados al OA).
El link es por **OA + relevancia semántica**, NO por (unit,lesson) — TE y GDD numeran distinto.

> ⚠️ **Cambio de premisa (2026-07-30):** ya NO es necesariamente "100% local". La generación
> puede apuntar a una **API remota compatible con OpenAI** con una env var. Embeddings,
> reranker y NLI **siguen locales siempre**. Con `LLM_PROVIDER=ollama` (default) nada sale
> de la máquina.

---

## 2. Stack y servicios (CRÍTICO para arrancar)

```bash
cd /Users/dusan/Documents/ia
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"   # Postgres es keg-only

# 1) Postgres 17 (nativo, SIN Docker). Base 'tutor' con TODO ingestado.
brew services start postgresql@17
# psql "postgresql://localhost:5432/tutor" -tAc "select count(*) from chunks"  # ~30k

# 2) Ollama. Tags: qwen2.5:7b (NO -instruct), bge-m3.  ollama list
# 3) Sidecar reranker + NLI (ARRANCAR A MANO; sirve /rerank y /nli en :8790, MPS):
nohup ./packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py \
  > packages/ingest-py/rerank_server.log 2>&1 &
curl -s http://127.0.0.1:8790/health   # {"status":"ok"...}

# 4) Web. Desde Claude Code: preview_start {name:"web"}.
#    O: pnpm --filter @tutor-ia/web dev
```

**Voz (100% local):** `whisper.cpp` (brew `whisper-cpp` → `whisper-cli`) + modelo
`packages/ingest-py/whisper-models/ggml-base.bin` (gitignored, 141MB) para STT;
macOS `say` (voz Mónica) + `ffmpeg` para TTS. Todo instalado.

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
   de `launch.json`**: si quedaba ahí, con `LLM_PROVIDER=deepinfra` el provider remoto
   recibía el tag de Ollama (`qwen2.5:7b`) y devolvía 404.
3. `.env.example` decía `RERANK_MIN_SCORE=0.3` mientras el código usa **0.18** — copiarlo
   revertía el gate en silencio. Ya corregido.

`.gitignore` cubre `.env`, `.env.*` y exceptúa `.env.example`.

Datos no obvios: el reranker usa `transformers` directo (NO FlagEmbedding); Python del venv
es 3.14 (por eso la voz usa binarios, NO faster-whisper). `keep_alive:0` en Ollama por RAM
→ **es la causa de la latencia de ~2 min por turno local**.

---

## 3. Capa de proveedores de LLM (`packages/core/src/llm/`)

Toda la generación pasa por una interfaz `LLMProvider` con tres métodos
(`generate`, `generateStructured`, `generateStream`). `client.ts` quedó como **shim delgado**
→ los **13 call sites (en 8 archivos) no se tocaron**.

```
LLM_PROVIDER=ollama      # default, local
LLM_PROVIDER=deepinfra   # API remota compatible con OpenAI (LLM_BASE_URL apunta a cualquiera)
```

- **`OpenAICompatProvider`** sirve a cualquier API estilo OpenAI: `LLM_BASE_URL` +
  `LLM_API_KEY` (fallback `DEEPINFRA_API_KEY`). **Sin failover automático** a propósito:
  si un proveedor tira 429 tras los reintentos, falla con `LLMError` tipado, para saber
  qué proveedor produjo cada número.
- **Params canónicos idénticos** entre providers (`params.ts`): si se dejaran implícitos,
  DeepInfra usaría `temperature 1.0` contra el `0.1` local y el golden set dejaría de ser
  reproducible. `generateStructured` fuerza `temperature 0`.
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
- Se genera **en tandas de 5 lecciones**: con 14 ítems × 5 campos un 7B acorta,
  repite el título como punto y pierde el orden.
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

**Schemas y modo estricto** — `CLAIMS_SCHEMA` y el inline de `/api/test` **corregidos**
(pasan `strict:true`). `EXAM_SCHEMA` **sigue sin cumplir** a propósito (exams está parkeado);
el guard `strict-schema.ts` lo señala con la violación exacta en vez de un error opaco.

---

## 5. Comandos útiles

```bash
pnpm -r typecheck                                          # 5 paquetes
pnpm --filter @tutor-ia/eval llm-smoke                     # compara providers lado a lado
pnpm --filter @tutor-ia/eval llm-smoke -- --only=deepinfra
pnpm --filter @tutor-ia/eval llm-smoke -- --base-urls=https://api.deepinfra.com/v1/openai,https://api.scaleway.ai/v1
pnpm --filter @tutor-ia/eval batch-ingest [rootDir]        # ingesta (RESUMABLE); BATCH_DRY=1 = solo clasificar
pnpm --filter @tutor-ia/eval eval                          # golden set 133 (lento, background)
pnpm --filter @tutor-ia/eval exp6                          # eval pedagógico
pnpm --filter @tutor-ia/eval nli-validate                  # A3 relevancia vs NLI

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
packages/core/src/llm/               ← CAPA DE PROVEEDORES (nueva)
  types.ts            LLMProvider, LLMPrompt, LLMError, LLMUsage
  index.ts            getLLM() (factory por LLM_PROVIDER), makeProvider()
  ollama.ts           OllamaProvider (local, default; conserva sus timeouts)
  openai-compat.ts    OpenAICompatProvider (DeepInfra/Scaleway/Novita/…)
  params.ts           params canónicos idénticos entre providers + switches de reasoning
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
  nli.ts / rerank.ts    NLI direccional / gate del reranker
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
  llm-smoke.ts        comparación de proveedores (REASON/LEAK)
  ollama.ts           ⚠️ CLIENTE PROPIO, cableado a Ollama (exp2/exp3/exp5 NO usan el provider)
```

---

## 7. Deuda conocida / próximos pasos

- 🔴 **Latencia local ~2 min por turno** — `keep_alive:0` recarga el 7B en cada llamada.
  Es el peor problema de experiencia. Se resuelve con el provider remoto (medido: 1.4s vs
  8.3s) o subiendo `keep_alive` si hay RAM.
- 🟢 **PRIMER BASELINE VÁLIDO — 2026-07-31, golden re-anclado (101 preguntas).**
  Es el primero que mide lo que el alumno recibe. Contra este SÍ se compara.

  | métrica | valor | objetivo | |
  |---|---|---|---|
  | recall@5 | 82,6% | ≥90% | ❌ |
  | precision@gold | 68,1% | ≥80% | ❌ |
  | hallucination_rate (claims A2+A3) | 38,4% | ≤2% | ❌ |
  | hallucination_rate **PROD** (verify.ts) | **0,0%** (n=67) | — | — |
  | false_abstention | **1,3%** | ≤10% | ✅ |
  | true_abstention | **95,7%** | ≥95% | ✅ |

  **Contra qué se midió:** materia `Lengua Y Literatura 8º` = el libro oficial del
  corpus (`texto del estudiante`, 266 chunks) + sus 2 guías docentes (129 + 124).
  NO contra `Tomo_I_Lengua_y_Literatura8vo.pdf` (el macrotipo del Tomo I), que es
  lo que medían todas las corridas anteriores.
  Umbral `RERANK_MIN_SCORE=0.18`, prompt de producción (`TEACHING_SYSTEM` +
  `streamTeaching`), `Qwen/Qwen3.6-35B-A3B` con thinking off (`reason=0` en las
  148 llamadas), 928.135 tokens, 0 reintentos.
  Latencia p50 10,8s · p90 35,1s · max 954s. 3 preguntas EXCLUIDAS por timeout del
  reranker (q056, q095, q122) → el cómputo real es sobre 98, no 101.

  **Salvedades que hay que leer junto al número:**
  · El 38,4% de alucinación lo produce un juez que corre bajo `TUTOR_SYSTEM`, el
    prompt DEPRECADO. El verificador que ve el alumno (`verify.ts`) da 0,0%. Esa
    brecha de 38 puntos mide el juez, no al tutor.
  · `false_abstention` 1,3% = UNA pregunta (q016, adversarial por desfase de
    vocabulario, topScore 0.0279).
  · `true_abstention` 95,7% = 22/23. La que pasa es q123, un near-miss deliberado
    (el libro cubre el género policial pero nunca menciona a Sherlock Holmes):
    falla el GATE, no el etiquetado. Se deja como está a propósito.
  · Comparado con la corrida obsoleta de abajo, `false_abstention` cae de 31,1% a
    1,3% — pero eso NO es una mejora del sistema: es que antes se medía contra el
    libro equivocado.

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
- 🟡 **`packages/eval/src/ollama.ts` es un segundo cliente** cableado a Ollama: `exp2`,
  `exp3` y `exp5` **no** cambian con `LLM_PROVIDER`. `eval.ts` (golden set) **sí** usa el
  provider. Se dejó así a propósito: `exp3-latency` mide prefill con métricas nativas de
  Ollama que la API remota no expone.
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
  (juez = el propio 7B, n chico). No usarlo como veredicto.
- 🟢 **Producto**: auth stub mono-usuario; sin backup de DB; inyección de prompt vía PDF
  subido no considerada; nombres de materia con "Y" mayúscula (cosmético).

**Próximo con mejor retorno:** medir el golden set contra el proveedor remoto (ya está
todo el andamiaje: smoke, tope de gasto, params idénticos), o atacar la latencia local, o
multiusuario real si se apunta a un colegio. El eje "correcto" NO conviene (medido en exp5).
Historia de fases previas en `docs/`.
