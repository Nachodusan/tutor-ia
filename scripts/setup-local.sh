#!/usr/bin/env bash
# Prepara la parte LOCAL: Postgres NATIVO (sin Docker) + el esquema.
# Plan v2 §1.3: Docker Desktop cuesta 2-3 GB de RAM que preferimos dejarle al
# sidecar de reranking/NLI. Usamos Postgres nativo (brew) — arranca en 1 s, cero VM.
#
# El LLM y los embeddings NO se instalan: van a una API remota, así que lo único
# que hace falta del otro lado es DEEPINFRA_API_KEY en el .env.
#
# Uso:  bash scripts/setup-local.sh
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://localhost:5432/tutor}"
PG_VERSION=17

echo "==> 1/4 Postgres nativo + pgvector (brew)…"
# postgresql@N es keg-only: agregamos su bin al PATH para esta sesión.
if command -v brew >/dev/null 2>&1; then
  export PATH="$(brew --prefix)/opt/postgresql@${PG_VERSION}/bin:$PATH"
fi
if ! command -v psql >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install "postgresql@${PG_VERSION}" pgvector
    brew services start "postgresql@${PG_VERSION}"
    export PATH="$(brew --prefix)/opt/postgresql@${PG_VERSION}/bin:$PATH"
  else
    echo "  ⚠ Instalá Postgres nativo: https://postgresapp.com  (o 'brew install postgresql@${PG_VERSION} pgvector')"
    echo "    Evitá Docker: cuesta 2-3 GB de RAM que le hacen falta al reranker local."
    exit 1
  fi
fi

echo "==> 2/4 Creando la base 'tutor' si no existe…"
createdb tutor 2>/dev/null || echo "  (ya existe)"

echo "==> 3/4 Aplicando esquema, modelo del alumno, híbrido y seed…"
psql "$DB_URL" -f packages/db/schema.sql
psql "$DB_URL" -f packages/db/schema_student_model.sql
# schema_hybrid.sql es OBLIGATORIO: define match_chunks_dense/lexical y el
# tsvector que usan retrieval híbrido e ingesta v2. Sin él, el retrieval revienta.
psql "$DB_URL" -f packages/db/schema_hybrid.sql
# Doble corpus tipado (contenido + pedagogía): campos curriculares en chunks/documents.
psql "$DB_URL" -f packages/db/schema_dual_corpus.sql
# Brazo léxico con OR: sin esto, plainto_tsquery exige TODOS los lexemas y el
# brazo devuelve 0 filas en ~92% de las preguntas reales (medido 2026-08-01).
psql "$DB_URL" -f packages/db/schema_lexical_or.sql
# Temas del plan de estudio derivados del índice de cada libro. Se llena con
# `pnpm --filter @tutor-ia/eval build-sections` DESPUÉS de ingestar.
psql "$DB_URL" -f packages/db/schema_book_sections.sql
# Login del alumno (anónimo), estado persistido y conversaciones. Va ANTES del
# seed, que ya inserta el usuario dev con su username.
psql "$DB_URL" -f packages/db/schema_auth.sql
psql "$DB_URL" -f packages/db/seed.sql

echo "==> 4/4 Listo. Ahora: pnpm install && pnpm dev"
echo "    Falta el .env: copiá .env.example y poné DEEPINFRA_API_KEY."
echo "    Sin esa key no hay generación NI embeddings — o sea, tampoco hay búsqueda."
echo "    Y arrancá el sidecar de reranking/NLI (local, :8790):"
echo "      packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py"
