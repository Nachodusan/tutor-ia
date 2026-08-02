/**
 * Sesiones de login: token opaco en cookie, estado en la base.
 *
 * Por qué en la base y no un JWT firmado: las credenciales se reparten en papel
 * a menores, y el requisito es poder REVOCAR una que se filtre. Un JWT stateless
 * no se revoca — para hacerlo hace falta una denylist consultada en cada request,
 * que es esta misma tabla con pasos de más. El argumento clásico a favor del JWT
 * (evitar el round-trip a la base) vale ~0,2 ms contra rutas que tardan entre 10
 * y 60 segundos generando con el modelo.
 */
import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@tutor-ia/db";

export const COOKIE = "tutor_session";

const DIAS = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};
/** Vida máxima de la sesión, aunque se use todos los días. */
const TTL_DIAS = DIAS(process.env.SESSION_TTL_DAYS, 30);
/** Vida por inactividad: sin usarla, muere antes que el TTL absoluto. */
const IDLE_DIAS = DIAS(process.env.SESSION_IDLE_DAYS, 14);
/** Cada cuánto se refresca `last_seen_at`. Sin esto sería un UPDATE por request. */
const REFRESCO_MS = 60 * 60 * 1000;

/**
 * `Secure` NO puede ir fijo en true: si sirven por la red del colegio
 * (http://192.168.x.x:3000) el navegador no manda una cookie Secure y NADIE
 * puede loguearse. Va por env para que la decisión sea explícita y consciente.
 * Ver el riesgo documentado en el plan: sin HTTPS la cookie viaja en claro.
 */
const SECURE = process.env.SESSION_COOKIE_SECURE === "1";

const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

export interface SessionInfo {
  userId: string;
  sessionId: string;
  role: string;
}

/** Crea una sesión y devuelve el token CRUDO (la base guarda solo su sha256). */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const sql = getSql();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DIAS * 86400_000);
  await sql`
    insert into auth_sessions (user_id, token_hash, expires_at)
    values (${userId}::uuid, ${hashToken(token)}, ${expiresAt})`;
  return { token, expiresAt };
}

/**
 * Valida el token. Devuelve null si no existe, venció, fue revocado, la cuenta
 * está deshabilitada, o si pasó el plazo de inactividad.
 *
 * Refresca `last_seen_at` como mucho una vez por hora: sin ese estrangulamiento
 * sería un UPDATE en cada request del chat.
 */
export async function resolveSession(token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const sql = getSql();
  const [row] = await sql<{
    id: string; user_id: string; role: string; last_seen_at: Date;
  }[]>`
    select s.id, s.user_id, u.role, s.last_seen_at
    from auth_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and s.last_seen_at > now() - make_interval(days => ${IDLE_DIAS})
      and u.disabled_at is null
    limit 1`;
  if (!row) return null;

  if (Date.now() - new Date(row.last_seen_at).getTime() > REFRESCO_MS) {
    await sql`
      update auth_sessions
         set last_seen_at = now(),
             expires_at   = now() + make_interval(days => ${TTL_DIAS})
       where id = ${row.id}::uuid`;
  }
  return { userId: row.user_id, sessionId: row.id, role: row.role };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql`update auth_sessions set revoked_at = now() where id = ${sessionId}::uuid and revoked_at is null`;
}

/** Todas las sesiones de un usuario. Lo llama el CLI al resetear una contraseña:
 *  si se resetea porque se filtró, dejar viva la sesión del que la tenía sería
 *  hacer el reset inútil. */
export async function revokeAllForUser(userId: string): Promise<void> {
  const sql = getSql();
  await sql`update auth_sessions set revoked_at = now() where user_id = ${userId}::uuid and revoked_at is null`;
}

export function sessionCookieHeader(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    // Lax y no Strict: con Strict, llegar desde cualquier link externo muestra la
    // app deslogueada aunque la sesión esté viva. Todo cambio de estado es un
    // POST same-origin, así que Lax no abre nada.
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(SECURE ? ["Secure"] : []),
  ].join("; ");
}

export function clearedCookieHeader(): string {
  return [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(SECURE ? ["Secure"] : [])].join("; ");
}

/** Lee la cookie del header sin dependencias. */
export function readSessionCookie(req: Request): string {
  const raw = req.headers.get("cookie") ?? "";
  for (const parte of raw.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return "";
}
