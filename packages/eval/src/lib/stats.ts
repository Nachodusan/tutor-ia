/**
 * Estadística mínima para el barrido de ranking: PRNG sembrado + bootstrap
 * PAREADO. Sin dependencias.
 *
 * Por qué pareado: sobre 72 preguntas, el IC95 de un recall@5 ABSOLUTO es de
 * ~±8 puntos y no distingue nada. El IC de la DIFERENCIA sobre las mismas
 * preguntas es mucho más angosto porque la dificultad de cada pregunta se
 * cancela: cada remuestreo toma el mismo índice en ambas variantes.
 */

/** PRNG mulberry32 — determinista, sembrado, suficiente para bootstrap. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairedBootstrap {
  /** Diferencia observada (media de b − media de a). */
  delta: number;
  /** Límites del IC95 percentil de esa diferencia. */
  lo: number;
  hi: number;
}

/**
 * IC95 (percentil) de la diferencia de medias entre dos vectores PAREADOS por
 * índice (misma pregunta en `a` y en `b`). `reps` remuestreos con reemplazo.
 */
export function pairedBootstrapCI(
  a: number[],
  b: number[],
  reps = 2000,
  seed = 20260801,
): PairedBootstrap {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`vectores pareados inválidos: |a|=${a.length} |b|=${b.length}`);
  }
  const n = a.length;
  const diffs = a.map((x, i) => (b[i] ?? 0) - x);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const delta = mean(diffs);

  const rnd = mulberry32(seed);
  const deltas = new Array<number>(reps);
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rnd() * n)] ?? 0;
    deltas[r] = s / n;
  }
  deltas.sort((x, y) => x - y);
  const at = (p: number) => deltas[Math.min(reps - 1, Math.max(0, Math.floor(p * reps)))] ?? 0;
  return { delta, lo: at(0.025), hi: at(0.975) };
}
