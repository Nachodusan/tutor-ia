import {
  getTeachingContext,
  streamTeachingChecked,
  teachingAbstention,
  teachingCitations,
  teachingCitationsConTexto,
  socialReply,
  needsTopicReply,
  verifyAnswerA3, derivarModo,
  RERANKER_DOWN,
  isStruggling,
  config,
  logDecision,
  looksLikeSelfAbstention,
} from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { requireCursoAbierto } from "@/lib/auth";
import { ensureSession, insertMessage } from "@/lib/conversations";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
// Generación del 7B (con recarga por keep_alive:0) + verificación NLI puede
// superar los 60s en respuestas largas.
export const maxDuration = 120;

/** `ctx.pedagogy` viene AGRUPADO por tipo (proposito, evaluacion, …), no plano. */
const RETRIEVAL_ERROR_MSG =
  "Uf, tuve un problemita para traer tu material (a veces el buscador se satura). Probá de nuevo en un momento, o reformulá el tema. 🙏";

/** Fallo del modelo a mitad de respuesta. El error real va al log del server. */
const MODEL_ERROR_MSG =
  "\nUf, se me trabó la respuesta a mitad de camino. No es culpa tuya: probá mandar el mensaje de nuevo en un momento.";

const countPedagogy = (p: Record<string, unknown[]> | null | undefined): number =>
  p ? Object.values(p).reduce((n, arr) => n + (arr?.length ?? 0), 0) : 0;

/**
 * EL PRIMER TEMA QUE LE FALTA DEL PLAN, por nombre.
 *
 * Es la respuesta a "el alumno no tiene dónde empezar". Antes, a un "hola" se le
 * contestaba "¿qué tema querés que te explique?" — devolverle el problema a
 * alguien que abrió la app justamente porque no sabe por dónde arrancar. Y si
 * escribía algo sin tema, el turno llegaba al modelo sin material y el modelo
 * INVENTABA un tema (en Biología ofreció conjugar verbos en pasado).
 *
 * Sale del plan de SU materia, que es el índice real de su libro. Si la materia
 * todavía no tiene plan armado, devuelve null y el saludo queda como antes.
 */
async function primerTemaPendiente(subjectId: string | null, userId: string): Promise<string | null> {
  if (!subjectId) return null;
  try {
    const sql = getSql();
    const [plan, hechos] = await Promise.all([
      sql<{ items: { key: string; title: string }[] }[]>`
        select items from subject_plans where subject_id = ${subjectId}::uuid`,
      sql<{ topic_key: string }[]>`
        select topic_key from student_plan_progress
        where user_id = ${userId}::uuid and subject_id = ${subjectId}::uuid`,
    ]);
    const items = plan[0]?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) return null;
    const listos = new Set(hechos.map((h) => h.topic_key));
    // El primero sin hacer; si ya hizo todos, el primero del plan para repasar.
    const proximo = items.find((i) => i?.key && !listos.has(i.key)) ?? items[0];
    return proximo?.title?.trim() || null;
  } catch (e) {
    // Sin plan no hay propuesta, pero el saludo tiene que salir igual.
    console.error(`[chat] primerTemaPendiente: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
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
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
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
  // El primer tema PENDIENTE del plan de la materia. Solo hace falta cuando no
  // hay conversación: es el caso del chico que abre el chat y saluda.
  const primerTema = hasContext ? null : await primerTemaPendiente(body.subjectId ?? null, userId);
  const social = socialReply(body.question, body.subjectName ?? undefined, hasContext, primerTema);
  const vague = social
    ? null
    : needsTopicReply(body.question, hasContext, body.subjectName ?? undefined, primerTema);
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

  // El curso del alumno se lee DESDE LA BASE, nunca del cliente: define el nivel
  // de lenguaje con que se le habla a un menor, y eso no puede depender de lo
  // que mande el navegador. Va en paralelo con el retrieval (lookup por PK).
  const perfil = getSql()<{ grade: string | null }[]>`
    select grade from student_profiles where user_id = ${userId}::uuid`;

  // El NOMBRE de la materia, de la base y no de `body.subjectName`. Lo usa el
  // puente de vocabulario para saber en qué libro traducir la palabra del
  // alumno, y vale el mismo criterio que el curso: lo que decide con qué
  // material se le responde a un menor no lo manda el navegador.
  const materia = body.subjectId
    ? getSql()<{ name: string }[]>`
        select name from subjects where id = ${body.subjectId}::uuid`
    : Promise.resolve([] as { name: string }[]);

  // Las materias de la MISMA asignatura en todos los cursos (etapa 1 de la
  // cascada de alcance). Se resuelve por `subjects.family`, que es explícito y
  // materializado — NO por `documents.subject_area`, que tiene la misma materia
  // escrita de dos formas ("ingles" e "inglés" conviven en Inglés 1º Medio).
  // Las materias en pausa quedan afuera del alcance ampliado.
  const familia = body.subjectId
    ? getSql()<{ id: string }[]>`
        select s2.id
        from subjects s1
        join subjects s2 on s2.family = s1.family
        where s1.id = ${body.subjectId}::uuid
          and s1.family is not null
          and s2.disabled_at is null
          and (s2.user_id is null or s2.user_id = ${userId}::uuid)`
    : Promise.resolve([] as { id: string }[]);

  const teachReq = {
    userId,
    subjectId: body.subjectId ?? null,
    question: body.question,
    history: body.history ?? [],
    struggling: isStruggling(body.question),
    unit: body.unit ?? null,
    lesson: body.lesson ?? null,
    studentGrade: null as string | null,
    subjectName: null as string | null,
    familyIds: null as string[] | null,
    primerTema,
  };

  let res;
  try {
    // El perfil y la familia se resuelven ANTES del retrieval porque los dos
    // entran en él (nivel de lectura y etapa 1 de la cascada). Son dos lookups
    // por índice: ~1 ms contra un retrieval de segundos.
    const [filas, fam, mat] = await Promise.all([
      perfil.catch(() => [] as { grade: string | null }[]),
      familia.catch(() => [] as { id: string }[]),
      materia.catch(() => [] as { name: string }[]),
    ]);
    teachReq.studentGrade = filas[0]?.grade ?? null;
    teachReq.familyIds = fam.length ? fam.map((r) => r.id) : null;
    teachReq.subjectName = mat[0]?.name ?? null;
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
      // 1) Frame de citas + modo. `grounded` viaja para compatibilidad del
      //    cliente viejo; el dato que importa ahora es `mode`.
      const hayMaterial = (res.ctx?.citable.length ?? 0) > 0;
      // DOS formas de la misma cita, a propósito:
      //  · `citations` → al CLIENTE: liviana, solo la etiqueta legible.
      //  · `citasParaGuardar` → a la BASE: incluye el TEXTO del chunk, porque el
      //    uuid no sobrevive a una re-ingesta y sin el texto la respuesta queda
      //    citando algo que ya no se puede mostrar (pasó: 6 de 200 vínculos).
      const citations = hayMaterial ? teachingCitations(res.ctx!) : [];
      const citasParaGuardar = hayMaterial ? teachingCitationsConTexto(res.ctx!) : [];
      controller.enqueue(
        encoder.encode("\x1e" + JSON.stringify({
          citations, grounded: hayMaterial,
          mode: !hayMaterial ? "general" : res.ctx?.parcial ? "apoyado" : "libro",
          scope: res.ctx?.scope ?? "ninguno", sessionId,
        }) + "\n"),
      );
      try {
        // LAS ÚNICAS NEGATIVAS QUE QUEDAN son de INFRAESTRUCTURA.
        //
        // Acá había un `if (!res.grounded)` que devolvía una frase fija sin
        // llegar a llamar al modelo: si ningún fragmento superaba 0.18, el chico
        // recibía "eso no lo encuentro en tu material". Eso era la app diciéndole
        // que no a alguien sentado a estudiar, y es lo que este cambio elimina.
        //
        // Pero "dejar de negarse" NO es "responder aunque el sistema esté roto":
        // con el reranker caído no sabemos si hay material o no, y contestar con
        // conocimiento general en ese estado convierte el producto en un chatbot
        // genérico sin que nadie se entere. Por eso estas dos sobreviven.
        // Se puede volver al comportamiento anterior con CHAT_ALWAYS_ANSWER=0.
        const siempreResponder = process.env.CHAT_ALWAYS_ANSWER !== "0";
        if (res.rerankerDown || (!siempreResponder && !res.grounded)) {
          const textoAbstencion = res.rerankerDown ? RERANKER_DOWN : teachingAbstention();
          controller.enqueue(encoder.encode(textoAbstencion));
          void persistUsuario.then(() =>
            insertMessage(sessionId, "assistant", textoAbstencion, {
              grounded: false,
              meta: { cause: res.rerankerDown ? "reranker_down" : "gate", topScore: res.ctx?.topScore ?? null },
            }),
          );
          logDecision({
            route: "chat",
            abstained: true,
            cause: res.rerankerDown ? "reranker_down" : "gate",
            topScore: res.ctx?.topScore ?? null,
            threshold: config.rerankMinScore,
            citableSource: res.ctx?.citableSource ?? null,
            nCitable: res.ctx?.citable?.length ?? 0,
            nRetrieved: res.ctx?.retrieved?.length ?? null,
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
            answEntail: res.ctx?.answerabilityEntail ?? null,
            ms: Date.now() - t0,
          });
        } else {
          // 2) Explicación del facilitador (el prompt lleva el flujo + adaptatividad).
          //    La PREGUNTA DE CIERRE se valida antes de que salga: si se responde
          //    copiando el propio mensaje, se reemplaza (ver closing-question.ts).
          let full = "";
          let cierre: { checked: boolean; replaced: boolean } | null = null;
          for await (const chunk of streamTeachingChecked(teachReq, res.ctx, (c) => { cierre = c; })) {
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          // 3) Verificación NLI por oración contra el material citable (capa 5).
          //    Sin material no hay contra qué verificar y se saltea: correrla
          //    devolvería "todo sin respaldo", que es cierto y no dice nada.
          const v = hayMaterial
            ? await verifyAnswerA3(full, res.ctx!.citable.map((c) => c.content))
            : null;
          // `v.grounded === false` es la DERIVA (la señal calibrada), NO "sin
          // respaldo por oración" — ver derivarModo().
          const { mode, supportedFrac } = derivarModo(
            v?.verdicts ?? [], hayMaterial, v?.grounded === false,
            res.ctx.parcial === true,
          );
          controller.enqueue(
            encoder.encode("\n\x1e" + JSON.stringify({ verification: v, mode, scope: res.ctx!.scope }) + "\n"),
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
            answEntail: res.ctx.answerabilityEntail ?? null,
            parcial: res.ctx.parcial === true,
            selfAbstain: looksLikeSelfAbstention(full),
            // Cuánto dispara el validador de la pregunta de cierre en producción.
            cierreChecked: (cierre as { checked: boolean } | null)?.checked ?? false,
            cierreReplaced: (cierre as { replaced: boolean } | null)?.replaced ?? false,
            drift: v?.grounded === false,
            nliUnavailable: v?.unavailable === true,
            nliChecked: v?.checked ?? null,
            mode, supportedFrac, scope: res.ctx.scope ?? null,
            nRetrieved: res.ctx.retrieved?.length ?? null,
            chars: full.length,
            ms: Date.now() - t0,
          });
          // REGISTRO DE HUECOS DE MATERIAL: si la respuesta no salió del libro
          // del curso del alumno, queda anotado para decidir con demanda real
          // qué material conseguir. Sin user_id (el hueco es del corpus, no del
          // alumno); ver packages/db/schema_content_gaps.sql.
          if ((res.ctx?.scope ?? "curso") !== "curso") {
            void getSql()`
              insert into content_gaps (subject_id, grade, question, scope, mode, top_score)
              values (${body.subjectId ?? null}::uuid, ${teachReq.studentGrade},
                      ${body.question!.slice(0, 200)}, ${res.ctx?.scope ?? "ninguno"},
                      ${mode}, ${res.ctx?.topScore ?? null})
            `.catch((e) => console.error(`[chat] content_gaps: ${e}`));
          }
          // Con AWAIT a propósito: acá el último token YA salió al cliente (el
          // alumno terminó de leer), así que ~1 ms de INSERT sobre una respuesta
          // de 10-60 s es latencia percibida CERO y a cambio la escritura queda
          // garantizada. Fire-and-forget después de close() se arriesga a que el
          // proceso corte la promesa.
          await persistUsuario;
          await insertMessage(sessionId, "assistant", full, {
            citations: citasParaGuardar, grounded: res.grounded, verification: v,
            meta: {
              cause: "answered", topScore: res.ctx.topScore ?? null,
              ranker: res.ctx.stats?.ranker ?? null, qNorm: res.qNorm,
              gateVia: res.ctx.stats?.gateVia ?? null,
              mode, supportedFrac, scope: res.ctx.scope ?? null, ms: Date.now() - t0,
            },
          });
        }
      } catch (err) {
        // El error crudo del proveedor ("Request was aborted.", un 429 con JSON
        // adentro) NO va a la burbuja de un chico: se loguea en el server y el
        // alumno recibe una frase amable y reintentable.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[chat] model_error: ${msg}`);
        controller.enqueue(encoder.encode(MODEL_ERROR_MSG));
        // El turno fallado también se guarda: sin esto, el historial que el
        // alumno recupere tendría su pregunta sin ninguna respuesta.
        void persistUsuario.then(() =>
          insertMessage(sessionId, "assistant", MODEL_ERROR_MSG.trim(), {
            grounded: false, meta: { cause: "model_error" },
          }),
        );
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
