/**
 * Barrido del umbral de abstención — extraído de calibrate.ts para poder
 * reusarlo OFFLINE (rank-sweep) además del CLI en vivo.
 *
 * Entra: (score del gate, ¿debería abstenerse?) por pregunta. Sale: la curva
 * trueAbstention/falseAbstention por umbral y la recomendación (gap limpio →
 * punto medio; solapamiento → Youden J).
 *
 * El "score del gate" es SIEMPRE la sigmoide del logit del cross-encoder del
 * mejor candidato (rerankScore) — la escala calibrada del gate, invariante a la
 * estrategia de ordenamiento.
 */

export interface GateRow {
  /** true si la pregunta es de tipo must_abstain (debería abstenerse). */
  abstainExpected: boolean;
  /** Score del gate (máximo rerankScore del pool). */
  topScore: number;
}

export interface ThresholdPoint {
  thr: number;
  trueAbstention: number;
  falseAbstention: number;
  /** Youden J = trueAbstention - falseAbstention. */
  j: number;
  cumpleObjetivos: boolean;
}

export interface ThresholdSweep {
  points: ThresholdPoint[];
  /** Mayor topScore entre las que deben abstenerse. */
  maxAbstain: number;
  /** Menor topScore entre las que deben responder. */
  minAnswer: number;
  /** > 0 → separación limpia; el umbral recomendado es el punto medio. */
  gap: number;
  /** Umbral recomendado (punto medio del gap, o el mejor J si hay solape). */
  recomendado: number;
  separacionLimpia: boolean;
}

export function sweepThreshold(
  rows: GateRow[],
  opts: { from?: number; to?: number; step?: number; trueMin?: number; falseMax?: number } = {},
): ThresholdSweep {
  const { from = 0.05, to = 0.95, step = 0.05, trueMin = 0.95, falseMax = 0.1 } = opts;
  const abstainSet = rows.filter((r) => r.abstainExpected);
  const answerSet = rows.filter((r) => !r.abstainExpected);
  const maxAbstain = abstainSet.length ? Math.max(...abstainSet.map((r) => r.topScore)) : 0;
  const minAnswer = answerSet.length ? Math.min(...answerSet.map((r) => r.topScore)) : 1;

  const points: ThresholdPoint[] = [];
  let best: ThresholdPoint | null = null;
  for (let t = from; t <= to + 1e-9; t += step) {
    const trueA = abstainSet.length
      ? abstainSet.filter((r) => r.topScore < t).length / abstainSet.length
      : 0;
    const falseA = answerSet.length
      ? answerSet.filter((r) => r.topScore < t).length / answerSet.length
      : 0;
    const p: ThresholdPoint = {
      thr: Number(t.toFixed(4)),
      trueAbstention: trueA,
      falseAbstention: falseA,
      j: trueA - falseA,
      cumpleObjetivos: trueA >= trueMin && falseA <= falseMax,
    };
    points.push(p);
    if (!best || p.j > best.j) best = p;
  }

  const gap = minAnswer - maxAbstain;
  const separacionLimpia = gap > 0;
  return {
    points,
    maxAbstain,
    minAnswer,
    gap,
    recomendado: separacionLimpia ? (minAnswer + maxAbstain) / 2 : best?.thr ?? 0,
    separacionLimpia,
  };
}
