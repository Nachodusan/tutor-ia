import { getSql } from "@tutor-ia/db";
import { planSizes } from "@tutor-ia/rag";
import { requireUser, unauthorized } from "@/lib/auth";
import { aprobado } from "../../nota";

export const runtime = "nodejs";

/**
 * GET /api/resumen → lo que el alumno HIZO y lo que ya le sale.
 *
 * Es la pantalla "Tu resumen". Ruta propia y no un campo más en `/api/progress`
 * porque son preguntas distintas: el panel pregunta "¿cómo voy en cada materia?"
 * (y lo pide en cada carga), y esta pregunta "¿qué llevo hecho y qué domino?",
 * que necesita los INTENTOS uno por uno y no un agregado.
 *
 * ⚠️ QUÉ ES UNA "FORTALEZA", HOY. Un tema cuenta como fuerte cuando el alumno
 * APROBÓ su chequeo —dos tercios, la misma regla que usa todo el resto de la
 * app (`nota.ts`)— y no tiene ese tema pendiente de refuerzo. Es la única
 * evidencia REAL que existe hoy: alguien le hizo preguntas y las contestó bien.
 *
 * Lo que NO se hace, a propósito: inventar una "fortaleza" a partir de haber
 * leído una lección o de haber pasado tiempo en el chat. Eso mide asistencia,
 * no dominio, y una pantalla que le dice a un chico "sos bueno en esto" cuando
 * solo abrió la página le enseña que el elogio de la app no vale nada.
 *
 * La definición fuerte —cuándo alguien es de verdad bueno en un punto de la
 * materia— está sin resolver y se decide aparte; cuando llegue, se cambia acá y
 * la pantalla no se entera.
 */
export interface ResumenMateria {
  id: string;
  name: string;
  grade: string | null;
  planDone: number;
  planTotal: number;
  /** Temas con chequeo aprobado y sin refuerzo pendiente. */
  fuertes: { topicKey: string; topic: string; score: number; total: number }[];
  /** Cuántos temas tiene para reforzar (el detalle vive en /reforzar). */
  pendientes: number;
  lastScore: { score: number; total: number } | null;
}

export interface ResumenResponse {
  /** Lo hecho, en números. Todos salen de filas que ya existen. */
  hechas: { lecciones: number; chequeos: number; pruebas: number };
  materias: ResumenMateria[];
}

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const sql = getSql();
  const uid = auth.userId;

  const [materias, hechos, intentos, debiles, examenes, rendidas, secciones, cacheados] = await Promise.all([
    // Las materias VISIBLES para este alumno, con su curso. Mismo criterio que
    // /api/subjects: el currículo es global (user_id null) y las apagadas no van.
    sql<{ id: string; name: string; grade: string | null }[]>`
      select s.id, s.name, max(d.grade) as grade
      from subjects s
      join documents d on d.subject_id = s.id
      where (s.user_id is null or s.user_id = ${uid}::uuid)
        and s.disabled_at is null
      group by s.id, s.name`,
    sql<{ subject_id: string; n: number }[]>`
      select subject_id, count(*)::int as n from student_plan_progress
      where user_id = ${uid}::uuid group by subject_id`,
    // El ÚLTIMO intento de cada chequeo, con su título legible. El título vive
    // en `lesson_quizzes` y no en el intento: si el quiz se regenera, el nombre
    // sigue siendo el de la lección.
    sql<{ subject_id: string; topic_key: string; score: number; total: number; topic: string | null }[]>`
      select a.subject_id, a.topic_key, a.score, a.total, q.topic_title as topic
      from lesson_quiz_attempts a
      left join lesson_quizzes q
        on q.subject_id = a.subject_id and q.topic_key = a.topic_key
      where a.user_id = ${uid}::uuid`,
    sql<{ subject_id: string; topic_key: string }[]>`
      select subject_id, topic_key from student_weak_topics where user_id = ${uid}::uuid`,
    // La ÚLTIMA nota de cada materia (una fila por materia).
    sql<{ subject_id: string; score: string; total: number }[]>`
      select distinct on (e.subject_id)
             e.subject_id, a.score, jsonb_array_length(e.questions) as total
      from exam_attempts a join exams e on e.id = a.exam_id
      where a.user_id = ${uid}::uuid
      order by e.subject_id, a.submitted_at desc`,
    // ⚠️ Y CUÁNTAS RINDIÓ, que NO es lo mismo. Contar la consulta de arriba
    // daba "materias con prueba" —decía 1 con seis pruebas rendidas— porque el
    // `distinct on` deja una fila por materia. Un resumen que subcuenta lo que
    // el chico hizo es peor que no tenerlo.
    sql<{ n: string }[]>`
      select count(*)::text as n from exam_attempts where user_id = ${uid}::uuid`,
    planSizes(),
    sql<{ subject_id: string; n: string }[]>`
      select subject_id, jsonb_array_length(items)::text as n from subject_plans`,
  ]);

  const porMateria = new Map<string, ResumenMateria>();
  for (const m of materias) {
    porMateria.set(m.id, {
      id: m.id, name: m.name, grade: m.grade,
      planDone: 0, planTotal: secciones[m.id] ?? 0,
      fuertes: [], pendientes: 0, lastScore: null,
    });
  }
  // La cache del plan manda sobre el estimado del índice: es el plan exacto que
  // vio el alumno. Mismo orden que en /api/progress.
  for (const r of cacheados) { const m = porMateria.get(r.subject_id); if (m) m.planTotal = Number(r.n); }
  for (const r of hechos) { const m = porMateria.get(r.subject_id); if (m) m.planDone = r.n; }
  for (const r of examenes) {
    const m = porMateria.get(r.subject_id);
    if (m) m.lastScore = { score: Number(r.score), total: r.total };
  }

  const pendiente = new Set(debiles.map((d) => `${d.subject_id}:${d.topic_key}`));
  for (const d of debiles) { const m = porMateria.get(d.subject_id); if (m) m.pendientes++; }

  for (const a of intentos) {
    const m = porMateria.get(a.subject_id);
    if (!m) continue;
    // Fuerte = lo aprobó Y no lo tiene pendiente. La segunda condición importa:
    // un tema puede haberse aprobado en su chequeo y volver a caer en refuerzo
    // por la prueba grande, y en ese caso lo último que se sabe es que falla.
    if (!aprobado(a.score, a.total)) continue;
    if (pendiente.has(`${a.subject_id}:${a.topic_key}`)) continue;
    m.fuertes.push({
      topicKey: a.topic_key,
      topic: a.topic || "Un tema de esta materia",
      score: a.score,
      total: a.total,
    });
  }
  // El que mejor le salió, primero.
  for (const m of porMateria.values()) {
    m.fuertes.sort((x, y) => y.score / y.total - x.score / x.total);
  }

  const body: ResumenResponse = {
    hechas: {
      lecciones: hechos.reduce((n, r) => n + r.n, 0),
      chequeos: intentos.length,
      pruebas: Number(rendidas[0]?.n ?? 0),
    },
    materias: [...porMateria.values()],
  };
  return Response.json(body);
}
