import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET    /api/conversations[?subjectId=…] → las charlas del alumno.
 * GET    /api/conversations?id=…          → los mensajes de una charla.
 * PATCH  /api/conversations               → renombrar una charla.
 * DELETE /api/conversations?id=…          → borrarla (los mensajes van por cascade).
 *
 * Siempre acotado por `user_id`: un alumno no puede leer, renombrar ni borrar
 * la conversación de otro ni pasando el uuid. El `where user_id` va en TODAS,
 * no solo en el GET — es la única barrera que hay.
 *
 * ⚠️ Y lo que esta ruta NO expone, a propósito: no hay forma de listar las
 * conversaciones de otro alumno. El docente ve avance y temas difíciles
 * (`/api/teacher/overview`), nunca las charlas.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const sql = getSql();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const [ses] = await sql<{ id: string }[]>`
      select id from study_sessions
      where id = ${id}::uuid and user_id = ${auth.userId}::uuid`;
    if (!ses) return Response.json({ error: "No encontrada" }, { status: 404 });

    const msgs = await sql<{
      role: string; content: string; citations: unknown; grounded: boolean | null;
      verification: unknown; created_at: Date;
    }[]>`
      select role, content, citations, grounded, verification, created_at
      from messages where session_id = ${id}::uuid order by ord`;
    return Response.json({ messages: msgs });
  }

  const subjectId = url.searchParams.get("subjectId");
  const sesiones = await sql<{
    id: string; subject_id: string | null; title: string | null;
    last_message_at: Date; n: string;
  }[]>`
    select s.id, s.subject_id, s.title, s.last_message_at,
           count(m.id)::text as n
    from study_sessions s
    left join messages m on m.session_id = s.id
    where s.user_id = ${auth.userId}::uuid
      ${subjectId ? sql`and s.subject_id = ${subjectId}::uuid` : sql``}
    group by s.id
    having count(m.id) > 0
    order by s.last_message_at desc
    limit 50`;

  return Response.json({
    conversations: sesiones.map((s) => ({
      id: s.id,
      subjectId: s.subject_id,
      title: s.title,
      messages: Number(s.n),
      lastAt: new Date(s.last_message_at).toISOString(),
    })),
  });
}

/** El tope del título. Lo comparte el renombrado con el que arma la ruta del chat. */
const TITULO_MAX = 80;

/**
 * PATCH /api/conversations  { id, title } → renombrar.
 *
 * Existe porque el título automático sale de la primera pregunta y a veces
 * queda mal ("Explicame Lo que el programa pide y tu libro no cubre"). El
 * alumno tiene que poder arreglarlo: es SU historial.
 *
 * Un título vacío vuelve al automático (NULL), no guarda una cadena vacía —
 * si no, la lista mostraría filas sin nombre y no habría cómo recuperarlas.
 */
export async function PATCH(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  let body: { id?: string; title?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Cuerpo inválido" }, { status: 400 }); }
  if (!body.id) return Response.json({ error: "Falta el id" }, { status: 400 });

  const limpio = (body.title ?? "").trim().slice(0, TITULO_MAX);
  const sql = getSql();
  const [fila] = await sql<{ id: string; title: string | null }[]>`
    update study_sessions
       set title = ${limpio || null}
     where id = ${body.id}::uuid and user_id = ${auth.userId}::uuid
    returning id, title`;

  if (!fila) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ id: fila.id, title: fila.title });
}

/**
 * DELETE /api/conversations?id=… → borrar una charla.
 *
 * `messages` cae por el `on delete cascade` de su clave foránea, así que no
 * hace falta borrarlos a mano: borrarlos por separado abriría la ventana en la
 * que la sesión ya no está y los mensajes sí.
 */
export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Falta el id" }, { status: 400 });

  const sql = getSql();
  const [fila] = await sql<{ id: string }[]>`
    delete from study_sessions
     where id = ${id}::uuid and user_id = ${auth.userId}::uuid
    returning id`;

  if (!fila) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ ok: true });
}
