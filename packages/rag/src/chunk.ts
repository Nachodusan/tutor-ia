/**
 * División de texto en fragmentos (chunks) para RAG.
 *
 * Estrategia: acumular por párrafos hasta ~maxChars, con solape (overlap) para
 * no cortar ideas a la mitad. Simple y suficiente para libros/apuntes; se puede
 * refinar luego (p. ej. dividir por títulos/secciones).
 */

export interface Chunk {
  index: number;
  content: string;
  page?: number;
}

export interface PageText {
  page: number;
  text: string;
}

export interface ChunkOptions {
  maxChars?: number; // tamaño objetivo del fragmento
  overlapChars?: number; // solape entre fragmentos consecutivos
}

/** Estimación barata de tokens (~4 chars/token) para telemetría. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Fragmenta texto por páginas, preservando el número de página de origen.
 * Cada fragmento conserva la página donde empezó.
 */
export function chunkPages(
  pages: PageText[],
  opts: ChunkOptions = {},
): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlapChars = opts.overlapChars ?? 150;

  const chunks: Chunk[] = [];
  let index = 0;

  for (const { page, text } of pages) {
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    let buffer = "";
    const flush = () => {
      const content = buffer.trim();
      if (content.length === 0) return;
      chunks.push({ index: index++, content, page });
      // arrancar el siguiente buffer con el solape del final del anterior
      buffer =
        overlapChars > 0 && content.length > overlapChars
          ? content.slice(content.length - overlapChars)
          : "";
    };

    for (const para of paragraphs) {
      if (buffer.length + para.length + 1 > maxChars && buffer.length > 0) {
        flush();
      }
      buffer += (buffer ? " " : "") + para;
      // Párrafo enorme: cortarlo en trozos duros
      while (buffer.length > maxChars) {
        const content = buffer.slice(0, maxChars).trim();
        chunks.push({ index: index++, content, page });
        buffer = buffer.slice(maxChars - overlapChars);
      }
    }
    flush();
  }

  return chunks;
}

/** Variante para texto plano sin páginas. */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  return chunkPages([{ page: 1, text }], opts).map((c) => ({
    index: c.index,
    content: c.content,
  }));
}
