-- =============================================================================
-- Plan v2 — Modelo del alumno + metadata de chunks (§3, §6)
-- =============================================================================
-- Idempotente: se puede re-ejecutar. Aplicar DESPUÉS de schema.sql.
--   psql "$DATABASE_URL" -f packages/db/schema_student_model.sql
--
-- "Diez líneas de SQL hoy, imposible en tres meses": si attempt_items no lleva
-- concept_id desde el día uno, después hay que backfillear o tirar los datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Metadata de chunks (§3). Sin esto la cita es inútil: hay que poder decir
-- "pág. 87, §3.2 — Definición ε-δ" y resaltar la región del PDF.
-- -----------------------------------------------------------------------------
alter table chunks add column if not exists heading_path text;      -- "Cap. 3 › 3.2 › Def."
alter table chunks add column if not exists bbox         jsonb;      -- región(es) en el PDF
alter table chunks add column if not exists content_type text not null default 'prose';
                                                                     -- prose | formula | table | figure_caption
alter table chunks add column if not exists page_start   int;
alter table chunks add column if not exists page_end     int;

-- -----------------------------------------------------------------------------
-- Conceptos (grafo, no lista). Salen de la extracción en batch durante la
-- ingesta (§3). Alimentan el modelo del alumno y el selector de próximo ítem.
-- -----------------------------------------------------------------------------
create table if not exists concepts (
  id          uuid primary key default uuid_generate_v4(),
  subject_id  uuid references subjects(id) on delete cascade,
  name        text not null,
  description text,
  embedding   vector(1024),
  parent_id   uuid references concepts(id) on delete set null,  -- grafo
  created_at  timestamptz not null default now()
);
create index if not exists idx_concepts_subject on concepts(subject_id);
create index if not exists idx_concepts_parent on concepts(parent_id);
create index if not exists idx_concepts_embedding
  on concepts using hnsw (embedding vector_cosine_ops);

-- N:M chunk <-> concepto, con peso de asociación.
create table if not exists chunk_concepts (
  chunk_id    uuid not null references chunks(id) on delete cascade,
  concept_id  uuid not null references concepts(id) on delete cascade,
  weight      real not null default 1.0,
  primary key (chunk_id, concept_id)
);
create index if not exists idx_chunk_concepts_concept on chunk_concepts(concept_id);

-- -----------------------------------------------------------------------------
-- Misconceptions (errores típicos por concepto). Se siembran en batch
-- ("dado este concepto, listá los 5 errores típicos"). El clasificador de la
-- máquina de estados pedagógica (§5) elige entre estas opciones cerradas.
-- -----------------------------------------------------------------------------
create table if not exists misconceptions (
  id          uuid primary key default uuid_generate_v4(),
  concept_id  uuid not null references concepts(id) on delete cascade,
  label       text not null,           -- p.ej. "confunde_regla_cadena_con_producto"
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_misconceptions_concept on misconceptions(concept_id);

-- -----------------------------------------------------------------------------
-- Banco de preguntas normalizado (§1.4, §4-C). Precomputado y VALIDADO en la
-- ingesta; en runtime "generame un examen" es un SELECT. exam_id es NULL para
-- preguntas del banco que aún no pertenecen a un examen concreto.
-- -----------------------------------------------------------------------------
create table if not exists questions (
  id              uuid primary key default uuid_generate_v4(),
  exam_id         uuid references exams(id) on delete set null,
  subject_id      uuid references subjects(id) on delete cascade,
  concept_id      uuid references concepts(id) on delete set null,
  source_chunk_id uuid references chunks(id) on delete set null,
  quote           text,                 -- cita literal verificada (A2)
  type            text not null,        -- mcq | true_false | open
  body            jsonb not null,       -- enunciado + opciones (según tipo)
  key             jsonb not null,       -- respuesta correcta / puntos clave / rúbrica
  validated       boolean not null default false, -- pasó C1 (re-respuesta)
  created_at      timestamptz not null default now()
);
create index if not exists idx_questions_subject on questions(subject_id);
create index if not exists idx_questions_concept on questions(concept_id);
create index if not exists idx_questions_exam on questions(exam_id);

-- -----------------------------------------------------------------------------
-- Ítems de intento, con concept_id y misconception para el modelo del alumno.
-- -----------------------------------------------------------------------------
create table if not exists attempt_items (
  id               uuid primary key default uuid_generate_v4(),
  attempt_id       uuid not null references exam_attempts(id) on delete cascade,
  question_id      uuid not null references questions(id) on delete cascade,
  concept_id       uuid references concepts(id) on delete set null,
  response         jsonb,
  correct          boolean,
  hint_level_used  int not null default 0,
  ms_taken         int,
  misconception_id uuid references misconceptions(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_attempt_items_attempt on attempt_items(attempt_id);
create index if not exists idx_attempt_items_concept on attempt_items(concept_id);

-- -----------------------------------------------------------------------------
-- Dominio por concepto: BKT (p_known) + FSRS (stability/difficulty/next_review).
-- -----------------------------------------------------------------------------
create table if not exists concept_mastery (
  user_id     uuid not null references users(id) on delete cascade,
  concept_id  uuid not null references concepts(id) on delete cascade,
  -- BKT
  p_known     real not null default 0.1,
  -- FSRS
  stability   real,
  difficulty  real,
  next_review timestamptz,
  last_seen   timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, concept_id)
);
create index if not exists idx_concept_mastery_review on concept_mastery(user_id, next_review);
