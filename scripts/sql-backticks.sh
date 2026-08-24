#!/usr/bin/env bash
# =============================================================================
# NINGÚN LITERAL sql`...` PUEDE TENER UN BACKTICK ADENTRO.
#
# Un backtick dentro de un template literal lo CIERRA. Escribir `family` en un
# comentario SQL —que en prosa es lo natural— parte la consulta al medio y el
# error que sale ("Module declaration names may only use quoted strings") no
# menciona ni la consulta ni el backtick.
#
# Pasó cuatro veces en una sola sesión, siempre igual: un comentario SQL que
# nombra una columna. Por eso el chequeo, y no la buena intención.
#
#   scripts/sql-backticks.sh          # revisa packages/ y apps/
# =============================================================================
set -uo pipefail
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
malos=0
while IFS= read -r f; do
  # Un literal que empieza con sql` y cuya línea siguiente no cierra: se busca
  # el patrón simple de un backtick en una línea de comentario SQL.
  if grep -nE '^\s*--.*`' "$f" >/dev/null 2>&1; then
    echo "✗ $f"
    grep -nE '^\s*--.*`' "$f" | sed 's/^/    /'
    malos=$((malos+1))
  fi
done < <(find "$raiz/packages" "$raiz/apps" -name '*.ts' -not -path '*/node_modules/*' -not -path '*/.next/*')
if (( malos )); then
  echo ""
  echo "Los comentarios SQL de arriba tienen un backtick, que CIERRA el template"
  echo "literal. Sacalo: en un comentario SQL alcanza con nombrar la columna."
  exit 1
fi
echo "✓ ningún comentario SQL con backtick"
