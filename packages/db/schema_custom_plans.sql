-- =============================================================================
-- PLANES DE ESTUDIO A MEDIDA.
--
-- El plan SUGERIDO (`subject_plans`) sale del índice del libro del curso y es
-- el mismo para todo el curso — por eso su PK es `subject_id` y se cachea una
-- sola vez. Eso está bien y no se toca.
--
-- Este es el otro: el alumno pide los contenidos que QUIERE ("quiero repasar
-- fracciones", "prepararme la prueba de ecosistemas"). Es de UNA persona, así
-- que no puede vivir en la misma tabla.
--
-- ⚠️ LAS CLAVES DE TEMA VAN NAMESPACEADAS CON EL ID DEL PLAN.
-- `student_plan_progress` tiene PK `(user_id, topic_key)` — sin `subject_id`.
-- Si dos planes del mismo alumno usaran la clave nativa de la lección, marcar un
-- tema en uno lo marcaría en el otro. La clave se guarda como `<plan_id>:<key>`.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_custom_plans.sql
-- =============================================================================

create table if not exists student_custom_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  -- NULL = el plan cruza materias ("quiero repasar todo lo de ecosistemas").
  -- Cuando viene, es la materia desde la que el alumno lo pidió.
  subject_id   uuid references subjects(id) on delete set null,
  /** Lo que el alumno escribió, tal cual. Es lo que se le muestra como título
   *  y lo que permite rehacer el plan si el corpus cambia. */
  query        text not null,
  title        text not null,
  items        jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_custom_plans_user on student_custom_plans(user_id, created_at desc);

comment on table student_custom_plans is
  'Planes de estudio pedidos por el alumno. Distinto de subject_plans, que es el
   plan sugerido del curso y se comparte. Las topic_key van prefijadas con el id
   del plan porque student_plan_progress tiene PK (user_id, topic_key).';
