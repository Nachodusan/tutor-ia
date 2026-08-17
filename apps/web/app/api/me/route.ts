import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { POMODORO_DEFAULT, type PomodoroConfig } from "@/lib/pomodoro";

export const runtime = "nodejs";

export interface MeResponse {
  user: { id: string; username: string; role: string };
  /** null hasta que el alumno elige su curso la primera vez. */
  profile: {
    grade: string | null; ttsOn: boolean; ttsVoice: string | null;
    /** Id del catálogo de avatares. null = el orbe de Aurora. */
    avatar: string | null;
    /** Siempre viene, con los valores clásicos si el alumno nunca lo tocó: el
     *  reloj del panel tiene que poder dibujarse sin preguntar dos veces. */
    pomodoro: PomodoroConfig;
    /** ISO del último bloque que arrancó, o null. Es lo que evita que el panel
     *  le recuerde estudiar a quien ya está estudiando. */
    pomodoroLastAt: string | null;
  };
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
  const [p] = await sql<{
    grade: string | null; tts_on: boolean; tts_voice: string | null; avatar: string | null;
    pomo_estudio_min: number; pomo_descanso_min: number;
    pomo_hora: string | null; pomo_dias: string; pomo_last_at: Date | null;
  }[]>`
    select grade, tts_on, tts_voice, avatar,
           pomo_estudio_min, pomo_descanso_min, pomo_hora, pomo_dias, pomo_last_at
    from student_profiles where user_id = ${auth.userId}::uuid`;

  // Ya no se devuelven "materias prioritarias": el panel muestra TODAS las del
  // curso con el mismo peso. La tabla `student_priority_subjects` sigue en el
  // esquema, vacía y sin escritores — borrarla es una migración aparte, y no
  // urge mientras nada la lea.
  const body: MeResponse = {
    user: { id: auth.userId, username: u?.username ?? "", role: u?.role ?? "student" },
    profile: {
      grade: p?.grade ?? null, ttsOn: p?.tts_on ?? false, ttsVoice: p?.tts_voice ?? null,
      avatar: p?.avatar ?? null,
      // Sin fila de perfil (alumno que todavía no eligió curso) el reloj sale
      // con los valores clásicos, no vacío: la pantalla no tiene que saber
      // distinguir "no configuró" de "no existe".
      pomodoro: {
        estudioMin: p?.pomo_estudio_min ?? POMODORO_DEFAULT.estudioMin,
        descansoMin: p?.pomo_descanso_min ?? POMODORO_DEFAULT.descansoMin,
        hora: p?.pomo_hora ?? null,
        dias: p?.pomo_dias ?? POMODORO_DEFAULT.dias,
      },
      pomodoroLastAt: p?.pomo_last_at ? p.pomo_last_at.toISOString() : null,
    },
  };
  return Response.json(body);
}
