/**
 * Coincidencia de texto sin embeddings ni LLM: normalización, n-gramas y
 * containment. Determinista y barato — para ubicar un texto conocido dentro del
 * corpus (¿en qué chunk empieza esta lección?), no para buscar por significado.
 *
 * Extraído de `packages/eval/src/reanchor-golden.ts`, donde se validó
 * re-anclando 61 preguntas del golden a un libro distinto: la pasada de
 * containment sola acertó ~80%, y 60/61 sumando el segundo mejor candidato.
 */

/** Tamaño de n-grama por defecto. Bajo esto, `enChunk` cae a substring. */
export const NGRAM_N = 4;

/** Normaliza para comparar: sin puntuación, sin dobles espacios, minúsculas.
 *  Conserva acentos y ñ/ü — en español distinguen palabras, no son ruido. */
export function norm(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\wáéíóúñü ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ngrams(words: string[], n = NGRAM_N): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/** Palabras vacías del español: no distinguen un pasaje de otro. */
export const STOP = new Set(
  ("de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si " +
    "porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos " +
    "uno les ni contra otros ese eso ante ellos e esto mi antes algunos unos yo otro otras otra el tanto esa " +
    "estos mucho quienes nada muchos cual sea poco ella estar haber estas estaba estamos algunas algo " +
    "nosotros mi mis tu te ti tus ellas nosotras vosotros vosotras os mio mia mios mias es son fue ser").split(" "),
);

/** Palabras de contenido: las que tienen que estar sí o sí. */
export function claves(texto: string): string[] {
  return [...new Set(norm(texto).split(" "))].filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * ¿Cuánto de `query` está contenido en `chunkNormalizado`? 0-1.
 *
 * El fallback a substring para textos de menos de NGRAM_N palabras NO es un
 * detalle: un título de lección puede tener 2-3 palabras ("El Chile liberal") y
 * ahí el set de 4-gramas es vacío, lo que daría 0/0. Sin este caso, todos los
 * títulos cortos quedarían sin ubicar.
 *
 * `chunkNormalizado` ya tiene que venir por `norm()` — se pasa normalizado para
 * poder puntuar miles de chunks sin re-normalizar en cada comparación.
 */
export function enChunk(query: string, chunkNormalizado: string): number {
  const q = norm(query);
  if (!q) return 0;
  const w = q.split(" ");
  if (w.length < NGRAM_N) return chunkNormalizado.includes(q) ? 1 : 0;
  const g = ngrams(w);
  if (g.size === 0) return 0;
  let hit = 0;
  for (const x of g) if (chunkNormalizado.includes(x)) hit++;
  return hit / g.size;
}

/** Fracción de las palabras de contenido de `query` presentes en el chunk. */
export function coberturaClaves(query: string, chunkNormalizado: string): number {
  const ks = claves(query);
  if (ks.length === 0) return 0;
  let hit = 0;
  for (const k of ks) if (chunkNormalizado.includes(k)) hit++;
  return hit / ks.length;
}
