/**
 * Helper de bajo nivel para hablar con Ollama exponiendo LOS TIEMPOS
 * (`prompt_eval_duration`, `eval_duration`). El cliente de core no los expone y
 * los experimentos #2 y #3 los necesitan para medir el prefill (§8.2: "medilo,
 * no lo estimes").
 *
 * Todos los tiempos de Ollama vienen en NANOSEGUNDOS; los convertimos a ms.
 */
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export interface GenResult {
  text: string;
  /** ms de prefill (procesar el prompt). El asesino de la latencia de voz. */
  promptEvalMs: number;
  /** ms de generación de los tokens de salida. */
  evalMs: number;
  promptTokens: number;
  evalTokens: number;
  /** tokens/s de prefill y de generación. */
  promptTps: number;
  evalTps: number;
  totalMs: number;
}

export interface GenOptions {
  model: string;
  numCtx?: number;
  temperature?: number;
  /** JSON Schema para salida estructurada (Ollama `format`). */
  format?: unknown;
  /** Sistema opcional. */
  system?: string;
}

const nsToMs = (ns: number | undefined) => (ns ? ns / 1e6 : 0);

/** Una generación no-streaming con métricas de tiempo. */
export async function generate(
  prompt: string,
  opts: GenOptions,
): Promise<GenResult> {
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: prompt },
  ];
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: false,
      ...(opts.format ? { format: opts.format } : {}),
      options: {
        temperature: opts.temperature ?? 0,
        ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama ${res.status}: ${await res.text().catch(() => "")} (¿está corriendo en ${BASE}?)`,
    );
  }
  const j = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
    total_duration?: number;
  };
  const promptEvalMs = nsToMs(j.prompt_eval_duration);
  const evalMs = nsToMs(j.eval_duration);
  const promptTokens = j.prompt_eval_count ?? 0;
  const evalTokens = j.eval_count ?? 0;
  return {
    text: j.message?.content ?? "",
    promptEvalMs,
    evalMs,
    promptTokens,
    evalTokens,
    promptTps: promptEvalMs > 0 ? (promptTokens / promptEvalMs) * 1000 : 0,
    evalTps: evalMs > 0 ? (evalTokens / evalMs) * 1000 : 0,
    totalMs: nsToMs(j.total_duration),
  };
}

/** ¿Está Ollama vivo? Lista de modelos disponibles. */
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/tags`).catch(() => null);
  if (!res || !res.ok) return [];
  const j = (await res.json()) as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}
