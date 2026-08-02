/**
 * Configuración del modo LOCAL. Todo corre en tu máquina vía Ollama; nada se
 * envía a la nube. Los valores por defecto están pensados para ser
 * CONSERVADORES (baja creatividad = menos alucinaciones).
 */
import { DEFAULT_RERANK_MIN_SCORE } from "@tutor-ia/rag";

export const config = {
  /** Endpoint del servidor Ollama local. */
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",

  /** Modelo de lenguaje local. Qwen2.5-7B sigue instrucciones muy bien.
   *  El tag de Ollama es "qwen2.5:7b" (SIN -instruct); con -instruct una corrida
   *  sin env override pega model-not-found. Ver HANDOFF §2. */
  llmModel: process.env.LLM_MODEL ?? "qwen2.5:7b",

  /** LLM_MODEL crudo (sin default). Cada provider aplica el SUYO: si la variable
   *  no está, Ollama usa "qwen2.5:7b" y DeepInfra su modelo remoto. */
  llmModelEnv: process.env.LLM_MODEL?.trim() || undefined,

  /**
   * NORMALIZACIÓN DE LA CONSULTA DEL ALUMNO (puente de vocabulario).
   *
   * Medido 2026-08-01: la misma pregunta puntúa 0.24 en el cross-encoder escrita
   * "de libro" y 0.006 escrita "profe no cacho q es..." — 17/43 preguntas de
   * alumno se abstenían con el material correcto ya recuperado. Normalizar la
   * consulta ANTES del retrieval tiene techo +38,4 pts de recall@5 (las mismas
   * preguntas con formulación de libro dan 86,4% y 0 abstenciones).
   *
   * Solo afecta la consulta de BÚSQUEDA: el modelo docente sigue viendo las
   * palabras del alumno (ahí el registro es señal, no ruido).
   *
   * APROBADO 2026-08-02 (online): alumno 45,3→62,0% de recall@5 y 44,2→20,9% de
   * abstención indebida; golden 87,1% (neutral, ±¼ pregunta); must_abstain
   * intactas (el fallback intentó y no rescató ninguna); qNorm=0 usos en las
   * 101 limpias. Política cruda-primero: solo corre cuando el gate ya cortó.
   */
  queryNormalize: boolEnv("QUERY_NORMALIZE", true),
  /** Modelo local chico para normalizar (1 llamada corta por turno). */
  queryNormalizerModel: process.env.QUERY_NORMALIZER_MODEL ?? "qwen2.5:3b",
  /**
   * Techo de la llamada de normalización; al vencer se usa la consulta cruda.
   *
   * 8 s y no 2,5: el modelo chico se descarga de memoria cuando Ollama lo deja
   * inactivo, y la PRIMERA consulta tras un reinicio paga la carga (medido:
   * 4,4 s en frío contra 340-900 ms en caliente). Con el techo en 2,5 s ese
   * primer alumno perdía el rescate en silencio. Caliente ni se acerca a este
   * techo, así que subirlo no cuesta latencia en el caso normal.
   */
  queryNormalizeTimeoutMs: intEnv("QUERY_NORMALIZE_TIMEOUT_MS", 8000),

  /**
   * Base URL del proveedor compatible con OpenAI. El mismo modelo lo sirven
   * varios (DeepInfra, Scaleway, Novita, Alibaba, Parasail, GMI…), así que
   * apuntar a otro es cambiar esta variable, sin tocar código.
   * OJO: el model ID NO es igual entre proveedores
   *   Qwen/Qwen3.6-35B-A3B (DeepInfra) · qwen/qwen3.6-35b-a3b (Novita)
   *   qwen/qwen3.6-35b-a3b:fp8 (Scaleway) · qwen3.6-35b-a3b (Alibaba)
   * Al cambiar de proveedor hay que ajustar también LLM_MODEL.
   */
  llmBaseUrl:
    process.env.LLM_BASE_URL ??
    process.env.DEEPINFRA_BASE_URL ??
    "https://api.deepinfra.com/v1/openai",

  /**
   * Razonamiento ("thinking") del modelo. Default OFF: con Qwen3.6 medimos
   * 191 tokens de salida para 3 de respuesta útil (64x). Se manda SIEMPRE
   * explícito, nunca se hereda el default del proveedor.
   */
  reasoning: (process.env.LLM_REASONING?.trim().toLowerCase() === "on"
    ? "on"
    : "off") as "on" | "off",

  /**
   * Escape hatch: lista de interruptores de razonamiento a mandar, separados
   * por coma (chat_template_kwargs,reasoning_effort,reasoning,enable_thinking).
   * Vacío = todos. Sirve si un proveedor estricto rechaza claves desconocidas.
   */
  reasoningParams: process.env.LLM_REASONING_PARAMS?.trim() || undefined,

  /** Timeout del provider REMOTO. Local tiene los suyos (abajo). */
  llmTimeoutMs: intEnv("LLM_TIMEOUT_MS", 60_000),

  /**
   * FECHA LÍMITE DURA del streaming, de extremo a extremo. Distinta de
   * `llmTimeoutMs`: aquel se apoya en el AbortSignal que el SDK debe honrar, y
   * NO alcanza — medido el 2026-07-31, una llamada corrió 945 SEGUNDOS con
   * LLM_TIMEOUT_MS=180000 y terminó sin emitir un solo chunk. Este techo lo
   * aplica nuestro propio reloj contra cada `next()` del iterador, así que se
   * cumple aunque del otro lado nadie corte.
   */
  llmStreamDeadlineMs: intEnv("LLM_STREAM_DEADLINE_MS", 120_000),

  /** Streaming local: 0 = SIN timeout (comportamiento histórico de client.ts).
   *  Un turno con el 7B recargando por keep_alive:0 llega a 2-3 min. */
  ollamaStreamTimeoutMs: intEnv("OLLAMA_STREAM_TIMEOUT_MS", 0),

  /** JSON local: 180s, como el LLM_JSON_TIMEOUT_MS histórico. */
  ollamaJsonTimeoutMs: intEnv("LLM_JSON_TIMEOUT_MS", 180_000),

  /** Reintentos (además del intento inicial). Solo 429/5xx; nunca otros 4xx. */
  llmMaxRetries: intEnv("LLM_MAX_RETRIES", 2),

  /**
   * Tope de tokens de SALIDA por llamada. Explícito a propósito: sin esto, una
   * API paga puede generar sin límite y la factura se vuelve impredecible.
   * Los call sites que ya pasan su propio maxTokens (900/1400) mandan sobre esto.
   */
  maxTokens: intEnv("LLM_MAX_TOKENS", 2048),

  /** Semilla (best-effort en ambos proveedores). Ayuda a reproducir corridas. */
  seed: process.env.LLM_SEED != null ? intEnv("LLM_SEED", 0) : undefined,

  /**
   * TOPE DE GASTO: tokens acumulados por corrida. Al superarlo, la próxima
   * llamada aborta con LLMError kind="budget_exceeded". 0 = sin límite.
   * Pensado para el golden set (133 preguntas × 2 llamadas × reintentos).
   */
  maxTokensPerRun: intEnv("LLM_MAX_TOKENS_PER_RUN", 0),

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
   * Condición de DERIVA de verify.ts, parametrizada para poder calibrarla con
   * `pnpm drift-sweep` (sobre los prodVerdicts persistidos, sin LLM ni NLI).
   * Los defaults REPRODUCEN la condición histórica (supported=0 y ≥3
   * contradicciones fuertes a 0.6) — que medida disparó 0/77: es un detector
   * apagado. Cambiar estos números es una decisión que sale del sweep, no de acá.
   */
  driftMinChecked: intEnv("NLI_DRIFT_MIN_CHECKED", 1),
  driftMaxSupportedFrac: numberEnv("NLI_DRIFT_MAX_SUPPORTED", 0),
  driftMinStrong: intEnv("NLI_DRIFT_MIN_STRONG", 3),
  driftContraMin: numberEnv("NLI_DRIFT_CONTRA_MIN", 0.6),

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
   * ≤0.0024 → plateau seguro 0.05-0.50. Bajado a 0.18 (de 0.3) para un tutor
   * FLEXIBLE: preguntas mal formuladas igual encuentran material; el anti-invento
   * se apoya en el prompt (no inventar datos) + la detección de deriva, no en un
   * gate estricto. Ver docs/fase-1-hallazgos.md.
   */
  rerankMinScore: numberEnv("RERANK_MIN_SCORE", DEFAULT_RERANK_MIN_SCORE),
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
