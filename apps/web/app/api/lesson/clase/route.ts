import { getSql } from "@tutor-ia/db";
import type { Clase } from "@tutor-ia/core";

/**
 * GET /api/lesson/clase?subjectId=…&topicKey=… — la clase de una parada.
 *
 * SOLO LEE. La clase se genera offline con el CLI `clases` y esta ruta no llama
 * al modelo ni al sidecar: el alumno abre la parada y la ve en 0 ms, contra los
 * ~50 segundos de spinner que paga hoy la primera visita de cada lección.
 *
 * Ese es el punto entero de precomputar, y trae de yapa lo que ninguna versión
 * en vivo puede dar: la clase es un catálogo finito que un humano puede leer
 * ANTES que un alumno, y corregir con un update.
 *
 * 404 cuando la parada todavía no tiene clase generada — que hoy son casi todas.
 * La pantalla lo trata como "esta parada aún no tiene clase" y va derecho a las
 * preguntas, así que el camino sigue funcionando igual mientras el batch avanza.
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
    select clase, gate from lesson_classes
    where subject_id = ${subjectId} and topic_key = ${topicKey}`) as unknown as {
    clase: Clase; gate: unknown;
  }[];

  const fila = rows[0];
  if (!fila) return Response.json({ error: "sin_clase" }, { status: 404 });

  // El gate NO viaja al cliente: es información de auditoría, no del alumno. Que
  // la pantalla dijera "3 de 6 afirmaciones respaldadas" convertiría una métrica
  // interna en una nota de confianza, y la NLI no está calibrada para eso —
  // reconoce contradicciones, pero da neutral en una paráfrasis correcta.
  return Response.json({ clase: fila.clase });
}
