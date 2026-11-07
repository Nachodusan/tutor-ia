# Tutor IA — facilitador de aprendizaje

Un tutor que ayuda al estudiante a **aprender** con su material oficial: enseña
**como enseña su libro** —con el mismo método y los mismos ejemplos—, **resuelve
ejercicios paso a paso**, cita la fuente, verifica que entienda y **se adapta** si
no comprende.

- 🧠 **Facilitador conceptual** — explica el tema con analogías y ejemplos; **cita página/sección** o **se abstiene** si no está en el material.
- 🔁 **Enseñanza adaptativa** — si el estudiante no entiende, **cambia de método** (otra explicación, otro ejemplo, otra actividad), no repite lo mismo.
- 🛡️ **Anti-alucinación estricto** — solo afirma lo respaldado por el material; ante la duda, se abstiene. Ver [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md).

> ⚠️ **Esto ya NO es "100% local".** El proveedor local (Ollama) se eliminó del
> proyecto: **la generación y los embeddings** van a una **API remota compatible
> con OpenAI** (DeepInfra). Siguen en tu máquina el material, Postgres/pgvector y
> el sidecar de reranker + NLI. **Consecuencia operativa: sin red no hay tutor y
> tampoco hay búsqueda.** Antes un corte de internet tumbaba solo la generación y
> el retrieval seguía andando con embeddings locales; hoy el alumno se queda sin
> nada. Hace falta `DEEPINFRA_API_KEY`.

> **Fuera de scope (medido):** resolver ejercicios / matemática. El de-risking
> (`exp5`, 2026-07) mostró que un 7B local tenía topada esa capacidad (grading
> ~78%, math ~75%) y el scaffolding no la rescata. El producto se enfoca en lo que
> hace bien: **facilitar la comprensión conceptual**. SymPy queda solo como
> verificación opcional. (Aquel motor local ya no está en el proyecto y el script
> `exp5` se borró junto con él; la decisión de scope se mantiene.)

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
  core/           → capa de proveedor de LLM (API remota), prompts del facilitador, orquestación de enseñanza
  rag/            → ingesta doble corpus, chunking tipado, retrieval híbrido + reranker + NLI
  db/             → esquema Postgres/pgvector
  eval/           → harness de medición (grounding, adaptatividad, calidad pedagógica)
  ingest-py/      → sidecars Python: extracción de currículum, reranker + NLI, SymPy
```

**Remoto (API compatible con OpenAI, un solo proveedor):** generación con el modelo
por defecto del proveedor (`Qwen/Qwen3.6-35B-A3B` en DeepInfra) y embeddings
`BAAI/bge-m3` (1024 dims). **Local:** reranker `bge-reranker-v2-m3` + NLI
`mDeBERTa-v3-xnli` (verificación direccional), servidos por un sidecar Python en MPS
(`rerank_server.py`, puerto 8790), y datos + vectores en **Postgres nativo con
pgvector** (sin Docker).

## Puesta en marcha

Requisitos: Node ≥ 20, pnpm, [Postgres nativo](https://postgresapp.com) (o
`brew install postgresql@17 pgvector`) y una **`DEEPINFRA_API_KEY`** en el `.env`.
**Sin Docker.**

```bash
cp .env.example .env
# Poné tu DEEPINFRA_API_KEY en .env: sin ella no hay generación NI embeddings,
# o sea que tampoco hay búsqueda.
bash scripts/setup-local.sh   # Postgres nativo + esquema + seed
pnpm install
# Sidecar LOCAL de reranker + NLI (arrancar a mano; sirve /rerank y /nli en :8790):
nohup ./packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py &
pnpm dev
```

`setup-local.sh` aplica `schema.sql`, `schema_student_model.sql`, `schema_hybrid.sql`,
`schema_dual_corpus.sql` y `seed.sql`.

> `LLM_PROVIDER` solo acepta `deepinfra` (o vacío). Si quedó un `LLM_PROVIDER=ollama`
> de un `.env` viejo, el arranque falla con un mensaje que lo explica en vez de
> intentar hablarle a un servicio que ya no existe.

> **Modo offline: no hay.** Embeddings y generación son remotos; sin red, el alumno
> no puede ni preguntar ni buscar en su material.

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

**De-riskeado y descartado:** resolver ejercicios / matemática (`exp5`) — fuera de
scope. El script se borró junto con el proveedor local que medía; la conclusión queda.

Anti-alucinaciones: [docs/anti-alucinaciones.md](docs/anti-alucinaciones.md) · Estado detallado: `HANDOFF.md`

## Licencia y material de terceros

El **código** va con [licencia MIT](LICENSE). El material de terceros, en
[`NOTICE.md`](NOTICE.md).

Los **textos escolares** sobre los que trabaja el sistema son del Ministerio de
Educación de Chile y de sus editoriales: **no están en este repositorio** y no
se distribuyen con él. El corpus vive fuera de git y los fixtures de evaluación
guardan solo el ancla de cada fragmento —documento, página y un hash— nunca el
texto. Para correr el proyecto hay que conseguir el material por cuenta propia.

Si trabajás con el corpus cargado y necesitás los fixtures completos:

```bash
pnpm --filter @tutor-ia/eval golden-texto --rehidratar   # trae el texto desde tu base
pnpm --filter @tutor-ia/eval golden-texto --pelar        # lo saca antes de commitear
```

Para que lo rehidratado no vuelva al repo por descuido, instalá el guardián una vez:

```bash
git config core.hooksPath .githooks
```
