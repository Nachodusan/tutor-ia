import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/subjects → materias del usuario con grado y área (para el onboarding). */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const userId = auth.userId;
  const sql = getSql();
  const rows = await sql`
    select s.id, s.name,
           -- Las materias fuera de circulación SE DEVUELVEN, marcadas. Antes se
           -- filtraban acá y desaparecían del panel, y eso obligaba a recordar
           -- de memoria cuáles se habían apagado: una materia ausente y una
           -- materia inexistente se ven exactamente igual. El que NO puedan
           -- usarse lo siguen garantizando /api/plan y /api/test, que las
           -- rechazan con 404 aunque el cliente tenga el id.
           (s.disabled_at is not null) as disabled,
           max(d.grade)        as grade,
           max(d.subject_area) as subject_area,
           count(distinct c.id) filter (where c.corpus_role = 'content')  as content_chunks,
           count(distinct c.id) filter (where c.corpus_role = 'pedagogy') as pedagogy_chunks
    from subjects s
    left join documents d on d.subject_id = s.id
    left join chunks c on c.document_id = d.id
    -- El currículo oficial es el MISMO para todos: las materias sin dueño
    -- (user_id null) son globales. La segunda condición deja lugar a que un
    -- colegio suba material propio más adelante.
    where s.user_id is null or s.user_id = ${userId}
    group by s.id, s.name, s.disabled_at
    having count(c.id) > 0
    -- Las desactivadas al final: siguen a la vista, pero no le ganan el lugar a
    -- las que el alumno sí puede abrir.
    order by (s.disabled_at is not null), s.name
  `;
  return Response.json({ subjects: rows });
}
