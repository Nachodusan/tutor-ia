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
