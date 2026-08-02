-- =============================================================================
-- LOGIN DEL ALUMNO (anónimo) + ESTADO PERSISTIDO + CONVERSACIONES
--
-- Contexto: hasta 2026-08 el tutor no tenía usuarios (`getCurrentUserId` era un
-- stub que devolvía siempre el mismo uuid) y TODO el estado del alumno vivía en
-- localStorage del navegador: el perfil con su NOMBRE, el plan por materia y los
-- temas que le fallaron. Efecto colateral: "Cambiar de alumno" borraba solo el
-- perfil, así que el alumno siguiente heredaba el progreso del anterior.
--
-- Los usuarios son MENORES y las credenciales las reparte el colegio en papel.
-- De ahí las dos reglas que ordenan este esquema:
--   1. CERO datos personales. No hay nombre, no hay email, no hay curso-división.
--      La identidad es un username no identificatorio ("7b-01") cuyo mapeo a un
--      alumno real vive en papel en el colegio, nunca acá.
--   2. La base se va a EXPORTAR. Nada que se guarde puede ser un secreto vivo:
--      de la contraseña va el hash, del token de sesión va el sha256.
--
-- Idempotente. Aplicar después de schema.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_auth.sql
-- =============================================================================

-- ── USUARIOS ────────────────────────────────────────────────────────────────
-- `email` era UNIQUE NOT NULL. Se relaja a nullable: un alumno no tiene email y
-- pedirle uno sería justamente el dato personal que no queremos. El índice
-- UNIQUE se conserva y en Postgres admite múltiples NULL, así que 500 alumnos
-- sin email conviven sin tocarlo.
alter table users alter column email drop not null;

alter table users add column if not exists username      text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists role          text not null default 'student';
-- Apagar una cuenta filtrada SIN borrarla: borrar el usuario cascadearía todo su
-- progreso por las 6 FKs `on delete cascade` que apuntan a users.
alter table users add column if not exists disabled_at   timestamptz;

-- Único case-insensitive: el alumno escribe "7B-01" en el teléfono y entra igual.
-- La normalización se aplica también en el login y en el CLI.
create unique index if not exists uq_users_username on users (lower(username));

-- El nombre personal se ELIMINA. Es lo que convierte "no guardamos nombres" de
-- promesa en propiedad verificable del dump: no queda dónde escribirlo.
alter table users drop column if exists name;

-- ── SESIONES DE LOGIN ───────────────────────────────────────────────────────
-- Sesión en la base y no JWT firmado: el requisito es poder REVOCAR si una
-- credencial repartida en papel se filtra, y un JWT stateless no se revoca. El
-- round-trip a Postgres es irrelevante contra rutas que tardan 10-60 s generando.
create table if not exists auth_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  -- sha256 del token, NUNCA el token. Un dump con tokens vivos es un dump con
  -- sesiones robables. sha256 alcanza porque el token son 32 bytes aleatorios:
  -- no hay fuerza bruta posible y el lookup queda O(1) por el índice único.
  token_hash   bytea not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists idx_auth_sessions_user   on auth_sessions(user_id) where revoked_at is null;
create index if not exists idx_auth_sessions_expiry on auth_sessions(expires_at);

-- ── PERFIL DEL ALUMNO ───────────────────────────────────────────────────────
-- El curso lo elige el alumno la PRIMERA vez que entra y queda en su cuenta.
create table if not exists student_profiles (
  user_id      uuid primary key references users(id) on delete cascade,
  grade        text,                                  -- "7B" | "1M" …
  grade_set_at timestamptz,
  tts_on       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Tabla de unión en vez de un uuid[]: da integridad referencial (si se borra una
-- materia desaparece sola del panel, en vez de dejar un uuid colgado) y queda
-- consultable para el análisis del piloto.
create table if not exists student_priority_subjects (
  user_id    uuid not null references users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  position   int  not null default 0,
  primary key (user_id, subject_id)
);

-- ── PLAN DE ESTUDIO ─────────────────────────────────────────────────────────
-- El plan sale del ÍNDICE del libro y el libro es idéntico para todo el curso:
-- se guarda UNA vez por materia. Generarlo por alumno serían 35 llamadas al LLM
-- para producir 35 veces lo mismo.
create table if not exists subject_plans (
  subject_id   uuid primary key references subjects(id) on delete cascade,
  items        jsonb not null,
  generated_at timestamptz not null default now()
);

-- El AVANCE sí es por alumno, y se guarda por CLAVE ESTABLE del tema, no por su
-- posición en la lista: hoy el cliente guarda el índice `n`, así que al
-- regenerar el plan el progreso pasaba a apuntar a otra lección. `/api/plan` ya
-- devuelve esa clave.
create table if not exists student_plan_progress (
  user_id    uuid not null references users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  topic_key  text not null,
  done_at    timestamptz not null default now(),
  primary key (user_id, topic_key)
);
create index if not exists idx_plan_progress_subject on student_plan_progress(user_id, subject_id);

-- ── TEMAS PARA REFORZAR ─────────────────────────────────────────────────────
-- Mismo arreglo de identidad: el cliente los buscaba por el TEXTO del tema, que
-- el LLM reescribe distinto en cada generación de prueba — así el tema nunca
-- salía de la lista aunque el alumno lo acertara después.
create table if not exists student_weak_topics (
  user_id    uuid not null references users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  topic_key  text not null,
  topic      text not null,        -- etiqueta legible, se refresca al escribir
  unit       int,
  lesson     int,
  misses     int  not null default 1,
  last_at    timestamptz not null default now(),
  primary key (user_id, subject_id, topic_key)
);

-- ── CONVERSACIONES ──────────────────────────────────────────────────────────
-- Se REUSAN `study_sessions` y `messages`, que ya existían con la forma correcta
-- y estaban vacías y sin referenciar desde ningún archivo del código. Crear
-- tablas paralelas dejaría dos esquemas casi idénticos, uno muerto.
alter table study_sessions add column if not exists title           text;
alter table study_sessions add column if not exists last_message_at timestamptz not null default now();

-- `ord` da un orden total estable dentro de la sesión (created_at puede empatar
-- al milisegundo). Es seguro agregarlo como bigserial justamente porque la tabla
-- está vacía: hacerlo sobre una tabla con datos la reescribe entera.
alter table messages add column if not exists ord          bigserial;
alter table messages add column if not exists grounded     boolean;
-- El resultado del verificador NLI por oración: el hueco que tenía el esquema.
-- Es el dato más valioso del export — permite auditar deriva a posteriori sin
-- volver a correr nada.
alter table messages add column if not exists verification jsonb;
-- El mismo objeto que ya se le pasa a logDecision (topScore, cause, ranker, ms…).
alter table messages add column if not exists meta         jsonb;
create index if not exists idx_messages_ord on messages(session_id, ord);

-- `last_message_at` se mantiene solo: nadie se lo puede olvidar.
create or replace function touch_session_on_message() returns trigger
language plpgsql as $$
begin
  update study_sessions set last_message_at = new.created_at where id = new.session_id;
  return new;
end $$;

drop trigger if exists trg_messages_touch on messages;
create trigger trg_messages_touch after insert on messages
  for each row execute function touch_session_on_message();

-- ── RETENCIÓN: MECANISMO LISTO, APAGADO A PROPÓSITO ─────────────────────────
create index if not exists idx_study_sessions_retention on study_sessions(last_message_at);

create or replace function purge_conversations_older_than(p_days int)
returns bigint language plpgsql as $$
declare n bigint;
begin
  delete from study_sessions
   where last_message_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;   -- los mensajes caen por ON DELETE CASCADE
end $$;

comment on function purge_conversations_older_than(int) is
  'Retención de conversaciones. SIN schedule por decisión de producto (2026-08-02):
   se guarda todo y el plazo se define después. Para activarlo cuando se decida:
     select cron.schedule(''purge-conv'', ''0 3 * * *'',
                          $$select purge_conversations_older_than(365)$$);
   Ensayo OBLIGATORIO antes de programarlo:
     select count(*) from study_sessions where last_message_at < now() - interval ''365 days'';';

comment on table auth_sessions is
  'Sesiones de login. Guarda sha256 del token, nunca el token: la base se exporta.';
comment on column users.username is
  'Identificador NO identificatorio ("7b-01"). El mapeo a un alumno real vive en papel en el colegio.';
