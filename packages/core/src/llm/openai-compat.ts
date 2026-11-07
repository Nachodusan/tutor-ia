/**
 * Provider REMOTO para cualquier API COMPATIBLE CON OPENAI (DeepInfra por
 * defecto, pero también Scaleway, Novita, Alibaba, Parasail, GMI…). Solo cambia
 * la última llamada de generación: embeddings, reranker y NLI siguen locales.
 *
 * `baseURL` y API key vienen de env: apuntar a otro proveedor es cambiar una
 * variable, sin tocar código. NO hay failover automático — si un proveedor tira
 * 429 tras los reintentos, falla con LLMError tipado, para que quede claro qué
 * proveedor produjo cada número.
 *
 * La key se lee EXCLUSIVAMENTE del entorno, lazy y server-side.
 */
import OpenAI from "openai";
import { config } from "../config";
import { assertWithinBudget, recordUsage } from "./budget";
import { logCall } from "./logging";
import { resolveGenParams, toOpenAIParams, type ResolvedParams } from "./params";
import {
  ThinkStreamFilter,
  estimateTokens,
  extractReasoningField,
  stripThinkBlocks,
} from "./reasoning";
import { isAbort, kindFromStatus, withRetry, withTimeout } from "./retry";
import { findStrictViolations, formatViolations } from "./strict-schema";
import {
  LLMError,
  toMessages,
  type GenOptions,
  type LLMPrompt,
  type LLMProvider,
  type LLMUsage,
} from "./types";

/** Se mantiene "deepinfra" como valor aceptado de LLM_PROVIDER (compatibilidad). */
const PROVIDER = "deepinfra" as const;
export const DEFAULT_BASE_URL = "https://api.deepinfra.com/v1/openai";
export const DEFAULT_MODEL = "Qwen/Qwen3.6-35B-A3B";

const emptyUsage = (): LLMUsage => ({ inputTokens: null, outputTokens: null });

/**
 * Techo de reloj propio sobre una promesa del SDK.
 *
 * No confía en que nadie honre el AbortSignal: si la promesa no resuelve antes
 * del deadline, esto rechaza igual. Medido dos veces que hacía falta — un stream
 * de 945 s y una llamada estructurada de 33.882 s, ambas con el timeout del SDK
 * configurado en 180 s y ambas ignorándolo.
 *
 * `alLimpiar` corre en cualquier caso para no dejar timers colgados.
 */
async function conDeadline<T>(
  p: Promise<T>,
  ms: number,
  alLimpiar: () => void,
  mensaje: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(
          () => rej(new LLMError(mensaje, { provider: PROVIDER, kind: "timeout", retryable: false })),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    alLimpiar();
  }
}

/** Host del baseURL, para el log (`api.deepinfra.com`). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** reasoning_tokens del API si el proveedor los reporta (DeepInfra no lo hace). */
function apiReasoningTokens(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const d = (usage as Record<string, unknown>).completion_tokens_details;
  if (typeof d !== "object" || d === null) return null;
  const v = (d as Record<string, unknown>).reasoning_tokens;
  return typeof v === "number" ? v : null;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly name = PROVIDER;
  readonly model: string;
  readonly baseUrl: string;
  private readonly client: OpenAI;

  constructor(model?: string, baseUrl?: string) {
    // Guard: jamás debe instanciarse en el bundle del cliente.
    if (typeof globalThis !== "undefined" && "window" in globalThis) {
      throw new LLMError(
        "El provider remoto es SOLO server-side: la API key no puede llegar al navegador.",
        { provider: PROVIDER, kind: "client", retryable: false },
      );
    }

    // LLM_API_KEY con fallback a DEEPINFRA_API_KEY (compatibilidad).
    const apiKey = process.env.LLM_API_KEY || process.env.DEEPINFRA_API_KEY;
    if (!apiKey) {
      throw new LLMError(
        "Falta LLM_API_KEY (o DEEPINFRA_API_KEY) en el entorno. Ponela en el .env " +
          "de la raíz (está en .gitignore) — nunca en .claude/launch.json, que sí se commitea.",
        { provider: PROVIDER, kind: "auth", retryable: false },
      );
    }

    this.baseUrl = baseUrl ?? config.llmBaseUrl;
    this.model = model ?? config.llmModelEnv ?? DEFAULT_MODEL;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      maxRetries: 0, // el retry lo maneja nuestra capa (solo 429/5xx)
    });
  }

  /**
   * `t` es el handle de withTimeout: solo él sabe con certeza si el abort fue
   * nuestro timeout o una cancelación externa. El error del SDK no lo dice
   * (ver retry.ts). Sin esto, un timeout se reintentaba como si fuera red.
   */
  /**
   * El modelo de ESTA llamada: `GenOptions.model` pisa el del constructor.
   *
   * Va también en los dos `logCall`, no solo en el cuerpo del request: un log
   * que informa un modelo distinto del que se llamó convierte toda medición
   * posterior en basura, y es el tipo de error que no avisa.
   */
  private modeloDe(opts: GenOptions | undefined): string {
    return opts?.model ?? this.model;
  }

  private toLLMError(
    err: unknown,
    attempt: number,
    timeoutMs: number,
    t?: { timedOut: () => boolean; cancelled: () => boolean },
  ): LLMError {
    if (err instanceof LLMError) return err;
    if (t?.timedOut()) {
      return new LLMError(
        `${hostOf(this.baseUrl)}: timeout tras ${timeoutMs}ms. ` +
          `Subí LLM_TIMEOUT_MS si la llamada es larga (structured con muchos tokens).`,
        { provider: PROVIDER, kind: "timeout", attempts: attempt, cause: err },
      );
    }
    // Cancelación externa (el usuario cerró la pestaña): nunca se reintenta.
    if (t?.cancelled()) {
      return new LLMError(`${hostOf(this.baseUrl)}: llamada cancelada.`, {
        provider: PROVIDER,
        kind: "client",
        retryable: false,
        attempts: attempt,
        cause: err,
      });
    }
    if (isAbort(err)) {
      return new LLMError(`${hostOf(this.baseUrl)}: timeout tras ${timeoutMs}ms`, {
        provider: PROVIDER,
        kind: "timeout",
        attempts: attempt,
        cause: err,
      });
    }
    const status = (err as { status?: number })?.status;
    if (typeof status === "number") {
      const kind = kindFromStatus(status);
      const hint =
        kind === "auth"
          ? " Revisá LLM_API_KEY."
          : status === 404
            ? ` ¿El model ID "${this.model}" existe en ${hostOf(this.baseUrl)}? (los IDs difieren entre proveedores)`
            : status === 429
              ? " El proveedor está saturado; probá otro LLM_BASE_URL."
              : "";
      return new LLMError(
        `${hostOf(this.baseUrl)} ${status}: ${(err as Error).message}.${hint}`,
        { provider: PROVIDER, kind, status, attempts: attempt, cause: err },
      );
    }
    return new LLMError(
      `${hostOf(this.baseUrl)}: fallo de red (${err instanceof Error ? err.message : String(err)})`,
      { provider: PROVIDER, kind: "network", attempts: attempt, cause: err },
    );
  }

  /** Nunca devuelve razonamiento al call site. */
  private clean(
    rawContent: string,
    message: unknown,
    usage: unknown,
  ): { content: string; usage: LLMUsage; leaked: boolean; truncated: boolean } {
    // 1) Campo separado (reasoning_content / reasoning). NUNCA se concatena.
    const fieldReasoning = extractReasoningField(message);
    // 2) Bloques <think> embebidos en content.
    const s = stripThinkBlocks(rawContent);

    const reasoningText = fieldReasoning + s.reasoning;
    const fromApi = apiReasoningTokens(usage);
    const u = usage as { prompt_tokens?: number; completion_tokens?: number } | null;

    return {
      content: s.content,
      leaked: s.leaked || fieldReasoning.length > 0,
      truncated: s.truncated,
      usage: {
        inputTokens: u?.prompt_tokens ?? null,
        outputTokens: u?.completion_tokens ?? null,
        reasoningTokens: fromApi ?? (reasoningText ? estimateTokens(reasoningText) : 0),
        reasoningEstimated: fromApi == null && reasoningText.length > 0,
      },
    };
  }

  private overflow(): LLMError {
    return new LLMError(
      `El modelo agotó los ${config.maxTokens} tokens razonando y no llegó a responder. ` +
        `Subí LLM_MAX_TOKENS o verificá que LLM_REASONING=off esté llegando ` +
        `(un typo en el switch NO da error: da un modelo que piensa).`,
      { provider: PROVIDER, kind: "reasoning_overflow", retryable: false },
    );
  }

  async generate(prompt: LLMPrompt, opts?: GenOptions): Promise<string> {
    const params = resolveGenParams(opts);
    return this.complete(prompt, params, opts, "generate", undefined);
  }

  async generateStructured<T>(
    prompt: LLMPrompt,
    schema: unknown,
    opts?: GenOptions,
  ): Promise<T> {
    const violations = findStrictViolations(schema);
    if (violations.length > 0) {
      throw new LLMError(
        `El JSON Schema no cumple los requisitos del modo estricto:\n` +
          `${formatViolations(violations)}\n` +
          `Corregí el schema: es el único camino. El proveedor permisivo que había (Ollama) se eliminó del proyecto.`,
        { provider: PROVIDER, kind: "bad_schema", retryable: false },
      );
    }
    // structured fuerza reasoning=off (un bloque de pensamiento rompe el parseo).
    const params = resolveGenParams(opts, true);
    const responseFormat = {
      type: "json_schema" as const,
      json_schema: {
        name: "respuesta",
        strict: true,
        schema: schema as Record<string, unknown>,
      },
    };
    const content = await this.complete(
      prompt,
      params,
      opts,
      "generateStructured",
      responseFormat,
    );
    try {
      return JSON.parse(content) as T;
    } catch (err) {
      throw new LLMError(
        `${hostOf(this.baseUrl)}: la salida estructurada no es JSON válido.`,
        { provider: PROVIDER, kind: "bad_response", cause: err },
      );
    }
  }

  /** Camino no-streaming compartido por generate y generateStructured. */
  private async complete(
    prompt: LLMPrompt,
    params: ResolvedParams,
    opts: GenOptions | undefined,
    method: "generate" | "generateStructured",
    responseFormat: Record<string, unknown> | undefined,
  ): Promise<string> {
    const timeoutMs = opts?.timeoutMs ?? config.llmTimeoutMs;
    const started = Date.now();
    let usage = emptyUsage();
    let attempts = 1;
    let leaked = false;

    try {
      const out = await withRetry(PROVIDER, async (attempt) => {
        attempts = attempt;
        assertWithinBudget(PROVIDER);
        const t = withTimeout(timeoutMs, opts?.signal);
        try {
          // FECHA LÍMITE DURA, igual que en el streaming y por el mismo motivo:
          // el AbortSignal no basta. Medido el 2026-08-01, una llamada de
          // `generateStructured` con LLM_TIMEOUT_MS=180000 corrió **33.882
          // segundos** (9,4 horas) sin cortar. Yo había puesto el techo solo en
          // `generateStream` y este camino quedó sin cubrir.
          // Acá alcanza con un race: la promesa del SDK contra un reloj propio.
          const res = await conDeadline(
            this.client.chat.completions.create(
              {
                model: this.modeloDe(opts),
                messages: toMessages(prompt),
                ...(responseFormat ? { response_format: responseFormat } : {}),
                ...toOpenAIParams(params),
              } as never,
              { signal: t.signal },
            ),
            config.llmStreamDeadlineMs,
            () => t.clear(),
            `${hostOf(this.baseUrl)}: ${method} superó la fecha límite de ${config.llmStreamDeadlineMs}ms`,
          );
          const msg = (res as { choices?: { message?: unknown }[] }).choices?.[0]?.message;
          const raw =
            (msg as { content?: string } | undefined)?.content ?? "";
          const c = this.clean(raw, msg, (res as { usage?: unknown }).usage);
          usage = c.usage;
          leaked = c.leaked;
          recordUsage(usage, attempt > 1);
          if (c.truncated && !c.content) throw this.overflow();
          return c.content;
        } catch (err) {
          throw this.toLLMError(err, attempt, timeoutMs, t);
        } finally {
          t.clear();
        }
      });

      if (!out) {
        throw new LLMError(`${hostOf(this.baseUrl)}: respuesta sin contenido.`, {
          provider: PROVIDER,
          kind: "bad_response",
        });
      }
      return out;
    } finally {
      logCall({
        provider: PROVIDER,
        host: hostOf(this.baseUrl),
        model: this.modeloDe(opts),
        method,
        latencyMs: Date.now() - started,
        usage,
        params,
        attempts,
        ok: true,
        leaked,
      });
    }
  }

  async *generateStream(prompt: LLMPrompt, opts?: GenOptions): AsyncGenerator<string> {
    const params = resolveGenParams(opts);
    const timeoutMs = opts?.timeoutMs ?? config.llmTimeoutMs;
    const started = Date.now();
    let usage = emptyUsage();
    const filter = new ThinkStreamFilter();
    let fieldReasoning = "";
    let emitted = false;

    assertWithinBudget(PROVIDER);
    const t = withTimeout(timeoutMs, opts?.signal);
    // Reintento SOLO al abrir el stream (después duplicaría contenido).
    const stream = await withRetry(PROVIDER, async (attempt) => {
      try {
        return await this.client.chat.completions.create(
          {
            model: this.modeloDe(opts),
            messages: toMessages(prompt),
            stream: true,
            stream_options: { include_usage: true },
            ...toOpenAIParams(params),
          } as never,
          { signal: t.signal },
        );
      } catch (err) {
        throw this.toLLMError(err, attempt, timeoutMs, t);
      }
    }).catch((err) => {
      t.clear();
      throw err;
    });

    // ─────────────────────────────────────────────────────────────────────
    // FECHA LÍMITE DURA, independiente del SDK.
    //
    // El AbortSignal de `create()` NO alcanza: medido el 2026-07-31, una
    // llamada corrió 945 SEGUNDOS con LLM_TIMEOUT_MS=180000 y terminó sin
    // emitir un solo chunk. El proveedor sostuvo la conexión abierta y el
    // abort no interrumpió la lectura del stream.
    //
    // Acá no confiamos en que nadie honre la señal: cada `next()` del iterador
    // compite contra un deadline absoluto. Si vence, cerramos el iterador a
    // mano (`return()`) y tiramos LLMError. Es un techo que no se puede exceder
    // pase lo que pase del otro lado.
    // ─────────────────────────────────────────────────────────────────────
    const deadlineMs = config.llmStreamDeadlineMs;
    const finAbs = started + deadlineMs;
    const it = (stream as unknown as AsyncIterable<Record<string, unknown>>)[Symbol.asyncIterator]();
    let venció = false;
    const restante = () => finAbs - Date.now();

    let truncated = false;
    try {
      for (;;) {
        if (restante() <= 0) { venció = true; break; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const reloj = new Promise<"deadline">((res) => {
          timer = setTimeout(() => res("deadline"), Math.max(1, restante()));
        });
        const paso = await Promise.race([it.next(), reloj]);
        clearTimeout(timer);
        if (paso === "deadline") { venció = true; break; }
        const { value, done } = paso as IteratorResult<Record<string, unknown>>;
        if (done) break;
        const part = value;
        const u = part.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        if (u) {
          usage.inputTokens = u.prompt_tokens ?? null;
          usage.outputTokens = u.completion_tokens ?? null;
          const fromApi = apiReasoningTokens(u);
          if (fromApi != null) {
            usage.reasoningTokens = fromApi;
            usage.reasoningEstimated = false;
          }
        }
        const choices = part.choices as { delta?: unknown }[] | undefined;
        const delta = choices?.[0]?.delta;
        if (!delta) continue;

        // Campo separado: se cuenta pero NUNCA se emite.
        fieldReasoning += extractReasoningField(delta);

        const text = (delta as { content?: string }).content;
        if (text) {
          const safe = filter.push(text);
          if (safe) {
            emitted = true;
            yield safe;
          }
        }
      }
      // Cerrar el iterador ANTES de decidir: si venció el deadline hay que
      // soltar la conexión, si no queda colgada consumiendo el socket.
      if (venció) {
        await it.return?.(undefined).catch(() => undefined);
        throw new LLMError(
          `${hostOf(this.baseUrl)}: el stream superó la fecha límite de ${deadlineMs}ms ` +
            `(emitió ${emitted ? "texto parcial" : "NADA"}). Subí LLM_STREAM_DEADLINE_MS si es legítimo.`,
          { provider: PROVIDER, kind: "timeout", retryable: false },
        );
      }
      const end = filter.finish();
      truncated = end.truncated;
      if (end.out) {
        emitted = true;
        yield end.out;
      }
      if (truncated && !emitted) throw this.overflow();
      // Un stream que termina SIN emitir nada no es una respuesta: es un fallo.
      // Antes se devolvía como éxito con texto vacío y el llamador lo contaba
      // como "respondió". Medido: q100 del golden salió así tras 945s.
      if (!emitted) {
        throw new LLMError(
          `${hostOf(this.baseUrl)}: el stream terminó sin emitir contenido.`,
          { provider: PROVIDER, kind: "bad_response", retryable: false },
        );
      }
    } catch (err) {
      throw this.toLLMError(err, 1, timeoutMs, t);
    } finally {
      t.clear();
      const reasoningText = fieldReasoning + filter.reasoning;
      if (usage.reasoningTokens == null) {
        usage.reasoningTokens = reasoningText ? estimateTokens(reasoningText) : 0;
        usage.reasoningEstimated = reasoningText.length > 0;
      }
      recordUsage(usage);
      logCall({
        provider: PROVIDER,
        host: hostOf(this.baseUrl),
        model: this.modeloDe(opts),
        method: "generateStream",
        latencyMs: Date.now() - started,
        usage,
        params,
        attempts: 1,
        ok: emitted,
        leaked: filter.leaked || fieldReasoning.length > 0,
      });
    }
  }
}
