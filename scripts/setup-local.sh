#!/usr/bin/env bash
# Prepara el entorno LOCAL: Postgres NATIVO (sin Docker) + modelos Ollama.
# Plan v2 §1.3: Docker Desktop cuesta 2-3 GB de RAM que necesitamos para los
# modelos. Usamos Postgres nativo (brew) — arranca en 1 s, cero VM.
#
# Uso:  bash scripts/setup-local.sh
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://localhost:5432/tutor}"
PG_VERSION=17

echo "==> 1/5 Postgres nativo + pgvector (brew)…"
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
    echo "    Evitá Docker: cuesta 2-3 GB de RAM que necesitás para los modelos."
    exit 1
  fi
fi

echo "==> 2/5 Creando la base 'tutor' si no existe…"
createdb tutor 2>/dev/null || echo "  (ya existe)"

echo "==> 3/5 Aplicando esquema, modelo del alumno, híbrido y seed…"
psql "$DB_URL" -f packages/db/schema.sql
psql "$DB_URL" -f packages/db/schema_student_model.sql
# schema_hybrid.sql es OBLIGATORIO: define match_chunks_dense/lexical y el
# tsvector que usan retrieval híbrido e ingesta v2. Sin él, el retrieval revienta.
psql "$DB_URL" -f packages/db/schema_hybrid.sql
# Doble corpus tipado (contenido + pedagogía): campos curriculares en chunks/documents.
psql "$DB_URL" -f packages/db/schema_dual_corpus.sql
psql "$DB_URL" -f packages/db/seed.sql

echo "==> 4/5 Descargando modelos locales en Ollama…"
if ! command -v ollama >/dev/null 2>&1; then
  echo "  ⚠ Ollama no está instalado. Instálalo desde https://ollama.com y reintenta este paso."
else
  # OJO: el tag de Ollama es "qwen2.5:7b" (SIN -instruct); ver HANDOFF §2.
  ollama pull "${LLM_MODEL:-qwen2.5:7b}"       # tareas (examen, corrección, verificación)
  ollama pull "${LLM_VOICE_MODEL:-qwen2.5:3b}" # voz (Fase 5, latencia baja)
  ollama pull "${EMBEDDING_MODEL:-bge-m3}"              # embeddings
fi

echo "==> 5/5 Listo. Ahora: pnpm install && pnpm dev"
echo "    (Recordá: NO tengas 3B y 7B cargados a la vez — keep_alive:0 en el que no uses.)"
