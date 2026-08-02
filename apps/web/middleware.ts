import { NextResponse, type NextRequest } from "next/server";

/**
 * Chequeo OPTIMISTA de sesión. Esto NO es la frontera de seguridad.
 *
 * El middleware corre en el runtime Edge, donde no hay Postgres ni scrypt: no
 * puede validar un token, solo ver si la cookie existe. La validación real vive
 * en `requireUser()` (lib/auth.ts), que cada route handler llama y que sí
 * consulta la base. Acá solo evitamos que el alumno vea la app en blanco antes
 * de que el cliente descubra que no tiene sesión.
 */
const COOKIE = "tutor_session";

export function middleware(req: NextRequest) {
  if (req.cookies.get(COOKIE)) return NextResponse.next();

  // Para las llamadas de datos: 401 JSON. Redirigir un fetch devolvería el HTML
  // del login, que el cliente intentaría parsear como JSON y produciría un error
  // incomprensible.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Público: la página y la ruta de login, y los estáticos de Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/auth/login).*)"],
};
