-- =============================================================================
-- PROCEDENCIA EN EL RETRIEVAL: de qué LIBRO y de qué CURSO salió cada fragmento.
--
-- Hasta ahora las funciones de búsqueda devolvían página y unidad, pero NO el
-- título del documento ni el grado. Mientras la búsqueda estaba acotada a una
-- materia daba igual: el alumno sabía que estaba leyendo su propio libro. En
-- cuanto el tutor puede traer material de OTRO curso, "pág. 87" deja de decir
-- nada — el chico no puede saber si eso salió de su libro o del de 4º Medio.
--
-- El `join documents d` YA existía en las dos funciones (se usa para filtrar por
-- dueño y materia), así que devolver dos columnas más no agrega ni un scan.
--
-- Las funciones se reemplazan con `create or replace` y la MISMA firma de
-- entrada: cambia el `returns table`, que Postgres permite reemplazar mientras
-- los parámetros no cambien. Rollback = volver a correr los .sql anteriores.
--
-- Idempotente. Aplicar DESPUÉS de schema_dual_corpus.sql y schema_lexical_or.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_chunk_provenance.sql
-- =============================================================================

-- Postgres no deja cambiar el `returns table` con `create or replace`: hay que
-- soltar y recrear. Las firmas de ENTRADA quedan idénticas, así que ningún
-- llamador cambia salvo por las dos columnas nuevas.
drop function if exists match_chunks_dense(vector, uuid, uuid, int, text);
drop function if exists match_chunks_lexical(text, uuid, uuid, int, text);

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
  corpus_role text, pedagogy_type text, unit int, lesson int, oa text,
  document_title text, grade text
) language sql stable parallel safe as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    1 - (c.embedding <=> query_embedding) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa,
    d.title, d.grade
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
  corpus_role text, pedagogy_type text, unit int, lesson int, oa text,
  document_title text, grade text
) language sql stable parallel safe as $$
  -- El tsquery se calcula UNA vez (subconsulta escalar) y la MISMA instancia
  -- alimenta el filtro y el ranking. Ver schema_lexical_or.sql para el porqué
  -- del OR entre lexemas.
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    ts_rank_cd(c.content_tsv, tq.q) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa,
    d.title, d.grade
  from (select es_or_tsquery(query_text) as q) tq
  cross join chunks c
  join documents d on d.id = c.document_id
  where tq.q is not null
    and d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_id is null or d.subject_id = p_subject_id)
    and (p_corpus_role is null or c.corpus_role = p_corpus_role)
    and c.content_tsv @@ tq.q
  order by score desc
  limit match_count;
$$;

comment on function match_chunks_dense(vector, uuid, uuid, int, text) is
  'Brazo denso del retrieval híbrido. Devuelve title/grade del documento para que
   la cita pueda decir de qué libro y de qué curso salió el fragmento.';
comment on function match_chunks_lexical(text, uuid, uuid, int, text) is
  'Brazo léxico (OR entre lexemas). Devuelve title/grade igual que el denso.';
