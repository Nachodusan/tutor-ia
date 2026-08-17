/**
 * PUENTE DE VOCABULARIO: reescribe la pregunta del alumno a registro de libro
 * ANTES del retrieval.
 *
 * Por qué existe (medido 2026-08-01): el cross-encoder puntúa el par
 * «profe no cacho q es el narrador» ↔ chunk correcto en 0.006, y el par
 * «¿Qué es el narrador en un cuento?» ↔ MISMO chunk en 0.24 — 40× por la
 * redacción. Eso abstenía 17/43 preguntas de alumno con el material correcto ya
 * recuperado y bien rankeado. Normalizar la consulta ataca la causa en TODOS los
 * eslabones a la vez (denso, léxico, reranker y gate); su techo medido es
 * +38,4 pts de recall@5 (la formulación de libro de las mismas preguntas).
 *
 * Decisiones de diseño:
 *  - SOLO la consulta de búsqueda. La pregunta original sigue intacta hacia el
 *    modelo docente y hacia los regex (social/vago/struggling): ahí el registro
 *    coloquial es señal.
 *  - Provider aparte del de la enseñanza (ver getNormalizer), para poder
 *    apuntarlo a un modelo más chico sin tocar el resto. Cuando esto se diseñó
 *    el modelo era local, o sea gratis; hoy es remoto y cada rescate se paga.
 *    Lo que lo mantiene barato es CRUDA-PRIMERO: solo corre cuando la búsqueda
 *    con las palabras del alumno ya falló.
 *  - FAIL-OPEN estricto: timeout, error, salida vacía o desproporcionada → se
 *    usa la original. La normalización no puede romper un turno jamás.
 */
import { config } from "./config";
import { makeProvider } from "./llm";
import type { LLMProvider } from "./llm/types";

const SYSTEM = `Reescribís preguntas de estudiantes chilenos a lenguaje claro de libro escolar.

Reglas ESTRICTAS:
- Corregí ortografía y abreviaciones (q→que, xq→por qué, kien→quién).
- Pasá el registro coloquial a una pregunta clara y neutra.
- CONSERVÁ el idioma (español), el tema y TODO detalle concreto (nombres, títulos, números).
- NO respondas la pregunta. NO agregues información ni contexto que no esté.
- NO inventes nombres propios que el estudiante no dijo.
- Devolvé SOLO la pregunta reescrita, sin comillas ni explicación.`;

/**
 * MULETILLAS DE ARRANQUE — se sacan de la CONSULTA, nunca del mensaje.
 *
 * Medido con el mismo material y la misma pregunta:
 *   "¿qué es una célula?"                    → topScore 0.383, 6 fragmentos
 *   "no, mejor explicame qué es una célula"  → topScore 0.084, NADA
 * La misma duda, escrita como habla un chico, se quedaba sin libro. Y es la
 * forma en que se escribe cuando la conversación ya empezó: es justo el turno
 * donde el tutor tiene que estar más fino, no menos.
 *
 * El puente por LLM (abajo) ataca lo mismo pero cuesta una llamada y solo corre
 * cuando el gate ya cortó; esto es determinista, gratis y corre siempre. Se
 * sacan SOLO arranques cerrados —interjecciones, conectores y verbos de pedido—
 * y nunca contenido: si al terminar no queda nada sustantivo, se usa la original.
 */
const MULETILLAS: RegExp[] = [
  // "no," · "sí" · "ok" · "dale" · "bueno" · "ah" · "oye" · "profe" · "mirá"
  /^(?:no|s[íi]|ok(?:ey|ay)?|dale|bueno|ah+|eh+|mmm+|oye|profe|hola|mir[áa]|mira|escuch[áa])\b[\s,.:;!¡]*/i,
  // conectores de arranque
  /^(?:mejor|entonces|ahora|igual|pero|y|adem[áa]s|tambi[ée]n|a\s+ver)\b[\s,.:;!¡]*/i,
  // "me podés" · "podrías" · "quiero saber" · "necesito que me"
  /^(?:me\s+)?(?:pod[ée]s|puedes|podr[íi]as|quiero\s+saber|quiero\s+que\s+me|necesito\s+que\s+me|necesito|quiero)\b[\s,.:;]*/i,
  // verbos de pedido: "explicame", "contame", "decime", "enseñame", "hablame de"
  /^(?:explic[áa]r?(?:me(?:l[oa])?)?|expl[íi]came|cont[áa]r?me|dec[íi]r?me|ens[eé][ñn][áa]?r?me|h[áa]bl[áa]?r?me\s+de|ayud[áa]me\s+con)\b[\s,.:;]*/i,
  // cortesía al principio
  /^(?:por\s*favor|porfa+|porfis|plis)\b[\s,.:;]*/i,
];

/** Saca las muletillas de arranque. Devuelve la original si no queda nada. */
export function limpiarMuletillas(q: string): string {
  let t = q.trim().replace(/^[¿¡\s]+/, "");
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const antes = t;
    for (const re of MULETILLAS) t = t.replace(re, "");
    t = t.replace(/^[¿¡\s,.:;]+/, "");
    if (t === antes) break;
  }
  // Que quede algo con sustancia: si de "no, dale" no sobra nada, la original.
  return t.trim().length >= 4 ? t.trim() : q.trim();
}

export interface NormalizedQuery {
  /** La consulta a usar: la reescrita, o la original si falló o no cambió. */
  query: string;
  changed: boolean;
  ms: number;
}

/**
 * Provider propio (no toca el memo global), para poder apuntarlo a un modelo
 * más chico que el de la enseñanza sin tocar el resto.
 *
 * Antes corría contra un `qwen2.5:3b` LOCAL mientras la generación principal iba
 * a la API. Al eliminar Ollama ese modelo dejó de existir, así que por defecto
 * usa el modelo principal (`config.queryNormalizerModel` queda vacío → el
 * default del proveedor). Es más grande de lo que la tarea pide, pero esto vive
 * en la política CRUDA-PRIMERO: solo se paga cuando la búsqueda con la
 * formulación textual del alumno ya falló, que es la minoría de los turnos.
 * Si aparece un modelo chico conveniente en la API, se apunta con
 * QUERY_NORMALIZER_MODEL y nada más cambia.
 */
let normalizer: LLMProvider | null = null;
function getNormalizer(): LLMProvider {
  normalizer ??= makeProvider("deepinfra", config.queryNormalizerModel);
  return normalizer;
}

/** ¿La salida es una reescritura creíble de la entrada? Guardas baratas contra
 *  un modelo que divaga: vacía, desproporcionada o multilínea → descartar. */
function plausible(original: string, rewritten: string): boolean {
  const r = rewritten.trim();
  if (!r) return false;
  if (r.includes("\n")) return false;
  const ratio = r.length / Math.max(1, original.trim().length);
  return ratio >= 0.4 && ratio <= 3;
}

/* ────────────────────────────────────────────────────────────────────────────
 * PUENTE DE VOCABULARIO — la palabra del chico → la palabra del libro.
 *
 * Es OTRA función y no un cambio en `normalizeStudentQuery` por dos razones. La
 * de arriba la usa también el plan a medida, que le pasa la reescritura al
 * modelo como CONTEXTO para redactar los títulos: una lista de términos ahí
 * produce "tu plan sobre: factorización, cuadrado de binomio, productos
 * notables". Y porque hacen trabajos distintos: aquella arregla CÓMO está
 * escrita la pregunta (ortografía, registro); esta cambia QUÉ palabras se
 * buscan. Lo que sale de acá NUNCA se le muestra al alumno: es consulta.
 *
 * EL PROBLEMA, medido. "¿Cómo se factoriza un trinomio?" abstiene con 0.1067
 * aunque el libro enseñe eso mismo en las págs. 55-56. La palabra "trinomio"
 * aparece 0 veces en el texto del estudiante de 2º Medio: los textos chilenos
 * lo llaman "ecuación de segundo grado", "producto notable", "cuadrado de
 * binomio". Con los términos del libro, la misma duda saca 0.90 y la página
 * correcta queda primera. En una batería de 18 términos reales de alumno, 6
 * dejaban al chico sin su libro, y `content = 0` predijo la abstención en 18 de
 * 18 casos: el reranker no falla, informa que la palabra no existe.
 *
 * TRES REGLAS QUE SALIERON DE MEDIR, y las tres son contraintuitivas:
 *
 *  1. SE REEMPLAZA LA PREGUNTA, NO SE LE SUMA. La palabra del alumno no es
 *     ruido neutro, es veneno: a la misma lista de términos, borrarle
 *     "trinomio" la subió de 0.6694 a 0.9034. Concatenar la pregunta original
 *     puntúa siempre peor — y es lo que produce la fuga del punto 3.
 *  2. NO SE ELIGE UN TÉRMINO, SE PEGAN TODOS. De los 5 que devolvió el modelo,
 *     uno solo funcionaba limpio y TRES abstenían por separado; concatenados,
 *     rescatan el caso. No hay forma de saber cuál sirve sin medirlo.
 *  3. LISTA DE TÉRMINOS, NUNCA PROSA. Dejar que el modelo escriba un párrafo
 *     (HyDE) da el score más alto de todo el experimento —0.9996— y es una
 *     trampa: SATURA el cross-encoder, todo el corpus puntúa ~0.999 y la página
 *     de oro se hunde al puesto #99. Un topScore alto con margen bajo no es
 *     acierto, es saturación.
 *
 * ⚠️ LO QUE HAY QUE VIGILAR es que esto NO abra la puerta cuando no hay nada
 * atrás. "¿Cómo se calcula la derivada?" no existe en 2º Medio y tiene que
 * seguir abstiniéndose: con la forma correcta se queda en 0.0880, pero
 * concatenando la pregunta original pasa a 0.6193 y cita el solucionario. Una
 * abstención correcta convertida en respuesta inventada CON página es peor que
 * no haber respondido. Por eso los controles negativos están en el test.
 */
const PUENTE_SYSTEM = `Escribís los TÍTULOS DE SECCIÓN con los que un libro de texto escolar chileno nombra el contenido que el alumno está preguntando. Como si copiaras del ÍNDICE del libro.

Devolvés 4 o 5 títulos, UNO POR LÍNEA. Nada más: sin numerar, sin viñetas, sin explicación, y sin contestar la pregunta.

Reglas:
- Escribilos como los titula el libro, no como habla un alumno.
- ⚠️ Si el alumno usó una palabra que los textos escolares chilenos NO usan para titular ese contenido, TRADUCILA a la que sí usan. Dos ejemplos de traducción: "trinomio" se titula "Factorización", "Productos notables", "Cuadrado de binomio", "Ecuación de segundo grado"; "sumar polinomios" se titula "Términos semejantes", "Reducción de términos semejantes", "Expresiones algebraicas".
- Incluí el nombre del tema Y el del procedimiento cuando existan los dos.
- Devolvé NADA SOLO si lo que preguntan no es contenido de ninguna materia escolar. Si es un tema escolar, siempre hay títulos: escribilos aunque el alumno lo haya nombrado distinto, y aunque creas que corresponde a otro curso.`;

/**
 * ¿Es una lista de títulos o el modelo se puso a escribir?
 *
 * ⚠️ ESTA GUARDA YA ESTUVO MAL UNA VEZ, y del modo más caro: la escribí desde el
 * resumen del hallazgo ("lista de términos, no prosa") en vez de mirar las
 * salidas que de verdad habían ganado la medición. Rechazaba saltos de línea y
 * frases de más de seis palabras — o sea tiraba exactamente la mejor,
 * "Factorización de trinomios de la forma x² + bx + c", que son nueve. El puente
 * devolvía `null` siempre y el caso no mejoraba nada.
 *
 * Lo que separa de verdad una lista de la prosa (medido sobre las salidas
 * reales): la prosa viene de corrido, larga, con oraciones que empiezan con
 * conectores y a menudo con fórmulas en LaTeX. Los títulos son pocos, cortos y
 * sin puntuación de oración. Por eso el límite es el TOTAL de palabras y la
 * pinta de cada renglón, no el formato del separador.
 */
export function esListaDeTerminos(s: string): boolean {
  const bruto = s?.trim();
  if (!bruto || /^NADA$/i.test(bruto)) return false;
  if (bruto.length > 400) return false;
  if (/[?¿]/.test(bruto)) return false;
  const titulos = partirTitulos(bruto);
  if (titulos.length < 2 || titulos.length > 8) return false;
  const palabras = bruto.split(/\s+/).length;
  if (palabras > 60) return false;   // HyDE medía ~120: eso es un párrafo
  return titulos.every((t) => {
    const n = t.split(/\s+/).length;
    if (n < 1 || n > 12) return false;
    // También por caracteres: un chorro sin espacios cuenta como UNA palabra y
    // se colaba por el límite de arriba. El título más largo que ganó la
    // medición mide 81 ("Métodos de factorización: Trinomios cuadrados
    // perfectos y diferencia de cuadrados").
    if (t.length > 100) return false;
    return !/[.!]$/.test(t);          // un título no termina en punto
  });
}

/**
 * Un renglón por título, o comas si el modelo las prefirió.
 *
 * El rótulo de arranque ("Respuesta:", "Títulos:") se saca en vez de invalidar
 * la salida: es un tic de formato, no prosa, y tirar una traducción buena por
 * eso deja al chico sin su libro. Ojo que los dos puntos NO se pueden usar como
 * señal de prosa — un título real los lleva: "Métodos de factorización:
 * Trinomios cuadrados perfectos y diferencia de cuadrados".
 */
function partirTitulos(s: string): string[] {
  const sinRotulo = s.replace(/^\s*(respuestas?|t[íi]tulos?|t[ée]rminos?|secciones?)\s*:\s*/i, "");
  const porLinea = sinRotulo.split("\n").map((t) => t.trim().replace(/^[-•*\d.)\s]+/, "")).filter(Boolean);
  if (porLinea.length > 1) return porLinea;
  return sinRotulo.split(",").map((t) => t.trim()).filter(Boolean);
}

/** Los saltos de línea no llegan a la búsqueda: se pega todo en una consulta. */
export const aConsulta = (s: string): string => partirTitulos(s).join(", ");

/**
 * Devuelve los términos del libro para buscar, o `null` si no hay traducción
 * confiable. `null` significa "seguí abstiniéndote", nunca "inventá".
 */
export async function puenteDeVocabulario(
  pregunta: string,
  materia?: string | null,
  curso?: string | null,
): Promise<{ query: string; ms: number } | null> {
  const started = Date.now();
  const q = pregunta.trim();
  if (!config.queryNormalize || q.length < 8) return null;
  const donde = [materia, curso].filter(Boolean).join(" · ");
  try {
    const out = await getNormalizer().generate(
      [
        { role: "system", content: PUENTE_SYSTEM },
        { role: "user", content: donde ? `Materia: ${donde}\nPregunta: ${q}` : q },
      ],
      { temperature: 0, maxTokens: 80, timeoutMs: config.queryNormalizeTimeoutMs },
    );
    const limpio = out.trim().replace(/^["«»']+|["«»']+$/g, "");
    if (!esListaDeTerminos(limpio)) return null;
    return { query: aConsulta(limpio), ms: Date.now() - started };
  } catch {
    // Proveedor caído o timeout: el turno sigue abstiniéndose, que es lo seguro.
    return null;
  }
}

export async function normalizeStudentQuery(q: string): Promise<NormalizedQuery> {
  const started = Date.now();
  const original = q.trim();
  if (!config.queryNormalize || original.length < 8) {
    return { query: original, changed: false, ms: 0 };
  }
  try {
    const out = await getNormalizer().generate(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: original },
      ],
      {
        temperature: 0,
        maxTokens: 80,
        timeoutMs: config.queryNormalizeTimeoutMs,
      },
    );
    const rewritten = out.trim().replace(/^["«»']+|["«»']+$/g, "");
    if (!plausible(original, rewritten) || rewritten === original) {
      return { query: original, changed: false, ms: Date.now() - started };
    }
    return { query: rewritten, changed: true, ms: Date.now() - started };
  } catch {
    // Proveedor caído, modelo inexistente, timeout: el turno sigue con la cruda.
    return { query: original, changed: false, ms: Date.now() - started };
  }
}
