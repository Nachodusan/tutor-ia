import { getSql, toJson } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

interface ItemEnviado {
  topicKey?: string;
  topic?: string;
  unit?: number | null;
  lesson?: number | null;
  correct: number;
  answer: number | null;
}

/**
 * POST /api/test/submit — body: { subjectId, items: ItemEnviado[] }
 *
 * Corrige la prueba y actualiza los temas para reforzar. Reemplaza `submitTest()`
 * del cliente, que guardaba en localStorage.
 *
 * La identidad del tema es `topicKey`, no su TEXTO: el título de cada pregunta
 * lo redacta el modelo en cada generación, así que dos pruebas producían strings
 * distintos para la misma lección y el tema no salía nunca de la lista de
 * refuerzo aunque el alumno lo acertara después.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    subjectId?: string;
    items?: ItemEnviado[];
  };
  if (!body.subjectId || !Array.isArray(body.items) || body.items.length === 0) {
    return Response.json({ error: "Faltan subjectId o items" }, { status: 400 });
  }

  const sql = getSql();
  const uid = auth.userId;
  const sid = body.subjectId;

  const total = body.items.length;
  const score = body.items.filter((i) => i.answer === i.correct).length;

  await sql.begin(async (tx) => {
    for (const it of body.items!) {
      const key = it.topicKey ?? it.topic ?? "";
      if (!key) continue;
      const acerto = it.answer === it.correct;
      if (acerto) {
        // Acertó: el tema deja de estar para reforzar.
        await tx`
          delete from student_weak_topics
          where user_id = ${uid}::uuid and subject_id = ${sid}::uuid and topic_key = ${key}`;
      } else {
        await tx`
          insert into student_weak_topics (user_id, subject_id, topic_key, topic, unit, lesson, misses, last_at)
          values (${uid}::uuid, ${sid}::uuid, ${key}, ${it.topic ?? key}, ${it.unit ?? null}, ${it.lesson ?? null}, 1, now())
          on conflict (user_id, subject_id, topic_key) do update set
            misses  = student_weak_topics.misses + 1,
            topic   = excluded.topic,   -- la etiqueta legible se refresca
            unit    = excluded.unit,
            lesson  = excluded.lesson,
            last_at = now()`;
      }
    }

    // El resultado va a exams/exam_attempts, que ya existían con la forma exacta
    // y estaban sin usar. Evita una tercera tabla de "pruebas" y deja un único
    // lugar canónico de qué se preguntó y qué contestó cada alumno.
    // `tx.json(...)` y NO `JSON.stringify(...)::jsonb`: con esta conexión lo
    // segundo guarda un STRING de json en vez de un array, y entonces el
    // `jsonb_array_length(questions)` de acá abajo y el de /api/progress fallan
    // con "cannot get array length of a scalar" — es decir, el panel del alumno
    // se rompe justo después de rendir su primera prueba.
    const [ex] = await tx<{ id: string }[]>`
      insert into exams (user_id, subject_id, title, questions)
      values (${uid}::uuid, ${sid}::uuid, ${"Simulación de prueba"},
              ${toJson(tx, body.items!)}::jsonb)
      returning id`;
    // `score` guarda la cantidad de aciertos, no un porcentaje: la UI muestra
    // "X de Y" y el total sale de jsonb_array_length(questions).
    await tx`
      insert into exam_attempts (exam_id, user_id, answers, score)
      values (${ex!.id}::uuid, ${uid}::uuid,
              ${toJson(tx, body.items!.map((i) => i.answer))}::jsonb, ${score})`;
  });

  const weak = await sql<{ topic_key: string; topic: string; unit: number | null; lesson: number | null; misses: number }[]>`
    select topic_key, topic, unit, lesson, misses from student_weak_topics
    where user_id = ${uid}::uuid and subject_id = ${sid}::uuid
    order by misses desc, last_at desc`;

  return Response.json({
    score,
    total,
    weak: weak.map((w) => ({
      topicKey: w.topic_key, topic: w.topic, unit: w.unit, lesson: w.lesson, misses: w.misses,
    })),
  });
}
