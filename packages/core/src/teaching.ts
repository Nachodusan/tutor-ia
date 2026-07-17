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
import { TEACHING_SYSTEM, ABSTENTION, buildTeachingTurn } from "./prompts";
import type { ChatMessage } from "./types";

export interface TeachRequest {
  userId: string;
  subjectId?: string | null;
  question: string;
  history?: ChatMessage[];
  /** true → el estudiante no entendió; el tutor debe cambiar de estrategia. */
  struggling?: boolean;
}

/** Etiquetas legibles de los tipos de pedagogía para el prompt. */
const TYPE_LABEL: Record<string, string> = {
  ideas_previas: "Activación de ideas previas",
  ambiente_aprendizaje: "Ambiente/actividad de aprendizaje",
  habilidad: "Habilidad a desarrollar",
  evaluacion: "Cómo evaluar la comprensión",
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
  return `${prevUser} ${req.question}`.trim();
}

/** Recupera el contexto de enseñanza (contenido + pedagogía) con gate. */
export async function getTeachingContext(req: TeachRequest): Promise<TeachingResult> {
  try {
    const ctx = await retrieveForTeaching(retrievalQuery(req), {
      userId: req.userId,
      subjectId: req.subjectId,
      minRerankScore: config.rerankMinScore,
    });
    return { ctx, grounded: ctx.grounded };
  } catch (err) {
    if (!(await rerankHealthy())) {
      return { ctx: null as unknown as TeachingContext, grounded: false, rerankerDown: true };
    }
    throw err;
  }
}

export function teachingAbstention(): string {
  return ABSTENTION;
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
