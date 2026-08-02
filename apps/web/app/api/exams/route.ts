import { generateExam, gradeExam, type Exam, type StudentAnswer } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/exams
 *  - action "generate": { action, subjectId?, topic?, numQuestions?, difficulty?, types? }
 *      -> genera un examen desde el material y lo guarda; devuelve { examId, exam }
 *  - action "grade":    { action, examId, answers: {questionId, response}[] }
 *      -> corrige y guarda el intento; devuelve { grading }
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const userId = auth.userId;
  const sql = getSql();
  const body = (await req.json()) as Record<string, unknown>;
  const action = body.action;

  try {
    if (action === "generate") {
      const exam = await generateExam({
        userId,
        subjectId: (body.subjectId as string) ?? null,
        topic: body.topic as string | undefined,
        numQuestions: body.numQuestions as number | undefined,
        difficulty: body.difficulty as "easy" | "medium" | "hard" | undefined,
        types: body.types as ("mcq" | "true_false" | "open")[] | undefined,
      });

      const [row] = await sql<{ id: string }[]>`
        insert into exams (user_id, subject_id, title, difficulty, questions)
        values (
          ${userId},
          ${(body.subjectId as string) ?? null},
          ${exam.title},
          ${exam.difficulty},
          ${JSON.stringify(exam.questions)}::jsonb
        )
        returning id
      `;
      return Response.json({ examId: row!.id, exam });
    }

    if (action === "grade") {
      const examId = body.examId as string;
      const answers = body.answers as StudentAnswer[];
      if (!examId || !Array.isArray(answers)) {
        return new Response("Faltan 'examId' o 'answers'.", { status: 400 });
      }

      const [examRow] = await sql<
        { title: string; difficulty: Exam["difficulty"]; questions: Exam["questions"] }[]
      >`select title, difficulty, questions from exams where id = ${examId} and user_id = ${userId}`;
      if (!examRow) return new Response("Examen no encontrado.", { status: 404 });

      const exam: Exam = {
        title: examRow.title,
        difficulty: examRow.difficulty,
        questions: examRow.questions,
      };
      const grading = await gradeExam(exam, answers);

      await sql`
        insert into exam_attempts (exam_id, user_id, answers, grading, score)
        values (
          ${examId},
          ${userId},
          ${JSON.stringify(answers)}::jsonb,
          ${JSON.stringify(grading)}::jsonb,
          ${grading.totalScore}
        )
      `;
      return Response.json({ grading });
    }

    return new Response("action debe ser 'generate' o 'grade'.", { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error en el examen";
    return new Response(msg, { status: 500 });
  }
}
