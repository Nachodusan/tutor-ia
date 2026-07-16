import { ingestDocumentV2, type SidecarDoc } from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";
import { getCurrentUserId } from "@/lib/auth";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/documents  (multipart/form-data)
 *   fields: file (PDF o texto), title?, subjectId?
 *
 * Crea la fila del documento e ingesta con el pipeline ESTRUCTURAL v2 (Fase 0.5):
 * sidecar pymupdf4llm → cleanPages → chunkStructural → bge-m3 → pgvector, con la
 * metadata que hace verificables las citas (heading_path, page_start/end).
 * (Antes usaba el legacy pdf-parse por caracteres: chunks peores y citas
 * "(sin ubicación)" — la brecha eval-vs-producción de la auditoría.)
 *
 * Para el MVP la ingesta es síncrona; en producción conviene moverla a un worker
 * en background y devolver de inmediato con status 'processing'.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId(req);
  const sql = getSql();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response("Falta el archivo 'file'.", { status: 400 });
  }

  const title = (form.get("title") as string) || file.name;
  const subjectId = (form.get("subjectId") as string) || null;
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const sourceType: "pdf" | "text" = isPdf ? "pdf" : "text";

  const [doc] = await sql<{ id: string }[]>`
    insert into documents (owner_user_id, subject_id, title, source_type, status)
    values (${userId}, ${subjectId}, ${title}, ${sourceType}, 'pending')
    returning id
  `;
  const documentId = doc!.id;

  try {
    let chunks: number;
    if (sourceType === "pdf") {
      // El sidecar (extract.py) lee de disco: volcamos el upload a un temporal.
      const buffer = Buffer.from(await file.arrayBuffer());
      const dir = await mkdtemp(join(tmpdir(), "tutor-upload-"));
      const pdfPath = join(dir, "doc.pdf");
      try {
        await writeFile(pdfPath, buffer);
        ({ chunks } = await ingestDocumentV2({ documentId, pdfPath }));
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      // Texto plano/markdown: no hay PDF que extraer; se arma el SidecarDoc
      // directo y pasa por la MISMA limpieza + chunking estructural.
      const text = await file.text();
      const doc: SidecarDoc = {
        sourcePath: file.name,
        pageCount: 1,
        title,
        pages: [{ page: 1, md: text }],
      };
      ({ chunks } = await ingestDocumentV2({ documentId, doc }));
    }
    return Response.json({ documentId, status: "ready", chunks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error procesando el documento";
    // El estado 'error' ya lo marca ingestDocumentV2.
    return Response.json({ documentId, status: "error", error: msg }, { status: 500 });
  }
}

/** GET /api/documents -> lista de documentos del usuario. */
export async function GET(req: Request) {
  const userId = await getCurrentUserId(req);
  const sql = getSql();
  const rows = await sql`
    select id, title, source_type, status, page_count, created_at
    from documents
    where owner_user_id = ${userId}
    order by created_at desc
  `;
  return Response.json({ documents: rows });
}
