/**
 * CLI: indexa un libro end-to-end en la DB con la ingesta v2
 * (sidecar pymupdf4llm → clean → chunkStructural → bge-m3 → pgvector).
 *
 *   pnpm --filter @tutor-ia/eval index-book <libro.pdf> [--subject "Nombre"]
 *
 * Requiere: Postgres con schema.sql + schema_student_model.sql + schema_hybrid.sql
 * aplicados, seed del usuario dev, y DEEPINFRA_API_KEY (los embeddings bge-m3 se
 * piden a la API, así que indexar necesita red).
 */
import { readFileSync } from "node:fs";
import { isAbsolute, resolve, basename } from "node:path";
import { getSql } from "@tutor-ia/db";
import { ingestDocumentV2, type SidecarDoc } from "@tutor-ia/rag";

const DEV_USER_ID =
  process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

function resolveInput(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

async function main() {
  const rawPath = process.argv[2];
  if (!rawPath) {
    console.error("Uso: pnpm --filter @tutor-ia/eval index-book <libro.pdf> [--subject Nombre]");
    process.exit(2);
  }
  const pdfPath = resolveInput(rawPath);
  const subjIdx = process.argv.indexOf("--subject");
  const subjectName = subjIdx !== -1 ? process.argv[subjIdx + 1] : null;
  const sideIdx = process.argv.indexOf("--sidecar");
  const sidecarPath =
    sideIdx !== -1 && process.argv[sideIdx + 1]
      ? resolveInput(process.argv[sideIdx + 1] as string)
      : null;
  const preDoc: SidecarDoc | null = sidecarPath
    ? (JSON.parse(readFileSync(sidecarPath, "utf8")) as SidecarDoc)
    : null;

  const sql = getSql();

  // Materia opcional.
  let subjectId: string | null = null;
  if (subjectName) {
    const [s] = await sql<{ id: string }[]>`
      insert into subjects (user_id, name) values (null, ${subjectName})
      returning id
    `;
    subjectId = s!.id;
  }

  const title = basename(pdfPath);
  const [doc] = await sql<{ id: string }[]>`
    insert into documents (owner_user_id, subject_id, title, source_type, status)
    values (null, ${subjectId}, ${title}, 'pdf', 'pending')
    returning id
  `;
  const documentId = doc!.id;

  console.log(`\n📥 Indexando: ${title}`);
  console.log(`   document_id: ${documentId}`);
  if (subjectId) console.log(`   materia:     ${subjectName} (${subjectId})`);
  console.log(
    preDoc
      ? "   usando sidecar pre-generado + embeddings..."
      : "   extrayendo (sidecar + OCR, puede tardar) + embeddings...",
  );

  const t0 = Date.now();
  const { chunks } = await ingestDocumentV2(
    preDoc ? { documentId, doc: preDoc } : { documentId, pdfPath },
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const nRows = await sql<{ n: number }[]>`
    select count(*)::int as n from chunks where document_id = ${documentId}
  `;
  const ctRows = await sql<{ ct: number }[]>`
    select count(*)::int as ct from chunks where document_id = ${documentId} and content_tsv is not null
  `;
  const n = nRows[0]?.n ?? 0;
  const ct = ctRows[0]?.ct ?? 0;

  console.log(`\n✅ Listo en ${secs}s`);
  console.log(`   chunks generados: ${chunks} · en DB: ${n} · con tsvector: ${ct}`);
  console.log(`\n   Probá el retrieval:  pnpm --filter @tutor-ia/eval retrieve "tu pregunta"\n`);
  await sql.end();
}

main().catch(async (err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
