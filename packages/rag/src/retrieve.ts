/**
 * Recuperación (retrieval): dado una consulta en texto, devuelve los fragmentos
 * más relevantes del material del usuario (y globales) vía la función SQL
 * match_chunks() del esquema.
 */
import { getSql, toVectorLiteral } from "@tutor-ia/db";
import { embedQuery } from "./embeddings";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  page: number | null;
  similarity: number;
}

export interface RetrieveOptions {
  userId: string;
  subjectId?: string | null;
  matchCount?: number;
}

export async function retrieve(
  query: string,
  opts: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const sql = getSql();
  const queryEmbedding = await embedQuery(query);
  const literal = toVectorLiteral(queryEmbedding);

  const rows = await sql<
    {
      chunk_id: string;
      document_id: string;
      content: string;
      page: number | null;
      similarity: number;
    }[]
  >`
    select * from match_chunks(
      ${literal}::vector,
      ${opts.userId}::uuid,
      ${opts.subjectId ?? null},
      ${opts.matchCount ?? 8}
    )
  `;

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    content: r.content,
    page: r.page,
    similarity: r.similarity,
  }));
}

/** Formatea los fragmentos como contexto citable para el prompt de Claude. */
export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const ref = c.page != null ? ` (pág. ${c.page})` : "";
      return `[Fragmento ${i + 1}${ref}]\n${c.content}`;
    })
    .join("\n\n");
}
