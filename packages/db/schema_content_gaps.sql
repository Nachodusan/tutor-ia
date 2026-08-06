-- =============================================================================
-- Registro de HUECOS DE MATERIAL — qué preguntan los alumnos que su libro no cubre
-- =============================================================================
-- Idempotente: se puede re-ejecutar. Aplicar DESPUÉS de schema.sql.
--   psql "$DATABASE_URL" -f packages/db/schema_content_gaps.sql
--
-- Cada fila es UN turno del chat cuyo material NO salió del libro del curso del
-- alumno (scope != 'curso'). Sirve para decidir con demanda real qué material
-- conseguir o ingestar después, en vez de adivinar.
--
-- PRIVACIDAD — dos decisiones estructurales:
--   1. SIN user_id, a propósito: el hueco es del CORPUS, no del alumno. No hay
--      forma de reconstruir quién preguntó qué desde esta tabla.
--   2. Esta tabla es para el CLI de admin. NUNCA exponerla en /api/teacher:
--      `question` conserva la formulación del alumno (truncada), y la promesa
--      del producto es que el docente jamás ve lo que un chico escribe. Si
--      algún día se quiere mostrar al docente, hay que normalizar a TEMA
--      ("fotosíntesis") primero y mostrar solo el agregado.
-- =============================================================================

create table if not exists content_gaps (
  id          uuid primary key default uuid_generate_v4(),
  -- La materia que el alumno tenía abierta al preguntar.
  subject_id  uuid references subjects(id) on delete cascade,
  -- Curso del alumno ("7B", "1M"): dice QUÉ libro le faltó. Nullable (sin perfil).
  grade       text,
  -- La pregunta, truncada a 200 chars. Ver el aviso de privacidad de arriba.
  question    text not null,
  -- Hasta dónde hubo que ir: 'otro_curso' | 'otra_materia' | 'ninguno'.
  scope       text not null,
  -- Con qué se respondió: 'libro' | 'apoyado' | 'general'.
  mode        text not null,
  -- Mejor score del retrieval: distingue "no está para nada" (~0) de
  -- "está pero se encontró/encuadró mal" (alto).
  top_score   real,
  created_at  timestamptz not null default now()
);

create index if not exists idx_content_gaps_subject on content_gaps(subject_id);
create index if not exists idx_content_gaps_created on content_gaps(created_at);
