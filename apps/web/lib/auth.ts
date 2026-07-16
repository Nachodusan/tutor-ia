/**
 * Autenticación — STUB para el andamiaje (Fase 0/1).
 *
 * En producción esto debe resolver el usuario autenticado desde Supabase Auth
 * (o Clerk) leyendo la cookie/sesión de la request. Por ahora devolvemos un
 * usuario de desarrollo para poder probar el flujo end-to-end.
 *
 * TODO (Fase 1): reemplazar por la verificación real de sesión y eliminar el
 * fallback DEV_USER_ID.
 */
const DEV_USER_ID = process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

export async function getCurrentUserId(_req: Request): Promise<string> {
  // Reemplazar: leer JWT/cookie de Supabase y devolver el user id real.
  return DEV_USER_ID;
}
