-- EL APUNTE DE CADA PARADA DEL CAMINO.
--
-- Misma decisión que `lesson_classes`: se genera OFFLINE y el runtime solo lee.
-- Acá pesa todavía más, porque de un apunte se estudia varias veces — es la
-- pantalla a la que el alumno vuelve, no la que ve una vez.
--
-- Y precomputar lo vuelve auditable: un apunte con un error lo van a estudiar
-- todos los alumnos de esa parada, así que tiene que poder LEERSE antes y
-- corregirse con un update. El precio (el error es sistemático) es el mismo que
-- ya se asumió para la clase, y por las mismas razones.
create table if not exists lesson_notes (
  subject_id  uuid not null references subjects(id) on delete cascade,
  topic_key   text not null,
  -- { idea, puntos[], palabras[], comoAcordarse, ojo, seEvalua[], tresLineas[] }
  -- Cada punto guarda los índices de sus oraciones fuente: sin ellos no se puede
  -- re-verificar una fila vieja contra el corpus.
  apunte      jsonb not null,
  gate        jsonb,
  topic_title text,
  generated_at timestamptz not null default now(),
  primary key (subject_id, topic_key)
);

create index if not exists lesson_notes_gate_idx
  on lesson_notes ((gate->>'corrido'), (gate->>'contradichos'));
