# Tutor IA — a study tutor that teaches from the student's own coursebook

> [Versión en español](README.es.md)

A tutor that helps a student **learn** from their official material: it teaches
**the way their book teaches** — same method, same examples — walks through
exercises, cites the source, checks understanding, and **changes approach** when
the student doesn't follow.

- **Conceptual facilitator** — explains with analogies and examples, and **cites
  page/section** or **abstains** when the answer isn't in the material.
- **Adaptive teaching** — if the student doesn't understand, it switches method
  (different explanation, different example, different activity) rather than
  repeating itself.
- **Strict anti-hallucination** — it only asserts what the material supports; when
  in doubt it abstains. See [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md).

> **Not local anymore.** The local provider (Ollama) was removed: generation *and*
> embeddings now go to an OpenAI-compatible remote API (DeepInfra). The material,
> Postgres/pgvector and the reranker + NLI sidecar still run on your machine.
> **Operational consequence: no network, no tutor and no search.** A
> `DEEPINFRA_API_KEY` is required.

> **Out of scope, and measured.** Solving exercises and mathematics. A de-risking
> experiment (`exp5`, July 2026) showed a local 7B had capped out there (grading
> ~78%, math ~75%) and scaffolding didn't rescue it. The product focuses on what it
> does well: **conceptual understanding**. SymPy remains only as optional
> verification.

## Architecture: typed dual-corpus RAG

Official material arrives in **pairs per subject and grade**: the **Student Text**
(the *what*) and the **Teacher's Guide** (the *how*). They are ingested with
**different roles**:

- **Content** (student text) → the **citable** source of truth.
- **Pedagogy** (teacher's guide) → chunks typed by block (`ideas_previas`,
  `ambiente_aprendizaje`, `habilidad`, `evaluacion`, `solucionario`…), anchored to
  the **Learning Objective**. These guide *how* to teach, never *what* to assert.

When teaching a topic, retrieval pulls **content** (by relevance, through an
abstention gate) plus **matched pedagogy** (by learning objective + semantic
relevance). In lower, highly visual grades the content sometimes lives in the
teacher's guide, so grounding uses **both official corpora** — content preferred,
guide as backup — without weakening the anti-hallucination rules.

TypeScript monorepo (pnpm + Turborepo):

```
apps/web/         → Next.js (UI + API: study chat, material upload)
packages/
  core/           → LLM provider layer, facilitator prompts, teaching orchestration
  rag/            → dual-corpus ingestion, typed chunking, hybrid retrieval + reranker + NLI
  db/             → Postgres/pgvector schema
  eval/           → measurement harness (grounding, adaptivity, pedagogical quality)
  ingest-py/      → Python sidecars: curriculum extraction, reranker + NLI, SymPy
```

**Remote** (one OpenAI-compatible provider): generation with the provider default
(`Qwen/Qwen3.6-35B-A3B` on DeepInfra) and `BAAI/bge-m3` embeddings (1024 dims).
**Local**: `bge-reranker-v2-m3` reranker + `mDeBERTa-v3-xnli` NLI for directional
verification, served by a Python sidecar on MPS (`rerank_server.py`, port 8790),
with data and vectors in **native Postgres with pgvector** — no Docker.

## Evaluation

Own harness with a golden set anchored to real chunks:

| | |
|---|---|
| **recall@5** | 88% |
| **Corpus** | ~38,000 chunks across 35 subjects |
| **Measured** | grounding, hallucination rate, latency |
| **Fixtures** | store only document, page and a hash — never the source text |

Human validation runs as a separate blind double-annotation study:
[auditoria-tutor](https://github.com/Nachodusan/auditoria-tutor).

## Getting started

Requirements: Node ≥ 20, pnpm, [native Postgres](https://postgresapp.com) (or
`brew install postgresql@17 pgvector`) and a **`DEEPINFRA_API_KEY`** in `.env`.
**No Docker.**

```bash
cp .env.example .env
# Set DEEPINFRA_API_KEY in .env: without it there is no generation AND no
# embeddings, which means no search either.
bash scripts/setup-local.sh   # native Postgres + schema + seed
pnpm install
# LOCAL reranker + NLI sidecar (start manually; serves /rerank and /nli on :8790):
nohup ./packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py &
pnpm dev
```

`setup-local.sh` applies `schema.sql`, `schema_student_model.sql`,
`schema_hybrid.sql`, `schema_dual_corpus.sql` and `seed.sql`.

> `LLM_PROVIDER` only accepts `deepinfra` (or empty). A stale `LLM_PROVIDER=ollama`
> from an older `.env` fails at startup with an explanatory message instead of
> trying to reach a service that no longer exists.

> **There is no offline mode.** Embeddings and generation are remote; with no
> network the student can neither ask nor search their own material.

## Status / Roadmap

**Grounding (anti-hallucination) — solid, in production:**
- [x] Structural ingestion + hybrid retrieval (dense + lexical + RRF) + reranker as abstention gate
- [x] Per-sentence **directional NLI** verification (contradictions, unsupported claims) — in the live chat
- [x] **False-premise detection** (does not play along with false assumptions)
- [x] Hardened eval (golden set anchored to real chunks, labelled set)

**Conceptual facilitator (Plan v3) — pilot validated:**
- [x] **Typed dual-corpus** schema (`schema_dual_corpus.sql`)
- [x] Typed ingestion of content + pedagogy (`extract_curriculum.py`, `ingest-curriculum.ts`)
- [x] Typed retrieval (content + pedagogy by objective/semantics)
- [x] **Facilitator** prompt with adaptive teaching (`TEACHING_SYSTEM`, `teaching.ts`)
- [x] **E2E pilot** (Natural Sciences, 1st grade): `pnpm --filter @tutor-ia/eval pilot-session`
- [ ] Pedagogical quality / adaptivity evals (`exp6`)
- [ ] Wire the web route (`/api/chat`) to the teaching path
- [ ] Batch ingestion (480 books)

**De-risked and dropped:** solving exercises / mathematics (`exp5`) — out of scope.

Anti-hallucination: [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md) · Detailed status: `HANDOFF.md`

## Licence and third-party material

**Code** is [MIT](LICENSE). Third-party material is listed in [`NOTICE.md`](NOTICE.md).

The **school textbooks** the system works on belong to Chile's Ministry of
Education and its publishers: **they are not in this repository** and are not
distributed with it. The corpus lives outside git, and evaluation fixtures store
only each chunk's anchor — document, page and a hash — never the text. Running the
project requires sourcing the material yourself.

If you work with the corpus loaded and need the full fixtures:

```bash
pnpm --filter @tutor-ia/eval golden-texto --rehidratar   # pull text from your database
pnpm --filter @tutor-ia/eval golden-texto --pelar        # strip it before committing
```

So rehydrated text never lands in the repo by accident, install the guard once:

```bash
git config core.hooksPath .githooks
```
