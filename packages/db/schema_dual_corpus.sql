-- =============================================================================
-- Plan v3 — RAG de DOBLE CORPUS TIPADO (contenido + pedagogía)
-- =============================================================================
-- Idempotente. Aplicar DESPUÉS de schema.sql / schema_student_model.sql / schema_hybrid.sql.
--   psql "$DATABASE_URL" -f packages/db/schema_dual_corpus.sql
--
-- El material oficial viene en pares por materia/grado:
--   TEXTO DEL ESTUDIANTE (TE) -> corpus CONTENIDO = el "qué" (fuente de verdad citable)
--   GUÍA DIDÁCTICA DEL DOCENTE (GDD) -> corpus PEDAGOGÍA = el "cómo" (estrategia de enseñanza)
-- Se linkean por (unit, lesson, oa): al enseñar un tema, se traen los chunks de
-- contenido + los de pedagogía que matchean su lección/OA.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- documents: rol del documento + coordenadas curriculares para armar el par.
--   kind         = 'content' (TE) | 'pedagogy' (GDD)
--   grade        = "1B", "2B", ... (grado)
--   subject_area = "ciencias_naturales", "lenguaje", ... (materia oficial)
-- El "par" es implícito por (grade, subject_area): un TE + sus GDD comparten ambos.
-- -----------------------------------------------------------------------------
alter table documents add column if not exists kind         text not null default 'content';
alter table documents add column if not exists grade        text;
alter table documents add column if not exists subject_area text;
create index if not exists idx_documents_pair on documents(grade, subject_area, kind);

-- -----------------------------------------------------------------------------
-- chunks: rol + tipo pedagógico + coordenadas curriculares (por chunk, porque un
-- libro cubre muchas unidades/lecciones).
--   corpus_role   = 'content' | 'pedagogy'
--   pedagogy_type = ideas_previas | ambiente_aprendizaje | habilidad | evaluacion
--                 | solucionario | otro   (TEXTO flexible, no enum: la GDD tiene
--                   ~16 "instancias" y varían entre series; se normalizan los 5
--                   canónicos y el resto cae en su header crudo)
--   unit, lesson  = número de unidad/lección (de "Unidad N • Lección M")
--   oa            = objetivo de aprendizaje ("OA6"), del cuadro de planificación
--   topic         = tema legible de la lección
-- -----------------------------------------------------------------------------
alter table chunks add column if not exists corpus_role   text not null default 'content';
alter table chunks add column if not exists pedagogy_type text;   -- NULL en contenido
alter table chunks add column if not exists unit          int;
alter table chunks add column if not exists lesson        int;
alter table chunks add column if not exists oa            text;
alter table chunks add column if not exists topic         text;

-- Índices para el LINK contenido<->pedagogía (join por lección/OA) y para filtrar
-- por rol/tipo en el retrieval tipado.
create index if not exists idx_chunks_curriculum on chunks(corpus_role, unit, lesson);
create index if not exists idx_chunks_oa on chunks(oa) where oa is not null;
create index if not exists idx_chunks_pedagogy_type on chunks(pedagogy_type) where pedagogy_type is not null;

-- -----------------------------------------------------------------------------
-- Retrieval TIPADO: extiende match_chunks_dense/lexical con filtro por
-- corpus_role y devuelve la metadata curricular (para separar el "qué" del
-- "cómo" y priorizar bloques de pedagogía por tipo). Backward-compatible: el
-- parámetro es opcional (default null = todo) y las columnas nuevas se ignoran
-- si el llamador no las usa. DROP+CREATE porque cambia el tipo de retorno.
-- -----------------------------------------------------------------------------
drop function if exists match_chunks_dense(vector, uuid, uuid, int);
create function match_chunks_dense(
  query_embedding vector(1024),
  p_user_id       uuid,
  p_subject_id    uuid default null,
  match_count     int default 20,
  p_corpus_role   text default null
)
returns table (
  chunk_id uuid, document_id uuid, content text, heading_path text,
  page_start int, page_end int, score float,
  corpus_role text, pedagogy_type text, unit int, lesson int, oa text
) language sql stable as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    1 - (c.embedding <=> query_embedding) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa
  from chunks c
  join documents d on d.id = c.document_id
  where d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_id is null or d.subject_id = p_subject_id)
    and (p_corpus_role is null or c.corpus_role = p_corpus_role)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

drop function if exists match_chunks_lexical(text, uuid, uuid, int);
create function match_chunks_lexical(
  query_text    text,
  p_user_id     uuid,
  p_subject_id  uuid default null,
  match_count   int default 20,
  p_corpus_role text default null
)
returns table (
  chunk_id uuid, document_id uuid, content text, heading_path text,
  page_start int, page_end int, score float,
  corpus_role text, pedagogy_type text, unit int, lesson int, oa text
) language sql stable as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    ts_rank_cd(c.content_tsv, plainto_tsquery('spanish', query_text)) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa
  from chunks c
  join documents d on d.id = c.document_id
  where d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_id is null or d.subject_id = p_subject_id)
    and (p_corpus_role is null or c.corpus_role = p_corpus_role)
    and c.content_tsv @@ plainto_tsquery('spanish', query_text)
  order by score desc
  limit match_count;
$$;
