-- =============================================================================
-- BÚSQUEDA EN VARIAS MATERIAS A LA VEZ.
--
-- El retrieval aceptaba UNA materia o NINGUNA (todo el corpus). Para la cascada
-- de alcance —primero el curso del alumno, después la misma asignatura en otros
-- cursos, y recién ahí todo— hace falta el escalón del medio: un CONJUNTO de
-- materias.
--
-- `p_subject_id uuid` pasa a `p_subject_ids uuid[]`. Se reemplaza en vez de
-- agregar funciones `_multi` paralelas: dos pares de funciones casi idénticas
-- divergen en cuanto alguien toque una sola, y el filtro por un elemento es el
-- caso particular de un array de uno. Los llamadores son dos líneas en
-- retrieve-hybrid.ts.
--
-- `= any(array)` usa el índice igual que `=`, así que el plan no cambia para el
-- caso de una materia.
--
-- MATERIAS EN PAUSA: se excluyen acá, en el SQL, y no en cada ruta. Mientras la
-- búsqueda estaba acotada a la materia que el alumno abría, alcanzaba con que la
-- UI no la ofreciera; en cuanto el alcance se amplía, el material de las materias
-- apagadas entraría al pool por la puerta de atrás sin que nadie pueda apagarlo.
-- La materia pedida EXPLÍCITAMENTE se deja pasar (`p_incluir_pausadas`): cortarle
-- la conversación a alguien que la tenía abierta es otra decisión, y no es esta.
--
-- Idempotente. Aplicar después de schema_chunk_provenance.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_multi_subject.sql
-- =============================================================================

drop function if exists match_chunks_dense(vector, uuid, uuid, int, text);
drop function if exists match_chunks_lexical(text, uuid, uuid, int, text);

create or replace function match_chunks_dense(
  query_embedding    vector(1024),
  p_user_id          uuid,
  p_subject_ids      uuid[] default null,
  match_count        int    default 20,
  p_corpus_role      text   default null,
  p_incluir_pausadas boolean default false
)
returns table (
  chunk_id uuid, document_id uuid, content text, heading_path text,
  page_start int, page_end int, score float,
  corpus_role text, pedagogy_type text, unit int, lesson int, oa text,
  document_title text, grade text, subject_id uuid
) language sql stable parallel safe as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    1 - (c.embedding <=> query_embedding) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa,
    d.title, d.grade, d.subject_id
  from chunks c
  join documents d on d.id = c.document_id
  join subjects s on s.id = d.subject_id
  where d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_ids is null or d.subject_id = any(p_subject_ids))
    and (p_corpus_role is null or c.corpus_role = p_corpus_role)
    and (p_incluir_pausadas or s.disabled_at is null)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_chunks_lexical(
  query_text         text,
  p_user_id          uuid,
  p_subject_ids      uuid[] default null,
  match_count        int    default 20,
  p_corpus_role      text   default null,
  p_incluir_pausadas boolean default false
)
returns table (
  chunk_id uuid, document_id uuid, content text, heading_path text,
  page_start int, page_end int, score float,
  corpus_role text, pedagogy_type text, unit int, lesson int, oa text,
  document_title text, grade text, subject_id uuid
) language sql stable parallel safe as $$
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    ts_rank_cd(c.content_tsv, tq.q) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa,
    d.title, d.grade, d.subject_id
  from (select es_or_tsquery(query_text) as q) tq
  cross join chunks c
  join documents d on d.id = c.document_id
  join subjects s on s.id = d.subject_id
  where tq.q is not null
    and d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)
    and (p_subject_ids is null or d.subject_id = any(p_subject_ids))
    and (p_corpus_role is null or c.corpus_role = p_corpus_role)
    and (p_incluir_pausadas or s.disabled_at is null)
    and c.content_tsv @@ tq.q
  order by score desc
  limit match_count;
$$;

comment on function match_chunks_dense(vector, uuid, uuid[], int, text, boolean) is
  'Brazo denso. p_subject_ids null = todo el corpus. Excluye materias en pausa
   salvo p_incluir_pausadas (la que el alumno abrió explícitamente).';
comment on function match_chunks_lexical(text, uuid, uuid[], int, text, boolean) is
  'Brazo léxico (OR entre lexemas). Mismos parámetros que el denso.';
