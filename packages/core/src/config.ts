/**
 * Configuración del modo LOCAL. Todo corre en tu máquina vía Ollama; nada se
 * envía a la nube. Los valores por defecto están pensados para ser
 * CONSERVADORES (baja creatividad = menos alucinaciones).
 */
export const config = {
  /** Endpoint del servidor Ollama local. */
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",

  /** Modelo de lenguaje local. Qwen2.5-7B sigue instrucciones muy bien. */
  llmModel: process.env.LLM_MODEL ?? "qwen2.5:7b-instruct",

  /**
   * Temperatura baja = respuestas deterministas y conservadoras.
   * 0.1 hace que el modelo se ciña al material y no "improvise".
   */
  temperature: numberEnv("LLM_TEMPERATURE", 0.1),

  /** top_p acotado también reduce divagación. */
  topP: numberEnv("LLM_TOP_P", 0.9),

  /** Ventana de contexto (tokens). Suficiente para varios fragmentos + pregunta. */
  numCtx: intEnv("LLM_NUM_CTX", 8192),

  /**
   * Umbral de similitud (0..1) para considerar un fragmento como "relevante".
   * Si NINGÚN fragmento supera este umbral, la IA se ABSTIENE en vez de inventar.
   * Anti-alucinación capa 1 (retrieval gating).
   */
  minSimilarity: numberEnv("RAG_MIN_SIMILARITY", 0.35),

  /**
   * Verificador anti-alucinación (capa 5): tras responder, una segunda pasada
   * comprueba que cada afirmación esté respaldada por el material. Cuesta
   * latencia extra; desactivado por defecto en local. Ver docs/anti-alucinaciones.md
   */
  enableVerifier: boolEnv("RAG_ENABLE_VERIFIER", false),

  /**
   * Umbral del reranker cross-encoder (0-1) para el gate de abstención (capa A1).
   * CALIBRADO sobre el golden set (§9.3): material relevante ≥0.092, irrelevante
   * ≤0.0024 → plateau seguro 0.05-0.50. 0.3 da abstención verdadera 100% / falsa 3%
   * con margen para queries near-miss. Ver docs/fase-1-hallazgos.md.
   */
  rerankMinScore: numberEnv("RERANK_MIN_SCORE", 0.3),
} as const;

function numberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  // Cadena vacía/espacios = ausente. Sin esto, RERANK_MIN_SCORE="" daría 0 y
  // desactivaría el gate de abstención en silencio (todo pasaría el umbral).
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function intEnv(name: string, fallback: number): number {
  return Math.trunc(numberEnv(name, fallback));
}
function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}
