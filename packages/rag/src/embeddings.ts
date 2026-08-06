/**
 * Embeddings vía API compatible con OpenAI. Modelo: bge-m3 (multilingüe,
 * excelente en español, 1024 dimensiones — coincide con la columna vector del
 * esquema).
 *
 * ── POR QUÉ NO HUBO QUE RE-EMBEBER ──────────────────────────────────────────
 * Antes esto corría contra Ollama local (`/api/embed`). Los 28.986 chunks de la
 * base se embebieron así, y cambiar de proveedor normalmente obliga a rehacer
 * todo el corpus: vectores de otro modelo viven en otro espacio y la búsqueda
 * densa devuelve basura.
 *
 * Acá no, y está MEDIDO: se embebió el mismo texto por los dos caminos y el
 * coseno entre los vectores dio 0,999993, con norma 1,0000 en ambos. Es el mismo
 * modelo con los mismos pesos, servido en otro lado. Los vectores que ya están
 * en la base siguen siendo válidos.
 *
 * ⚠️ Ese resultado vale para bge-m3 y para nadie más. Si algún día se cambia
 * EMBEDDING_MODEL por otro modelo, hay que re-embeber el corpus entero —
 * comparar la dimensión NO alcanza: dos modelos distintos pueden dar 1024
 * dimensiones y ser espacios incompatibles.
 *
 * ⚠️ Y ahora la búsqueda depende de la red. Antes, sin internet, se caía la
 * generación pero el retrieval seguía andando con el reranker local. Hoy un
 * corte deja al alumno sin nada.
 */
export const EMBEDDING_DIM = 1024; // bge-m3

const baseUrl = () =>
  process.env.EMBEDDING_BASE_URL ??
  process.env.LLM_BASE_URL ??
  "https://api.deepinfra.com/v1/openai";
/**
 * Nombre del modelo, traduciendo los tags heredados de Ollama.
 *
 * El mismo modelo se llama distinto en cada lado: "bge-m3" en Ollama y
 * "BAAI/bge-m3" en la API. Un .env que venía andando tiene el tag viejo, y sin
 * esta traducción la migración lo rompe con un 404 que no dice qué hacer —
 * pasó en el smoke test de esta misma migración. Se traduce y se avisa una vez,
 * en vez de fallar o de cambiar de modelo en silencio.
 */
const LEGADO: Record<string, string> = {
  "bge-m3": "BAAI/bge-m3",
  "bge-m3:latest": "BAAI/bge-m3",
};
let avisado = false;
const model = () => {
  const crudo = process.env.EMBEDDING_MODEL ?? "BAAI/bge-m3";
  const trad = LEGADO[crudo];
  if (trad && !avisado) {
    avisado = true;
    console.warn(
      `[embeddings] EMBEDDING_MODEL="${crudo}" es el tag de Ollama; se usa "${trad}". ` +
        `Actualizá el .env: el proveedor local ya no existe.`,
    );
  }
  return trad ?? crudo;
};
const apiKey = () => process.env.DEEPINFRA_API_KEY ?? process.env.LLM_API_KEY ?? "";

/** input_type se mantiene por compatibilidad; bge-m3 no lo necesita. */
export type EmbedInputType = "document" | "query";

/**
 * REINTENTOS. Los embeddings son el único paso del que depende TODO el
 * retrieval: sin vector no hay búsqueda, y sin búsqueda el alumno recibe "tuve un
 * problemita para traer tu material" — aunque su libro esté ahí y el problema
 * haya sido un hipo de 10 segundos en la red.
 *
 * No los tenía. La capa de LLM sí (`core/llm/retry.ts`), pero esto vive en `rag`
 * y quedó sin la misma disciplina. Observado dos veces en la misma noche durante
 * una corrida de medición: `ConnectTimeoutError` contra api.deepinfra.com, que
 * abortó las dos corridas enteras.
 *
 * Solo en fallas TRANSITORIAS: red, timeout, 429 y 5xx. Un 401 (credencial mala)
 * o un 400 (payload inválido) no mejoran por insistir, y reintentarlos esconde el
 * error real detrás de tres intentos y una espera.
 */
const EMBED_REINTENTOS = Number(process.env.EMBED_RETRIES ?? "2");

function esTransitorio(e: unknown, status?: number): boolean {
  if (status != null) return status === 429 || status >= 500;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /fetch failed|network|timeout|abort|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(msg);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function embed(
  texts: string[],
  _inputType: EmbedInputType = "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = apiKey();
  if (!key) {
    throw new Error(
      "Falta DEEPINFRA_API_KEY: sin ella no se pueden generar embeddings y la búsqueda no funciona.",
    );
  }

  let res: Response | undefined;
  let ultimo: unknown;
  for (let intento = 0; intento <= EMBED_REINTENTOS; intento++) {
    if (intento > 0) {
      // Backoff exponencial con jitter: 400ms, 800ms… El jitter importa porque
      // la ingesta embebe en lotes y sin él todos reintentarían al unísono.
      await dormir(400 * 2 ** (intento - 1) + Math.floor(Math.random() * 200));
    }
    try {
      res = await fetch(`${baseUrl()}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: model(), input: texts }),
        // Un proveedor colgado no debe bloquear indefinidamente el pipeline.
        signal: AbortSignal.timeout(Number(process.env.EMBED_TIMEOUT_MS ?? "60000")),
      });
      if (res.ok) break;
      if (!esTransitorio(null, res.status) || intento === EMBED_REINTENTOS) break;
      console.warn(`[embeddings] ${res.status} — reintento ${intento + 1}/${EMBED_REINTENTOS}`);
    } catch (e) {
      ultimo = e;
      if (!esTransitorio(e) || intento === EMBED_REINTENTOS) throw e;
      console.warn(
        `[embeddings] ${e instanceof Error ? e.message : e} — reintento ${intento + 1}/${EMBED_REINTENTOS}`,
      );
    }
  }
  if (!res) throw ultimo ?? new Error("No se pudo contactar el servicio de embeddings.");
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `Error de embeddings ${res.status} en ${baseUrl()} (${model()}). ${detalle.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    data?: { embedding: number[]; index: number }[];
  };
  if (!json.data || json.data.length !== texts.length) {
    throw new Error(
      `Respuesta de embeddings inválida: se pidieron ${texts.length} y llegaron ${json.data?.length ?? 0}.`,
    );
  }
  // La API no garantiza el orden; `index` sí. Devolverlos desordenados
  // asociaría cada texto al vector de otro y la corrupción sería SILENCIOSA.
  const out: number[][] = new Array(texts.length);
  for (const d of json.data) out[d.index] = d.embedding;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) throw new Error(`Falta el embedding del texto ${i}.`);
  }
  return out as number[][];
}

/** Conveniencia para una sola consulta. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], "query");
  if (!v) throw new Error("No se pudo generar el embedding de la consulta.");
  return v;
}
