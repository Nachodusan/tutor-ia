/**
 * Cliente del reranker cross-encoder (Plan v2 §2, capa A1) + retrieval gateado.
 *
 * El reranker (bge-reranker-v2-m3, servido por rerank_server.py) puntúa cada
 * candidato contra la consulta. Su score discrimina relevancia mucho mejor que
 * el coseno comprimido de bge-m3 → sirve como GATE DE ABSTENCIÓN calibrable:
 * si el mejor candidato no supera el umbral, la IA se abstiene.
 */
import { retrieveHybrid, type HybridChunk, type HybridOptions } from "./retrieve-hybrid";

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
  rerankScore: number;
}

export interface RankedResult {
  chunks: RankedChunk[];
  /** false → ningún candidato superó el umbral: abstenerse. */
  grounded: boolean;
  /** Mejor score de rerank (0-1). La señal del gate. */
  topScore: number;
}

export interface RankedOptions extends HybridOptions {
  /** Cuántos candidatos recuperar para rerankear (default 25). */
  candidatePool?: number;
  /** Umbral de abstención sobre el score de rerank (0-1). Default env RERANK_MIN_SCORE o 0.5. */
  minRerankScore?: number;
}

/**
 * Retrieval completo con gate de abstención: híbrido (denso+léxico+RRF) para
 * traer candidatos → reranker para ordenarlos y decidir si hay material.
 */
export async function retrieveRanked(
  query: string,
  opts: RankedOptions,
): Promise<RankedResult> {
  const pool = opts.candidatePool ?? 25;
  const threshold =
    opts.minRerankScore ?? Number(process.env.RERANK_MIN_SCORE ?? "0.5");

  const candidates = await retrieveHybrid(query, { ...opts, k: pool });
  if (candidates.length === 0) {
    return { chunks: [], grounded: false, topScore: 0 };
  }

  const scores = await rerank(
    query,
    candidates.map((c) => c.content),
    true,
  );
  const ranked: RankedChunk[] = candidates
    .map((c, i) => ({ ...c, rerankScore: scores[i] ?? 0 }))
    .sort((a, b) => b.rerankScore - a.rerankScore);

  const topScore = ranked[0]?.rerankScore ?? 0;
  return {
    chunks: ranked.slice(0, opts.k ?? 8),
    grounded: topScore >= threshold,
    topScore,
  };
}
