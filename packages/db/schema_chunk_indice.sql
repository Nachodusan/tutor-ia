-- =============================================================================
-- LOS ÍNDICES DE LOS LIBROS DEJAN DE SER MATERIAL CITABLE.
--
-- ── El problema ────────────────────────────────────────────────────────────
-- La tabla de contenidos de un libro entra a la ingesta como cualquier otra
-- página y queda con `corpus_role='content'`, o sea CITABLE. Un fragmento que
-- dice "Síntesis..............42 Evaluación final..........44" puede llegar al
-- prompt como material del alumno y aparecer en una cita.
--
-- No responde nada: es una lista de títulos con números de página. Ocupa lugar
-- en los 6 chunks de contenido que entran por turno y, cuando gana el ranking,
-- desplaza material que sí enseña.
--
-- ── Cómo se detectan, y por qué así ────────────────────────────────────────
-- Por los PUNTOS GUÍA seguidos de número de página (`....... 42`), que es la
-- firma tipográfica de un índice. Se pide que aparezcan **3 o más veces** en el
-- mismo fragmento: un índice real enumera, y ese corte deja afuera los falsos
-- positivos que sí aparecían con criterios más flojos —una tabla de datos de
-- Matemática 6º cuyos puntos venían de los decimales, y un pie de página con
-- "Cuaderno de Actividades páginas 31 y 32".
--
-- Se descartó el criterio indirecto (densidad de palabras funcionales del
-- español): marcaba los 1.085 chunks de los libros de INGLÉS, que están en
-- inglés y por eso tienen densidad baja. Un proxy mide otra cosa.
--
-- ── Qué NO hace ────────────────────────────────────────────────────────────
-- No borra nada. Marca `content_type='index'`, y el retrieval de contenido los
-- excluye. El texto sigue en la base: sirve para reconstruir el índice de un
-- libro (`book_sections`) y para auditar, que son usos legítimos — lo que no es
-- legítimo es citárselo a un alumno como si le explicara algo.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_chunk_indice.sql
-- =============================================================================

update chunks c
   set content_type = 'index'
  from documents d
 where d.id = c.document_id
   and c.corpus_role = 'content'
   and c.content_type <> 'index'
   and (select count(*) from regexp_matches(c.content, '\.{4,}\s*\d+', 'g')) >= 3;

-- El retrieval filtra por content_type, así que conviene que el índice parcial
-- lo cubra: son ~200 filas sobre 39.000 y la consulta las excluye en todos los
-- turnos.
create index if not exists idx_chunks_no_indice
  on chunks (document_id) where content_type <> 'index';

comment on column chunks.content_type is
  'prose | table | figure_caption | index. "index" es la tabla de contenidos del
   libro: se conserva para reconstruir book_sections y auditar, pero el retrieval
   de contenido la excluye — no responde nada y desplaza material que sí enseña.';

-- ── El retrieval los excluye ────────────────────────────────────────────────
-- Se redefinen las dos funciones de `schema_multi_subject.sql` agregando UNA
-- condición. Van acá, y no editando aquel archivo, para que esta migración sea
-- autocontenida: quien la corra queda con el marcado Y con el filtro, sin tener
-- que acordarse de volver a aplicar la otra.
--
-- El filtro va en la BASE y no en TypeScript a propósito: los dos brazos —denso
-- y léxico— tienen que coincidir, y el léxico es el que más los levantaba (un
-- índice repite los títulos del libro, así que empata con casi cualquier
-- consulta sobre sus temas).

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
    and c.content_type <> 'index'
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
    and c.content_type <> 'index'
    and c.content_tsv @@ tq.q
  order by score desc
  limit match_count;
$$;
