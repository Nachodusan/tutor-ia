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

  const [hechos, secciones, totales, debiles, ultimos] = await Promise.all([
    sql<{ subject_id: string; n: string }[]>`
      select subject_id, count(*)::text as n from student_plan_progress
      where user_id = ${uid}::uuid group by subject_id`,
    // Tamaño del plan ANTES de que exista la cache. `subject_plans` se escribe
    // recién cuando alguien aprieta "armar plan", así que hasta entonces el
    // panel decía "Material disponible" y escondía la barra aunque el alumno ya
    // tuviera lecciones marcadas — y el panel del docente, que sí calcula el
    // total desde el índice del libro, mostraba "13 de 14" para ese mismo chico.
    // El mismo hecho contado de dos maneras. Esta es la cuenta de getPlanTopics:
    // lecciones del índice, tope 14, y nada si hay menos de 3 (ahí cae al legacy).
    sql<{ subject_id: string; n: string }[]>`
      select subject_id, least(count(*), 14)::text as n
      from book_sections where level = 2
      group by subject_id having count(*) >= 3`,
    // Con la cache ya escrita, ella manda: es el plan exacto que vio el alumno.
    sql<{ subject_id: string; n: string }[]>`
      select subject_id, jsonb_array_length(items)::text as n from subject_plans`,
    sql<{ subject_id: string; topic_key: string; topic: string; unit: number | null; lesson: number | null; misses: number }[]>`
      select subject_id, topic_key, topic, unit, lesson, misses
      from student_weak_topics where user_id = ${uid}::uuid
      order by misses desc, last_at desc`,
    // Último intento por materia: distinct on es la forma barata en Postgres.
    // `score` es numeric(5,2) y postgres.js lo devuelve como STRING ("3.00"),
    // así que la tarjeta decía "Prueba: 3.00/5". El Number() está abajo.
    sql<{ subject_id: string; score: string; total: number; at: Date }[]>`
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

  // Orden deliberado: primero el estimado del índice, después la cache, que lo pisa.
  for (const r of secciones) de(r.subject_id).planTotal = Number(r.n);
  for (const r of totales) de(r.subject_id).planTotal = Number(r.n);
  for (const r of hechos) de(r.subject_id).planDone = Number(r.n);
  for (const r of debiles) {
    de(r.subject_id).weak.push({
      topicKey: r.topic_key, topic: r.topic, unit: r.unit, lesson: r.lesson, misses: r.misses,
    });
  }
  for (const r of ultimos) {
    de(r.subject_id).lastScore = { score: Number(r.score), total: r.total, at: new Date(r.at).toISOString() };
  }

  return Response.json({ progress: out });
}
