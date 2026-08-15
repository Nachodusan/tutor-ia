-- =============================================================================
-- POMODORO — la organización del tiempo de estudio del alumno
--
-- El alumno decide TRES cosas: a qué hora se sienta a estudiar, cuánto dura un
-- bloque de estudio y cuánto dura el descanso. Nada de esto es una preferencia
-- del aparato: es del chico, igual que `tts_voice` acá al lado, y por el mismo
-- motivo (en una sala de computación treinta chicos comparten el navegador, y
-- el que estudia en la sala y después en el teléfono de la casa perdería su
-- rutina en el camino).
--
-- Van como columnas en `student_profiles` y no en una tabla nueva: es UNA fila
-- por alumno, se lee siempre junto con el resto del perfil (`/api/me`) y una
-- tabla aparte solo agregaría un join a cada carga del panel.
--
-- SIN check constraints, por la misma razón que se documentó en
-- `migrate_tts_voice.sql`: los topes son política de producto (hoy 10-90 min de
-- estudio) y van a moverse más seguido que el esquema. La ruta que escribe
-- (`PUT /api/me/profile`) recorta a rango; un valor fuera de rango que llegue
-- por otro camino se ve raro, no rompe nada.
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_pomodoro.sql
-- =============================================================================

-- Minutos de cada tramo. Los defaults son el pomodoro clásico (25/5) porque es
-- el que el alumno ya trae de oídas; puede cambiarlos desde el panel.
alter table student_profiles add column if not exists pomo_estudio_min   smallint not null default 25;
alter table student_profiles add column if not exists pomo_descanso_min  smallint not null default 5;

-- La hora es TEXTO "HH:MM" y no `time`, a propósito: es una hora de RELOJ DE
-- PARED en la casa del chico, no un instante. Guardarla como `time` invita a
-- compararla contra `now()` del servidor, que puede estar en otra zona horaria
-- que el alumno; la comparación correcta la hace el navegador contra su reloj.
-- NULL = todavía no eligió horario (el panel simplemente no le recuerda nada).
alter table student_profiles add column if not exists pomo_hora          text;

-- Días en que estudia, como dígitos ISO pegados: 1 = lunes … 7 = domingo.
-- ('12345' = de lunes a viernes.) Un string y no `int[]` porque el único uso es
-- "¿está el día de hoy acá adentro?", que es un `includes` en el cliente; un
-- array daría orden y duplicados que nadie necesita. Cadena vacía = ningún día.
alter table student_profiles add column if not exists pomo_dias          text not null default '12345';

-- Cuándo arrancó su último bloque. Es lo único que hace honesto el recordatorio:
-- sin esto, el panel le grita "es tu hora de estudiar" a alguien que ya está
-- estudiando desde hace veinte minutos. NO es telemetría de uso: no se muestra
-- en el panel del docente ni sale de la cuenta del alumno.
alter table student_profiles add column if not exists pomo_last_at       timestamptz;

comment on column student_profiles.pomo_hora is
  'Hora de estudio "HH:MM" en el reloj del alumno. NULL = sin horario. Texto y no
   time: la comparación con "ahora" la hace el navegador, no el servidor.';
comment on column student_profiles.pomo_dias is
  'Días de estudio como dígitos ISO ("12345" = lunes a viernes). "" = ninguno.';
