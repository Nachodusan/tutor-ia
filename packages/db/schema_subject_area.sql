-- =============================================================================
-- ÁREA CURRICULAR: qué materias ocupan el MISMO casillero del plan EPJA.
--
-- ── Por qué hace falta, además de `family` ──────────────────────────────────
-- `family` responde "¿es la misma asignatura en otro curso?" (Matemática 7º y
-- Matemática 8º). `area` responde otra pregunta: "¿el currículum las cuenta
-- como una sola?". El EPJA no tiene Biología, Física ni Química: tiene UN
-- casillero llamado **Ciencias Naturales**, con un solo juego de conocimientos
-- esenciales, que la enseñanza regular reparte en tres libros. Lo mismo con
-- Historia y Educación Ciudadana, que son el mismo casillero en distinto nivel.
--
-- ── El agujero que esto tapa ────────────────────────────────────────────────
-- `schema_subject_family.sql` (2026-08-03) separó a propósito cada asignatura y
-- lo justificó así, textual:
--
--   "Eso NO limita el alcance: la cascada de retrieval tiene una etapa final
--    sobre TODO el corpus, así que una pregunta de física desde Biología se
--    sigue encontrando — solo que después de agotar la propia familia."
--
-- Ocho días después, el 2026-08-11, esa etapa final se APAGÓ en producción
-- (`retrieve-teaching.ts`: corre solo con `corpusCompleto: true`, "se enciende
-- para medir, nunca para atender"), y con buenos motivos: contestarle a un chico
-- de Biología con el libro de Lengua rompe la promesa de la materia. Pero nadie
-- volvió a mirar la decisión que se apoyaba en ella. Resultado: desde el 11 de
-- agosto, una pregunta de física planteada en Biología no llega a NINGÚN libro.
--
-- Medido sobre el mapa curricular (2026-08-22): de 47 exigencias que un libro no
-- cubría, 43 estaban en un libro hermano — Biología debiendo sonido y luz que
-- están en Física, Física debiendo genética que está en Biología. No faltaba
-- material: faltaba que el buscador cruzara.
--
-- ── Qué NO hace ────────────────────────────────────────────────────────────
-- `area` NO reabre el corpus completo. Une solo lo que el currículum ya trata
-- como una materia. Lengua sigue sin ver Biología, que es el caso que motivó
-- apagar la etapa final. Filosofía queda SOLA a propósito: en el plan EPJA es
-- Formación Diferenciada, no comparte casillero con Historia.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_subject_area.sql
-- =============================================================================

alter table subjects add column if not exists area text;

-- Se recalcula SIEMPRE, igual que `family`: volver a correr el archivo alcanza
-- para incorporar una materia nueva.
update subjects s
   set area = case
     -- CASILLERO "Ciencias Naturales" del plan EPJA. La enseñanza regular lo
     -- reparte en tres libros en 1º-2º Medio (Biología, Física, Química) y lo
     -- renombra "Ciencias para la Ciudadanía" en 3º-4º Medio.
     when s.family in ('ciencias naturales', 'biologia', 'fisica', 'quimica',
                       'ciencias para la ciudadania')
       then 'ciencias naturales'
     -- CASILLERO "Historia, Geografía y Ciencias Sociales / Educación
     -- Ciudadana": el plan los nombra juntos; "Educación Ciudadana" es como se
     -- llama el mismo casillero en el Nivel 2 de Media.
     when s.family in ('historia geografia y ciencias sociales', 'educacion ciudadana')
       then 'historia geografia y ciencias sociales'
     -- El resto es su propia área: Matemática, Lengua y Literatura, Inglés y
     -- Filosofía no comparten casillero con nadie.
     else s.family
   end
 where s.family is not null;

create index if not exists idx_subjects_area on subjects(area) where area is not null;

comment on column subjects.area is
  'Casillero del plan de estudio EPJA que ocupa la materia. Más ancho que
   `family`: agrupa Biología/Física/Química/Ciencias para la Ciudadanía bajo
   "ciencias naturales", e Historia con Educación Ciudadana. Lo usa la etapa
   `area` de la cascada de alcance, entre `otro_curso` y el corpus completo.';
