import {
  getTeachingContext,
  streamTeaching,
  teachingAbstention,
  teachingCitations,
  socialReply,
  verifyAnswerA3,
  RERANKER_DOWN,
} from "@tutor-ia/core";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
// Generación del 7B (con recarga por keep_alive:0) + verificación NLI puede
// superar los 60s en respuestas largas.
export const maxDuration = 120;

// El estudiante señala que no entendió → el tutor cambia de estrategia.
const STRUGGLE_RE =
  /no (lo |la )?entend|no s[ée]\b|m[áa]s f[áa]cil|otra vez|otra forma|de nuevo|no me qued[óo] claro|no capt|no entiendo|repet[íi]|explic[áa].*(otra|de nuevo)/i;

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
  const userId = await getCurrentUserId(req);
  const body = (await req.json()) as {
    question?: string;
    subjectId?: string | null;
    subjectName?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  if (!body.question?.trim()) {
    return new Response("Falta 'question'.", { status: 400 });
  }

  // Mensaje social (saludo, gracias, chau): responder conversacional, sin gate.
  const social = socialReply(body.question, body.subjectName ?? undefined);
  if (social) {
    const enc = new TextEncoder();
    const s = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("\x1e" + JSON.stringify({ citations: [], grounded: true }) + "\n"));
        controller.enqueue(enc.encode(social));
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
    struggling: STRUGGLE_RE.test(body.question),
  };

  let res;
  try {
    res = await getTeachingContext(teachReq);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error recuperando contexto";
    return new Response(msg, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 1) Frame de citas + si está fundamentado.
      const citations = res.grounded ? teachingCitations(res.ctx) : [];
      controller.enqueue(
        encoder.encode("\x1e" + JSON.stringify({ citations, grounded: res.grounded }) + "\n"),
      );
      try {
        // Anti-alucinación (capa 1): sin material (ni TE ni GDD) → abstención,
        // sin llamar al modelo.
        if (!res.grounded) {
          controller.enqueue(
            encoder.encode(res.rerankerDown ? RERANKER_DOWN : teachingAbstention()),
          );
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
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error del modelo";
        controller.enqueue(encoder.encode(`\n[error] ${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
