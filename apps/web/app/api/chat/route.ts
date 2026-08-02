import {
  getTeachingContext,
  streamTeaching,
  teachingAbstention,
  teachingCitations,
  socialReply,
  needsTopicReply,
  verifyAnswerA3,
  RERANKER_DOWN,
  isStruggling,
  config,
  logDecision,
  looksLikeSelfAbstention,
} from "@tutor-ia/core";
import { requireUser, unauthorized } from "@/lib/auth";
import { ensureSession, insertMessage } from "@/lib/conversations";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
// Generación del 7B (con recarga por keep_alive:0) + verificación NLI puede
// superar los 60s en respuestas largas.
export const maxDuration = 120;

/** `ctx.pedagogy` viene AGRUPADO por tipo (proposito, evaluacion, …), no plano. */
const RETRIEVAL_ERROR_MSG =
  "Uf, tuve un problemita para traer tu material (a veces el buscador se satura). Probá de nuevo en un momento, o reformulá el tema. 🙏";

const countPedagogy = (p: Record<string, unknown[]> | null | undefined): number =>
  p ? Object.values(p).reduce((n, arr) => n + (arr?.length ?? 0), 0) : 0;
// STRUGGLE_RE / isStruggling viven en core: el golden set tiene que activar la
// MISMA rama adaptativa del prompt que activa el chat.

/**
 * POST /api/chat — tutor FACILITADOR (Plan v3).
 * body: { question, subjectId?, history? }
 *
 * Stream de texto plano con 3 partes (protocolo de frames):
 *  - Frame inicial "\x1e{citations, grounded}\n"
 *  - Cuerpo: la explicación del facilitador token a token.
 *  - Frame final "\x1e{verification}\n" — verificación NLI por oración.
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const userId = auth.userId;
  const body = (await req.json()) as {
    question?: string;
    subjectId?: string | null;
    subjectName?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
    unit?: number | null;
    lesson?: number | null;
    /** Conversación a la que pertenece este turno. La primera vez no viene: la
     *  ruta la genera y la devuelve en el frame de citas. */
    sessionId?: string | null;
  };
  if (!body.question?.trim()) {
    return new Response("Falta 'question'.", { status: 400 });
  }
  // El id se genera acá y NO se espera a la base: el insert corre en paralelo
  // con el retrieval.
  const sessionId = body.sessionId ?? randomUUID();
  const persistUsuario = ensureSession(sessionId, userId, body.subjectId ?? null, body.question.slice(0, 80))
    .then(() => insertMessage(sessionId, "user", body.question!));

  // Mensaje social (saludo, gracias, chau) o pedido VAGO sin tema ("dame un
  // ejemplo" como primer mensaje): responder conversacional, sin gate ni
  // abstención. Evita el "Fuera de tu material" cuando el retrieval no tiene
  // de qué agarrarse.
  // Se evalúan por separado SOLO para poder distinguirlos en el log: el `??`
  // colapsaba las dos causas en una y no se podía saber cuál de los dos regex
  // se estaba comiendo preguntas reales. Misma semántica que antes.
  const hasContext = (body.history?.length ?? 0) > 0;
  const social = socialReply(body.question, body.subjectName ?? undefined, hasContext);
  const vague = social
    ? null
    : needsTopicReply(body.question, hasContext, body.subjectName ?? undefined);
  const conversational = social ?? vague;
  if (conversational) {
    logDecision({
      route: "chat",
      abstained: true,
      cause: social ? "social" : "vague",
      chars: conversational.length,
      ms: Date.now() - t0,
    });
    const enc = new TextEncoder();
    const s = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("\x1e" + JSON.stringify({ citations: [], grounded: true, sessionId }) + "\n"));
        controller.enqueue(enc.encode(conversational));
        // Un saludo también es parte de la conversación: si no se guarda, el
        // historial que el alumno recupere va a tener huecos.
        void persistUsuario.then(() =>
          insertMessage(sessionId, "assistant", conversational, {
            grounded: true, meta: { cause: social ? "social" : "vague" },
          }),
        );
        controller.close();
      },
    });
    return new Response(s, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
  }

  const teachReq = {
    userId,
    subjectId: body.subjectId ?? null,
    question: body.question,
    history: body.history ?? [],
    struggling: isStruggling(body.question),
    unit: body.unit ?? null,
    lesson: body.lesson ?? null,
  };

  let res;
  try {
    res = await getTeachingContext(teachReq);
  } catch {
    // Fallo de retrieval (p. ej. reranker ocupado/timeout): NO dejamos la
    // burbuja vacía; respondemos con un mensaje amable y reintentable.
    logDecision({
      route: "chat",
      abstained: true,
      cause: "retrieval_error",
      directed: teachReq.unit != null,
      ms: Date.now() - t0,
    });
    const enc = new TextEncoder();
    const s = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("\x1e" + JSON.stringify({ citations: [], grounded: true, sessionId }) + "\n"));
        void persistUsuario.then(() =>
          insertMessage(sessionId, "assistant", RETRIEVAL_ERROR_MSG, {
            grounded: false, meta: { cause: "retrieval_error" },
          }),
        );
        controller.enqueue(enc.encode(RETRIEVAL_ERROR_MSG));
        controller.close();
      },
    });
    return new Response(s, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 1) Frame de citas + si está fundamentado.
      const citations = res.grounded ? teachingCitations(res.ctx) : [];
      controller.enqueue(
        encoder.encode("\x1e" + JSON.stringify({ citations, grounded: res.grounded, sessionId }) + "\n"),
      );
      try {
        // Anti-alucinación (capa 1): sin material (ni TE ni GDD) → abstención,
        // sin llamar al modelo.
        if (!res.grounded) {
          const textoAbstencion = res.rerankerDown ? RERANKER_DOWN : teachingAbstention();
          controller.enqueue(encoder.encode(textoAbstencion));
          void persistUsuario.then(() =>
            insertMessage(sessionId, "assistant", textoAbstencion, {
              grounded: false,
              meta: { cause: res.rerankerDown ? "reranker_down" : "gate", topScore: res.ctx?.topScore ?? null },
            }),
          );
          // El gate cortó. `topScore` existe aun sin material: es el mejor
          // candidato que NO llegó al umbral — sirve para ver si quedó cerca
          // (0.16 vs 0.18 = umbral mal calibrado) o lejísimos (0.002 = la
          // materia no tiene material, causa completamente distinta).
          logDecision({
            route: "chat",
            abstained: true,
            cause: res.rerankerDown ? "reranker_down" : "gate",
            topScore: res.ctx?.topScore ?? null,
            threshold: config.rerankMinScore,
            citableSource: res.ctx?.citableSource ?? null,
            nCitable: res.ctx?.citable?.length ?? 0,
            nPedagogy: countPedagogy(res.ctx?.pedagogy as never),
            directed: teachReq.unit != null,
            gateBypassed: res.ctx?.gateBypassed,
            nDense: res.ctx?.stats?.nDense ?? null,
            nLexical: res.ctx?.stats?.nLexical ?? null,
            lexEmpty: res.ctx?.stats?.lexEmpty,
            nCand: res.ctx?.stats?.nFused ?? null,
            pool: res.ctx?.stats?.poolPerSide ?? null,
            ranker: res.ctx?.stats?.ranker ?? null,
            winnerDenseRank: res.ctx?.stats?.winnerDenseRank ?? null,
            qNorm: res.qNorm,
            qNormMs: res.qNormMs ?? null,
            gateVia: res.ctx?.stats?.gateVia ?? null,
            gapMed: res.ctx?.stats?.gapMed ?? null,
            ms: Date.now() - t0,
          });
        } else {
          // 2) Explicación del facilitador (el prompt lleva el flujo + adaptatividad).
          let full = "";
          for await (const chunk of streamTeaching(teachReq, res.ctx)) {
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          // 3) Verificación NLI por oración contra el material citable (capa 5).
          const v = await verifyAnswerA3(full, res.ctx.citable.map((c) => c.content));
          controller.enqueue(
            encoder.encode("\n\x1e" + JSON.stringify({ verification: v }) + "\n"),
          );
          // TUVO material y llamó al modelo. `selfAbstain` es la señal decisiva:
          // si sale true, el gate hizo bien su trabajo y el que se abstuvo fue
          // el PROMPT. Es lo único que separa "umbral mal calibrado" de
          // "instrucciones demasiado defensivas".
          logDecision({
            route: "chat",
            abstained: false,
            cause: "answered",
            topScore: res.ctx.topScore ?? null,
            threshold: config.rerankMinScore,
            citableSource: res.ctx.citableSource ?? null,
            nCitable: res.ctx.citable.length,
            nPedagogy: countPedagogy(res.ctx.pedagogy as never),
            directed: teachReq.unit != null,
            gateBypassed: res.ctx.gateBypassed,
            nDense: res.ctx.stats?.nDense ?? null,
            nLexical: res.ctx.stats?.nLexical ?? null,
            lexEmpty: res.ctx.stats?.lexEmpty,
            nCand: res.ctx.stats?.nFused ?? null,
            pool: res.ctx.stats?.poolPerSide ?? null,
            ranker: res.ctx.stats?.ranker ?? null,
            winnerDenseRank: res.ctx.stats?.winnerDenseRank ?? null,
            qNorm: res.qNorm,
            qNormMs: res.qNormMs ?? null,
            gateVia: res.ctx.stats?.gateVia ?? null,
            gapMed: res.ctx.stats?.gapMed ?? null,
            selfAbstain: looksLikeSelfAbstention(full),
            drift: v?.grounded === false,
            nliUnavailable: v?.unavailable === true,
            nliChecked: v?.checked ?? null,
            chars: full.length,
            ms: Date.now() - t0,
          });
          // Con AWAIT a propósito: acá el último token YA salió al cliente (el
          // alumno terminó de leer), así que ~1 ms de INSERT sobre una respuesta
          // de 10-60 s es latencia percibida CERO y a cambio la escritura queda
          // garantizada. Fire-and-forget después de close() se arriesga a que el
          // proceso corte la promesa.
          await persistUsuario;
          await insertMessage(sessionId, "assistant", full, {
            citations, grounded: res.grounded, verification: v,
            meta: {
              cause: "answered", topScore: res.ctx.topScore ?? null,
              ranker: res.ctx.stats?.ranker ?? null, qNorm: res.qNorm,
              gateVia: res.ctx.stats?.gateVia ?? null, ms: Date.now() - t0,
            },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error del modelo";
        controller.enqueue(encoder.encode(`\n[error] ${msg}`));
        logDecision({
          route: "chat",
          abstained: true,
          cause: "model_error",
          directed: teachReq.unit != null,
          ms: Date.now() - t0,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
