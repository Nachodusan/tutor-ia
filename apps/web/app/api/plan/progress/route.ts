import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/plan/progress — body: { subjectId, topicKey, done }
 *
 * Marca o desmarca un tema del plan. Reemplaza `savePlan()` de localStorage.
 *
 * La identidad es `topicKey`, no la posición en la lista: antes se guardaba el
 * índice `n`, así que al regenerarse el plan el progreso pasaba a apuntar a otra
 * lección. La clave la produce `getPlanTopics` y sobrevive al rebuild.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    subjectId?: string;
    topicKey?: string;
    done?: boolean;
  };
  if (!body.subjectId || !body.topicKey) {
    return Response.json({ error: "Faltan subjectId o topicKey" }, { status: 400 });
  }

  const sql = getSql();
  if (body.done) {
    await sql`
      insert into student_plan_progress (user_id, subject_id, topic_key)
      values (${auth.userId}::uuid, ${body.subjectId}::uuid, ${body.topicKey})
      on conflict (user_id, topic_key) do nothing`;
  } else {
    await sql`
      delete from student_plan_progress
      where user_id = ${auth.userId}::uuid and topic_key = ${body.topicKey}`;
  }

  const hechos = await sql<{ topic_key: string }[]>`
    select topic_key from student_plan_progress
    where user_id = ${auth.userId}::uuid and subject_id = ${body.subjectId}::uuid`;
  return Response.json({ doneKeys: hechos.map((r) => r.topic_key) });
}
