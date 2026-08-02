-- =============================================================================
-- Arreglo del brazo léxico: AND -> OR.
--
-- plainto_tsquery une TODOS los lexemas con '&': una pregunta de 8 palabras
-- exige que las 8 aparezcan en el mismo chunk. Medido sobre el golden de Lengua
-- 8º (2026-08-01): el brazo léxico devolvía 0 filas en 66/72 preguntas (92%) con
-- la formulación del libro y en 43/43 (100%) con la formulación de alumno — el
-- RRF degeneraba a denso puro sin registro. Con los MISMOS lexemas unidos por
-- '|', 0 filas pasa a 0% y el chunk esperado entra al top-20 léxico en el 96%
-- (golden) y 81% (parafraseadas).
--
-- El ranking sigue siendo ts_rank_cd, que ya premia cantidad y proximidad de
-- lexemas encontrados: el OR abre el candidato, el rank ordena. SIN flag de
-- normalización por longitud: se probó el flag 32 contra el 0 y los resultados
-- fueron idénticos en ambos sets.
--
-- Por qué replace('&','|') y no otra cosa:
--  * websearch_to_tsquery también une términos sueltos con '&' (solo agrega
--    operadores de búsqueda que un alumno no escribe).
--  * construir el tsquery en TS obligaría a replicar stemmer y stopwords del
--    español de Postgres, divergiendo de content_tsv en silencio.
--  * plainto_tsquery nunca emite '<->' ni '!', así que '&' es el único operador
--    presente y el replace es total.
--
-- Idempotente. Aplicar DESPUÉS de schema_dual_corpus.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_lexical_or.sql
-- ROLLBACK: re-aplicar packages/db/schema_dual_corpus.sql (conserva la versión
-- AND con la misma firma).
-- =============================================================================

create or replace function es_or_tsquery(q text)
returns tsquery
language sql immutable parallel safe as $$
  select nullif(
           replace(plainto_tsquery('spanish', coalesce(q, ''))::text, '&', '|'),
           ''
         )::tsquery;
$$;

comment on function es_or_tsquery(text) is
  'tsquery en español con los lexemas unidos por OR. NULL si la consulta queda vacía tras stopwords.';

create or replace function match_chunks_lexical(
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
) language sql stable parallel safe as $$
  -- El tsquery se calcula UNA vez (subconsulta escalar) y la MISMA instancia
  -- alimenta el filtro y el ranking: antes eran dos llamadas a plainto_tsquery
  -- que podían divergir si alguien tocaba una sola.
  select
    c.id, c.document_id, c.content, c.heading_path, c.page_start, c.page_end,
    ts_rank_cd(c.content_tsv, tq.q) as score,
    c.corpus_role, c.pedagogy_type, c.unit, c.lesson, c.oa
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
