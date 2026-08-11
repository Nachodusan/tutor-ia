import { getSql, toJson } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";
import type { QuizItem } from "@tutor-ia/core";

export const runtime = "nodejs";

/**
 * POST /api/lesson/quiz/submit — corrige las 3 preguntas de una lección.
 * body: { subjectId, topicKey, answers: { [n]: índice elegido } }
 *
 * LA CORRECCIÓN ES SERVER-SIDE, contra `lesson_quizzes`. El navegador nunca vio
 * `correct`, así que no puede mandarlo ni "corregirse" solo. Es la misma regla
 * que /api/test/submit, y por el mismo motivo: cuando el cliente decía qué
 * estaba bien, cualquier chico con la consola abierta se aprobaba la lección.
 *
 * Efectos:
 *   · `lesson_quiz_attempts`: el último intento (pisa el anterior al reintentar).
 *   · `student_plan_progress`: la lección queda HECHA por haberla respondido,
 *     sin nota mínima. Trabar el avance en un 2 de 3 convierte una herramienta
 *     de estudio en un examen, y el chico que se traba abandona.
 *   · `student_weak_topics`: solo lo que falló, que es lo que alimenta
 *     "Para reforzar" y el panel del docente.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as {
    subjectId?: string;
    topicKey?: string;
    answers?: Record<string, number>;
  };
  const { subjectId, topicKey } = body;
  if (!subjectId || !topicKey) {
    return Response.json({ error: "Faltan subjectId o topicKey" }, { status: 400 });
  }
  const answers = body.answers ?? {};

  const sql = getSql();
  const [fila] = await sql<{ items: QuizItem[]; topic_title: string }[]>`
    select items, topic_title from lesson_quizzes
    where subject_id = ${subjectId}::uuid and topic_key = ${topicKey}`;
  if (!fila) {
    return Response.json({ error: "Esta lección no tiene preguntas generadas." }, { status: 404 });
  }

  const items = fila.items ?? [];
  const correccion = items.map((it) => {
    const elegido = answers[String(it.n)];
    return {
      n: it.n,
      question: it.question,
      options: it.options,
      chosen: Number.isInteger(elegido) ? elegido! : -1,
      correct: it.correct,
      ok: elegido === it.correct,
      explain: it.explain,
    };
  });
  const score = correccion.filter((c) => c.ok).length;
  const total = correccion.length;
  const wrong = correccion.filter((c) => !c.ok).map((c) => c.n);

  await sql`
    insert into lesson_quiz_attempts (user_id, subject_id, topic_key, score, total, wrong)
    values (${auth.userId}::uuid, ${subjectId}::uuid, ${topicKey},
            ${score}, ${total}, ${toJson(sql, wrong)}::jsonb)
    on conflict (user_id, topic_key) do update
      set score = excluded.score, total = excluded.total,
          wrong = excluded.wrong, answered_at = now(),
          subject_id = excluded.subject_id`;

  // La lección queda hecha por RESPONDERLA. El color del nodo lo decide el
  // score (ver `lesson_quiz_attempts`), pero el avance no se traba.
  await sql`
    insert into student_plan_progress (user_id, subject_id, topic_key)
    values (${auth.userId}::uuid, ${subjectId}::uuid, ${topicKey})
    on conflict (user_id, topic_key) do nothing`;

  // Solo lo fallado va a reforzar. Si acertó todo, además se LIMPIA: un tema
  // que ya dominó no debería seguir apareciendo en "Para reforzar" ni en el
  // panel del profe — ese era el bug de identidad que ya se arregló una vez
  // cuando los temas se buscaban por su TEXTO.
  if (wrong.length > 0) {
    // `misses` se ACUMULA: el ranking del panel del docente ordena por cuántas
    // veces se falló, así que pisarlo con 1 en cada reintento borraría la señal
    // de "este tema le cuesta de verdad".
    await sql`
      insert into student_weak_topics (user_id, subject_id, topic_key, topic, unit, lesson, misses)
      values (${auth.userId}::uuid, ${subjectId}::uuid, ${topicKey},
              ${fila.topic_title || items[0]?.topic || ""}, null, null, 1)
      on conflict (user_id, subject_id, topic_key) do update
        set topic = excluded.topic,
            misses = student_weak_topics.misses + 1,
            last_at = now()`;
  } else {
    await sql`
      delete from student_weak_topics
      where user_id = ${auth.userId}::uuid
        and subject_id = ${subjectId}::uuid
        and topic_key = ${topicKey}`;
  }

  return Response.json({ score, total, items: correccion });
}
