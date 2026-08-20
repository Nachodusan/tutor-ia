-- =============================================================================
-- MAPA CURRICULAR — dónde está, en cada libro, lo que el Estado exige aprender.
--
-- Une dos mundos que hasta ahora vivían separados:
--   · Lo que pide el currículum (Bases EPJA, DS 10/2022) → docs/epja-objetivos-por-nivel.md
--   · Lo que hay en los libros del Mineduc              → chunks + book_sections
--
-- Una fila = UN ítem del currículum ubicado en UNA materia. El mismo ítem tiene
-- varias filas: "Ciencias Naturales / Nivel 1 Media" se busca en Biología, Física
-- y Química, de 1º y de 2º, y puede estar en varias.
--
-- ── Por qué las filas SIN ubicación también se guardan ───────────────────────
-- `pagina_desde is null` significa "se buscó y no está en este libro". Es la
-- mitad valiosa del mapa: sin esas filas no se puede contestar "¿qué exige el
-- Estado que ningún libro cargado cubre?", que es la pregunta que decide qué
-- material conseguir. Un ítem ausente de la tabla es "nunca se buscó"; un ítem
-- con pagina_desde null es "se buscó y no está". No es lo mismo.
--
-- ── Por qué `verificado` es texto y no booleano ──────────────────────────────
-- El buscador acierta con score alto y aun así se equivoca: medido el 2026-08-19,
-- "Química orgánica y los grupos funcionales" apuntó a la lección de fotosíntesis
-- con score 0.998. Un segundo lector abre esas páginas y dictamina. Los cuatro
-- valores son 'correcto' | 'parcial' | 'incorrecto' | 'no verificable', y NULL es
-- "todavía nadie lo revisó" — que es distinto de "se revisó y está mal".
-- NUNCA mostrarle a un alumno una fila con verificado distinto de 'correcto'.
--
-- ── corpus_role ─────────────────────────────────────────────────────────────
-- 'content' = texto del estudiante (primera pasada). 'pedagogy' = guía del
-- docente (segunda pasada, pendiente). Están en la misma tabla a propósito: son
-- respuestas a la misma pregunta desde libros distintos, y el día que el panel
-- del docente muestre esto va a querer las dos.
--
-- Idempotente. Aplicar después de schema_book_sections.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_map.sql
-- =============================================================================

create table if not exists curriculum_map (
  id            uuid primary key default gen_random_uuid(),

  -- ── El ítem del currículum, tal como lo escribe el Mineduc ────────────────
  -- Se guarda el TEXTO y no un id: el pilar es un markdown, no una tabla, y
  -- anclar por texto sobrevive a que se reordene el documento.
  nivel         text not null,   -- 'Nivel 1 Educación Media'
  asignatura    text not null,   -- la del currículum, no la de la app
  capa          text not null,   -- 'conocimiento esencial' | 'gran idea' | 'objetivo'
  item          text not null,   -- textual del PDF
  -- Código del OA cuando la capa es 'objetivo' ('OA3'); null en las otras dos.
  oa_codigo     text,

  -- ── Dónde está, en la app ─────────────────────────────────────────────────
  subject_id    uuid not null references subjects(id) on delete cascade,
  document_id   uuid references documents(id) on delete set null,
  corpus_role   text not null default 'content',

  -- ── Dónde está, en el libro ───────────────────────────────────────────────
  seccion       text,            -- título de book_sections; null si el índice no sirvió
  unidad        integer,
  leccion       integer,
  pagina_desde  integer,         -- NULL = se buscó y no está. Ver arriba.
  pagina_hasta  integer,
  cita          text,            -- prueba textual, recortada

  -- ── Cómo se supo ──────────────────────────────────────────────────────────
  score         real,            -- score del reranker (0-1)
  metodo        text not null default 'ubicar-v1',
  verificado    text,            -- null = sin revisar. Ver arriba.
  verificacion  text,            -- por qué dictaminó eso el verificador

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Re-correr el mapeo tiene que ACTUALIZAR, no duplicar. La clave natural es
-- "este ítem en esta materia con este método": si mañana hay un 'ubicar-v2' se
-- quiere poder comparar las dos corridas sin pisar la anterior.
create unique index if not exists idx_curriculum_map_unico
  on curriculum_map (subject_id, corpus_role, metodo, md5(item));

-- "¿Qué le falta a esta materia?" y "¿dónde estudio esto?" son las dos consultas
-- que va a hacer el producto.
create index if not exists idx_curriculum_map_materia on curriculum_map (subject_id, capa);
create index if not exists idx_curriculum_map_huecos
  on curriculum_map (subject_id) where pagina_desde is null;
create index if not exists idx_curriculum_map_nivel on curriculum_map (nivel, asignatura);

comment on table curriculum_map is
  'Dónde está, en cada libro, cada conocimiento/idea/objetivo que exige el currículum EPJA.
   Filas con pagina_desde NULL = se buscó y no está (hueco declarado, no ausencia de dato).
   Solo mostrarle a un alumno filas con verificado = ''correcto''.';

comment on column curriculum_map.pagina_desde is
  'NULL significa "se buscó en este libro y no está". Es un dato, no un faltante.';

comment on column curriculum_map.verificado is
  'null = sin revisar · correcto · parcial · incorrecto · no verificable.
   El score del reranker NO alcanza: 0.998 apuntó a la lección equivocada.';
