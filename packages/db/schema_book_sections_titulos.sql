-- =============================================================================
-- LOS TÍTULOS DEL ÍNDICE DEJAN DE ARRASTRAR LA TIPOGRAFÍA DEL PDF.
--
-- `book_sections.title` sale del índice impreso del libro, y el índice impreso
-- trae PUNTOS GUÍA hasta el número de página. El parser se los quedaba adentro:
--
--   "El pueblo mapuche........................................."
--   "Módulo 1|7| |Los orígenes de la sociedad chilena..........|"
--
-- Ese texto es lo que el alumno ve como nombre de su lección en el camino, y lo
-- que `claveTema` hashea. Medido el 2026-08-23, después de reconstruir las
-- secciones: 53 lecciones con puntos guía sobre 1.432 en materias vivas.
--
-- ── Lo que NO se toca: los títulos largos ──────────────────────────────────
-- 118 lecciones pasan de 70 caracteres y la primera reacción fue tratarlas como
-- basura. Son legítimas: los libros de Biología titulan cada lección con una
-- pregunta entera ("¿Qué factores alteran los ecosistemas y cómo podemos ayudar
-- a mantener el equilibrio?"). Cortarlas habría roto títulos correctos para
-- arreglar un problema que no existía.
--
-- ── Lo que sí se borra ─────────────────────────────────────────────────────
-- Las filas cuyo título es un FRAGMENTO CORTADO: empiezan en minúscula porque
-- el parser agarró la mitad de una palabra o de una oración del cuerpo.
--
--   Matemática 7º y 8º · "irecta"        (de "proporcionalidad directa")
--   Física 2º Medio    · "s padres”, “los hijos”, “los apoderados”…"
--
-- No son lecciones: son ruido con un rango de páginas. Se borran de la
-- estructura; el texto sigue en `chunks` y se recupera por relevancia.
--
-- Idempotente. Aplicar DESPUÉS de build-sections y de
-- schema_book_sections_limpieza.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_book_sections_titulos.sql
-- =============================================================================

-- ── 1. Puntos guía y el prefijo de módulo ──────────────────────────────────
-- El orden importa: primero se cortan los puntos (que se llevan el `|` final del
-- artefacto de módulo), después el prefijo.
update book_sections
   set title = btrim(
         regexp_replace(
           regexp_replace(title, '\.{3,}.*$', ''),
           '^M[oó]dulo\s*\d+\s*\|[^|]*\|\s*\|?\s*', ''
         ), ' |.·-')
 where title ~ '\.{3,}' or title ~ '^M[oó]dulo\s*\d+\s*\|';

-- ── 2. Los fragmentos cortados no son lecciones ────────────────────────────
-- Después de limpiar, no antes: un título válido podía empezar con el `|` del
-- artefacto y parecer minúscula.
delete from book_sections
 where title = ''
    or title ilike '%.indd%'
    -- Un título de lección empieza con mayúscula, número, "¿" o "¡". Empezar en
    -- minúscula es la firma de una palabra partida por el medio.
    or title ~ '^[a-záéíóúüñ]';

comment on column book_sections.title is
  'Literal del índice del libro, SIN los puntos guía del impreso ni el artefacto
   "Módulo N|x| |" del parser. Puede ser largo: varios libros titulan la lección
   con una pregunta entera, y eso es correcto.';
