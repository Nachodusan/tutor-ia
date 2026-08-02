/**
 * PUENTE DE VOCABULARIO: reescribe la pregunta del alumno a registro de libro
 * ANTES del retrieval.
 *
 * Por qué existe (medido 2026-08-01): el cross-encoder puntúa el par
 * «profe no cacho q es el narrador» ↔ chunk correcto en 0.006, y el par
 * «¿Qué es el narrador en un cuento?» ↔ MISMO chunk en 0.24 — 40× por la
 * redacción. Eso abstenía 17/43 preguntas de alumno con el material correcto ya
 * recuperado y bien rankeado. Normalizar la consulta ataca la causa en TODOS los
 * eslabones a la vez (denso, léxico, reranker y gate); su techo medido es
 * +38,4 pts de recall@5 (la formulación de libro de las mismas preguntas).
 *
 * Decisiones de diseño:
 *  - SOLO la consulta de búsqueda. La pregunta original sigue intacta hacia el
 *    modelo docente y hacia los regex (social/vago/struggling): ahí el registro
 *    coloquial es señal.
 *  - Modelo LOCAL chico (qwen2.5:3b vía Ollama), aunque la generación principal
 *    sea remota: gratis, privado y suficiente para corregir ortografía/registro.
 *  - FAIL-OPEN estricto: timeout, error, salida vacía o desproporcionada → se
 *    usa la original. La normalización no puede romper un turno jamás.
 */
import { config } from "./config";
import { makeProvider } from "./llm";
import type { LLMProvider } from "./llm/types";

const SYSTEM = `Reescribís preguntas de estudiantes chilenos a lenguaje claro de libro escolar.

Reglas ESTRICTAS:
- Corregí ortografía y abreviaciones (q→que, xq→por qué, kien→quién).
- Pasá el registro coloquial a una pregunta clara y neutra.
- CONSERVÁ el idioma (español), el tema y TODO detalle concreto (nombres, títulos, números).
- NO respondas la pregunta. NO agregues información ni contexto que no esté.
- NO inventes nombres propios que el estudiante no dijo.
- Devolvé SOLO la pregunta reescrita, sin comillas ni explicación.`;

export interface NormalizedQuery {
  /** La consulta a usar: la reescrita, o la original si falló o no cambió. */
  query: string;
  changed: boolean;
  ms: number;
}

/** Provider propio (no toca el memo global): la generación principal puede ser
 *  remota mientras esto corre contra Ollama local. */
let normalizer: LLMProvider | null = null;
function getNormalizer(): LLMProvider {
  normalizer ??= makeProvider("ollama", config.queryNormalizerModel);
  return normalizer;
}

/** ¿La salida es una reescritura creíble de la entrada? Guardas baratas contra
 *  un 3B que divaga: vacía, desproporcionada o multilínea → descartar. */
function plausible(original: string, rewritten: string): boolean {
  const r = rewritten.trim();
  if (!r) return false;
  if (r.includes("\n")) return false;
  const ratio = r.length / Math.max(1, original.trim().length);
  return ratio >= 0.4 && ratio <= 3;
}

export async function normalizeStudentQuery(q: string): Promise<NormalizedQuery> {
  const started = Date.now();
  const original = q.trim();
  if (!config.queryNormalize || original.length < 8) {
    return { query: original, changed: false, ms: 0 };
  }
  try {
    const out = await getNormalizer().generate(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: original },
      ],
      {
        temperature: 0,
        maxTokens: 80,
        timeoutMs: config.queryNormalizeTimeoutMs,
      },
    );
    const rewritten = out.trim().replace(/^["«»']+|["«»']+$/g, "");
    if (!plausible(original, rewritten) || rewritten === original) {
      return { query: original, changed: false, ms: Date.now() - started };
    }
    return { query: rewritten, changed: true, ms: Date.now() - started };
  } catch {
    // Ollama caído, modelo no descargado, timeout: el turno sigue con la cruda.
    return { query: original, changed: false, ms: Date.now() - started };
  }
}
