-- =============================================================================
-- EL CURSO de cada conocimiento del currículum, y CÓMO se supo.
--
-- El currículum EPJA define por NIVEL, no por curso: "Nivel 3 Educación Básica"
-- abarca 7º y 8º con un solo juego de conocimientos. Pero la app está organizada
-- por curso —`subjects` es "Matemática 7º", no "Matemática Nivel 3"— y un alumno
-- estudia en un año concreto. Entre esas dos formas de contar hay que decidir, y
-- la decisión tiene que quedar escrita.
--
-- ── Por qué DOS columnas y no una ────────────────────────────────────────────
-- Porque "1º Medio" a secas, dentro de tres meses, no se sabe si lo dijo el libro,
-- lo dijo el currículum regular, o lo puso alguien a ojo. `curso_evidencia` guarda
-- el porqué, y sin él la columna de arriba es una opinión anónima.
--
-- ── Los cuatro orígenes ──────────────────────────────────────────────────────
--   'libro'         — el libro de ESE curso lo enseña y el del otro no. El mejor:
--                     lo desempata el material que el alumno tiene en la mano.
--   'ambos_cursos'  — los dos libros del nivel lo enseñan. No hace falta elegir;
--                     el conocimiento es del nivel entero y así se queda.
--   'regular'       — lo desempató el currículum REGULAR, que sí asigna cada
--                     objetivo a un año (curriculumnacional.cl). Se usa cuando
--                     ningún libro del nivel lo trae. `curso_evidencia` lleva el
--                     código del OA regular.
--   'sin_resolver'  — se miró y no alcanzó. Es un dato, no un faltante.
--
-- ── El caso incómodo, y por qué la columna admite un curso de OTRO nivel ─────
-- EPJA comprime el currículum regular, así que un nivel puede exigir contenido
-- que en el sistema regular vive fuera de su equivalencia. Medido: "Biodiversidad
-- en Chile" y "Sistema solar y estructuras cósmicas" los pide el Nivel 3 Básica
-- (7º-8º) y en el currículum regular son de 1º MEDIO — por eso los libros de 7º y
-- 8º no los traen: no están incompletos, siguen bien el currículum regular.
-- Guardar '1M' ahí no es un error de carga: es el dato que explica el hueco y
-- dice en qué libro del corpus está el contenido.
--
-- Idempotente. Aplicar después de schema_curriculum_map.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_curso.sql
-- =============================================================================

alter table curriculum_map add column if not exists curso_resuelto text;
alter table curriculum_map add column if not exists curso_origen text;
alter table curriculum_map add column if not exists curso_evidencia text;

-- Mismo vocabulario que `documents.grade` ('1B'..'8B', '1M'..'4M'): la columna
-- existe para poder ir a buscar el libro, así que tiene que hablar su idioma.
alter table curriculum_map drop constraint if exists curriculum_map_curso_valido;
alter table curriculum_map add constraint curriculum_map_curso_valido
  check (curso_resuelto is null or curso_resuelto ~ '^[1-8]B$|^[1-4]M$');

alter table curriculum_map drop constraint if exists curriculum_map_curso_origen_valido;
alter table curriculum_map add constraint curriculum_map_curso_origen_valido
  check (curso_origen is null
         or curso_origen in ('libro', 'ambos_cursos', 'regular', 'sin_resolver'));

create index if not exists idx_curriculum_map_curso
  on curriculum_map (curso_resuelto) where curso_resuelto is not null;

comment on column curriculum_map.curso_resuelto is
  'El curso al que pertenece este conocimiento ("5B", "1M"). Puede ser un curso de
   OTRO nivel: EPJA comprime el currículum regular y a veces pide contenido que el
   sistema regular pone antes o después. NULL = todavía no se resolvió.';

comment on column curriculum_map.curso_origen is
  'libro | ambos_cursos | regular | sin_resolver. Ver la cabecera de
   packages/db/schema_curriculum_curso.sql.';

comment on column curriculum_map.curso_evidencia is
  'El porqué, en texto: el código del OA regular, las páginas del libro, o qué se
   miró y no alcanzó. Sin esto, curso_resuelto es una opinión anónima.';
