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
/** Un paso del plan, en orden, con si el alumno ya lo hizo. */
export interface ResumenPaso {
  key: string;
  /** El número que el alumno ve en el camino. */
  n: number;
  title: string;
  done: boolean;
  /** Cuándo lo terminó (ISO), si lo terminó. */
  doneAt: string | null;
}

export interface ResumenMateria {
  id: string;
  name: string;
  grade: string | null;
  planDone: number;
  planTotal: number;
  /** Los pasos EN ORDEN. Es lo que dibuja la pista de avance. */
  pasos: ResumenPaso[];
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
  /**
   * Avance guardado que el plan de hoy YA NO RECONOCE. Ver el comentario de
   * `hechos` abajo: no se cuenta como avance, pero tampoco se esconde.
   */
  huerfanos: number;
}

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const sql = getSql();
  const uid = auth.userId;

  const [materias, hechos, intentos, debiles, examenes, rendidas, secciones, cacheados, pasos, huerfanos] = await Promise.all([
    // Las materias VISIBLES para este alumno, con su curso. Mismo criterio que
    // /api/subjects: el currículo es global (user_id null) y las apagadas no van.
    sql<{ id: string; name: string; grade: string | null }[]>`
      select s.id, s.name, max(d.grade) as grade
      from subjects s
      join documents d on d.subject_id = s.id
      where (s.user_id is null or s.user_id = ${uid}::uuid)
        and s.disabled_at is null
      group by s.id, s.name`,
    /**
     * ⚠️ EL AVANCE SE CUENTA CONTRA EL PLAN VIGENTE, NO CONTANDO FILAS.
     *
     * Antes era `count(*) from student_plan_progress`, y eso hacía que esta
     * pantalla y el camino dijeran cosas distintas de la misma materia: el
     * camino "0 de 12" y el resumen "5 de 11 · 45%". El camino tiene razón —
     * marca hecho lo que encuentra por `topic_key` en el plan de hoy— y acá se
     * contaban filas que ese plan ya no conoce.
     *
     * POR QUÉ PASA: `claveTema(document_id, ord, title)` depende del `ord`, y
     * reconstruir `book_sections` lo reasigna. Medido el 2026-08-29: el avance
     * se marcó entre el 5 y el 16 de agosto, las secciones se reconstruyeron
     * entre el 23 y el 26, y quedaron huérfanas las 99 filas — el 100%. No se
     * pudo recuperar: 89 conservan su título en `lesson_notes` pero ninguna
     * coincide con un título del plan (los escribe el modelo, no el índice).
     *
     * El arreglo de raíz es que la clave sobreviva al rebuild, y es de otra
     * sesión. Esto es lo que corresponde igual: una pantalla no puede reportar
     * como avance algo que el alumno no puede ver en ningún lado.
     */
    sql<{ subject_id: string; n: number }[]>`
      select spp.subject_id, count(*)::int as n
      from student_plan_progress spp
      join subject_plans sp on sp.subject_id = spp.subject_id
      where spp.user_id = ${uid}::uuid
        and exists (
          select 1 from jsonb_array_elements(sp.items) i
          where i->>'key' = spp.topic_key
        )
      group by spp.subject_id`,
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
    /**
     * LOS PASOS DEL PLAN, EN ORDEN, con la fecha en que el alumno los terminó.
     *
     * Es lo que dibuja la pista de avance. El orden lo da `ordinality` sobre el
     * array y NO el campo `n` del ítem: `n` es el número que el alumno ve, pero
     * sale del índice del libro y puede repetirse o saltar. Para pintar la
     * pista lo que importa es la SECUENCIA, y esa es la del array.
     */
    sql<{ subject_id: string; key: string; n: number; title: string; done_at: Date | null }[]>`
      select sp.subject_id,
             i.item->>'key'                        as key,
             i.ord::int                            as n,
             coalesce(i.item->>'title', 'Sin título') as title,
             spp.done_at
      from subject_plans sp
      cross join lateral jsonb_array_elements(sp.items) with ordinality as i(item, ord)
      left join student_plan_progress spp
        on spp.user_id = ${uid}::uuid
       and spp.subject_id = sp.subject_id
       and spp.topic_key = i.item->>'key'
      order by sp.subject_id, i.ord`,
    /** El avance que el plan de hoy ya no reconoce. Se informa, no se suma. */
    sql<{ n: string }[]>`
      select count(*)::text as n
      from student_plan_progress spp
      where spp.user_id = ${uid}::uuid
        and not exists (
          select 1 from subject_plans sp, jsonb_array_elements(sp.items) i
          where sp.subject_id = spp.subject_id and i->>'key' = spp.topic_key
        )`,
  ]);

  const porMateria = new Map<string, ResumenMateria>();
  for (const m of materias) {
    porMateria.set(m.id, {
      id: m.id, name: m.name, grade: m.grade,
      planDone: 0, planTotal: secciones[m.id] ?? 0,
      pasos: [], fuertes: [], pendientes: 0, lastScore: null,
    });
  }
  // La cache del plan manda sobre el estimado del índice: es el plan exacto que
  // vio el alumno. Mismo orden que en /api/progress.
  for (const r of cacheados) { const m = porMateria.get(r.subject_id); if (m) m.planTotal = Number(r.n); }
  for (const r of hechos) { const m = porMateria.get(r.subject_id); if (m) m.planDone = r.n; }
  for (const p of pasos) {
    const m = porMateria.get(p.subject_id);
    if (!m) continue;
    m.pasos.push({
      key: p.key, n: p.n, title: p.title,
      done: p.done_at != null,
      doneAt: p.done_at ? new Date(p.done_at).toISOString() : null,
    });
  }
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
      // El mismo criterio que `planDone`, y por la misma razón: si el número
      // grande de arriba contara filas sueltas y las filas de abajo contaran
      // pasos del plan, la pantalla se contradiría consigo misma a dos dedos
      // de distancia. Es lo que pasaba: decía "9 lecciones terminadas" con
      // todas las materias en 0.
      lecciones: hechos.reduce((n, r) => n + r.n, 0),
      chequeos: intentos.length,
      pruebas: Number(rendidas[0]?.n ?? 0),
    },
    materias: [...porMateria.values()],
    huerfanos: Number(huerfanos[0]?.n ?? 0),
  };
  return Response.json(body);
}
