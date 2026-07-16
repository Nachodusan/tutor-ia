import {
  getTutorContext,
  streamTutorAnswer,
  abstentionText,
  RERANKER_DOWN,
} from "@tutor-ia/core";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/chat
 * body: { question: string, subjectId?: string, history?: {role, content}[] }
 *
 * Respuesta: stream de texto plano. La primera línea es un JSON con las citas,
 * prefijado con "\x1e" (record separator); el resto es la respuesta en vivo.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId(req);
  const body = (await req.json()) as {
    question?: string;
    subjectId?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!body.question?.trim()) {
    return new Response("Falta 'question'.", { status: 400 });
  }

  const tutorReq = {
    userId,
    subjectId: body.subjectId ?? null,
    question: body.question,
    history: body.history ?? [],
  };

  let ctx;
  try {
    ctx = await getTutorContext(tutorReq);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error recuperando contexto";
    return new Response(msg, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 1) Enviar metadatos primero (citas + si está "fundamentado").
      controller.enqueue(
        encoder.encode(
          "\x1e" +
            JSON.stringify({
              citations: ctx.citations,
              grounded: ctx.grounded,
            }) +
            "\n",
        ),
      );
      try {
        // Anti-alucinación (capa 1): sin material relevante -> abstención,
        // sin siquiera llamar al modelo. No puede inventar lo que no ejecuta.
        if (!ctx.grounded) {
          controller.enqueue(
            encoder.encode(ctx.rerankerDown ? RERANKER_DOWN : abstentionText()),
          );
        } else {
          // 2) Reenviar el texto del modelo local token a token.
          for await (const chunk of streamTutorAnswer(tutorReq, ctx)) {
            controller.enqueue(encoder.encode(chunk));
          }
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
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
