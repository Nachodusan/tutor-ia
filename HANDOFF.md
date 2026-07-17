# HANDOFF — Tutor IA local (para retomar en un chat nuevo)

> Estado al **2026-07-17**. Corre TODO en la Mac del usuario (**Apple M4, 16 GB**).
> Proyecto en `/Users/dusan/Documents/ia`. Bajo git (~20 commits del reenfoque v3).
> **Leé también la memoria del proyecto** (`tutor-ia-estado.md`) — tiene el estado vivo.

---

## 1. Qué es (Plan v3 — definitivo)

Tutor de estudio **100% local y privado**: nada sale de la máquina. **Facilitador del
aprendizaje conceptual**: explica los temas del material oficial con ejemplos, **cita
página/sección o se abstiene** (no inventa), verifica comprensión con preguntas, y **se
adapta** (cambia de método si el alumno no entiende).

**NO resuelve ejercicios ni matemática/cálculo** — está FUERA DE SCOPE. Se midió (`exp5`)
que el 7B lo tiene topado (grading ~78%, math ~75%) y el scaffolding local no lo rescata.
SymPy quedó solo como verificación opcional (`grading.ts`/`sympy_check.py` parkeados).

**Arquitectura clave — RAG de DOBLE CORPUS TIPADO:** el material oficial viene en pares por
materia/grado: **Texto del Estudiante** (corpus `content`, el "qué" citable) + **Guía
Didáctica del Docente / GDD** (corpus `pedagogy`, el "cómo", chunks tipados por bloque:
ideas_previas, ambiente_aprendizaje, habilidad, evaluacion, solucionario…, anclados al OA).
Al enseñar, el retrieval trae contenido (gated) + pedagogía matcheada por **OA + relevancia
semántica** (el join rígido por unit/lesson NO alinea — TE y GDD numeran distinto).

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

# 4) Web (usa .claude/launch.json). Desde Claude Code: preview_start {name:"web"}.
#    O: pnpm --filter @tutor-ia/web dev   (con las env vars de launch.json)
```

**Voz (100% local):** `whisper.cpp` (brew `whisper-cpp` → `whisper-cli`) + modelo
`packages/ingest-py/whisper-models/ggml-base.bin` (gitignored, 141MB) para STT;
macOS `say` (voz Mónica) + `ffmpeg` para TTS. Todo ya instalado.

**Env (en `.claude/launch.json`):** DATABASE_URL, EMBEDDING_MODEL=bge-m3, LLM_MODEL=qwen2.5:7b,
RERANK_BASE_URL=http://127.0.0.1:8790, RERANK_MIN_SCORE=0.3, RERANK_TIMEOUT_MS=60000,
NLI_TIMEOUT_MS=60000, ENTAIL_MIN_SCORE=0.5, WHISPER_MODEL=…/ggml-base.bin, TTS_VOICE=Mónica.
Para scripts de eval, exportar además EVAL_USER_ID=00000000-0000-0000-0000-000000000001.

Datos no obvios: el reranker usa `transformers` directo (NO FlagEmbedding); Python del venv
es 3.14 (por eso la voz usa binarios, NO faster-whisper). `keep_alive:0` en Ollama por RAM.

---

## 3. Estado — QUÉ ESTÁ HECHO

- **Anti-alucinación (sólido, en producción):** gate de abstención por reranker; verificación
  **NLI direccional** por oración (contradicciones 80%→5% vs el reranker; `nli-validate`);
  detección de **premisa falsa**; **mensajes sociales** (saludos) responden sin abstenerse.
- **Facilitador (Plan v3, T1-T7):** esquema tipado, ingesta doble corpus, retrieval tipado,
  `TEACHING_SYSTEM` con flujo (activar→objetivo→explicar citando→verificar→adaptar). Piloto
  E2E pasó. Cita 100% (tras reforzar el prompt).
- **Corpus completo:** BATCH de básica + media ingestado. **72 materias (46 básica + 26 media),
  ~30k chunks (16.8k contenido + 13k pedagogía), 55/72 linkables.**
- **Web usable:** onboarding (grado→materia), chat-first, verificación visible (✓/🚩/⚠),
  subir material. Iconos SVG propios. **Voz:** micrófono puntual + **modo conversación
  manos libres** (VAD por silencio) con **orbe animado** que reacciona a la amplitud.

## 4. Comandos útiles (con env exportadas + servicios arriba)

```bash
pnpm -r typecheck                                          # 5 paquetes, todo Done
pnpm --filter @tutor-ia/eval batch-ingest [rootDir]       # ingesta (RESUMABLE); BATCH_DRY=1 = solo clasificar
pnpm --filter @tutor-ia/eval eval                         # métricas §9.2 (golden 133; lento, background)
pnpm --filter @tutor-ia/eval exp6                         # eval pedagógico (grounded/cita/adaptó)
pnpm --filter @tutor-ia/eval nli-validate                 # A3 relevancia vs NLI (leak de contradicciones)
pnpm --filter @tutor-ia/eval exp5                         # de-risking eje "correcto" (grading/math) — negativo
```

Libros: `/Users/dusan/Documents/libros/{basica,media}/<grado>/<materia>/*.pdf`. Clasificación
por nombre: texto_del_estudiante/leo_primero/student's_book → content; guía_didáctica/teacher's_guide
→ pedagogy; cuaderno/láminas/activity → descarta.

## 5. Mapa de archivos (lo nuevo del v3)

```
packages/db/schema_dual_corpus.sql   corpus_role/pedagogy_type/unit/lesson/oa/topic + match_chunks_* tipadas
packages/ingest-py/
  extract_curriculum.py              bloques tipados de la GDD por encabezado + OA del cuadro de planificación
  rerank_server.py                   /rerank (bge) + /nli (mDeBERTa), MPS
  sympy_check.py                     CAS (PARKEADO, verificación opcional)
  whisper-models/ggml-base.bin       modelo STT (gitignored)
packages/rag/src/
  ingest-curriculum.ts               consume el extractor → embed → inserta tipado
  retrieve-teaching.ts               retrieveForTeaching: contenido gated + pedagogía por tipo/OA
  nli.ts                             cliente NLI direccional (nliVerify)
  rerank.ts                          entails() (relevancia, débil) + retrieveRanked (gate, con corpusRole)
packages/core/src/
  teaching.ts                        getTeachingContext, streamTeaching, socialReply, checkFalsePremise
  verify.ts                          verifyAnswerA3 (NLI por oración, capa 5)
  prompts.ts                         TEACHING_SYSTEM, buildTeachingTurn, socialReply patterns
  grading.ts                         gradeDecomposed (PARKEADO)
apps/web/app/
  page.tsx                           UI: onboarding + chat-first + voz (orbe, VAD, mic) — TODO acá
  api/chat/route.ts                  teaching path + social + verificación NLI (frames \x1e)
  api/subjects/route.ts              materias con grade/subject_area
  api/voice/{stt,tts}/route.ts       whisper.cpp / macOS say
packages/eval/src/                   batch-ingest, exp5-correcto, exp6-ensenanza, nli-validate, a3-validate, pilot-*
```

## 6. Deuda conocida / próximos pasos (honesto, no bloquea)

- **Gate a veces sobre-abstiene** (ej. "¿qué es una célula?" en Biología 1º Medio: el libro
  es evolución/genética, no define célula). A veces correcto; si molesta, bajar RERANK_MIN_SCORE
  con tradeoff anti-alucinación. Materias sin GDD (17/72) no tienen pedagogía.
- **El tutor a veces filtra el rótulo interno** "[Fragmento N — pág X]" al texto → pulir prompt.
- **Voz:** latencia ~2-4s por turno (exp3, techo del hardware), **sin barge-in** (no se puede
  interrumpir al tutor). VAD thresholds (SPEECH_THRESH=6, SILENCE_MS=1200 en page.tsx) **a
  calibrar con micrófono real** — NO testeado con mic (el sandbox lo bloquea; rutas STT/TTS sí
  validadas por curl).
- **Eval pedagógico (exp6):** mide bien lo determinístico (cita/grounding/pregunta); lo
  subjetivo (adaptó/conceptual) es RUIDOSO (juez = el propio 7B, n chico). No confiarlo como
  veredicto.
- **exams.ts** migrado al gate del reranker pero el grading quedó parkeado (fuera de scope).
- **Extractor tuneado a Ciencias Naturales 1º** — generaliza bien (validado en el batch) pero
  el parsing de OA puede ser flojo en otros formatos; el link usa OA+semántica igual.
- **Producto:** auth stub mono-usuario; sin backup de la DB; inyección de prompt vía PDF subido
  no considerada. Nombres de materia con "Y" en mayúscula (initcap, cosmético).

**Próximo con mejor retorno:** barge-in / calibración de la voz en hardware real, o pulir el
gate/OA-coverage, o el residual multi_hop del anti-alucinación. El eje "correcto" NO conviene
(medido). Historia de las fases previas (Plan v2, anti-alucinaciones) en `docs/`.
