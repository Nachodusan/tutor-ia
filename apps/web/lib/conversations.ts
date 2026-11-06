/**
 * Persistencia de las conversaciones.
 *
 * Regla que ordena todo el archivo: **un fallo de la base NUNCA puede romper el
 * chat**. El alumno está esperando una explicación; que no se haya podido
 * guardar el historial es un problema nuestro, no suyo. Por eso todo va en
 * try/catch y los errores se loguean sin propagarse.
 */
import { getSql, toJson } from "@tutor-ia/db";

/** El tope del título. Lo comparte con el renombrado de `/api/conversations`. */
export const TITULO_MAX = 80;

/**
 * ARRANQUES QUE NO DICEN NADA, y por qué se sacan.
 *
 * El título salía de `question.slice(0, 80)` y por eso 38 de 337 empiezan con
 * "Explicame", 13 con "Hola" y 9 con "Profe". En una lista de veinte, todas
 * empezando igual, el ojo no encuentra ninguna: lo que distingue una charla de
 * otra está DESPUÉS del saludo.
 *
 * ⚠️ Las palabras de pregunta NO están en esta lista, a propósito. "¿Qué es la
 * fotosíntesis?" es un título perfecto; sacarle el "qué es" deja "la
 * fotosíntesis", que dice menos. Se sacan los SALUDOS y los PEDIDOS, no la
 * pregunta.
 */
const ARRANQUES = [
  /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches)[\s,.:!¡]+/i,
  /^(profe|profesor|profesora|tutor)[\s,.:!¡]+/i,
  /^(por favor|porfa|porfis)[\s,.:!¡]+/i,
  /^(me pod[eé]s|me puedes|pod[eé]s|puedes|podr[ií]as|me podr[ií]as)\s+(explicar|ayudar con|decir|contar)\s*/i,
  /^(quiero|necesito|me gustar[ií]a)\s+(saber|entender|aprender|que me expliques)\s*/i,
  /^(explicame|expl[ií]came|explicame por favor|expl[ií]queme|explique)\s*/i,
  /^(ay[uú]dame con|ayuda con|ayudame)\s*/i,
  /^(no entiendo (nada de|bien)?)\s*/i,
];

/** La cortesía del final. "La fotosíntesis por favor" no es un título. */
const CIERRES = [
  /[\s,]*(por favor|porfa|porfis|please)[\s.!?¡]*$/i,
  /[\s,]*(gracias|muchas gracias|graciasss?)[\s.!?¡]*$/i,
];

/**
 * El título de una charla, a partir de la primera pregunta.
 *
 * Cuatro cosas, y ninguna es cosmética:
 *  1. saca el saludo o el pedido (ver ARRANQUES);
 *  2. saca los signos de apertura y el cierre, que en una lista son ruido;
 *  3. **corta en el espacio, no en la letra** — hoy 58 de 337 títulos tocan el
 *     tope de 80 y quedan partidos al medio de una palabra ("…y su impacto en
 *     la socied");
 *  4. arranca en mayúscula.
 *
 * Si después de limpiar no queda nada (el alumno escribió solo "hola"), se
 * devuelve la pregunta original recortada: un título feo es mejor que ninguno.
 */
export function tituloDeConversacion(pregunta: string): string {
  const original = pregunta.trim().replace(/\s+/g, " ");
  let t = original;

  // Los arranques se sacan en bucle: "Hola profe, explicame…" son tres capas.
  for (let i = 0; i < 3; i++) {
    const antes = t;
    for (const re of ARRANQUES) t = t.replace(re, "");
    for (const re of CIERRES) t = t.replace(re, "");
    if (t === antes) break;
  }

  t = t.replace(/^[¿¡\s]+/, "").replace(/[?!.\s]+$/, "").trim();
  if (t.length < 3) t = original.replace(/^[¿¡\s]+/, "").replace(/[?!.\s]+$/, "").trim();
  if (!t) return original.slice(0, TITULO_MAX);

  if (t.length > TITULO_MAX) {
    const corte = t.lastIndexOf(" ", TITULO_MAX);
    // Un espacio demasiado temprano deja un título mocho; ahí conviene cortar
    // duro antes que devolver dos palabras de una pregunta de quince.
    t = (corte > TITULO_MAX * 0.6 ? t.slice(0, corte) : t.slice(0, TITULO_MAX)).trimEnd();
  }

  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
