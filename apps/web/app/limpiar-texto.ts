/**
 * LIMPIEZA DEL TEXTO DEL TUTOR, antes de pintarlo.
 *
 * Vive acá y no adentro del chat por una razón práctica: adentro de un componente
 * "use client" no hay forma de probarlo. Como funciones puras se prueban con
 * `apps/web/test/limpiar-texto.test.mjs`, igual que `voz-turno.ts`.
 *
 * QUÉ RESUELVE. La burbuja pinta TEXTO PLANO (`whiteSpace: pre-wrap`, sin renderer
 * de markdown ni KaTeX): lo que el modelo escriba se ve tal cual. Un `**` o un
 * `$x$` los lee el chico en la pantalla, y la voz los pronuncia ("asterisco
 * asterisco", "dólar equis dólar").
 *
 * EL PROMPT YA LOS PROHÍBE, EN MAYÚSCULAS, Y SE ESCAPAN IGUAL: midiendo ocho
 * respuestas después de prohibirlos, siete salieron limpias y una insistió con una
 * negrita para enfatizar. Una regla de prompt es probabilística; esto no. Es el
 * mismo criterio que las páginas ("pág. 8"), que también están prohibidas en el
 * prompt y también se limpian acá desde antes.
 */

/**
 * PLATA, no fórmula. Un par de `$` se saca SIEMPRE salvo que lo de adentro tenga
 * pinta de monto: arranca con un número y, si sigue algo, va separado por espacio
 * ("5 y el otro ", "500.000 a ").
 *
 * ⚠️ ESTO ESTUVO AL REVÉS Y FALLÓ EN PRODUCCIÓN. La primera versión solo limpiaba
 * cuando adentro había `\`, `^`, `_` o llaves, y el quiz servía preguntas como
 * `$(x - 3)(x + 2) = 0$` —LaTeX legítimo, sin ninguna de esas marcas— que llegaban
 * con los signos puestos a la pantalla. Presumir fórmula y exceptuar la plata
 * cubre los dos casos; al revés, solo cubría el que se me había ocurrido.
 */
const MONTO = /^\d[\d.,]*(?:\s+\D[\s\S]*)?$/;

/** …y ningún monto lleva barra de comando, exponente ni igual. Sin esto,
 *  `$2 \times 3 = 6$` pasaba por plata solo por empezar con un dígito. */
const MARCA_FORMULA = /[\\^_{}=]/;

const pareceMonto = (s: string): boolean => MONTO.test(s) && !MARCA_FORMULA.test(s);

/**
 * Exponentes a dígito en alto: `x^2` se lee mal, `x²` se lee como en el cuaderno.
 * Solo dígitos — `3^x` se deja como está, que no tiene forma en Unicode.
 *
 * ⚠️ EL EXPONENTE PUEDE TENER VARIOS DÍGITOS, y esto ya se rompió una vez. La
 * primera versión capturaba `(\d)`, un solo dígito, y en Química el número de
 * Avogadro `6,02 x 10^23` salía como `10²3`: no es markup a la vista, es peor,
 * porque el número queda MAL y el chico lo copia así. Le pegaba a toda la
 * notación científica, o sea a Química y Física enteras.
 */
const ALTO: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

const SIMBOLO: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", leq: "≤", geq: "≥", neq: "≠",
};

/**
 * Los comandos que sobreviven a sacarles los `$`. Sin esto el chico lee
 * `\frac{1}{2}`, que es tan ilegible como la versión con signos de peso: si la red
 * existe, que deje algo que se pueda leer.
 */
export function latexAMano(t: string): string {
  return t
    .replace(/\\d?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)")
    // La raíz con índice va ANTES que la simple, o la simple no matchea y el
    // `[3]` queda suelto. Apareció de verdad: una opción del quiz de "Raíz
    // enésima" era, tal cual, `\sqrt[3]{35}`.
    .replace(/\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]+)\}/g, (_m, indice: string, x: string) =>
      `${[...indice].every((c) => ALTO[c]) ? [...indice].map((c) => ALTO[c]!).join("") : indice}√(${x})`)
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)")
    .replace(/\\(times|cdot|div|pm|leq|geq|neq)\b/g, (m, c: string) => SIMBOLO[c] ?? m)
    .replace(/\\(left|right|!|,|;)/g, "")
    .replace(/([A-Za-zÀ-ÿ0-9)\]])\^\{?(\d+)\}?/g, (_m, base: string, digitos: string) =>
      base + [...digitos].map((d) => ALTO[d]!).join(""));
}

/**
 * Saca el markup que la app no interpreta.
 *
 * Solo toca los DELIMITADORES, nunca el contenido: `$x^2 + 1$` queda "x² + 1". El
 * asterisco suelto no se toca — puede ser una multiplicación (2*3).
 *
 * ⚠️ EL PAR DE `$` NO SE BORRA A CIEGAS. Acá los precios se escriben con peso, y
 * "cuesta $5 y el otro $8" tiene dos signos que NO son LaTeX: borrarlos dejaba
 * "cuesta 5 y el otro 8", que en Historia o Ciudadanía cambia la frase. La regla
 * es al revés de lo intuitivo — se limpia salvo que parezca un monto (ver `MONTO`).
 *
 * ⚠️ EL ORDEN IMPORTA. Los `$` se sacan ANTES de traducir los comandos, porque
 * `latexAMano` borra justamente las marcas que ayudan a leer el contenido. Al
 * revés, `$ax^2+bx+c$` se convertía en `$ax²+bx+c$` y los signos quedaban puestos.
 */
export function limpiarMarcas(t: string): string {
  const sinDelimitadores = t.replace(/\$([^$\n]{1,80})\$/g, (m, dentro: string) =>
    pareceMonto(dentro) ? m : dentro);
  return latexAMano(sinDelimitadores)
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")   // **negrita**
    .replace(/__([^_\n]+)__/g, "$1")       // __negrita__
    .replace(/`([^`\n]*)`/g, "$1")         // `código`
    .replace(/^#{1,6}\s+/gm, "");          // ### Título
}

/**
 * Preguntas de opción múltiple (quiz de lección y prueba), limpiadas al RECIBIRLAS.
 *
 * Van con `limpiarMarcas` y NO con `cleanTutorText`: ese re-capitaliza el inicio, y
 * una opción como "ax² + bx + c = 0" quedaría "Ax² + bx + c = 0" — en matemática
 * la mayúscula es otra variable, así que la respuesta correcta pasaría a estar mal
 * escrita.
 *
 * ⚠️ SE LIMPIA AL PINTAR, NO SOLO AL GENERAR. El prompt del quiz ahora prohíbe el
 * LaTeX, pero las preguntas se CACHEAN (`lesson_quizzes`, `on conflict do nothing`):
 * las tandas sucias que ya están guardadas —medidas: 7 de 10 y 10 de 10 preguntas
 * en Matemática, con cuatro opciones que eran `\sqrt{16 \cdot 4}`— seguirían
 * saliendo así para siempre. Limpiar acá las arregla sin tocar la base.
 */
export function limpiarPregunta<T extends { question: string; options: string[]; explain?: string | null }>(q: T): T {
  return {
    ...q,
    question: limpiarMarcas(q.question),
    options: q.options.map(limpiarMarcas),
    ...(q.explain ? { explain: limpiarMarcas(q.explain) } : {}),
  };
}

/**
 * Lo que se pinta. Además del markup, saca las páginas y los "según el material"
 * que el prompt también prohíbe: las referencias se muestran aparte, en su propio
 * desplegable, y repetirlas adentro del texto suena a informe, no a alguien
 * explicando.
 */
export function cleanTutorText(t: string): string {
  return limpiarMarcas(t)
    .replace(/\s*\((?:p[áa]gs?\.?|p\.)\s*\d+(?:\s*[-–—]\s*\d+)?\)/gi, "") // (pág. 8) (págs. 8-9)
    .replace(/\bseg[úu]n\s+(el|tu|los|la|las)\s+(material|fragmento|apunte|texto|gu[íi]a)s?\b[,:]?\s*/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?…])/g, "$1")
    // re-capitaliza inicio de oración (por si quedó minúscula al sacar "Según…,")
    .replace(/(^|[.!?¡¿]\s+)([a-záéíóúüñ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}
