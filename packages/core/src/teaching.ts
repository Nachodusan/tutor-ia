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
}

/**
 * Query de retrieval que ARRASTRA EL TEMA de la conversación. Un follow-up como
 * "no entendí" no tiene palabras de contenido; sin el tema previo el retrieval
 * falla y el tutor se abstiene de más. Prepende los últimos turnos del ESTUDIANTE
 * (donde vive el tema) a la pregunta actual.
 */
function retrievalQuery(req: TeachRequest): string {
  const prevUser = (req.history ?? [])
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join(" ");
  // Un pedido vago ("dame otro ejemplo", "no entendí") NO aporta tema y diluye el
  // retrieval; si ya hay tema en la charla, dejá que ése mande.
  const q = prevUser && VAGUE_RE.test(req.question.trim()) ? "" : req.question;
  return `${prevUser} ${q}`.trim();
}

/** Recupera el contexto de enseñanza (contenido + pedagogía) con gate. */
export async function getTeachingContext(req: TeachRequest): Promise<TeachingResult> {
  try {
    const ctx = await retrieveForTeaching(retrievalQuery(req), {
      userId: req.userId,
      subjectId: req.subjectId,
      minRerankScore: config.rerankMinScore,
      unit: req.unit ?? null,
      lesson: req.lesson ?? null,
    });
    return { ctx, grounded: ctx.grounded };
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
  /no (lo |la )?entend|no s[ée]\b|m[áa]s f[áa]cil|otra vez|otra forma|de nuevo|no me qued[óo] claro|no capt|no entiendo|repet[íi]|explic[áa].*(otra|de nuevo)/i;

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
const THANKS_RE = /^\s*(much[ao]s?\s*)?(gracias|genial|perfecto|buen[íi]simo|excelente|ok|okey|okay|dale|listo|entend[íi]|clar[íi]?simo|de\s*acuerdo)[\s,.!]*$/i;
const BYE_RE = /^\s*(chau+|chao|adi[óo]s|nos\s*vemos|hasta\s*(luego|pronto|ma[ñn]ana)|bye|me\s*voy)[\s,.!]*$/i;

/**
 * Respuesta conversacional a un mensaje SOCIAL, o null si es una consulta real
 * (que debe ir al flujo de enseñanza). Mantiene el tono de facilitador e invita
 * a un tema.
 */
export function socialReply(question: string, subjectName?: string): string | null {
  const q = question.trim();
  if (!q) return null;
  const tema = subjectName ? ` de ${subjectName}` : "";
  if (GREETING_RE.test(q)) return `¡Hola! 😊 Soy tu tutor${tema}. ¿Qué tema querés que te explique?`;
  if (BYE_RE.test(q)) return "¡Chau! Volvé cuando quieras seguir estudiando. 👋";
  if (THANKS_RE.test(q)) return `¡Buenísimo! ¿Seguimos con otro tema${tema}, o querés que profundice en algo?`;
  return null;
}

// Pedido VAGO sin tema: "dame un ejemplo", "¿por qué es importante?", "explicá
// mejor", "más", "no entendí"… Si llega como PRIMER mensaje (sin un tema en la
// charla), el retrieval no tiene de qué agarrarse y el tutor se abstenía. En vez
// de eso, pedimos amablemente el tema (nunca el cartel de abstención).
const VAGUE_RE =
  /^\s*(?:¿?\s*(?:por|para)\s*qu[ée]\s+(?:es\s+)?importante(?:\s+esto)?\??|(?:dame|da|quiero|pon[ée]me|tir[áa]me)\s+(?:un|otro)?\s*ejemplo(?:\s+concreto)?|otro\s+ejemplo|m[áa]s\s+ejemplos?|explic[áa](?:me)?\s+(?:mejor|de\s+nuevo|otra\s+vez|eso|m[áa]s|otra\s+forma)|no\s+entend[íi](?:\s+nada)?|no\s+s[ée]|otra\s+vez|de\s+nuevo|m[áa]s|ampli[áa](?:me)?|profundiz[áa])\s*[.!?]*\s*$/i;

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
