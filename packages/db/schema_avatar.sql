-- =============================================================================
-- EL AVATAR DEL ALUMNO — lo ÚNICO personalizable de una cuenta anónima.
--
-- Las cuentas no tienen nombre y no lo van a tener: el mapeo de "7b-01" a una
-- persona vive en papel en el colegio (ver schema_auth.sql). Pero una cuenta
-- que no se puede tocar en nada tampoco se siente propia, y esto es de un chico
-- de 12 años. El avatar es la respuesta: lo elige él, no dice quién es.
--
-- Guarda un ID DEL CATÁLOGO (`apps/web/app/avatares.ts`), no un emoji ni una
-- imagen. Dos razones:
--   · Es la LISTA BLANCA. Nada escrito por el navegador termina pintado en la
--     pantalla de otro (el docente ve el avatar de sus alumnos).
--   · Una imagen subida sería una FOTO, y ahí se termina el anonimato: es el
--     dato personal más obvio que existe. Que no se pueda subir no es una
--     limitación técnica, es el punto.
--
-- NULL = todavía no eligió; se dibuja el orbe de Aurora, que es la marca.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_avatar.sql
-- =============================================================================

alter table student_profiles add column if not exists avatar text;

comment on column student_profiles.avatar is
  'ID del catálogo de avatares (apps/web/app/avatares.ts). NULL = el orbe por
   defecto. NUNCA una URL ni una imagen: las cuentas son anónimas y una foto es
   el dato personal más obvio que hay.';
