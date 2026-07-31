/**
 * Groundedness — Eje A del plan v2 (§4).
 *
 * A2 (cita literal): el modelo debe emitir, por cada afirmación, el substring
 * EXACTO del material que la respalda. Aquí verificamos ese substring por
 * coincidencia de cadena — sin modelo, costo cero, determinístico. Una
 * afirmación cuya cita no aparece literalmente en su chunk se marca como
 * "fuera del material".
 *
 * A4 (salida graduada): cada afirmación queda etiquetada como
 *   'respaldada' | 'inferida' | 'fuera_del_material'  (no binario).
 *
 * A3 (entailment con cross-encoder) NO vive aquí: es un servicio aparte
 * (bge-reranker) que se integra en Fase 2. Este módulo es la base determinística.
 */

/**
 * Normaliza texto para comparar citas contra el material de forma robusta a las
 * variaciones típicas de extracción de PDF (espacios, comillas tipográficas,
 * guiones, saltos de línea, mayúsculas). NO elimina acentos: en español pueden
 * cambiar el significado y quitarlos causaría falsos positivos.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "") // zero-width
    .replace(/[“”«»„]/g, '"') // comillas tipográficas
    .replace(/[‘’‚]/g, "'")
    .replace(/[‐-―−]/g, "-") // guiones/menos unicode -> '-'
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** ¿La cita aparece literalmente (tras normalizar) dentro del chunk? */
export function quoteMatchesChunk(chunkText: string, quote: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 8) return false; // citas triviales no cuentan como respaldo
  return normalizeForMatch(chunkText).includes(q);
}

export type ClaimLabel = "respaldada" | "inferida" | "fuera_del_material";

/** Afirmación tal como la emite el modelo (salida estructurada). */
export interface RawClaim {
  /** El texto de la afirmación mostrado al usuario. */
  text: string;
  /**
   * Substring literal del material que la respalda. Vacío/omitido si el modelo
   * la declara como inferencia propia (no textual).
   * Puede venir `null`: el modo estricto de Structured Outputs no admite campos
   * opcionales, así que se piden siempre y se marcan nullables (ver CLAIMS_SCHEMA).
   */
  quote?: string | null;
  /** Índice del fragmento citado (1-based, como se numeran en el contexto). */
  chunkIndex?: number | null;
}

export interface VerifiedClaim extends RawClaim {
  label: ClaimLabel;
  /** true solo si la cita se verificó por string-match contra su chunk. */
  quoteVerified: boolean;
}

export interface GroundednessReport {
  claims: VerifiedClaim[];
  /** Afirmaciones respaldadas / total (con cita). Métrica de auditoría. */
  supportedRatio: number;
  /** Hay al menos una afirmación "fuera del material". */
  hasUnsupported: boolean;
}

/**
 * Verifica cada afirmación contra los chunks recuperados (en el mismo orden en
 * que se numeraron para el modelo). Implementa A2 + A4.
 *
 * @param claims    afirmaciones emitidas por el modelo
 * @param chunkTexts textos de los fragmentos, indexados desde 1 (chunkIndex)
 */
export function verifyClaims(
  claims: RawClaim[],
  chunkTexts: string[],
): GroundednessReport {
  const verified: VerifiedClaim[] = claims.map((c) => {
    // Sin cita => el modelo la declara como inferencia (no textual).
    if (!c.quote || c.quote.trim() === "") {
      return { ...c, label: "inferida", quoteVerified: false };
    }
    // Con cita: debe aparecer literalmente en el chunk citado (o, si no se
    // indicó chunk, en cualquiera de los recuperados).
    const candidates =
      c.chunkIndex && chunkTexts[c.chunkIndex - 1] != null
        ? [chunkTexts[c.chunkIndex - 1] as string]
        : chunkTexts;
    const ok = candidates.some((t) => quoteMatchesChunk(t, c.quote!));
    return {
      ...c,
      label: ok ? "respaldada" : "fuera_del_material",
      quoteVerified: ok,
    };
  });

  const withQuote = verified.filter((c) => c.quote && c.quote.trim() !== "");
  const supported = withQuote.filter((c) => c.label === "respaldada").length;

  return {
    claims: verified,
    supportedRatio: withQuote.length === 0 ? 0 : supported / withQuote.length,
    hasUnsupported: verified.some((c) => c.label === "fuera_del_material"),
  };
}

/**
 * JSON Schema para pedirle al modelo respuestas descompuestas en afirmaciones,
 * cada una con su cita literal. Se usa con chatJSON (salida estructurada).
 */
export const CLAIMS_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          // En strict mode NO existen los campos opcionales: van todos en
          // "required" y la ausencia se expresa como null. El consumidor
          // (verifyClaims) ya usa chequeos truthy, así que null se comporta
          // igual que el `undefined` de antes.
          quote: { type: ["string", "null"] },
          chunkIndex: { type: ["integer", "null"] },
        },
        required: ["text", "quote", "chunkIndex"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;
