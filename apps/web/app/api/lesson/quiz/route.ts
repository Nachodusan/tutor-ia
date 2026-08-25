import { generarPreguntas, SinPreguntas, type QuizItem } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { documentoDeTema, fetchLessonMaterial } from "@tutor-ia/rag";
import { requireCursoAbierto } from "@/lib/auth";

export const runtime = "nodejs";
// Generar + verificar la clave son dos llamadas al modelo remoto.
export const maxDuration = 180;

/**
 * POST /api/lesson/quiz — las 10 preguntas de chequeo de UNA lección del camino.
 * body: { subjectId, topicKey, title?, unit?, lesson?, p0?, p1? }
 *
 * CACHEADAS Y COMPARTIDAS: son las mismas para todos los alumnos de la materia,
 * así que se generan una vez (el primero que abre la lección paga la espera) y
 * quedan en `lesson_quizzes`. Sin esto, cada chico que abre una lección
 * dispararía dos llamadas al modelo para producir las mismas preguntas.
 *
 * LA CLAVE NO VIAJA. `lesson_quizzes.items` guarda `correct` y `explain`; acá se
 * sacan antes de responder y la corrección la hace /api/lesson/quiz/submit
 * contra la fila. La verificación a ciegas de la clave la hace `generarPreguntas`
 * en core — el mismo código que usa la simulación de prueba, a propósito: es la
 * parte donde una divergencia castiga al alumno que estudió.
 */
export async function POST(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const body = (await req.json().catch(() => ({}))) as {
    subjectId?: string;
    topicKey?: string;
    title?: string;
    unit?: number | null;
    lesson?: number | null;
    p0?: number | null;
    p1?: number | null;
  };
  const { subjectId, topicKey } = body;
  if (!subjectId || !topicKey) {
    return Response.json({ error: "Faltan subjectId o topicKey" }, { status: 400 });
  }

  const sql = getSql();
  // El material del currículo es global (user_id null), pero la guarda importa:
  // el día que un colegio suba libros propios, esto impide que un alumno lea
  // material de otro pasando un uuid.
  const [materia] = await sql<{ id: string; name: string }[]>`
    select id, name from subjects
    where id = ${subjectId}::uuid
      and disabled_at is null
      and (user_id is null or user_id = ${auth.userId}::uuid)`;
  if (!materia) return Response.json({ error: "Materia no disponible" }, { status: 404 });

  // 1) ¿Ya están generadas? El camino entero depende de que esto sea barato.
  const [cache] = await sql<{ items: QuizItem[] }[]>`
    select items from lesson_quizzes
    where subject_id = ${subjectId}::uuid and topic_key = ${topicKey}`;
  if (cache) return Response.json({ items: sinClave(cache.items), cacheado: true });

  // 2) El material REAL de esa lección. Es el mismo camino que usa el estudio
  //    dirigido en espíritu (sin gate: ya sabemos qué lección queremos), pero
  //    POR RANGO DE PÁGINAS: varios planes traen `unit: null` y filtrar por
  //    unidad los dejaría sin material. Las páginas salen del índice y siempre
  //    están.
  if (body.p0 == null || body.p1 == null) {
    return Response.json(
      { error: "Esta lección no tiene páginas en el plan; no puedo leer su material." },
      { status: 422 },
    );
  }
  // De QUÉ LIBRO es esta lección. Se resuelve en el servidor desde `topicKey`:
  // varias materias tienen más de un libro y sus páginas se pisan, así que sin
  // esto el material de la lección mezcla tomos y las preguntas salen de un
  // libro que el alumno no estaba estudiando.
  const documentId = await documentoDeTema(subjectId, topicKey);
  if (!documentId) {
    return Response.json(
      { error: "No pude identificar de qué libro es esta lección." },
      { status: 422 },
    );
  }
  let fragmentos: { content: string }[] = [];
  try {
    fragmentos = await fetchLessonMaterial({
      subjectId,
      documentId,
      pageStart: body.p0,
      pageEnd: body.p1,
    });
  } catch (e) {
    console.error(`[lesson-quiz] no pude leer la lección: ${e instanceof Error ? e.message : e}`);
  }
  if (fragmentos.length === 0) {
    return Response.json(
      { error: "No encontré el material de esta lección." },
      { status: 422 },
    );
  }

  // Muestra que RECORRE la lección, no sus primeros párrafos: con solo el
  // arranque, las 3 preguntas salen todas del mismo pedazo y la última parte de
  // la lección nunca se evalúa.
  // SEIS ventanas de 500, no cuatro de 320. Antes daba igual cuántas se pusieran:
  // `generarPreguntas` cortaba la muestra en 340 caracteres y se quedaba con la
  // primera. Arreglado eso (ver el presupuesto repartido en quiz.ts), el tamaño de
  // la muestra vuelve a importar y conviene que recorra la lección de verdad:
  // 3.000 caracteres contra una parada mediana de 4.449.
  const sample = muestraRepartida(fragmentos.map((f) => f.content), 6, 500);

  let items: QuizItem[];
  try {
    items = await generarPreguntas(
      [{ key: topicKey, title: body.title ?? "", sample }],
      // DIEZ y no tres. Con tres, acertar dos por descarte alcanzaba para
      // pintar el nodo de verde: el número decía "dominado" sin haberlo medido.
      // Diez hace que el resultado signifique algo y que el refuerzo sepa
      // exactamente qué le costó.
      { subjectName: materia.name, porTema: 10 },
    );
  } catch (e) {
    if (e instanceof SinPreguntas) {
      return Response.json(
        {
          error:
            e.razon === "vacio"
              ? "No pude armar preguntas confiables con el material de esta lección."
              : "No pude armar las preguntas ahora. Probá de nuevo en un momento.",
        },
        { status: 503 },
      );
    }
    throw e;
  }

  // `on conflict do nothing`: dos alumnos que abren la misma lección a la vez
  // generan en paralelo, y el segundo no debe pisar al primero — se quedan las
  // que ya están y ambos ven el mismo set.
  await sql`
    insert into lesson_quizzes (subject_id, topic_key, items, topic_title)
    values (${subjectId}::uuid, ${topicKey}, ${toJson(sql, items)}::jsonb, ${body.title ?? ""})
    on conflict (subject_id, topic_key) do nothing`;

  const [final] = await sql<{ items: QuizItem[] }[]>`
    select items from lesson_quizzes
    where subject_id = ${subjectId}::uuid and topic_key = ${topicKey}`;

  return Response.json({ items: sinClave(final?.items ?? items), cacheado: false });
}

/** Lo que ve el navegador: sin `correct` ni `explain`. */
function sinClave(items: QuizItem[]) {
  return items.map(({ correct: _c, explain: _e, ...resto }) => resto);
}

/**
 * Junta `n` recortes REPARTIDOS a lo largo de los fragmentos de la lección.
 * Misma idea que `muestraRepresentativa` del plan: con los primeros 700 chars
 * solo se podía titular, y acá solo se podría preguntar por la introducción.
 */
function muestraRepartida(textos: string[], n: number, largo: number): string {
  if (textos.length === 0) return "";
  const paso = Math.max(1, Math.floor(textos.length / n));
  const out: string[] = [];
  for (let i = 0; i < textos.length && out.length < n; i += paso) {
    const t = textos[i]!.replace(/\s+/g, " ").trim();
    if (t) out.push(t.slice(0, largo));
  }
  return out.join("\n\n");
}
