import { getSql } from "@tutor-ia/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/subjects → materias del usuario (para elegir qué estudiar). */
export async function GET(req: Request) {
  const userId = await getCurrentUserId(req);
  const sql = getSql();
  const rows = await sql`
    select s.id, s.name,
           count(distinct c.id) filter (where c.corpus_role = 'content')  as content_chunks,
           count(distinct c.id) filter (where c.corpus_role = 'pedagogy') as pedagogy_chunks
    from subjects s
    left join documents d on d.subject_id = s.id
    left join chunks c on c.document_id = d.id
    where s.user_id = ${userId}
    group by s.id, s.name
    order by s.name
  `;
  return Response.json({ subjects: rows });
}
