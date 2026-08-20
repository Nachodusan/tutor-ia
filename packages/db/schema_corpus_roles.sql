-- =============================================================================
-- LOS ROLES DEL CORPUS, cerrados con CHECK.
--
-- `chunks.corpus_role` y `documents.kind` son `text` con default `'content'` y
-- sin ninguna restricción (packages/db/schema_dual_corpus.sql:22 y :38). Eso deja
-- dos agujeros distintos, y conviene no confundirlos porque se cierran en lugares
-- distintos:
--
--   1. TYPO — insertar 'contenido' o 'Content' y que la base lo acepte. El chunk
--      queda invisible para siempre: el retrieval pide `corpus_role = 'content'`
--      exacto. Eso lo cierra este archivo.
--
--   2. OMISIÓN — insertar sin la columna y que caiga a `'content'`, o sea que
--      cualquier material se convierta en "libro del Mineduc" sin que nadie lo
--      decida. **Este archivo NO cierra eso**, y es importante decirlo: un insert
--      sin la columna pasa el CHECK igual. Se cierra en TypeScript, haciendo
--      `corpusRole` obligatorio en `ingestDocumentV2` (packages/rag/src/ingest-v2.ts)
--      para que el compilador rompa en cada llamador.
--
-- El default se deja como está a propósito: sacarlo rompería en el acto todo
-- insert que hoy no lista la columna, y la protección real ya está en el tipo.
--
-- ── Por qué se agrega 'web' ──────────────────────────────────────────────────
-- El mapa curricular (curriculum_map) dejó 42 conocimientos que el Estado exige y
-- ningún libro cargado cubre. El material que se produzca para taparlos no sale
-- del libro del alumno y no puede citarse como si lo fuera: lleva rol propio.
--
-- Idempotente. Aplicar después de schema_dual_corpus.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_corpus_roles.sql
-- =============================================================================

-- Falla y hace rollback si hay alguna fila fuera del conjunto: es la forma
-- correcta de enterarse, mucho mejor que descubrirlo por un chunk que no aparece.
alter table chunks drop constraint if exists chunks_corpus_role_valido;
alter table chunks add constraint chunks_corpus_role_valido
  check (corpus_role in ('content', 'pedagogy', 'web'));

alter table documents drop constraint if exists documents_kind_valido;
alter table documents add constraint documents_kind_valido
  check (kind in ('content', 'pedagogy', 'web'));

comment on column chunks.corpus_role is
  'content = texto del estudiante · pedagogy = guía del docente · web = material
   producido para tapar un hueco declarado del mapa curricular.
   OJO: la columna tiene default ''content''. El CHECK impide typos, NO impide la
   omisión. Quien inserta tiene que decidirlo: ingestDocumentV2 lo exige en el tipo.';

-- ── El invariante que un CHECK no puede expresar ────────────────────────────
-- El rol del chunk y el del documento del que cuelga tienen que coincidir. Un
-- CHECK vive en una sola fila y no puede mirar la tabla de al lado; esto se
-- comprueba corriendo la consulta, y debería dar 0 siempre:
--
--   select count(*) from chunks c join documents d on d.id = c.document_id
--   where d.kind <> c.corpus_role;
--
-- Si da distinto de 0 hay un documento cuyos chunks se citan con un rol que su
-- documento no tiene, que es exactamente el caso en que el sello miente.
