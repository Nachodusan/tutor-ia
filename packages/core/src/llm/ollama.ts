/**
 * Provider LOCAL (Ollama). Es el default y el camino de siempre: nada sale de
 * la máquina.
 *
 * El código viene de `client.ts` sin cambios de comportamiento. En particular
 * conserva sus timeouts históricos: el streaming NO tiene timeout y el JSON usa
 * LLM_JSON_TIMEOUT_MS (180s). Con el 7B recargando por `keep_alive:0` un turno
 * real llega a 2-3 minutos: aplicarle acá los 60s del provider remoto dejaría
 * la app local inutilizable.
 *
 * Lo que SÍ se agrega: params explícitos (ver params.ts), conteo de tokens,
 * tope de gasto y log de metadatos.
 */
import { config } from "../config";
import { assertWithinBudget, recordUsage } from "./budget";
import { logCall } from "./logging";
import { resolveGenParams, toOllamaOptions } from "./params";
import {
  ThinkStreamFilter,
  estimateTokens,
  stripThinkBlocks,
} from "./reasoning";
import { isAbort, withRetry, withTimeout } from "./retry";
import {
  LLMError,
  toMessages,
  type GenOptions,
  type LLMPrompt,
  type LLMProvider,
  type LLMUsage,
} from "./types";

const PROVIDER = "ollama" as const;

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

const emptyUsage = (): LLMUsage => ({ inputTokens: null, outputTokens: null });

function usageFrom(o: OllamaChunk): LLMUsage {
  return {
    inputTokens: o.prompt_eval_count ?? null,
    outputTokens: o.eval_count ?? null,
  };
}

export class OllamaProvider implements LLMProvider {
  readonly name = PROVIDER;
  readonly model: string;
  readonly baseUrl: string;

  constructor(model = config.llmModel, baseUrl = config.ollamaBaseUrl) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /** Host para el log. En local es siempre la máquina. */
  private get host(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return "local";
    }
  }

  private async post(
    body: unknown,
    timeoutMs: number,
    external: AbortSignal | undefined,
    attempt: number,
  ): Promise<Response> {
    // timeoutMs <= 0 → sin timeout (comportamiento histórico del streaming).
    const t = timeoutMs > 0 ? withTimeout(timeoutMs, external) : null;
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: t?.signal ?? external,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMError(
          `Ollama ${res.status}: ${text} (¿está corriendo en ${this.baseUrl}?)`,
          {
            provider: PROVIDER,
            kind: res.status >= 500 ? "server" : res.status === 429 ? "rate_limit" : "client",
            status: res.status,
            attempts: attempt,
          },
        );
      }
      return res;
    } catch (err) {
      t?.clear();
      if (err instanceof LLMError) throw err;
      if (isAbort(err)) {
        throw new LLMError(`Ollama: timeout tras ${timeoutMs}ms`, {
          provider: PROVIDER,
          kind: "timeout",
          attempts: attempt,
          cause: err,
        });
      }
      throw new LLMError(
        `Ollama: fallo de red (${err instanceof Error ? err.message : String(err)}). ` +
          `¿Está corriendo en ${this.baseUrl}?`,
        { provider: PROVIDER, kind: "network", attempts: attempt, cause: err },
      );
    } finally {
      // El clear del camino OK se hace al terminar de leer el body; para el
      // no-streaming basta con esto porque el body ya se consumió.
      if (timeoutMs > 0) t?.clear();
    }
  }

  async *generateStream(prompt: LLMPrompt, opts?: GenOptions): AsyncGenerator<string> {
    const params = resolveGenParams(opts);
    const timeoutMs = opts?.timeoutMs ?? config.ollamaStreamTimeoutMs;
    const started = Date.now();
    let usage = emptyUsage();
    let emitted = false;

    // Reintento SOLO antes del primer token (después duplicaría contenido).
    assertWithinBudget(PROVIDER);
    const res = await withRetry(PROVIDER, (attempt) =>
      this.post(
        {
          model: this.model,
          messages: toMessages(prompt),
          stream: true,
          options: toOllamaOptions(params),
        },
        timeoutMs,
        opts?.signal,
        attempt,
      ),
    );

    if (!res.body) {
      throw new LLMError("Ollama: respuesta sin body", {
        provider: PROVIDER,
        kind: "bad_response",
      });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const filter = new ThinkStreamFilter();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let obj: OllamaChunk;
          try {
            obj = JSON.parse(line) as OllamaChunk;
          } catch {
            continue; // línea parcial/malformada: no rompas el stream
          }
          if (obj.message?.content) {
            // Mismo filtro que en remoto: si el modelo local razona, tampoco
            // llega al call site (qwen2.5 no lo hace, pero el motor es el mismo).
            const safe = filter.push(obj.message.content);
            if (safe) {
              emitted = true;
              yield safe;
            }
          }
          if (obj.done) {
            usage = usageFrom(obj);
            const end = filter.finish();
            if (end.out) {
              emitted = true;
              yield end.out;
            }
            return;
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
      if (filter.reasoning) {
        usage.reasoningTokens = estimateTokens(filter.reasoning);
        usage.reasoningEstimated = true;
      }
      recordUsage(usage);
      logCall({
        provider: PROVIDER,
        host: this.host,
        model: this.model,
        method: "generateStream",
        latencyMs: Date.now() - started,
        usage,
        params,
        attempts: 1,
        ok: emitted,
        leaked: filter.leaked,
      });
    }
  }

  async generate(prompt: LLMPrompt, opts?: GenOptions): Promise<string> {
    let out = "";
    for await (const chunk of this.generateStream(prompt, opts)) out += chunk;
    return out;
  }

  async generateStructured<T>(
    prompt: LLMPrompt,
    schema: unknown,
    opts?: GenOptions,
  ): Promise<T> {
    const params = resolveGenParams(opts, true);
    const timeoutMs = opts?.timeoutMs ?? config.ollamaJsonTimeoutMs;
    const started = Date.now();
    let usage = emptyUsage();
    let leaked = false;

    try {
      const json = await withRetry(PROVIDER, async (attempt) => {
        assertWithinBudget(PROVIDER);
        const res = await this.post(
          {
            model: this.model,
            messages: toMessages(prompt),
            stream: false,
            format: schema,
            options: toOllamaOptions(params),
          },
          timeoutMs,
          opts?.signal,
          attempt,
        );
        const body = (await res.json()) as OllamaChunk;
        usage = usageFrom(body);
        recordUsage(usage, attempt > 1);
        return body;
      });

      const raw = json.message?.content;
      if (!raw) {
        throw new LLMError("Ollama: respuesta del modelo sin contenido.", {
          provider: PROVIDER,
          kind: "bad_response",
        });
      }
      // Un bloque de razonamiento antes del JSON rompería el parseo.
      const s = stripThinkBlocks(raw);
      leaked = s.leaked;
      if (s.reasoning) {
        usage.reasoningTokens = estimateTokens(s.reasoning);
        usage.reasoningEstimated = true;
      }
      try {
        return JSON.parse(s.content) as T;
      } catch (err) {
        throw new LLMError("Ollama: la salida estructurada no es JSON válido.", {
          provider: PROVIDER,
          kind: "bad_response",
          cause: err,
        });
      }
    } finally {
      logCall({
        provider: PROVIDER,
        host: this.host,
        model: this.model,
        method: "generateStructured",
        latencyMs: Date.now() - started,
        usage,
        params,
        attempts: 1,
        ok: true,
        leaked,
      });
    }
  }
}
