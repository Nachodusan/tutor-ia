import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * PUT /api/me/profile — body: { grade?, ttsOn? }
 *
 * Reemplaza `saveProfile()` de localStorage. NO acepta un nombre: la columna no
 * existe y no debe volver a existir — las cuentas son anónimas por diseño.
 *
 * Tampoco acepta ya `priority`: el panel muestra TODAS las materias del curso
 * con el mismo peso, así que no hay nada que priorizar. Se dejó de aceptar en
 * vez de ignorarlo en silencio — un campo que se manda y no hace nada es peor
 * que uno que no existe.
 */
export async function PUT(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    grade?: string | null;
    ttsOn?: boolean;
    ttsVoice?: string | null;
  };
  const sql = getSql();

  // CADA CAMPO SE ACTUALIZA SOLO SI VINO. Antes `tts_on` era
  // `excluded.tts_on` con `body.ttsOn ?? false` detrás: guardar el CURSO
  // apagaba la lectura en voz alta, porque el cuerpo no traía `ttsOn` y el
  // `?? false` lo escribía igual. Con `null` + `coalesce`, lo que no se manda
  // no se toca — que es lo que espera cualquiera que llame a esta ruta para
  // cambiar una sola cosa.
  await sql`
    insert into student_profiles (user_id, grade, grade_set_at, tts_on, tts_voice)
    values (
      ${auth.userId}::uuid,
      ${body.grade ?? null},
      ${body.grade ? new Date() : null},
      ${body.ttsOn ?? false},
      ${body.ttsVoice ?? null}
    )
    on conflict (user_id) do update set
      grade        = coalesce(excluded.grade, student_profiles.grade),
      -- Solo se sella la primera vez que se elige el curso.
      grade_set_at = coalesce(student_profiles.grade_set_at, excluded.grade_set_at),
      tts_on       = coalesce(${body.ttsOn ?? null}::boolean, student_profiles.tts_on),
      tts_voice    = coalesce(excluded.tts_voice, student_profiles.tts_voice),
      updated_at   = now()`;

  return Response.json({ ok: true });
}
