/**
 * Chat de estudio en MODO LOCAL + ESTRICTO.
 *
 * Capas anti-alucinación aplicadas aquí:
 *  1) Retrieval gating: descartamos fragmentos por debajo del umbral de
 *     similitud; si no queda ninguno, la IA se ABSTIENE (sin llamar al modelo).
 *  2) Prompt estricto (ver prompts.ts) que obliga a citar y a abstenerse.
 *  3) Decodificación conservadora (temperatura baja, ver config.ts).
 *  4) Citas devueltas a la UI para que el estudiante verifique.
 *  5) Verificador A3 post-respuesta (verify.ts) — ACTIVO por defecto; cada
 *     oración se comprueba por entailment contra el material (Fase 2).
 */
import {
  retrieveRanked,
  rerankHealthy,
  citationLabel,
  type RankedChunk,
} from "@tutor-ia/rag";
import { chatStream, chatText, type ChatMsg } from "./client";
import { config } from "./config";
import { TUTOR_SYSTEM, ABSTENTION, buildTutorUserTurn } from "./prompts";
import { verifyAnswerA3 } from "./verify";
import type { ChatMessage, Citation } from "./types";

/** Formatea los fragmentos rankeados como contexto citable ("[Fragmento 1 — pág. 87 · …]"). */
function formatRankedContext(chunks: RankedChunk[]): string {
  return chunks
    .map((c, i) => `[Fragmento ${i + 1} — ${citationLabel(c)}]\n${c.content}`)
    .join("\n\n");
}

export interface TutorRequest {
  userId: string;
  subjectId?: string | null;
  question: string;
  history?: ChatMessage[];
}

export interface TutorContext {
  chunks: RankedChunk[];
  citations: Citation[];
  /** false => ningún fragmento superó el umbral del reranker; abstenerse. */
  grounded: boolean;
  /** Mejor score del reranker (0-1) — la señal del gate. */
  topScore: number;
  /** true => el reranker (el gate) no respondió: se degradó a abstención. */
  rerankerDown?: boolean;
}

/** Mensaje cuando el reranker (el gate de groundedness) no está disponible. */
export const RERANKER_DOWN =
  "No puedo verificar tu material ahora mismo (el buscador no está disponible). Para no arriesgarme a inventar, prefiero no responder. Revisá que el servicio de búsqueda esté activo e intentá de nuevo.";

/**
 * Recupera contexto con el pipeline completo (híbrido denso+léxico+RRF → reranker
 * cross-encoder) y aplica el GATE DE ABSTENCIÓN sobre el score del reranker
 * (capa A1). Devuelve grounded=false si el mejor fragmento no supera el umbral.
 *
 * Si el reranker (el gate) no responde, degrada a ABSTENCIÓN SEGURA en vez de
 * propagar el error: sin el gate no podemos medir groundedness, así que responder
 * sería arriesgar una alucinación. Un error de DB/embeddings sí se propaga.
 */
export async function getTutorContext(
  req: TutorRequest,
): Promise<TutorContext> {
  let res;
  try {
    res = await retrieveRanked(req.question, {
      userId: req.userId,
      subjectId: req.subjectId,
      k: 8,
      minRerankScore: config.rerankMinScore,
    });
  } catch (err) {
    if (!(await rerankHealthy())) {
      return {
        chunks: [],
        citations: [],
        grounded: false,
        topScore: 0,
        rerankerDown: true,
      };
    }
    throw err; // error real (DB/embeddings/Ollama): que la route lo maneje
  }

  // Si nos abstenemos, no citamos fragmentos bajo el umbral: citas vacías.
  if (!res.grounded) {
    return { chunks: [], citations: [], grounded: false, topScore: res.topScore };
  }

  const citations: Citation[] = res.chunks.map((c, i) => ({
    index: i + 1,
    documentId: c.documentId,
    chunkId: c.chunkId,
    page: c.pageStart,
    headingPath: c.headingPath,
    score: c.rerankScore,
  }));
  return {
    chunks: res.chunks,
    citations,
    grounded: true,
    topScore: res.topScore,
  };
}

/** La frase de abstención, expuesta para que la route la use sin llamar al modelo. */
export function abstentionText(): string {
  return ABSTENTION;
}

/**
 * Genera la respuesta del tutor en streaming (capas 2 y 3). El llamador debe
 * comprobar `ctx.grounded` antes: si es false, no llamar aquí y devolver
 * directamente abstentionText().
 */
export async function* streamTutorAnswer(
  req: TutorRequest,
  ctx: TutorContext,
): AsyncGenerator<string> {
  const context = formatRankedContext(ctx.chunks);
  const history: ChatMsg[] = (req.history ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const messages: ChatMsg[] = [
    { role: "system", content: TUTOR_SYSTEM },
    ...history,
    { role: "user", content: buildTutorUserTurn(req.question, context) },
  ];
  yield* chatStream(messages);
}

export interface VerifierResult {
  grounded: boolean;
  unsupported: string[];
  /** Cuántas oraciones sustantivas se verificaron (0 = nada que verificar). */
  checked?: number;
  /** true → el verificador no pudo correr: la respuesta queda NO verificada. */
  unavailable?: boolean;
}

/**
 * Capa 5 (A3, ACTIVA por defecto): verifica cada oración de la respuesta por
 * entailment contra los chunks del contexto — determinista, sin LLM extra
 * (~100ms/oración). RAG_ENABLE_VERIFIER=0 la apaga. Ver verify.ts.
 */
export async function verifyAnswer(
  ctx: TutorContext,
  answer: string,
): Promise<VerifierResult> {
  if (!config.enableVerifier) return { grounded: true, unsupported: [] };
  const v = await verifyAnswerA3(
    answer,
    ctx.chunks.map((c) => c.content),
  );
  return {
    grounded: v.grounded,
    unsupported: v.unsupported,
    checked: v.checked,
    unavailable: v.unavailable,
  };
}

/** Variante no-streaming que integra el verificador; útil para el modo voz. */
export async function answerWithVerification(
  req: TutorRequest,
): Promise<{ text: string; ctx: TutorContext; verified: VerifierResult }> {
  const ctx = await getTutorContext(req);
  if (!ctx.grounded) {
    return {
      text: ABSTENTION,
      ctx,
      verified: { grounded: true, unsupported: [] },
    };
  }
  const context = formatRankedContext(ctx.chunks);
  const text = await chatText([
    { role: "system", content: TUTOR_SYSTEM },
    { role: "user", content: buildTutorUserTurn(req.question, context) },
  ]);
  const verified = await verifyAnswer(ctx, text);
  return { text, ctx, verified };
}
