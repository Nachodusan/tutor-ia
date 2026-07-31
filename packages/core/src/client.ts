/**
 * Cliente del modelo — ahora un SHIM sobre la capa de providers (`./llm`).
 *
 * La implementación real vive en `llm/ollama.ts` (local, default) y
 * `llm/deepinfra.ts` (remoto). El motor se elige con LLM_PROVIDER, sin tocar
 * este archivo ni ninguno de los call sites.
 *
 * Se mantiene la firma histórica (chatStream / chatJSON / chatText) a propósito:
 * los ~11 puntos que generan texto (teaching, tutor, exams, grading, /api/plan,
 * /api/test, eval) siguen funcionando sin cambios.
 *
 * Ojo: embeddings (bge-m3), reranker y NLI NO pasan por acá — siguen locales.
 */
import { getLLM } from "./llm";
import type { ChatMsg, GenOptions } from "./llm/types";

export type { ChatMsg, GenOptions } from "./llm/types";

/** Chat en streaming. Devuelve un generador async de trozos de texto. */
export async function* chatStream(
  messages: ChatMsg[],
  opts?: GenOptions,
): AsyncGenerator<string> {
  yield* getLLM().generateStream(messages, opts);
}

/**
 * Salida estructurada validada contra un JSON Schema.
 * Ollama usa `format`; DeepInfra usa `response_format` json_schema strict.
 * La temperatura se fuerza a 0 en ambos (igual que antes).
 */
export async function chatJSON<T>(
  messages: ChatMsg[],
  schema: unknown,
  opts?: GenOptions,
): Promise<T> {
  return getLLM().generateStructured<T>(messages, schema, opts);
}

/** Texto completo (no streaming). */
export async function chatText(
  messages: ChatMsg[],
  opts?: GenOptions,
): Promise<string> {
  return getLLM().generate(messages, opts);
}
