/**
 * Orquestación de la ENSEÑANZA (Plan v3): retrieval tipado (contenido + pedagogía)
 * → arma el prompt del facilitador → genera. El "qué" (material citable) y el
 * "cómo" (guía didáctica por tipo) van separados al modelo.
 */
import {
  retrieveForTeaching,
  rerankHealthy,
  citationLabel,
  TEACHING_TYPES,
  type TeachingContext,
  type CitableChunk,
  type PedagogyChunk,
} from "@tutor-ia/rag";
import { chatStream, type ChatMsg } from "./client";
import { config } from "./config";
import { normalizeStudentQuery } from "./query-normalize";
import { TEACHING_SYSTEM, buildTeachingTurn } from "./prompts";
import type { ChatMessage } from "./types";

export interface TeachRequest {
  userId: string;
  subjectId?: string | null;
  question: string;
  history?: ChatMessage[];
  /** true → el estudiante no entendió; el tutor debe cambiar de estrategia. */
  struggling?: boolean;
  /** Estudio dirigido por el plan: unidad/lección del tema elegido. */
  unit?: number | null;
  lesson?: number | null;
}

/** Etiquetas legibles de los tipos de pedagogía para el prompt. */
const TYPE_LABEL: Record<string, string> = {
  proposito: "Propósito / objetivo de aprendizaje",
  ideas_previas: "Activación de ideas previas",
  ambiente_aprendizaje: "Ambiente/actividad de aprendizaje",
  habilidad: "Habilidad a desarrollar",
  errores_frecuentes: "Errores frecuentes del alumno (anticipalos)",
  evaluacion: "Qué se evalúa en la prueba (foco de evaluación)",
  solucionario: "Respuesta esperada (solucionario)",
};

/** Formatea el material citable (el "qué") como fragmentos numerados. */
export function formatMaterial(citable: CitableChunk[]): string {
  return citable
    .map((c, i) => {
      const page = c.pageStart != null ? `pág. ${c.pageStart}` : "";
      const src = c.source === "pedagogy" ? " · guía" : "";
      return `[Fragmento ${i + 1} — ${page}${src}]\n${c.content}`;
    })
    .join("\n\n");
}

/** Formatea la guía didáctica (el "cómo") agrupada por tipo, en orden de flujo. */
export function formatGuide(pedagogy: Record<string, PedagogyChunk[]>): string {
  const parts: string[] = [];
  for (const t of TEACHING_TYPES) {
    const chunks = pedagogy[t] ?? [];
    if (chunks.length === 0) continue;
    const body = chunks.map((c) => c.content.replace(/^\[[^\]]*\]\s*/, "").trim()).join("\n");
    parts.push(`### ${TYPE_LABEL[t] ?? t}\n${body}`);
  }
  return parts.join("\n\n");
}

export interface TeachingResult {
  ctx: TeachingContext;
  /** false → ni el TE ni la GDD cubren el tema: abstención. */
  grounded: boolean;
  rerankerDown?: boolean;
  /** La consulta de búsqueda fue reescrita por el puente de vocabulario. */
  qNorm?: boolean;
  qNormMs?: number;
}

/**
 * Query de retrieval que ARRASTRA EL TEMA de la conversación. Un follow-up como
 * "no entendí" no tiene palabras de contenido; sin el tema previo el retrieval
 * falla y el tutor se abstiene de más. Prepende los últimos turnos del ESTUDIANTE
 * (donde vive el tema) a la pregunta actual.
 */
function retrievalQuery(req: TeachRequest): { query: string; vague: boolean; prevUser: string } {
  const prevUser = (req.history ?? [])
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join(" ");
  // Un pedido vago ("dame otro ejemplo", "no entendí") NO aporta tema y diluye el
  // retrieval; si ya hay tema en la charla, dejá que ése mande.
  const vague = Boolean(prevUser) && VAGUE_RE.test(req.question.trim());
  const q = vague ? "" : req.question;
  return { query: `${prevUser} ${q}`.trim(), vague, prevUser };
}

/**
 * Recupera el contexto de enseñanza (contenido + pedagogía) con gate.
 *
 * PUENTE DE VOCABULARIO (política CRUDA-PRIMERO, medida 2026-08-02): primero se
 * busca con la formulación del alumno tal cual; SOLO si el gate corta, se
 * reescribe la pregunta a registro de libro (LLM local chico) y se reintenta.
 * Por qué en este orden y no al revés:
 *  - el golden queda intacto por construcción (cruda-primero = 81,6% idéntico;
 *    normalizar siempre lo bajaba 1,9 pts reordenando el top-5),
 *  - las regresiones del normalizador ("singlar"→"singular") no pueden morder:
 *    si la cruda ya pasó, la reescritura ni se usa,
 *  - la latencia extra solo se paga en el camino de abstención (~20% de turnos).
 * Medido en el set de alumno: 17→9 abstenciones, recall@5 47,3%→62,4%.
 */
export async function getTeachingContext(req: TeachRequest): Promise<TeachingResult> {
  const { query, vague, prevUser } = retrievalQuery(req);
  try {
    const opts = {
      userId: req.userId,
      subjectId: req.subjectId,
      minRerankScore: config.rerankMinScore,
      unit: req.unit ?? null,
      lesson: req.lesson ?? null,
    };
    const ctx = await retrieveForTeaching(query, opts);
    if (ctx.grounded || vague || !config.queryNormalize) {
      return { ctx, grounded: ctx.grounded, qNorm: false, qNormMs: 0 };
    }
    // El gate cortó con la cruda: reintento con la pregunta normalizada.
    const n = await normalizeStudentQuery(req.question);
    if (!n.changed) {
      return { ctx, grounded: ctx.grounded, qNorm: false, qNormMs: n.ms };
    }
    const ctx2 = await retrieveForTeaching(`${prevUser} ${n.query}`.trim(), opts);
    return ctx2.grounded
      ? { ctx: ctx2, grounded: true, qNorm: true, qNormMs: n.ms }
      : { ctx, grounded: false, qNorm: false, qNormMs: n.ms };
  } catch (err) {
    if (!(await rerankHealthy())) {
      return { ctx: null as unknown as TeachingContext, grounded: false, rerankerDown: true };
    }
    throw err;
  }
}

/**
 * El estudiante señala que NO entendió → el tutor cambia de estrategia en vez de
 * repetir (activa el bloque de adaptatividad en `buildTeachingTurn`).
 *
 * Vive acá, no en la route, para que el golden set pueda ejercer EXACTAMENTE el
 * mismo prompt que producción. Mientras estuvo duplicado en la route, el eval
 * nunca activaba esta rama —la que el propio prompt declara "lo más importante"—
 * y medía un turno que el alumno no recibe.
 */
export const STRUGGLE_RE =
  /no (lo |la )?entend|sin entender|no s[ée]\b|m[áa]s f[áa]cil|otra vez|otra forma|de nuevo|no me qued[óo] claro|no capt|no entiendo|no (lo |la )?(pillo|cacho)|otro ejemplo|repet[íi]|explic[áa].*(otra|de nuevo)/i;

/** ¿El alumno está trabado? Único criterio, compartido por la route y el eval. */
export function isStruggling(question: string): boolean {
  return STRUGGLE_RE.test(question);
}

export function teachingAbstention(): string {
  return "Mmm, eso puntual no lo encuentro en tu material y no quiero tirarte un dato inventado. ¿Lo reformulás, o querés que veamos otro tema? También podés armar un plan de estudio o hacer una simulación de prueba. 😊";
}

// Mensajes SOCIALES (saludo, agradecimiento, despedida, afirmación). No son
// preguntas sobre el material → NO deben pasar por el gate de abstención; el
// tutor responde conversacionalmente. Anclados a FIN de mensaje para no tragarse
// preguntas reales ("hola, explicame la célula" → sí va a enseñanza).
const GREETING_RE = /^\s*(hola+|buenas|buen[oa]s?\s*(d[ií]as|tardes|noches)?|buen\s*d[ií]a|hey|hi|hello|qu[ée]\s*tal|c[óo]mo\s*(est[áa]s|and[áa]s|va|te\s*va)|saludos|holis)[\s,.!¡¿?]*$/i;
const BYE_RE = /^\s*(chau+|chao|adi[óo]s|nos\s*vemos|hasta\s*(luego|pronto|ma[ñn]ana)|bye|me\s*voy)[\s,.!]*$/i;

/**
 * Respuesta conversacional a un mensaje SOCIAL, o null si es una consulta real
 * (que debe ir al flujo de enseñanza). Mantiene el tono de facilitador e invita
 * a un tema.
 */
/**
 * AFIRMACIONES que también son RESPUESTA. "dale", "listo", "entendí", "ok" son
 * cierre social si llegan solos, pero si el tutor acaba de preguntar "¿se
 * entiende?" son la respuesta del alumno al chequeo de comprensión.
 *
 * Interceptarlas siempre mataba la rama adaptativa del prompt —la que
 * TEACHING_SYSTEM declara "lo más importante"—: el chico contestaba "dale" y en
 * vez de avanzar al siguiente aspecto del tema recibía una frase fija que ni
 * siquiera pasaba por el modelo. Por eso solo cuentan como sociales cuando NO
 * hay conversación en curso.
 */
const AFIRMACION_RE =
  /^\s*(genial|perfecto|buen[íi]simo|excelente|ok|okey|okay|dale|listo|entend[íi]|clar[íi]?simo|de\s*acuerdo)[\s,.!]*$/i;
/** Agradecimiento puro: es social SIEMPRE, haya o no conversación. */
const GRACIAS_RE = /^\s*(much[ao]s?\s*)?gracias[\s,.!]*$/i;

export function socialReply(
  question: string,
  subjectName?: string,
  hasContext = false,
): string | null {
  const q = question.trim();
  if (!q) return null;
  const tema = subjectName ? ` de ${subjectName}` : "";
  if (GREETING_RE.test(q)) return `¡Hola! 😊 Soy tu tutor${tema}. ¿Qué tema querés que te explique?`;
  if (BYE_RE.test(q)) return "¡Chau! Volvé cuando quieras seguir estudiando. 👋";
  if (GRACIAS_RE.test(q)) return `¡Buenísimo! ¿Seguimos con otro tema${tema}, o querés que profundice en algo?`;
  // Con conversación en curso, una afirmación es respuesta al chequeo del tutor:
  // que la vea el modelo y decida si avanza o refuerza.
  if (!hasContext && AFIRMACION_RE.test(q)) {
    return `¡Buenísimo! ¿Seguimos con otro tema${tema}, o querés que profundice en algo?`;
  }
  return null;
}

// Pedido VAGO sin tema: "dame un ejemplo", "¿por qué es importante?", "explicá
// mejor", "más", "no entendí"… Si llega como PRIMER mensaje (sin un tema en la
// charla), el retrieval no tiene de qué agarrarse y el tutor se abstenía. En vez
// de eso, pedimos amablemente el tema (nunca el cartel de abstención).
//
// Un alumno real ENCADENA y DECORA: "sigo sin entender, dame otro ejemplo porfa"
// (medido en eval-multiturn c003: anclado a UNA frase pelada no matcheaba, la
// frase entera iba al retrieval, lo diluía y el gate abstenía con el tema previo
// a mano). Por eso esto no es una alternancia de frases sueltas sino una
// SECUENCIA de cláusulas vagas + muletillas de cortesía, anclada de punta a
// punta: si cualquier pedazo trae tema ("dame otro ejemplo de fracciones"), el
// ancla final falla y el mensaje NO es vago.
const VAGUE_CLAUSE = [
  "¿?\\s*(?:por|para)\\s*qu[ée]\\s+(?:es\\s+)?importante(?:\\s+esto)?\\??",
  "(?:dame|da|quiero|pon[ée]me|tir[áa]me)\\s+(?:un|otro)?\\s*ejemplos?(?:\\s+concretos?)?",
  "otro\\s+ejemplo",
  "m[áa]s\\s+ejemplos?",
  // "explicá mejor" · "explicámelo de otra forma" · "me lo explicas más fácil"
  "(?:me\\s+l[oa]\\s+)?explic[áa]s?(?:me(?:l[oa])?)?\\s+(?:mejor|m[áa]s\\s+f[áa]cil|de\\s+nuevo|otra\\s+vez|eso|m[áa]s|(?:de\\s+)?otra\\s+forma)",
  "(?:sigo|seguimos)\\s+sin\\s+entender(?:l[oa])?",
  "no\\s+entend[íi](?:\\s+nada)?",
  "no\\s+(?:lo\\s+|la\\s+)?(?:entiendo|pillo|cacho|capto)(?:\\s+nada)?",
  "no\\s+s[ée]",
  // "repetí" · "repetímelo" · "me lo repetís"
  "(?:me\\s+l[oa]\\s+)?repet[íi]s?(?:me(?:l[oa])?)?",
  "otra\\s+vez",
  "de\\s+nuevo",
  "m[áa]s\\s+f[áa]cil",
  "m[áa]s",
  "ampli[áa](?:me)?",
  "profundiz[áa]",
].join("|");
/** Muletillas de cortesía: decoran el pedido sin aportar tema. */
const MULETILLA = "(?:por\\s*favor|porfa+|porfis|porfi|plis)";
const VAGUE_RE = new RegExp(
  `^\\s*[¡¿]*\\s*(?:${MULETILLA}[\\s,]+)*(?:${VAGUE_CLAUSE})(?:[\\s,;.!¡¿?]+(?:(?:${VAGUE_CLAUSE})|${MULETILLA}))*[\\s,;.!¡¿?]*$`,
  "i",
);

/** Si es un pedido vago SIN tema previo, devuelve un empujón conversacional para
 *  que el alumno elija tema; null si hay contexto o la pregunta trae tema. */
export function needsTopicReply(question: string, hasContext: boolean, subjectName?: string): string | null {
  if (hasContext) return null;
  const q = question.trim();
  if (q.length > 90 || !VAGUE_RE.test(q)) return null;
  const tema = subjectName ? ` de ${subjectName}` : "";
  return `¡Dale! ¿Sobre qué tema${tema} querés que te ayude? Decime uno —o tocá un tema de tu plan— y te lo explico con un ejemplo. 😊`;
}

/** Cita legible del primer fragmento citable (para la UI). */
export function teachingCitations(ctx: TeachingContext) {
  return ctx.citable.map((c, i) => ({
    index: i + 1,
    chunkId: c.chunkId,
    page: c.pageStart,
    source: c.source,
    oa: c.oa,
    label: citationLabel({ pageStart: c.pageStart, pageEnd: c.pageEnd, headingPath: c.headingPath } as never),
  }));
}

/**
 * Genera la respuesta del tutor facilitador en streaming. El llamador debe
 * comprobar grounded antes: si es false, devolver teachingAbstention() sin llamar
 * al modelo (anti-alucinación capa 1).
 */
export async function* streamTeaching(
  req: TeachRequest,
  ctx: TeachingContext,
): AsyncGenerator<string> {
  const material = formatMaterial(ctx.citable);
  const guide = formatGuide(ctx.pedagogy);
  const history: ChatMsg[] = (req.history ?? []).map((m) => ({ role: m.role, content: m.content }));
  const messages: ChatMsg[] = [
    { role: "system", content: TEACHING_SYSTEM },
    ...history,
    {
      role: "user",
      content: buildTeachingTurn({
        question: req.question,
        material,
        guide,
        struggling: req.struggling,
      }),
    },
  ];
  yield* chatStream(messages);
}
