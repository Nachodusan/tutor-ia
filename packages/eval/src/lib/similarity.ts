/**
 * Similitud coseno con bge-m3 local, para medir REPETICIÓN entre dos respuestas
 * del tutor (eval multiturno): coseno alto entre la explicación 1 y la 2 tras un
 * "no entendí" = el tutor repitió reformulado = fracaso pedagógico.
 *
 * No existía coseno en el repo: pgvector lo calcula en SQL y nada lo hacía en
 * TS. Los vectores del endpoint de Ollama NO vienen normalizados, así que el
 * producto punto solo no alcanza.
 */
import { embed } from "@tutor-ia/rag";

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`vectores incompatibles: ${a.length} vs ${b.length}`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Coseno entre dos textos, embebidos con bge-m3 en una sola llamada. */
export async function textCosine(a: string, b: string): Promise<number> {
  const [va, vb] = await embed([a, b], "document");
  return cosine(va!, vb!);
}
