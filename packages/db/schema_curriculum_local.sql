-- =============================================================================
-- QUÉ CONOCIMIENTOS ESENCIALES SON LOCALES: la respuesta correcta depende de Chile.
--
-- ── Por qué existe ─────────────────────────────────────────────────────────
-- "Sin material" sobre energía mecánica y "sin material" sobre biodiversidad
-- chilena son riesgos muy distintos: el modelo sabe la primera de sobra y la
-- segunda la inventa con confianza. Y ahí la red no cubre: la verificación NLI
-- corre contra el material citable, y en modo general no hay citable — el sello
-- dice honestamente "esto es general" pero no puede decir "y encima
-- probablemente esté mal". Esta marca cierra ese punto ciego ANTES de generar:
-- sale del currículum, no de los veredictos.
--
-- ── Criterio ───────────────────────────────────────────────────────────────
-- local = true cuando la respuesta correcta depende de Chile: especies,
-- geografía, historia nacional, instituciones, pueblos originarios, normativa.
-- Si la respuesta es la misma en Chile que en España, es universal.
--
-- ── Por qué a mano y no inferida ───────────────────────────────────────────
-- Es una lista chica y cerrada (116 ítems en total) y tiene que ser auditable:
-- ESTE ARCHIVO es la lista. Nada de keywords en runtime ni de modelo — un
-- falso negativo acá es un dato chileno inventado con sello de general.
--
-- La marca se cuelga por TEXTO COMPLETO del ítem (no por patrón), y el update
-- alcanza a todas las filas hermanas del mismo ítem entre materias.
--
-- Idempotente y recalculada entera en cada corrida, como family y area:
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_local.sql
-- =============================================================================

alter table curriculum_map add column if not exists local boolean not null default false;

comment on column curriculum_map.local is
  'true = la respuesta correcta depende de Chile (especies, geografia, historia
   nacional, instituciones, pueblos originarios, normativa). Lista cerrada y
   mantenida a mano en schema_curriculum_local.sql. La usa el tutor para no
   afirmar particulares chilenos en modo general/parcial.';

-- Se recalcula SIEMPRE: volver a correr el archivo deja la lista exacta de acá.
update curriculum_map set local = false where metodo = 'lector-v1';

update curriculum_map set local = true
 where metodo = 'lector-v1' and item in (
  -- ── Ciencias ──────────────────────────────────────────────────────────────
  'Biodiversidad en Chile y su preservación.',
  'La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios.',
  'Desarrollo astronómico en Chile y en el mundo.',
  -- Recursos energéticos EN CHILE: la mitad universal (propiedades de la
  -- energía) no salva los particulares (matriz energética chilena).
  'Energía: propiedades y manifestaciones de la energía y efectos en los objetos y seres vivos. Recursos energéticos en Chile.',
  -- ── Geografía e historia nacional ─────────────────────────────────────────
  'Macrozonas y sus paisajes de Chile; principales zonas naturales, recursos significativos y trabajo humano que le da valor. Riesgos socio-naturales.',
  'Pueblos originarios en Chile: ubicación geográfica, uso y dominio de recursos naturales.',
  'Multiculturalismo, identidades y patrimonio material e inmaterial en Chile.',
  'Principales hitos y periodos de la historia de la humanidad y de Chile.',
  'Procesos geográficos, sociales y culturales recientes en Chile y América Latina (por ejemplo: migraciones, presente de los pueblos indígenas, cambios demográficos, desafíos en torno a la planificación urbana y rural).',
  'Revoluciones del siglo XVIII e inicios del siglo XIX en Europa y América, incluyendo la Independencia de Chile.',
  'Visión general sobre el desarrollo político, económico, social y medioambiental en Chile durante el siglo XIX y primera mitad del siglo XX, incluyendo la perspectiva de los pueblos indígenas y las mujeres.',
  'Conflictos internos en Chile en la segunda mitad del siglo XX, incluyendo el quiebre de la democracia y la dictadura militar, la transición política y los derechos humanos.',
  -- El encuentro de dos mundos desde la mirada americana depende del contexto
  -- local aunque el título no diga Chile.
  'Transformaciones durante la Época Moderna (por ejemplo, encuentro de dos mundos, surgimiento del Estado moderno, difusión del conocimiento, fin de la unidad religiosa).',
  -- Sus proyecciones "del presente de Chile" están en el enunciado.
  'Formas de organización política en la Antigüedad clásica y sus proyecciones en la cultura occidental y latinoamericana, considerando ejemplos del pasado y del presente de Chile.',
  -- ── Instituciones y normativa chilena ─────────────────────────────────────
  'Democracia y ciudadanía en Chile (valores, atributos y dimensiones); libertades fundamentales, deberes del Estado, derechos y responsabilidades ciudadanas.',
  'Funcionamiento de la democracia, formas de participación y representación y la organización político-administrativa en Chile.',
  'Deberes del Estado y derechos y responsabilidades de las personas; derechos humanos y actitudes cívicas en el Chile actual.',
  'Derechos humanos y su reconocimiento, defensa y exigibilidad en Chile.',
  'Mecanismos de acceso a la justicia y principales características del sistema judicial chileno.',
  -- Los índices exigidos son IPC, UF e IMACEC (así los buscó el lector, textual):
  -- la UF y el IMACEC son instrumentos exclusivamente chilenos — "qué es la UF"
  -- no tiene respuesta en España. La parte matemática (porcentajes, interés
  -- compuesto) es universal, pero el bloque solo actúa en modo general/parcial,
  -- donde el riesgo es justamente el particular chileno.
  'Porcentajes, cambio porcentual constante, índices económicos, planilla de cálculo.'
 );

-- ── REVISADOS Y FIRMES (2026-08-25, contra la evidencia del lector) ────────
-- · "Surgimiento de las primeras civilizaciones, incluyendo un ejemplo de
--   América": UNIVERSAL. El libro enseña olmeca, maya, chavín e inca — ejemplos
--   continentales, no chilenos; los procesos (urbanización, centralización) son
--   los mismos desde cualquier país.
-- · "Conceptos económicos y economía global actual": UNIVERSAL. Lo que enseñan
--   los libros es escasez, sistemas económicos, flujo circular, FMI y Banco
--   Mundial — economía general sin particulares chilenos.
-- · "Desafíos de la ciudadanía local y global": UNIVERSAL. El contenido real es
--   resolución de conflictos, diálogo, bien común y cohesión social; lo chileno
--   entra por los ítems de democracia/justicia/DD.HH. de arriba.
-- · "Procesos políticos y económicos globales y locales durante el siglo XIX":
--   revisado en el barrido final y queda UNIVERSAL — el contenido es
--   industrialización, imperialismo y cuestión social (historia mundial); el
--   XIX chileno vive en el ítem "Visión general sobre el desarrollo... en
--   Chile", que sí está marcado.
-- · "Porcentajes, cambio porcentual, índices económicos": el barrido final lo
--   PASÓ A LOCAL (ver el comentario en la lista). Revierte la decisión inicial
--   — el criterio "el concepto es universal" ignoraba que la exigencia concreta
--   nombra UF e IMACEC.
