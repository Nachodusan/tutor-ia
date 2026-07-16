/**
 * Limpieza del markdown emitido por pymupdf4llm (sidecar de ingesta).
 *
 * Convierte el markdown por página en bloques tipados (heading/paragraph/
 * list_item/table) y elimina el ruido detectado empíricamente en
 * docs/exp1-hallazgos.md: headers corrientes repetidos, folios sueltos,
 * códigos de recurso (BDA/U1_ACT_*), palabras partidas por guion y
 * letter-spacing ("B Á SICO" → "BÁSICO").
 *
 * Sin dependencias: solo helpers puros sobre strings.
 */

export interface CleanBlock {
  type: "heading" | "paragraph" | "list_item" | "table" | "figure_caption" | "other";
  level?: number;
  text: string;
}

export interface CleanPage {
  page: number;
  blocks: CleanBlock[];
}

/** Fracción mínima de páginas en que debe repetirse un heading nivel 1 para considerarlo header corriente. */
const RUNNING_HEADER_MIN_RATIO = 0.2;

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_LIST_MARKER = /^\s*(?:[-*•]|\d{1,3}[.)])\s+/;
/** Letra suelta en mayúscula (incluye acentuadas del español). */
const RE_SINGLE_UPPER = /^[A-ZÁÉÍÓÚÑÜ]$/;
/** Palabra corta toda en mayúsculas (fragmento restante de una palabra espaciada), con puntuación final opcional. */
const RE_UPPER_WORD = /^[A-ZÁÉÍÓÚÑÜ]{2,10}[.,;:!?)»”"]{0,2}$/;

/** Quita los marcadores ** de bold, colapsa espacios y recorta. */
function normalizeText(s: string): string {
  return s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Ruido OCR y HTML (hallazgos del exp1b: la tapa entraba como 287 tokens de
// ruido y los marcadores "<!-- picture text -->" se filtraban a chunks prose).
// ---------------------------------------------------------------------------

/** Región de texto OCR de una imagen, delimitada por pymupdf4llm. */
const PICTURE_RE =
  /<!--\s*Start of picture text\s*-->([\s\S]*?)<!--\s*End of picture text\s*-->/g;

/**
 * Quita HTML residual del markdown de pymupdf4llm: <br> → salto de línea,
 * etiquetas de formato (<u>, <sub>, ...), comentarios HTML sueltos y ~~tachado~~.
 * Solo etiquetas conocidas: no arrasa con "<" legítimos del texto.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:u|i|b|em|strong|sub|sup|span|a|img)(?:\s[^>]*)?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/~~/g, "");
}

/** Stopwords frecuentes del español (rescate del filtro de ruido OCR). */
const STOPWORDS = new Set([
  "de", "la", "el", "que", "y", "en", "los", "las", "un", "una", "del", "se",
  "con", "por", "para", "su", "al", "es", "como", "más", "pero", "sus", "le",
  "ya", "o", "este", "esta", "entre", "cuando", "muy", "sin", "sobre", "también",
  "me", "hasta", "hay", "donde", "quien", "desde", "todo", "nos", "durante",
  "todos", "uno", "les", "ni", "contra", "otros", "ese", "eso", "ante", "ellos",
  "e", "esto", "antes", "qué", "unos", "yo", "otro", "otra", "él", "ella", "no",
  "sí", "lo", "mi", "tu", "te", "si",
]);

/** ¿Token con pinta de palabra (≥3 letras, con vocal)? */
const WORDLIKE_RE = /^[\p{L}]{3,}$/u;
const VOWEL_RE = /[aeiouáéíóúü]/i;

/**
 * Detector de ruido OCR ("fe gore pee A of. < Wiehe' Se i ™ «..."): textos
 * largos donde pocas palabras parecen palabras y casi no hay stopwords del
 * español. Conservador: los poemas y el texto real superan el umbral holgado.
 */
export function isGibberish(text: string): boolean {
  const toks = text.split(/\s+/).filter((t) => t.length > 0);
  if (toks.length < 8) return false; // textos cortos: no juzgar
  let wordlike = 0;
  let stop = 0;
  for (const t of toks) {
    const bare = t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (WORDLIKE_RE.test(bare) && VOWEL_RE.test(bare)) wordlike++;
    // Solo stopwords de ≥2 letras: el ruido OCR está lleno de "y"/"o"/"a" sueltas.
    if (bare.length >= 2 && STOPWORDS.has(bare.toLowerCase())) stop++;
  }
  // DENSIDADES, no conteos absolutos: un bloque largo de ruido junta stopwords
  // por azar (la tapa: 326 tokens, 12 stopwords = 4% — la prosa real ronda 25-45%).
  return wordlike / toks.length < 0.5 && stop / toks.length < 0.15;
}

/**
 * ¿Línea de OCR de imagen que parece un caption real ("TRISTAN UND ISOLDE")
 * y no ruido ("We GN h")? ≥8 chars, ≥70% letras/espacios y ≥2 palabras reales.
 */
export function looksLikeCaptionLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 8) return false;
  const alpha = t.match(/[\p{L} ]/gu)?.length ?? 0;
  if (alpha / t.length < 0.7) return false;
  let words = 0;
  for (const tok of t.split(/\s+/)) {
    const bare = tok.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (WORDLIKE_RE.test(bare) && VOWEL_RE.test(bare)) words++;
  }
  return words >= 2;
}

/** Segmento de página: markdown normal u OCR de imagen. */
interface MdSegment {
  kind: "md" | "picture";
  text: string;
}

/** Separa el markdown en segmentos normales y regiones de OCR de imagen. */
function segmentMd(md: string): MdSegment[] {
  const segments: MdSegment[] = [];
  let last = 0;
  PICTURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PICTURE_RE.exec(md)) !== null) {
    if (m.index > last) segments.push({ kind: "md", text: md.slice(last, m.index) });
    segments.push({ kind: "picture", text: m[1] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < md.length) segments.push({ kind: "md", text: md.slice(last) });
  return segments;
}

/** Extrae las líneas con pinta de caption del OCR de una imagen (o null). */
function extractCaption(pictureText: string): string | null {
  const lines = stripHtml(pictureText)
    .split("\n")
    .map((l) => normalizeText(l))
    .filter((l) => looksLikeCaptionLine(l));
  if (lines.length === 0) return null;
  return lines.join(" · ");
}

/**
 * Red de seguridad de de-hyphenation (pymupdf4llm ya resuelve casi todo).
 * Une "palabra-\n continuación" y también "xxx - yyy" cuando ambos lados son
 * minúsculas (patrón de guion de corte de línea del exp1: "cortaplu - mas").
 */
export function dehyphenate(s: string): string {
  // Corte de línea: el guion queda PEGADO a la palabra izquierda
  // ("difu-\nsión" o, tras unir líneas, "difu- sión") → "difusión".
  // NO tocamos "x - y" (guion con espacio a AMBOS lados): eso es un guion-dash
  // real ("rojo - azul", "teórico - práctico"), no una palabra partida.
  return s
    .replace(/([a-záéíóúñü])-\s*\n\s*([a-záéíóúñü])/g, "$1$2")
    .replace(/([a-záéíóúñü])-[ \t]+([a-záéíóúñü])/g, "$1$2");
}

/**
 * Une secuencias de letras sueltas en mayúscula tipo "B Á SICO" → "BÁSICO".
 * Conservador: la racha debe empezar con una letra suelta mayúscula y contener
 * al menos dos; las palabras cortas en mayúsculas solo se absorben si están
 * intercaladas/adyacentes a letras sueltas. Nunca toca minúsculas ("y", "a",
 * "e", "o", "u" son palabras del español).
 */
export function fixLetterSpacing(s: string): string {
  return s
    .split("\n")
    .map((line) => fixLetterSpacingLine(line))
    .join("\n");
}

function fixLetterSpacingLine(line: string): string {
  const toks = line.split(/[ \t]+/).filter((t) => t.length > 0);
  if (toks.length === 0) return line.trim();
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t !== undefined && RE_SINGLE_UPPER.test(t)) {
      // Intentar armar una racha de letras sueltas (con fragmentos en mayúsculas intercalados).
      const run: string[] = [];
      let singles = 0;
      let j = i;
      while (j < toks.length) {
        const tj = toks[j];
        if (tj === undefined) break;
        if (RE_SINGLE_UPPER.test(tj)) {
          run.push(tj);
          singles++;
          j++;
          continue;
        }
        if (RE_UPPER_WORD.test(tj)) {
          run.push(tj);
          j++;
          // Un fragmento en mayúsculas cierra la racha salvo que siga otra letra suelta.
          const next = toks[j];
          if (next !== undefined && RE_SINGLE_UPPER.test(next)) continue;
          break;
        }
        break;
      }
      if (singles >= 2) {
        out.push(run.join(""));
        i = j;
        continue;
      }
    }
    out.push(t ?? "");
    i++;
  }
  return out.join(" ");
}

/**
 * Elimina códigos de recurso del libro: "BDA" y "U1_ACT_1 y 2", "U1_IMA_1",
 * "U2_AUD_3", "U1_VID_2", etc. Colapsa los espacios sobrantes.
 */
export function stripAssetCodes(s: string): string {
  return s
    .replace(/\bU\d+_(?:ACT|IMA|AUD|VID)_?\d*(?:\s+y\s+\d+)?\b/g, " ")
    .replace(/\bBDA\b/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

/**
 * ¿Es la línea un folio (número de página suelto)? Tras quitar ** y espacios
 * queda solo un número de ≤4 cifras, o un rango "N - M".
 */
export function isFolioLine(s: string): boolean {
  const t = s.replace(/\*\*/g, "").trim();
  if (t.length === 0) return false;
  return /^\d{1,4}$/.test(t) || /^\d{1,4}\s*-\s*\d{1,4}$/.test(t);
}

/**
 * Detecta headers corrientes: textos de heading nivel 1 (normalizados) que se
 * repiten en ≥20% de las páginas ("Unidad 1", "Lengua y Literatura"). Son
 * boilerplate de la maqueta, no estructura del contenido.
 */
export function detectRunningHeaders(
  pages: { page: number; md: string }[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seenInPage = new Set<string>();
    for (const raw of p.md.split("\n")) {
      const m = RE_HEADING.exec(raw.trim());
      if (m && m[1]?.length === 1) {
        const norm = normalizeText(m[2] ?? "");
        if (norm.length > 0) seenInPage.add(norm);
      }
    }
    for (const h of seenInPage) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * RUNNING_HEADER_MIN_RATIO));
  const result = new Set<string>();
  for (const [header, count] of counts) {
    if (count >= threshold) result.add(header);
  }
  return result;
}

/** ¿Línea que pertenece a una tabla markdown? */
function isTableLine(line: string): boolean {
  if (!line.includes("|")) return false;
  if (line.startsWith("|")) return true;
  return (line.match(/\|/g)?.length ?? 0) >= 2;
}

/** ¿Línea separadora de tabla markdown (|---|:---:|)? */
function isTableSeparator(line: string): boolean {
  return /^[|\s:\-]+$/.test(line) && line.includes("-");
}

/**
 * Parsea el markdown de una página de pymupdf4llm a bloques tipados.
 * Los folios se descartan a nivel de línea (salen como líneas aisladas "**18**").
 */
function parseMarkdownBlocks(md: string): CleanBlock[] {
  const blocks: CleanBlock[] = [];
  let para: string[] = [];
  let table: string[] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ type: "paragraph", text: para.join(" ") });
      para = [];
    }
  };
  const flushTable = (): void => {
    if (table.length > 0) {
      blocks.push({ type: "table", text: table.join("\n") });
      table = [];
    }
  };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) {
      flushPara();
      flushTable();
      continue;
    }
    if (isFolioLine(line)) continue; // folio: fuera

    const hm = RE_HEADING.exec(line);
    if (hm) {
      flushPara();
      flushTable();
      blocks.push({
        type: "heading",
        level: hm[1]?.length ?? 1,
        text: normalizeText(hm[2] ?? ""),
      });
      continue;
    }

    if (isTableLine(line)) {
      flushPara();
      if (!isTableSeparator(line)) table.push(line);
      continue;
    }
    flushTable();

    if (RE_LIST_MARKER.test(line)) {
      flushPara();
      blocks.push({ type: "list_item", text: line.replace(RE_LIST_MARKER, "").trim() });
      continue;
    }

    para.push(line);
  }
  flushPara();
  flushTable();
  return blocks;
}

/**
 * Parsea una página completa: separa las regiones de OCR de imagen (que se
 * convierten en figure_caption filtrado, o se descartan si son puro ruido) del
 * markdown normal (que se parsea a bloques tras quitar el HTML residual).
 */
function pageToBlocks(md: string): CleanBlock[] {
  const blocks: CleanBlock[] = [];
  for (const seg of segmentMd(md)) {
    if (seg.kind === "picture") {
      const caption = extractCaption(seg.text);
      if (caption !== null) blocks.push({ type: "figure_caption", text: caption });
      continue;
    }
    blocks.push(...parseMarkdownBlocks(stripHtml(seg.text)));
  }
  return blocks;
}

/**
 * Pipeline de limpieza: markdown → segmentos (OCR de imagen aparte) → bloques
 * → quitar headers corrientes y folios → por bloque: stripAssetCodes →
 * dehyphenate → fixLetterSpacing → quitar énfasis → colapsar espacios →
 * descartar vacíos, sin letras o ruido OCR (gibberish).
 */
export function cleanPages(pages: { page: number; md: string }[]): CleanPage[] {
  const runningHeaders = detectRunningHeaders(pages);

  return pages.map((p) => {
    const blocks: CleanBlock[] = [];
    for (const block of pageToBlocks(p.md)) {
      if (
        block.type === "heading" &&
        block.level === 1 &&
        runningHeaders.has(normalizeText(block.text))
      ) {
        continue; // header corriente: boilerplate, no estructura
      }
      let text = stripAssetCodes(block.text);
      text = dehyphenate(text);
      text = fixLetterSpacing(text);
      // Énfasis markdown residual ("** **" sobrevivía como bloque basura).
      text = text.replace(/\*\*/g, "");
      text = text.replace(/[ \t]{2,}/g, " ").trim();
      if (text.length === 0) continue;
      if (!/\p{L}/u.test(text)) continue; // sin letras: puro símbolo/puntuación
      // Ruido OCR sin delimitar (la tapa): párrafos/tablas ilegibles, fuera.
      // Para tablas se juzga sin la sintaxis (| y números son estructura, no ruido).
      const judged = block.type === "table" ? text.replace(/[|\d]/g, " ") : text;
      if ((block.type === "paragraph" || block.type === "table") && isGibberish(judged)) {
        continue;
      }
      blocks.push(
        block.level !== undefined
          ? { type: block.type, level: block.level, text }
          : { type: block.type, text },
      );
    }
    return { page: p.page, blocks };
  });
}
