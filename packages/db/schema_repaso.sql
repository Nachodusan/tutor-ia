-- =============================================================================
-- REPASO DE HOY — la sesión diaria de refuerzo.
--
-- "Para reforzar" mostraba la deuda entera (nueve temas en una lista) y no se
-- terminaba nunca: un tema sale de ahí recién cuando el alumno lo aprueba en
-- otra prueba, así que la pantalla se leía como un inventario de fracasos. Esta
-- tabla es lo que la convierte en una sesión que SE TERMINA: tres temas por día,
-- elegidos una vez, con su propio estado.
--
-- ⚠️ POR QUÉ SE GUARDA Y NO SE DERIVA. La primera versión del diseño decía que
-- alcanzaba con calcular los tres al vuelo (los más fallados, por ejemplo). No
-- alcanza: al cerrar un tema se BORRA su fila de `student_weak_topics`, así que
-- "cuáles eran los tres de hoy" deja de existir apenas cierra el primero, el
-- cuarto se desliza al medidor y "1 de 3" vuelve a decir 1 de 3 para siempre.
-- La sesión no terminaría nunca, que es exactamente el bug que vino a arreglar.
--
-- ⚠️ DOS ESTADOS, NO UNO. `done_at` = lo intentó; `passed` = lo aprobó. El
-- medidor cuenta lo INTENTADO: si contara solo aciertos, el chico que estudia
-- media hora, rinde y no aprueba mira un "0 de 3" — que es el "estudié y no me
-- sirvió de nada" que esta pantalla existe para matar. El tilde lleno es otra
-- señal y se dibuja distinto.
--
-- `topic` se copia a propósito: al aprobar se borra la fila de weak_topics, y
-- sin la copia la pantalla no podría pintar "✓ Sistema endocrino · listo".
--
-- Idempotente:
--   psql "$DATABASE_URL" -f packages/db/schema_repaso.sql
-- =============================================================================

create table if not exists student_review_day (
  user_id        uuid not null references users(id) on delete cascade,
  -- El día en la ZONA DEL ALUMNO, no en UTC: en UTC la sesión rotaría a las
  -- 21:00 de Chile, en el medio del horario de estudio que el propio chico
  -- configuró en `student_profiles.pomo_hora`.
  day            date not null,
  -- 0, 1, 2 — el hueco. Cada uno se llena con un criterio distinto (uno que se
  -- pueda cerrar, uno que importe, uno reciente); ver `lib/repaso.ts`.
  slot           smallint not null,
  subject_id     uuid not null references subjects(id) on delete cascade,
  topic_key      text not null,
  topic          text not null,
  -- Cuántos fallos tenía al elegirlo. Se guarda para poder mirar después si la
  -- regla de selección sirve, sin tener que reconstruir el pasado.
  misses_at_pick smallint,
  done_at        timestamptz,
  passed         boolean,
  primary key (user_id, day, slot)
);

-- Para no volver a ofrecer hoy un tema que ya se ofreció (o que se ofreció ayer
-- y quedó sin cerrar).
create index if not exists idx_review_day_tema on student_review_day(user_id, topic_key);

comment on table student_review_day is
  'La sesión diaria de "Repaso de hoy": tres temas elegidos una vez por día. Se
   guarda porque aprobar BORRA la fila de student_weak_topics y sin esto el
   conjunto del día sería irreconstruible.';
comment on column student_review_day.done_at is
  'Lo INTENTÓ (rindió el chequeo), haya aprobado o no. Es lo que mueve el medidor.';
comment on column student_review_day.passed is
  'Lo APROBÓ (dos tercios). Es el tilde lleno; distinto de haberlo intentado.';
