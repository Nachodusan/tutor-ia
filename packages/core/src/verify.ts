/**
 * Verificador A3 de PRODUCCIÓN (Plan v2 §4-A3) — NLI direccional, sin LLM extra.
 *
 * Tras generar una respuesta, la descompone en ORACIONES y verifica cada una
 * contra los chunks recuperados con un modelo NLI (mDeBERTa-v3 xnli) servido por
 * el sidecar. DOS señales, no una:
 *   - CONTRADICHA: algún chunk contradice la oración → alerta FUERTE ("el material
 *     dice lo contrario"). Es la que A3-relevancia dejaba pasar (~80% leak) y la
 *     que atrapa las premisas falsas confirmadas.
 *   - SIN RESPALDO: ningún chunk la implica (ni la contradice) → alerta suave.
 *
 * Determinista, sin llamada al LLM (~decenas de ms por oración en MPS). Por eso
 * es viable post-stream en el chat. Fail-honest: si el sidecar no responde,
 * reporta unavailable=true (la UI muestra "no verificado", no un falso OK).
 *
 * La MISMA función corre en el eval (métrica "prod"): lo que se mide es lo que
 * se sirve.
 */
import { splitSentences, nliVerify } from "@tutor-ia/rag";
import { config } from "./config";
import { ABSTENTION } from "./prompts";

export interface SentenceVerdict {
  text: string;
  /** Máx. entailment de la oración sobre algún chunk (0-1). */
  entailment: number;
  /** Máx. contradiction sobre algún chunk (0-1). */
  contradiction: number;
  supported: boolean;
  contradicted: boolean;
}

export interface AnswerVerification {
  /** false → hay al menos una oración contradicha o sin respaldo. */
  grounded: boolean;
  /** Oraciones que el material CONTRADICE (alerta fuerte). */
  contradicted: string[];
  /** Oraciones sin respaldo en el material (ni implicadas ni contradichas). */
  unsupported: string[];
  /** Cuántas oraciones sustantivas se verificaron. */
  checked: number;
  /** Detalle por oración (telemetría/depuración). */
  verdicts: SentenceVerdict[];
  /** true → el verificador no pudo correr (sidecar caído): NO verificado. */
  unavailable?: boolean;
}

/** Citas inline del modelo ("(Fragmento 2, pág. 14)"): fuera antes de puntuar. */
const INLINE_CITATION_RE = /\(\s*Fragmento[^)]*\)/gi;

/** Texto de abstención normalizado, para reconocer sus oraciones (no verificarlas). */
const ABSTENTION_NORM = ABSTENTION.toLowerCase().replace(/\s+/g, " ");

/** Oraciones META: el modelo habla del ACTO DE CITAR, no afirma un hecho del
 *  contenido (ej: "Esta información proviene del Fragmento 1, pág. 1..."). Se
 *  detectan por el token del aparato de citas ("Fragmento"), que no aparece en
 *  afirmaciones reales. NO filtramos por "según tus apuntes"/"material": eso
 *  prefija afirmaciones legítimas ("Según tus apuntes, la media se calcula..."). */
const META_RE = /\bfragmentos?\b/i;

/** ¿Oración sustantiva que vale la pena verificar? Se saltean preguntas de
 *  repaso, muletillas cortas, oraciones meta (sobre las fuentes) y CUALQUIER
 *  oración de la frase de abstención. */
function isCheckable(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < 25) return false;
  if (s.endsWith("?") || s.startsWith("¿")) return false;
  if (META_RE.test(s)) return false; // meta-comentario sobre las fuentes
  const norm = s.toLowerCase().replace(/\s+/g, " ");
  if (ABSTENTION_NORM.includes(norm)) return false; // es parte de la abstención
  return true;
}

/**
 * Verifica una respuesta completa contra los textos de los chunks que la
 * fundamentaron. Falla ABIERTO pero HONESTO: si el sidecar NLI no está,
 * devuelve unavailable=true (la UI muestra "no verificado", no un falso OK).
 */
export async function verifyAnswerA3(
  answer: string,
  chunkTexts: string[],
  minEntail = config.nliMinEntail,
  minContra = config.nliMinContra,
): Promise<AnswerVerification> {
  const sentences = splitSentences(answer.replace(INLINE_CITATION_RE, " "))
    .map((s) => s.trim())
    .filter(isCheckable);

  // NLI se entrena oración-vs-oración: contra un chunk largo multi-tema el
  // entailment se diluye a neutral (aunque contenga la frase textual) y los
  // chunks de otro tema se leen como contradicción. Por eso las PREMISAS son las
  // ORACIONES de los chunks, no los chunks enteros.
  const premises = chunkTexts
    .flatMap((c) => splitSentences(c))
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);

  if (sentences.length === 0 || premises.length === 0) {
    return { grounded: true, contradicted: [], unsupported: [], checked: 0, verdicts: [] };
  }

  const verdicts: SentenceVerdict[] = [];
  try {
    for (const text of sentences) {
      const v = await nliVerify(text, premises, minEntail, minContra);
      verdicts.push({
        text,
        entailment: v.entailment,
        contradiction: v.contradiction,
        supported: v.supported,
        contradicted: v.contradicted,
      });
    }
  } catch {
    return {
      grounded: true,
      contradicted: [],
      unsupported: [],
      checked: 0,
      verdicts: [],
      unavailable: true,
    };
  }

  const contradicted = verdicts.filter((v) => v.contradicted).map((v) => v.text);
  // "sin respaldo" = ni implicada ni contradicha (la contradicha ya se reporta
  // aparte, con alerta más fuerte).
  const unsupported = verdicts
    .filter((v) => !v.supported && !v.contradicted)
    .map((v) => v.text);

  return {
    grounded: contradicted.length === 0 && unsupported.length === 0,
    contradicted,
    unsupported,
    checked: verdicts.length,
    verdicts,
  };
}
