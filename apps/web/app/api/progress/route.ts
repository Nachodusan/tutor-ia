import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

export interface SubjectProgress {
  planDone: number;
  planTotal: number;
  weak: { topicKey: string; topic: string; unit: number | null; lesson: number | null; misses: number }[];
  lastScore: { score: number; total: number; at: string } | null;
}

/**
 * GET /api/progress → el avance del alumno en TODAS sus materias, de una.
 *
 * Reemplaza el bucle que leía localStorage una vez por materia (6 lecturas
 * sincrónicas para pintar el panel). Son tres queries agregadas, no una por
 * tarjeta.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const sql = getSql();
  const uid = auth.userId;

  const [hechos, totales, debiles, ultimos] = await Promise.all([
    sql<{ subject_id: string; n: string }[]>`
      select subject_id, count(*)::text as n from student_plan_progress
      where user_id = ${uid}::uuid group by subject_id`,
    // El plan es compartido por materia: su tamaño sale de la cache común.
    sql<{ subject_id: string; n: string }[]>`
      select subject_id, jsonb_array_length(items)::text as n from subject_plans`,
    sql<{ subject_id: string; topic_key: string; topic: string; unit: number | null; lesson: number | null; misses: number }[]>`
      select subject_id, topic_key, topic, unit, lesson, misses
      from student_weak_topics where user_id = ${uid}::uuid
      order by misses desc, last_at desc`,
    // Último intento por materia: distinct on es la forma barata en Postgres.
    sql<{ subject_id: string; score: number; total: number; at: Date }[]>`
      select distinct on (e.subject_id)
             e.subject_id, a.score, jsonb_array_length(e.questions) as total, a.submitted_at as at
      from exam_attempts a
      join exams e on e.id = a.exam_id
      where a.user_id = ${uid}::uuid
      order by e.subject_id, a.submitted_at desc`,
  ]);

  const out: Record<string, SubjectProgress> = {};
  const de = (sid: string): SubjectProgress =>
    (out[sid] ??= { planDone: 0, planTotal: 0, weak: [], lastScore: null });

  for (const r of totales) de(r.subject_id).planTotal = Number(r.n);
  for (const r of hechos) de(r.subject_id).planDone = Number(r.n);
  for (const r of debiles) {
    de(r.subject_id).weak.push({
      topicKey: r.topic_key, topic: r.topic, unit: r.unit, lesson: r.lesson, misses: r.misses,
    });
  }
  for (const r of ultimos) {
    de(r.subject_id).lastScore = { score: r.score, total: r.total, at: new Date(r.at).toISOString() };
  }

  return Response.json({ progress: out });
}
