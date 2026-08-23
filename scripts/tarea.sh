#!/usr/bin/env bash
# =============================================================================
# LANZA UN TRABAJO LARGO QUE SOBREVIVE AL SHELL QUE LO LANZÓ.
#
# Por qué existe: las corridas de eval de este repo tardan más que el timeout de
# quien las lanza (la guarda ~5 min, el banco ~15, una re-ingesta ~30). Lanzarlas
# con `nohup … &` NO alcanza:
#
#   · `nohup` solo ignora SIGHUP. Cuando al shell padre lo matan por timeout, el
#     SIGTERM va a TODO EL GRUPO DE PROCESOS y se lleva el trabajo con él.
#   · Pasó cuatro veces en una sola sesión: la cadena moría a mitad, el archivo
#     marcador nunca se escribía, y el vigía quedaba esperando algo que ya nadie
#     iba a crear. Uno estuvo colgado 11 horas.
#
# Este script arregla las dos mitades:
#   1. `setsid` pone el trabajo en OTRA SESIÓN, así que el SIGTERM al grupo del
#      padre no lo alcanza.
#   2. Un `trap EXIT` escribe el marcador SIEMPRE — termine bien, mal o por
#      señal. El marcador lleva adentro el código de salida, así que quien espera
#      sabe además CÓMO terminó, no solo que terminó.
#
# Uso:
#   scripts/tarea.sh <nombre> <comando...>
#     → escribe <dir>/<nombre>.log  y al final <dir>/<nombre>.done
#     → imprime el PID, para pasárselo a esperar.sh
#
#   TAREA_DIR=/otra/ruta scripts/tarea.sh guarda pnpm --filter … retrieval-guard
#
# El directorio por defecto es .tareas/ en la raíz del repo (gitignoreado).
# =============================================================================
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "uso: scripts/tarea.sh <nombre> <comando...>" >&2
  exit 2
fi

nombre="$1"; shift
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${TAREA_DIR:-$raiz/.tareas}"
mkdir -p "$dir"

log="$dir/$nombre.log"
done_file="$dir/$nombre.done"
rm -f "$done_file"

# DESPEGARSE DEL PADRE — best effort, y hay que saber hasta dónde llega.
#
# `setsid` no existe en macOS; se usa el equivalente POSIX vía perl. MEDIDO: la
# tarea queda con PPID=1 (se despega del padre, así que no muere cuando el padre
# termina) pero CONSERVA EL GRUPO DE PROCESOS del lanzador. O sea que un SIGTERM
# dirigido al GRUPO —que es lo que hace un timeout de shell— igual la alcanza.
#
# ⚠️ Y en ese caso el trap de abajo NO llega a escribir el marcador: bash difiere
# la señal mientras espera al comando en primer plano y muere antes de correrlo.
# Verificado mandando TERM al grupo: la tarea desaparece sin dejar `.done`.
#
# POR ESO LA GARANTÍA DE QUE EL VIGÍA NO SE CUELGUE NO VIVE ACÁ, sino en
# `esperar.sh`, que comprueba con `kill -0` si el proceso sigue existiendo y no
# depende del marcador. Medido en ese escenario: detecta la muerte en 0,011 s.
# Este despegue reduce los casos en que la tarea muere; el vigía cubre el resto.
if command -v setsid >/dev/null 2>&1; then
  despegar=(setsid)
else
  despegar=(perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "no se pudo lanzar: $!"' --)
fi

# ⚠️ EL HIJO NO PUEDE HEREDAR stdout, o `PID=$(scripts/tarea.sh …)` SE CUELGA.
# La sustitución de comandos espera a que se cierren TODOS los descriptores de
# salida, no a que el proceso principal termine: si el hijo en segundo plano
# hereda stdout y lo mantiene abierto tres minutos, `$(...)` espera tres minutos.
# Por eso van los tres redirect al final (`</dev/null >/dev/null 2>&1`): el
# comando ya escribe su propio log adentro.
#
# El trap va DENTRO del subshell que corre el comando: así se dispara aunque el
# comando falle (set -e), aunque devuelva un código != 0, y aunque le llegue un
# SIGTERM. Sin esto, un fallo deja al que espera colgado para siempre.
"${despegar[@]}" bash -c '
  dir="$1"; nombre="$2"; shift 2
  codigo=1
  trap '"'"'echo "$codigo" > "$dir/$nombre.done"'"'"' EXIT
  trap '"'"'codigo=143; exit 143'"'"' TERM
  trap '"'"'codigo=130; exit 130'"'"' INT
  "$@" > "$dir/$nombre.log" 2>&1
  codigo=$?
  exit $codigo
' _ "$dir" "$nombre" "$@" </dev/null >/dev/null 2>&1 &

pid=$!
echo "$pid" > "$dir/$nombre.pid"
echo "$pid"
