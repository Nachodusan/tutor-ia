import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { cursoBloqueado, MENSAJE_CURSO_BLOQUEADO } from "@/lib/cursos";
import { HORA_RE, limpiarDias, POMO_TOPES, type PomodoroConfig } from "@/lib/pomodoro";
import { avatarValido } from "@/app/avatares";

export const runtime = "nodejs";

/**
 * PUT /api/me/profile — body: { grade?, ttsOn?, ttsVoice?, pomodoro?,
 *                               pomodoroIniciado?, avatar? }
 *
 * Reemplaza `saveProfile()` de localStorage. NO acepta un nombre: la columna no
 * existe y no debe volver a existir — las cuentas son anónimas por diseño. El
 * `avatar` es la única personalización que hay, y es un id del catálogo: un
 * dibujito no dice quién sos, una foto sí.
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
    pomodoro?: Partial<PomodoroConfig>;
    /** El alumno acaba de arrancar un bloque: sella `pomo_last_at`. */
    pomodoroIniciado?: boolean;
    /** Id del catálogo de avatares. Lo que no esté en el catálogo se ignora. */
    avatar?: string | null;
  };
  const sql = getSql();

  // ESTA es la puerta de entrada del bloqueo de 1º a 5º básico. El onboarding ya
  // dibuja el candado, pero el candado del dibujo lo saltea cualquiera con un
  // fetch: el curso es lo que decide qué material se sirve y con qué lenguaje se
  // le habla a un menor, así que se valida donde se escribe.
  if (cursoBloqueado(body.grade)) {
    return Response.json({ error: MENSAJE_CURSO_BLOQUEADO }, { status: 403 });
  }

  // ── Pomodoro ──────────────────────────────────────────────────────────────
  // Los minutos se RECORTAN a rango en vez de rechazarse: no hay forma de
  // mandar un 200 desde la pantalla (son botones con valores fijos), así que un
  // número raro es un cliente viejo o alguien probando, y lo sano es guardar
  // algo usable. La HORA sí se rechaza: no hay recorte razonable de "25:99", y
  // guardar null en silencio le apagaría el recordatorio sin que se entere.
  const p = body.pomodoro;
  const enRango = (v: number | undefined, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;
  const estudio = enRango(p?.estudioMin, POMO_TOPES.estudioMin, POMO_TOPES.estudioMax);
  const descanso = enRango(p?.descansoMin, POMO_TOPES.descansoMin, POMO_TOPES.descansoMax);

  // `"hora" in p` y no `p.hora != null`: mandar `hora: null` es QUITAR el
  // horario, y eso tiene que poder distinguirse de no mandar el campo.
  const tocaHora = !!p && "hora" in p;
  const hora = p?.hora ?? null;
  if (tocaHora && hora !== null && !HORA_RE.test(hora)) {
    return Response.json({ error: "La hora tiene que ser HH:MM." }, { status: 400 });
  }
  const dias = typeof p?.dias === "string" ? limpiarDias(p.dias) : null;

  // EL AVATAR SE VALIDA CONTRA EL CATÁLOGO, no se guarda lo que venga. Lo que
  // llega es una CLAVE de la lista blanca: sin eso, cualquiera podría dejar el
  // texto que quisiera pintado en su fila del panel del docente. Un id
  // desconocido se ignora en silencio —no es un error del alumno, es un cliente
  // viejo— y `null` explícito vuelve al orbe de Aurora.
  const tocaAvatar = "avatar" in body && (body.avatar === null || avatarValido(body.avatar));
  const avatar = avatarValido(body.avatar) ? body.avatar : null;

  // CADA CAMPO SE ACTUALIZA SOLO SI VINO. Antes `tts_on` era
  // `excluded.tts_on` con `body.ttsOn ?? false` detrás: guardar el CURSO
  // apagaba la lectura en voz alta, porque el cuerpo no traía `ttsOn` y el
  // `?? false` lo escribía igual. Con `null` + `coalesce`, lo que no se manda
  // no se toca — que es lo que espera cualquiera que llame a esta ruta para
  // cambiar una sola cosa.
  await sql`
    insert into student_profiles (
      user_id, grade, grade_set_at, tts_on, tts_voice,
      pomo_estudio_min, pomo_descanso_min, pomo_hora, pomo_dias, pomo_last_at, avatar
    )
    values (
      ${auth.userId}::uuid,
      ${body.grade ?? null},
      ${body.grade ? new Date() : null},
      ${body.ttsOn ?? false},
      ${body.ttsVoice ?? null},
      coalesce(${estudio}::smallint, 25),
      coalesce(${descanso}::smallint, 5),
      ${hora},
      coalesce(${dias}::text, '12345'),
      ${body.pomodoroIniciado ? new Date() : null},
      ${avatar}
    )
    on conflict (user_id) do update set
      grade        = coalesce(excluded.grade, student_profiles.grade),
      -- Solo se sella la primera vez que se elige el curso.
      grade_set_at = coalesce(student_profiles.grade_set_at, excluded.grade_set_at),
      tts_on       = coalesce(${body.ttsOn ?? null}::boolean, student_profiles.tts_on),
      tts_voice    = coalesce(excluded.tts_voice, student_profiles.tts_voice),
      pomo_estudio_min  = coalesce(${estudio}::smallint, student_profiles.pomo_estudio_min),
      pomo_descanso_min = coalesce(${descanso}::smallint, student_profiles.pomo_descanso_min),
      pomo_hora    = case when ${tocaHora}::boolean then ${hora}::text else student_profiles.pomo_hora end,
      pomo_dias    = coalesce(${dias}::text, student_profiles.pomo_dias),
      pomo_last_at = coalesce(excluded.pomo_last_at, student_profiles.pomo_last_at),
      avatar       = case when ${tocaAvatar}::boolean then ${avatar}::text else student_profiles.avatar end,
      updated_at   = now()`;

  return Response.json({ ok: true });
}
