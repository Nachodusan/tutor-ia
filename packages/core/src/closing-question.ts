/**
 * VALIDADOR DE LA PREGUNTA DE CIERRE.
 *
 * El tutor termina cada turno con una pregunta para verificar comprensión. Medido
 * sobre los 25 turnos reales que había en la base, el 40% VENÍA CONTESTADA en el
 * propio mensaje: el tutor decía "el tamaño del pico es la variable dependiente"
 * y dos renglones después preguntaba cuál era la variable dependiente. El chico
 * copia y nadie aprende nada.
 *
 * `TEACHING_SYSTEM` ya trae la regla ("releé lo que dijiste; si se responde
 * copiando, cambiala") y mejoró el número —regenerando los 10 peores, 6 quedaron
 * sanos— pero es una instrucción, no una garantía: depende de que el modelo se
 * auto-controle justo en la parte donde ya se demostró que no lo hace.
 *
 * Esto lo verifica DESPUÉS de generar y, si la pregunta se responde copiando,
 * pide una de reemplazo. Dos llamadas cortas (juicio + reemplazo) y solo cuando
 * hace falta.
 *
 * ── Por qué el stream se retiene al final y no se corrige después ────────────
 * Si la pregunta ya salió a la pantalla, cambiarla es peor que dejarla: el chico
 * ve dos preguntas. Por eso `streamTeachingChecked` retiene la ÚLTIMA oración
 * (no todo el mensaje: el cuerpo sale token a token como siempre) y recién la
 * emite cuando pasó el chequeo o fue reemplazada. El costo percibido es el de la
 * última oración, no el del turno.
 *
 * Apagado con CLOSING_QUESTION_CHECK=0. Va detrás de flag a propósito: el
 * baseline vigente se midió sin esto y la comparación tiene que poder repetirse.
 */
import { chatText } from "./client";
import { config } from "./config";

/** Corta la última pregunta del texto: desde el inicio de la oración final que
 *  termina en "?" hasta el final. Devuelve null si el mensaje no cierra con una
 *  pregunta (nada que validar). */
export function splitClosingQuestion(
  text: string,
): { body: string; question: string; inicio: number } | null {
  // `trimEnd` no mueve el origen, así que `inicio` sirve como índice sobre el
  // texto ORIGINAL. Eso es lo que permite empalmar sin adivinar dónde cortaba.
  const t = text.trimEnd();
  if (!t.endsWith("?")) return null;
  // El inicio de la última oración: después del último signo de cierre previo, o
  // del "¿" que abre (en español el signo de apertura es la marca más confiable).
  const abre = t.lastIndexOf("¿");
  const puntoPrevio = Math.max(
    t.lastIndexOf(". ", t.length - 2),
    t.lastIndexOf("! ", t.length - 2),
    t.lastIndexOf("\n", t.length - 2),
  );
  const inicio = abre > puntoPrevio ? abre : puntoPrevio + 2;
  if (inicio <= 0 || inicio >= t.length) return null;
  const question = t.slice(inicio).trim();
  const body = t.slice(0, inicio).trim();
  // Sin cuerpo no hay nada que copiar: la pregunta no puede estar auto-contestada.
  if (!body || question.length < 10) return null;
  return { body, question, inicio };
}

const JUEZ_SYSTEM = `Sos un evaluador de preguntas de comprensión. Te doy la EXPLICACIÓN que un tutor le dio a un estudiante y la PREGUNTA con la que la cerró.

Decidí UNA cosa: ¿el estudiante puede responder esa pregunta COPIANDO una frase de la explicación, sin pensar?

Respondé exactamente una palabra:
COPIABLE — si la respuesta está dicha en la explicación (aunque sea con otras palabras), o si es una pregunta de sí/no o retórica ("¿se entiende?", "¿te hace sentido?").
BUENA — si para responderla hay que aplicar la idea a un caso nuevo, predecir, comparar, calcular o dar un ejemplo propio.

Ante la duda genuina, respondé BUENA: reemplazar una pregunta que estaba bien cuesta más que dejar pasar una dudosa.`;

const REEMPLAZO_SYSTEM = `Escribí UNA sola pregunta de cierre para un estudiante, a partir de la explicación que te doy.

REGLAS:
- NO puede responderse copiando una frase de la explicación. Tiene que pedir algo que la explicación NO dice: aplicar la idea a un caso nuevo, predecir qué pasaría al cambiar algo, comparar dos situaciones y justificar, o dar un ejemplo propio.
- PROHIBIDAS las preguntas de sí/no y las retóricas ("¿se entiende?", "¿te hace sentido?").
- Una sola oración, en el mismo tono cercano y simple de la explicación, tuteando/voseando igual.
- Sin emojis, sin markdown, sin comillas, sin preámbulo. Devolvé SOLO la pregunta.`;

/** ¿La pregunta de cierre se responde copiando? null = no se pudo juzgar. */
export async function esCopiable(body: string, question: string): Promise<boolean | null> {
  try {
    const out = await chatText(
      [
        { role: "system", content: JUEZ_SYSTEM },
        { role: "user", content: `=== EXPLICACIÓN ===\n${body}\n=== PREGUNTA DE CIERRE ===\n${question}` },
      ],
      { temperature: 0, maxTokens: 8 },
    );
    const v = out.trim().toUpperCase();
    if (v.includes("COPIABLE")) return true;
    if (v.includes("BUENA")) return false;
    return null;
  } catch {
    return null; // el juez no está: se deja la pregunta original
  }
}

/** Una pregunta de reemplazo, o null si no se pudo generar una usable. */
export async function preguntaDeReemplazo(body: string): Promise<string | null> {
  try {
    const out = await chatText(
      [
        { role: "system", content: REEMPLAZO_SYSTEM },
        { role: "user", content: body },
      ],
      { temperature: 0.3, maxTokens: 60 },
    );
    const q = out.trim().replace(/^["'¿\s]*/, (m) => (m.includes("¿") ? "¿" : "")).trim();
    // Guardas baratas contra un modelo que divaga: tiene que ser UNA pregunta.
    if (!q.endsWith("?") || q.includes("\n") || q.length < 12 || q.length > 220) return null;
    return q;
  } catch {
    return null;
  }
}

/**
 * Valida (y si hace falta reemplaza) la pregunta de cierre de una respuesta ya
 * generada. Devuelve el texto final y si hubo reemplazo, para poder medirlo.
 */
export interface CierreValidado {
  text: string;
  replaced: boolean;
  checked: boolean;
  /** La pregunta de reemplazo, cuando hubo. */
  nueva?: string;
  /** Índice, sobre la respuesta original, donde empezaba la pregunta vieja.
   *  Lo necesita quien va emitiendo el stream para empalmar sin cortar el cuerpo
   *  a mano. */
  inicio?: number;
}

export async function validarPreguntaFinal(answer: string): Promise<CierreValidado> {
  if (!config.closingQuestionCheck) return { text: answer, replaced: false, checked: false };
  const partes = splitClosingQuestion(answer);
  if (!partes) return { text: answer, replaced: false, checked: false };

  const copiable = await esCopiable(partes.body, partes.question);
  if (copiable !== true) return { text: answer, replaced: false, checked: copiable !== null };

  const nueva = await preguntaDeReemplazo(partes.body);
  if (!nueva) return { text: answer, replaced: false, checked: true };
  return {
    text: `${partes.body}\n\n${nueva}`,
    replaced: true,
    checked: true,
    nueva,
    inicio: partes.inicio,
  };
}
