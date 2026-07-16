/**
 * Utilidades PURAS de scoring para los experimentos (§10). Sin I/O, sin modelo:
 * comparaciones determinísticas de respuestas para las suites MATH y GRADING.
 *
 * Nota: para matemática esto es comparación textual/numérica simple. La ruta
 * simbólica robusta (normalización algebraica con SymPy — Eje B) llega en Fase 2;
 * por ahora alcanza para respuestas finales cerradas.
 */

/** Intenta parsear una cadena a número (acepta coma decimal). null si no parsea. */
function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte a número una respuesta "cerrada": entero/decimal (`3`, `1.5`, `-2`)
 * o fracción simple (`1/2` → 0.5). null si no es un número puro.
 */
function toNumber(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    return b !== 0 && Number.isFinite(a) && Number.isFinite(b) ? a / b : null;
  }
  return null;
}

/**
 * Extrae los tokens numéricos de un texto (enteros, decimales, fracciones),
 * como números. "el límite vale 1" → [1]; "x = 15" → [15]; "1/2 aprox" → [0.5].
 * Clave para no confundir 15 con 5 al comparar (el bug del substring).
 */
function extractNumbers(s: string): number[] {
  const toks = s.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?/g) ?? [];
  const out: number[] = [];
  for (const tk of toks) {
    const v = toNumber(tk);
    if (v !== null) out.push(v);
  }
  return out;
}

/**
 * Normaliza una respuesta para comparar: minúsculas, colapsa espacios y quita
 * puntuación/espacios de los BORDES (no del interior).
 */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .trim();
}

/**
 * Compara dos respuestas como números si AMBAS parsean a número, dentro de una
 * tolerancia. Si alguna no es numérica, devuelve false (que decida el matcher textual).
 */
export function numericEqual(a: string, b: string, tol = 1e-6): boolean {
  const na = parseNum(a);
  const nb = parseNum(b);
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) <= tol;
}

/**
 * ¿La predicción coincide con la respuesta esperada?
 *
 * - Si el GOLD es un número (o fracción), la predicción coincide solo si alguno
 *   de sus tokens numéricos es numéricamente igual al gold. Así "el límite es 1"
 *   coincide con "1", pero "12" NO coincide con "2" ni "x = 15" con "5"
 *   (evita el falso positivo del substring que detectó la revisión).
 * - Si el GOLD es textual, coincide por igualdad normalizada o si la predicción
 *   lo contiene (el modelo suele envolver la respuesta en texto).
 */
export function answerMatches(pred: string, gold: string): boolean {
  const goldNum = toNumber(gold);
  if (goldNum !== null) {
    return extractNumbers(pred).some((n) => Math.abs(n - goldNum) <= 1e-6);
  }
  const p = normalizeAnswer(pred);
  const g = normalizeAnswer(gold);
  if (g === "") return p === "";
  return p === g || p.includes(g);
}

/** Porcentaje formateado (1 decimal). 'n/a' si el denominador es 0. */
export function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((n / d) * 100).toFixed(1)}%`;
}
