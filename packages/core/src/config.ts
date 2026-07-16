/**
 * Configuración del modo LOCAL. Todo corre en tu máquina vía Ollama; nada se
 * envía a la nube. Los valores por defecto están pensados para ser
 * CONSERVADORES (baja creatividad = menos alucinaciones).
 */
export const config = {
  /** Endpoint del servidor Ollama local. */
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",

  /** Modelo de lenguaje local. Qwen2.5-7B sigue instrucciones muy bien.
   *  El tag de Ollama es "qwen2.5:7b" (SIN -instruct); con -instruct una corrida
   *  sin env override pega model-not-found. Ver HANDOFF §2. */
  llmModel: process.env.LLM_MODEL ?? "qwen2.5:7b",

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
   * Verificador anti-alucinación (capa 5, A3): tras responder, cada oración se
   * comprueba por entailment (cross-encoder) contra el material. Determinista y
   * barato (~100ms/oración en MPS, sin LLM extra) → ACTIVO por defecto desde la
   * Fase 2. RAG_ENABLE_VERIFIER=0 lo apaga. Ver verify.ts.
   */
  enableVerifier: boolEnv("RAG_ENABLE_VERIFIER", true),

  /**
   * Umbral del cross-encoder de RELEVANCIA (A3 débil, `entails`). Se conserva
   * para retrieval/rescate, NO para el verificador de producción: mide relevancia,
   * no verdad (dejaba pasar ~80% de contradicciones — pnpm eval nli-validate).
   */
  entailMinScore: numberEnv("ENTAIL_MIN_SCORE", 0.5),

  /**
   * Verificador de producción = NLI DIRECCIONAL (mDeBERTa-v3 xnli). Medido sobre
   * el set etiquetado (nli-validate): contradicciones detectadas 80% (leak como
   * respaldada 5%, vs 80% del reranker); neutral leak 0% (vs 40%); recall sobre
   * paráfrasis fieles 65% en single-chunk (mejor en prod: 8 chunks). Sesgo
   * conservador a propósito: para un tutor "no alucina", marcar de más una
   * respuesta correcta es preferible a bendecir una falsa.
   */
  nliMinEntail: numberEnv("NLI_MIN_ENTAIL", 0.5),
  nliMinContra: numberEnv("NLI_MIN_CONTRA", 0.5),

  /**
   * Detección de PREMISA FALSA antes de responder (Fase 2): extrae las
   * presuposiciones de la pregunta y, si el material las contradice (NLI), le
   * ordena al tutor corregirlas en vez de seguirles la corriente. Era el peor
   * fracaso del eval (false_premise 100%). Cuesta 1 llamada extra al LLM solo
   * cuando la pregunta presupone hechos. RAG_FALSE_PREMISE_CHECK=0 lo apaga.
   */
  enableFalsePremiseCheck: boolEnv("RAG_FALSE_PREMISE_CHECK", true),

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
