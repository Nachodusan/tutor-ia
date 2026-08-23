-- =============================================================================
-- LO QUE NO ES UNA UNIDAD DEJA DE FIGURAR COMO UNIDAD.
--
-- `book_sections` de nivel 1 son las UNIDADES del libro: es lo que el alumno ve
-- como su plan de estudio y lo que el panel del docente usa para medir avance.
-- El detector de índice metió ahí cosas que no son unidades didácticas:
--
--   Historia 2º Medio · "Evaluación de unidad" ×3   (págs. 159-163, 218-221, 264-273)
--   Historia 6º        · "Atlas"                     (194-202)
--   Historia 7º        · "Créditos"                  (170)
--   Historia 8º        · "Filmografía"               (173-178)
--
-- Un alumno de Historia 7º veía "Créditos" como una de las cinco unidades de su
-- año, con una página de extensión.
--
-- ── Dos tratamientos, no uno ────────────────────────────────────────────────
-- "Evaluación de unidad" SÍ es material del curso —es el cierre de la unidad
-- anterior— así que baja a nivel 2 (lección) en vez de borrarse: sus páginas
-- siguen alcanzables desde el plan.
--
-- "Atlas", "Créditos" y "Filmografía" son material de fin de libro: no
-- pertenecen a ninguna unidad y no son una lección de nada. Se BORRAN de la
-- estructura. El texto de esas páginas sigue en `chunks` y se sigue pudiendo
-- recuperar por relevancia; lo que se saca es su lugar en el índice.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_book_sections_limpieza.sql
-- =============================================================================

update book_sections b
   set level = 2
  from subjects s
 where s.id = b.subject_id
   and b.level = 1
   and b.title ~* '^evaluación de unidad';

delete from book_sections b
 using subjects s
 where s.id = b.subject_id
   and b.level = 1
   and b.title ~* '^(créditos|atlas|filmografía|bibliografía|glosario|índice)[[:space:]]*$';

-- ── Corrección 1: la degradación a nivel 2 podía duplicar ───────────────────
-- Historia 2º Medio ya tenía "Evaluación de unidad" como lección en las mismas
-- páginas, así que bajar la de nivel 1 creaba una segunda fila idéntica. Se
-- deja una sola por (materia, título, página de inicio).
delete from book_sections b
 where b.ctid not in (
   select min(b2.ctid) from book_sections b2
    where b2.subject_id = b.subject_id and b2.title = b.title
      and b2.page_start = b.page_start and b2.level = b.level
 );

-- ── Corrección 2: el fin de libro tampoco es una LECCIÓN ────────────────────
-- El mismo problema, un nivel más abajo, y este importa igual o más: el nivel 2
-- es lo que `getPlanTopics` convierte en temas del plan y lo que el panel del
-- docente usa como denominador del avance. Un alumno de Matemática 3º Medio
-- tenía "Créditos" (pág. 128) entre los temas a estudiar, y uno de Historia 8º
-- tenía "Atlas", "Créditos" y "Filmografía".
--
-- "Evaluación de unidad" NO entra acá: como lección es correcta.
-- El nivel 3 se deja intacto: no alimenta el plan ni el avance.
delete from book_sections b
 where b.level = 2
   and b.title ~* '^(créditos|atlas|filmografía|bibliografía|glosario)[[:space:]]*$';
