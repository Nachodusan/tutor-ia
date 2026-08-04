-- =============================================================================
-- FAMILIA DE MATERIA: qué materias son "la misma asignatura" entre cursos.
--
-- Hace falta para que el tutor pueda ampliar la búsqueda a otros cursos de la
-- MISMA materia (un alumno de 1º Medio preguntando algo que su libro no cubre
-- pero el de 2º Medio sí).
--
-- ── Por qué NO se usa `documents.subject_area` ──────────────────────────────
-- Porque no es confiable. Medido sobre este corpus:
--   · `ingles` e `inglés` conviven EN LA MISMA MATERIA ("Inglés 1º Medio" tiene
--     2 documentos con una grafía y 1 con la otra).
--   · `lenguaje_y_comunicacion` y `lenguaje_y_comunicación`, ídem en 1º Básico.
--   · `sumo_primero` sigue pegado a documentos que ya pertenecen a materias de
--     Matemática (migrate_sumo_primero.sql movió el subject_id, no el área).
-- Agrupar por ese campo partiría Inglés en dos familias por un acento.
--
-- La familia se deriva del NOMBRE de la materia, que sí es canónico
-- ("Matemática 3º", "Biología 1º Medio"), y se MATERIALIZA en una columna: el
-- agrupamiento tiene decisiones de producto adentro y no debe quedar escondido
-- en una expresión de una consulta.
--
-- ── El agrupamiento (decidido con el dueño del producto, 2026-08-03) ────────
-- Cada asignatura es su propia familia. Biología NO se mezcla con Física ni con
-- Ciencias Naturales; Historia no se mezcla con Filosofía ni con Educación
-- Ciudadana. Solo se unen los casos donde el currículo RENOMBRA la misma
-- asignatura al cambiar de nivel:
--   · "Lenguaje y Comunicación" (1º-6º básico) ≡ "Lengua y Literatura" (7º en adelante)
--   · "Sumo Primero" ≡ "Matemática"  (ya resuelto a nivel de materia)
-- Eso NO limita el alcance: la cascada de retrieval tiene una etapa final sobre
-- TODO el corpus, así que una pregunta de física desde Biología se sigue
-- encontrando — solo que después de agotar la propia familia.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_subject_family.sql
-- =============================================================================

alter table subjects add column if not exists family text;

-- Se recalcula SIEMPRE (no solo cuando es null): si mañana se renombra una
-- materia o se agrega un alias, volver a correr el archivo alcanza.
update subjects s
   set family = case
     -- Mismo ramo, distinto nombre según el nivel.
     when base = 'lenguaje y comunicacion' then 'lengua y literatura'
     else base
   end
  from (
    select id,
           -- Sin el curso, sin acentos y en minúsculas: "Biología 1º Medio" →
           -- "biologia". Los acentos se sacan para que un nombre mal tipeado no
           -- abra una familia nueva en silencio.
           lower(translate(
             regexp_replace(name, '\s+\d+º.*$', ''),
             'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'
           )) as base
    from subjects
  ) x
 where x.id = s.id;

create index if not exists idx_subjects_family on subjects(family) where family is not null;

comment on column subjects.family is
  'Asignatura canónica entre cursos ("matematica", "lengua y literatura"). Deriva
   del NOMBRE, no de documents.subject_area, que tiene grafías inconsistentes.
   Cada asignatura es su propia familia salvo los renombres de nivel.';

-- ── Higiene: normalizar `documents.subject_area` ────────────────────────────
-- No se usa para agrupar, pero sigue siendo lo que muestra /api/subjects como
-- "área" y lo que alimenta el color de la materia en la UI. Dejarlo con dos
-- grafías es una bomba de tiempo para el próximo que lo consulte.
update documents set subject_area = 'inglés'                  where subject_area = 'ingles';
update documents set subject_area = 'lenguaje_y_comunicación' where subject_area = 'lenguaje_y_comunicacion';
-- Los libros de Sumo Primero ya viven en materias de Matemática (ver
-- migrate_sumo_primero.sql); el área quedó sin actualizar.
update documents set subject_area = 'matemática'              where subject_area = 'sumo_primero';
