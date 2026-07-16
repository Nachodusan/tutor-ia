-- =============================================================================
-- Tutor IA — Esquema de base de datos (Postgres + pgvector)
-- =============================================================================
-- Aplicar en una base Postgres con la extensión pgvector disponible
-- (Supabase la trae). Ejecutar:  psql "$DATABASE_URL" -f schema.sql
--
-- Nota sobre dimensiones de embeddings:
--   Voyage voyage-3          -> 1024
--   OpenAI text-embedding-3-small -> 1536
-- El valor DEBE coincidir con EMBEDDING_DIM en packages/rag.
-- Aquí usamos 1024 (Voyage). Si cambias de proveedor, ajusta la columna vector.
-- =============================================================================

create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- Utilidad: touch de updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- Usuarios
-- Si usas Supabase Auth, esta tabla puede ser un espejo de auth.users
-- (id = auth.users.id). La dejamos independiente para ser portable.
-- -----------------------------------------------------------------------------
create table if not exists users (
  id          uuid primary key default uuid_generate_v4(),
  email       text unique not null,
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Materias (agrupan el material de estudio de un usuario)
-- -----------------------------------------------------------------------------
create table if not exists subjects (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_subjects_user on subjects(user_id);

-- -----------------------------------------------------------------------------
-- Documentos (un libro/apunte subido, o un material "global" de la biblioteca)
-- owner_user_id NULL  => material global (biblioteca curada, Fase 4)
-- -----------------------------------------------------------------------------
create type document_status as enum ('pending', 'processing', 'ready', 'error');

create table if not exists documents (
  id             uuid primary key default uuid_generate_v4(),
  owner_user_id  uuid references users(id) on delete cascade,   -- NULL = global
  subject_id     uuid references subjects(id) on delete set null,
  title          text not null,
  source_type    text not null default 'pdf',                  -- pdf | text | image
  storage_path   text,                                          -- ruta en el bucket
  status         document_status not null default 'pending',
  error_message  text,
  page_count     int,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_documents_owner on documents(owner_user_id);
create index if not exists idx_documents_subject on documents(subject_id);

-- -----------------------------------------------------------------------------
-- Fragmentos (chunks) con su embedding — la base del RAG
-- -----------------------------------------------------------------------------
create table if not exists chunks (
  id           uuid primary key default uuid_generate_v4(),
  document_id  uuid not null references documents(id) on delete cascade,
  chunk_index  int not null,                 -- orden dentro del documento
  content      text not null,                -- texto del fragmento
  page         int,                          -- página de origen (si aplica)
  token_count  int,
  embedding    vector(1024),                 -- <- ajustar a EMBEDDING_DIM
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_index)
);

-- Índice ANN para búsqueda por similitud coseno.
-- (Crear DESPUÉS de tener datos para mejores estadísticas; aquí queda declarado.)
create index if not exists idx_chunks_embedding
  on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists idx_chunks_document on chunks(document_id);

-- -----------------------------------------------------------------------------
-- Sesiones de estudio (chat) — histórico de conversación
-- -----------------------------------------------------------------------------
create table if not exists study_sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  subject_id  uuid references subjects(id) on delete set null,
  mode        text not null default 'text',   -- text | voice
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_study_sessions_user on study_sessions(user_id);

create table if not exists messages (
  id           uuid primary key default uuid_generate_v4(),
  session_id   uuid not null references study_sessions(id) on delete cascade,
  role         text not null,                 -- user | assistant
  content      text not null,
  citations    jsonb,                         -- [{document_id, chunk_id, page}]
  created_at   timestamptz not null default now()
);
create index if not exists idx_messages_session on messages(session_id);

-- -----------------------------------------------------------------------------
-- Exámenes generados por la IA
-- questions: JSONB con el examen (estructura garantizada por structured outputs)
--   [{ id, type: 'mcq'|'true_false'|'open', prompt, options?, answer, rubric?,
--      source: {document_id, chunk_id, page} }]
-- -----------------------------------------------------------------------------
create table if not exists exams (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  subject_id  uuid references subjects(id) on delete set null,
  title       text not null,
  difficulty  text not null default 'medium', -- easy | medium | hard
  questions   jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_exams_user on exams(user_id);

-- Intentos del estudiante sobre un examen
--   answers: JSONB [{ question_id, response }]
--   grading: JSONB [{ question_id, correct, score, feedback }]
create table if not exists exam_attempts (
  id            uuid primary key default uuid_generate_v4(),
  exam_id       uuid not null references exams(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  answers       jsonb not null,
  grading       jsonb,
  score         numeric(5,2),                 -- 0..100
  submitted_at  timestamptz not null default now()
);
create index if not exists idx_exam_attempts_exam on exam_attempts(exam_id);
create index if not exists idx_exam_attempts_user on exam_attempts(user_id);

-- -----------------------------------------------------------------------------
-- Triggers de updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','subjects','documents','study_sessions']
  loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Búsqueda por similitud (RAG): fragmentos más cercanos a un embedding,
-- restringidos a documentos del usuario y/o globales, opcionalmente por materia.
-- -----------------------------------------------------------------------------
create or replace function match_chunks(
  query_embedding vector(1024),
  p_user_id       uuid,
  p_subject_id    uuid default null,
  match_count     int default 8
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  content      text,
  page         int,
  similarity   float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.page,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where d.status = 'ready'
    and (d.owner_user_id = p_user_id or d.owner_user_id is null)  -- del usuario o globales
    and (p_subject_id is null or d.subject_id = p_subject_id)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
