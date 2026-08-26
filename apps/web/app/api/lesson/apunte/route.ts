import { getSql } from "@tutor-ia/db";
import type { Apunte } from "@tutor-ia/core";

/**
 * GET /api/lesson/apunte?subjectId=…&topicKey=… — el apunte de una parada.
 *
 * SOLO LEE. Se genera offline con el CLI `apuntes`, igual que la clase: el
 * alumno abre y lee, sin spinner y sin gastar una llamada al modelo. Acá pesa
 * más que en la clase, porque de un apunte se estudia VARIAS veces — es la
 * pantalla a la que se vuelve.
 *
 * 404 cuando la parada todavía no tiene apunte. La pantalla lo trata como "esta
 * parada todavía no tiene apunte" y no muestra la pestaña, así que el camino
 * sigue funcionando igual mientras el batch avanza.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get("subjectId");
  const topicKey = searchParams.get("topicKey");
  if (!subjectId || !topicKey) {
    return Response.json({ error: "Falta subjectId o topicKey." }, { status: 400 });
  }

  const sql = getSql();
  const rows = (await sql`
    select apunte from lesson_notes
    where subject_id = ${subjectId} and topic_key = ${topicKey}`) as unknown as { apunte: Apunte }[];

  const fila = rows[0];
  if (!fila) return Response.json({ error: "sin_apunte" }, { status: 404 });

  // El gate NO viaja: es información de auditoría, no del alumno. Ver la misma
  // decisión y su porqué en /api/lesson/clase.
  return Response.json({ apunte: fila.apunte });
}
