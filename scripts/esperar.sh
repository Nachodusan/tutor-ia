#!/usr/bin/env bash
# =============================================================================
# ESPERA A UNA TAREA, CON TRES SALIDAS Y NINGUNA INFINITA.
#
# Por qué existe: los vigías escritos a mano se cuelgan, y en una sola sesión
# pasó cuatro veces, con dos causas distintas:
#
#   1. `until ! pgrep -f "retrieval-guard"; do sleep; done`
#      El pgrep ENCUENTRA AL PROPIO VIGÍA: su línea de comandos contiene el
#      patrón que busca. El vigía se ve a sí mismo y concluye que la tarea sigue.
#      Nunca termina. (Dos veces, 1 h cada una.)
#
#   2. `until [ -f marcador ]; do sleep; done`
#      El productor murió por timeout sin escribir el marcador. El vigía espera
#      algo que ya nadie va a crear. (Dos veces; una estuvo 11 horas.)
#
# Las dos son el mismo error: esperar una condición sin garantía de que alguien
# la vaya a cumplir. Acá hay tres salidas y todas terminan:
#
#   · el marcador aparece        → sale con el código que guardó la tarea
#   · el proceso murió sin él    → sale 3, avisando que murió
#   · se agotó el tope           → sale 4, avisando que sigue viva
#
# NUNCA usa pgrep: la liveness se comprueba con `kill -0 <pid>`, que pregunta por
# un PID concreto y no puede confundirse con quien pregunta.
#
# Uso:
#   scripts/esperar.sh <nombre> [--tope-min N]
#   scripts/esperar.sh guarda --tope-min 20
# =============================================================================
set -uo pipefail

nombre="${1:-}"
if [[ -z "$nombre" ]]; then
  echo "uso: scripts/esperar.sh <nombre> [--tope-min N]" >&2
  exit 2
fi
shift

tope_min=45
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tope-min) tope_min="${2:-45}"; shift 2 ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${TAREA_DIR:-$raiz/.tareas}"
done_file="$dir/$nombre.done"
pid_file="$dir/$nombre.pid"
log="$dir/$nombre.log"

pid=""
[[ -f "$pid_file" ]] && pid="$(cat "$pid_file")"

limite=$(( SECONDS + tope_min * 60 ))
while :; do
  if [[ -f "$done_file" ]]; then
    codigo="$(cat "$done_file" 2>/dev/null || echo "?")"
    echo "✓ '$nombre' terminó con código $codigo · log: $log"
    exit "${codigo//[^0-9]/}" 2>/dev/null || exit 0
  fi
  # `kill -0` NO mata: solo pregunta si el proceso existe y es señalable. Es la
  # comprobación que pgrep no puede hacer sin confundirse consigo misma.
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    echo "✗ '$nombre' murió sin dejar marcador (pid $pid ya no existe)." >&2
    echo "  Últimas líneas del log:" >&2
    tail -5 "$log" 2>/dev/null >&2
    exit 3
  fi
  if (( SECONDS >= limite )); then
    echo "⏱ '$nombre' sigue viva tras $tope_min min. No se espera más." >&2
    echo "  Para seguir mirándola: tail -f $log" >&2
    exit 4
  fi
  sleep 10
done
