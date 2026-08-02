import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * PUT /api/me/profile — body: { grade?, priority?: string[], ttsOn? }
 *
 * Reemplaza `saveProfile()` de localStorage. NO acepta un nombre: la columna no
 * existe y no debe volver a existir — las cuentas son anónimas por diseño.
 */
export async function PUT(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    grade?: string | null;
    priority?: string[];
    ttsOn?: boolean;
  };
  const sql = getSql();

  await sql`
    insert into student_profiles (user_id, grade, grade_set_at, tts_on)
    values (
      ${auth.userId}::uuid,
      ${body.grade ?? null},
      ${body.grade ? new Date() : null},
      ${body.ttsOn ?? false}
    )
    on conflict (user_id) do update set
      grade        = coalesce(excluded.grade, student_profiles.grade),
      -- Solo se sella la primera vez que se elige el curso.
      grade_set_at = coalesce(student_profiles.grade_set_at, excluded.grade_set_at),
      tts_on       = excluded.tts_on,
      updated_at   = now()`;

  if (Array.isArray(body.priority)) {
    // Reemplazo completo, en una transacción: si falla a mitad, el alumno no
    // queda sin materias prioritarias.
    await sql.begin(async (tx) => {
      await tx`delete from student_priority_subjects where user_id = ${auth.userId}::uuid`;
      for (const [i, sid] of body.priority!.entries()) {
        await tx`
          insert into student_priority_subjects (user_id, subject_id, position)
          values (${auth.userId}::uuid, ${sid}::uuid, ${i})
          on conflict do nothing`;
      }
    });
  }

  return Response.json({ ok: true });
}
