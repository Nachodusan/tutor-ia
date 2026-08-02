import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/conversations[?subjectId=…] → las charlas del alumno.
 * GET /api/conversations?id=…          → los mensajes de una charla.
 *
 * Siempre acotado por `user_id`: un alumno no puede leer la conversación de
 * otro ni pasando el uuid.
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
