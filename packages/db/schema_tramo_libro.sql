-- =============================================================================
-- QUÉ MITAD DEL LIBRO LE TOCA A CADA CURSO.
--
-- El Mineduc publica varios textos como UN tomo para DOS cursos: "Ciencias
-- naturales 1º y 2º medio", "Matemática 3º y 4º medio". El mismo PDF cuelga de
-- las dos materias, y hasta ahora nada distinguía qué mitad es de cuál.
--
-- La consecuencia se midió el 2026-08-21 y no era teórica:
--   · Biología 1º y 2º Medio tenían el camino IDÉNTICO, los dos arrancando en la
--     página 14 — o sea, el alumno de segundo estudiaba evolución y ecología, que
--     son de primero, y no veía sistema nervioso ni genética, que son lo suyo.
--   · Filosofía 4º Medio: los 4 nodos de su camino eran de tercero.
--   · Física 2º Medio: 6 de 9.
--   · Y la PRUEBA se arma con esos mismos temas, así que evaluaba materia del
--     año equivocado.
--
-- ── Cómo se determinaron los cortes ─────────────────────────────────────────
-- Midiendo, no estimando. Física trae el curso en el encabezado de cada página
-- ("Física 1.º medio" hasta la 104, "Física 2.º medio" desde la 107). En
-- Biología y Química la numeración de unidades REINICIA en el corte, y el índice
-- trae dos secciones ("Índice • Biología 1º medio" e "Índice • Biología 2º
-- medio"). En Matemática y Filosofía se contaron las menciones de curso por
-- tramo de 20 páginas y el cruce es limpio.
--
-- ── Por qué una tabla y no una columna en `subjects` ────────────────────────
-- Porque es la excepción, no la regla: 10 materias de 67. Una columna dejaría 57
-- filas en null y obligaría a preguntarse en cada consulta si el null significa
-- "todo el libro" o "nadie lo cargó". Una fila que existe o no existe se lee sin
-- ambigüedad: sin fila, el libro entero es de esa materia.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_tramo_libro.sql
-- =============================================================================

create table if not exists subject_tramo_libro (
  subject_id    uuid primary key references subjects(id) on delete cascade,
  pagina_desde  integer not null,
  pagina_hasta  integer not null,
  motivo        text not null,
  created_at    timestamptz not null default now(),
  check (pagina_hasta > pagina_desde)
);

comment on table subject_tramo_libro is
  'Para los libros que el Mineduc publica como un tomo para DOS cursos: qué páginas
   le corresponden a esta materia. SIN FILA = el libro entero es de esta materia,
   que es el caso normal. Con fila, el camino, la prueba y el plan se limitan a ese
   tramo: fuera de él es material del otro año.';

-- Los diez casos medidos. Se insertan por NOMBRE y no por uuid para que el
-- archivo se pueda leer y auditar sin la base delante.
insert into subject_tramo_libro (subject_id, pagina_desde, pagina_hasta, motivo)
select s.id, v.p0, v.p1, v.motivo
from (values
  ('Biología 1º Medio',   14, 129, 'Tomo "Ciencias naturales Biología 1º y 2º medio". La numeración de unidades reinicia en la p.130 y el índice trae dos secciones separadas.'),
  ('Biología 2º Medio',  130, 233, 'Tomo combinado: la mitad de 2º arranca en "¿Qué funciones cumple el sistema nervioso?" (p.130) según el índice del propio libro.'),
  ('Química 1º Medio',    33,  91, 'Tomo "Química 1º y 2º medio". El índice de 2º empieza en "Las soluciones químicas" (p.92).'),
  ('Química 2º Medio',    92, 196, 'Tomo combinado: soluciones, propiedades coligativas, química orgánica e isomería son la mitad de 2º.'),
  ('Física 1º Medio',      9, 104, 'El encabezado de cada página lo dice: "Física 1.º medio" hasta la 104.'),
  ('Física 2º Medio',    107, 200, 'El encabezado dice "Física 2.º medio" desde la 107: movimientos, fuerza y trabajo mecánico.'),
  ('Matemática 3º Medio',  9, 108, 'Tomo "Matemática 3º y 4º medio". Menciones de curso contadas por tramo de 20 páginas: el cruce está en la 109.'),
  ('Matemática 4º Medio',109, 256, 'Segunda mitad del tomo combinado.'),
  ('Filosofía 3º Medio',   9, 122, 'Tomo "Filosofía 3º y 4º medio". El cruce de menciones está en la 123.'),
  ('Filosofía 4º Medio', 123, 233, 'Segunda mitad del tomo combinado.')
) as v(nombre, p0, p1, motivo)
join subjects s on s.name = v.nombre
on conflict (subject_id) do update
  set pagina_desde = excluded.pagina_desde,
      pagina_hasta = excluded.pagina_hasta,
      motivo = excluded.motivo;
