-- =============================================================================
-- LOS COMPONENTES OFICIALES DE CADA CONOCIMIENTO ESENCIAL.
--
-- ── Por qué ────────────────────────────────────────────────────────────────
-- El verificador dictamina hoy de forma HOLÍSTICA ("¿el libro lo desarrolla?"),
-- y por eso sus veredictos oscilan entre corridas: "correcto" y "parcial" son
-- juicios de bulto sobre un ítem que suele juntar varios temas. La descompo-
-- sición en componentes permite dictaminar por partes ("4 de 5 cubiertos,
-- falta transporte activo"), que es más estable y más útil para el alumno.
--
-- ── De dónde salen ─────────────────────────────────────────────────────────
-- De los PROGRAMAS DE ESTUDIO EPJA 2026 del Mineduc (curriculumnacional.cl,
-- descargados 2026-08-24 a ~/Documents/libros/media/programas_epja_2026/).
-- Son la descomposición OFICIAL: los programas organizan cada conocimiento en
-- módulos con subtemas ("Función y ecuación cuadrática" aparece como
-- "Expresiones del tipo f(x)=ax²", "g(x)=x²+c"...). No se inventa nada: la
-- herramienta componentes-epja extrae lo que el programa nombra, y donde el
-- programa no existe (Nivel 3 Básica y casi todo Nivel 2 Media aún no se
-- publican) la columna queda NULL a propósito.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_componentes.sql
-- =============================================================================

alter table curriculum_map add column if not exists componentes jsonb;
alter table curriculum_map add column if not exists componentes_fuente text;

comment on column curriculum_map.componentes is
  'Array JSON de los componentes en que el Programa de Estudio EPJA descompone
   este conocimiento. NULL = el programa de ese nivel/asignatura no está
   publicado o no lo descompone. Lo llena componentes-epja (packages/eval).';
comment on column curriculum_map.componentes_fuente is
  'De qué programa salieron los componentes (archivo + URL de curriculumnacional).';
