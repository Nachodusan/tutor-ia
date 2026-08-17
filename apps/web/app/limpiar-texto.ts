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

/** Lo que delata una fórmula adentro de un par de `$`. Ver el aviso en `limpiarMarcas`. */
const LATEX_ADENTRO = /[\\^_{}]/;

/** Exponentes a dígito en alto: `x^2` se lee mal, `x²` se lee como en el cuaderno.
 *  Solo dígitos — `3^x` se deja como está, que no tiene forma en Unicode. */
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
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)")
    .replace(/\\(times|cdot|div|pm|leq|geq|neq)\b/g, (m, c: string) => SIMBOLO[c] ?? m)
    .replace(/\\(left|right|!|,|;)/g, "")
    .replace(/([A-Za-zÀ-ÿ0-9)\]])\^\{?(\d)\}?/g, (_m, base: string, d: string) => base + ALTO[d]!);
}

/**
 * Saca el markup que la app no interpreta.
 *
 * Solo toca los DELIMITADORES, nunca el contenido: `$x^2 + 1$` queda "x² + 1". El
 * asterisco suelto no se toca — puede ser una multiplicación (2*3).
 *
 * ⚠️ EL PAR DE `$` NO SE BORRA POR ESTAR PAREADO. Acá los precios se escriben con
 * peso, y "cuesta $5 y el otro $8" tiene dos signos que NO son LaTeX: borrarlos
 * dejaba "cuesta 5 y el otro 8", que en Historia o Ciudadanía cambia el sentido de
 * la frase. Solo se limpia cuando lo de adentro delata la fórmula.
 *
 * ⚠️ EL ORDEN IMPORTA. Los `$` se sacan ANTES de traducir los comandos: el guardia
 * de precios se apoya en las marcas (`\`, `^`, `{}`) para distinguir una fórmula de
 * cinco lucas, y `latexAMano` es justamente lo que las borra. Al revés,
 * `$ax^2+bx+c$` se convertía en `$ax²+bx+c$` y los signos quedaban puestos.
 */
export function limpiarMarcas(t: string): string {
  const sinDelimitadores = t.replace(/\$([^$\n]{1,80})\$/g, (m, dentro: string) =>
    LATEX_ADENTRO.test(dentro) ? dentro : m);
  return latexAMano(sinDelimitadores)
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")   // **negrita**
    .replace(/__([^_\n]+)__/g, "$1")       // __negrita__
    .replace(/`([^`\n]*)`/g, "$1")         // `código`
    .replace(/^#{1,6}\s+/gm, "");          // ### Título
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
