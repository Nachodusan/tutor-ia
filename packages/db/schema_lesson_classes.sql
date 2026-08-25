-- LA CLASE DE CADA PARADA DEL CAMINO.
--
-- Se genera OFFLINE (CLI `admin clases`) y el runtime solo lee: el alumno abre
-- la parada y ve la clase en 0 ms, sin spinner y sin gastar una llamada al
-- modelo. Hoy la primera visita a una parada paga 50 segundos de generación.
--
-- Y precomputar compra algo que ninguna versión en vivo puede dar: la clase es
-- un CATÁLOGO FINITO E INSPECCIONABLE. Un humano puede leer las filas antes de
-- que las lea un alumno, y cualquier error se corrige con un update, sin deploy.
-- El precio es que el error es SISTEMÁTICO —todos los alumnos de esa parada leen
-- el mismo— y hay que asumirlo: se prefiere el error capturable al error único e
-- invisible de una generación en vivo que nadie va a poder auditar nunca.
create table if not exists lesson_classes (
  subject_id  uuid not null references subjects(id) on delete cascade,
  topic_key   text not null,
  -- { apertura, cierre, momentos: [...], errorFrecuente }
  -- Cada momento guarda los ÍNDICES del pasaje además del texto ya armado: sin
  -- ellos no se puede re-verificar una fila vieja contra el corpus.
  clase       jsonb not null,
  -- Reporte del gate de NLI: { corrido, afirmaciones, respaldadas, contradichas, motivo? }
  -- `corrido: false` = el sidecar no estaba. La fila vale, pero el panel de
  -- auditoría tiene que poder encontrarla.
  gate        jsonb,
  topic_title text,
  generated_at timestamptz not null default now(),
  primary key (subject_id, topic_key)
);

-- Para el panel de auditoría: "mostrame lo que no pasó el gate".
create index if not exists lesson_classes_gate_idx
  on lesson_classes ((gate->>'corrido'), (gate->>'contradichas'));
