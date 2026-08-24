-- =============================================================================
-- QUÉ NIVEL EPJA LE CORRESPONDE A CADA CURSO DEL SISTEMA REGULAR.
--
-- El plan de adultos comprime dos años del sistema regular en un nivel, y esa
-- correspondencia se necesita en varias consultas para contestar "¿este libro es
-- del nivel del alumno o de otro?". Vivía implícita, mirando la columna
-- curriculum_map.nivel — que dice qué nivel EXIGE el conocimiento, no de qué
-- nivel es el libro donde está. Con eso, un libro de 6º hallado para una
-- exigencia de Nivel 3 se anunciaba como si fuera del nivel del alumno.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_nivel_epja.sql
-- =============================================================================

create or replace function nivel_epja(grado text)
returns text language sql immutable parallel safe as $$
  select case grado
    when '1B' then 'Nivel 1 Educación Básica'
    when '2B' then 'Nivel 1 Educación Básica'
    when '3B' then 'Nivel 1 Educación Básica'
    when '4B' then 'Nivel 1 Educación Básica'
    when '5B' then 'Nivel 2 Educación Básica'
    when '6B' then 'Nivel 2 Educación Básica'
    when '7B' then 'Nivel 3 Educación Básica'
    when '8B' then 'Nivel 3 Educación Básica'
    when '1M' then 'Nivel 1 Educación Media'
    when '2M' then 'Nivel 1 Educación Media'
    when '3M' then 'Nivel 2 Educación Media'
    when '4M' then 'Nivel 2 Educación Media'
    else grado
  end;
$$;

comment on function nivel_epja(text) is
  'El nivel del plan EPJA al que pertenece un curso del sistema regular. El plan
   comprime dos años por nivel: 7º y 8º son Nivel 3 Básica, 1º y 2º Medio son
   Nivel 1 Media.';
