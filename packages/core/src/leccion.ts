/**
 * LA CLASE DE UNA PARADA DEL CAMINO — el tutor enseña antes de preguntar.
 *
 * Hasta acá, tocar una parada abría diez preguntas de opción múltiple sobre unas
 * páginas que nadie le había explicado al alumno. Esto es lo que va ANTES: una
 * clase corta de uno a cuatro "momentos", cada uno con un pasaje del libro, una
 * explicación en criollo, las palabras difíciles y un chequeo de una pregunta.
 *
 * ── LA REGLA QUE ORDENA TODO EL ARCHIVO ─────────────────────────────────────
 *
 * EL MODELO NO ESCRIBE NUNCA EL TEXTO DEL LIBRO. Le pasamos las oraciones
 * NUMERADAS y nos devuelve ÍNDICES; el pasaje lo armamos nosotros pegando esas
 * oraciones. La tasa de coincidencia con el corpus es del 100% por construcción,
 * no por verificación posterior.
 *
 * Está medido por qué: cuando se le pide al modelo que cite, parafrasea — la
 * auditoría A2 encontró que solo el 36% de las citas se verificaban contra el
 * fragmento. Con índices ese problema no existe, y de paso desaparecen los
 * reintentos por cita rota.
 *
 * ── POR QUÉ ELEGIR ORACIONES ES ADEMÁS EL FILTRO DE BASURA ──────────────────
 *
 * El corpus sale de PDF y NO viene en orden de lectura. Un chunk real de Física
 * 1º Medio (págs. 18-19) arranca con "Golpeen con fuerza la tapa de la olla",
 * que es la instrucción de una actividad, y más abajo mezcla "Para comenzar
 * Lección Unidad 1:", "½ ½" y "λ λ Compresión Rarefacción". El cuerpo bueno está
 * ahí, pero intercalado con muebles de página.
 *
 * Por eso el modelo ELIGE qué oraciones cita: esa elección es exactamente el
 * filtro. `limpiar()` saca antes lo que nunca puede ser un pasaje (fórmulas
 * sueltas, encabezados, fragmentos sin verbo), y lo que queda se numera.
 *
 * ── LAS TRES VOCES ──────────────────────────────────────────────────────────
 *
 * Lo que el alumno lee pertenece a una de tres voces, y la pantalla las
 * distingue a simple vista:
 *   pasaje  — literal, con su página. Garantía determinística.
 *   glosa   — prosa del tutor. Pasa el gate de NLI de `verificarClase`.
 *   ejemplo — la analogía que el libro no trae. NO se verifica porque no se
 *             puede, y por eso NO lleva número de página y se declara.
 *
 * Esa última línea es la parte importante: el sello de hoy (`derivarModo` en
 * verify.ts) certifica PROCEDENCIA —hubo material recuperado— y no contenido.
 * Acá el ejemplo va sin sello a propósito, en vez de heredar uno que no le
 * corresponde.
 */
import { chatJSON } from "./client";

// ── Formas ──────────────────────────────────────────────────────────────────

/** Una oración del libro, numerada y con la página de la que salió. */
export interface Oracion {
  i: number;
  texto: string;
  pagina: number | null;
}

/** Una afirmación de la glosa con las oraciones que la respaldan. */
export interface Afirmacion {
  texto: string;
  /** Índices de las oraciones fuente. El gate verifica contra ESAS, no contra todo. */
  fuentes: number[];
  /** Lo pone `verificarClase`. Sin gate corrido queda undefined. */
  veredicto?: "respaldada" | "neutral" | "contradicha";
}

export interface Momento {
  titulo: string;
  /** Índices de las oraciones del pasaje. El texto se arma acá, no lo escribe el modelo. */
  pasaje: number[];
  /** El pasaje ya ensamblado (lo pone `armarClase`). */
  texto: string;
  pagina: number | null;
  /** Enganche con lo que el alumno contestó en la apertura. Puede ir vacío. */
  entrada: string;
  glosa: string;
  afirmaciones: Afirmacion[];
  palabras: { palabra: string; enCriollo: string }[];
  /** SIN SELLO. No lleva página nunca. */
  ejemplo: string;
  chequeo: { pregunta: string; opciones: string[]; correcta: number };
}

export interface Clase {
  apertura: string;
  momentos: Momento[];
  cierre: string;
  /** Del libro del profesor, REESCRITO para el alumno. Se muestra con su procedencia. */
  errorFrecuente: string | null;
  /** El aviso original de la guía docente. Es la premisa del gate y no se muestra. */
  errorFuente?: string | null;
  gate?: GateReport;
}

export interface GateReport {
  corrido: boolean;
  afirmaciones: number;
  respaldadas: number;
  contradichas: number;
  /** El sidecar no estaba: la clase se guarda igual, marcada. */
  motivo?: string;
}

export class SinClase extends Error {
  constructor(public razon: "sin_material" | "generacion" | "vacio") {
    super(razon);
  }
}

// ── Partir el libro en oraciones ────────────────────────────────────────────

/**
 * ⚠️ EL TEXTO DEL CORPUS NO VIENE EN ORDEN DE LECTURA, y esto no es un detalle
 * del ingestor que se pueda arreglar después: es cómo sale un PDF de libro
 * escolar maquetado a dos columnas con recuadros. Un fragmento real de Física 1º
 * Medio (págs. 18-19) trae, en este orden:
 *
 *   "Golpeen con fuerza la tapa de la olla y observen."     ← consigna
 *   "El sonido se origina por la vibración de un objeto…"   ← el contenido bueno
 *   "Para comenzar Lección Unidad 1:"                       ← rótulo
 *   "Fuentes sonoras Todo objeto material que vibre…"       ← título PEGADO al cuerpo
 *   "…onda longitudinal. ½ ½ Al representar una onda…"      ← símbolo suelto adentro
 *   "…al revés. λ λ Compresión Rarefacción Física 1.º medio Unidad 1"  ← pie de página
 *
 * Los títulos van PEGADOS a la oración siguiente sin punto, así que un corte por
 * puntuación se los lleva puestos: elegir la oración buena arrastraba el rótulo
 * adentro del recuadro "En tu libro".
 *
 * ⚠️ Y ACÁ HUBO UNA LISTA BLANCA DE VERBOS QUE SE SACÓ, MEDIDA. Filtraba lo que
 * no tuviera uno de treinta verbos comunes, y descartó "Las moléculas de aire
 * cercanas a la fuente sonora vibran." —el corazón de la lección— porque "vibran"
 * no estaba en la lista. Una lista blanca de verbos no se puede completar; las
 * señales de abajo son generales y no dependen del tema.
 */

/** Palabras con las que empieza una oración de verdad, no un nombre propio. */
const ARRANQUE =
  "El|La|Los|Las|Un|Una|Unos|Unas|En|Al|Cuando|Si|Esta|Este|Estos|Estas|Esa|Ese|Esos|Esas|" +
  "Todo|Toda|Todos|Todas|Cada|Además|También|Es|Son|Se|No|Como|Durante|Luego|Después|Antes|" +
  "Ahora|Así|Pero|Mientras|Aunque|Desde|Hasta|Entre|Sobre|Para|Por|Con|Sin|Aquí|Otro|Otra|Su|Sus|" +
  "Hay|Existe|Existen|Muchos|Muchas|Algunos|Algunas|Dado|Sea|Puede|Pueden|Podemos|Debemos|Vamos|" +
  "Primero|Segundo|Finalmente|Entonces|Fíjate|Recordá|Recuerda|" +
  "Según|Sino|Cabe|Tal|Cierto|Otros|Otras|Ambos|Ambas|Ninguno|Nunca|Siempre|Solo|Sólo|Incluso|Igual|" +
  // Los libros escolares abren consignas con imperativos, y esas consignas van
  // PEGADAS al título de la actividad: "Descubriendo las ondas Consigan una
  // pelotita…". Sin los imperativos acá, el título y la consigna entran juntos
  // al recuadro "En tu libro" — que es el único lugar de la pantalla que no
  // puede tener basura.
  "Consigan|Observen|Realicen|Anoten|Respondan|Comenten|Analicen|Describan|Expliquen|Completen|" +
  "Lean|Escriban|Investiguen|Piensen|Imaginen|Midan|Armen|Repitan|Coloquen|Tomen|Hagan|" +
  "Observa|Realiza|Anota|Responde|Describe|Explica|Completa|Investiga|Piensa|Imagina|Mide|Toma|Haz";

/** Antes de un nombre propio suele haber preposición o artículo ("de Los Lagos"):
 *  ahí NO hay título pegado y cortar rompería la oración. */
const NEXO = /^(de|del|en|a|al|con|por|para|y|o|la|el|las|los|un|una|que|su|sus|como|entre|sobre|desde|hasta)$/i;

/**
 * Despega los títulos que el PDF dejó adentro de una oración.
 * "…de nuestro mundo En la voz humana se produce…" → dos piezas.
 * El corte solo ocurre si la palabra de antes NO es un nexo (así "de Los Lagos"
 * queda entero) y si lo que sigue tiene cuerpo de oración.
 */
function despegarTitulos(t: string): string[] {
  const re = new RegExp(`([a-záéíóúñü]{2,})\\s+((?:${ARRANQUE})\\s+(?:\\S+\\s+){3,})`, "g");
  const cortes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    if (NEXO.test(m[1]!)) continue;
    cortes.push(m.index + m[1]!.length);
  }
  if (cortes.length === 0) return [t];
  const piezas: string[] = [];
  let desde = 0;
  for (const c of cortes) { piezas.push(t.slice(desde, c)); desde = c; }
  piezas.push(t.slice(desde));
  return piezas.map((p) => p.trim()).filter(Boolean);
}

/** Símbolos sueltos del maquetado: "½ ½", "λ λ", viñetas, grados. */
const SIMBOLO_SUELTO = /(?:^|\s)[^\w\sáéíóúñüÁÉÍÓÚÑÜ¿¡]{1,2}(?=\s|$)/g;

/** Junta los guiones de corte de línea del PDF y saca los símbolos sueltos. */
function limpiar(texto: string): string {
  return texto
    .replace(/([a-záéíóúñü])-\s+([a-záéíóúñü])/g, "$1$2")
    .replace(SIMBOLO_SUELTO, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TERMINAL = /[.!?…]/;

/**
 * Corta el pie de página que quedó DESPUÉS del último punto.
 * "…podría considerarse al revés. Compresión Rarefacción Física 1.º medio Unidad 1"
 * se queda en "…podría considerarse al revés."
 */
function podarCola(t: string): string {
  const ult = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"), t.lastIndexOf("…"));
  if (ult < 0) return t;
  return t.slice(0, ult + 1).trim();
}

/**
 * Lo que NUNCA puede ser un pasaje citable. Señales generales, sin lista de verbos:
 *  · un título no termina en punto — es la señal más fuerte y más barata;
 *  · un título es corto y tiene pocas palabras;
 *  · una tabla tiene densidad de dígitos alta.
 */
/**
 * Rótulos de sección que el maquetado deja como oración entera y que igual
 * terminan en signo, así que la regla del punto no los agarra: "Unidad 1: ¿De
 * qué manera se relacionan las ondas con el sonido? Para comenzar Lección…".
 */
const MUEBLE = /(para comenzar|paso a paso|ciencia en acci[oó]n|antes de empezar|¿qu[eé] aprender|lecci[oó]n\s+unidad|taller de|me preparo para|lo que s[eé]|activaci[oó]n de)/i;

function esBasura(s: string): boolean {
  const t = s.trim();
  if (MUEBLE.test(t)) return true;
  if (t.length < 40) return true;
  if (!/[a-záéíóúñü]/.test(t)) return true;            // TODO MAYÚSCULAS
  if (!TERMINAL.test(t.slice(-1))) return true;        // no cierra: es rótulo
  if (t.split(/\s+/).length < 6) return true;
  const digitos = (t.match(/\d/g) ?? []).length;
  if (digitos / t.length > 0.18) return true;
  return false;
}

/**
 * Parte los fragmentos de la lección en oraciones numeradas y utilizables.
 *
 * El índice `i` es la LLAVE que el modelo devuelve para armar el pasaje, así que
 * se asigna DESPUÉS de filtrar: si se filtrara más tarde los números se correrían
 * y el recuadro "En tu libro" mostraría otra oración.
 */
export function partirEnOraciones(
  fragmentos: { content: string; page: number | null }[],
): Oracion[] {
  const out: Oracion[] = [];
  for (const f of fragmentos) {
    const limpio = limpiar(f.content);
    const porPunto = limpio.split(/(?<=[.!?…])\s+(?=[¿¡"“(]?[A-ZÁÉÍÓÚÑ0-9])/);
    for (const pieza of porPunto) {
      for (const sub of despegarTitulos(pieza)) {
        const t = podarCola(sub.trim());
        if (!t || esBasura(t)) continue;
        out.push({ i: out.length, texto: t, pagina: f.page });
      }
    }
  }
  return out;
}

// ── El prompt ───────────────────────────────────────────────────────────────

const SISTEMA =
  "Sos un profesor que le da una clase corta a un ADULTO que retomó la escuela en Chile " +
  "(modalidad EPJA). Dejó de estudiar hace años, estudia de noche, cansado, en el celular. " +
  "No es un chico: no lo trates con condescendencia, pero tampoco des por sabido nada.\n\n" +
  "Te doy las ORACIONES NUMERADAS de unas páginas de su libro. Armá la clase.\n\n" +
  "REGLA MÁS IMPORTANTE: para el pasaje del libro NO ESCRIBAS TEXTO. Devolvé los NÚMEROS " +
  "de las oraciones que hay que mostrar (`pasaje: [12, 13]`). El texto lo pega el sistema. " +
  "Elegí 1 a 3 oraciones seguidas o casi seguidas, que digan algo completo.\n\n" +
  "OJO: las oraciones vienen de un PDF y no están en orden de lectura. Hay instrucciones de " +
  "actividades ('Golpeen la tapa de la olla'), encabezados y restos sueltos mezclados con el " +
  "contenido. ELEGÍ SOLO ORACIONES QUE EXPLIQUEN ALGO. Nunca cites una instrucción, un " +
  "título ni una consigna.\n\n" +
  "Cada momento lleva:\n" +
  "- `titulo`: 2-5 palabras, lo que se aprende ahí.\n" +
  "- `entrada`: UNA línea tuya que enganche con lo que el alumno acaba de pensar en la apertura. " +
  "NUNCA copies una oración del libro acá, y menos una consigna de actividad: la entrada es tu voz, " +
  "no la del texto. Si no tenés nada que enganchar, dejala vacía.\n" +
  "- `pasaje`: los números de oración.\n" +
  "- `glosa`: qué dice ese pasaje EN CRIOLLO, 60 a 110 palabras. Es lo que hace que la clase " +
  "enseñe y no solo muestre: explicá el mecanismo con tus palabras, no repitas el pasaje con " +
  "sinónimos. Si el libro dice 'se propaga por un medio', explicá QUÉ pasa molécula por molécula.\n" +
  "- `afirmaciones`: partí tu glosa en 2 a 4 afirmaciones sueltas y verificables, y para cada " +
  "una decí de qué oraciones sale (`fuentes`). Una afirmación es una frase que puede ser " +
  "verdadera o falsa, no una pregunta ni una invitación.\n" +
  "- `palabras`: 2 a 4 palabras difíciles del pasaje, traducidas en 5-12 palabras cada una.\n" +
  "- `ejemplo`: UNA situación cotidiana chilena que el libro NO trae, 25-50 palabras. Micro, " +
  "feria, ollas, cordillera, el metro. Nunca inventes un dato técnico acá: es una analogía.\n" +
  "- `chequeo`: una pregunta de 3 opciones sobre ESE momento, con el índice de la correcta. " +
  "Que no se conteste reconociendo la frase del libro.\n\n" +
  "Además:\n" +
  "- `apertura`: una pregunta para ANTES de explicar nada, sobre algo que el alumno ya vivió. " +
  "NO SE CORRIGE, así que no puede tener respuesta correcta: es para que arranque pensando.\n" +
  "- `cierre`: una consigna de una línea que le pida explicar con sus palabras algo del tema " +
  "a alguien de su casa.\n" +
  "- `errorComun`: SOLO si te paso el aviso del libro del profesor. Ese aviso está escrito PARA EL " +
  "PROFESOR ('es importante que aclare…', 'señale que…') y así no se le puede mostrar al alumno. " +
  "Pasalo a segunda persona y a 25-45 palabras: qué error se comete y qué es lo correcto. Sin " +
  "inventar nada que el aviso no diga. Si no te paso aviso, devolvé null.\n\n" +
  "ESPAÑOL DE CHILE, tuteo. Prohibidos los mexicanismos: no 'jalar' (es tirar), no 'platicar', " +
  "no 'checar', no 'carro', no 'alberca', no 'chido'. Prohibido el 'vosotros'. Los ejemplos son " +
  "chilenos: la micro, la feria, el metro, la olla, el pan amasado, la cordillera.\n" +
  "TEXTO PLANO. Prohibido markdown (nada de **negrita**, ###, backticks) y " +
  "prohibido LaTeX: la pantalla muestra el texto TAL CUAL. Matemática como se escribe a mano: " +
  "x² - 5x + 6 = 0, √(16 · 4), 1/2.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["apertura", "cierre", "errorComun", "momentos"],
  properties: {
    apertura: { type: "string" },
    cierre: { type: "string" },
    errorComun: { type: ["string", "null"] },
    momentos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // En modo estricto no hay campos opcionales: `entrada` va en `required`
        // y se marca nullable. Sale vacía cuando el momento no engancha con la
        // apertura, que es lo normal a partir del segundo.
        required: ["titulo", "pasaje", "entrada", "glosa", "afirmaciones", "palabras", "ejemplo", "chequeo"],
        properties: {
          titulo: { type: "string" },
          pasaje: { type: "array", items: { type: "integer" } },
          entrada: { type: ["string", "null"] },
          glosa: { type: "string" },
          afirmaciones: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["texto", "fuentes"],
              properties: {
                texto: { type: "string" },
                fuentes: { type: "array", items: { type: "integer" } },
              },
            },
          },
          palabras: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["palabra", "enCriollo"],
              properties: { palabra: { type: "string" }, enCriollo: { type: "string" } },
            },
          },
          ejemplo: { type: "string" },
          chequeo: {
            type: "object",
            additionalProperties: false,
            required: ["pregunta", "opciones", "correcta"],
            properties: {
              pregunta: { type: "string" },
              opciones: { type: "array", items: { type: "string" } },
              correcta: { type: "integer" },
            },
          },
        },
      },
    },
  },
};

/**
 * CUÁNTOS MOMENTOS. Sale del material y no de un número fijo.
 *
 * Medido sobre las 1.846 paradas: 49 no tienen una sola línea, 378 tienen un
 * chunk, 694 tienen dos o tres y 725 tienen más; la mediana son 4.449 caracteres
 * y el percentil 90 son 17.633. Fijarlo en dos le sobra a las flojas y le queda
 * corto al 39% que tiene con qué.
 */
export function cuantosMomentos(oraciones: Oracion[]): number {
  const chars = oraciones.reduce((a, o) => a + o.texto.length, 0);
  if (chars < 1500) return 1;
  if (chars < 4000) return 2;
  if (chars < 9000) return 3;
  return 4;
}

// ── Generar ─────────────────────────────────────────────────────────────────

export async function armarClase(opts: {
  titulo: string;
  subjectName: string;
  oraciones: Oracion[];
  /** Del libro del profesor. Se muestra tal cual, con su procedencia. */
  errorFrecuente?: string | null;
  momentos?: number;
}): Promise<Clase> {
  const { oraciones } = opts;
  if (oraciones.length < 3) throw new SinClase("sin_material");
  const nMomentos = opts.momentos ?? cuantosMomentos(oraciones);

  // Techo de contexto: 240 oraciones alcanzan de sobra para la parada más gorda
  // y evitan mandar un libro entero cuando el rango de páginas viene mal.
  const usables = oraciones.slice(0, 240);
  const numeradas = usables.map((o) => `${o.i}. ${o.texto}`).join("\n");

  let out: {
    apertura: string; cierre: string; errorComun: string | null;
    momentos: {
      titulo: string; pasaje: number[]; entrada?: string; glosa: string;
      afirmaciones: { texto: string; fuentes: number[] }[];
      palabras: { palabra: string; enCriollo: string }[];
      ejemplo: string;
      chequeo: { pregunta: string; opciones: string[]; correcta: number };
    }[];
  };
  try {
    out = await chatJSON(
      [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content:
            `Materia: ${opts.subjectName}\nLección: ${opts.titulo}\n\n` +
            `ORACIONES DEL LIBRO:\n${numeradas}\n\n` +
            (opts.errorFrecuente
              ? `EL LIBRO DEL PROFESOR AVISA QUE ACÁ SE EQUIVOCAN (no lo copies, pero tenelo en cuenta al armar el chequeo y las opciones falsas):\n${opts.errorFrecuente}\n\n`
              : "") +
            `Devolvé JSON con ${nMomentos} momento(s) como máximo, en el orden en que conviene enseñarlos. ` +
            `Menos momentos bien explicados es mejor que más momentos flojos.`,
        },
      ],
      SCHEMA,
      // Presupuesto GENEROSO a propósito. Con 900 + 700·n el JSON se truncaba a
      // mitad de camino y la salida estructurada volvía inválida — y el modelo
      // devuelve de más aunque se le pida un número exacto, así que el techo
      // tiene que cubrir el exceso. Lo que sobre se recorta abajo, por código.
      { maxTokens: 1400 + nMomentos * 1100 },
    );
  } catch (e) {
    console.error(`[clase] generación falló: ${e instanceof Error ? e.message : e}`);
    throw new SinClase("generacion");
  }

  const porIndice = new Map(usables.map((o) => [o.i, o]));

  // FORMA: lo inválido se descarta, no se "arregla" en silencio. Un momento cuyo
  // pasaje apunta a oraciones que no existen no se puede mostrar: no hay texto
  // que poner en el recuadro del libro, y ese recuadro es la garantía entera.
  const momentos: Momento[] = [];
  for (const m of out.momentos ?? []) {
    const idx = (m.pasaje ?? []).filter((i) => porIndice.has(i));
    if (idx.length === 0) continue;
    if (!m.glosa?.trim()) continue;
    const ops = (m.chequeo?.opciones ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (ops.length < 2) continue;
    const correcta = Number.isInteger(m.chequeo?.correcta) ? m.chequeo.correcta : 0;
    if (correcta < 0 || correcta >= ops.length) continue;

    const ors = idx.map((i) => porIndice.get(i)!);
    momentos.push({
      titulo: m.titulo?.trim() || opts.titulo,
      pasaje: idx,
      // ACÁ SE ARMA EL PASAJE, y es el único lugar donde se arma. Es texto del
      // corpus, carácter por carácter.
      texto: ors.map((o) => o.texto).join(" "),
      pagina: ors.find((o) => o.pagina != null)?.pagina ?? null,
      entrada: m.entrada?.trim() ?? "",
      glosa: m.glosa.trim(),
      afirmaciones: (m.afirmaciones ?? [])
        .filter((a) => a.texto?.trim())
        .map((a) => ({
          texto: a.texto.trim(),
          fuentes: (a.fuentes ?? []).filter((i) => porIndice.has(i)),
        })),
      palabras: (m.palabras ?? []).filter((p) => p.palabra?.trim() && p.enCriollo?.trim()),
      ejemplo: m.ejemplo?.trim() ?? "",
      chequeo: { pregunta: m.chequeo.pregunta?.trim() ?? "", opciones: ops, correcta },
    });
  }

  if (momentos.length === 0) throw new SinClase("vacio");

  // EL TECHO LO PONE EL CÓDIGO. Pedir "N momentos" en el prompt no alcanza: el
  // modelo devuelve de más, y una parada de 1.500 caracteres estirada a cuatro
  // momentos repite el mismo pasaje con otras palabras.
  momentos.length = Math.min(momentos.length, nMomentos);

  return {
    apertura: out.apertura?.trim() ?? "",
    cierre: out.cierre?.trim() ?? "",
    momentos,
    // ⚠️ SE GUARDA LA REESCRITURA, NO EL AVISO CRUDO. El texto de la guía docente
    // está dirigido al profesor ("es importante que aclare…", "señale que…") y
    // encima llega con los guiones de corte del PDF ("se pro- pagan"). Mostrárselo
    // tal cual al alumno es darle una instrucción que no es para él.
    //
    // La reescritura es prosa del modelo, así que NO es literal — pero tampoco se
    // presenta como literal: el bloque dice "libro del profesor" (procedencia, que
    // es cierta) y no lleva número de página. Y pasa por el gate como cualquier
    // otra afirmación, contra el aviso original.
    errorFrecuente: out.errorComun?.trim() || null,
    errorFuente: opts.errorFrecuente?.trim() || null,
  };
}

// ── El gate ─────────────────────────────────────────────────────────────────

/**
 * VERIFICA LA GLOSA CONTRA SUS PROPIAS ORACIONES FUENTE.
 *
 * ⚠️ ESTE GATE ES UN VETO, NO UN SELLO, y la diferencia importa. Está medido que
 * la NLI reconoce contradicciones (0,90 en una falsedad de control) pero NO
 * reconoce una paráfrasis correcta como respaldada (0,33 en una paráfrasis real).
 * Si se usara como sello se caería casi toda la prosa buena.
 *
 * Entonces: solo la CONTRADICCIÓN descarta. Neutral no prueba que esté mal, así
 * que pasa marcada y queda visible en el reporte para auditarla a mano — que es
 * la ventaja entera de precomputar.
 *
 * Se le pasa `nliPairs` por parámetro para que `core` no dependa de `rag`.
 */
export async function verificarClase(
  clase: Clase,
  oraciones: Oracion[],
  nliPairs: (pairs: [string, string][]) => Promise<{ entailment: number; neutral: number; contradiction: number }[]>,
  minContra = 0.5,
): Promise<Clase> {
  const porIndice = new Map(oraciones.map((o) => [o.i, o]));
  const pares: [string, string][] = [];
  const ref: { m: number; a: number }[] = [];

  clase.momentos.forEach((m, mi) => {
    m.afirmaciones.forEach((a, ai) => {
      const premisa = (a.fuentes.length ? a.fuentes : m.pasaje)
        .map((i) => porIndice.get(i)?.texto)
        .filter(Boolean)
        .join(" ");
      if (!premisa) return;
      pares.push([premisa, a.texto]);
      ref.push({ m: mi, a: ai });
    });
  });

  // La reescritura del error frecuente se verifica contra el aviso original de la
  // guía. Es la única afirmación de la clase cuya premisa no sale del texto del
  // alumno, y por eso se arma aparte.
  const iError = clase.errorFrecuente && clase.errorFuente ? pares.length : -1;
  if (iError >= 0) pares.push([clase.errorFuente!, clase.errorFrecuente!]);

  if (pares.length === 0) {
    clase.gate = { corrido: false, afirmaciones: 0, respaldadas: 0, contradichas: 0, motivo: "sin afirmaciones" };
    return clase;
  }

  let probs;
  try {
    probs = await nliPairs(pares);
  } catch (e) {
    // El sidecar caído NO tira la clase: queda guardada y marcada sin verificar,
    // que es exactamente lo que el panel de auditoría tiene que poder filtrar.
    clase.gate = {
      corrido: false, afirmaciones: pares.length, respaldadas: 0, contradichas: 0,
      motivo: `sidecar: ${e instanceof Error ? e.message : e}`,
    };
    return clase;
  }

  let respaldadas = 0, contradichas = 0;

  // Si la reescritura CONTRADICE el aviso del profesor, el bloque no se muestra.
  // Que se caiga el bloque es mucho mejor que enseñarle al alumno el error como
  // si fuera lo correcto, que es exactamente lo que ese bloque viene a evitar.
  if (iError >= 0 && (probs[iError]?.contradiction ?? 0) >= minContra) {
    clase.errorFrecuente = null;
    contradichas++;
  }

  probs.slice(0, ref.length).forEach((p, k) => {
    const { m, a } = ref[k]!;
    const af = clase.momentos[m]!.afirmaciones[a]!;
    if (p.contradiction >= minContra) { af.veredicto = "contradicha"; contradichas++; }
    else if (p.entailment >= 0.5) { af.veredicto = "respaldada"; respaldadas++; }
    else af.veredicto = "neutral";
  });

  // Un momento con una afirmación CONTRADICHA por su propio pasaje no se muestra.
  // No se intenta arreglar la glosa: se cae el momento entero y se regenera.
  clase.momentos = clase.momentos.filter((m) => !m.afirmaciones.some((a) => a.veredicto === "contradicha"));
  clase.gate = { corrido: true, afirmaciones: pares.length, respaldadas, contradichas };

  // ⚠️ SI EL GATE SE COMIÓ TODOS LOS MOMENTOS, NO HAY CLASE. Guardar una fila con
  // `momentos: []` dejaba una parada que dice "acá hay clase" y no muestra nada.
  // Medido en Física 1º Medio p.14-16: dos momentos, dos afirmaciones
  // contradichas por su propio pasaje, cero momentos en pie. Eso es un fallo de
  // generación y tiene que volver a intentarse, no escribirse.
  if (clase.momentos.length === 0) throw new SinClase("vacio");
  return clase;
}
