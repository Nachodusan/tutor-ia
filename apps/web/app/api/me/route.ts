import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

export interface MeResponse {
  user: { id: string; username: string; role: string };
  /** null hasta que el alumno elige su curso la primera vez. */
  profile: { grade: string | null; ttsOn: boolean; ttsVoice: string | null };
}

/**
 * GET /api/me — quién soy y mi perfil. Reemplaza la lectura de `tutor_profile`
 * en localStorage. Devuelve 401 sin sesión: el cliente redirige al login.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const sql = getSql();

  const [u] = await sql<{ username: string | null; role: string }[]>`
    select username, role from users where id = ${auth.userId}::uuid`;
  const [p] = await sql<{ grade: string | null; tts_on: boolean; tts_voice: string | null }[]>`
    select grade, tts_on, tts_voice from student_profiles where user_id = ${auth.userId}::uuid`;

  // Ya no se devuelven "materias prioritarias": el panel muestra TODAS las del
  // curso con el mismo peso. La tabla `student_priority_subjects` sigue en el
  // esquema, vacía y sin escritores — borrarla es una migración aparte, y no
  // urge mientras nada la lea.
  const body: MeResponse = {
    user: { id: auth.userId, username: u?.username ?? "", role: u?.role ?? "student" },
    profile: { grade: p?.grade ?? null, ttsOn: p?.tts_on ?? false, ttsVoice: p?.tts_voice ?? null },
  };
  return Response.json(body);
}
