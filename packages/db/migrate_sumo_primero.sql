-- =============================================================================
-- "SUMO PRIMERO" NO ES UNA MATERIA: es el texto de MATEMÁTICA de 1º a 6º básico.
--
-- Se cargó como materia aparte porque los PDF vienen con ese nombre de programa.
-- El efecto en la app era que el alumno de 4º básico veía dos tarjetas —
-- "Matemática" y "Sumo Primero"— como si fueran asignaturas distintas, y el
-- tutor buscaba en una sola de las dos según cuál hubiera abierto: preguntar
-- por fracciones desde "Matemática" no encontraba el cuaderno de ejercicios que
-- las trabaja, aunque estuviera ingestado.
--
-- Cada "Sumo Primero Nº" tiene su "Matemática Nº" del MISMO curso, así que la
-- corrección es mover los documentos y borrar la materia vacía. No se re-ingesta
-- nada: los chunks cuelgan de `documents`, que es lo que se muda; los embeddings
-- (horas de proceso) quedan intactos.
--
-- Idempotente: si ya se corrió, no encuentra nada que mover y no borra nada.
--   psql "$DATABASE_URL" -f packages/db/migrate_sumo_primero.sql
-- =============================================================================

begin;

-- Guarda de seguridad: si algún "Sumo Primero" NO tuviera su "Matemática" del
-- mismo curso, mover sus documentos los dejaría huérfanos y borrar la materia
-- se llevaría el material puesto. Mejor abortar entero.
do $$
declare huerfanas int;
begin
  select count(*) into huerfanas
  from subjects sp
  where sp.name like 'Sumo Primero %'
    and not exists (
      select 1 from subjects m
      where m.name = replace(sp.name, 'Sumo Primero', 'Matemática'));
  if huerfanas > 0 then
    raise exception 'Hay % materia(s) "Sumo Primero" sin su "Matemática" del mismo curso. Abortado.', huerfanas;
  end if;
end $$;

-- 1) Los documentos (y con ellos sus chunks, que cuelgan de document_id).
update documents d
   set subject_id = m.id
  from subjects sp
  join subjects m on m.name = replace(sp.name, 'Sumo Primero', 'Matemática')
 where d.subject_id = sp.id
   and sp.name like 'Sumo Primero %';

-- 2) Las secciones del libro llevan subject_id desnormalizado (ver
--    schema_book_sections.sql), así que hay que moverlas a mano.
update book_sections bs
   set subject_id = m.id
  from subjects sp
  join subjects m on m.name = replace(sp.name, 'Sumo Primero', 'Matemática')
 where bs.subject_id = sp.id
   and sp.name like 'Sumo Primero %';

-- 3) El plan cacheado de las Matemáticas afectadas queda VIEJO: se armó sin
--    estos libros. Se borra para que se regenere con el material completo.
--    (`admin plans generar` lo rehace; sin esto seguiría sirviendo el de antes.)
delete from subject_plans
 where subject_id in (
   select m.id from subjects sp
   join subjects m on m.name = replace(sp.name, 'Sumo Primero', 'Matemática')
   where sp.name like 'Sumo Primero %');

-- 4) La materia vacía. A esta altura ya no le cuelga nada; si algo quedara, la
--    FK on delete cascade se lo llevaría, y por eso los pasos van en este orden.
delete from subjects where name like 'Sumo Primero %';

commit;
