/**
 * Contabilidad de tokens y TOPE DE GASTO por corrida.
 *
 * Motivo: el golden set son 133 preguntas × 2 llamadas (respuesta + claims) =
 * 266 llamadas base, y con 2 reintentos puede llegar a ~800 contra una API
 * paga. Un loop de reintentos no se debe descubrir en la factura.
 *
 * El contador suma TAMBIÉN los reintentos (es justo el caso que hay que
 * atrapar). El chequeo es previo a cada llamada: si el acumulado ya superó el
 * tope, se aborta con LLMError { kind: "budget_exceeded" } en vez de seguir.
 */
import { config } from "../config";
import { LLMError, type LLMProviderName, type LLMUsage } from "./types";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /**
   * Tokens gastados en razonamiento invisible. Se reportan para VISIBILIDAD
   * (cuánto se paga por texto que nadie ve) pero NO se suman a totalTokens:
   * ya vienen incluidos en outputTokens. Verificado en Qwen3.6: 191 tokens de
   * salida para 3 de respuesta útil. Sumarlos aparte sería contarlos dos veces.
   */
  reasoningTokens: number;
  calls: number;
  /** Llamadas que fueron reintentos (no la primera de su serie). */
  retries: number;
}

const totals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  calls: 0,
  retries: 0,
};

/** Acumulado de la corrida actual. */
export function getUsageTotals(): Readonly<UsageTotals> {
  return { ...totals };
}

/** Reinicia el acumulado (útil entre fases de un experimento). */
export function resetUsage(): void {
  totals.inputTokens = 0;
  totals.outputTokens = 0;
  totals.totalTokens = 0;
  totals.reasoningTokens = 0;
  totals.calls = 0;
  totals.retries = 0;
}

/** Suma el consumo de una llamada. `isRetry` marca los reintentos. */
export function recordUsage(usage: LLMUsage, isRetry = false): void {
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  // reasoningTokens NO entra en totalTokens: ya está dentro de outputTokens.
  totals.totalTokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  totals.reasoningTokens += usage.reasoningTokens ?? 0;
  totals.calls += 1;
  if (isRetry) totals.retries += 1;
}

/**
 * Verifica el tope ANTES de gastar. Lanza si ya se superó.
 * `LLM_MAX_TOKENS_PER_RUN=0` (o ausente) = sin límite.
 */
export function assertWithinBudget(provider: LLMProviderName): void {
  const cap = config.maxTokensPerRun;
  if (!cap || cap <= 0) return;
  if (totals.totalTokens >= cap) {
    throw new LLMError(
      `Tope de tokens de la corrida superado: ${totals.totalTokens} >= ${cap} ` +
        `(${totals.calls} llamadas, ${totals.retries} reintentos). ` +
        `Subí LLM_MAX_TOKENS_PER_RUN o revisá si hay un loop de reintentos.`,
      { provider, kind: "budget_exceeded", retryable: false },
    );
  }
}

/** Resumen legible para imprimir al final de una corrida. */
export function formatUsageTotals(): string {
  const t = getUsageTotals();
  const cap = config.maxTokensPerRun;
  const pct =
    t.outputTokens > 0 ? Math.round((t.reasoningTokens / t.outputTokens) * 100) : 0;
  return (
    `tokens: ${t.totalTokens} (in ${t.inputTokens} / out ${t.outputTokens}) · ` +
    `razonamiento ${t.reasoningTokens} (${pct}% del output, ya incluido) · ` +
    `${t.calls} llamadas · ${t.retries} reintentos` +
    (cap && cap > 0 ? ` · tope ${cap}` : " · sin tope")
  );
}
