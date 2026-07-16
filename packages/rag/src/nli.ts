/**
 * Cliente NLI direccional (Plan v2 §4-A3, versión fuerte). El reranker mide
 * RELEVANCIA y no distingue "on-topic pero falso"; este modelo (mDeBERTa-v3 xnli)
 * devuelve las 3 probabilidades entailment/neutral/contradiction, así que sí
 * captura contradicciones — la debilidad medida de `entails` (~80% de leak).
 *
 * Sirve en el mismo sidecar que el reranker (POST /nli), lazy-load.
 */
const BASE = process.env.RERANK_BASE_URL ?? "http://127.0.0.1:8790";

export interface NliProbs {
  entailment: number;
  neutral: number;
  contradiction: number;
}

/** Puntúa pares [premisa, hipótesis] con el modelo NLI. */
export async function nliPairs(
  pairs: [string, string][],
): Promise<NliProbs[]> {
  if (pairs.length === 0) return [];
  const r = await fetch(`${BASE}/nli`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairs }),
    signal: AbortSignal.timeout(Number(process.env.NLI_TIMEOUT_MS ?? "30000")),
  });
  if (!r.ok) {
    throw new Error(
      `nli server ${r.status}. ¿Está corriendo el sidecar con /nli? ` +
        `packages/ingest-py/rerank_server.py`,
    );
  }
  const j = (await r.json()) as { results: NliProbs[] };
  return j.results;
}

export interface EntailmentVerdict {
  /** Máx. prob. de entailment de la hipótesis sobre algún chunk. */
  entailment: number;
  /** Máx. prob. de contradiction sobre algún chunk. */
  contradiction: number;
  /** true → algún chunk IMPLICA la hipótesis por encima del umbral. */
  supported: boolean;
  /** true → algún chunk la CONTRADICE por encima del umbral (señal fuerte de error). */
  contradicted: boolean;
}

/**
 * Veredicto NLI de una hipótesis contra un conjunto de chunks (premisas).
 * "supported" si ALGÚN chunk la implica; "contradicted" si ALGÚN chunk la
 * contradice. Se evalúa cada chunk por separado (un solo chunk grande podría
 * diluir la señal si se concatenara).
 *
 * @param minEntail   umbral de entailment para dar por respaldada (default 0.5)
 * @param minContra   umbral de contradiction para marcar contradicción (default 0.5)
 */
export async function nliVerify(
  hypothesis: string,
  chunkTexts: string[],
  minEntail = Number(process.env.NLI_MIN_ENTAIL ?? "0.5"),
  minContra = Number(process.env.NLI_MIN_CONTRA ?? "0.5"),
): Promise<EntailmentVerdict> {
  if (chunkTexts.length === 0 || hypothesis.trim() === "") {
    return { entailment: 0, contradiction: 0, supported: false, contradicted: false };
  }
  const results = await nliPairs(chunkTexts.map((c) => [c, hypothesis]));
  const entailment = Math.max(0, ...results.map((r) => r.entailment));
  const contradiction = Math.max(0, ...results.map((r) => r.contradiction));
  // "Contradicha" exige que la señal de contradicción SUPERE a la de entailment:
  // con muchos chunks recuperados, uno irrelevante puede disparar contradiction
  // espuria aunque OTRO chunk implique la oración con fuerza. Si algún chunk la
  // respalda claramente, no la marcamos contradicha por un chunk que no viene al
  // caso. (En el set etiquetado, single-chunk, esto no cambia nada.)
  return {
    entailment,
    contradiction,
    supported: entailment >= minEntail,
    contradicted: contradiction >= minContra && contradiction > entailment,
  };
}

/** ¿El sidecar NLI responde? (carga perezosa: la primera llamada puede tardar). */
export async function nliHealthy(): Promise<boolean> {
  try {
    const r = await nliPairs([["Esto es una prueba.", "Esto es una prueba."]]);
    return r.length === 1;
  } catch {
    return false;
  }
}
