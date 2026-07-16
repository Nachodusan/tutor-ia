# Tutor IA para estudiantes (100% local)

Sube tus **apuntes o libros** y estudia con una IA que corre **enteramente en tu
máquina** (nada se envía a la nube) y que se apoya **solo en tu propio material**:

- 💬 **Chat de estudio** — pregúntale a la IA; responde **citando las fuentes** o se **abstiene** si no está en tu material.
- 🗣️ **Tutor por voz** — conversación en tiempo real, como con un profesor (Fase 3).
- 📝 **Exámenes generados por IA** — crea, corrige y da retroalimentación a partir de tu material.

La IA solo razona sobre el contenido que subes, usando **RAG** (Retrieval-Augmented
Generation), en **modo estricto y conservador** para evitar alucinaciones.
Ver [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md).

## Arquitectura

Monorepo TypeScript (pnpm + Turborepo):

```
apps/
  web/          → Next.js (UI + API: chat, exámenes, subida de material)
  voice-agent/  → tutor por voz en tiempo real (Fase 3)
packages/
  core/         → cliente Claude, prompts, tipos compartidos
  rag/          → extracción, chunking, embeddings, búsqueda vectorial
  db/           → esquema Postgres/pgvector y acceso a datos
```

**El cerebro** son **modelos locales vía Ollama** con routing por tarea:
`qwen2.5:7b-instruct` (examen/corrección/verificación) y `qwen2.5:3b-instruct`
(voz). Los **embeddings** también son locales (`bge-m3`, 1024 dims). Datos +
vectores en **Postgres NATIVO con pgvector** (sin Docker). **Ninguna API en la nube.**

## Puesta en marcha (local)

Requisitos: Node ≥ 20, pnpm, [Postgres nativo](https://postgresapp.com) (o
`brew install postgresql@17 pgvector`) y [Ollama](https://ollama.com).
**Sin Docker** — cuesta 2-3 GB de RAM que necesitan los modelos (Plan v2 §1.3).

```bash
cp .env.example .env
bash scripts/setup-local.sh   # Postgres nativo + esquema + modelos Ollama
pnpm install
pnpm dev
```

`setup-local.sh` hace por ti:
- instala/arranca Postgres nativo + pgvector y crea la base `tutor`
- aplica `schema.sql`, `schema_student_model.sql`, `schema_hybrid.sql` y `seed.sql`
- `ollama pull` de `qwen2.5:7b-instruct`, `qwen2.5:3b-instruct` y `bge-m3`

> Mac Apple Silicon (16GB+) corre bien el 7B. **No tengas el 3B y el 7B cargados
> a la vez** (`keep_alive:0` en el que no uses).

## Estado / Roadmap (Plan v2)

- [x] Fundaciones (monorepo, esquema pgvector, cliente Ollama, RAG base)
- [x] Schema del modelo del alumno + metadata de chunks (`schema_student_model.sql`)
- [x] Cita literal verificable A2 (`packages/core/src/groundedness.ts`) — 7/7 tests
- [x] Postgres nativo (sin Docker)
- [ ] **Fase −1** — validar supuestos en tu Mac (libro real, benchmark 7B, latencia, RAM)
- [ ] **Fase 0.5** — rehacer ingesta+retrieval (sidecar Python, híbrido, reranker)
- [ ] **Fase 1** — eval harness + calibración del umbral
- [ ] **Fase 2** — verificación (entailment cross-encoder + SymPy)
- [ ] **Fase 3** — modelo del alumno (BKT/FSRS)
- [ ] **Fase 4** — tutor real (máquina de estados) + corrección del trabajo
- [ ] **Fase 5** — voz · **Fase 6** — móvil (PWA + Tailscale)

Plan completo: `~/.claude/plans/` · Anti-alucinaciones: [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md)
