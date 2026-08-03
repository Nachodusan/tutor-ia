-- =============================================================================
-- REPARACIÓN: jsonb guardado con doble codificación
--
-- Síntoma: `select jsonb_typeof(questions) from exams` devuelve 'string' en vez
-- de 'array', y cualquier consulta que trate la columna como lo que es —
-- `jsonb_array_length(questions)` en /api/progress y en el panel del docente —
-- falla con:
--     ERROR 22023: cannot get array length of a scalar
--
-- Causa: el código escribía `${JSON.stringify(x)}::jsonb`. Con la configuración
-- de esta conexión (postgres.js, `prepare: false`) el valor llega ya como json
-- y el cast lo vuelve a envolver, así que en la columna queda el TEXTO del json
-- entre comillas en vez de la estructura. Lo correcto es `sql.json(x)`.
-- Arreglado en el código el 2026-08-02; esto repara lo que ya estaba escrito.
--
-- El daño no era solo el 500: `messages.verification` guarda los veredictos del
-- verificador por oración, que el esquema describe como el dato más valioso del
-- export. Escapado como string, no se puede consultar con operadores jsonb —
-- estaba ahí y a la vez era inservible.
--
-- Idempotente: solo toca las filas cuyo jsonb_typeof es 'string'. Correrlo dos
-- veces no cambia nada la segunda.
--
--   psql "$DATABASE_URL" -f packages/db/repair_jsonb_double_encoded.sql
--
-- `x #>> '{}'` extrae el texto de un escalar jsonb; volver a castear a jsonb lo
-- reinterpreta como la estructura que siempre tendría que haber sido.
-- =============================================================================

begin;

update messages set
  citations    = case when jsonb_typeof(citations)    = 'string' then (citations    #>> '{}')::jsonb else citations    end,
  verification = case when jsonb_typeof(verification) = 'string' then (verification #>> '{}')::jsonb else verification end,
  meta         = case when jsonb_typeof(meta)         = 'string' then (meta         #>> '{}')::jsonb else meta         end
where jsonb_typeof(citations)    = 'string'
   or jsonb_typeof(verification) = 'string'
   or jsonb_typeof(meta)         = 'string';

update exams set questions = (questions #>> '{}')::jsonb
where jsonb_typeof(questions) = 'string';

update exam_attempts set
  answers = case when jsonb_typeof(answers) = 'string' then (answers #>> '{}')::jsonb else answers end,
  grading = case when jsonb_typeof(grading) = 'string' then (grading #>> '{}')::jsonb else grading end
where jsonb_typeof(answers) = 'string' or jsonb_typeof(grading) = 'string';

update subject_plans set items = (items #>> '{}')::jsonb
where jsonb_typeof(items) = 'string';

commit;

-- Comprobación: las cuatro tablas tienen que dar 0.
select 'messages'      as tabla, count(*) as mal from messages
  where jsonb_typeof(citations) = 'string' or jsonb_typeof(verification) = 'string' or jsonb_typeof(meta) = 'string'
union all select 'exams',         count(*) from exams         where jsonb_typeof(questions) = 'string'
union all select 'exam_attempts', count(*) from exam_attempts where jsonb_typeof(answers) = 'string' or jsonb_typeof(grading) = 'string'
union all select 'subject_plans', count(*) from subject_plans where jsonb_typeof(items) = 'string';
