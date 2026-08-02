import { requireUser } from "@/lib/auth";
import { clearedCookieHeader, revokeSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/auth/logout — revoca ESTA sesión y borra la cookie.
 *
 * Revoca en la base además de limpiar la cookie: si alguien copió el token, que
 * el navegador lo olvide no alcanza.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth) await revokeSession(auth.sessionId);
  // Siempre 204 con la cookie limpia, aun sin sesión válida: "cerrar sesión"
  // nunca puede fallar desde el punto de vista del alumno.
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookieHeader() } });
}
