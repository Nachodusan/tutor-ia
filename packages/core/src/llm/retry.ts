/**
 * Reintentos con backoff exponencial.
 *
 * Regla dura: SOLO 429 y 5xx (y fallos de red). Un 4xx que no sea 429 nunca se
 * reintenta — reintentar un 401 o un 400 solo quema cuota y retrasa el error.
 *
 * Streaming: solo se puede reintentar ANTES del primer token. Una vez que el
 * generador emitió texto, un reintento duplicaría contenido; ahí el error sube.
 */
import { config } from "../config";
import { LLMError, type LLMProviderName } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Delay del intento n (1-based): 500ms, 1000ms, 2000ms… con jitter. */
function backoffMs(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

/**
 * Ejecuta `fn` con reintentos. `fn` recibe el número de intento (1-based) para
 * que el llamador pueda marcar el consumo como reintento en el presupuesto.
 */
export async function withRetry<T>(
  provider: LLMProviderName,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  const max = config.llmMaxRetries;
  let last: unknown;
  let used = 0;

  for (let attempt = 1; attempt <= max + 1; attempt++) {
    used = attempt;
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      const retryable = err instanceof LLMError && err.retryable;
      if (!retryable || attempt > max) break;
      await sleep(backoffMs(attempt));
    }
  }

  if (last instanceof LLMError) {
    // Los intentos REALES, no el máximo: un error no reintentable corta en el
    // primero, y reportar "3 intentos" hace creer que se pagó el triple.
    throw new LLMError(last.message, {
      provider: last.provider,
      kind: last.kind,
      status: last.status,
      retryable: last.retryable,
      attempts: used,
      cause: last.cause ?? last,
    });
  }
  throw new LLMError(last instanceof Error ? last.message : String(last), {
    provider,
    kind: "network",
    cause: last,
  });
}

/** Traduce un status HTTP al `kind` tipado. */
export function kindFromStatus(status: number): LLMError["kind"] {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "client";
}

/** ¿El error viene de un abort (timeout o cancelación externa)? */
export function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * Combina el timeout con una señal externa. Devuelve la señal y un `clear()`
 * que hay que llamar siempre (evita dejar timers colgados).
 *
 * `timedOut()` / `cancelled()` existen porque NO se puede confiar en el error:
 * el SDK de OpenAI envuelve el abort en un error propio ("Request was aborted.")
 * cuyo `name` no es AbortError, así que `isAbort` no lo reconocía y un TIMEOUT
 * caía en kind="network" → retryable → 3 intentos, pagando 3x y reportando
 * "fallo de red" en vez de "timeout". El handle sabe la verdad; el error no.
 */
export function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): {
  signal: AbortSignal;
  clear: () => void;
  timedOut: () => boolean;
  cancelled: () => boolean;
} {
  const ctrl = new AbortController();
  let fired = false;
  let cancelledExternally = false;
  const onAbort = () => {
    cancelledExternally = true;
    ctrl.abort(external?.reason);
  };
  const timer = setTimeout(() => {
    fired = true;
    ctrl.abort(new Error("timeout"));
  }, timeoutMs);

  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: ctrl.signal,
    clear: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
    timedOut: () => fired,
    cancelled: () => cancelledExternally,
  };
}
