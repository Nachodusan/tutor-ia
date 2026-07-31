/**
 * Selección de proveedor por variable de entorno.
 *
 *   LLM_PROVIDER=ollama     → local (DEFAULT; si la variable no está, es esto)
 *   LLM_PROVIDER=deepinfra  → API remota compatible con OpenAI
 *
 * Cambiar de motor es cambiar UNA variable: no hay que recompilar ni tocar
 * código. Los ~11 call sites siguen llamando a chatStream/chatJSON/chatText.
 */
import { config } from "../config";
import { OpenAICompatProvider, hostOf } from "./openai-compat";
import { OllamaProvider } from "./ollama";
import { LLMError, type LLMProvider, type LLMProviderName } from "./types";

export * from "./types";
export * from "./budget";
export { describeParams, resolveGenParams, activeReasoningParams } from "./params";
export { findStrictViolations, formatViolations } from "./strict-schema";
export {
  ThinkStreamFilter,
  estimateTokens,
  extractReasoningField,
  stripThinkBlocks,
} from "./reasoning";
export { OllamaProvider } from "./ollama";
export {
  OpenAICompatProvider,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  hostOf,
} from "./openai-compat";

let cached: LLMProvider | null = null;
let cachedFor: LLMProviderName | null = null;

/** Nombre del proveedor activo. Valor desconocido → error claro, no fallback mudo. */
export function activeProviderName(): LLMProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "ollama").trim().toLowerCase();
  if (raw === "" || raw === "ollama") return "ollama";
  if (raw === "deepinfra") return "deepinfra";
  throw new LLMError(
    `LLM_PROVIDER="${raw}" no es válido. Valores aceptados: "ollama" (default) o "deepinfra".`,
    { provider: "ollama", kind: "client", retryable: false },
  );
}

/** Provider activo (memoizado; se reconstruye si cambia LLM_PROVIDER). */
export function getLLM(): LLMProvider {
  const name = activeProviderName();
  if (cached && cachedFor === name) return cached;
  cached = name === "deepinfra" ? new OpenAICompatProvider() : new OllamaProvider();
  cachedFor = name;
  return cached;
}

/**
 * Instancia explícita (script de humo: comparar proveedores lado a lado).
 * `baseUrl` permite apuntar el MISMO modelo a distintos proveedores.
 */
export function makeProvider(
  name: LLMProviderName,
  model?: string,
  baseUrl?: string,
): LLMProvider {
  return name === "deepinfra"
    ? new OpenAICompatProvider(model, baseUrl)
    : new OllamaProvider(model);
}

/** Limpia el memo (tests / cambios de env en caliente). */
export function resetLLM(): void {
  cached = null;
  cachedFor = null;
}

/** Resumen del motor activo, para arrancar scripts mostrando qué se está midiendo. */
export function describeActiveLLM(): string {
  const p = getLLM();
  const where = p.name === "deepinfra" ? `@${hostOf(config.llmBaseUrl)}` : "@local";
  return (
    `${p.name}${where} · ${p.model} · temp=${config.temperature} ` +
    `top_p=${config.topP} max_tokens=${config.maxTokens} reasoning=${config.reasoning}`
  );
}
