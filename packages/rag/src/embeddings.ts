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
/**
 * CONTADOR DE LLAMADAS, para poder medir. Se enciende con `RAG_TIMING=1`.
 *
 * Existe porque la primera medición de latencia del chat (2026-08-28) dio un
 * retrieval de 16,7 s de mediana y no había forma de saber cuántas veces se
 * embebía la MISMA pregunta adentro de una sola respuesta.
 */
export const embedStats = { llamadas: 0, ms: 0, cacheHits: 0 };
const timing = () => process.env.RAG_TIMING === "1";

/**
 * MEMORIA DE UNA PREGUNTA, no un caché global.
 *
 * `retrieveHybrid` embebe la consulta en CADA llamada, y la cascada de alcance
 * la llama hasta cinco veces por respuesta (curso → otro curso → área → otra
 * materia, más la pedagogía). Con el embedding remoto a ~400 ms, eso son ~2 s
 * de la misma llamada repetida, cada vez con el mismo texto y el mismo
 * resultado.
 *
 * Es un `Map` chico con TTL corto y NO un caché de verdad a propósito:
 *  · la clave es el texto exacto de la consulta, así que no hay riesgo de
 *    devolver el vector de otra pregunta;
 *  · vive segundos, lo que dura una respuesta, así que no hay que invalidarlo
 *    si cambia `EMBEDDING_MODEL` en un despliegue;
 *  · tiene tope de tamaño, así que no puede crecer sin control en un proceso
 *    de servidor que vive días.
 */
const VIDA_MS = 60_000;
const TOPE = 256;
/**
 * Se guarda la PROMESA, no el vector, y eso no es un detalle de estilo: el
 * contenido y la pedagogía se piden en paralelo con la misma consulta. Con el
 * valor, los dos entran mientras no hay nada guardado, los dos fallan el
 * lookup y se hacen DOS llamadas idénticas a la API. Con la promesa, el
 * segundo se cuelga de la primera. Es el mismo patrón que el `_nli_lock` del
 * sidecar, que existe por la misma razón.
 */
const memoria = new Map<string, { p: Promise<number[]>; t: number }>();

export function embedQuery(text: string): Promise<number[]> {
  const clave = text.trim();
  const ahora = Date.now();

  const guardado = memoria.get(clave);
  if (guardado && ahora - guardado.t < VIDA_MS) {
    embedStats.cacheHits++;
    if (timing()) console.log(`[emb] HIT (${clave.slice(0, 40)}…)`);
    return guardado.p;
  }

  const t0 = ahora;
  const p = embed([clave], "query").then(([v]) => {
    if (!v) throw new Error("No se pudo generar el embedding de la consulta.");
    embedStats.llamadas++;
    embedStats.ms += Date.now() - t0;
    if (timing()) console.log(`[emb] ${Date.now() - t0} ms (${clave.slice(0, 40)}…)`);
    return v;
  });

  // Una promesa RECHAZADA no puede quedar guardada: el próximo turno se
  // colgaría del mismo error en vez de reintentar.
  p.catch(() => memoria.delete(clave));

  // Poda simple: si se pasó del tope, se tira la entrada más vieja. Con TTL de
  // 60 s y 256 entradas no se llega nunca en la práctica; es el seguro.
  if (memoria.size >= TOPE) {
    const masVieja = [...memoria.entries()].sort((a, b) => a[1].t - b[1].t)[0];
    if (masVieja) memoria.delete(masVieja[0]);
  }
  memoria.set(clave, { p, t: ahora });
  return p;
}
