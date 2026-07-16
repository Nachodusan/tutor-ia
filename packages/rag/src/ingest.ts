/**
 * Pipeline de ingesta: documento subido -> texto -> chunks -> embeddings -> DB.
 *
 * Se ejecuta en background (idealmente en un worker) tras la subida. Marca el
 * documento como 'processing' y luego 'ready' o 'error'.
 */
import { getSql, toVectorLiteral } from "@tutor-ia/db";
import { chunkPages, estimateTokens, type PageText } from "./chunk";
import { embed } from "./embeddings";
import { extractPdf, extractPlainText } from "./extract";

export interface IngestInput {
  documentId: string;
  sourceType: "pdf" | "text" | "image";
  /** Contenido del archivo. Para 'text' puede venir en `text`. */
  buffer?: Buffer;
  text?: string;
}

const EMBED_BATCH = 96; // lote de textos por llamada al proveedor de embeddings

export async function ingestDocument(input: IngestInput): Promise<void> {
  const sql = getSql();
  const { documentId } = input;

  try {
    await sql`update documents set status = 'processing' where id = ${documentId}`;

    // 1) Extraer texto por página
    let pages: PageText[];
    switch (input.sourceType) {
      case "pdf":
        if (!input.buffer) throw new Error("Falta el buffer del PDF.");
        pages = await extractPdf(input.buffer);
        break;
      case "text":
        if (input.text == null) throw new Error("Falta el texto.");
        pages = extractPlainText(input.text);
        break;
      case "image":
        throw new Error("OCR de imágenes aún no soportado.");
    }

    // 2) Fragmentar
    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      throw new Error("No se extrajo texto del documento.");
    }

    // 3) Embeddings por lotes e inserción
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embed(
        batch.map((c) => c.content),
        "document",
      );

      const rows = batch.map((c, j) => ({
        document_id: documentId,
        chunk_index: c.index,
        content: c.content,
        page: c.page ?? null,
        token_count: estimateTokens(c.content),
        embedding: toVectorLiteral(vectors[j]!),
      }));

      await sql`
        insert into chunks ${sql(
          rows,
          "document_id",
          "chunk_index",
          "content",
          "page",
          "token_count",
          "embedding",
        )}
        on conflict (document_id, chunk_index) do nothing
      `;
    }

    // 4) Listo
    await sql`
      update documents
      set status = 'ready', page_count = ${pages.length}, error_message = null
      where id = ${documentId}
    `;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      update documents
      set status = 'error', error_message = ${message}
      where id = ${documentId}
    `;
    throw err;
  }
}
