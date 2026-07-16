/**
 * Cliente del modelo LOCAL (Ollama). Reemplaza por completo a la API de Claude:
 * nada sale de tu máquina. Expone dos operaciones:
 *   - chatStream: respuesta en streaming (para el chat).
 *   - chatJSON:  salida estructurada validada contra un JSON Schema (exámenes).
 *
 * La decodificación es CONSERVADORA por defecto (ver config.ts): temperatura
 * baja para que el modelo se apegue al material y no invente.
 */
import { config } from "./config";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenOptions {
  /** Sobrescribe la temperatura por defecto (0 = máximamente determinista). */
  temperature?: number;
  /** Límite de tokens de salida. */
  maxTokens?: number;
}

function options(opts?: GenOptions) {
  return {
    temperature: opts?.temperature ?? config.temperature,
    top_p: config.topP,
    num_ctx: config.numCtx,
    ...(opts?.maxTokens ? { num_predict: opts.maxTokens } : {}),
  };
}

/** Chat en streaming. Devuelve un generador async de trozos de texto. */
export async function* chatStream(
  messages: ChatMsg[],
  opts?: GenOptions,
): AsyncGenerator<string> {
  const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.llmModel,
      messages,
      stream: true,
      options: options(opts),
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(
      `Ollama chat error ${res.status}. ¿Está corriendo Ollama en ${config.ollamaBaseUrl}?`,
    );
  }

  // Ollama emite NDJSON: una línea JSON por token/bloque.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line) as {
        message?: { content?: string };
        done?: boolean;
      };
      if (obj.message?.content) yield obj.message.content;
      if (obj.done) return;
    }
  }
}

/**
 * Salida estructurada: Ollama acepta `format` con un JSON Schema y devuelve el
 * contenido como JSON válido. Usa temperatura muy baja para exámenes/corrección.
 */
export async function chatJSON<T>(
  messages: ChatMsg[],
  schema: unknown,
  opts?: GenOptions,
): Promise<T> {
  const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.llmModel,
      messages,
      stream: false,
      format: schema,
      options: options({ temperature: 0, ...opts }),
    }),
    // No-streaming (examen/corrección/verificador): acotar por si Ollama cuelga.
    // Generoso porque generar un examen en un 7B puede tardar.
    signal: AbortSignal.timeout(
      Number(process.env.LLM_JSON_TIMEOUT_MS ?? "180000"),
    ),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama chat(JSON) error ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const json = (await res.json()) as { message?: { content?: string } };
  const content = json.message?.content;
  if (!content) throw new Error("Respuesta del modelo sin contenido.");
  return JSON.parse(content) as T;
}

/** Texto completo (no streaming) — útil para el verificador anti-alucinación. */
export async function chatText(
  messages: ChatMsg[],
  opts?: GenOptions,
): Promise<string> {
  let out = "";
  for await (const chunk of chatStream(messages, opts)) out += chunk;
  return out;
}
