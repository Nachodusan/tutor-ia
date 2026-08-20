/**
 * Autenticación de las rutas. ESTA es la frontera de seguridad.
 *
 * `middleware.ts` solo mejora la experiencia (redirige si no hay cookie): corre
 * en el runtime Edge, donde no hay Postgres ni scrypt, así que no puede validar
 * nada. Toda ruta que toque datos de un alumno tiene que llamar a `requireUser`.
 *
 * Nota histórica, a propósito: acá vivía `getCurrentUserId`, un stub que
 * devolvía siempre el uuid del usuario dev ignorando la request. Se ELIMINÓ en
 * vez de dejarlo como envoltorio, porque mientras existiera, cualquier handler
 * que se olvidara del chequeo iba a seguir "funcionando" contra el usuario dev
 * y el fallo habría sido silencioso. Al borrarlo, el typecheck marca cada sitio
 * que falta migrar.
 */
import { getSql } from "@tutor-ia/db";
import { readSessionCookie, resolveSession, type SessionInfo } from "./session";
import { cursoBloqueado, MENSAJE_CURSO_BLOQUEADO } from "./cursos";

export type Auth = SessionInfo;

/** Devuelve la sesión válida, o null. Nunca tira. */
export async function requireUser(req: Request): Promise<Auth | null> {
  try {
    return await resolveSession(readSessionCookie(req));
  } catch {
    return null;
  }
}

/** 401 con cuerpo JSON estable: el cliente hace fetch, no navega. */
export function unauthorized(): Response {
  return Response.json({ error: "No autenticado" }, { status: 401 });
}

/** 403 para lo que exige rol de administrador (subir material, por ejemplo). */
export function forbidden(msg = "No tenés permiso para esto"): Response {
  return Response.json({ error: msg }, { status: 403 });
}

/**
 * Sesión de un alumno cuyo CURSO está abierto, o la respuesta a devolver.
 *
 *     const auth = await requireCursoAbierto(req);
 *     if (auth instanceof Response) return auth;
 *
 * Va en las rutas que GENERAN o SIRVEN material (chat, plan, prueba, quiz). Sin
 * esto el bloqueo de 1º a 5º sería solo un candado dibujado: el curso vive en el
 * perfil, y un perfil se puede haber quedado en 3º de antes o haberlo puesto el
 * CLI. El que no puedan elegirlo (`PUT /api/me/profile`) tapa la puerta de
 * entrada; esto tapa la ventana.
 *
 * NO se pone en las rutas de CORRECCIÓN (`/api/test/submit`,
 * `/api/lesson/quiz/submit`): esas corrigen algo que la ruta de generación ya
 * tuvo que entregar, así que cerrar la generación las deja sin insumo. Una
 * consulta más por corrección no compraría nada.
 *
 * Devuelve la Response y no `null` por lo mismo que `requireTeacher`: 401 y 403
 * no son lo mismo, y contestarle 401 a un alumno logueado lo mandaría al login
 * en un bucle.
 */
export async function requireCursoAbierto(req: Request): Promise<Auth | Response> {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  // El docente y el admin entran siempre: no estudian con esto, lo revisan.
  if (auth.role === "teacher" || auth.role === "admin") return auth;

  const [p] = await getSql()<{ grade: string | null }[]>`
    select grade from student_profiles where user_id = ${auth.userId}::uuid`;
  if (cursoBloqueado(p?.grade)) return forbidden(MENSAJE_CURSO_BLOQUEADO);
  return auth;
}

/**
 * Sesión con permiso para ver el panel del curso, o la respuesta a devolver.
 *
 *     const auth = await requireTeacher(req);
 *     if (auth instanceof Response) return auth;
 *
 * Devuelve la Response y no `null` porque 401 y 403 NO son lo mismo acá: un
 * alumno logueado que pega en /api/teacher tiene sesión válida, y contestarle
 * 401 haría que el cliente lo mandara al login en un bucle. Colapsar los dos
 * casos en null obligaba a cada handler a rehacer la distinción.
 *
 * `admin` entra también: quien administra el material del colegio necesita poder
 * comprobar que el panel muestra lo que tiene que mostrar, y negárselo lo
 * empujaría a crearse una cuenta docente paralela.
 *
 * Lo que este chequeo NO da es acceso a las conversaciones: no hay ninguna ruta
 * bajo /api/teacher que lea `messages`. La privacidad del alumno no depende del
 * rol, depende de que ese dato no se sirva.
 */
export async function requireTeacher(req: Request): Promise<Auth | Response> {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  if (auth.role !== "teacher" && auth.role !== "admin") {
    return forbidden("Esta sección es para docentes.");
  }
  return auth;
}

/**
 * Rechaza una materia SACADA DE CIRCULACIÓN, o `null` si se puede seguir.
 *
 *     const apagada = await rechazarMateriaApagada(body.subjectId, auth);
 *     if (apagada) return apagada;
 *
 * Va en las rutas que SIRVEN o GENERAN material a partir de una materia: chat,
 * plan, examen. Hasta ahora no estaba en ninguna, y `subjects.disabled_at` era
 * un candado dibujado: el panel gris la materia apagada, pero un GET a
 * `/api/plan?subjectId=…` devolvía el plan cacheado entero y un POST a
 * `/api/chat` contestaba con el libro. Medido el 2026-08-19: 20 de las 32
 * materias apagadas tenían plan cacheado servible.
 *
 * `requireCursoAbierto` NO cubre esto y es fácil confundirlo: ese mira el curso
 * del ALUMNO (`student_profiles.grade`), no la materia que pide. Un alumno de 1º
 * Medio con el curso abierto entra igual a cualquier materia apagada.
 *
 * Docente y admin pasan: el admin tiene que poder revisar el material de una
 * materia apagada —para eso la apagó— y el docente ve avance de materias que
 * pueden haberse sacado de circulación después.
 *
 * `subjectId` nulo o vacío NO es un error: el chat en modo general no lleva
 * materia, y ahí no hay nada que bloquear.
 */
export async function rechazarMateriaApagada(
  subjectId: string | null | undefined,
  auth: Auth,
): Promise<Response | null> {
  if (!subjectId) return null;
  if (auth.role === "teacher" || auth.role === "admin") return null;
  const [m] = await getSql()<{ apagada: boolean }[]>`
    select (disabled_at is not null) as apagada
    from subjects where id = ${subjectId}::uuid`;
  // Materia inexistente: que siga y falle donde corresponda (404 o "sin
  // material"). Este guard responde por una sola cosa, no por la validación del id.
  if (!m?.apagada) return null;
  return forbidden(
    "Esta materia no está disponible por ahora. Estamos revisando su material.",
  );
}
