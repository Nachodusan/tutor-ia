/**
 * Chunking estructural para RAG (fase 2).
 *
 * A diferencia de `chunk.ts` (corte por caracteres), acá se recorren los
 * bloques limpios de `clean.ts` manteniendo una pila de headings para armar
 * el `headingPath`, se respetan límites de párrafo/oración y se unen los
 * párrafos cortados entre páginas (el 38% de "idea cortada" del exp1).
 */

import { estimateTokens } from "./chunk";
import type { CleanBlock, CleanPage } from "./clean";

export interface StructuredChunk {
  index: number;
  content: string;
  /** "Unidad 1 › Lección 1 › Amplío mi vocabulario" o null si no hubo heading. */
  headingPath: string | null;
  pageStart: number;
  pageEnd: number;
  contentType: "prose" | "table" | "figure_caption" | "other";
  tokenCount: number;
}

export interface ChunkStructuralOptions {
  /** Presupuesto de tokens por chunk (default 500; plan §3: 400-700). */
  maxTokens?: number;
  /** Fracción de oraciones del chunk anterior que se prependen al siguiente dentro de la misma sección (default 0.15). */
  overlapRatio?: number;
}

/** Puntuación de cierre de oración/párrafo al final de un texto. */
const CLOSING_PUNCT_RE = /[.!?…»")\]]\s*$/;

/** ¿El texto arranca con minúscula (continuación de oración)? */
const STARTS_LOWER_RE = /^\p{Ll}/u;

/**
 * Abreviaturas comunes en español: si el texto ANTES del punto termina en una
 * de estas, el punto NO cierra oración ("Sr. García", "p. ej.", "etc.").
 */
const ABBREV_RE =
  /(?:^|[\s(«"])(?:Sr|Sra|Srta|Dr|Dra|Prof|Profa|Lic|Ing|Ud|Uds|Vd|Vds|etc|p|ej|pág|págs|art|núm|nro|aprox|vs|cap)$/i;

/**
 * Divide un texto en oraciones. Corta tras [.!?…] (con comillas/paréntesis de
 * cierre opcionales) solo si sigue espacio + mayúscula/apertura o fin de texto,
 * y nunca tras abreviaturas comunes. Jamás corta a mitad de oración.
 */
export function splitSentences(text: string): string[] {
  const re = /[.!?…]+["»')\]]*(?=\s|$)/g;
  const out: string[] = [];
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const rest = text.slice(end);
    const atEnd = rest.trim().length === 0;
    // la próxima oración debe arrancar con mayúscula, dígito o signo de apertura
    const nextOk = /^\s+[«"'(¿¡]*[A-ZÁÉÍÓÚÜÑ0-9]/.test(rest);
    if (!atEnd && !nextOk) continue;
    if (!atEnd && m[0].startsWith(".") && ABBREV_RE.test(text.slice(start, m.index).trimEnd())) {
      continue;
    }
    const sentence = text.slice(start, end).trim();
    if (sentence.length > 0) out.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Últimas ~ratio oraciones de un contenido, para usar como overlap. */
function overlapTail(content: string, ratio: number): string | null {
  if (ratio <= 0) return null;
  const flat = content.replace(/\s*\n+\s*/g, " ").trim();
  const sentences = splitSentences(flat);
  // Sin al menos 2 oraciones no hay "solape de oraciones" que tomar: si
  // devolviéramos slice(-1) sobre una sola "oración" (p.ej. una lista sin
  // puntuación) copiaríamos el CHUNK ENTERO al siguiente. Mejor no solapar.
  if (sentences.length < 2) return null;
  const k = Math.max(1, Math.round(sentences.length * ratio));
  let tail = sentences.slice(-k).join(" ");
  // Tope duro: el solape nunca puede ser más de la mitad del contenido.
  const maxChars = Math.floor(flat.length * 0.5);
  if (tail.length > maxChars) tail = tail.slice(tail.length - maxChars).trimStart();
  return tail.length > 0 ? tail : null;
}

/** Ítem del stream aplanado: un bloque con su rango de páginas de origen. */
interface StreamItem {
  block: CleanBlock;
  pageStart: number;
  pageEnd: number;
}

/**
 * Aplana las páginas en un stream de bloques y une los párrafos cortados
 * entre páginas consecutivas: si una página termina en párrafo sin puntuación
 * de cierre y la siguiente arranca con párrafo en minúscula, son la misma idea.
 */
function flattenAndMerge(pages: CleanPage[]): StreamItem[] {
  const items: StreamItem[] = [];
  for (const page of pages) {
    let firstOfPage = true;
    for (const block of page.blocks) {
      if (firstOfPage) {
        const prev = items.at(-1);
        if (
          prev !== undefined &&
          prev.block.type === "paragraph" &&
          block.type === "paragraph" &&
          page.page - prev.pageEnd === 1 && // solo páginas adyacentes
          !CLOSING_PUNCT_RE.test(prev.block.text.trimEnd()) &&
          STARTS_LOWER_RE.test(block.text.trim())
        ) {
          prev.block = {
            type: "paragraph",
            text: prev.block.text.trimEnd() + " " + block.text.trim(),
          };
          prev.pageEnd = page.page;
          firstOfPage = false;
          continue;
        }
      }
      items.push({ block: { ...block }, pageStart: page.page, pageEnd: page.page });
      firstOfPage = false;
    }
  }
  return items;
}

/**
 * Chunking estructural: recorre los bloques limpios acumulando párrafos hasta
 * ~maxTokens, cerrando en límites de párrafo (o de oración si un párrafo solo
 * excede el presupuesto), sin mezclar secciones y con tablas atómicas.
 */
export function chunkStructural(
  pages: CleanPage[],
  opts: ChunkStructuralOptions = {},
): StructuredChunk[] {
  const maxTokens = opts.maxTokens ?? 500;
  const overlapRatio = opts.overlapRatio ?? 0.15;

  const items = flattenAndMerge(pages);

  const chunks: StructuredChunk[] = [];
  let index = 0;

  // Pila de headings (level ascendente) para armar headingPath.
  const stack: { level: number; text: string }[] = [];
  const pathOf = (): string | null =>
    stack.length > 0 ? stack.map((h) => h.text).join(" › ") : null;

  // Buffer del chunk en construcción.
  let segs: { text: string; sep: string }[] = [];
  let segTokens = 0;
  let hasContent = false; // hay contenido real (no solo la semilla de overlap)
  let sawNonOther = false;
  let bufPath: string | null = null;
  let bufPageStart = 0;
  let bufPageEnd = 0;
  // Overlap pendiente para el próximo chunk de la MISMA sección.
  let pendingOverlap: { path: string | null; text: string } | null = null;

  const emit = (
    content: string,
    contentType: StructuredChunk["contentType"],
    pageStart: number,
    pageEnd: number,
    headingPath: string | null,
  ): void => {
    chunks.push({
      index: index++,
      content,
      headingPath,
      pageStart,
      pageEnd,
      contentType,
      tokenCount: estimateTokens(content),
    });
  };

  /** Cierra el chunk actual. `withOverlap` deja semilla para el siguiente (misma sección). */
  const flush = (withOverlap: boolean): void => {
    if (!hasContent) {
      // solo semilla de overlap o nada: descartar
      segs = [];
      segTokens = 0;
      if (!withOverlap) pendingOverlap = null;
      return;
    }
    const content = segs
      .map((s, i) => (i === 0 ? s.text : s.sep + s.text))
      .join("");
    emit(content, sawNonOther ? "prose" : "other", bufPageStart, bufPageEnd, bufPath);
    if (withOverlap) {
      const tail = overlapTail(content, overlapRatio);
      pendingOverlap = tail !== null ? { path: bufPath, text: tail } : null;
    } else {
      pendingOverlap = null;
    }
    segs = [];
    segTokens = 0;
    hasContent = false;
    sawNonOther = false;
  };

  /** Agrega un segmento de texto al buffer (sembrando overlap si corresponde). */
  const add = (
    text: string,
    sep: string,
    pageStart: number,
    pageEnd: number,
    blockType: CleanBlock["type"],
  ): void => {
    if (!hasContent) {
      const path = pathOf();
      bufPath = path;
      bufPageStart = pageStart;
      bufPageEnd = pageEnd;
      if (
        segs.length === 0 &&
        pendingOverlap !== null &&
        pendingOverlap.path === path
      ) {
        segs.push({ text: pendingOverlap.text, sep: "" });
        segTokens += estimateTokens(pendingOverlap.text);
      }
      pendingOverlap = null; // se consume (o se descarta si cambió la sección)
    }
    segs.push({ text, sep });
    segTokens += estimateTokens(sep + text);
    hasContent = true;
    if (pageEnd > bufPageEnd) bufPageEnd = pageEnd;
    if (blockType !== "other") sawNonOther = true;
  };

  for (const it of items) {
    const b = it.block;

    if (b.type === "heading") {
      // Cambio de sección: SIEMPRE cerrar el chunk actual, sin overlap cruzado.
      flush(false);
      const level = b.level ?? 1;
      while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
      stack.push({ level, text: b.text });
      continue;
    }

    if (b.type === "table") {
      // Las tablas van completas en su propio chunk, sin partir ni solapar.
      flush(false);
      emit(b.text, "table", it.pageStart, it.pageEnd, pathOf());
      pendingOverlap = null;
      continue;
    }

    if (
      b.type === "figure_caption" ||
      (b.type === "paragraph" && /^Vocabulario\b/.test(b.text.trim()))
    ) {
      // OCR de imagen filtrado o recuadro de vocabulario: chunk propio.
      flush(false);
      emit(b.text, "figure_caption", it.pageStart, it.pageEnd, pathOf());
      pendingOverlap = null;
      continue;
    }

    // paragraph | list_item | other
    const text =
      b.type === "list_item" && !/^[-•*]\s/.test(b.text)
        ? "- " + b.text
        : b.text;
    const sep = b.type === "list_item" ? "\n" : "\n\n";
    const tokens = estimateTokens(text);

    if (hasContent && segTokens + tokens > maxTokens) {
      // preferimos cerrar en límite de párrafo
      flush(true);
    }

    if (tokens > maxTokens && b.type !== "list_item") {
      // Párrafo gigante: cortar por oraciones, jamás a mitad de oración.
      let firstOfPara = true;
      for (const sentence of splitSentences(text)) {
        const sTokens = estimateTokens(sentence);
        if (hasContent && segTokens + sTokens > maxTokens) {
          flush(true);
          firstOfPara = true;
        }
        add(sentence, firstOfPara ? sep : " ", it.pageStart, it.pageEnd, b.type);
        firstOfPara = false;
      }
      continue;
    }

    add(text, sep, it.pageStart, it.pageEnd, b.type);
  }

  flush(false);

  // Guardia final: fuera los chunks basura (sin letras o ínfimos, p.ej. "** **"
  // o restos de OCR). Se re-indexa para que index quede contiguo. Las tablas y
  // captions pueden ser legítimamente cortas ("Klimt: El beso") → piso menor.
  return chunks
    .filter((c) => {
      if (!/\p{L}/u.test(c.content)) return false;
      const len = c.content.trim().length;
      const isShortType =
        c.contentType === "figure_caption" || c.contentType === "table";
      return len >= (isShortType ? 4 : 15);
    })
    .map((c, i) => ({ ...c, index: i }));
}
