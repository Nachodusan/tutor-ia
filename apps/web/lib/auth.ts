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
import { readSessionCookie, resolveSession, type SessionInfo } from "./session";

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
