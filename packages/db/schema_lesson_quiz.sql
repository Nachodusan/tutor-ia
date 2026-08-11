-- =============================================================================
-- PREGUNTAS POR LECCIÓN — el chequeo de cada nodo del camino.
--
-- La simulación de prueba (`exams`) es POR MATERIA: ~8 preguntas repartidas por
-- todo el libro, y cada intento genera una nueva. Esto es otra cosa: 3 preguntas
-- de UNA lección, iguales para todos los alumnos de esa materia, y cacheadas.
--
-- Por qué cacheadas y no por alumno:
--   · Son ~3 × 306 lecciones ≈ 900 preguntas. Generarlas en cada visita costaría
--     una llamada al modelo (más la de verificación de clave) por cada chico que
--     abre una lección, y son las mismas preguntas.
--   · El primero que entra a una lección paga la espera; el resto del curso, no.
--
-- ⚠️ LA CLAVE VIVE ACÁ Y NO SALE. `items` guarda `correct` y `explain`; la ruta
-- que sirve las preguntas los saca antes de responder, y la corrección se hace
-- contra esta fila. Cuando la clave viajaba al navegador, cualquier chico con la
-- pestaña Red abierta la veía.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_lesson_quiz.sql
-- =============================================================================

create table if not exists lesson_quizzes (
  subject_id  uuid not null references subjects(id) on delete cascade,
  -- La clave ESTABLE de la lección (`PlanItem.key`), no un uuid de chunk: el
  -- golden ya aprendió que un uuid no sobrevive a una re-ingesta, y acá pasaría
  -- lo mismo — se perderían las preguntas de todo el corpus al reingestar.
  topic_key   text not null,
  items       jsonb not null,
  /** Título de la lección al momento de generar. Solo para poder auditar a mano
   *  qué preguntas se hicieron sin cruzar contra el plan. */
  topic_title text not null default '',
  created_at  timestamptz not null default now(),
  primary key (subject_id, topic_key)
);

comment on table lesson_quizzes is
  'Preguntas de chequeo de cada lección del camino. Compartidas por todos los
   alumnos de la materia y cacheadas: el primero que abre la lección paga la
   generación. items incluye la CLAVE (correct/explain), que nunca se sirve al
   cliente — la corrección se hace server-side contra esta fila.';

-- ── INTENTOS ────────────────────────────────────────────────────────────────
-- Cuántas acertó el alumno en cada lección. Es lo que decide el color del nodo
-- en el camino, y lo que hace que "avance" signifique algo más que un tilde que
-- el chico se puso solo.
--
-- Se guarda el ÚLTIMO intento, no todos: la pregunta que responde esta tabla es
-- "¿cómo le fue en esta lección?", y un historial completo de reintentos no la
-- responde mejor. Si algún día se quiere la curva, va en una tabla aparte.
create table if not exists lesson_quiz_attempts (
  user_id     uuid not null references users(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  topic_key   text not null,
  score       int  not null,
  total       int  not null,
  /** Índices de las preguntas que falló, para poder mostrarlas al reintentar. */
  wrong       jsonb not null default '[]'::jsonb,
  answered_at timestamptz not null default now(),
  primary key (user_id, topic_key)
);

create index if not exists idx_lqa_subject on lesson_quiz_attempts(user_id, subject_id);

comment on table lesson_quiz_attempts is
  'Último intento del alumno en las preguntas de una lección. PK (user_id,
   topic_key) igual que student_plan_progress: la lección es la unidad de
   avance, y reintentar pisa el intento anterior.';
