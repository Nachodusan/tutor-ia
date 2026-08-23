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
import { chunkStructural, type StructuredChunk } from "./chunk-structural";
import { embed } from "./embeddings";
import type { CorpusKind } from "./ingest-curriculum";

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
    {
      maxBuffer: 256 * 1024 * 1024, // el JSON de un libro grande supera 1MB
      // Un PDF patológico no debe colgar la ingesta para siempre (los otros
      // procesos externos — embed, rerank — ya tienen timeout; este faltaba).
      timeout: Number(process.env.INGEST_SIDECAR_TIMEOUT_MS ?? "600000"),
      killSignal: "SIGKILL",
    },
  );
  return JSON.parse(stdout) as SidecarDoc;
}

export interface IngestV2Input {
  documentId: string;
  /** Ruta al PDF (spawnea el sidecar) ... */
  pdfPath?: string;
  /** ... o un SidecarDoc ya extraído (para reindexar sin re-OCR). */
  doc?: SidecarDoc;
  /**
   * De qué corpus es este material. **OBLIGATORIO, y a propósito.**
   *
   * `chunks.corpus_role` tiene default `'content'` en la base, así que hasta
   * ahora todo lo que entraba por acá —incluido el texto plano que sube el
   * admin por /api/documents— aterrizaba como material del libro del Mineduc,
   * indistinguible de él para el retrieval y para el sello "De tu libro".
   *
   * Se pide en el tipo y no se le pone default para que el compilador rompa en
   * cada llamador el día que aparezca un corpus nuevo. Un default acá es un
   * agujero que nadie vuelve a mirar.
   */
  corpusRole: CorpusKind;
  /**
   * Piso de caracteres por chunk: los más cortos se FUSIONAN con el siguiente
   * en vez de viajar solos. `undefined` = comportamiento de siempre.
   *
   * Existe por los cuadernos EPJA, que vienen escaneados y cuya maquetación
   * fragmentada produce chunks inservibles: medido, el 19,1% quedaba por debajo
   * de 120 caracteres contra el 0,8% de los libros de editorial — 24 veces más.
   * Pedazos como "E nergia gravitacional." (23 caracteres) no enseñan nada y sin
   * embargo compiten en el ranking; uno de ellos —"Resuma el contenido del texto
   * en las siguientes líneas."— ganó un turno sobre cuántos huesos tiene el
   * cuerpo humano.
   *
   * ⚠️ Va como OPCIÓN y no como piso de `chunkStructural` a propósito. Ese
   * chunker es el camino con el que está calibrado el golden, y la última vez
   * que se tocó el troceado el recall por cobertura cayó 18 puntos (ver el
   * experimento "plano vs bloques" en el HANDOFF). Lo que está roto es el
   * material escaneado, no el chunker: el arreglo va donde está el problema.
   */
  minChunkChars?: number;
}

/**
 * Fusiona chunks demasiado cortos con el siguiente, respetando la estructura.
 *
 * Reglas, y el motivo de cada una:
 *  - Cruza el TIPO de contenido, y esto se midió. La primera versión solo
 *    fusionaba `prose` con `prose`, para no arruinar una tabla legítimamente
 *    corta ("Klimt: El beso") — y casi no servía: 47 fragmentos cortos bajaban a
 *    45. El diagnóstico mostró por qué: lo que está destrozado en el material
 *    escaneado son las TABLAS, troceadas de a una celda ("Sacudida
 *    imperceptible.|", "|III"), así que el corto y su continuación caen en tipos
 *    distintos y la regla los separaba justo donde había que unirlos. Cruzando
 *    el tipo: 47 → 13, y en un módulo 31 → 0. El resultado hereda `table` si
 *    alguna parte lo era.
 *  - Solo con el SIGUIENTE, nunca con el anterior: el orden de lectura manda, y
 *    un fragmento suelto suele ser el arranque de lo que viene.
 *  - No cruza `headingPath`: pegar el final de una sección con el principio de
 *    otra crea un chunk que no pertenece a ninguna de las dos, que es
 *    exactamente el error que hundió el experimento de bloques.
 *  - El rango de páginas se extiende (el fusionado abarca de la primera a la
 *    última) para que la cita siga apuntando a donde está el texto.
 */
export function fusionarCortos(
  chunks: StructuredChunk[],
  minChars: number,
): StructuredChunk[] {
  const out: StructuredChunk[] = [];
  let buf: StructuredChunk | null = null;
  for (const c of chunks) {
    const prev = buf;
    if (prev) {
      if (prev.headingPath === c.headingPath) {
        const unido: StructuredChunk = {
          ...prev,
          content: `${prev.content}\n${c.content}`,
          pageEnd: Math.max(prev.pageEnd, c.pageEnd),
          tokenCount: prev.tokenCount + c.tokenCount,
          contentType:
            prev.contentType === "table" || c.contentType === "table"
              ? "table"
              : prev.contentType,
        };
        if (unido.content.trim().length >= minChars) { out.push(unido); buf = null; }
        else buf = unido;
        continue;
      }
      // Cambió de sección: el corto sale como está. Pegarlo con lo que sigue
      // crearía un chunk que no pertenece a ninguna de las dos.
      out.push(prev);
      buf = null;
    }
    if (c.content.trim().length < minChars) buf = { ...c };
    else out.push(c);
  }
  if (buf) out.push(buf);
  return out.map((c, i) => ({ ...c, index: i }));
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

    const base = chunkStructural(cleanPages(doc.pages));
    const chunks =
      input.minChunkChars != null
        ? fusionarCortos(base, input.minChunkChars)
        : base;
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
        corpus_role: input.corpusRole,
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
          "corpus_role",
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
