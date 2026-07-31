/**
 * Parámetros de generación CANÓNICOS.
 *
 * Por qué existe este archivo: si un call site no pasa `temperature`, Ollama
 * usaría 0.1 (nuestro default) pero DeepInfra usaría el suyo (1.0 en APIs
 * compatibles con OpenAI). Mismo prompt → respuestas distintas cada corrida, y
 * el golden set deja de ser reproducible sin que nada avise.
 *
 * Regla: acá se resuelve UN set de valores y cada provider los manda SIEMPRE
 * explícitos al wire. Ningún provider hereda defaults del proveedor.
 * La única variable que debe cambiar entre dos mediciones es el modelo.
 */
import { config } from "../config";
import type { GenOptions } from "./types";

export interface ResolvedParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  /** "off" (default) apaga el razonamiento; "on" lo deja actuar. */
  reasoning: "off" | "on";
  /** Best-effort en ambos proveedores; ayuda a la reproducibilidad. */
  seed?: number;
  /**
   * Solo Ollama (`num_ctx`). Las APIs compatibles con OpenAI NO exponen la
   * ventana de contexto: es fija por modelo. Se registra en el log para que la
   * diferencia sea visible al comparar (con Ollama un prompt > num_ctx se
   * trunca en silencio; en remoto normalmente no).
   */
  numCtx: number;
}

/**
 * Resuelve los parámetros efectivos. `structured: true` fuerza temperatura 0,
 * igual que hacía `chatJSON` contra Ollama.
 */
export function resolveGenParams(
  opts: GenOptions | undefined,
  structured = false,
): ResolvedParams {
  const temperature = structured
    ? (opts?.temperature ?? 0)
    : (opts?.temperature ?? config.temperature);

  return {
    temperature,
    topP: config.topP,
    maxTokens: opts?.maxTokens ?? config.maxTokens,
    // La salida estructurada SIEMPRE apaga el razonamiento, sin importar
    // LLM_REASONING: un bloque de pensamiento antes del JSON rompe el parseo.
    reasoning: structured ? "off" : config.reasoning,
    seed: config.seed,
    numCtx: config.numCtx,
  };
}

/** Mapea a las `options` de Ollama (`/api/chat`). */
export function toOllamaOptions(p: ResolvedParams): Record<string, unknown> {
  return {
    temperature: p.temperature,
    top_p: p.topP,
    num_ctx: p.numCtx,
    num_predict: p.maxTokens,
    ...(p.seed != null ? { seed: p.seed } : {}),
  };
}

/**
 * Interruptores de razonamiento. NO existe uno que sirva a todos los
 * proveedores, así que se mandan COMBINADOS (los gateways ignoran las claves
 * que no conocen — verificado en DeepInfra: clave inventada → HTTP 200):
 *
 *   chat_template_kwargs.enable_thinking  vLLM, SGLang, DeepInfra, Parasail
 *   reasoning_effort: "none"              DeepInfra, Scaleway
 *   reasoning.enabled: false              DeepInfra
 *   enable_thinking (raíz)                Novita, Alibaba  (DeepInfra lo ignora)
 *
 * `LLM_REASONING_PARAMS` permite acotar la lista si un proveedor estricto
 * rechaza campos desconocidos con 400.
 */
export type ReasoningParamName =
  | "chat_template_kwargs"
  | "reasoning_effort"
  | "reasoning"
  | "enable_thinking";

const ALL_REASONING_PARAMS: ReasoningParamName[] = [
  "chat_template_kwargs",
  "reasoning_effort",
  "reasoning",
  "enable_thinking",
];

export function activeReasoningParams(): ReasoningParamName[] {
  const raw = config.reasoningParams;
  if (!raw) return ALL_REASONING_PARAMS;
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ReasoningParamName[];
  const valid = wanted.filter((w) => ALL_REASONING_PARAMS.includes(w));
  return valid.length > 0 ? valid : ALL_REASONING_PARAMS;
}

function reasoningBody(p: ResolvedParams): Record<string, unknown> {
  const on = p.reasoning === "on";
  const body: Record<string, unknown> = {};
  for (const name of activeReasoningParams()) {
    switch (name) {
      case "chat_template_kwargs":
        body.chat_template_kwargs = { enable_thinking: on };
        break;
      case "reasoning_effort":
        // "none" apaga; con razonamiento activo dejamos el default del modelo.
        if (!on) body.reasoning_effort = "none";
        break;
      case "reasoning":
        body.reasoning = { enabled: on };
        break;
      case "enable_thinking":
        body.enable_thinking = on;
        break;
    }
  }
  return body;
}

/** Mapea al body de una API compatible con OpenAI. */
export function toOpenAIParams(p: ResolvedParams): Record<string, unknown> {
  return {
    temperature: p.temperature,
    top_p: p.topP,
    max_tokens: p.maxTokens,
    ...(p.seed != null ? { seed: p.seed } : {}),
    ...reasoningBody(p),
  };
}

/** Línea legible de params efectivos (para el log y el script de humo). */
export function describeParams(p: ResolvedParams): string {
  return [
    `temp=${p.temperature}`,
    `top_p=${p.topP}`,
    `max_tokens=${p.maxTokens}`,
    `reasoning=${p.reasoning}`,
    p.seed != null ? `seed=${p.seed}` : "seed=-",
  ].join(" ");
}
