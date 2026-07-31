/**
 * Log por llamada al LLM: proveedor, HOST del baseURL, modelo, tokens de
 * entrada/salida, tokens de razonamiento y latencia.
 *
 * NUNCA se loguea el contenido del prompt ni de la respuesta. En este producto
 * ese contenido es material escolar y conversaciones de menores.
 *
 * El host es clave al comparar proveedores: el mismo modelo servido por
 * DeepInfra vs Scaleway vs Novita da números distintos, y sin el host en cada
 * línea no se sabe cuál produjo cuál.
 */
import { describeParams, type ResolvedParams } from "./params";
import { getUsageTotals } from "./budget";
import type { LLMProviderName, LLMUsage } from "./types";

export interface CallLog {
  provider: LLMProviderName;
  /** Host del baseURL efectivo (ej. api.deepinfra.com). Local en Ollama. */
  host: string;
  model: string;
  method: "generate" | "generateStructured" | "generateStream";
  latencyMs: number;
  usage: LLMUsage;
  params: ResolvedParams;
  attempts: number;
  ok: boolean;
  /** true → hubo que filtrar razonamiento (el switch de apagado no alcanzó). */
  leaked?: boolean;
  errorKind?: string;
}

/** `LLM_LOG=0` lo silencia (por defecto está encendido). */
function enabled(): boolean {
  const v = process.env.LLM_LOG;
  return !(v === "0" || v?.toLowerCase() === "false");
}

export function logCall(l: CallLog): void {
  if (!enabled()) return;
  const inTok = l.usage.inputTokens ?? "?";
  const outTok = l.usage.outputTokens ?? "?";
  const rTok = l.usage.reasoningTokens ?? 0;
  const rMark = l.usage.reasoningEstimated ? "~" : "";
  const totals = getUsageTotals();
  const retry = l.attempts > 1 ? ` intentos=${l.attempts}` : "";
  const leak = l.leaked ? " LEAK=razonamiento-filtrado" : "";
  const err = l.ok ? "" : ` ERROR=${l.errorKind ?? "desconocido"}`;
  console.log(
    `[llm] ${l.provider}@${l.host} ${l.model} ${l.method} ` +
      `${Math.round(l.latencyMs)}ms in=${inTok} out=${outTok} reason=${rMark}${rTok} ` +
      `${describeParams(l.params)}${retry}${leak}${err} ` +
      `· acum=${totals.totalTokens}tok/${totals.calls}call`,
  );
}
