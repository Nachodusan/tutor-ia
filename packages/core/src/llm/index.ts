/**
 * Proveedor de LLM: API remota compatible con OpenAI. Único.
 *
 * Hubo un proveedor local (Ollama) y se eliminó: el proyecto ya corría con
 * LLM_PROVIDER=deepinfra, así que la rama local era código muerto que igual
 * había que mantener, documentar y explicar. Un solo camino es un camino que
 * de verdad se prueba.
 *
 * `LLM_PROVIDER` se sigue aceptando por compatibilidad con .env viejos, pero
 * solo vale "deepinfra". Si dice "ollama" falla con un mensaje que explica qué
 * pasó, en vez de arrancar en silencio contra un servicio que ya no existe.
 *
 * ⚠️ Los embeddings (packages/rag/src/embeddings.ts) también salieron de Ollama
 * y hoy pegan a la misma API. Ver ahí por qué NO hizo falta re-embeber.
 */
import { config } from "../config";
import { OpenAICompatProvider, hostOf } from "./openai-compat";
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
  const raw = (process.env.LLM_PROVIDER ?? "deepinfra").trim().toLowerCase();
  if (raw === "" || raw === "deepinfra") return "deepinfra";
  if (raw === "ollama") {
    throw new LLMError(
      'LLM_PROVIDER="ollama": el proveedor local se eliminó del proyecto. ' +
        'Sacá esa línea del .env (o poné "deepinfra") y asegurate de tener DEEPINFRA_API_KEY.',
      { provider: "deepinfra", kind: "client", retryable: false },
    );
  }
  throw new LLMError(
    `LLM_PROVIDER="${raw}" no es válido. El único valor aceptado es "deepinfra".`,
    { provider: "deepinfra", kind: "client", retryable: false },
  );
}

/** Provider activo (memoizado; se reconstruye si cambia LLM_PROVIDER). */
export function getLLM(): LLMProvider {
  const name = activeProviderName();
  if (cached && cachedFor === name) return cached;
  cached = new OpenAICompatProvider();
  cachedFor = name;
  return cached;
}

/**
 * Instancia explícita (script de humo: comparar proveedores lado a lado).
 * `baseUrl` permite apuntar el MISMO modelo a distintos proveedores.
 */
export function makeProvider(
  _name: LLMProviderName,
  model?: string,
  baseUrl?: string,
): LLMProvider {
  return new OpenAICompatProvider(model, baseUrl);
}

/** Limpia el memo (tests / cambios de env en caliente). */
export function resetLLM(): void {
  cached = null;
  cachedFor = null;
}

/** Resumen del motor activo, para arrancar scripts mostrando qué se está midiendo. */
export function describeActiveLLM(): string {
  const p = getLLM();
  const where = `@${hostOf(config.llmBaseUrl)}`;
  return (
    `${p.name}${where} · ${p.model} · temp=${config.temperature} ` +
    `top_p=${config.topP} max_tokens=${config.maxTokens} reasoning=${config.reasoning}`
  );
}
