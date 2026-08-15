import { buildCustomPlan, SinEstructura, logDecision, normalizeStudentQuery } from "@tutor-ia/core";
import { retrieveHybrid } from "@tutor-ia/rag";
import { getSql, toJson } from "@tutor-ia/db";
import { requireCursoAbierto, requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Candidatos del retrieval que alimentan la selección de lecciones. Alto a
 *  propósito: acá no se le muestra nada al alumno, se buscan las LECCIONES donde
 *  cayeron los resultados, y un pool chico deja el plan con dos temas. */
const POOL = 60;
/** Tope de planes guardados por alumno. Sin esto la lista crece sin fin y deja
 *  de ser útil como "mis planes". */
const MAX_PLANES = 12;

/**
 * GET /api/plan/custom            → los planes a medida del alumno.
 * GET /api/plan/custom?id=…       → uno, con sus temas y qué marcó como hecho.
 *
 * El plan SUGERIDO (`/api/plan`) sigue existiendo igual: sale del índice del
 * libro del curso y es el mismo para todos. Este es el otro camino — el alumno
 * pide los contenidos que quiere.
 */
export async function GET(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const sql = getSql();
  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const [plan] = await sql<{ id: string; query: string; title: string; items: unknown }[]>`
      select id, query, title, items from student_custom_plans
      where id = ${id}::uuid and user_id = ${auth.userId}::uuid`;
    if (!plan) return Response.json({ error: "No encontrado" }, { status: 404 });
    const hechos = await sql<{ topic_key: string }[]>`
      select topic_key from student_plan_progress
      where user_id = ${auth.userId}::uuid and topic_key like ${`${id}:%`}`;
    return Response.json({
      plan: { id: plan.id, query: plan.query, title: plan.title, items: plan.items },
      // Se devuelven SIN el prefijo del plan: el cliente trabaja con la clave
      // del tema y no tiene por qué saber cómo se namespacea.
      doneKeys: hechos.map((h) => h.topic_key.slice(id.length + 1)),
    });
  }

  const planes = await sql<{ id: string; title: string; query: string; n: number; created_at: Date }[]>`
    select id, title, query, jsonb_array_length(items)::int as n, created_at
    from student_custom_plans where user_id = ${auth.userId}::uuid
    order by created_at desc`;
  return Response.json({
    plans: planes.map((p) => ({
      id: p.id, title: p.title, query: p.query, items: p.n,
      createdAt: new Date(p.created_at).toISOString(),
    })),
  });
}

/**
 * POST /api/plan/custom — body: { query, subjectId? }
 *
 * Arma un plan con lo que el alumno pidió. Los temas NO se inventan: se busca en
 * el corpus y se devuelven las LECCIONES reales donde cayeron los resultados,
 * con su título y sus páginas. Si el pedido no cae en ninguna lección
 * identificable, no se entrega un plan improvisado — se dice que no se pudo.
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const body = (await req.json().catch(() => ({}))) as { query?: string; subjectId?: string | null };
  const query = (body.query ?? "").trim();
  if (query.length < 3) {
    return Response.json({ error: "Contame un poco más de qué querés que sea el plan." }, { status: 400 });
  }

  const sql = getSql();

  // Alcance: si el pedido viene desde una materia, se busca en TODA su
  // asignatura (todos los cursos), no solo en el libro del curso. Es justamente
  // el caso de "quiero repasar fracciones" desde 8º: lo que sirve puede estar en
  // 5º. Sin materia, todo el corpus.
  let subjectIds: string[] | null = null;
  if (body.subjectId) {
    const fam = await sql<{ id: string }[]>`
      select s2.id from subjects s1
      join subjects s2 on s2.family = s1.family
      where s1.id = ${body.subjectId}::uuid and s1.family is not null
        and s2.disabled_at is null
        and (s2.user_id is null or s2.user_id = ${auth.userId}::uuid)`;
    subjectIds = fam.length ? fam.map((r) => r.id) : [body.subjectId];
  }

  // PUENTE DE VOCABULARIO, con la política CRUDA-PRIMERO que el repo ya midió
  // para el chat: se busca con la formulación del alumno TAL CUAL, y solo si no
  // alcanza se reescribe a registro de libro y se reintenta.
  //
  // Probé normalizar siempre y lo empeoró, igual que en su momento en el chat:
  // "cómo se arma un argumento para convencer" pasó de 5 lecciones (1 al blanco)
  // a 3 (0 al blanco) — la reescritura reordena el top y tira aciertos. Es la
  // misma conclusión que ya está documentada en getTeachingContext, y no había
  // razón para que este camino fuera distinto.
  const buscar = async (q: string) => {
    const chunks = await retrieveHybrid(q, {
      userId: auth.userId,
      subjectIds,
      corpusRole: "content",
      poolPerSide: POOL,
      k: POOL,
    });
    return chunks.map((c) => ({ documentId: c.documentId, pageStart: c.pageStart, pageEnd: c.pageEnd }));
  };

  let chunks = await buscar(query);
  let usada = query;

  let items;
  try {
    items = await buildCustomPlan(chunks, usada);
  } catch (err) {
    // Solo si la cruda no dio para un plan se paga la reescritura y se reintenta.
    if (err instanceof SinEstructura) {
      const n = await normalizeStudentQuery(query).catch(() => null);
      if (n?.changed) {
        try {
          chunks = await buscar(n.query);
          usada = n.query;
          items = await buildCustomPlan(chunks, usada);
        } catch { /* cae al 422 de abajo */ }
      }
    }
    if (!items && err instanceof SinEstructura) {
      logDecision({ route: "plan", abstained: true, cause: "no_structure", nCitable: err.temas, ms: Date.now() - t0 });
      return Response.json({
        error: "No encontré suficientes lecciones sobre eso en tus libros. Probá con otras palabras o con un tema más amplio.",
      }, { status: 422 });
    }
    logDecision({ route: "plan", abstained: true, cause: "plan_llm_failed", ms: Date.now() - t0 });
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `No pude armar el plan. ${msg}` }, { status: 502 });
  }
  logDecision({ route: "plan", abstained: false, cause: "answered", nCitable: items.length, ms: Date.now() - t0 });

  const [row] = await sql<{ id: string }[]>`
    insert into student_custom_plans (user_id, subject_id, query, title, items)
    values (${auth.userId}::uuid, ${body.subjectId ?? null}, ${query},
            ${query.slice(0, 80)}, ${toJson(sql, items)}::jsonb)
    returning id`;

  // Poda: se conservan los últimos MAX_PLANES. El progreso de los borrados cae
  // con ellos porque la clave lleva el id del plan adelante.
  const viejos = await sql<{ id: string }[]>`
    delete from student_custom_plans
    where user_id = ${auth.userId}::uuid
      and id not in (
        select id from student_custom_plans where user_id = ${auth.userId}::uuid
        order by created_at desc limit ${MAX_PLANES})
    returning id`;
  for (const v of viejos) {
    await sql`delete from student_plan_progress
              where user_id = ${auth.userId}::uuid and topic_key like ${`${v.id}:%`}`;
  }

  return Response.json({ id: row!.id, query, items });
}

/** DELETE /api/plan/custom?id=… — el alumno borra un plan suyo. */
export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Falta id" }, { status: 400 });
  const sql = getSql();
  const borrados = await sql`
    delete from student_custom_plans
    where id = ${id}::uuid and user_id = ${auth.userId}::uuid returning id`;
  if (borrados.length === 0) return Response.json({ error: "No encontrado" }, { status: 404 });
  await sql`delete from student_plan_progress
            where user_id = ${auth.userId}::uuid and topic_key like ${`${id}:%`}`;
  return Response.json({ ok: true });
}
