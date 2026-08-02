/**
 * Cliente del reranker cross-encoder (Plan v2 §2, capa A1) + retrieval gateado.
 *
 * El reranker (bge-reranker-v2-m3, servido por rerank_server.py) puntúa cada
 * candidato contra la consulta. Su score discrimina relevancia mucho mejor que
 * el coseno comprimido de bge-m3 → sirve como GATE DE ABSTENCIÓN calibrable:
 * si el mejor candidato no supera el umbral, la IA se abstiene.
 */
import {
  retrieveHybridWithStats,
  type HybridChunk,
  type HybridOptions,
  type RetrievalStats,
} from "./retrieve-hybrid";
import {
  orderCandidates,
  rankStrategyFromEnv,
  describeStrategy,
  type RankStrategy,
} from "./ranking";

const BASE = process.env.RERANK_BASE_URL ?? "http://127.0.0.1:8790";

/** ¿El servidor de rerank está vivo? */
export async function rerankHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Puntúa cada pasaje contra la consulta. normalize=true → sigmoide 0-1. */
export async function rerank(
  query: string,
  passages: string[],
  normalize = true,
): Promise<number[]> {
  if (passages.length === 0) return [];
  const r = await fetch(`${BASE}/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, passages, normalize }),
    // Un servidor colgado no debe bloquear todo el retrieval.
    signal: AbortSignal.timeout(
      Number(process.env.RERANK_TIMEOUT_MS ?? "20000"),
    ),
  });
  if (!r.ok) {
    // 503 = el sidecar está saturado y lo dice, en vez de dejar que expiremos.
    // Distinguirlo importa: "no hay turno de GPU" y "el sidecar no está corriendo"
    // se arreglan de formas opuestas, y antes los dos salían con el mismo texto.
    if (r.status === 503) {
      throw new Error(
        `rerank saturado (503): el sidecar no consiguió turno de GPU. ` +
          `No es una caída — está encolado. Bajá la concurrencia o subí RERANK_QUEUE_WAIT_S.`,
      );
    }
    throw new Error(
      `rerank server ${r.status}. ¿Está corriendo? ` +
        `packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py`,
    );
  }
  const j = (await r.json()) as { scores: number[] };
  return j.scores;
}

/**
 * Entailment (Plan v2 §4-A3): ¿alguno de los chunks IMPLICA el claim? Reusamos el
 * cross-encoder tratando el claim como "query" y cada chunk como "passage": su
 * score de relevancia normalizado (0-1) sube cuando el pasaje respalda la
 * afirmación. Devuelve el MEJOR score sobre todos los chunks candidatos.
 *
 * Complementa (no reemplaza) la cita literal A2: una paráfrasis fiel que el
 * string-match perdía puntúa alto acá. Ojo: es un cross-encoder de RELEVANCIA,
 * no un NLI direccional — una contradicción on-topic puntúa moderado (~0.3), no
 * cero; por eso el umbral vive ~0.5, no en el 0.3 del gate de retrieval.
 */
export async function entails(
  claim: string,
  chunkTexts: string[],
): Promise<number> {
  if (chunkTexts.length === 0 || claim.trim() === "") return 0;
  const scores = await rerank(claim, chunkTexts, true);
  return scores.length === 0 ? 0 : Math.max(...scores);
}

export interface RankedChunk extends HybridChunk {
  /** Sigmoide del logit del cross-encoder — la escala del GATE, invariante a la estrategia. */
  rerankScore: number;
  /** Score del ORDENAMIENTO elegido (RAG_RANKER). Con "ce" coincide con rerankScore. */
  rankScore: number;
}

/** Stats del retrieval + del ranking, para el decision-log (sin contenido). */
export interface RankedStats extends RetrievalStats {
  ranker: string;
  candidatePool: number;
  /** Rango del ganador en el brazo denso/léxico ("el que quedó 1º venía del puesto N"). */
  winnerDenseRank: number | null;
  winnerLexRank: number | null;
  /** Margen del top-1 sobre la mediana del pool, en logits (señal del gate híbrido). */
  gapMed?: number;
  /** Por qué vía pasó el gate: "abs" | "margin" | "none". */
  gateVia?: "abs" | "margin" | "none";
}

export interface RankedResult {
  chunks: RankedChunk[];
  /** false → ningún candidato superó el umbral: abstenerse. */
  grounded: boolean;
  /** Mejor score de rerank (0-1). La señal del gate. */
  topScore: number;
  stats?: RankedStats;
}

export interface RankedOptions extends HybridOptions {
  /** Cuántos candidatos recuperar para rerankear (default 25, RAG_CANDIDATE_POOL). */
  candidatePool?: number;
  /** Umbral de abstención sobre el score de rerank (0-1). Default: DEFAULT_RERANK_MIN_SCORE. */
  minRerankScore?: number;
  /** Estrategia de ordenamiento final (default: RAG_RANKER o "ce"). */
  rankStrategy?: RankStrategy;
}

/** Default del pool de candidatos del reranker. Configurable con RAG_CANDIDATE_POOL. */
export const DEFAULT_CANDIDATE_POOL = 25;

export function candidatePoolFromEnv(): number {
  const n = Number(process.env.RAG_CANDIDATE_POOL ?? "");
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CANDIDATE_POOL;
}

/**
 * GATE HÍBRIDO — margen distribucional como segunda vía de entrada.
 *
 * El score absoluto del CE colapsa con registro coloquial (medido: misma
 * pregunta 0.24 "de libro" y 0.006 "profe no cacho"); el MARGEN del top-1 sobre
 * la mediana del pool (en logits) conserva señal cuando la magnitud se hunde.
 * No reemplaza al absoluto (AUC 0.917 vs 0.848 — el absoluto discrimina mejor
 * en general): lo COMPLEMENTA como rescate. Medido sobre capturas (2026-08-02):
 * margen ≥6.0 sobre el fallback normalizado rescata 2 preguntas de alumno más
 * (abst 9→7, recall 62,4→67,1%) sin fuga nueva en must_abstain.
 *
 * A PROPÓSITO no es top1−top2: con ~19% de chunks duplicados en el corpus, dos
 * correctos casi idénticos darían margen chico y gatearían material presente.
 *
 * APROBADO 2026-08-02 con default 6.0 (RERANK_GATE_MARGIN=0 lo apaga): sobre
 * capturas, rescata 2 preguntas de alumno más que el fallback solo (abst 9→7,
 * recall 62,4→67,1%) con el golden idéntico y la única fuga preexistente (q123).
 */
export const DEFAULT_GATE_MARGIN = 6.0;

export function gateMarginFromEnv(): number {
  const v = process.env.RERANK_GATE_MARGIN;
  if (v == null || v.trim() === "") return DEFAULT_GATE_MARGIN;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Mediana simple (el pool es chico; ordenar alcanza). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Retrieval completo con gate de abstención: híbrido (denso+léxico+RRF) para
 * traer candidatos → reranker para ordenarlos y decidir si hay material.
 */
export async function retrieveRanked(
  query: string,
  opts: RankedOptions,
): Promise<RankedResult> {
  const pool = opts.candidatePool ?? candidatePoolFromEnv();
  const threshold =
    opts.minRerankScore ?? rerankMinScoreFromEnv();
  const strategy = opts.rankStrategy ?? rankStrategyFromEnv();

  const { chunks: candidates, stats } = await retrieveHybridWithStats(query, {
    ...opts,
    k: pool,
    // INVARIANTE: cada brazo debe poder aportar `pool` candidatos por sí solo.
    // Sin esto, candidatePool > poolPerSide era un número que no se cumplía:
    // con el brazo léxico vacío el cross-encoder veía 20 candidatos aunque acá
    // dijera 25 (medido 2026-08-01).
    poolPerSide: opts.poolPerSide ?? pool,
  });
  if (candidates.length === 0) {
    return {
      chunks: [],
      grounded: false,
      topScore: 0,
      stats: {
        ...stats,
        ranker: describeStrategy(strategy),
        candidatePool: pool,
        winnerDenseRank: null,
        winnerLexRank: null,
      },
    };
  }

  // ⚠️ ACÁ NO SE TRUNCA, A PROPÓSITO — y es una asimetría conocida.
  //
  // `retrieve-teaching.ts` corta a RERANK_SNIPPET_CHARS (600 ≈ 150 tokens) antes
  // de rerankear; este camino manda el chunk entero, que el servidor recorta a
  // 512 tokens (`RERANK_MAX_LEN`). O sea: esta ruta le da al cross-encoder ~3,4×
  // más texto que la otra, y por eso es la que más carga el sidecar.
  //
  // Pero recortar acá NO es un arreglo de infraestructura: 600 chars está muy por
  // debajo del techo del modelo, así que cambiaría el score de todo chunk de más
  // de 600 caracteres — es decir, casi todos. Es una decisión de CALIDAD
  // (¿cuánto contexto necesita el cross-encoder para juzgar?) que hay que medir
  // con recall@5 y precision@gold, no colar dentro de un fix de estabilidad.
  // Queda para la Fase 1, junto con el resto del ordenamiento.
  // Logits CRUDOS (normalize=false): `orderCandidates` deriva la sigmoide en TS
  // (idéntica a la del sidecar) y algunas estrategias necesitan la escala del
  // logit. Con la estrategia default "ce" el orden resultante es EXACTAMENTE el
  // histórico: sort por sigmoide ≡ sort por logit (monótona).
  const logits = await rerank(
    query,
    candidates.map((c) => c.content),
    false,
  );
  const ranked = orderCandidates(candidates, logits, strategy);

  // GATE: el MÁXIMO rerankScore del pool — la semántica de siempre ("¿hay
  // material?"), independiente de cómo se ordene. Con "ce" coincide con el
  // top-1; con otras estrategias el mejor material puede no quedar primero y
  // el gate no debe castigar eso.
  const topScore = ranked.reduce((m, c) => Math.max(m, c.rerankScore), 0);
  // Segunda vía (gate híbrido, apagado por default): margen del mejor logit
  // sobre la mediana del pool. Ver gateMarginFromEnv().
  const margin = gateMarginFromEnv();
  const topLogit = logits.reduce((m, x) => Math.max(m, x), -Infinity);
  const gapMed = logits.length > 1 ? topLogit - median(logits) : 0;
  const viaAbs = topScore >= threshold;
  const viaMargin = !viaAbs && margin > 0 && gapMed >= margin;
  const winner = ranked[0];
  return {
    chunks: ranked.slice(0, opts.k ?? 8),
    grounded: viaAbs || viaMargin,
    topScore,
    stats: {
      ...stats,
      ranker: describeStrategy(strategy),
      candidatePool: pool,
      winnerDenseRank: winner?.denseRank ?? null,
      winnerLexRank: winner?.lexicalRank ?? null,
      gapMed,
      gateVia: viaAbs ? "abs" : viaMargin ? "margin" : "none",
    },
  };
}

/**
 * ÚNICA fuente del umbral de abstención del gate.
 *
 * Había TRES defaults distintos para el mismo número: 0.18 en core/config.ts,
 * 0.3 en retrieve-teaching.ts y 0.5 acá. Con RERANK_MIN_SCORE seteado los tres
 * coincidían y la divergencia quedaba tapada; sin la env var, el mismo gate
 * valía 0.18, 0.3 o 0.5 según por qué archivo entraras. Vive en `rag` y no en
 * `core` porque core ya depende de rag, y al revés sería circular.
 *
 * CALIBRADO: material relevante ≥0.092, irrelevante ≤0.0024 → plateau seguro
 * 0.05-0.50. 0.18 es el valor de producción desde el rework del tutor flexible.
 */
export const DEFAULT_RERANK_MIN_SCORE = 0.18;

/**
 * Cuántos caracteres del chunk se le mandan al cross-encoder.
 *
 * El modelo trunca a 512 tokens de todos modos (`RERANK_MAX_LEN`), así que más
 * texto no aporta señal: solo infla el padding del batch. 600 es el valor que ya
 * usaba el camino de enseñanza (`retrieve-teaching.ts`) desde que un batch sin
 * truncar causó los primeros timeouts del reranker.
 */
export const RERANK_SNIPPET_CHARS = Number(process.env.RERANK_SNIPPET_CHARS ?? "600");

/** Umbral efectivo: env si está y es un número válido, si no el default. */
export function rerankMinScoreFromEnv(): number {
  const v = process.env.RERANK_MIN_SCORE;
  if (v == null || v.trim() === "") return DEFAULT_RERANK_MIN_SCORE;
  const n = Number(v);
  return Number.isFinite(n) ? n : DEFAULT_RERANK_MIN_SCORE;
}
