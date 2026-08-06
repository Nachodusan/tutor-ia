import { getSql, toJson } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/** La forma persistida en exams.questions (ver /api/test). */
interface ItemPersistido {
  n: number;
  topic: string;
  question: string;
  options: string[];
  correct: number;
  explain: string;
  key: string;
  unit: number | null;
  lesson: number | null;
}

/**
 * POST /api/test/submit — body: { testId, answers: (number|null)[] }
 *
 * Corrige la prueba CONTRA LO PERSISTIDO en `exams` y actualiza los temas para
 * reforzar. Antes el cliente mandaba los items con su propio `correct`: la
 * clave viajaba al navegador y el servidor le creía al índice que viniera —
 * cualquiera con la pestaña Red abierta la leía, y un cliente adulterado
 * "acertaba" todo. Ahora la clave nunca sale del servidor hasta después de
 * rendir: la respuesta incluye `key` (correct + explain por pregunta) para que
 * la UI pinte los resultados.
 *
 * La identidad del tema es `topicKey` (acá `q.key`), no su TEXTO: el título de
 * cada pregunta lo redacta el modelo en cada generación, así que dos pruebas
 * producían strings distintos para la misma lección y el tema no salía nunca de
 * la lista de refuerzo aunque el alumno lo acertara después.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    testId?: string;
    answers?: (number | null)[];
  };
  if (!body.testId || !Array.isArray(body.answers)) {
    return Response.json({ error: "Faltan testId o answers" }, { status: 400 });
  }

  const sql = getSql();
  const uid = auth.userId;

  // user_id en el WHERE: un alumno solo puede rendir SU prueba.
  const [exam] = await sql<{ id: string; subject_id: string | null; questions: ItemPersistido[] }[]>`
    select id, subject_id, questions from exams
    where id = ${body.testId}::uuid and user_id = ${uid}::uuid`;
  if (!exam) return Response.json({ error: "Prueba no encontrada" }, { status: 404 });

  const questions = exam.questions;
  const sid = exam.subject_id;
  const answers = questions.map((_, i) => {
    const a = body.answers![i];
    return Number.isInteger(a) ? (a as number) : null;
  });

  const total = questions.length;
  const score = questions.filter((q, i) => answers[i] === q.correct).length;

  await sql.begin(async (tx) => {
    if (sid) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]!;
        const key = q.key || q.topic || "";
        if (!key) continue;
        const acerto = answers[i] === q.correct;
        if (acerto) {
          // Acertó: el tema deja de estar para reforzar.
          await tx`
            delete from student_weak_topics
            where user_id = ${uid}::uuid and subject_id = ${sid}::uuid and topic_key = ${key}`;
        } else {
          await tx`
            insert into student_weak_topics (user_id, subject_id, topic_key, topic, unit, lesson, misses, last_at)
            values (${uid}::uuid, ${sid}::uuid, ${key}, ${q.topic ?? key}, ${q.unit ?? null}, ${q.lesson ?? null}, 1, now())
            on conflict (user_id, subject_id, topic_key) do update set
              misses  = student_weak_topics.misses + 1,
              topic   = excluded.topic,   -- la etiqueta legible se refresca
              unit    = excluded.unit,
              lesson  = excluded.lesson,
              last_at = now()`;
        }
      }
    }

    // `score` guarda la cantidad de aciertos, no un porcentaje: la UI muestra
    // "X de Y" y el total sale de jsonb_array_length(questions).
    // `toJson(...)` y NO `JSON.stringify(...)::jsonb`: ver la TRAMPA de jsonb.
    await tx`
      insert into exam_attempts (exam_id, user_id, answers, score)
      values (${exam.id}::uuid, ${uid}::uuid, ${toJson(tx, answers)}::jsonb, ${score})`;
  });

  const weak = sid
    ? await sql<{ topic_key: string; topic: string; unit: number | null; lesson: number | null; misses: number }[]>`
        select topic_key, topic, unit, lesson, misses from student_weak_topics
        where user_id = ${uid}::uuid and subject_id = ${sid}::uuid
        order by misses desc, last_at desc`
    : [];

  return Response.json({
    score,
    total,
    // La clave, recién ahora: la UI pinta aciertos/errores y muestra el "por qué".
    key: questions.map((q) => ({ n: q.n, correct: q.correct, explain: q.explain })),
    weak: weak.map((w) => ({
      topicKey: w.topic_key, topic: w.topic, unit: w.unit, lesson: w.lesson, misses: w.misses,
    })),
  });
}
