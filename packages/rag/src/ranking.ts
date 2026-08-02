/**
 * Estrategias de ORDENAMIENTO final de candidatos — la función que comparte
 * producción (`retrieveRanked`) con el experimento offline (`rank-sweep`).
 *
 * Por qué existe: el barrido de variantes solo sirve si la variante que gana es
 * LITERALMENTE el código que después despacha. Si el experimento implementara su
 * propia "combinación lineal", el número medido y el número shippeado serían dos
 * programas distintos.
 *
 * Separación clave — ORDEN vs GATE:
 *  - `rankScore` es el score del ordenamiento elegido (escala arbitraria, solo
 *    comparable dentro de la misma consulta).
 *  - `rerankScore` es SIEMPRE la sigmoide del logit del cross-encoder: la escala
 *    del gate de abstención, invariante entre estrategias. Con min-max el top-1
 *    normalizado vale siempre 1,0 — un gate sobre esa escala nunca cortaría.
 *
 * Nota medida (2026-08-01): z-score y softmax del logit son transformaciones
 * monótonas DENTRO de una consulta → ordenan idéntico a la sigmoide. Solo tienen
 * efecto como entrada de `linear`, donde la escala decide el peso efectivo.
 */

export type RankStrategy =
  /** Solo cross-encoder (comportamiento histórico). */
  | { kind: "ce" }
  /** Solo la fusión RRF (denso+léxico por posición), sin cross-encoder. */
  | { kind: "rrf" }
  /** Solo el ranking denso. */
  | { kind: "dense" }
  /** Solo el ranking léxico. */
  | { kind: "lexical" }
  /** alpha*RRF + (1-alpha)*CE, ambos normalizados por consulta. */
  | { kind: "linear"; alpha: number; norm: "minmax" | "z" }
  /** El RRF manda; el cross-encoder solo reordena el top-N del RRF. */
  | { kind: "rrf_then_ce"; topN: number };

export const DEFAULT_RANK_STRATEGY: RankStrategy = { kind: "ce" };

/** Candidato mínimo que las estrategias saben ordenar. */
export interface RankableCandidate {
  rrf: number;
  denseRank: number | null;
  lexicalRank: number | null;
}

export interface RankedScores {
  /** Score del ordenamiento elegido (escala arbitraria por consulta). */
  rankScore: number;
  /** Sigmoide del logit del CE — la escala del GATE, invariante a la estrategia. */
  rerankScore: number;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Normaliza un vector por consulta. Degenerados (n<2 o rango 0) → todos 0.5. */
function normalize(values: number[], how: "minmax" | "z"): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  if (how === "minmax") {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (hi - lo < 1e-12) return values.map(() => 0.5);
    return values.map((v) => (v - lo) / (hi - lo));
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd < 1e-12) return values.map(() => 0.5);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Ordena candidatos según la estrategia. `ceLogits[i]` es el logit CRUDO del
 * cross-encoder para `cands[i]` (sin sigmoide: la sigmoide se deriva acá).
 *
 * Devuelve una lista NUEVA, orden descendente por `rankScore`, con empates rotos
 * por `rerankScore` y luego por `rrf` — determinista para poder reproducir.
 */
export function orderCandidates<T extends RankableCandidate>(
  cands: T[],
  ceLogits: number[],
  strategy: RankStrategy = DEFAULT_RANK_STRATEGY,
): (T & RankedScores)[] {
  const sig = ceLogits.map(sigmoid);

  let rank: number[];
  switch (strategy.kind) {
    case "ce":
      rank = sig;
      break;
    case "rrf":
      rank = cands.map((c) => c.rrf);
      break;
    case "dense":
      // rank 1 → score alto; ausente del brazo → -rank infinito negativo.
      rank = cands.map((c) => (c.denseRank != null ? -c.denseRank : -Infinity));
      break;
    case "lexical":
      rank = cands.map((c) => (c.lexicalRank != null ? -c.lexicalRank : -Infinity));
      break;
    case "linear": {
      const a = strategy.alpha;
      const nr = normalize(cands.map((c) => c.rrf), strategy.norm);
      const nc = normalize(ceLogits, strategy.norm);
      rank = cands.map((_, i) => a * (nr[i] ?? 0) + (1 - a) * (nc[i] ?? 0));
      break;
    }
    case "rrf_then_ce": {
      // Los top-N del RRF se reordenan por CE por ENCIMA del resto; el resto
      // conserva el orden RRF por debajo. Bandas: [1,2) para el top-N con la
      // sigmoide como orden interno, [0,1) para la cola con RRF normalizado.
      const byRrf = cands
        .map((c, i) => ({ i, rrf: c.rrf }))
        .sort((x, y) => y.rrf - x.rrf);
      const topSet = new Set(byRrf.slice(0, strategy.topN).map((x) => x.i));
      const nr = normalize(cands.map((c) => c.rrf), "minmax");
      rank = cands.map((_, i) => (topSet.has(i) ? 1 + (sig[i] ?? 0) : nr[i] ?? 0));
      break;
    }
  }

  return cands
    .map((c, i) => ({
      ...c,
      rankScore: rank[i] ?? -Infinity,
      rerankScore: sig[i] ?? 0,
    }))
    .sort(
      (x, y) =>
        y.rankScore - x.rankScore ||
        y.rerankScore - x.rerankScore ||
        y.rrf - x.rrf,
    );
}

/** "linear:0.4:minmax" | "rrf_then_ce:10" | "ce" | "rrf" | "dense" | "lexical" */
export function parseRankStrategy(s: string | undefined): RankStrategy {
  if (!s || !s.trim()) return DEFAULT_RANK_STRATEGY;
  const parts = s.trim().split(":");
  const kind = parts[0];
  switch (kind) {
    case "ce":
    case "rrf":
    case "dense":
    case "lexical":
      return { kind };
    case "linear": {
      const alpha = Number(parts[1]);
      const norm = parts[2] === "z" ? "z" : "minmax";
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        throw new Error(`RAG_RANKER inválido: "${s}" (alpha debe estar en [0,1])`);
      }
      return { kind: "linear", alpha, norm };
    }
    case "rrf_then_ce": {
      const topN = Number(parts[1]);
      if (!Number.isInteger(topN) || topN < 1) {
        throw new Error(`RAG_RANKER inválido: "${s}" (topN debe ser entero >= 1)`);
      }
      return { kind: "rrf_then_ce", topN };
    }
    default:
      throw new Error(`RAG_RANKER inválido: "${s}"`);
  }
}

/** Estrategia efectiva desde RAG_RANKER (default: ce, el comportamiento histórico). */
export function rankStrategyFromEnv(): RankStrategy {
  return parseRankStrategy(process.env.RAG_RANKER);
}

/** Forma corta para logs: "ce", "linear:0.4:minmax", "rrf_then_ce:10". */
export function describeStrategy(s: RankStrategy): string {
  switch (s.kind) {
    case "linear":
      return `linear:${s.alpha}:${s.norm}`;
    case "rrf_then_ce":
      return `rrf_then_ce:${s.topN}`;
    default:
      return s.kind;
  }
}
