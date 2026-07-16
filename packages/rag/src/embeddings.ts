/**
 * Embeddings LOCALES vía Ollama. Modelo por defecto: bge-m3 (multilingüe,
 * excelente en español, 1024 dimensiones — coincide con la columna vector del
 * esquema). Nada sale de tu máquina.
 *
 * Requisitos:  ollama pull bge-m3
 */

export const EMBEDDING_DIM = 1024; // bge-m3

const baseUrl = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = () => process.env.EMBEDDING_MODEL ?? "bge-m3";

/** input_type se mantiene por compatibilidad; bge-m3 no lo necesita. */
export type EmbedInputType = "document" | "query";

export async function embed(
  texts: string[],
  _inputType: EmbedInputType = "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch(`${baseUrl()}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model(), input: texts }),
    // Ollama caído/colgado no debe bloquear indefinidamente el pipeline.
    signal: AbortSignal.timeout(
      Number(process.env.EMBED_TIMEOUT_MS ?? "60000"),
    ),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama embeddings error ${res.status}. ¿Corriste \`ollama pull ${model()}\` y Ollama está activo?`,
    );
  }
  const json = (await res.json()) as { embeddings?: number[][] };
  if (!json.embeddings || json.embeddings.length !== texts.length) {
    throw new Error("Respuesta de embeddings inválida desde Ollama.");
  }
  return json.embeddings;
}

/** Conveniencia para una sola consulta. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], "query");
  if (!v) throw new Error("No se pudo generar el embedding de la consulta.");
  return v;
}
