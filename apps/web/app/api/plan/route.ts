import { buildStudyPlan, SinEstructura, logDecision } from "@tutor-ia/core";
import { planSizes } from "@tutor-ia/rag";
import { getSql, toJson } from "@tutor-ia/db";
import { requireCursoAbierto } from "@/lib/auth";

export const runtime = "nodejs";
// Titular el plan con el 7B (con recarga por keep_alive:0) puede tardar, y ahora
// además son varias tandas. Ver el comentario de TANDA en el POST.
export const maxDuration = 300;

/**
 * GET /api/plan?subjectId=… → el plan YA generado de esa materia y qué temas
 * marcó este alumno. Sin LLM: si no hay plan cacheado devuelve items vacío y el
 * cliente ofrece generarlo.
 *
 * El plan se guarda UNA vez por materia porque sale del índice del libro y el
 * libro es el mismo para todo el curso; lo que es de cada alumno es el avance.
 */
export async function GET(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const subjectId = new URL(req.url).searchParams.get("subjectId");
  if (!subjectId) return Response.json({ error: "Falta subjectId" }, { status: 400 });

  const sql = getSql();
  const [cache] = await sql<{ items: unknown[] }[]>`
    select items from subject_plans where subject_id = ${subjectId}::uuid`;
  const hechos = await sql<{ topic_key: string }[]>`
    select topic_key from student_plan_progress
    where user_id = ${auth.userId}::uuid and subject_id = ${subjectId}::uuid`;
  // El ÚLTIMO intento de las preguntas de cada lección. Es lo que decide el
  // color del nodo en el camino: verde si le fue bien, ámbar si respondió pero
  // le fue peor. Sin esto "hecho" volvería a ser un tilde que el chico se pone
  // solo, que es lo que este cambio vino a resolver.
  const intentos = await sql<{ topic_key: string; score: number; total: number }[]>`
    select topic_key, score, total from lesson_quiz_attempts
    where user_id = ${auth.userId}::uuid and subject_id = ${subjectId}::uuid`;

  // ¿SE PUEDE armar, aunque todavía no esté armado? Son dos cosas distintas y la
  // pantalla las confundía: sin plan cacheado mostraba "su libro no trae un
  // índice que se pueda leer" —culpando al libro— y escondía el botón de armarlo.
  // Ciencias Naturales 4º tiene siete lecciones y quedaba en ese callejón.
  // Solo se calcula cuando no hay cache: si el plan existe, la pregunta sobra.
  const puedeArmarse = cache?.items?.length
    ? true
    : ((await planSizes([subjectId]))[subjectId] ?? 0) > 0;

  return Response.json({
    items: cache?.items ?? [],
    puedeArmarse,
    doneKeys: hechos.map((r) => r.topic_key),
    scores: Object.fromEntries(intentos.map((i) => [i.topic_key, { score: i.score, total: i.total }])),
  });
}

/**
 * POST /api/plan — arma un PLAN DE ESTUDIO fundamentado en el material.
 * body: { subjectId, subjectName? }
 *
 * La ESTRUCTURA (orden, títulos, páginas) sale del ÍNDICE REAL del libro, vía
 * `getPlanTopics` — la misma fuente que usa /api/test. El LLM SOLO reescribe el
 * título para que sea corto y motivador y agrega la línea de "qué vas a
 * aprender"; no inventa temas ni decide el orden.
 *
 * Antes esto agrupaba por `chunks.unit/lesson`, metadata rota que producía temas
 * como "Organización del texto de estudio · pág. 8-138". Si el libro no tiene un
 * índice legible ni grupos sanos, devuelve items: [] — un plan equivocado es
 * peor que ninguno, porque el alumno estudia lo que no es.
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const body = (await req.json()) as { subjectId?: string; subjectName?: string };
  const subjectId = body.subjectId;
  if (!subjectId) {
    return Response.json({ error: "Falta subjectId" }, { status: 400 });
  }

  // El material del currículo es global (user_id null), pero la guarda importa:
  // el día que un colegio suba libros propios, esto impide que cualquier alumno
  // autenticado lea material de otro pasando un uuid.
  const sqlGuard = getSql();
  const [visible] = await sqlGuard`
    select 1 from subjects where id = ${subjectId}::uuid
      and (user_id is null or user_id = ${auth.userId}::uuid)
      -- disabled_at acá y no solo en /api/subjects: esconder la materia de la
      -- lista no alcanza, porque el cliente puede tener el id de antes (pestaña
      -- vieja, historial). Desactivar tiene que impedir el uso, no solo la vista.
      and disabled_at is null`;
  if (!visible) return Response.json({ error: "Materia no disponible" }, { status: 404 });

  let items;
  try {
    items = await buildStudyPlan(subjectId, body.subjectName);
  } catch (err) {
    if (err instanceof SinEstructura) {
      logDecision({ route: "plan", abstained: true, cause: "no_structure", nCitable: err.temas, ms: Date.now() - t0 });
      return Response.json({ items: [] });
    }
    // NO se traga el error. Antes este catch devolvía 200 con títulos genéricos
    // ("Unidad 1 · Lección 2") cuando el LLM fallaba, y eso se ve EXACTAMENTE
    // igual que un plan mal generado: el alumno recibía un plan mecánico y
    // nadie se enteraba de que el proveedor había caído.
    logDecision({ route: "plan", abstained: true, cause: "plan_llm_failed", nCitable: 0, ms: Date.now() - t0 });
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `No pude armar el plan: falló la generación de títulos. ${msg}` },
      { status: 502 },
    );
  }
  logDecision({ route: "plan", abstained: false, cause: "answered", nCitable: items.length, ms: Date.now() - t0 });

  // Cache compartida por materia: el alumno 36 lo recibe instantáneo en vez de
  // pagar otra generación con el LLM de lo mismo.
  //
  // `toJson(...)` y NO `JSON.stringify(...)::jsonb`: con esta conexión lo
  // segundo guarda un STRING de json, no un array, y `jsonb_array_length(items)`
  // —que es de donde sale el "X de Y" del panel— revienta con "cannot get array
  // length of a scalar". Ver packages/db/repair_jsonb_double_encoded.sql.
  await sqlGuard`
    insert into subject_plans (subject_id, items, generated_at)
    values (${subjectId}::uuid, ${toJson(sqlGuard, items)}::jsonb, now())
    on conflict (subject_id) do update set items = excluded.items, generated_at = now()`;

  const hechos = await sqlGuard`
    select topic_key from student_plan_progress
    where user_id = ${auth.userId}::uuid and subject_id = ${subjectId}::uuid`;

  return Response.json({ items, doneKeys: hechos.map((r) => (r as { topic_key: string }).topic_key) });
}
