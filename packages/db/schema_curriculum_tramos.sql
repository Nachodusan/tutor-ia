-- =============================================================================
-- TRAMOS DEL MAPA CURRICULAR — un conocimiento vive en varias páginas del libro.
--
-- `curriculum_map` guarda UN rango por conocimiento, y eso alcanzaba para el
-- primer barrido. No alcanza para el producto: medido el 2026-08-20, 106 de los
-- 237 puntos quedaron marcados 'parcial', y en la mayoría el motivo no es que el
-- libro no enseñe el tema, sino que el CURRÍCULUM agrupa varios temas en una
-- línea y cada uno vive en otra página.
--
--   "Operaciones con números racionales, potencias, raíces y sus propiedades"
--      → racionales p. 11-12 · operaciones combinadas p. 21-25 · potencias p. 27-28
--   "Cambio climático, efecto invernadero y sus implicancias"
--      → mecanismo y causas p. 170-173 · implicancias p. 174-180
--
-- Hasta ahora esa segunda ubicación quedaba escrita EN CASTELLANO dentro de
-- `curriculum_map.verificacion`. Un humano la lee; un programa no. Y el mapa
-- existe para que el tutor pueda contestar "esto lo estudiás en la página 27",
-- así que la información tenía que salir de la prosa.
--
-- ── Por qué una tabla hija y no más columnas ────────────────────────────────
-- Porque la cantidad de tramos no está acotada: hay conocimientos con uno y
-- otros con cuatro. `pagina_desde_2`, `pagina_desde_3`… se rompe al quinto.
--
-- ── La fila madre no se toca ────────────────────────────────────────────────
-- `curriculum_map.pagina_desde` sigue siendo el tramo PRINCIPAL, y se mantiene
-- por dos razones: no invalida las 237 filas ya cargadas, y una consulta que
-- solo quiere "dónde empiezo a estudiar esto" no necesita el join. El tramo
-- principal aparece TAMBIÉN acá, con orden = 0, para que quien sí hace el join
-- vea la lista completa sin tener que unir dos formas distintas de decir lo mismo.
--
-- Idempotente. Aplicar después de schema_curriculum_map.sql:
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_tramos.sql
-- =============================================================================

create table if not exists curriculum_map_tramos (
  id            uuid primary key default gen_random_uuid(),
  map_id        uuid not null references curriculum_map(id) on delete cascade,

  -- 0 = el tramo principal (el que está en la fila madre). 1, 2, 3… el resto,
  -- en el orden en que conviene estudiarlos, que es el del libro.
  orden         integer not null default 0,

  seccion       text,
  pagina_desde  integer not null,
  pagina_hasta  integer,
  cita          text,

  -- QUÉ PARTE del conocimiento cubre este tramo. Es la columna que justifica la
  -- tabla: sin ella son páginas sueltas. Ej: "las propiedades de las potencias".
  que_cubre     text,

  -- 'lector' (lo ubicó el lector del libro) | 'auditor' (lo agregó quien
  -- refutó) | 'principal' (copiado de la fila madre al crear la tabla).
  fuente        text not null default 'lector',

  created_at    timestamptz not null default now()
);

-- Un mismo tramo no se carga dos veces al re-correr la extracción.
create unique index if not exists idx_tramos_unico
  on curriculum_map_tramos (map_id, pagina_desde, coalesce(pagina_hasta, pagina_desde));

create index if not exists idx_tramos_map on curriculum_map_tramos (map_id, orden);

comment on table curriculum_map_tramos is
  'Los rangos de página donde vive cada conocimiento del currículum. orden=0 es el
   tramo principal (duplicado de curriculum_map para poder leer la lista completa
   desde una sola tabla). Existe porque el currículum agrupa varios temas por línea
   y cada uno está en otra parte del libro.';

comment on column curriculum_map_tramos.que_cubre is
  'Qué parte del conocimiento cubre ESTE tramo. Sin esto son páginas sueltas.';

-- ── Backfill del tramo principal ────────────────────────────────────────────
-- Se corre acá y no en un script aparte para que aplicar el archivo deje la
-- tabla coherente de una: si no, quedaría una tabla vacía que aparenta que
-- ningún conocimiento tiene ubicación.
insert into curriculum_map_tramos (map_id, orden, seccion, pagina_desde, pagina_hasta, cita, que_cubre, fuente)
select cm.id, 0, cm.seccion, cm.pagina_desde, cm.pagina_hasta, cm.cita,
       'tramo principal', 'principal'
from curriculum_map cm
where cm.metodo = 'lector-v1' and cm.pagina_desde is not null
on conflict (map_id, pagina_desde, coalesce(pagina_hasta, pagina_desde)) do nothing;
