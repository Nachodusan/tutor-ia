# Tutor IA — facilitador de aprendizaje (100% local)

Un tutor que **corre enteramente en tu máquina** (nada va a la nube) y ayuda al
estudiante a **comprender** los temas de su material oficial. No resuelve
ejercicios ni hace cálculos por él: **explica conceptos con ejemplos, cita la
fuente, verifica que entienda y se adapta** si no comprende.

- 🧠 **Facilitador conceptual** — explica el tema con analogías y ejemplos; **cita página/sección** o **se abstiene** si no está en el material.
- 🔁 **Enseñanza adaptativa** — si el estudiante no entiende, **cambia de método** (otra explicación, otro ejemplo, otra actividad), no repite lo mismo.
- 🛡️ **Anti-alucinación estricto** — solo afirma lo respaldado por el material; ante la duda, se abstiene. Ver [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md).

> **Fuera de scope (medido):** resolver ejercicios / matemática. El de-risking
> (`exp5`) mostró que un 7B local tiene topada esa capacidad (grading ~78%, math
> ~75%) y el scaffolding no la rescata. El producto se enfoca en lo que hace bien:
> **facilitar la comprensión conceptual**. SymPy queda solo como verificación opcional.

## Arquitectura: RAG de doble corpus tipado

El material oficial viene en **pares por materia/grado**: el **Texto del Estudiante**
(el "qué") y la **Guía Didáctica del Docente / GDD** (el "cómo"). Se ingestan con
**roles distintos**:

- **Contenido** (texto del estudiante) → fuente de verdad **citable**.
- **Pedagogía** (GDD) → chunks tipados por bloque (`ideas_previas`,
  `ambiente_aprendizaje`, `habilidad`, `evaluacion`, `solucionario`…), anclados al
  **Objetivo de Aprendizaje (OA)**. Guían **cómo** enseñar, no qué afirmar.

Al enseñar un tema, el retrieval trae **contenido** (por relevancia, con gate de
abstención) + **pedagogía** matcheada (por OA + relevancia semántica). En grados
bajos, muy visuales, el contenido a veces vive en la GDD: el grounding usa **ambos
corpus oficiales** (contenido preferido, GDD de respaldo), sin romper el anti-alucinación.

Monorepo TypeScript (pnpm + Turborepo):

```
apps/web/         → Next.js (UI + API: chat de estudio, subida de material)
packages/
  core/           → cliente Ollama, prompts del facilitador, orquestación de enseñanza
  rag/            → ingesta doble corpus, chunking tipado, retrieval híbrido + reranker + NLI
  db/             → esquema Postgres/pgvector
  eval/           → harness de medición (grounding, adaptatividad, calidad pedagógica)
  ingest-py/      → sidecars Python: extracción de currículum, reranker + NLI, SymPy
```

**Modelos locales vía Ollama:** `qwen2.5:7b` (tareas), embeddings `bge-m3` (1024 dims).
Reranker `bge-reranker-v2-m3` + NLI `mDeBERTa-v3-xnli` (verificación direccional),
servidos por un sidecar Python en MPS. Datos + vectores en **Postgres nativo con
pgvector** (sin Docker). **Ninguna API en la nube.**

## Puesta en marcha (local)

Requisitos: Node ≥ 20, pnpm, [Postgres nativo](https://postgresapp.com) (o
`brew install postgresql@17 pgvector`) y [Ollama](https://ollama.com). **Sin Docker.**

```bash
cp .env.example .env
bash scripts/setup-local.sh   # Postgres nativo + esquema + modelos Ollama
pnpm install
# Sidecar de reranker + NLI (arrancar a mano; sirve /rerank y /nli):
nohup ./packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py &
pnpm dev
```

`setup-local.sh` aplica `schema.sql`, `schema_student_model.sql`, `schema_hybrid.sql`,
`schema_dual_corpus.sql` y `seed.sql`, y hace `ollama pull` de `qwen2.5:7b` y `bge-m3`.

> Mac Apple Silicon (16GB) corre bien el 7B. No tengas el 3B y el 7B cargados a la vez.

## Estado / Roadmap

**Fundamentado (anti-alucinación) — sólido y en producción:**
- [x] Ingesta estructural + retrieval híbrido (denso+léxico+RRF) + reranker como gate de abstención
- [x] Verificación **NLI direccional** por oración (contradicciones, sin respaldo) — en el chat real
- [x] Detección de **premisa falsa** (no le sigue la corriente a suposiciones falsas)
- [x] Eval endurecido (golden anclado a chunks reales, set etiquetado)

**Facilitador conceptual (Plan v3) — piloto validado:**
- [x] Esquema de **doble corpus tipado** (`schema_dual_corpus.sql`)
- [x] Ingesta tipada de contenido + pedagogía (`extract_curriculum.py`, `ingest-curriculum.ts`)
- [x] Retrieval tipado (contenido + pedagogía por OA/semántica)
- [x] Prompt del **facilitador** con enseñanza adaptativa (`TEACHING_SYSTEM`, `teaching.ts`)
- [x] **Piloto E2E** (Ciencias Naturales 1º Básico): `pnpm --filter @tutor-ia/eval pilot-session`
- [ ] Evals de calidad pedagógica / adaptatividad (`exp6`)
- [ ] Wire del web route (`/api/chat`) al teaching path
- [ ] Batch de ingesta (480 libros)

**De-riskeado y descartado:** resolver ejercicios / matemática (`exp5`) — fuera de scope.

Anti-alucinaciones: [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md) · Estado detallado: `HANDOFF.md`
