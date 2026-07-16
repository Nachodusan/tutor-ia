import {
  getTutorContext,
  streamTutorAnswer,
  verifyAnswer,
  checkFalsePremise,
  buildFalsePremiseDirective,
  abstentionText,
  RERANKER_DOWN,
} from "@tutor-ia/core";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
// La generación del 7B (con recarga por keep_alive:0) + verificación A3 puede
// superar los 60s en respuestas largas.
export const maxDuration = 120;

/**
 * POST /api/chat
 * body: { question: string, subjectId?: string, history?: {role, content}[] }
 *
 * Respuesta: stream de texto plano.
 *  - Primera línea: JSON con citas + grounded, prefijado con "\x1e".
 *  - Cuerpo: la respuesta del modelo token a token.
 *  - Última línea: JSON {verification} prefijado con "\x1e" — el verificador A3
 *    (Fase 2) comprueba cada oración por entailment contra el material.
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
          // 1.5) ¿La pregunta trae una premisa que el material contradice? Si sí,
          //      le ordenamos al tutor corregirla en vez de seguirle la corriente
          //      (era el peor fracaso del eval: false_premise).
          const premise = await checkFalsePremise(
            tutorReq.question,
            ctx.chunks.map((c) => c.content),
          );
          const warning = premise.falsePremise
            ? buildFalsePremiseDirective(premise.premise!)
            : undefined;
          // 2) Reenviar el texto del modelo local token a token.
          let full = "";
          for await (const chunk of streamTutorAnswer(tutorReq, ctx, warning)) {
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          // 3) Verificación A3 post-respuesta (capa 5): cada oración contra el
          //    material. Se emite como frame final para que la UI marque lo no
          //    respaldado — el diferenciador "no alucina" EN el producto.
          const verification = await verifyAnswer(ctx, full);
          controller.enqueue(
            encoder.encode("\n\x1e" + JSON.stringify({ verification }) + "\n"),
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
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
