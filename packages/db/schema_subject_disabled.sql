-- =============================================================================
-- MATERIAS DESACTIVABLES
--
-- Hace falta poder sacar una materia de circulación SIN borrarla: mientras se
-- revisa si el libro cargado es el que corresponde, o mientras falta material,
-- es mejor que no aparezca a que un alumno estudie de un libro equivocado.
--
-- `disabled_at` y no un booleano `activa`, por dos razones:
--   1. Guarda CUÁNDO se apagó. Un booleano no dice si fue ayer o en marzo.
--   2. Es el mismo idioma que `users.disabled_at`, donde ya se decidió apagar en
--      vez de borrar (borrar la materia cascadearía documentos, chunks y el
--      progreso de todos los alumnos que la hayan tocado).
--
-- El filtro va en las RUTAS, no en una vista: cada ruta decide si le corresponde
-- (subjects, plan y test la esconden; documents NO, porque el admin tiene que
-- poder seguir viendo y arreglando el material de una materia apagada).
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_subject_disabled.sql
-- =============================================================================

alter table subjects add column if not exists disabled_at timestamptz;

-- Índice parcial: la consulta normal pide "las que NO están apagadas", y con
-- pocas apagadas este índice es chico y sirve exactamente para eso.
create index if not exists idx_subjects_activas on subjects(id) where disabled_at is null;

comment on column subjects.disabled_at is
  'Cuándo se sacó la materia de circulación. NULL = activa. Se apaga, no se borra:
   borrarla cascadearía documentos, chunks y el progreso de todos los alumnos.
   Se maneja con: pnpm --filter @tutor-ia/admin subjects desactivar --materia "Inglés"';
