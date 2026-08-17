/**
 * DE LO QUE ESCRIBE EL CHICO A LO QUE ENTIENDE SymPy.
 *
 * Es el cimiento del modo ejercicio: si esto falla, falla todo lo que va arriba
 * —el resultado, los pasos verificados y el gráfico— y falla en silencio, porque
 * una expresión mal parseada igual devuelve UN número.
 *
 * El teclado de matemática (`teclado-mate.tsx`) produce caracteres que ningún
 * parser entiende: superíndices Unicode (x², 5x⁴), el menos tipográfico U+2212
 * (−, que NO es el guion ASCII), √, ×, ÷, π. Y el chico agrega los suyos.
 *
 * LO QUE NO HAY QUE NORMALIZAR, porque `sympy_check.py` ya lo resuelve con sus
 * transformaciones: `x^2` (convert_xor) y `2x` (implicit_multiplication). Meter
 * mano ahí solo agrega formas de romperlo.
 *
 * ⚠️ LA COMA DECIMAL. Acá "2,5" son dos y medio. Para SymPy la coma separa
 * argumentos, así que "solve(Eq(2,5*x, 10))" se lee como TRES argumentos y da
 * cualquier cosa. Se convierte solo entre dígitos, que es el único caso donde la
 * coma es decimal y no separador.
 */

/** Superíndices Unicode → exponente con `^` (que `convert_xor` traduce después). */
const SUPER: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "ⁿ": "n",
};

const SIMBOLO: Record<string, string> = {
  "−": "-",   // U+2212 MINUS SIGN: se ve igual que el guion y no lo es
  "–": "-", "—": "-",
  "×": "*", "·": "*", "∙": "*",
  "÷": "/", "∕": "/",
  "π": "pi",
  "≤": "<=", "≥": ">=",
  ",": ",",   // se trata aparte (coma decimal)
};

/** Subíndices Unicode, para `log₂`. */
const SUB: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

/** Nombres de funciones como se escriben en el colegio chileno. */
const FUNCIONES: [RegExp, string][] = [
  [/\bsen\b/gi, "sin"],
  [/\btg\b/gi, "tan"],
  [/\bctg\b|\bcotg\b/gi, "cot"],
  [/\barcsen\b/gi, "asin"],
];

/** `f(x) = …`, `y = …`, `g(t) = …` al principio: es una definición, no una ecuación. */
const DEFINICION = /^\s*(?:[a-z]\s*\(\s*[a-z]\s*\)|[yf])\s*=\s*/i;

/** Índice del paréntesis que cierra al que abre en `desde`. -1 si no cierra. */
function cierra(s: string, desde: number): number {
  let n = 0;
  for (let i = desde; i < s.length; i++) {
    if (s[i] === "(") n++;
    else if (s[i] === ")" && --n === 0) return i;
  }
  return -1;
}

/**
 * `log` sin base es BASE 10 acá; en SymPy es natural.
 *
 * No es un detalle: `log(x) + log(x-3) = 1` con log natural da
 * `3/2 + sqrt(9 + 4e)/2` y con base 10 da 5. El chico obtiene un número
 * irracional donde su libro tiene un entero. `ln` sí es natural en los dos.
 *
 * Cuenta paréntesis en vez de usar un regex, porque `log(x(x − 3))` anida y un
 * `[^()]*` se corta en el paréntesis de adentro y deja la base afuera.
 */
function logBase10(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const m = /\blog\s*\(/.exec(s.slice(i));
    if (!m) { out += s.slice(i); break; }
    const abre = i + m.index + m[0].length - 1;
    const fin = cierra(s, abre);
    if (fin === -1) { out += s.slice(i); break; }
    const dentro = s.slice(abre + 1, fin);
    out += s.slice(i, abre + 1) + dentro;
    // Si ya trae base (una coma en el nivel de arriba), no se toca.
    out += /,/.test(dentro.replace(/\([^()]*\)/g, "")) ? ")" : ", 10)";
    i = fin + 1;
  }
  return out;
}

/**
 * Pasa el texto del alumno a sintaxis que SymPy parsea.
 * NO decide qué operación hacer: solo traduce los símbolos.
 */
export function aSintaxisSympy(entrada: string): string {
  let s = entrada.trim();

  // Superíndices: "5x⁴" → "5x^4", "x²⁵" → "x^25" (dígitos seguidos, un solo ^).
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ]+/g, (m) => "^" + [...m].map((c) => SUPER[c] ?? "").join(""));

  for (const [de, a] of Object.entries(SIMBOLO)) {
    if (de === ",") continue;
    s = s.split(de).join(a);
  }

  // La raíz: "√(x+9)" ya trae paréntesis; "√25" no.
  s = s.replace(/√\s*\(/g, "sqrt(");
  s = s.replace(/√\s*([0-9]+(?:\.[0-9]+)?|[a-z](?:\^[0-9]+)?)/gi, "sqrt($1)");

  // ⚠️ EL PUNTO DE MILES, ANTES QUE LA COMA DECIMAL. Acá "$5.000" son cinco mil
  // y SymPy lo lee como 5,0: error de factor MIL, y justo en los problemas de
  // plata, que son la mitad de los enunciados. Se saca solo cuando la forma es
  // inequívoca (grupos de exactamente tres dígitos).
  s = s.replace(/\b(\d{1,3})(?:\.(\d{3}))+\b/g, (m) => m.split(".").join(""));
  // Coma decimal SOLO entre dígitos (ver el aviso de arriba).
  s = s.replace(/(\d),(\d)/g, "$1.$2");

  // log₂(8) → log(8, 2). Va ANTES que la base 10, o queda "log(8, 2, 10)".
  s = s.replace(/\blog\s*([₀-₉]+)\s*\(/g, (_m, sub: string) =>
    `LOGB${[...sub].map((c) => SUB[c] ?? "").join("")}(`);
  s = logBase10(s);
  s = s.replace(/\bLOGB(\d+)\(([^()]*)\)/g, "log($2, $1)");

  for (const [re, a] of FUNCIONES) s = s.replace(re, a);

  // El `dx` de la integral es notación, no un factor: sin sacarlo multiplica por d·x.
  s = s.replace(/\s*\bd\s*([a-z])\s*$/i, "");
  s = s.replace(/^∫\s*/, "");

  // ⚠️ LOS SIGNOS DE PREGUNTA NUNCA SON MATEMÁTICA, y quedan PEGADOS al último
  // número: "¿cómo se resuelve x² - 5x + 6 = 0?" terminaba en "0?", el token se
  // daba por matemático (trae un dígito) y el allowlist del puente rechazaba la
  // expresión entera. El ejercicio se iba al chat sin que nada lo explicara.
  s = s.replace(/[¿?¡!]/g, "");

  return s.replace(/\s+/g, " ").trim();
}

export interface Ejercicio {
  /** Expresión lista para SymPy, sin el `f(x) =` si era una definición. */
  expr: string;
  /** Si trae `=`, las dos mitades: se arma `Eq(izq, der)`. */
  ecuacion?: { izq: string; der: string };
  /** La incógnita que se ve en el texto. `x` por defecto. */
  variable: string;
  /** Era una definición de función (`f(x) = …`), no una ecuación a resolver. */
  esDefinicion: boolean;
}

/**
 * Interpreta la ESTRUCTURA del ejercicio, que no es lo mismo que traducir símbolos.
 *
 * La distinción que importa: `f(x) = 5x⁴ − 3x + 2` NO es una ecuación a resolver
 * —igualarla a cero y buscar raíces no es lo que el chico pidió— es una función
 * definida para que después le hagan algo (derivarla, evaluarla, graficarla).
 * `3x + 5 = 20` sí es una ecuación. El signo `=` significa cosas distintas en cada
 * una y confundirlas es responder otro ejercicio.
 */
/**
 * ¿Este pedazo es matemática o es prosa?
 *
 * Un token es matemático si trae un dígito, si es un operador, si es una letra
 * SUELTA (la incógnita) o si tiene forma de función aplicada (`f(x)`). Las
 * palabras quedan afuera por tener dos o más letras seguidas.
 */
function esToken(t: string): boolean {
  if (!t) return false;
  // Los paréntesis y operadores de los bordes se sacan ANTES de mirar el núcleo:
  // sin esto "(x" no era matemática y "desarrollá (x + 5)^2" se cortaba en el
  // paréntesis, así que el ejercicio se iba al chat en vez de armar tarjeta.
  // La función aplicada se mira ENTERA y antes de pelar: `f(x)` pierde su
  // paréntesis de cierre al recortar los bordes y deja de reconocerse.
  if (/^[a-z]\s*\([a-z]\)$/i.test(t)) return true;
  // Y las funciones CON NOMBRE, por lo mismo: `sqrt(x)` quedaba en `sqrt(x` al
  // pelar el paréntesis y dejaba de ser matemática, así que "deriva f(x) = √x =
  // x^(1/2)" se cortaba ahí y la expresión terminaba siendo "= x^(1/2)".
  if (/^(?:sqrt|sin|cos|tan|cot|log|ln|exp|abs)\s*\(/i.test(t)) return true;
  const nucleo = t.replace(/^[+\-*/^=()<>,]+|[+\-*/^=()<>,]+$/g, "");
  if (nucleo === "") return true;             // era solo signos
  if (/\d/.test(nucleo)) return true;
  if (/^[a-z]$/i.test(nucleo)) return true;
  if (/^[a-z]\s*\([a-z]\)$/i.test(nucleo)) return true;
  return /^(?:sqrt|sin|cos|tan|log|ln|exp|pi)$/i.test(nucleo);
}

/**
 * Saca la expresión de adentro de la oración.
 *
 * Sin esto, "resolvé 3x + 5 = 20" llegaba al CAS como
 * `solve(Eq(resolvé 3x + 5, 20), x)` y no resolvía nada: el verbo del alumno
 * viajaba adentro de la fórmula. Se toma la TIRA CONTIGUA más larga de tokens
 * matemáticos, que es lo que deja afuera tanto el "resolvé" del principio como
 * el "¿me explicás?" del final.
 */
export function extraerExpresion(s: string): string {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.every(esToken)) return s.trim();
  let mejor: string[] = [];
  let actual: string[] = [];
  const cerrar = () => {
    const largo = (a: string[]) => a.join(" ").replace(/\s/g, "").length;
    if (largo(actual) > largo(mejor)) mejor = actual;
    actual = [];
  };
  for (const t of tokens) {
    if (esToken(t)) actual.push(t);
    else cerrar();
  }
  cerrar();
  return mejor.join(" ").trim();
}

export function leerEjercicio(entrada: string): Ejercicio {
  const s = extraerExpresion(aSintaxisSympy(entrada));
  const esDefinicion = DEFINICION.test(s);
  let cuerpo = esDefinicion ? s.replace(DEFINICION, "") : s;
  // CADENA DE IGUALDADES: "f(x) = √x = x^(1/2)" es la MISMA función escrita de
  // dos formas, no una ecuación con dos lados. Sacada la definición quedan dos
  // expresiones equivalentes; se usa la primera, que es como el chico la pensó.
  if (esDefinicion && cuerpo.includes("=")) cuerpo = cuerpo.split("=")[0]!.trim();
  const variable = detectarVariable(cuerpo);

  if (!esDefinicion) {
    const partes = cuerpo.split("=");
    if (partes.length === 2 && partes[0]!.trim() && partes[1]!.trim()) {
      return {
        expr: cuerpo,
        ecuacion: { izq: partes[0]!.trim(), der: partes[1]!.trim() },
        variable,
        esDefinicion: false,
      };
    }
  }
  return { expr: cuerpo.trim(), variable, esDefinicion };
}

/** La incógnita: la primera letra suelta que aparezca, prefiriendo `x`. */
function detectarVariable(s: string): string {
  const letras = s.match(/(?<![a-z])[a-z](?![a-z(])/gi);
  if (!letras) return "x";
  const set = new Set(letras.map((l) => l.toLowerCase()));
  for (const pref of ["x", "y", "z", "t", "n"]) if (set.has(pref)) return pref;
  return letras[0]!.toLowerCase();
}

/** Saca los acentos para comparar. Ver el aviso de VERBOS: `\b` es ASCII. */
const sinAcentos = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Qué operación pide el turno. `null` → no es un pedido de ejercicio. */
export type Operacion = "solve" | "diff" | "integrate" | "factor" | "simplify" | "expand";

/**
 * ⚠️ TODOS SIN ACENTOS: el texto se normaliza antes de compararlo.
 *
 * En JavaScript `\b` es ASCII, así que después de una vocal acentuada NO hay
 * límite de palabra y un patrón como `reduc(i|í)r?\b` NO MATCHEA NUNCA. Es la
 * segunda vez que este mismo detalle deja una regla muerta en este archivo —
 * escribir los patrones en ASCII y normalizar la entrada lo cierra de una vez.
 */
/**
 * ⚠️ SIN `\b` AL FINAL DE LA RAÍZ, y esto ya falló: `integr(a|ar|…)\b` no
 * reconoce "integrame" —después de la "a" viene una "m", las dos son letras y no
 * hay límite de palabra— así que el chico que escribía "integrame esto" no
 * recibía la ficha. El límite va solo ADELANTE, que es lo que evita enganchar
 * pedazos de otra palabra.
 */
const VERBOS: [RegExp, Operacion][] = [
  [/\bderiv(a|ar|e)|\bderivada|\bf\s*'\s*\(/i, "diff"],
  [/\bintegr(a|ar|al|e)|\bantiderivada|\bprimitiva|∫/i, "integrate"],
  [/\bfactoriz(a|ar|e)|\bfactores\b|\bdescompon(e|er)|\bfactor\s+comun/i, "factor"],
  [/\bdesarroll(a|ar|e)|\bexpand(i|e|ir)|\b(saca|sacar|multiplica|multiplicar)\s+(los\s+)?parentesis/i, "expand"],
  [/\bsimplific(a|ar|e)|\breducir?\b|\bracionaliz(a|ar)|\bachic(a|ar)/i, "simplify"],
  [/\bresolv(e|er|elo|amos)|\bresuelv|\bcalcul(a|ar|emos)|\bdespej(a|ar)|\bhall(a|ar)|\bencontr(a|ar)\s+(el\s+)?valor|\bhac(e|er)\b|\bcomo\s+hago\b|\bcuanto\s+vale\b|\bvalor\s+de\s+[a-z]\b/i, "solve"],
];

/**
 * El verbo del alumno decide la operación. Si no dice ninguno pero manda una
 * ecuación con `=`, se asume que quiere resolverla — es lo que pide alguien que
 * escribe "x² - 5x + 6 = 0" y nada más.
 */
export function operacionPedida(texto: string, tieneEcuacion: boolean): Operacion | null {
  const t = sinAcentos(texto);
  for (const [re, op] of VERBOS) if (re.test(t)) return op;
  return tieneEcuacion ? "solve" : null;
}

/**
 * ¿Este turno es un ejercicio? Determinista, sin llamadas y SIN dependencias de
 * Node: por eso vive acá y no en `mate-ejercicio.ts`, que importa el puente a
 * Python. El chat lo usa en el NAVEGADOR para decidir si consultar el modo
 * ejercicio antes de mandar al chat normal — si arrastrara `child_process`, el
 * bundle del cliente no compilaría.
 */
/**
 * Preguntas que piden ENTENDER, aunque traigan una ecuación adentro.
 *
 * ⚠️ Este es el borde que más importa del modo ejercicio. "¿por qué x² - 5x + 6 = 0
 * tiene dos soluciones?" trae una ecuación, así que se detectaba como ejercicio y
 * el chico —que preguntó POR QUÉ— recibía una ficha con "2, 3" y ninguna
 * explicación. La respuesta correcta a un "por qué" no es un número.
 *
 * Ojo con "cómo": "¿cómo se resuelve x² - 5x + 6 = 0?" SÍ es un pedido de
 * resolución. Lo que delata la pregunta conceptual es el por qué, el qué
 * significa, el de dónde sale — no el cómo.
 */
// ⚠️ SIN ACENTOS, y no es cosmética: `\b` en JavaScript es ASCII, así que
// después de una "é" NO hay límite de palabra y `qu[ée]\b` no matchea nunca.
// La primera versión de esta guarda no filtraba absolutamente nada.
const CONCEPTUAL = new RegExp(
  [
    "\\bpor\\s*que\\b", "\\bporque\\b",
    "\\bque\\s+significa\\b", "\\bque\\s+quiere\\s+decir\\b",
    "\\bpara\\s+que\\s+(sirve|se\\s+usa)\\b",
    "\\bque\\s+es\\s+(un|una|el|la)\\b",
    "\\bcual\\s+es\\s+la\\s+diferencia\\b", "\\ben\\s+que\\s+se\\s+diferencia\\b",
    "\\bde\\s+donde\\s+(sale|viene|sac)", "\\bcuando\\b",
    "\\bque\\s+pasa\\s+si\\b", "\\bcomo\\s+se\\s+sabe\\b",
  ].join("|"),
  "i",
);

export function esEjercicio(texto: string): { op: Operacion; expr: string } | null {
  if (CONCEPTUAL.test(sinAcentos(texto))) return null;
  const e = leerEjercicio(texto);
  if (!e.expr) return null;
  // Una expresión que arranca o termina en un operador quedó CORTADA: llega al
  // CAS como "= x^(1/2)" y lo que se muestre después no es lo que el chico
  // escribió. Mejor caer al chat que armar una ficha sobre un pedazo.
  if (/^[=+*/^]|[=+\-*/^]$/.test(e.expr.trim())) return null;
  const op = operacionPedida(texto, Boolean(e.ecuacion));
  if (!op) return null;
  // Que tenga forma de matemática y no solo un verbo suelto: "resolvelo" a secas
  // no es un ejercicio, es un pedido sobre algo que ya está en pantalla.
  //
  // Una FUNCIÓN CON NOMBRE cuenta por sí sola: "sqrt(x)" no trae ningún dígito
  // ni una letra pegada a un operador, así que "deriva f(x) = √x" se rechazaba
  // acá aunque la expresión estuviera perfecta.
  const pareceMate = /[0-9]/.test(e.expr)
    || /[a-z]\s*[\^*/+=-]/i.test(e.expr)
    || /\b(?:sqrt|sin|cos|tan|cot|log|ln|exp|abs)\s*\(/i.test(e.expr);
  if (!pareceMate) return null;
  return { op, expr: e.expr };
}
