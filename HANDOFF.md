# HANDOFF — Tutor IA (para retomar en un chat nuevo)

> Estado al **2026-08-24**. Corre en la Mac del usuario (**Apple M4, 16 GB**).
> Proyecto en `/Users/dusan/Documents/ia`. Rama **`main`**.
> **El código ya está en git remoto**: `github.com/Nachodusan/tutor-ia`, PRIVADO, `main` por
> defecto. El corpus NO está en git — va como asset de release
> (`corpus-2026-08-23`, 205 MB, verificado por sha256). Ver §8.
> **Leé también la memoria del proyecto** (`tutor-ia-estado.md` y las notas por feature).

---

## 1. Qué es

Tutor de estudio para el material oficial del alumno. **Facilitador del aprendizaje
conceptual**: explica los temas con sus propias palabras y ejemplos, **cita la fuente o
lo dice**, verifica comprensión y **se adapta** si el alumno no entiende.

**SÍ resuelve ejercicios, paso a paso y terminando la cuenta** (desde 2026-08-16).
Antes no: `exp5` lo había medido topado con el **7B local** (grading ~78%, math ~75%) y el
scaffolding no lo rescataba. Esa medición murió con el proveedor local — hoy corre
Qwen3.6-35B, que resuelve la batería de la escuela bien y verificada. La regla vieja
sobrevivía en la primera línea de `TEACHING_SYSTEM` ("No resuelves ejercicios por él ni
haces cálculos") y producía la falla que el alumno vive como "no me sirve": el tutor
planteaba el método y **se guardaba el resultado** (en `x²-5x+6=0`, 2 de 2 corridas
recitaban la fórmula general y nunca entregaban x=2 y x=3).

⚠️ **Falta la verificación.** El modelo resuelve bien la batería probada, pero nada
comprueba la aritmética: si se equivoca, el error sale con el mismo tono seguro. SymPy
sigue parkeado (`grading.ts`/`sympy_check.py`) y es el próximo paso (opción C).

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

**CURSOS CERRADOS: de 1º a 5º básico (2026-08-14)** — decisión de producto, no técnica:
la herramienta pide leer una respuesta larga y juzgarla, y eso a los 6-10 años no se da por
supuesto. Se abre cuando lo revise alguien que sepa de desarrollo infantil.
- La lista vive en **un solo lugar**: `apps/web/lib/cursos.ts` (`CURSOS_BLOQUEADOS`).
  Para abrir un curso se lo saca de ahí y listo; los alumnos que ya lo tengan en el perfil
  vuelven a entrar solos. El módulo es plano (sin `"use client"`, sin imports) justamente
  para que lo lean las dos mitades: la pantalla que dibuja el candado y la ruta que lo hace
  cumplir.
- **El corpus NO se toca.** Los libros de 1º a 5º siguen ingestados y siguen apareciendo en
  la cascada de alcance: que un chico de 8º reciba la explicación de fracciones del libro de
  5º es una función, no una fuga. Lo cerrado son los CURSOS (los alumnos), no el material.
- Tres capas, y las tres hacen falta: el onboarding muestra esos cursos **con candado**
  (esconderlos haría que un chico de 3º eligiera 6º y estudiara del libro equivocado),
  `PUT /api/me/profile` responde **403** si el curso llega igual, y
  `requireCursoAbierto()` (`lib/auth.ts`) cierra las rutas que sirven material: `/api/chat`,
  `/api/plan` (GET y POST), `/api/plan/custom` (GET y POST), `/api/test`,
  `/api/lesson/quiz`. Las de CORRECCIÓN no se tocaron: corrigen algo que la generación ya
  tuvo que entregar. Docente y admin pasan siempre — revisan, no estudian.
- Quien ya tenía uno de esos cursos (perfil viejo o puesto por el CLI) ve la pantalla
  `CursoCerrado` con las dos salidas honestas —cambiar de curso o salir— en vez de un panel
  vacío que dice "no hay material cargado", que además sería falso.
- El selector del panel del docente tampoco los ofrece: "3º Básico · 0 alumnos" solo se
  puede leer como "el colegio no lo inscribió".

**PANEL DEL ALUMNO: NAV LATERAL + "PARA REFORZAR" POR MATERIA (2026-08-14)**
- El panel pasó a `nav` a la izquierda + contenido a la derecha (`panel.tsx`, `NAV_CSS`).
  Es el único lugar del panel con CSS de verdad y no estilos en línea, porque la misma
  barra es **columna** en el computador y **tira horizontal** en el teléfono (≤880 px), y
  eso es una media query: medir la ventana en JS pinta primero el layout equivocado.
- El nav lleva **tres entradas**, no las materias una por una: `Tus materias`, `Reforzar`
  (con la cuenta de temas pendientes al costado) y `Repasá con tus apuntes`. Listar cada
  materia repetía lo que ya está en las tarjetas, tres centímetros a la derecha. Los apuntes
  van últimos: las dos primeras trabajan sobre el libro del curso —lo que el alumno tiene
  siempre—, esta arranca cuando él trae algo suyo.
- ⚠️ **`/apuntes` es una MAQUETA declarada**, no una pantalla a medio conectar: escanear la
  página y las CUATRO salidas (mapa conceptual · fichas de memoria · **entrenar con la IA** ·
  **grabación de repaso**) están dibujadas, con chapa "Maqueta" arriba y un aviso al tocar los
  botones. Se hizo así a propósito: una pantalla que se ve terminada y calla que es un dibujo
  termina con un chico subiendo la foto de su cuaderno y esperando un mapa que no va a llegar.
  Las vistas previas son dibujos (SVG/CSS), no datos de nadie. **Lo que falta no es "llamar a
  una API que ya está"**: el corpus no admite material del alumno —la ingesta es del libro del
  colegio—, así que esto necesita tubería nueva (foto → OCR → chunks propios).
  `/api/plan/custom` arma planes a medida, pero sobre el material del colegio, no sobre el
  cuaderno.
- La **grabación de repaso** es la única de las cuatro que no pide ojos (se escucha yendo al
  colegio), y la que menos infraestructura nueva necesita: el TTS ya existe y ya tiene catálogo
  de voces (`/api/voice/tts`, `voces.ts`). Lo que falta es el GUION —un resumen hablado, que no
  es el texto del apunte leído en voz alta— y guardar el audio en algún lado. La maqueta muestra
  la duración a propósito: en audio el largo es la primera pregunta, y un repaso de 40 minutos
  no se escucha nunca.
- Las tarjetas van en **4 o 2 columnas, nunca 3**: con `auto-fit` el ancho del panel da para
  tres y deja la cuarta huérfana abajo, que se lee como "esta última es otra cosa".
- **`/reforzar` es una PANTALLA propia** (`app/reforzar/page.tsx`), no una sección al pie del
  panel: mezclada ahí abajo, el que venía a reforzar tenía que pasar por arriba de todo lo
  demás para llegar. Sin ruta de API nueva — los temas débiles ya vienen en `/api/progress`.
- Los temas van **por materia y completos**. Antes era una lista plana ordenada por fallos, con
  tope de 6: Biología y Matemática se intercalaban, así que para saber qué pasaba en una materia
  había que saltear renglones ajenos, y el tope escondía justo lo que el alumno entra a buscar.
  Se murió `REVIEW_MAX`.
- **La pantalla contesta cuatro preguntas, en orden** (rediseño 2026-08-15, porque la versión
  acordeón "estaba muy fea y mal organizada" y un chico se perdía): *¿cuánto me falta?* → el
  número grande arriba; *¿por dónde empiezo?* → UNA tarjeta con el tema más fallado y su botón;
  *¿qué más?* → el resto agrupado en tarjetas por materia, con la cabecera pintada de su color;
  *¿y lo que no aparece?* → las materias al día, en chips verdes al pie.
- **Murió el acordeón.** Las cinco materias se veían iguales —cuatro decían "Al día" y no se
  abrían, una sí— y había que adivinar dónde tocar; además escondía justo lo que el chico venía
  a buscar. Ahora no hay nada plegado. El renglón ENTERO es el botón: una chapa "Reforzar"
  adentro de otro botón invita a apuntarle a la chapa (con eso murió `WeakCard`).
- Están **TODAS las materias del curso**: las que no tienen nada aparecen como chips "al día",
  porque si la materia desaparece no se puede distinguir "está bien" de "el tutor no la conoce"
  — pero como chip y no como fila, que no compiten con lo que sí hay que hacer.
- ⚠️ **Dos bugs del probador de voces (2026-08-15), los dos de la misma familia: algo que se
  ve pero no funciona.**
  1. **Los cinco botones "Probar" sonaban con la MISMA voz** — la guardada en el perfil. La
     ruta dejó de leer `voz` del cuerpo cuando la voz se mudó al perfil (bien: así ninguna
     cadena del navegador llega a un argumento de `say` ni a una URL de inferencia), pero el
     cliente siguió mandando el campo y nadie se enteró de que lo ignoraban. Un probador que
     suena siempre igual es peor que ninguno: hace elegir a ciegas creyendo que no. Ahora la
     ruta acepta `probar`, que es una **clave en la lista blanca** (`buscarVoz`), no un valor:
     lo desconocido cae en la voz por defecto y no toca el perfil. Verificado con ids basura
     (`"; touch /tmp/pwned; #`) — caen en la de defecto y nada llega al shell.
  2. **El modal de voces quedaba DEBAJO de las tarjetas de materia.** Lo abre el nav, que vive
     dentro de `.pnl-aside`, y ese aside es `position: sticky` — **sticky crea un contexto de
     apilamiento aunque su `z-index` sea `auto`**, así que el `z-index: 60` del modal solo
     competía adentro del aside y las tarjetas (posteriores en el DOM y `position: relative`)
     le pintaban encima. Subir el z-index no arregla nada: el techo lo pone el ancestro. Va en
     un **portal al `body`**. Regla para el próximo modal que cuelgue del nav: portal, o se
     repite.
     ⚠️ Ojo al medir esto: el TTS remoto **no es determinista** —dos llamadas idénticas
     devuelven bytes distintos—, así que comparar md5 no prueba nada. Lo que sí distingue es
     el MOTOR: las voces del catálogo devuelven `audio/mpeg` y la del sistema, WAV.
- ⚠️ **EL NOMBRE LLEVA SU CURSO CUANDO NO ES EL DEL ALUMNO.** `subjectLabel()` le corta el curso
  al nombre ("Biología 1º Medio" → "Biología"), así que un alumno de 2º Medio veía **"Biología ·
  Al día"** arriba (la suya) y **"Biología · 9 temas"** abajo (la de 1º, donde había rendido):
  la misma palabra diciendo dos cosas opuestas en la misma pantalla. Son dos materias distintas
  y ahora se ve. Por lo mismo el resumen ya NO dice "y las otras N están al día": las que tienen
  temas pueden ser de otro curso, y esa suma no cerraba con ninguna lista de la pantalla.
- ⚠️ El contador del nav va como **hermano** de la etiqueta, no adentro del `span` del texto:
  ahí adentro su `margin-left: auto` no hacía nada y se leía "Reforzar(9)", pegado.
- **El pie del nav son DOS renglones: `Configuración` y `Salir`** (2026-08-16). Antes eran tres
  —"Voz del tutor", "Mi curso", "Salir"— y los dos primeros son la misma cosa: preferencias de
  la cuenta. Ahora viven adentro de un modal (`Configuracion`), con el curso arriba diciendo en
  cuál está (cambiarlo a ciegas desde un renglón que solo decía "Mi curso" era fácil de hacer
  sin querer) y la voz con su botón de Probar debajo. El AVATAR no está ahí: vive en el perfil,
  con los logros, porque no es un ajuste — es su cara.
- **"Salir" usa una PUERTA** (`IconPuerta`), no las dos flechas en círculo (`IconSwap`). Ese
  ícono venía de cuando la acción era "cambiar de alumno" en una sala compartida, y se leía
  como "recargar" o "intercambiar". `IconSwap` sigue vivo en la pantalla de curso cerrado, que
  sí ofrece cambiar.
- Con el nav en dos pantallas aparecieron tres piezas compartidas en `panel.tsx`: `PanelShell`
  (el marco), `PanelNav` (que sabe sola dónde está parada con `usePathname`, así que sumar una
  pantalla no obliga a pasarle un `activo` desde cada una) y `agruparReforzar`. La carga de
  datos del alumno salió a `useAlumno()` (`app/usar-alumno.ts`): copiar ese bloque cuesta que
  la copia se olvide del 401 y deje a alguien sin sesión mirando una pantalla vacía.
- "Mi curso" desde otra pantalla entra por `/?editar=1` (el panel lo lee del `location` y
  limpia la URL: si queda, el "atrás" del navegador vuelve a preguntarle el curso).

**TECLADO DE MATEMÁTICA en el chat (2026-08-16)** (`app/teclado-mate.tsx`) — un botón de
calculadora **a la izquierda del campo** (es parte de escribir, no de mandar), **solo en
Matemática** (`esMatematica()`, por nombre y no por id: hay una materia de matemática por
curso). Adentro: el visor y una grilla de símbolos (√, x², xⁿ, a/b, π, ÷, ≤…).
- **VISOR arriba de las pestañas**, estilo Mathway: dibuja la expresión con los exponentes en
  alto (`x^2` → x²) y el cursor a la vista, para revisar los paréntesis antes de mandar. Es
  DIBUJO, no interpretación: no evalúa ni reordena, y el texto que viaja es el que se ve.
- **Se puede corregir**: todo se inserta EN EL CURSOR, no al final, así que tocar entre dos
  caracteres del campo y seguir escribiendo alcanza para cambiar un `x^3` por `x^2` sin borrar
  lo de atrás. Hubo una fila de controles (◀ ▶ ⌫ · Borrar todo) y se sacó a pedido: duplicaba
  lo que el teclado del aparato ya hace. ⚠️ En el teléfono eso implica abrir el teclado nativo
  para borrar, que puede tapar el panel — si molesta, el candidato a volver es solo el ⌫.
- Se sacó también una pestaña "Cómo preguntar" con arranques de pregunta: escribía la oración
  por el chico y convertía un teclado en un formulario.
- ⚠️ El cursor se aplica en un `useEffect` tras el render, con una marca (`cursorPendiente`).
  Con `requestAnimationFrame` desde el handler el rAF podía correr ANTES de que React
  confirmara el value: el `setSelectionRange` caía sobre el texto viejo y el navegador mandaba
  el cursor al final — tocabas √ y quedaba FUERA del paréntesis, justo lo contrario de lo que
  la tecla quiere. Se aplica solo lo que pidió el teclado, para no pisar al chico cuando
  selecciona texto con el mouse.
- ⚠️ **NO CALCULA, y hay que mantenerlo así — pero por UNA razón, no dos.** No tiene "=" que
  resuelva ni muestra resultado. La razón vieja ("el tutor no resuelve cálculo, es scope
  declarado") **caducó**: desde 2026-08-16 el tutor sí resuelve (§1). La que queda es la
  buena: un número que aparece solo en el visor, sin procedimiento y sin nadie que lo
  explique, es justo lo que el chico no necesita — el resultado se lo da el TUTOR al final de
  una explicación. El teclado ataca el problema de ENTRADA —escribir matemática en un teléfono
  es un castigo y el retrieval recibe "raiz de x al cuadrado mas 9"—, no el de resolución.

**REPASO DE HOY — /reforzar es una SESIÓN, no un inventario (2026-08-16)**
(`schema_repaso.sql`, `lib/repaso.ts`, `/api/reforzar/hoy`, `app/reforzar/page.tsx`)
- Tres temas por día en vez de la deuda entera. El diseño salió de cuatro propuestas y se
  resolvió con seis agentes en paralelo; tres de sus respuestas corrigieron la versión inicial.
- ⚠️ **PREREQUISITO QUE ERA UN BUG SERIO.** `/api/lesson/quiz/submit` sacaba el tema de refuerzo
  solo con `wrong.length === 0`, o sea PUNTAJE PERFECTO — y el chequeo **no son 3 preguntas sino
  10** (el comentario que decía tres quedó viejo). Un 9 de 10 dejaba el tema en la lista Y le
  sumaba un `misses`: repasar y casi acertar EMPUJABA el tema arriba del ranking. Encima ese
  mismo 9 de 10 pintaba el nodo VERDE en el camino — el tema quedaba aprobado y "para reforzar"
  a la vez. Ahora usa `aprobado()` (dos tercios), igual que `/api/test/submit`. Verificado de
  punta a punta: 9/10 cierra el tema.
- **El medidor cuenta lo INTENTADO, no lo aprobado** (`done_at` vs `passed`, dos columnas). Si
  contara aciertos, el chico que estudia media hora y no aprueba mira "0 de 3" — el "estudié y
  no me sirvió" que la pantalla existe para matar. Verificado: con un tema aprobado y otro
  fallado dice **2 de 3**.
- **Los tres huecos, con criterios distintos**: CERRABLE (menos fallos) · TRABADO (más fallos) ·
  FRESCO (más reciente), tope de 2 por materia. ⚠️ NO es "los tres más fallados": medido, 25 de
  38 filas de `student_weak_topics` tienen 1 solo fallo y todos los temas de cada alumno nacen
  la misma tarde — ordenar por `misses`/`last_at` es azar disfrazado de prioridad.
- **Se guarda, no se deriva**: aprobar BORRA la fila de `student_weak_topics`, así que "cuáles
  eran los tres de hoy" sería irreconstruible apenas cierra el primero y el medidor diría
  "1 de 3" para siempre. El día va en zona `America/Santiago`: en UTC rotaría a las 21:00 de
  Chile, en pleno horario de estudio.
- **Solo se ofrecen temas CERRABLES**: el candidato tiene que existir en el plan actual. Al
  regenerar el camino cambian las claves y quedan temas huérfanos que no se pueden cerrar ni
  haciendo todo bien (2 de 9 en esta base, y uno era el MÁS fallado). Siguen visibles en "ver
  todo lo que te falta", donde el chat igual los explica.
- Sin rachas, sin días seguidos, y **el contador de fallos no se le muestra al chico**: se usa
  para elegir, no para exhibir.

**LA TARJETA DE MATERIA: TRES ACCESOS Y NADA MÁS (2026-08-15)** — el cuerpo abre el **chat**,
y abajo quedan **Camino** y **Prueba**. Antes eran tres botones al pie *más* el cuerpo llevando
al camino: el camino tenía dos puertas y preguntar una, escondida entre las tres chiquitas.
Preguntar es lo más frecuente (una duda), así que se lleva el gesto más grande.
- Se fueron de la tarjeta la **barra de avance** ("3 de 6 temas · 50% · ¡Completo!") y la línea
  con el orbe que decía "Preguntale lo que quieras". La tarjeta es un ACCESO, no un tablero: el
  avance sigue donde se puede hacer algo con él —adentro del camino, grande y arriba de todo— y
  en el panel del docente. Quedan el nombre, las chapas que piden acción ("2 para reforzar", la
  última nota) y los dos botones.
- `planTotal` se sigue leyendo aunque ya no se dibuje: es lo que apaga "Camino" cuando el libro
  no dio un índice legible.
- Las chapas van con `margin-top: auto`, así se alinean al pie del cuerpo y los botones de toda
  la fila quedan a la misma altura aunque un título ocupe dos líneas.
⚠️ El encabezado DENTRO de una materia (`materia/[id]/layout.tsx`) conserva las tres
actividades: ahí sí hace falta, o desde el camino no habría forma de llegar al chat.

**PERFIL DEL ALUMNO** (`/perfil`, `schema_avatar.sql`, `avatares.ts`, `logros.ts`) — se entra
tocando la identidad del nav, y tiene DOS cosas: sus logros y su avatar.
- **El avatar es lo único personalizable de la cuenta, y eso es el diseño, no una carencia.**
  Las cuentas son de menores y son anónimas: no hay nombre, no hay foto, y no las va a haber
  (una foto es el dato personal más obvio que existe). Pero una cuenta que no se puede tocar en
  nada tampoco se siente propia a los 12 años. Un bicho elegido a mano alcanza.
- Se guarda un **ID DEL CATÁLOGO**, igual que las voces y por lo mismo: es la lista blanca. Lo
  que no está en `avatares.ts` se ignora en silencio (probado con `<img src=x onerror=…>`, un
  emoji fuera del catálogo y un id inventado: los tres dejan el avatar anterior). Sin caras
  humanas ni banderas en el catálogo — nada que se parezca a decir quién sos o de dónde.
- **Los logros salen de datos REALES** (`/api/progress` + el perfil), no de una tabla nueva ni
  de un mockup: lecciones hechas, materia al 50%/100%, primera prueba, prueba perfecta, sin
  pendientes y primer bloque de reloj. Si mañana se quiere una racha de días, hay que EMPEZAR a
  guardar los días — un trofeo que se desbloquea solo, o que nunca se desbloquea porque nadie
  mide lo que promete, enseña que los trofeos no significan nada. Los que faltan se muestran
  apagados y con la condición escrita: el que no se ve no motiva a nadie.
  ⚠️ "Sin pendientes" exige **una prueba rendida** además de cero temas débiles; sin eso sería
  un trofeo por no haber hecho nunca nada.
- Las **lecciones hechas** del encabezado se cuentan sobre TODAS las materias, igual que los
  logros. Contándolas solo del curso, un alumno que rindió en otro curso veía "0 lecciones" al
  lado de un "Primer paso ✓" ganado — dos números de la misma pantalla contradiciéndose.
- ⚠️ **Cada cosa se dice UNA vez.** El nav (que es el botón al perfil) tiene el usuario y el
  curso; el saludo del panel dejó de repetirlos y pasó a ser "¡Hola! 👋 · Tenés N materias para
  estudiar". Antes decía "Hola, 7b-01 👋 / 2° Medio · 6 materias" con el nav mostrando "7b-01 /
  2° Medio" tres centímetros a la izquierda.

**RELOJ DE ESTUDIO / POMODORO** (`schema_pomodoro.sql`, `app/pomodoro.tsx`,
`lib/pomodoro.ts`) — el alumno elige cuánto estudia de corrido, cuánto descansa y a qué
hora se sienta; el panel le recuerda y el reloj lo corta.
- **Montado en el layout RAÍZ** (`PomodoroProvider`), no en el panel: se arranca el bloque
  en el panel y a los diez segundos el chico está en el chat de Biología. Colgado de una
  página, el descanso se perdería en la primera navegación.
- El tiempo se calcula con **marcas de fin** (`finEn`, epoch ms) en `localStorage`, no
  restando un contador por tick: el navegador ralentiza los `setInterval` de las pestañas en
  segundo plano —que es exactamente donde está la pestaña cuando el chico fue a buscar
  agua— y un contador propio atrasaría minutos.
- Lo que SÍ va a la base es la **configuración** (`pomo_estudio_min`, `pomo_descanso_min`,
  `pomo_hora`, `pomo_dias`) y `pomo_last_at`. La config va al perfil por lo mismo que
  `tts_voice`: en una sala de computación treinta chicos comparten el navegador. El
  segundero no va: serían 3.600 escrituras por hora por alumno.
- `pomo_hora` es **texto "HH:MM"**, no `time`: es hora de reloj de pared en la casa del
  chico, y la comparación con "ahora" la hace el navegador, no el servidor (que puede estar
  en otra zona). `pomo_dias` son dígitos ISO pegados (`"12345"` = L a V).
- El estudio pasa **solo** al descanso; el descanso **no** pasa solo al estudio (el que
  vuelve del baño se encontraría con el descanso ya gastado). El aviso de fase es un modal
  a propósito: interrumpir es lo que se le pidió al reloj.
- **El reloj flota arriba a la derecha, en TODAS las pantallas del alumno** (`RelojFlotante`,
  dentro del provider). Antes era un chip en dos encabezados más una tarjeta en el panel:
  tres piezas para una idea, y el reloj desaparecía justo donde más falta hace —adentro de
  la prueba, que no tenía ni chip ni tarjeta—. Cerrado es un anillo SVG que se vacía (el
  tiempo se lee sin leer números); abierto es el tablero: arrancar, pausar, saltar de fase,
  terminar y ajustar la rutina. En el login y en `/docente` no aparece.
- ⚠️ Un elemento `fixed` **no empuja a nadie**: los encabezados que tienen algo propio arriba
  a la derecha le reservan el lugar con la clase `CLASE_HUECO_RELOJ`. Y ese padding tiene que
  ir en **longhand** (`paddingLeft`, no el atajo `padding`), porque el estilo en línea le gana
  a la hoja de estilos — con el atajo, el reloj se sentaba encima del botón de "Prueba" en el
  teléfono. Bajo 560 px el reloj se queda **solo con el anillo**: en el encabezado de la
  materia, el mm:ss dejaba el título del libro en "Ciencia…".
- Migración: `psql "$DATABASE_URL" -f packages/db/schema_pomodoro.sql` (idempotente; ya
  está en `scripts/setup-local.sh`).

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

# LO QUE TARDA VA POR ACÁ. Lanzarlo con `nohup … &` y esperar con
# `until [ -f marcador ]` se cuelga: el productor puede morir sin escribir el
# marcador, y un `pgrep -f <patrón>` ENCUENTRA AL PROPIO VIGÍA. Pasó 4 veces en
# una sesión, una de ellas 11 horas. Ver packages/eval/README.md.
scripts/tarea.sh guarda pnpm --filter @tutor-ia/eval retrieval-guard
scripts/esperar.sh guarda --tope-min 15   # 0-N=terminó · 3=murió · 4=tope · 5=no se lanzó
tail -f .tareas/guarda.log
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

Libros: `/Users/dusan/Documents/libros/{basica,media}/<grado>/<materia>/*.pdf`. La
clasificación la fija `packages/eval/corpus-manifest.csv` (columnas `tipo` e `indexado`):
285 filas = 93 contenido + 125 pedagogía (los 218 que se ingieren) + 67 ejercicios
(`indexado=no`, no entran). Disco y manifiesto tienen que coincidir o la ingesta aborta.
El regex por nombre de archivo que había acá lo reemplazó el manifiesto en el commit
26cbf28: metía cuadernos como contenido citable y perdía 4 teacher's_book.

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
| 3 | ✅ **HECHO** — Backfill `heading_path` desde `book_sections` | 7.250 chunks (43,8%) · 17-18 de 18 citas correctas | — |
| 4 | ⛔ **MEDIDO Y RECHAZADO** — `get_text("blocks")` en Lengua 8º TE | cobertura 90,5% → 72,4% | **abortado**: revertido y corpus restaurado |
| 5 | ~~Rollout a los 93 documentos~~ | — | **cancelado**: el paso 4 no pasó su puerta |

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

### 🎯 DÓNDE ESTÁ LA BRECHA DE RECALL (medido 2026-08-06)

Con `retrieval-guard --gold` (72 preguntas, minutos, sin generación):

| | valor | qué dice |
|---|---|---|
| recall@5 | 88,0% | lo que le llega al alumno |
| **recall@TODO (k=25)** | **95,3%** | el material que el retrieval SÍ trae |
| recall por cobertura | 90,5% | fracción del pasaje dentro del top-5 |

**De los 12 puntos que faltan, ~7,3 son de ORDEN y ~4,7 de recuperación.** El
material llega y el cross-encoder lo hunde por debajo del puesto 5. Eso contradice
la narrativa con la que arrancó esta fase ("la ingesta le quitó la estructura, hay
que re-chunkear") y es coherente con lo que §7 ya documentaba por otro lado: el
score del CE **no ordena por relevancia** (q123 Sherlock 0,5052 contra una
pregunta legítima en 0,007).

**Descartado por medición directa:** duplicar el pool de candidatos (25 → 60, en
los dos brazos y en el cross-encoder) da resultados IDÉNTICOS al decimal. El
material que falta no está entre los candidatos 26 y 60.

**BARRIDO DE ORDENAMIENTO (2026-08-06) — la estrategia actual ya es la mejor.**
Las cinco estrategias implementadas, sobre las 72 con ancla:

| estrategia | recall@5 | precision@gold | cobertura |
|---|---|---|---|
| **`ce` (actual)** | **88,0%** | 71,1% | **90,5%** |
| `linear:0.3:minmax` | 87,3% | 71,8% | 90,2% |
| `rrf_then_ce:10` | 84,5% | 70,4% | 87,9% |
| `linear:0.5:minmax` | 84,3% | 68,5% | 87,2% |
| `rrf` | 79,6% | 58,6% | 83,3% |

Ninguna supera a `ce`. `linear:0.3` empata dentro del ruido (mejor precisión por
0,7 pts, peor recall por 0,7). **Mezclar el RRF con el cross-encoder no ayuda: el
CE solo ya extrae toda la señal que hay.**

**Y el truncado tampoco es la causa:** solo 10 de 266 chunks del libro del golden
superan los 512 tokens del reranker (3,8%). No puede explicar 7,3 puntos.

**Conclusión: se agotó el espacio de AJUSTE.** Los tres candidatos que quedaban
—pool más grande, otra estrategia de ordenamiento, la ventana del CE— están
medidos y descartados. Los 7,3 puntos de brecha por orden son del cross-encoder
mismo: `bge-reranker-v2-m3` no ordena bien las preguntas parafraseadas, que es el
caso normal de un chico. Mejorar eso ya no es configurar lo que hay sino cambiar
el componente: otro reranker, expansión de consulta (HyDE), o afinar el actual con
el golden. Cualquiera de las tres es un proyecto con su propia hipótesis, no un
barrido.

---

**Estado del paso 4 (2026-08-06) — RECHAZADO, y es el resultado más útil de la
fase.** La premisa era que el chunker corre ciego (`clean.ts` ve 1 párrafo por
página cuando la página tiene 15-26 bloques visuales) y que emitir esos bloques
separados dejaría cortar en frontera semántica. Se implementó, se re-ingestó
Lengua 8º TE en los dos modos y se midió:

| | plano | bloques |
|---|---|---|
| recall@5 (por chunk_id) | 88,0% | 58,3% |
| **recall por COBERTURA** | **90,5%** | **72,4%** |
| correct_mode | 21/24 | 21/24 |

⚠️ **La primera fila sola no permitía decidir**, y ese fue el aprendizaje de
método: al partir más fino, el pasaje gold pasó de vivir en 1,69 chunks a 3,69, o
sea que acertar "todo el gold" en los mismos 5 slots del top-5 se vuelve
mecánicamente más difícil — `recall@5` puede caer aunque el retrieval haya
mejorado. Es la misma trampa que §7 marca para las corridas anteriores al 03-08.
Por eso se construyó `recallPorCobertura`: mide qué fracción de los 4-gramas del
PASAJE quedó dentro de lo recuperado, y da lo mismo si está en un chunk o en
cinco. Esa métrica también cae 18 puntos → la regresión es real.

Tampoco fue pérdida de texto: -0,92% de caracteres con **0 palabras únicas
perdidas**. La causa más probable es que los bloques crudos de PyMuPDF no son la
estructura que uno supone — el orden de lectura (y,x) intercala columnas que el
orden interno del PDF mantenía separadas, y las etiquetas de un diagrama quedan
pegadas a la prosa siguiente. El chunk mezcla MÁS, no menos.

`EXTRACT_BLOCKS` queda con default 0. El código se conserva: la idea de cortar por
estructura sigue en pie, lo que falló es usar los bloques crudos como esa
estructura. Un intento futuro tiene que agrupar por columna y proximidad
tipográfica ANTES de emitir, y volver a correr este mismo A/B.

**Efecto colateral que sí vale:** la ida y vuelta fueron dos re-ingestas reales, y
el uuid del documento, sus 18 secciones y las 94 filas de progreso sobrevivieron a
las dos. El desacople del paso 1 quedó probado en producción, no solo en una
transacción de prueba. Y `INGEST_SOLO=<substring>` permite re-ingerir un libro sin
tocar los otros 217.

**Estado del paso 3 (2026-08-06).** 7.250 chunks de contenido con `heading_path`
(43,8%). La cita pasó de "Biología · 1º Medio · pág. 136" a "…· ¿Qué funciones
cumple el sistema nervioso y cómo las realiza?". Solo se etiqueta con secciones de
nivel 2 y span ≤20 páginas: los 2.899 que caen en secciones gigantes quedan en
NULL a propósito —una "lección" de 60 páginas es el parser fallando, y un
breadcrumb equivocado convierte un fallo de retrieval en una cita con cara de
correcta—, y 3.215 son de los 47 libros sin índice. El texto del chunk no se tocó,
así que ni los embeddings ni `content_tsv` cambian.

Regenerable e idempotente: `pnpm --filter @tutor-ia/eval backfill-heading-path`
(el `--aplicar` solo escribe donde hoy hay NULL).

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

## 6.d.1 EL CAMINO: MONEDAS + seis bugs de la era unidades (2026-08-14)

Rediseño de los puntos de lección y, al tirar del hilo, SEIS BUGS reales de la
transición a unidades que estaban tapándose entre sí (los tres primeros aparecieron
al implementar; los tres últimos los encontró una revisión adversarial multi-agente
del diff y se verificaron contra el código antes de arreglarlos):

1. **Tocar un punto de lección daba "No encontré esa lección"** — SIEMPRE. La página
   `materia/[id]/camino/[tema]` buscaba la clave solo en el nivel de arriba del plan, y
   con unidades las claves de lección viven anidadas en `item.lecciones`. Ahora aplana
   (`pasos`) con la misma forma que arma el camino al abrir una moneda, y "Seguir con la
   siguiente" recorre la lista aplanada (la próxima lección real, no el próximo nodo).
2. **"Estás acá" y el sendero pintado se quedaban clavados en cero** aunque el chico
   terminara unidades: `actual` y `hechasSeguidas` miraban `done.includes(unit.key)`, y
   la clave de una UNIDAD no se marca nunca (el progreso se guarda por lección). Los dos
   usan ahora la regla `nodoHecho` (unidad hecha = todas sus lecciones hechas).
3. **Los nodos de unidad quedaban DESPEGADOS del sendero** (el camino pasaba lejos de sus
   círculos): la X del nodo iba dentro de `transform: translate(calc(-50% + Xpx))` y el
   nodo tiene `transition: transform` — Chromium no interpola entre dos `calc()` con % y
   px mezclados y **deja el valor viejo para siempre**, así que al crecer la amplitud
   elástica (ResizeObserver) el sendero/monedas se estiraban y los nodos no. La X vive
   ahora en `left:`, que no está en la transición. ⚠️ Regla para el futuro: nada elástico
   adentro de un `transform` que tenga transición.
4. **El rombo de examen no se desbloqueaba NUNCA en planes por unidades**: `listo` miraba
   `done.includes(unidad.key)`, clave que no se marca. Ahora usa `nodoHecho(b) ||
   done.includes(b.key)` — la regla de lecciones, más el quiz de la unidad entera (nodo
   grande), que sí escribe la clave de la unidad. Verificado en vivo: con las 5 primeras
   unidades completas el rombo se enciende.
5. **Toda unidad terminada se pintaba ÁMBAR** ("le fue mal") aunque el chico acertara
   todo: la nota se buscaba con la clave de la unidad (`scores[item.key]`) y las notas
   viven por lección. La nota de una unidad es ahora la SUMA de las de sus lecciones, y
   la chapa muestra el agregado ("15/15").
6. **Rendir el quiz del nodo grande decía "Era la última lección del camino 🎉" en
   plena unidad 2 de 10**: la clave de la unidad no está en la lista aplanada `pasos`,
   así que `siguiente` quedaba undefined. Para una clave de unidad, `siguiente` es su
   primera lección. (Ojo con el arreglo obvio: devolver `j - 1` como índice rompe en la
   PRIMERA unidad, donde `j = 0` y `-1` es el centinela de "no está".)

También del sweep: el rombo decía "Prueba · lecciones 1 a 5" cuando las paradas
numeradas son UNIDADES — el sustantivo ahora sigue a `hayUnidades`, igual que el
encabezado.

El rediseño en sí (`camino.tsx`):
- Los puntos de lección son **MONEDAS de 24 px, numeradas**, con borde de tinta y un aro
  blanco (`box-shadow`) que las despega de las huellas. Con 14 px lisos medían lo mismo
  que las huellas del sendero y no se distinguía qué se tocaba. El número las ata al
  "2 de 4 **lecciones**" de la etiqueta (antes decía "2 de 4" pelado).
- La **próxima lección late en cobalto** (`caminoPulsoChico`), mismo lenguaje que el nodo
  actual. El aro va repetido DENTRO del keyframe: la animación pisa el box-shadow.
- **El paso vertical dejó de ser fijo**: cada tramo mide lo que su carga pide
  (`largoTramo`; una unidad de 9 lecciones estira su tramo). Todo el posicionamiento
  sale del arreglo `ys[]`; `sendero` y `puntoEnTramo` lo reciben.
- `tMoneda()` es LA ÚNICA fuente de dónde cae cada moneda: la usan el dibujo y el
  **sendero pintado**, que ahora avanza **moneda a moneda** (`senderoHecho`: tramos de
  las unidades completas + parcial hasta la última moneda hecha de corrido, muestreado
  como polilínea de 16 puntos sobre la misma Bézier).
- Las monedas se ubican por **índice de parada (`k`), no de ítem (`p.i`)**: con exámenes
  intercalados se desfasan y las unidades post-examen colgaban sus monedas del tramo
  equivocado.
- Las huellas del sendero por venir se achicaron (17/10 → 11/6): son piso, no botones.

## 6.d EL CAMINO POR UNIDADES (2026-08-13) — qué cambió

El camino del alumno pasó de ser una lista de **lecciones** a ser un recorrido de
**unidades con las lecciones adentro** como puntos de control. La razón es de producto:
la unidad engloba más y cada nodo da para enseñar de verdad, en vez de ser un título
suelto.

**Los índices NO se tocaron.** Las 1696 lecciones siguen en `book_sections` nivel 2,
intactas, porque son la granularidad fina que después se cruza con las bases curriculares
del estado. Todo lo nuevo se agregó en nivel 1.

### Cómo se arma una unidad

`buildUnitsForDocument` (`packages/rag/src/sections.ts`) calcula las DOS vías y se queda
con la que produce más unidades:

1. **Con índice** — a cada lección se le asigna su unidad por mayoría de `chunks.unit` en
   su rango de páginas, y se agrupan las **corridas consecutivas**. Por corridas y no por
   número: Biología es un tomo de 1º Y 2º medio y numera `1,2,3,1,2,3`. Cobertura completa
   por construcción.
2. **Sin índice** — `rangosDeUnidades` (`packages/rag/src/unidades.ts`) recorta de los
   chunks: cada página se la queda la unidad con más chunks ahí, y cada unidad se queda con
   su corrida contigua dominante. Rechaza el libro si los rangos se solapan o si la
   numeración no avanza con las páginas.

Elegir la mejor de las dos importa: Historia 1º básico tiene un índice de 3 lecciones que
al agruparse daba UNA unidad, mientras sus chunks traen las 4 bien separadas.

**Por qué NO se recortan rangos de página y después se ve qué lección cae adentro**: esa
fue la primera versión y perdía 107 páginas en Biología (entre la unidad 1 y la 2). Medido
después del cambio, sobre 40 libros comparables: las unidades cubren MÁS que el índice en
15, igual en 25, y **menos en ninguno**.

### El título de la unidad — tres fuentes, en orden

Medido sobre 259 unidades: **49% del encabezado corriente** (`Unidad 3 • Los ecosistemas`),
**42% de la primera lección del índice** dentro del rango, **9% queda como "Unidad N"**.
El paso 2 es la razón por la que conservar el índice paga solo.

`tituloDeUnidad` toma el **prefijo común por MAYORÍA** (dos tercios), no la variante
repetida: el encabezado se repite en cada página pero la cola de cuerpo cambia siempre, así
que no hay dos capturas iguales y votar no juntaba nunca dos votos.

### `ord` de las unidades

`book_sections` tiene un `unique (document_id, ord)`: unidades y lecciones comparten
numeración dentro de un libro. Las unidades arrancan en `ORD_UNIDADES = 1000` para no
chocar con los 0..N del índice.

### El progreso del alumno NO se perdió

`claveTema(documentId, ord, title)` de cada lección no cambió, así que las marcas siguen
válidas: el alumno las ve dentro de su unidad. La unidad está hecha cuando lo están todas
sus lecciones. En el camino, el "X de N" cuenta unidades enteras y la **barra cuenta
fracciones** — con 2 de 4 lecciones dice "0 de 6 unidades · 8%".

### Dos bugs del panel que estaban tapando esto

- `/api/progress` contaba solo `book_sections level=2 having count(*) >= 3` y devolvía
  NADA para las materias sin índice — pero `getPlanTopics` cae al fallback legacy y sí
  devuelve lecciones. El panel leía `planTotal = 0`, marcaba `sinCamino` y **apagaba el
  botón "Camino"** de materias que tenían siete lecciones. La regla vive ahora en
  `planSizes()` (`sections.ts`), en un solo lugar. Verificado: 67/67 materias coinciden
  con `getPlanTopics`.
- La pantalla del camino sin plan cacheado decía *"su libro no trae un índice que se pueda
  leer"* y **escondía el botón que lo armaba** (`generarPlan` vivía dentro de `CaminoView`,
  que solo se renderiza si YA hay plan). `GET /api/plan` devuelve ahora `puedeArmarse`,
  que distingue "todavía no está armado" de "este libro no da".

### Estado del corpus (2026-08-13)

| | materias |
|---|---:|
| camino por **unidades** | 53 |
| camino por **lecciones** | 4 |
| **sin camino** | 10 |

De las 53 con unidades, **41 fusionan** (unidad + lecciones adentro) y **12 tienen solo
unidades** porque su libro no tiene índice legible: Cs. Naturales 1º-4º, Lenguaje 1º y 2º,
Matemática 2º, 3º y 7º, Historia 2º, y Ciencias para la Ciudadanía 3º y 4º medio (que son
el MISMO libro cargado dos veces).

**Bloqueos vigentes** (`subjects.disabled_at`): los 12 de Inglés y **todo 1º a 5º básico**
(25 materias, decisión de producto: chicos muy chicos, a revisar con un profesional).

### Divisores de unidad que el extractor no reconocía

`extract_curriculum.py` busca `Unidad` y DESPUÉS el número. Hay libros que lo escriben al
revés. La regla medida que funciona:

```
^[ \t]*(\d{1,2})[ \t]*\n[ \t]*UNIDAD\b     (multilínea, SIN ignorecase)
```

más el filtro **una unidad por página** (si nombra dos o más, es el índice). Da secuencia
1..N limpia en **7 libros** y ruido en cero. Con eso se hizo backfill de `chunks.unit` en
Historia 1º y 2º básico, que estaban sin camino.

**El orden de lectura del índice no es único**: en Ciencias Naturales 3º, 5º y 6º hay que
ordenar los bloques **por columna**; en Ciencias Naturales 4º y Lenguaje 2º, **por `y`**.
Probar los tres órdenes (lectura, columna, `y`) y quedarse con el de mejor monotonía mejora
20 de 45 libros y no empeora ninguno — **está medido pero NO implementado**.

---

## 7. Deuda conocida / próximos pasos

> ⚠️ **Leé el §8 antes de actuar sobre esta lista.** Varios puntos de acá se resolvieron el
> 2026-08-23/24 —los índices se reconstruyeron, los títulos se limpiaron, `curriculum_map`
> tiene consumidores— y el §8 tiene el estado real. Lo que sigue vigente acá es lo de UI y
> lo del tutor; lo del corpus y el camino, revisalo contra el §8.


- 🔴 **Los puntos de control se aprietan cuando la unidad tiene muchas lecciones.** El paso
  vertical entre unidades es fijo (`PASO = 164`) y una unidad con 5 lecciones no entra:
  medido en Lengua y Literatura 2º medio, 21 pares de circulitos se superponen. El arreglo
  no es achicarlos más (a 14px ya son casi intocables) sino que **el tramo crezca con la
  cantidad de lecciones**, lo que toca `centro`, `sendero` y el alto del tablero.
- 🔴 **Una unidad sin puntos de control se ve idéntica a una rota.** Los 12 libros sin
  índice muestran el nodo pelado, sin el contador "0 de N", y esa ausencia se lee como
  error. Falta decirlo en la interfaz ("unidad completa" / "sin desglose") o darle al nodo
  una forma distinta.
- 🔴 **Títulos de portadilla invertida sin resolver.** Lenguaje 2º básico escribe
  *"¿Para qué sirve la imaginación? 1 Unidad"* — título ANTES del número — y muestra
  "Unidad 1..4". El patrón está escrito en `tituloDeUnidad` y compila, pero no dispara
  sobre el texto real. Los 4 títulos correctos están medidos del índice (folios 8, 60, 98,
  136; PDF 10, 62, 100, 138).
- 🔴 **6 pares de libros traen DOS cursos en un tomo y la numeración reinicia.** Verificado
  con el texto de los propios libros: Matemática 3M pág. 110 dice *"Unidad 1 · Texto del
  estudiante · 4° medio"*; el solucionario de Biología dice *"Unidad 1 – 2º Medio"*. Son 9
  pares byte-idénticos cargados bajo dos grados; en 6 de ellos hay reinicio. **El camino de
  1º medio muestra unidades de 2º medio.** No es regresión (el camino por lecciones ya lo
  hacía) pero ahora se nota más. Hay que partir por grado antes de armar los nodos.
- 🟡 **`Leo Primero` (14 tomos, Lenguaje 1º-4º) no usa unidades sino `Clase N`** — 136
  clases por año, contiguas y con numeración corrida entre tomos. La regla (línea suelta
  `^Clase N$` en el 1-3% superior de la página) da 544 encabezados con **0 falsos positivos**
  en todo el corpus. PERO esas materias tienen ADEMÁS `texto_del_estudiante` con 4-5
  unidades, y las `book_sections` actuales salen de ese libro. Es elegir entre dos libros de
  contenido paralelos con estructuras incompatibles (136 clases vs 4 unidades), no concatenar.
- 🟡 **"Lengua 8vo" es una materia fantasma**: 0 documentos, 0 chunks. Cuenta como agujero
  en todos los inventarios. Borrarla (con respaldo).
- 🔵 **Pomodoro — pedido, no empezado.** El alumno define bloque de foco y descanso y a qué
  hora estudia. Va en `student_profiles` junto a `tts_voice`/`tts_on`, se guarda con
  `PUT /api/me/profile`. Dos decisiones de producto abiertas: ¿el temporizador corre dentro
  del camino o es pantalla aparte?, ¿el descanso es sugerencia o el tutor deja de responder?
- 🔵 **El cruce con las bases curriculares del estado NO está empezado.** El documento
  (`/Users/dusan/Documents/libros/WEB_bbcc EPJA_v16_0.pdf`) está analizado pero **no hay
  nada en la base**: no existen tablas de currículo, ni `extract_bases.py`, ni archivos
  extraídos. Lo medido: **29 páginas** de asignatura × nivel (57-61, 71-75, 82-85, 92-95,
  103-106, 115, 118, 122, 126, 131, 134, 137 — ojo, p.36/38/40 son ejemplos que reimprimen
  contenido y hay que descartarlas), **tres listas** por página (~115 Grandes Ideas, ~156 OA
  de habilidad, **~195 Conocimientos esenciales**, que es la lista del contenido real y la
  que hay que mapear), y el mapeo nivel→grado declarado en la p.46. Las páginas son a dos
  columnas y en orden plano las tres listas se entreveran: hay que segmentar por quiebre de
  columna. **`concepts`/`chunk_concepts` NO sirven para esto**: `concepts.subject_id` es un
  FK simple y un ítem curricular pertenece a muchas materias; además chocan con
  `questions`/`attempt_items`/`misconceptions`, que ya usan `concept_id` con otra semántica.
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

---

## El currículum oficial (pilar del proyecto)

`docs/epja-objetivos-por-nivel.md` — **qué exige el Estado para que un alumno pase de
nivel**, textual de las *Bases Curriculares EPJA* (Decreto Supremo N° 10/2022, ed. 2024).
195 conocimientos esenciales, 112 grandes ideas, 156 OA, por asignatura y nivel.
`docs/epja-niveles.md` — equivalencia nivel ↔ curso.

La capa que importa es **"Conocimientos esenciales"**: es la única que nombra la materia
(*productos notables, teorema de Thales*). Los OA describen habilidades ("evaluar modelos"),
nunca contenido — no sirven solos para casar con los libros ni para generar planes.

Extraído con script desde el PDF; dos trampas si se vuelve a hacer:
- Las páginas están **rotadas** — las columnas salen como secuencias de x0 que reinician;
  hay que cortar bloques donde `x0 < anterior − 80`.
- El **glifo de viñeta es la letra `y`** — partir por "y" destroza el castellano
  ("teorías asociadas y sus evidencias"). Solo cuenta como viñeta al inicio de bloque, y
  aun así 9 quedaron mal cortadas y se repegaron a mano.

Pendiente: reorganizarlo por curso (hoy está por nivel) y cruzarlo con el corpus para saber
qué contenido exigido **no** está cubierto por ningún libro cargado.

---

## El mapa curricular (qué página del libro cubre cada exigencia del Estado)

`docs/mapa-curricular.md` + tablas `curriculum_map` y `curriculum_map_tramos`.
237 puntos, 490 tramos, 116 conocimientos esenciales de Formación General + Filosofía.
Se regenera con `pnpm --filter @tutor-ia/eval mapa-doc --salida <ruta absoluta>`.

**Alcance** en `docs/materias-por-nivel.md`: solo Formación General + Filosofía en 3º-4º.
Inglés y las guías del docente quedaron para una segunda pasada.

**El método, y por qué no se puede simplificar.** El buscador solo dio 7 aciertos de 63 con
mediana de score 0,94 — el score alto no prueba nada ("química orgánica" apuntó a
fotosíntesis con 0,998, por la palabra "carbono"). Las tres reglas que lo arreglaron:
sin cita textual no hay ubicación; para declarar un hueco hay que entregar los términos
probados; y la consulta del currículum se reescribe antes de buscar (el registro normativo
del decreto no matchea el habla del libro).

**Herramientas** (`packages/eval/src/`): `ubicar.ts` propone candidatos, `cargar-mapa.ts`
carga (idempotente), `mapa-doc.ts` volcado a markdown. Ninguna tiene tests.

**Los cortes de los tomos combinados** — dato que afecta al tutor, no solo al mapa. El mismo
PDF cuelga de dos materias y cada mitad es de un año: Biología p.130, Química p.92, Física
p.107, Matemática 3º-4º p.109, Filosofía p.123. Las filas que caen en la mitad ajena van
marcadas `verificado = 'otro_año'`.

> ⚠️ **Esta sección quedó vieja el 2026-08-23.** Los números de arriba (237 puntos, 490
> tramos) y los dos primeros pendientes de abajo ya no valen: `curriculum_map` SÍ tiene
> consumidores y los huecos son cero. Lo que sigue vigente es **el método** y la advertencia
> de filtrar por `metodo = 'lector-v1'`. El estado real está en §8.

**Pendiente, en orden de retorno:**
1. ~~Nadie lee `curriculum_map`.~~ **HECHO (2026-08-23).** Lo leen los PILARES del camino
   (`pilaresDe` / `tramosCurriculares`) y el bloque de pendientes (`pendientesDe`), los dos
   en `packages/rag/src/curriculum.ts`.
2. ~~Los 7 huecos reales.~~ **CERO (2026-08-24).** Todos los conocimientos del currículum
   están en algún libro del alumno, en los cuatro niveles. Ver §8.
3. Tests de los tres scripts. `cargar-mapa` casa veredictos por prefijo de 60 chars — si dos
   conocimientos de una materia comparten el prefijo, se pisan sin avisar.
4. Los números por nivel NO son comparables entre sí: el prompt del auditor cambió entre
   bloques, así que `correcto` en 1º-2º Medio no significa lo mismo que en 3º-4º.
5. 6º básico es el resultado más flojo (9 completos de 27) y merece menos crédito: su índice
   tiene 7 secciones y casi ningún chunk tiene heading_path.
6. Quedan 104 filas de `metodo = 'ubicar-v1'` —la corrida del 11% de precisión— como
   registro histórico. Filtrar siempre por `metodo = 'lector-v1'`. **De esas 104, 88 ya
   tienen su fila `lector-v1` para el mismo par (materia, ítem); las 16 restantes son todas
   de Inglés, que está apagado.** O sea que no hay nada pendiente de convertir ahí — lo
   creí durante media sesión y era falso.

---

## El curso de cada conocimiento (nivel → grado)

El currículum EPJA define por NIVEL y la app está organizada por CURSO. Esa traducción
quedó resuelta y escrita en `curriculum_map`: `curso_resuelto`, `curso_origen` y
`curso_evidencia` (esquema en `packages/db/schema_curriculum_curso.sql`).

**114 conocimientos distintos, 116 pares nivel×conocimiento** — "Estrategias de comprensión
lectora y de comprensión oral" el currículum lo repite textual en tres niveles. Los 116
tienen origen; ninguno quedó sin resolver:

| origen | conocimientos | qué significa |
|---|---|---|
| `ambos_cursos` | 82 | Los dos libros del nivel lo enseñan. `curso_resuelto` va NULL **a propósito**: es contenido del nivel entero y elegir uno sería inventar una distinción que ni el currículum ni los libros hacen. |
| `libro` | 29 | Solo uno de los cursos del nivel lo enseña. Es el mejor desempate: lo decide el material que el alumno tiene. |
| `regular` | 3 | Ningún libro del nivel lo trae; lo desempató el currículum REGULAR (curriculumnacional.cl), que sí asigna cada OA a un año. |

**El hallazgo que explica los `regular`:** EPJA comprime el currículum regular, así que un
nivel puede exigir contenido que en el sistema regular vive fuera de su equivalencia.
"Biodiversidad en Chile" y "Sistema solar y estructuras cósmicas" los pide el Nivel 3 Básica
(7º-8º) y son de 1º MEDIO — la Unidad 4 de Física de 1º medio se llama literalmente
"Estructuras cósmicas". Los libros de 7º y 8º **no están incompletos**: siguen bien el
currículum regular. El desajuste es entre los dos currículos.

Y el corolario: **los 5 conocimientos que no estaban en ningún libro de su nivel SÍ están en
el corpus**, en libros de otro curso (Biología 1º Medio 17 chunks, Física 1º Medio 31,
Ciencias Naturales 5º 17, Lenguaje 5º 5, Ciencias Naturales 3º 8). Ninguno necesita
contenido de Internet: necesitan **alcance de búsqueda**. Eso reduce mucho el plan de
cobertura web que está en `.claude/plans/`.

**Se mapeó 5º básico** (27 pares, 4 materias) para poder desempatar el Nivel 2: antes solo
se había evaluado 6º porque 5º está cerrado, y eso hacía figurar como "resuelto" lo que
nunca se había comparado. Dos casos validaron el método cruzado: el currículum regular decía
5º y el libro de 5º lo confirmó.

Fuera del mapa quedan 79 conocimientos del pilar, todos explicados: 31 de Inglés (decisión
del usuario), 37 de Instrumental y Diferenciada (fuera de alcance), 11 de 1º-4º básico
(curso cerrado).

---

## 8. EL CAMINO Y EL CURRÍCULUM (2026-08-23/24) — la sesión más larga hasta acá

Punto de partida: el mapa curricular existía y **nadie lo leía**. Punto de llegada: el camino
del alumno muestra lo que el Estado exige, y lo que su libro no trae con el dato de dónde sí
está. En el medio, doce arreglos y varios errores míos que conviene no repetir.

### 8.0 Git y respaldo del corpus

- **Repo privado**: `github.com/Nachodusan/tutor-ia`, `main` por defecto. Todo el código está.
- **El corpus NO está en git**: 37.814 chunks en Postgres. La copia remota va como **asset de
  release** (`corpus-2026-08-23`, 205 MB de un límite de 2 GB).
- `scripts/backup-db.sh` deja el dump en `~/tutor-backups`, que está en **el mismo disco que
  la base**: eso cubre un `dropdb` accidental, NO un disco que falla. Subirlo es un paso
  manual y está documentado en la cabecera del script.
- **Verificar con sha256, no con el tamaño.** Que el tamaño coincida no prueba integridad; un
  respaldo sin verificar no es un respaldo.
- ⚠️ El dump lleva adentro el texto completo de libros de editoriales bajo copyright. **El
  repo tiene que seguir siendo privado.**

### 8.1 Cómo está formado el camino, en cuatro capas

| capa | de dónde sale | qué falla |
|---|---|---|
| **esqueleto** | el índice del libro (`book_sections`, nivel 1 = unidad, nivel 2 = lección) | índices rotos, tomos sin índice |
| **títulos** | el LLM REESCRIBE el título de la unidad y agrega "qué vas a aprender". No decide orden ni inventa temas; las lecciones conservan el título del autor | si el LLM falla, el fallback es el título del índice |
| **pilares** | `curriculum_map` cruzado por rango de páginas contra la lección | colisión de páginas entre tomos |
| **pendientes** | lo que el currículum exige y el libro no trae, con dónde sí está | — |

**La lección pertenece a la unidad cuyo rango de páginas la contiene**, y se resuelve al LEER
(`getPlanUnits`), sin escribir `parent_ord`.

Hoy: **302 unidades de nivel 1, 1.895 lecciones de nivel 2**, 54 planes cacheados.

### 8.2 ⚠️ EL ORDEN DE LOS CINCO PASOS (esto rompió los 34 caminos)

**`build-sections` BORRA las unidades de nivel 1, que las hace otro job.** Corrí solo el
primero y las 34 materias vivas quedaron con **planes de cero lecciones**: sin unidades,
`getPlanUnits` devuelve vacío y `buildStudyPlan` cae al camino plano.

```bash
pnpm --filter @tutor-ia/eval build-sections --all
pnpm --filter @tutor-ia/eval build-units
psql "$DATABASE_URL" -f packages/db/schema_book_sections_limpieza.sql   # fin de libro
psql "$DATABASE_URL" -f packages/db/schema_book_sections_titulos.sql    # puntos guía
pnpm --filter @tutor-ia/admin plans generar --forzar
```

El último paso es obligatorio: **las claves de tema son hash de (documento, ord, título)**, así
que si cambia el índice cambian las claves. Está escrito en la cabecera de `build-sections.ts`.

**Los índices nunca se habían reconstruido** después de los cambios del corpus. Matemática 7º
daba 16 temas en simulacro y tenía **cero** en la base.

| materia | antes | ahora |
|---|---|---|
| Matemática 7º | **0** lecciones | 14 |
| Matemática 8º | 3 (una titulada con una fórmula) | 17 |
| Lenguaje y Comunicación 6º | 3 | 33 |
| Lengua y Literatura 8º | 18 | 45 |
| Historia 6º | 77 | 187 |

`schema_book_sections_titulos.sql` saca los puntos guía del índice impreso
(`El pueblo mapuche.........`, 53 lecciones) y borra los fragmentos cortados —Matemática 7º y
8º tenían una lección llamada **"irecta"**, de "proporcionalidad directa"—. **No toca los
títulos largos**: 118 pasan de 70 caracteres y son legítimos, Biología titula cada lección con
una pregunta entera.

### 8.3 Las lecciones del segundo tomo (250 que no aparecían)

250 de 1.423 lecciones existían en el índice y **no estaban en el camino de nadie**. Dos causas:

1. **La unidad no llegaba hasta la siguiente.** Las unidades ubicadas por folio son marcadores
   de UNA página —la portadilla—. Historia 6º las tenía en p.9-9, 25-25, 45-45 y la lección de
   la 27 no caía en ninguna. Un libro no tiene huecos: la que arranca en la 25 llega hasta la
   44. Y por simetría la primera arranca donde arranca la primera lección del tomo.
2. **Un tomo con lecciones y ninguna unidad.** El parser sacaba unidades de un tomo y lecciones
   del otro, y la lección se asigna a una unidad DEL MISMO documento. Lenguaje 6º perdía 30 de
   33. Ahora ese tomo recibe una unidad sintética (`ord = -1`).

Las dos se resuelven **al leer**, no corrigiendo `book_sections`: el rango guardado es lo que
el parser encontró y pisarlo perdería en qué página está la portadilla.

Resultado: **1.423 de 1.423 lecciones ubicadas (100%)**.

### 8.4 El tomo sin ninguna sección también es una parada

Ciencias para la Ciudadanía 3º y 4º Medio tenían el camino **vacío**: su texto no trae índice,
no tiene encabezados y sus marcadores "Unidad 1/2" son encabezados corridos que se repiten de
la p.12 a la 310. Pero la materia tiene **seis módulos EPJA** con título del Mineduc.

- Un documento de contenido sin ninguna sección entra como **una parada entera** (no se
  inventan lecciones adentro). Medido: **19 materias vivas** tenían documentos así, con más de
  **6.000 fragmentos** que el alumno tenía y no podía alcanzar desde el camino.
- **Las unidades con nombre le ganan a "Unidad 2".** La regla prefería siempre `unidad_chunks`;
  en estas dos materias eso eran "Unidad" y "Unidad 2" mientras el índice tenía "Prevención y
  transmisión de infecciones". Son los ÚNICOS dos documentos del corpus en esa situación.
  Ahora hay **cero unidades sin nombre** en todo el corpus.

### 8.5 Los pilares y la colisión de páginas (158 falsos)

Los pilares se cruzan por **solapamiento** de rangos de página (no contención) **y solo dentro
del mismo tomo**. Al meter los módulos EPJA al camino apareció en pantalla el pilar *"Relación
entre salud y enfermedad"* colgado de cinco unidades, una de ellas *"Estructura interna de la
Tierra"*: cada tomo empieza en su página 1.

**36 materias tienen más de un tomo**, así que no era un caso raro — estaba tapado.
`curriculum_map_tramos` ganó `document_id` (`schema_curriculum_tramos_doc.sql`), backfilleado
en tres pasos de más firme a más flojo: coincidencia exacta con el índice (420), rango en un
solo tomo (287), y por descarte el tomo más largo (159, marcados como tales).

**158 pilares eran falsos.** La cobertura real sobre las lecciones del plan es **~36%**, no el
45% que daba antes de filtrar.

> **Y el 36% no es un mapa incompleto.** El currículum EPJA pide MUCHO menos de lo que enseña
> el libro: Matemática 5º tiene 5 exigencias contra 100 lecciones. El camino no es "la lista de
> lo que el Estado pide": es **el libro entero, con lo que el Estado va a exigir marcado
> encima**. El número que sí importa es el otro: cuánto de lo que el Estado exige está en algún
> libro del alumno.

### 8.6 `tramos-indice` — los pilares dejan de ser uno por libro

Física 1º Medio marcaba "sonido y luz" en las páginas 25-30 —UNA lección— cuando el libro las
enseña de la 5 a la 54, que son 19. De 520 tramos, 213 eran el principal copiado.

`pnpm --filter @tutor-ia/eval tramos-indice --todas --aplicar` le pregunta al modelo, **sobre
el ÍNDICE** del libro, qué lecciones enseñan cada conocimiento. Sobre el índice y no sobre los
chunks a propósito: es una lista corta y real de la que el modelo solo puede ELEGIR, no puede
inventar una página.

Dos topes que hicieron falta, uno en cada extremo:

- **`--max-tramo 40`**: sin él, Química enganchaba "¿Qué son los compuestos orgánicos?"
  (p.136-196) para "Leyes de conservación de la materia". Señalar un tercio del libro no es
  decirle dónde estudiar.
- **`--max-cobertura 0.5`**: sin él, "Contexto de producción y recepción de un texto literario"
  enganchaba **45 de las 46 lecciones** de Lengua 2º Medio. No está mal contestado —todo texto
  literario tiene contexto— está mal PREGUNTADO. Si todo es pilar, nada lo es.

Hoy los tramos son 946: `indice=346, lector=307, principal=213, reverificado=78, buscar-huecos=2`.

### 8.7 El bloque "esto te lo van a exigir y tu libro no lo trae"

`pendientesDe` en `packages/rag/src/curriculum.ts`, pintado al final del camino
(`apps/web/app/camino.tsx`). Dice **dónde sí está**, en tres escalones, y cada uno se le dice
distinto al alumno:

| escalón | mensaje | casos |
|---|---|---|
| `materia` | "Está en tu libro de **Química 1º Medio**, página 40." | 20 |
| `curso_vecino` | "Tu nivel abarca los dos años: está en **Matemática 2º Medio**." | 5 |
| `otro_nivel` | "Ningún libro de tu curso lo trae; sí **Ciencias Naturales 6º**." | 2 |
| — | "No está en ninguno de tus libros: pedile material a tu profe." | **0** |

**La llave es el NIVEL EPJA, no el curso** — el nivel comprime dos años del sistema regular.
El nivel se deduce del CURSO con `nivel_epja()` (`schema_nivel_epja.sql`), NO de
`curriculum_map.nivel`: esa columna dice qué nivel EXIGE el conocimiento, y un libro de 6º
hallado para una exigencia de Nivel 3 se anunciaba como "tu nivel abarca los dos años", que
para un alumno de 7º es falso.

### 8.8 `reverificar` — el mapa estaba mirando medio corpus

El mapa se verificó el **2026-08-20** y el corpus EPJA se ingirió el **21 y 22**. Todos los
veredictos se dictaron contra un corpus que no tenía ese material: *"no está en tu libro"*
quería decir *"no estaba en lo que miré"*. "Teorema de Pitágoras" figuraba ausente en
Matemática 7º con 12 fragmentos y tres lecciones en el índice.

```bash
pnpm --filter @tutor-ia/eval reverificar --estados no_esta,otro_año,parcial --aplicar
```

**LEE los fragmentos en vez de mirar el score** — decidir por score es lo que hace `ubicar`,
que midió 7 aciertos de 63.

> ⚠️ **SOLO PUEDE MEJORAR UN VEREDICTO, NUNCA EMPEORARLO.** La primera prueba bajó "Funciones
> lineales y afines" de parcial a `no_esta` porque esa corrida no trajo un solo fragmento. Que
> este retrieval no encuentre algo no prueba que el libro no lo enseñe. Esta pasada existe para
> ver lo que la anterior no podía ver; no tiene autoridad sobre lo que alguien estableció
> leyendo. Los intentos de degradar se cuentan y se imprimen: en la corrida final fueron 12 y
> **ninguno se escribió**.

**El barrido léxico (2026-08-24).** El reranker se pierde material que un grep encuentra: para
"clasificación de la materia y mezclas" en Ciencias Naturales 6º traía la página 13 —Unidad 1,
estados de la materia— y nunca la Unidad 2, "Sustancias puras y mezclas", que ocupa de la 31 a
la 57. Ahora se le piden al modelo 8-15 términos que un libro usaría y se buscan literalmente.

Tres cosas que hubo que corregir midiendo, y las tres son trampas reutilizables:

1. **Contar términos premia al glosario.** Ganó la página 175 —el modelo heliocéntrico de
   Copérnico— por tocar "masa", "volumen" y "temperatura". Ahora cada término pesa **inverso a
   en cuántos fragmentos del libro aparece**: "masa" está en cien y no distingue nada, "mezcla
   homogénea" está en tres y señala la página.
2. **El barrido se descartaba entero.** Iba al final y el corte a 10 se lo comía: con cuatro
   consultas por seis candidatos el retrieval solo ya deja hasta 24. Su lugar se **AGREGA**
   (8 + 4); probado quitándoselo al reranker (6+4), la corrida pasó de 1 mejora a 0.
3. **El lector le pasaba por arriba.** Con la página delante contestaba "no desarrolla la
   clasificación de mezclas" teniendo el fragmento que dice "mezcla homogénea", "soluto" y
   "disolvente". Ahora cada fragmento del barrido va **marcado con las palabras que se buscaron
   para encontrarlo** y el prompt pide revisarlo antes de negar el punto.

### 8.9 `buscar-huecos` — para lo que no está en ninguna materia mapeada

```bash
pnpm --filter @tutor-ia/eval buscar-huecos --aplicar
```

"Sistema solar y estructuras cósmicas" figuraba sin libro: el EPJA lo pide en Nivel 3 Básica y
el sistema regular lo enseña en 6º, así que se mapeó contra 7º y 8º y **contra 6º nunca**. El
único tomo que lo trae —EPJA Nivel 2 Básica, con una unidad entera desde la p.148— quedó fuera
de la pregunta.

Dos correcciones medidas:

- **El orden de las candidatas era alfabético por grado**, y "1M" va antes que "6B": a un chico
  de 7º básico se le ofrecía primero el libro de 1º Medio. Ahora se ordenan por distancia en
  años de escolaridad.
- **Manda la cercanía, no el veredicto.** Preferir un `correcto` lejano sobre un `parcial`
  cercano mandaba a Química 2º Medio —tres años adelante— teniendo "Unidad 1: Biodiversidad" en
  el tomo de 6º. El veredicto desempata solo entre libros a la MISMA distancia.

### 8.10 Estado del currículum (2026-08-24)

`curriculum_map`: **266 filas `lector-v1`** (124 correcto, 88 parcial, 26 no_esta, 1 otro_año)
sobre materias vivas y cursos abiertos.

| Nivel EPJA | conocimientos | en algún libro | BIEN desarrollado |
|---|---|---|---|
| Nivel 2 Básica (6º) | 27 | **100%** | 16 |
| Nivel 3 Básica (7º-8º) | 32 | **100%** | 24 |
| Nivel 1 Media (1º-2º) | 28 | **100%** | 22 |
| Nivel 2 Media (3º-4º) | 29 | **100%** | 21 |

**83 de 116 (72%) están bien desarrollados**; los otros 33, a medias. **Ninguno queda fuera de
todos los libros.**

`docs/contenidos-faltantes.md` (115 contenidos, uno por uno, con qué trae el libro y qué parte
falta) se regenera con:

```bash
pnpm --filter @tutor-ia/eval faltantes-doc --salida docs/contenidos-faltantes.md
```

### 8.11 `scripts/sql-backticks.sh` — el error que cometí cuatro veces

Un backtick dentro de un literal `` sql`...` `` lo **CIERRA**. Escribir `` `family` `` en un
comentario SQL —que en prosa es lo natural— parte la consulta al medio, y el error que sale
("Module declaration names may only use quoted strings") no menciona ni la consulta ni el
backtick. Me pasó **cuatro veces en una sesión**. El chequeo evita la quinta:

```bash
./scripts/sql-backticks.sh
```

### 8.12 Lo que queda, en orden de retorno

1. **Los 88 "incompletos"** son el único grupo con trabajo real, y el documento tiene qué parte
   falta de cada uno. Ninguno deja al alumno sin nada que leer.
2. **Cuatro conocimientos de ciencias** donde el corpus no tiene el trozo faltante: evolución
   (teorías y evidencias), movimientos de la Tierra y la Luna, alergias y enfermedades
   autoinmunes, y elementos constituyentes (C, H, O, N). Esos sí son para conseguir afuera.
3. **OpenStax**: investigación lanzada y **detenida a mitad** al cerrarse la sesión. Los cuatro
   investigadores y el mapeo terminaron; faltó la síntesis. Se retoma con
   `Workflow({scriptPath: ".claude/.../openstax-para-tutoria-wf_8218a4d5-007.js", resumeFromRunId: "wf_8218a4d5-007"})`.
   Lo que atrae es la LICENCIA (CC BY, sin el problema de las editoriales); las dudas son el
   NIVEL (OpenStax es universitario) y que lo específicamente chileno —biodiversidad en Chile,
   cosmovisiones de los pueblos originarios— no lo va a tener nunca.
4. **Ciencias para la Ciudadanía 3º y 4º Medio** siguen sin lecciones: 9 unidades con nombre
   real pero ningún desglose, porque esos libros no tienen índice de nivel 2. Se puede recorrer
   el camino, no marcar avance fino.
5. **Matemática 8º arrastra basura del parser**: "Potencia y raíz cuadrada División de
   potencias… an : am = an – m" y una "Evaluación" de la página 126 a la 181.
6. **El bloque de pendientes muestra la página del `curriculum_map`**, que no sabe de qué tomo
   es. Si la materia tiene dos, el número puede apuntar al equivocado. Es solo texto —no marca
   lecciones— pero es la misma clase de error que los 158 pilares falsos.

### 8.13 La trampa que repetí toda la sesión

**Medir con una entrada que no es la que el código recibe.** Van los casos, porque el patrón se
repite y es difícil de ver desde adentro:

- Le pasé al buscador **la prosa del lector**, que describe una AUSENCIA ("no hay ni una
  aparición de 'enlace', 'covalente'…"). Eso no se parece a ninguna página de ningún libro:
  **13 de 13 dieron "en ningún libro"**. Hay que traducir el hueco a cómo lo escribiría el
  libro que sí lo trae.
- Leí los resultados **por nombre de materia y número de página**, y ninguno de los dos
  identifica nada: "Física 1º Medio p.59" devolvía chunks de **cuatro documentos distintos**.
  Con eso reporté "9 de 13 resueltos" cuando eran 4.
- Puse un piso de margen en 0,05 sin comprobarlo contra el caso, que medía 0,1046.

El antídoto que funcionó siempre fue el mismo: **imprimir la entrada real antes de creerle a la
salida**, y desconfiar de un resultado redondo (13 de 13, 0 de 5) antes que celebrarlo.
