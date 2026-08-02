import { getSql } from "@tutor-ia/db";
import { DUMMY_HASH, verifyPassword } from "@tutor-ia/core";
import { createSession, sessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/auth/login — body: { username, password }
 *
 * No hay registro: las cuentas las crea el CLI y el colegio reparte usuario y
 * contraseña en papel. Esta es la única ruta pública además de /login.
 */

/**
 * Límite de intentos EN MEMORIA, por usuario y por IP.
 *
 * Hace falta porque las contraseñas son de 4 palabras (~36 bits): sin límite,
 * son forzables. En memoria alcanza para un piloto de un colegio con un solo
 * proceso; si mañana hay varias instancias, esto tiene que ir a la base o a un
 * Redis, porque cada proceso tendría su propio contador.
 */
const intentos = new Map<string, { n: number; hasta: number }>();
const MAX = 6;
const BLOQUEO_MS = 5 * 60_000;

function bloqueado(clave: string): boolean {
  const e = intentos.get(clave);
  if (!e) return false;
  if (Date.now() > e.hasta) { intentos.delete(clave); return false; }
  return e.n >= MAX;
}

function fallo(clave: string): void {
  const e = intentos.get(clave);
  if (!e || Date.now() > e.hasta) intentos.set(clave, { n: 1, hasta: Date.now() + BLOQUEO_MS });
  else e.n++;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (!username || !password) {
    return Response.json({ error: "Falta el usuario o la contraseña." }, { status: 400 });
  }
  if (bloqueado(`u:${username}`) || bloqueado(`ip:${ip}`)) {
    return Response.json(
      { error: "Demasiados intentos. Esperá unos minutos y probá de nuevo." },
      { status: 429 },
    );
  }

  const sql = getSql();
  const [u] = await sql<{ id: string; password_hash: string | null; disabled_at: Date | null }[]>`
    select id, password_hash, disabled_at from users where lower(username) = ${username} limit 1`;

  // Si el usuario no existe se verifica igual contra un hash imposible: sin esto
  // el login responde más rápido ante un usuario inexistente y eso revela qué
  // cuentas existen.
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);

  if (!u || !ok || u.disabled_at) {
    fallo(`u:${username}`);
    fallo(`ip:${ip}`);
    // Mensaje único a propósito: no distingue "no existe" de "contraseña mal".
    return Response.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  intentos.delete(`u:${username}`);
  const { token, expiresAt } = await createSession(u.id);

  const [perfil] = await sql<{ grade: string | null }[]>`
    select grade from student_profiles where user_id = ${u.id}::uuid`;

  return Response.json(
    { user: { id: u.id, username }, needsSetup: !perfil?.grade },
    { headers: { "Set-Cookie": sessionCookieHeader(token, expiresAt) } },
  );
}
