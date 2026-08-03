/**
 * Persistencia de las conversaciones.
 *
 * Regla que ordena todo el archivo: **un fallo de la base NUNCA puede romper el
 * chat**. El alumno está esperando una explicación; que no se haya podido
 * guardar el historial es un problema nuestro, no suyo. Por eso todo va en
 * try/catch y los errores se loguean sin propagarse.
 */
import { getSql, toJson } from "@tutor-ia/db";

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
    // `toJson(...)` y NO `JSON.stringify(...)::jsonb`: con esta conexión lo
    // segundo guarda un STRING de json, así que `verification` —el dato que el
    // esquema llama "lo más valioso del export", los veredictos del verificador
    // por oración— quedaba escapado y no se podía consultar con operadores jsonb.
    // El ternario se mantiene para que ausente sea NULL de SQL y no jsonb 'null'.
    await sql`
      insert into messages (session_id, role, content, citations, grounded, verification, meta)
      values (
        ${sessionId}::uuid, ${role}, ${content},
        ${extra.citations ? toJson(sql, extra.citations) : null}::jsonb,
        ${extra.grounded ?? null},
        ${extra.verification ? toJson(sql, extra.verification) : null}::jsonb,
        ${extra.meta ? toJson(sql, extra.meta) : null}::jsonb
      )`;
  } catch (e) {
    console.error("[conversations] no se pudo guardar el mensaje:", e);
  }
}
