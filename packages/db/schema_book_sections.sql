-- =============================================================================
-- ESTRUCTURA DEL LIBRO derivada de su ÍNDICE (temas del plan de estudio).
--
-- Por qué existe: el plan agrupaba por `chunks.unit/lesson`, metadata que el
-- extractor arma buscando "unidad N" en cualquier parte de la página y
-- arrastrando el valor entre páginas. Medido el 2026-08-02: 135 de 482 grupos
-- abarcan más de 60 páginas (una lección real abarca 19), en 27 de 46
-- documentos. El síntoma: un tema del plan llamado "Organización del texto de
-- estudio, pág. 8-138" — la página donde el libro explica cómo está organizado.
--
-- Se materializa (no se calcula por request) porque parsear el índice y ubicar
-- cada título es O(entradas × chunks): instantáneo una vez por libro, inviable
-- en cada request. Lo llena `pnpm --filter @tutor-ia/eval build-sections`.
--
-- Idempotente. Aplicar después de schema_dual_corpus.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_book_sections.sql
-- =============================================================================

create table if not exists book_sections (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  -- Desnormalizado a propósito: el plan filtra por materia y no quiere el join.
  subject_id   uuid not null references subjects(id) on delete cascade,

  ord          int  not null,          -- orden dentro del documento
  level        int  not null,          -- 1=unidad · 2=lección · 3=auxiliar
  parent_ord   int,                    -- unidad a la que pertenece la lección

  title        text not null,          -- literal del índice del libro
  unit_no      int,
  lesson_no    int,
  folio        int,                     -- número impreso (null si el índice no lo trae)

  -- En el espacio de `chunks.page`, ambos inclusive.
  page_start   int  not null,
  page_end     int  not null,

  -- 'index_folio'  = colocado por folio + desfase calibrado
  -- 'index_locate' = el título se encontró en esa página del cuerpo
  -- 'legacy'       = fallback por (unit, lesson) saneado
  method       text not null,
  confidence   real not null default 1.0,

  created_at   timestamptz not null default now(),
  unique (document_id, ord)
);

create index if not exists idx_book_sections_subject on book_sections(subject_id, level, ord);
create index if not exists idx_book_sections_pages   on book_sections(document_id, page_start);

comment on table book_sections is
  'Temas del libro derivados de su índice. Fuente única del plan de estudio y de la simulación de prueba.';
comment on column book_sections.level is
  '1=unidad, 2=lección (los temas del plan), 3=auxiliar (glosario, síntesis: NO son temas, pero sí fronteras de página).';
