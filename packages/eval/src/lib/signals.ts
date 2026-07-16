/**
 * Detectores de señales de calidad de chunks (extraídos de exp1-inspect.ts).
 *
 * Cada señal marca un defecto típico de la ingesta con pdf-parse sobre el
 * libro real (ver docs/exp1-hallazgos.md): palabras partidas por guion,
 * headers corrientes pegados, folios al final, códigos de recurso, letras
 * espaciadas, ideas cortadas y chunks muy cortos. Puro y sin dependencias:
 * lo usan exp1 (inspección) y exp1b (comparador antes/después).
 */

export interface ChunkFlags {
  hasFormulaChars: boolean; // ∑∫√≤≥±→∞ etc. — señal de fórmula (posible mojibake)
  hasMojibake: boolean; // � o secuencias raras de codificación
  softHyphenation: number; // "cortaplu - mas": palabra partida por salto de línea
  leadingHeader: boolean; // encabezado corriente pegado al inicio ("Unidad 1 24 ...")
  trailingPageNum: boolean; // número de página pegado al final
  assetCodes: number; // "BDA U1_ACT_1", "U1_IMA_2": códigos de recurso incrustados
  letterSpacing: number; // "B Á SICO", "cre er": palabras con letras espaciadas
  sentenceCut: boolean; // el chunk termina sin puntuación final -> idea partida
  veryShort: boolean; // < 40 chars
}

const FORMULA_RE = /[∑∫√≤≥±→∞≠≈∂∇∈∉⊂⊆∀∃πθελδμσΔΩ]/;
const MOJIBAKE_RE = /[�]|Ã.|â€|Â./;
// Palabra partida: letra minúscula + " - " + letra minúscula ("difu - sión").
// [^\S\n] = espacio/tab pero NO salto de línea: así los bullets markdown
// ("...cómo\n- la representarán") no cuentan como palabra partida.
const SOFT_HYPHEN_RE = /\p{Ll}[^\S\n]-[^\S\n]\p{Ll}/gu;
// Encabezado corriente al inicio (este libro alterna estos dos).
const LEADING_HEADER_RE = /^\s*(lengua y literatura|unidad\s+\d+)\s+\d+/i;
// Códigos de recurso del material (audio/imagen/actividad).
const ASSET_RE = /\bBDA\b|\bU\d+_(?:ACT|IMA|AUD|VID)_?\d*/g;
// Letras espaciadas ("B Á SICO"): se cuenta por tokens, no por regex, para no
// marcar romanos en fechas ("siglo V a. C.") ni conjunciones en títulos en
// mayúsculas ("TRISTAN Y ISOLDE"). Ver countLetterSpacing más abajo.
const RE_SINGLE_UPPER = /^[A-ZÁÉÍÓÚÜÑ]$/;
const RE_HARD_CONSONANT = /^[BCDFGHJKLMNPQRSTVWXZÑ]$/; // sin vocales ni Y (romanos/conjunción)
const RE_UPPER_FRAGMENT = /^[A-ZÁÉÍÓÚÜÑ]{2,10}[.,;:!?)»”"]{0,2}$/;

/**
 * Cuenta rachas de letras sueltas tipo "B Á SICO": ≥2 letras sueltas en
 * mayúscula —al menos una consonante dura— seguidas opcionalmente de un
 * fragmento en mayúsculas. "V a. C." (romano) y "Y" (conjunción) no cuentan.
 */
function countLetterSpacing(s: string): number {
  let runs = 0;
  for (const line of s.split("\n")) {
    const toks = line.split(/\s+/).filter((t) => t.length > 0);
    let i = 0;
    while (i < toks.length) {
      if (RE_SINGLE_UPPER.test(toks[i] ?? "")) {
        let j = i;
        let singles = 0;
        let hard = 0;
        while (j < toks.length && RE_SINGLE_UPPER.test(toks[j] ?? "")) {
          if (RE_HARD_CONSONANT.test(toks[j] ?? "")) hard++;
          singles++;
          j++;
        }
        const fragmentFollows =
          j < toks.length && RE_UPPER_FRAGMENT.test(toks[j] ?? "");
        // "B Á SICO" (2 sueltas + fragmento) o "B C D" (≥3 sueltas), con ≥1
        // consonante dura en la racha para descartar romanos/conjunciones.
        if (hard >= 1 && (singles >= 3 || (singles >= 2 && fragmentFollows))) {
          runs++;
        }
        i = j + (fragmentFollows ? 1 : 0);
        continue;
      }
      i++;
    }
  }
  return runs;
}

/** Quita ruido de borde (número de página / códigos) para juzgar el corte de oración. */
function stripTrailingNoise(s: string): string {
  return s
    .replace(ASSET_RE, "")
    .replace(/\s*\d{1,4}(\s*-\s*\d{1,4})?\s*$/, "")
    .trim();
}

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

/** Analiza el contenido de un chunk y devuelve todas las señales detectadas. */
export function flag(content: string): ChunkFlags {
  const trimmed = content.trim();
  const core = stripTrailingNoise(trimmed);
  const lastChar = core.slice(-1);
  // "Idea cortada": el chunk termina sin puntuación de cierre. Se exceptúan los
  // finales que legítimamente no llevan punto: ítems de lista y líneas cortas
  // (captions, entradas de índice) — eran el grueso del falso 38% en el
  // pipeline nuevo; los cortes de oración reales terminan en línea larga.
  const lastLine = core.split("\n").at(-1)?.trim() ?? "";
  const listLikeEnding =
    /^(?:[-•*]|\d{1,3}[.)])\s/.test(lastLine) || lastLine.length < 60;
  return {
    hasFormulaChars: FORMULA_RE.test(content),
    hasMojibake: MOJIBAKE_RE.test(content),
    softHyphenation: count(SOFT_HYPHEN_RE, content),
    leadingHeader: LEADING_HEADER_RE.test(trimmed),
    trailingPageNum: /\s\d{1,4}(\s*-\s*\d{1,4})?\s*$/.test(trimmed),
    assetCodes: count(ASSET_RE, content),
    letterSpacing: countLetterSpacing(content),
    // termina sin puntuación de cierre => la oración sigue en el próximo chunk
    sentenceCut:
      core.length > 0 && !/[.!?…»"'):\]]/.test(lastChar) && !listLikeEnding,
    veryShort: trimmed.length < 40,
  };
}

/** Conteos/sumas agregados sobre un lote de chunks (los de la tabla de exp1). */
export interface FlagSummary {
  total: number; // chunks analizados
  mojibakeChunks: number;
  formulaChunks: number;
  softHyphenChunks: number;
  softHyphenCases: number;
  leadingHeaderChunks: number;
  trailingPageNumChunks: number;
  assetCodeChunks: number;
  assetCodeCases: number;
  letterSpacingChunks: number;
  letterSpacingCases: number;
  sentenceCutChunks: number;
  veryShortChunks: number;
}

/** Agrega las señales de todos los chunks a los conteos/sumas de la tabla. */
export function summarizeFlags(flags: ChunkFlags[]): FlagSummary {
  const nWith = (k: keyof ChunkFlags) =>
    flags.filter((f) => Number(f[k]) > 0).length;
  const sum = (k: keyof ChunkFlags) =>
    flags.reduce((s, f) => s + Number(f[k]), 0);
  return {
    total: flags.length,
    mojibakeChunks: nWith("hasMojibake"),
    formulaChunks: nWith("hasFormulaChars"),
    softHyphenChunks: nWith("softHyphenation"),
    softHyphenCases: sum("softHyphenation"),
    leadingHeaderChunks: nWith("leadingHeader"),
    trailingPageNumChunks: nWith("trailingPageNum"),
    assetCodeChunks: nWith("assetCodes"),
    assetCodeCases: sum("assetCodes"),
    letterSpacingChunks: nWith("letterSpacing"),
    letterSpacingCases: sum("letterSpacing"),
    sentenceCutChunks: nWith("sentenceCut"),
    veryShortChunks: nWith("veryShort"),
  };
}
