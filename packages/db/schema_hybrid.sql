-- =============================================================================
-- Retrieval híbrido (Plan v2 §2/§3): denso (pgvector) + léxico (tsvector),
-- fusionados con RRF en la app. Idempotente. Aplicar tras schema.sql y
-- schema_student_model.sql (que agrega heading_path/content_type/page_start/end).
--   psql "$DATABASE_URL" -f packages/db/schema_hybrid.sql
-- =============================================================================

-- Columna léxica: tsvector en español, mantenida automáticamente (generated).
alter table chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('spanish', content)) stored;

create index if not exists idx_chunks_tsv on chunks using gin (content_tsv);

-- -----------------------------------------------------------------------------
-- Denso: KNN por coseno, devolviendo metadata rica para citar
-- ("pág. 87 · Unidad 1 › Lección 1 › ..."). Reemplaza a match_chunks para el
-- pipeline híbrido (match_chunks viejo se mantiene por compatibilidad).
-- -----------------------------------------------------------------------------
create or replace function match_chunks_dense(
  query_embedding vector(1024),
  p_user_id       uuid,
  p_subject_id    uuid default null,
  match_count     int default 20
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  content      text,
  heading_path text,
  page_start   int,
  page_end     int,
  score        float
)
language sql stable
as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    1 - (c.embedding <=> query_embedding) as score
  from chunks c
  join documents d on d.id = c.document_id
  where d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_id is null or d.subject_id = p_subject_id)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- -----------------------------------------------------------------------------
-- Léxico: ranking BM25-ish con ts_rank_cd sobre el tsvector en español.
-- Captura lo que el denso falla: siglas, nombres propios, definiciones exactas.
-- -----------------------------------------------------------------------------
create or replace function match_chunks_lexical(
  query_text   text,
  p_user_id    uuid,
  p_subject_id uuid default null,
  match_count  int default 20
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  content      text,
  heading_path text,
  page_start   int,
  page_end     int,
  score        float
)
language sql stable
as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    ts_rank_cd(c.content_tsv, plainto_tsquery('spanish', query_text)) as score
  from chunks c
  join documents d on d.id = c.document_id
  where d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_id is null or d.subject_id = p_subject_id)
    and c.content_tsv @@ plainto_tsquery('spanish', query_text)
  order by score desc
  limit match_count;
$$;
