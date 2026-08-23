#!/usr/bin/env bash
# =============================================================================
# RESPALDO DE LA BASE `tutor`.
#
# Por qué existe: la base tiene 29.000+ fragmentos que costaron horas de ingesta
# (extracción de PDF + embeddings + reranker), y hasta hoy NO había ninguna
# copia. Un `dropdb` accidental o un disco que falla y se pierde todo el corpus
# de la educación escolar chilena ya procesado.
#
# Formato `custom` (-Fc): comprimido, y `pg_restore` puede restaurar tablas
# sueltas sin traer los 430 MB enteros.
#
# Uso:
#   scripts/backup-db.sh                 # respaldo completo
#   scripts/backup-db.sh --schema-only   # solo el esquema (rápido, para versionar)
#   BACKUP_DIR=/otra/ruta scripts/backup-db.sh
#
# Restaurar:
#   createdb tutor_restore
#   pg_restore -d tutor_restore --no-owner ~/tutor-backups/tutor-AAAA-MM-DD.dump
#
# ── COPIA FUERA DE ESTA MÁQUINA ────────────────────────────────────────────
# Los respaldos de acá viven en el MISMO disco que la base: cubren el `dropdb`
# accidental, no el disco que falla. La copia remota va como asset de release
# del repo privado (cabe: el límite es 2 GB por archivo y el dump pesa ~205 MB):
#
#   gh release create corpus-AAAA-MM-DD ~/tutor-backups/tutor-AAAA-MM-DD_HHMM.dump \
#     -R Nachodusan/tutor-ia -t "Corpus AAAA-MM-DD · N chunks"
#
# VERIFICAR SIEMPRE bajándolo y comparando el sha256: que el tamaño coincida no
# prueba que el archivo esté íntegro, y un respaldo sin verificar no es un
# respaldo. `pg_restore -l` sobre el archivo bajado confirma que se puede leer.
#
# ⚠️ El dump lleva adentro el texto completo de libros de editoriales bajo
# copyright. El repo TIENE que seguir siendo privado.
# =============================================================================
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

DB_URL="${DATABASE_URL:-postgresql://localhost:5432/tutor}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/tutor-backups}"
# Cuántos respaldos completos conservar. Los más viejos se borran solos: sin
# esto, 430 MB por corrida llenan el disco en silencio.
KEEP="${BACKUP_KEEP:-7}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"

if [[ "${1:-}" == "--schema-only" ]]; then
  OUT="$BACKUP_DIR/tutor-schema-$STAMP.sql"
  pg_dump "$DB_URL" --schema-only --no-owner --no-privileges -f "$OUT"
  echo "✓ esquema: $OUT ($(du -h "$OUT" | cut -f1))"
  exit 0
fi

OUT="$BACKUP_DIR/tutor-$STAMP.dump"
TMP="$OUT.parcial"

# A un archivo temporal: si pg_dump falla a mitad, no queda un .dump truncado
# que parezca un respaldo válido. Solo se renombra si terminó bien.
pg_dump "$DB_URL" -Fc --no-owner --no-privileges -f "$TMP"
mv "$TMP" "$OUT"

# Verificación real: que `pg_restore -l` pueda leer el índice del archivo. Un
# respaldo que no se puede abrir no es un respaldo, y enterarse el día que hace
# falta es tarde.
if ! pg_restore -l "$OUT" > /dev/null 2>&1; then
  echo "✗ el respaldo NO se puede leer: $OUT" >&2
  exit 1
fi

FILAS="$(psql "$DB_URL" -tA -c 'select count(*) from chunks')"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1)) · $FILAS chunks · verificado con pg_restore -l"

# Rotación.
COUNT="$(find "$BACKUP_DIR" -name 'tutor-*.dump' -type f | wc -l | tr -d ' ')"
if (( COUNT > KEEP )); then
  find "$BACKUP_DIR" -name 'tutor-*.dump' -type f -print0 \
    | xargs -0 ls -t | tail -n +$((KEEP + 1)) \
    | while read -r viejo; do rm -f "$viejo"; echo "  · rotado: $(basename "$viejo")"; done
fi
