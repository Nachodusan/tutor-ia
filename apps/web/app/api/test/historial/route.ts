import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/test/historial?subjectId=…   → las pruebas que el alumno YA rindió.
 * GET /api/test/historial?id=…          → una, con su contenido completo.
 *
 * Las pruebas ya se guardaban enteras (`exams` con la clave, `exam_attempts`
 * con lo que respondió el alumno) pero no había forma de volver a mirarlas: se
 * veían una vez al corregir y se perdían. Es justo lo que un chico quiere
 * repasar la noche antes de la prueba de verdad.
 *
 * ⚠️ Filtra SIEMPRE por `user_id`: un intento es de quien lo rindió, y el id va
 * en la URL. Sin esa condición, cambiar un uuid mostraría la prueba de otro
 * —con sus respuestas y su nota—, que es exactamente lo que el panel del
 * docente evita a propósito.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const subjectId = url.searchParams.get("subjectId");
  const sql = getSql();

  if (id) {
    const [fila] = await sql<
      {
        id: string; score: string; submitted_at: Date; title: string;
        questions: { n: number; topic: string; question: string; options: string[]; correct: number; explain: string; unit: number | null; lesson: number | null }[];
        answers: (number | null)[];
      }[]
    >`
      select a.id, a.score, a.submitted_at, e.title, e.questions, a.answers
      from exam_attempts a join exams e on e.id = a.exam_id
      where a.id = ${id}::uuid and a.user_id = ${auth.userId}::uuid`;
    if (!fila) return Response.json({ error: "No encontrado" }, { status: 404 });

    const preguntas = (fila.questions ?? []).map((q, i) => {
      const elegida = Array.isArray(fila.answers) ? fila.answers[i] : null;
      return {
        n: q.n, topic: q.topic, question: q.question, options: q.options,
        correct: q.correct, explain: q.explain,
        chosen: typeof elegida === "number" ? elegida : -1,
        ok: elegida === q.correct,
        unit: q.unit ?? null, lesson: q.lesson ?? null,
      };
    });
    return Response.json({
      intento: {
        id: fila.id,
        title: fila.title,
        at: new Date(fila.submitted_at).toISOString(),
        score: preguntas.filter((p) => p.ok).length,
        total: preguntas.length,
        preguntas,
      },
    });
  }

  if (!subjectId) return Response.json({ error: "Falta subjectId" }, { status: 400 });

  // El listado NO trae las preguntas: son ~8 por intento con sus 4 opciones, y
  // la pantalla solo muestra fecha y nota. Se piden al abrir uno.
  const filas = await sql<{ id: string; score: string; submitted_at: Date; total: number }[]>`
    select a.id, a.score, a.submitted_at,
           jsonb_array_length(e.questions)::int as total
    from exam_attempts a join exams e on e.id = a.exam_id
    where a.user_id = ${auth.userId}::uuid and e.subject_id = ${subjectId}::uuid
    order by a.submitted_at desc
    limit 30`;

  return Response.json({
    // `exam_attempts.score` es el CONTEO de aciertos, no una fracción (ver el
    // submit: `questions.filter(...).length`). Tratarlo como porcentaje daba
    // notas absurdas del tipo "48 de 8".
    intentos: filas.map((f) => ({
      id: f.id,
      at: new Date(f.submitted_at).toISOString(),
      score: Number(f.score),
      total: f.total,
    })),
  });
}
