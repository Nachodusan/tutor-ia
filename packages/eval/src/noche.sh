#!/bin/zsh
# CORRIDA DE REFERENCIA — se deja andando y a la mañana están los números.
#
# Por qué las tres cosas y no solo el golden: el golden de 101 corre con
# `history: []`, así que NO PUEDE VER nada de lo conversacional (clasificación de
# turno, propuesta del plan, aceptación, limpieza de muletillas). Sin los sets
# multiturno, la corrida da una línea base preciosa de lo único que no cambió.
#
# TEMPERATURA 0 y FECHA FIJA: esta línea base tiene que poder repetirse. A 0,1 dos
# corridas del mismo commit dan números distintos y no se puede atribuir una
# caída. ⚠️ Eso la hace NO comparable punto a punto con el baseline del 5 de
# agosto, que corrió a 0,1: es una referencia nueva, no una continuación.
#
#   ./src/noche.sh   (desde packages/eval)
set -u
cd "$(dirname "$0")/.."

FECHA=$(date +%Y-%m-%d)
DEST=baselines
mkdir -p "$DEST"

export LLM_TEMPERATURE=0
# La fecha entra en el prompt del modo general (avisoDeActualidad); fijarla evita
# que dos corridas en días distintos midan prompts distintos.
export TUTOR_FECHA=$FECHA

LENGUA_USER=00000000-0000-0000-0000-000000000001
LENGUA_SUBJ=d81a7baf-47d2-4ad4-9b71-80a6598da47e
BIO_USER=429bcfaa-e896-4d0e-85f5-daf7b600675d
BIO_SUBJ=c891f80d-6fb3-4b20-ba4c-db3f266dc06b

echo "▶ $(date '+%H:%M')  golden 101 · temp 0"
EVAL_USER_ID=$LENGUA_USER EVAL_SUBJECT_ID=$LENGUA_SUBJ \
  pnpm -s eval golden/questions.jsonl > "$DEST/$FECHA-golden101-t0.log" 2>&1
cp eval-results.json "$DEST/$FECHA-golden101-t0.json" 2>/dev/null

echo "▶ $(date '+%H:%M')  multiturno (Lengua) · temp 0"
EVAL_USER_ID=$LENGUA_USER EVAL_SUBJECT_ID=$LENGUA_SUBJ \
  pnpm -s eval-multiturn golden/conversations.jsonl > "$DEST/$FECHA-multiturn-lengua-t0.log" 2>&1
cp multiturn-results.json "$DEST/$FECHA-multiturn-lengua-t0.json" 2>/dev/null

echo "▶ $(date '+%H:%M')  charla conversacional (Biología) · temp 0"
EVAL_USER_ID=$BIO_USER EVAL_SUBJECT_ID=$BIO_SUBJ \
  pnpm -s eval-multiturn golden/charla-conversacional.jsonl > "$DEST/$FECHA-charla-biologia-t0.log" 2>&1
cp multiturn-results.json "$DEST/$FECHA-charla-biologia-t0.json" 2>/dev/null

echo "✔ $(date '+%H:%M')  listo · $DEST/$FECHA-*"
