/**
 * Persistencia de las conversaciones.
 *
 * Regla que ordena todo el archivo: **un fallo de la base NUNCA puede romper el
 * chat**. El alumno está esperando una explicación; que no se haya podido
 * guardar el historial es un problema nuestro, no suyo. Por eso todo va en
 * try/catch y los errores se loguean sin propagarse.
 */
import { getSql } from "@tutor-ia/db";

/** Crea la sesión si no existe. Idempotente: el id lo genera la ruta. */
export async function ensureSession(
  sessionId: string,
  userId: string,
  subjectId: string | null,
  title: string | null,
): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      insert into study_sessions (id, user_id, subject_id, mode, title)
      values (${sessionId}::uuid, ${userId}::uuid, ${subjectId}, 'text', ${title})
      on conflict (id) do nothing`;
  } catch (e) {
    console.error("[conversations] no se pudo crear la sesión:", e);
  }
}

export interface MensajeExtra {
  citations?: unknown;
  grounded?: boolean;
  verification?: unknown;
  meta?: unknown;
}

export async function insertMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  extra: MensajeExtra = {},
): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      insert into messages (session_id, role, content, citations, grounded, verification, meta)
      values (
        ${sessionId}::uuid, ${role}, ${content},
        ${extra.citations ? JSON.stringify(extra.citations) : null}::jsonb,
        ${extra.grounded ?? null},
        ${extra.verification ? JSON.stringify(extra.verification) : null}::jsonb,
        ${extra.meta ? JSON.stringify(extra.meta) : null}::jsonb
      )`;
  } catch (e) {
    console.error("[conversations] no se pudo guardar el mensaje:", e);
  }
}
