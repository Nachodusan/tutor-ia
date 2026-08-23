-- =============================================================================
-- CADA TRAMO SABE DE QUÉ TOMO SON SUS PÁGINAS.
--
-- ── El error que esto corrige ──────────────────────────────────────────────
-- Los pilares del camino se cruzan comparando el rango de páginas del tramo
-- curricular con el de la lección. Eso vale mientras las dos páginas sean del
-- MISMO libro, y hasta ahora se cumplía por casualidad: al camino solo entraban
-- secciones del texto del estudiante.
--
-- Desde que un tomo sin índice entra al camino como una parada propia (los seis
-- módulos EPJA de Ciencias para la Ciudadanía, por ejemplo), deja de cumplirse:
-- cada módulo empieza en su página 1, así que un tramo en las páginas 20-30 del
-- texto del estudiante se solapa con TODOS los módulos. Se veía en pantalla el
-- 2026-08-23: el pilar "Relación entre salud y enfermedad" colgado de cinco
-- unidades distintas, incluida "Estructura interna de la Tierra".
--
-- 36 materias tienen más de un tomo de contenido, así que no es un caso raro.
--
-- ── Por qué la columna va acá y no en `curriculum_map` ─────────────────────
-- La fila madre tiene `document_id` y está en NULL en las 199 filas verificadas:
-- nunca se llenó. Podría backfillearse igual, pero el dato que hace falta es por
-- TRAMO — un conocimiento puede estar en dos tomos— y el tramo es la fila que se
-- compara contra la lección.
--
-- ── Cómo se decide el tomo, en tres pasos de menos a más flojo ─────────────
--   1. El título de sección y la página de inicio coinciden con una fila de
--      `book_sections`: es de ese tomo, sin duda. (415 de 852)
--   2. El rango se solapa con secciones de UN SOLO tomo. (165 más)
--   3. El resto: el tomo con más páginas de la materia, que es el texto del
--      estudiante — es contra el que se leyó el mapa. Queda marcado por
--      descarte, no por evidencia, y por eso conviene revisarlo si alguna vez
--      se rehace el mapa.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_tramos_doc.sql
-- =============================================================================

alter table curriculum_map_tramos
  add column if not exists document_id uuid references documents(id) on delete set null;

-- Paso 1 — coincidencia exacta con el índice.
update curriculum_map_tramos t
   set document_id = bs.document_id
  from curriculum_map cm, book_sections bs
 where cm.id = t.map_id
   and bs.subject_id = cm.subject_id
   and bs.title = t.seccion
   and bs.page_start = t.pagina_desde
   and t.document_id is null;

-- Paso 2 — el rango cae en secciones de un solo tomo.
update curriculum_map_tramos t
   set document_id = (
     -- `min()` no existe para uuid: se toma el único que hay.
     select (array_agg(distinct bs.document_id))[1] from book_sections bs
      where bs.subject_id = cm.subject_id
        and bs.page_start <= coalesce(t.pagina_hasta, t.pagina_desde)
        and bs.page_end >= t.pagina_desde)
  from curriculum_map cm
 where cm.id = t.map_id
   and t.document_id is null
   and (select count(distinct bs.document_id) from book_sections bs
         where bs.subject_id = cm.subject_id
           and bs.page_start <= coalesce(t.pagina_hasta, t.pagina_desde)
           and bs.page_end >= t.pagina_desde) = 1;

-- Paso 3 — por descarte: el tomo más largo de la materia.
update curriculum_map_tramos t
   set document_id = (
     select d.id from documents d
      join chunks c on c.document_id = d.id and c.corpus_role = 'content'
      where d.subject_id = cm.subject_id and d.kind = 'content' and d.status = 'ready'
      group by d.id
      order by max(c.page_end) desc
      limit 1)
  from curriculum_map cm
 where cm.id = t.map_id
   and t.document_id is null;

create index if not exists idx_tramos_doc on curriculum_map_tramos (document_id);

comment on column curriculum_map_tramos.document_id is
  'De qué tomo son estas páginas. Sin esto el cruce con las lecciones compara
   números de página de libros distintos: 36 materias tienen más de un tomo y
   cada uno empieza en su página 1.';
