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
