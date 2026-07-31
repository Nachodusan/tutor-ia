/**
 * Contrato del proveedor de LLM. Abstrae la ÚLTIMA llamada de generación para
 * poder alternar entre Ollama (local, default) y una API remota compatible con
 * OpenAI (DeepInfra) con una sola variable de entorno.
 *
 * NO toca embeddings (bge-m3), reranker (bge-reranker-v2-m3) ni el sidecar NLI:
 * esos siguen corriendo local siempre.
 */

/** Un turno de conversación (formato que ya usa todo el pipeline). */
export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Lo que recibe un provider como "prompt". Acepta texto suelto o una
 * conversación multi-turno: el tutor arma system + historial + turno del
 * alumno, y perder eso rompería la enseñanza adaptativa.
 */
export type LLMPrompt = string | ChatMsg[];

export interface GenOptions {
  /** Si se omite, se usa el default CANÓNICO (idéntico en todos los providers). */
  temperature?: number;
  /** Tope de tokens de salida. Se omite → default canónico (ver params.ts). */
  maxTokens?: number;
  /** Corta la llamada. Default por provider (Ollama conserva su comportamiento). */
  timeoutMs?: number;
  /** Cancelación externa (se combina con el timeout). */
  signal?: AbortSignal;
}

/** Tokens de una llamada. `null` = el proveedor no los reportó. */
export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * Tokens gastados en razonamiento invisible. Ojo: NO se suman aparte al
   * presupuesto — ya vienen incluidos en `outputTokens` (verificado: Qwen3.6
   * gastó 191 tokens de salida para 3 de respuesta). Es visibilidad de cuánto
   * se paga por texto que nadie ve.
   */
  reasoningTokens?: number | null;
  /** true → `reasoningTokens` es una estimación (~4 chars/token), no del API. */
  reasoningEstimated?: boolean;
}

export type LLMProviderName = "ollama" | "deepinfra";

export interface LLMProvider {
  readonly name: LLMProviderName;
  readonly model: string;

  /** Texto completo (no streaming). */
  generate(prompt: LLMPrompt, opts?: GenOptions): Promise<string>;

  /**
   * Salida estructurada validada contra un JSON Schema.
   * Ollama → `format: schema`; DeepInfra → `response_format` json_schema strict.
   */
  generateStructured<T>(prompt: LLMPrompt, schema: unknown, opts?: GenOptions): Promise<T>;

  /** Streaming token a token (para el chat). */
  generateStream(prompt: LLMPrompt, opts?: GenOptions): AsyncGenerator<string>;
}

export type LLMErrorKind =
  /** Se agotó el timeout (o abort externo). */
  | "timeout"
  /** HTTP 429 — reintentable. */
  | "rate_limit"
  /** HTTP 5xx — reintentable. */
  | "server"
  /** HTTP 4xx que NO es 429 — nunca reintentar. */
  | "client"
  /** 401/403: falta la API key o es inválida. */
  | "auth"
  /** Fallo de red / DNS / conexión rechazada. */
  | "network"
  /** Respuesta vacía o JSON inválido. */
  | "bad_response"
  /** El schema no cumple los requisitos del modo estricto. */
  | "bad_schema"
  /** Se superó el tope de tokens de la corrida (budget.ts). */
  | "budget_exceeded"
  /** El modelo agotó los tokens razonando y no llegó a responder. */
  | "reasoning_overflow";

/** Error tipado que las capas de arriba pueden distinguir por `kind`/`provider`. */
export class LLMError extends Error {
  readonly provider: LLMProviderName;
  readonly kind: LLMErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly attempts: number;

  constructor(
    message: string,
    opts: {
      provider: LLMProviderName;
      kind: LLMErrorKind;
      status?: number;
      retryable?: boolean;
      attempts?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "LLMError";
    this.provider = opts.provider;
    this.kind = opts.kind;
    this.status = opts.status;
    this.retryable = opts.retryable ?? RETRYABLE_KINDS.has(opts.kind);
    this.attempts = opts.attempts ?? 1;
  }
}

/** Solo 429 y 5xx se reintentan. Un 4xx distinto de 429 no se reintenta nunca. */
export const RETRYABLE_KINDS: ReadonlySet<LLMErrorKind> = new Set<LLMErrorKind>([
  "rate_limit",
  "server",
  "network",
]);

export function isLLMError(e: unknown): e is LLMError {
  return e instanceof LLMError;
}

/** Normaliza el prompt a mensajes de chat. */
export function toMessages(prompt: LLMPrompt): ChatMsg[] {
  return typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
}
