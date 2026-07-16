/**
 * Ingesta v2 (Plan v2 §3): sidecar pymupdf4llm → cleanPages → chunkStructural →
 * embeddings (bge-m3) → Postgres/pgvector, con la metadata rica del §3
 * (heading_path, content_type, page_start/end). Reemplaza a ingest.ts (pdf-parse).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getSql, toVectorLiteral } from "@tutor-ia/db";
import { cleanPages } from "./clean";
import { chunkStructural } from "./chunk-structural";
import { embed } from "./embeddings";

const execFileAsync = promisify(execFile);

// Rutas al sidecar Python. Se resuelven relativas a este módulo (funciona sin
// importar desde qué paquete se lo consuma), con override por env.
const HERE = dirname(fileURLToPath(import.meta.url)); // packages/rag/src
const REPO = resolve(HERE, "../../..");
const PY_BIN =
  process.env.INGEST_PY_BIN ?? resolve(REPO, "packages/ingest-py/.venv/bin/python");
const PY_SCRIPT =
  process.env.INGEST_PY_SCRIPT ?? resolve(REPO, "packages/ingest-py/extract.py");

/** Salida del sidecar (contrato con extract.py). */
export interface SidecarDoc {
  sourcePath: string;
  pageCount: number;
  title: string | null;
  pages: { page: number; md: string }[];
}

const EMBED_BATCH = 64;

/** Ejecuta el sidecar Python y devuelve el documento estructurado. */
export async function extractWithSidecar(
  pdfPath: string,
  opts?: { pyBin?: string; script?: string },
): Promise<SidecarDoc> {
  const { stdout } = await execFileAsync(
    opts?.pyBin ?? PY_BIN,
    [opts?.script ?? PY_SCRIPT, pdfPath],
    { maxBuffer: 256 * 1024 * 1024 }, // el JSON de un libro grande supera 1MB
  );
  return JSON.parse(stdout) as SidecarDoc;
}

export interface IngestV2Input {
  documentId: string;
  /** Ruta al PDF (spawnea el sidecar) ... */
  pdfPath?: string;
  /** ... o un SidecarDoc ya extraído (para reindexar sin re-OCR). */
  doc?: SidecarDoc;
}

/**
 * Ingesta completa a la DB. Marca el documento 'processing' → 'ready'/'error'.
 * El tsvector léxico lo mantiene la columna generada del esquema (schema_hybrid.sql).
 */
export async function ingestDocumentV2(
  input: IngestV2Input,
): Promise<{ chunks: number }> {
  const sql = getSql();
  const { documentId } = input;

  try {
    await sql`update documents set status = 'processing' where id = ${documentId}`;

    const doc =
      input.doc ??
      (input.pdfPath
        ? await extractWithSidecar(input.pdfPath)
        : (() => {
            throw new Error("Falta pdfPath o doc.");
          })());

    const chunks = chunkStructural(cleanPages(doc.pages));
    if (chunks.length === 0) {
      throw new Error("No quedaron chunks tras la limpieza estructural.");
    }

    // Reindexación: borrar los chunks previos de este documento. Sin esto, el
    // `on conflict do nothing` descartaría los chunks nuevos y quedaría el texto
    // viejo (o chunks huérfanos si el nuevo tiene menos).
    await sql`delete from chunks where document_id = ${documentId}`;

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
        page: c.pageStart, // compat con la columna vieja
        page_start: c.pageStart,
        page_end: c.pageEnd,
        heading_path: c.headingPath,
        content_type: c.contentType,
        token_count: c.tokenCount,
        embedding: toVectorLiteral(vectors[j]!),
      }));
      await sql`
        insert into chunks ${sql(
          rows,
          "document_id",
          "chunk_index",
          "content",
          "page",
          "page_start",
          "page_end",
          "heading_path",
          "content_type",
          "token_count",
          "embedding",
        )}
        on conflict (document_id, chunk_index) do nothing
      `;
    }

    await sql`
      update documents
      set status = 'ready', page_count = ${doc.pageCount}, error_message = null
      where id = ${documentId}
    `;
    return { chunks: chunks.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`update documents set status = 'error', error_message = ${message} where id = ${documentId}`;
    throw err;
  }
}
