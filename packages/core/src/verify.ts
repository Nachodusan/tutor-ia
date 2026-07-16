/**
 * Verificador A3 de PRODUCCIÓN (Plan v2 §4-A3) — determinista, sin LLM extra.
 *
 * Tras generar una respuesta, la descompone en ORACIONES y comprueba cada una
 * por entailment contra los chunks recuperados (cross-encoder bge-reranker).
 * A diferencia del verificador del eval (que re-pide claims al 7B), este no
 * agrega ninguna llamada al LLM: solo N llamadas al reranker (~100ms c/u en MPS),
 * así que es viable post-stream en el chat real.
 *
 * ESTA MISMA función se usa en el eval (§9.2, métrica "prod") para que lo que
 * se mide sea lo que se sirve — el punto de la Fase 2.
 *
 * Límite conocido: entails() es relevancia, no NLI direccional — una oración
 * on-topic pero falsa puede superar el umbral (ver rerank.ts). Capa de defensa,
 * no garantía absoluta.
 */
import { entails, splitSentences } from "@tutor-ia/rag";
import { config } from "./config";
import { ABSTENTION } from "./prompts";

export interface SentenceVerdict {
  /** La oración tal como aparece en la respuesta. */
  text: string;
  /** Mejor score de entailment contra los chunks (0-1). */
  score: number;
  supported: boolean;
}

export interface AnswerVerification {
  /** false → al menos una oración quedó sin respaldo en el material. */
  grounded: boolean;
  /** Oraciones bajo el umbral (para mostrarlas al estudiante). */
  unsupported: string[];
  /** Cuántas oraciones sustantivas se verificaron. */
  checked: number;
  /** Detalle por oración (para depurar/telemetría; la UI usa unsupported). */
  verdicts: SentenceVerdict[];
  /** true → el verificador no pudo correr (reranker caído): NO verificado. */
  unavailable?: boolean;
}

/** Citas inline que emite el modelo ("(Fragmento 2, pág. 14)"): no son parte
 *  del material, se quitan antes de puntuar la oración. */
const INLINE_CITATION_RE = /\(\s*Fragmento[^)]*\)/gi;

/** ¿Oración sustantiva que vale la pena verificar? Se saltean preguntas de
 *  repaso, muletillas cortas y la frase de abstención (no son afirmaciones). */
function isCheckable(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < 25) return false;
  if (s.endsWith("?") || s.startsWith("¿")) return false;
  if (s.includes(ABSTENTION.slice(0, 40))) return false;
  return true;
}

/**
 * Verifica una respuesta completa contra los textos de los chunks que la
 * fundamentaron. Falla ABIERTO pero HONESTO: si el reranker no está disponible
 * devuelve unavailable=true (la UI muestra "no verificado", no un falso OK).
 */
export async function verifyAnswerA3(
  answer: string,
  chunkTexts: string[],
  minScore = config.entailMinScore,
): Promise<AnswerVerification> {
  const sentences = splitSentences(answer.replace(INLINE_CITATION_RE, " "))
    .map((s) => s.trim())
    .filter(isCheckable);

  if (sentences.length === 0 || chunkTexts.length === 0) {
    return { grounded: true, unsupported: [], checked: 0, verdicts: [] };
  }

  const verdicts: SentenceVerdict[] = [];
  try {
    // Secuencial a propósito: el reranker corre en la GPU (MPS) y serializa
    // igual; en paralelo solo agregaríamos contención.
    for (const text of sentences) {
      const score = await entails(text, chunkTexts);
      verdicts.push({ text, score, supported: score >= minScore });
    }
  } catch {
    // Reranker caído a mitad de la verificación: reportar como NO verificado.
    return {
      grounded: true,
      unsupported: [],
      checked: 0,
      verdicts: [],
      unavailable: true,
    };
  }

  const unsupported = verdicts.filter((v) => !v.supported).map((v) => v.text);
  return {
    grounded: unsupported.length === 0,
    unsupported,
    checked: verdicts.length,
    verdicts,
  };
}
