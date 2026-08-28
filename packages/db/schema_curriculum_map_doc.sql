-- =============================================================================
-- EL PUNTERO AL TOMO EN `curriculum_map` — backfill desde los tramos.
--
-- ── El bug, y por qué no se veía ────────────────────────────────────────────
-- `schema_curriculum_tramos_doc.sql` le puso `document_id` a
-- `curriculum_map_tramos` para arreglar los 158 pilares falsos (§8.5), pero la
-- tabla MADRE quedó como estaba: 182 de 266 filas `lector-v1` con
-- `curriculum_map.document_id` NULL.
--
-- Eso no molestó hasta que `materialDeParada` (packages/rag/src/curriculum.ts)
-- empezó a armar los apuntes de las paradas del programa. Ahí resuelve los
-- componentes `ok=true` —los que están en el PROPIO libro del alumno— contra
-- `cm.document_id`; con NULL, `destino.doc` queda null y el `continue` los
-- descarta a todos.
--
-- Medido el 2026-08-27: **22 de los 35 apuntes generados salieron sin los
-- componentes de su propio libro**, 34 en total. El gate no lo delata (0,73
-- contra 0,70 en los sanos): lo que entró está bien respaldado, falta lo que
-- nunca entró. Un modo de fallo silencioso — el apunte se ve completo.
--
-- ── Las tres condiciones, y por qué cada una ────────────────────────────────
-- Solo se rellena cuando NO hay nada que decidir:
--
--  1. `document_id` está NULL. Nunca se pisa un puntero existente.
--  2. Sus tramos apuntan a UN SOLO tomo. Con dos (8 filas: Historia 8º,
--     Lengua 7º y 8º, Química 2º) elegir uno sería inventar; se dejan NULL y se
--     resuelven leyendo, no con un UPDATE.
--  3. ⚠️ Ese tomo es DE SU MISMA MATERIA. Es la condición que no se puede
--     omitir: `schema_epja_por_disciplina.sql` anuló a propósito el puntero de
--     las filas que señalaban un módulo EPJA mudado a otra disciplina —"una fila
--     de Física que apunta a un módulo de Biología manda al alumno a material que
--     ya no es suyo"—. Sin este `where`, este backfill revierte aquella
--     corrección en silencio. Son 2 filas hoy.
--
-- Alcance: 143 de 182. Las otras 39 se quedan NULL a propósito (8 ambiguas, 2 de
-- otra materia, 29 sin tramos con tomo).
--
-- Idempotente: la condición `document_id is null` hace que una segunda corrida
-- no toque nada.
--
--   psql "$DATABASE_URL" -f packages/db/schema_curriculum_map_doc.sql
--
-- ⚠️ DESPUÉS HAY QUE REGENERAR LOS APUNTES AFECTADOS, o siguen guardados con el
-- material incompleto:
--   pnpm --filter @tutor-ia/eval apuntes-programa --aplicar --forzar
-- =============================================================================
begin;

-- Para poder deshacerlo: qué filas tocó esta migración y qué tenían antes (NULL).
create table if not exists curriculum_map_doc_backfill (
  map_id      uuid primary key,
  document_id uuid not null,
  aplicado_en timestamptz not null default now()
);

with unico as (
  select cm.id, cm.subject_id,
         (select array_agg(distinct tr.document_id)
            from curriculum_map_tramos tr
           where tr.map_id = cm.id and tr.document_id is not null) as tomos
    from curriculum_map cm
   where cm.metodo = 'lector-v1'
     and cm.document_id is null
), elegibles as (
  select u.id, u.tomos[1] as doc
    from unico u
   where array_length(u.tomos, 1) = 1
     -- (3) el tomo tiene que ser de la misma materia. Ver la cabecera.
     and (select d.subject_id from documents d where d.id = u.tomos[1]) = u.subject_id
)
insert into curriculum_map_doc_backfill (map_id, document_id)
select id, doc from elegibles
on conflict (map_id) do nothing;

update curriculum_map cm
   set document_id = b.document_id
  from curriculum_map_doc_backfill b
 where b.map_id = cm.id
   and cm.document_id is null;

commit;

comment on table curriculum_map_doc_backfill is
  'Filas cuyo document_id llenó schema_curriculum_map_doc.sql (antes eran NULL).
   Para deshacer: update curriculum_map set document_id = null where id in (select map_id from curriculum_map_doc_backfill);';
