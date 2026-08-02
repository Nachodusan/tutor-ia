-- =============================================================================
-- EL CURRÍCULO OFICIAL PASA A SER COMPARTIDO.
--
-- Las 73 materias y los 218 documentos se habían ingestado como propiedad del
-- usuario de desarrollo. Con cuentas de alumno reales, cada alumno nuevo veía
-- CERO materias: `/api/subjects` filtraba por `s.user_id = <alumno>`.
--
-- El material es el asignado por el Ministerio: es el mismo para todos. Lo que
-- es de cada alumno es su AVANCE, que vive en otras tablas.
--
-- La convención `NULL = global` YA EXISTÍA en el repo: las funciones de
-- retrieval filtran `(d.owner_user_id = p_user_id or d.owner_user_id is null)`
-- (schema_dual_corpus.sql:78 y :109). Por eso poner NULL no toca el retrieval ni
-- invalida los baselines del eval.
--
-- Efecto secundario deseado: hoy `documents.owner_user_id references users on
-- delete cascade` significa que borrar al usuario dev borraría los 218
-- documentos y sus ~29.000 chunks. Con NULL, eso deja de ser posible.
--
-- Se corre UNA vez; es idempotente (el `where` por el uuid del dev lo hace
-- no-op en la segunda corrida y no toca material que mañana sea de un colegio).
--   psql "$DATABASE_URL" -f packages/db/migrate_shared_corpus.sql
-- =============================================================================

alter table subjects alter column user_id drop not null;

update subjects
   set user_id = null
 where user_id = '00000000-0000-0000-0000-000000000001';

update documents
   set owner_user_id = null
 where owner_user_id = '00000000-0000-0000-0000-000000000001';

comment on column subjects.user_id is
  'NULL = materia del currículo oficial, visible para todos. Con valor = material propio de un colegio (a futuro).';
