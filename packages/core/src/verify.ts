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

/** ANDAMIAJE conversacional: el tutor le habla al estudiante sobre el PROCESO de
 *  aprender (aliento, transiciones, "vamos a…"), no afirma un hecho del material.
 *  No es verificable — marcarlo como "sin respaldo/contradicho" confunde al alumno. */
const SCAFFOLD_RE =
  /^\s*(¡?\s*(claro|perfecto|genial|buen[íi]simo|excelente|dale|listo|muy bien|ok(ey)?|s[íi])\b|vamos a\b|veamos\b|empecemos\b|sigamos\b|continuemos\b|si no (lo |la )?(entend|te qued|comprend|captas)|si (tienes|tenés) (alguna )?(duda|pregunta)|no dudes en\b|cualquier (duda|cosa|pregunta)|espero que (esto|te|esta|est[eé])|no te preocup|¿(list[oa]|empezamos|te anim|seguimos|arrancamos|vamos))/i;

/** Aliento sobre el proceso de aprender (no afirma contenido del material). */
const PROCESS_RE =
  /\b(seguir aprendiendo|sigas aprendiendo|puedas (seguir )?aprend|sin problemas|aprender mejor|adaptarnos|nos adaptamos|a tu ritmo|paso a paso|pregunt[ае]me lo que|no hay problema)\b/i;

/** ANALOGÍA / HIPÓTESIS pedagógica: el buen tutor explica con comparaciones y
 *  ejemplos imaginados ("imaginá…", "es como un…", "sería como…"). NO son
 *  afirmaciones factuales del material — el NLI las lee como "contradicción"
 *  aunque sean buena enseñanza, así que NO se verifican. */
const ANALOGY_RE =
  /(^|\s)(imagin[áa](te)?|imagina|pens[áa]|piensa|piens[eé]nse|supongamos|supon[ée]|ser[íi]a como|es como|son como|era[n]? como|como si|algo (parecido|as[íi])|como un[ao]?\b|es parecid|es igual que|te lo pongo así)/i;

/** Limpia markdown y rótulos de sección que el modelo a veces imprime, para que
 *  la segmentación en oraciones no pegue "**Explicación:**" o "---" a un hecho
 *  real (lo que hacía que el NLI juzgara un bloque confuso y diera falsos +). */
function cleanForVerification(answer: string): string {
  return answer
    .replace(INLINE_CITATION_RE, " ")
    .replace(/\*\*|__|`+/g, " ") // negritas / código
    .replace(/^#{1,6}\s*/gm, "") // encabezados markdown
    .replace(/^[-*]\s+/gm, "") // viñetas
    .replace(/^\s*-{3,}\s*$/gm, " ") // reglas horizontales ---
    // rótulos de sección al inicio de línea ("Objetivo:", "Explicación: …")
    .replace(
      /^\s*(objetivo|explicaci[oó]n|activaci[oó]n( de ideas previas)?|introducci[oó]n|pregunta de comprensi[oó]n|verificaci[oó]n|repaso|ejemplo|actividad|habilidad|desarrollo)\s*:\s*/gim,
      "",
    );
}

/** ¿Oración sustantiva que vale la pena verificar? Se saltean preguntas de
 *  repaso, muletillas cortas, andamiaje conversacional, oraciones meta (sobre las
 *  fuentes) y CUALQUIER oración de la frase de abstención. */
function isCheckable(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < 25) return false;
  if (s.endsWith("?") || s.startsWith("¿")) return false;
  if (META_RE.test(s)) return false; // meta-comentario sobre las fuentes
  if (SCAFFOLD_RE.test(s)) return false; // andamiaje conversacional
  if (PROCESS_RE.test(s)) return false; // aliento sobre el proceso de aprender
  if (ANALOGY_RE.test(s)) return false; // analogía/ejemplo imaginado, no un hecho
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
  const sentences = splitSentences(cleanForVerification(answer))
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

  // El facilitador PARAFRASEA y ejemplifica: el NLI por oración marca como
  // "contradicción" hasta afirmaciones correctas y citadas (medido: analogías con
  // contradiction 0.86-1.0). Por eso NO surfaceamos alertas por oración —
  // asustan al alumno y castigan la buena pedagogía. El anti-alucinación real ya
  // está en el gate de retrieval (se abstiene si no hay material), las citas y la
  // corrección de premisa falsa. Aquí sólo detectamos DERIVA sistemática: la
  // respuesta habla de OTRA cosa que el material (nada respaldado + varias
  // contradicciones fuertes) — señal de que se recuperó material equivocado.
  const strong = verdicts.filter((v) => v.contradicted && !v.supported && v.contradiction >= 0.6);
  const supportedCount = verdicts.filter((v) => v.supported).length;
  const drift = supportedCount === 0 && strong.length >= 3;

  return {
    grounded: !drift,
    contradicted: drift ? strong.map((v) => v.text) : [],
    unsupported: [],
    checked: verdicts.length,
    verdicts,
  };
}
