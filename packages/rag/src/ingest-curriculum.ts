/**
 * Ingesta de DOBLE CORPUS TIPADO (Plan v3). Consume el extractor de currículum
 * (extract_curriculum.py) y persiste chunks con su rol y metadata curricular:
 *
 *   kind='content'  (Texto del Estudiante) → chunkStructural normal, cada chunk
 *                    hereda (unit, lesson, oa) de su página. corpus_role='content'.
 *   kind='pedagogy' (Guía Didáctica)       → cada BLOQUE tipado de la GDD es un
 *                    chunk (o varios si es largo), con su pedagogy_type + (unit,
 *                    lesson, oa). corpus_role='pedagogy'.
 *
 * El link contenido↔pedagogía queda por (unit, lesson) [+ oa cuando está].
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
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const PY_BIN = process.env.INGEST_PY_BIN ?? resolve(REPO, "packages/ingest-py/.venv/bin/python");
const PY_SCRIPT = process.env.CURRICULUM_PY ?? resolve(REPO, "packages/ingest-py/extract_curriculum.py");

const EMBED_BATCH = 64;
const PEDAGOGY_MAX_CHARS = 1400; // partir bloques largos de la GDD

/**
 * De qué corpus es un chunk. Es la etiqueta que decide si un fragmento puede
 * citarse como "de tu libro", y por eso NUNCA debe quedar librada a un default.
 *
 *  · `content`  — texto del estudiante. Es lo que el alumno tiene sobre la mesa.
 *  · `pedagogy` — guía didáctica del docente. Moldea la explicación, no se cita.
 *  · `web`      — material producido para tapar un hueco declarado del mapa
 *                 curricular. No sale de ningún libro del alumno y tiene que
 *                 decirlo.
 *
 * La columna `chunks.corpus_role` es `text` con default `'content'`: cualquier
 * inserción que no la setee se convierte en material de libro del Mineduc sin
 * que nadie se entere. Por eso `ingestDocumentV2` lo exige y hay un CHECK en
 * packages/db/schema_corpus_roles.sql.
 */
export type CorpusKind = "content" | "pedagogy" | "web";

interface CurriculumBlock {
  page: number;
  unit: number | null;
  lesson: number | null;
  oa: string | null;
  topic: string | null;
  pedagogy_type: string | null;
  header: string | null;
  text: string;
}
interface CurriculumDoc {
  kind: CorpusKind;
  units: Record<string, { oa: string; oa_text: string }>;
  blocks: CurriculumBlock[];
}

/** Corre el extractor Python y devuelve los bloques tipados. */
export async function extractCurriculum(
  pdfPath: string,
  kind: CorpusKind,
): Promise<CurriculumDoc> {
  const { stdout } = await execFileAsync(
    PY_BIN,
    [PY_SCRIPT, pdfPath, "--kind", kind],
    { maxBuffer: 256 * 1024 * 1024, timeout: 600000, killSignal: "SIGKILL" },
  );
  return JSON.parse(stdout) as CurriculumDoc;
}

/** Parte un texto largo en piezas ≤maxChars respetando límites de párrafo. */
function splitByParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && (buf.length + p.length) > maxChars) {
      out.push(buf.trim());
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + p;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

interface Row {
  content: string;
  page_start: number | null;
  page_end: number | null;
  heading_path: string | null;
  content_type: string;
  corpus_role: CorpusKind;
  pedagogy_type: string | null;
  unit: number | null;
  lesson: number | null;
  oa: string | null;
  topic: string | null;
  token_count: number;
}

/** Arma las filas (contenido) vía chunkStructural, heredando (unit,lesson,oa) por página. */
function contentRows(blocks: CurriculumBlock[]): Row[] {
  const pageMeta = new Map<number, CurriculumBlock>();
  for (const b of blocks) pageMeta.set(b.page, b);
  const pages = blocks.map((b) => ({ page: b.page, md: b.text }));
  const chunks = chunkStructural(cleanPages(pages));
  return chunks.map((c) => {
    const meta = pageMeta.get(c.pageStart);
    return {
      content: c.content,
      page_start: c.pageStart,
      page_end: c.pageEnd,
      heading_path: c.headingPath,
      content_type: c.contentType,
      corpus_role: "content" as const,
      pedagogy_type: null,
      unit: meta?.unit ?? null,
      lesson: meta?.lesson ?? null,
      oa: meta?.oa ?? null,
      topic: meta?.topic ?? null,
      token_count: c.tokenCount,
    };
  });
}

/** Arma las filas (pedagogía): cada bloque tipado → 1+ chunks con su metadata. */
function pedagogyRows(blocks: CurriculumBlock[]): Row[] {
  const rows: Row[] = [];
  for (const b of blocks) {
    if (!b.pedagogy_type) continue; // solo bloques tipados de la GDD
    const label = `[${b.header ?? b.pedagogy_type} · Unidad ${b.unit ?? "?"} Lección ${b.lesson ?? "?"}]`;
    for (const piece of splitByParagraph(b.text, PEDAGOGY_MAX_CHARS)) {
      // Prependemos el rótulo para que el embedding capte el tipo/lección.
      const content = `${label}\n${piece}`;
      rows.push({
        content,
        page_start: b.page,
        page_end: b.page,
        heading_path: b.header,
        content_type: "prose",
        corpus_role: "pedagogy",
        pedagogy_type: b.pedagogy_type,
        unit: b.unit,
        lesson: b.lesson,
        oa: b.oa,
        topic: b.topic,
        token_count: Math.ceil(content.length / 4),
      });
    }
  }
  return rows;
}

/**
 * Ingesta un documento (TE o GDD) a la DB con su rol y metadata curricular.
 * Marca el documento processing → ready/error.
 */
export async function ingestCurriculum(input: {
  documentId: string;
  pdfPath: string;
  kind: CorpusKind;
}): Promise<{ chunks: number }> {
  const sql = getSql();
  const { documentId, pdfPath, kind } = input;
  try {
    await sql`update documents set status = 'processing' where id = ${documentId}`;
    const doc = await extractCurriculum(pdfPath, kind);
    const rows = kind === "content" ? contentRows(doc.blocks) : pedagogyRows(doc.blocks);
    if (rows.length === 0) throw new Error(`Sin chunks tras la extracción (${kind}).`);

    await sql`delete from chunks where document_id = ${documentId}`;
    for (let i = 0; i < rows.length; i += EMBED_BATCH) {
      const batch = rows.slice(i, i + EMBED_BATCH);
      const vectors = await embed(batch.map((r) => r.content), "document");
      const insertRows = batch.map((r, j) => ({
        document_id: documentId,
        chunk_index: i + j,
        content: r.content,
        page: r.page_start,
        page_start: r.page_start,
        page_end: r.page_end,
        heading_path: r.heading_path,
        content_type: r.content_type,
        corpus_role: r.corpus_role,
        pedagogy_type: r.pedagogy_type,
        unit: r.unit,
        lesson: r.lesson,
        oa: r.oa,
        topic: r.topic,
        token_count: r.token_count,
        embedding: toVectorLiteral(vectors[j]!),
      }));
      await sql`
        insert into chunks ${sql(
          insertRows,
          "document_id", "chunk_index", "content", "page", "page_start", "page_end",
          "heading_path", "content_type", "corpus_role", "pedagogy_type",
          "unit", "lesson", "oa", "topic", "token_count", "embedding",
        )}
        on conflict (document_id, chunk_index) do nothing
      `;
    }
    await sql`
      update documents set status = 'ready', page_count = ${doc.blocks.at(-1)?.page ?? null}, error_message = null
      where id = ${documentId}
    `;
    return { chunks: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`update documents set status = 'error', error_message = ${message} where id = ${documentId}`;
    throw err;
  }
}
