import { ingestDocument } from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/documents  (multipart/form-data)
 *   fields: file (PDF o texto), title?, subjectId?
 *
 * Crea la fila del documento e ingesta su contenido (extraer -> chunk -> embed).
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
    if (sourceType === "pdf") {
      const buffer = Buffer.from(await file.arrayBuffer());
      await ingestDocument({ documentId, sourceType: "pdf", buffer });
    } else {
      const text = await file.text();
      await ingestDocument({ documentId, sourceType: "text", text });
    }
    return Response.json({ documentId, status: "ready" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error procesando el documento";
    // El estado 'error' ya lo marca ingestDocument.
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
