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
import { nliVerify, splitSentences } from "@tutor-ia/rag";
import { chatStream, chatText, chatJSON, type ChatMsg } from "./client";
import { config } from "./config";
import {
  TUTOR_SYSTEM,
  ABSTENTION,
  buildTutorUserTurn,
  buildPresuppositionPrompt,
  buildFalsePremiseDirective,
} from "./prompts";
import { PRESUPPOSITION_SCHEMA } from "./schemas";
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
      subjectIds: req.subjectId ? [req.subjectId] : null,
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
    throw err; // error real (DB/embeddings/LLM): que la route lo maneje
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

export interface PremiseCheck {
  /** true → alguna presuposición de la pregunta es contradicha por el material. */
  falsePremise: boolean;
  /** La presuposición contradicha (la primera encontrada). */
  premise?: string;
  /** Prob. de contradiction del material contra esa premisa. */
  contradiction?: number;
}

/**
 * Detección de PREMISA FALSA (Fase 2, §4 — el peor fracaso del eval: el modelo
 * le seguía la corriente a premisas falsas el 100% de las veces). Extrae las
 * presuposiciones factuales de la pregunta (1 llamada al LLM) y chequea cada una
 * con NLI contra el material: si algún chunk la CONTRADICE, es premisa falsa.
 * Barato de más solo cuando la pregunta presupone hechos; las preguntas abiertas
 * dan lista vacía y no cuesta NLI.
 *
 * Fail-open: si el LLM o el NLI fallan, devuelve falsePremise=false (mejor
 * responder normal que bloquear por un error de la capa).
 */
export async function checkFalsePremise(
  question: string,
  chunkTexts: string[],
): Promise<PremiseCheck> {
  if (!config.enableFalsePremiseCheck || chunkTexts.length === 0) {
    return { falsePremise: false };
  }
  try {
    const { presupposes } = await chatJSON<{ presupposes: string[] }>(
      [{ role: "user", content: buildPresuppositionPrompt(question) }],
      PRESUPPOSITION_SCHEMA,
      { temperature: 0 },
    );
    // Premisas = ORACIONES de los chunks (NLI se diluye contra chunks largos).
    const premiseSents = chunkTexts
      .flatMap((c) => splitSentences(c))
      .map((s) => s.trim())
      .filter((s) => s.length >= 15);
    for (const premise of presupposes ?? []) {
      if (!premise || premise.trim().length < 8) continue;
      const v = await nliVerify(premise, premiseSents, 1.1, config.nliMinContra);
      if (v.contradicted) {
        return { falsePremise: true, premise, contradiction: v.contradiction };
      }
    }
  } catch {
    return { falsePremise: false }; // fail-open
  }
  return { falsePremise: false };
}

/**
 * Genera la respuesta del tutor en streaming (capas 2 y 3). El llamador debe
 * comprobar `ctx.grounded` antes: si es false, no llamar aquí y devolver
 * directamente abstentionText().
 */
export async function* streamTutorAnswer(
  req: TutorRequest,
  ctx: TutorContext,
  /** Si la pregunta trae una premisa falsa, la directiva de corrección a anteponer. */
  premiseWarning?: string,
): AsyncGenerator<string> {
  const context = formatRankedContext(ctx.chunks);
  const history: ChatMsg[] = (req.history ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let userTurn = buildTutorUserTurn(req.question, context);
  if (premiseWarning) userTurn = `${premiseWarning}\n\n${userTurn}`;
  const messages: ChatMsg[] = [
    { role: "system", content: TUTOR_SYSTEM },
    ...history,
    { role: "user", content: userTurn },
  ];
  yield* chatStream(messages);
}

export interface VerifierResult {
  grounded: boolean;
  /** Oraciones que el material CONTRADICE (alerta fuerte). */
  contradicted: string[];
  /** Oraciones sin respaldo (ni implicadas ni contradichas). */
  unsupported: string[];
  /** Cuántas oraciones sustantivas se verificaron (0 = nada que verificar). */
  checked?: number;
  /** true → el verificador no pudo correr: la respuesta queda NO verificada. */
  unavailable?: boolean;
}

/**
 * Capa 5 (A3, ACTIVA por defecto): verifica cada oración de la respuesta con NLI
 * direccional contra los chunks — determinista, sin LLM extra. Distingue oración
 * CONTRADICHA (alerta fuerte) de SIN RESPALDO (suave). RAG_ENABLE_VERIFIER=0 la
 * apaga. Ver verify.ts.
 */
export async function verifyAnswer(
  ctx: TutorContext,
  answer: string,
): Promise<VerifierResult> {
  if (!config.enableVerifier)
    return { grounded: true, contradicted: [], unsupported: [] };
  const v = await verifyAnswerA3(
    answer,
    ctx.chunks.map((c) => c.content),
  );
  return {
    grounded: v.grounded,
    contradicted: v.contradicted,
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
      verified: { grounded: true, contradicted: [], unsupported: [] },
    };
  }
  const premise = await checkFalsePremise(
    req.question,
    ctx.chunks.map((c) => c.content),
  );
  const warning = premise.falsePremise
    ? buildFalsePremiseDirective(premise.premise!)
    : "";
  const context = formatRankedContext(ctx.chunks);
  const text = await chatText([
    { role: "system", content: TUTOR_SYSTEM },
    {
      role: "user",
      content: warning
        ? `${warning}\n\n${buildTutorUserTurn(req.question, context)}`
        : buildTutorUserTurn(req.question, context),
    },
  ]);
  const verified = await verifyAnswer(ctx, text);
  return { text, ctx, verified };
}
