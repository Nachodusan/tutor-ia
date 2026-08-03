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
  // Cada uno a SU puerta. Sin esto, el profe que escribe /docente sin sesión
  // aterrizaba en la pantalla del alumno ("Entrá a estudiar", "pedile la
  // contraseña a tu profe") y no tenía forma de saber que se había equivocado
  // de lugar — parecía que el panel del curso no existía.
  const url = req.nextUrl.clone();
  url.pathname = req.nextUrl.pathname.startsWith("/docente") ? "/login/docente" : "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Público: los estáticos de Next y todo lo que empieza con `login` — que
  // incluye `/login/docente`, la puerta del profe, sin necesidad de otra regla.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/auth/login).*)"],
};
