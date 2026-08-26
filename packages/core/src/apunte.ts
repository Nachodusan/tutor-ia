/**
 * EL APUNTE DE UNA PARADA — para estudiar, no para leer una vez.
 *
 * ── POR QUÉ NO ES OTRO RESUMEN ──────────────────────────────────────────────
 *
 * El punto no es tener el contenido más corto: es que el alumno TENGA UN BUEN
 * APUNTE, que es algo que la escuela casi nunca enseña a hacer. El apunte malo
 * típico es una transcripción —copiar el pizarrón sin jerarquía, sin el porqué y
 * sin las palabras propias— y sirve para nada a la semana siguiente.
 *
 * Por eso este archivo genera una FORMA, no un texto: idea principal arriba,
 * puntos numerados con su página, palabras aparte, cómo acordarse, el error
 * típico, qué se evalúa, y un resumen de tres líneas. Esa forma es imitable: el
 * alumno que la ve diez veces puede copiarla en su cuaderno, que es la parte que
 * de verdad queremos dejarle.
 *
 * ── Y POR QUÉ ACÁ NO SE RECORTA EL LIBRO ────────────────────────────────────
 *
 * ⚠️ La clase de la parada (`leccion.ts`) muestra PASAJES LITERALES y el modelo
 * nunca escribe el texto del libro. Acá NO se puede hacer eso, y la razón es la
 * misma que motiva la función: un apunte hecho de citas textuales ES una
 * transcripción. Comprimir con palabras propias es lo que define a un apunte.
 *
 * El costo es que el apunte es prosa generada, y la red que lo sostiene es otra:
 *  · cada punto declara de QUÉ ORACIONES del libro sale (`fuentes`);
 *  · el gate de NLI veta lo que su propia fuente contradice;
 *  · cada punto lleva su PÁGINA, así que el alumno puede ir a verificarlo;
 *  · lo que no sale del libro —la analogía para acordarse— va marcado aparte.
 *
 * No es la garantía determinística del pasaje literal, y no se presenta como si
 * lo fuera. Es la que corresponde al género.
 */
import { chatJSON } from "./client";
import type { Oracion } from "./leccion";

export interface PuntoApunte {
  /** El título del punto: lo que el alumno subrayaría. */
  titulo: string;
  /** El desarrollo, en palabras propias. 30-60 palabras. */
  texto: string;
  /** Índices de las oraciones del libro que lo respaldan. */
  fuentes: number[];
  pagina: number | null;
  veredicto?: "respaldado" | "neutral" | "contradicho";
}

export interface Apunte {
  /** De qué se trata todo esto, en una línea. Un apunte arranca por el punto. */
  idea: string;
  puntos: PuntoApunte[];
  palabras: { palabra: string; definicion: string; pagina: number | null }[];
  /** La analogía del tutor. NO sale del libro y se dice. */
  comoAcordarse: string;
  /** Del libro del profesor, reescrito para el alumno. */
  ojo: string | null;
  /** Lo que la guía docente dice que se evalúa. */
  seEvalua: string[];
  /** El resumen de la noche anterior. */
  tresLineas: string[];
  gate?: { corrido: boolean; puntos: number; respaldados: number; contradichos: number; motivo?: string };
}

export class SinApunte extends Error {
  constructor(public razon: "sin_material" | "generacion" | "vacio") { super(razon); }
}

const SISTEMA =
  "Sos un profesor que le arma EL APUNTE a un adulto que retomó la escuela en Chile (EPJA). " +
  "No un resumen: un apunte de estudio, de los que sirven la noche antes de la prueba.\n\n" +
  "Te doy las ORACIONES NUMERADAS de unas páginas de su libro. Comprimilas con TUS PALABRAS.\n\n" +
  "REGLA MÁS IMPORTANTE: NO COPIES ORACIONES DEL LIBRO. Un apunte copiado es una " +
  "transcripción y no sirve para estudiar. Reformulá siempre, más corto y más claro.\n\n" +
  "PERO cada punto tiene que declarar de qué oraciones sale (`fuentes`, los números), porque " +
  "después se verifica contra ellas. Si algo no sale de ninguna oración, NO lo pongas.\n\n" +
  "El apunte lleva:\n" +
  "- `idea`: una sola oración con de qué se trata todo esto. Un apunte empieza por el punto, " +
  "no por el título.\n" +
  "- `puntos`: 3 a 5. Cada uno con `titulo` de 2-5 palabras (lo que el alumno subrayaría) y " +
  "`texto` de 30-60 palabras que lo desarrolle. Ordenados como conviene estudiarlos, no como " +
  "aparecen en la página. Que cada punto se entienda solo.\n" +
  "- `palabras`: 3 a 6 términos que hay que saber sí o sí, con su definición en 8-18 palabras.\n" +
  "- `comoAcordarse`: UNA analogía o truco chileno para no olvidarse de lo central, 25-45 " +
  "palabras. Esto NO sale del libro y se muestra aparte: no metas datos técnicos acá.\n" +
  "- `tresLineas`: exactamente 3 frases cortas. Es lo que se relee en dos minutos antes de " +
  "entrar a la prueba. Cada una tiene que poder leerse sola.\n" +
  "- `ojo`: si te paso el aviso del libro del profesor, pasalo a segunda persona DIRIGIDA AL " +
  "ALUMNO en 25-45 palabras. Ese aviso está escrito para el docente ('es importante que " +
  "aclare…'): así no se le puede mostrar. Sin aviso, devolvé null.\n" +
  "- `seEvalua`: si te paso la lista de lo que se evalúa, dejá los 4-8 conceptos que " +
  "correspondan a ESTAS páginas, limpios y en singular. Sin lista, array vacío.\n\n" +
  "ESPAÑOL DE CHILE, tuteo. Prohibidos los mexicanismos (jalar, platicar, checar, carro) y el " +
  "'vosotros'. TEXTO PLANO: prohibido markdown (nada de **negrita**, ###, backticks) y " +
  "prohibido LaTeX. Matemática como se escribe a mano: x² - 5x + 6 = 0, √(16 · 4), 1/2.";

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["idea", "puntos", "palabras", "comoAcordarse", "ojo", "seEvalua", "tresLineas"],
  properties: {
    idea: { type: "string" },
    puntos: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["titulo", "texto", "fuentes"],
        properties: {
          titulo: { type: "string" },
          texto: { type: "string" },
          fuentes: { type: "array", items: { type: "integer" } },
        },
      },
    },
    palabras: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["palabra", "definicion", "fuente"],
        properties: {
          palabra: { type: "string" },
          definicion: { type: "string" },
          fuente: { type: "integer" },
        },
      },
    },
    comoAcordarse: { type: "string" },
    ojo: { type: ["string", "null"] },
    seEvalua: { type: "array", items: { type: "string" } },
    tresLineas: { type: "array", items: { type: "string" } },
  },
};

/**
 * ⚠️ LOS NÚMEROS DE ORACIÓN SE FILTRAN AL TEXTO. Al pedirle al modelo que
 * declare de qué oraciones sale cada punto, los escribe TAMBIÉN adentro de la
 * prosa: "…que inicia el proceso auditivo (3, 4, 5, 6)". Para el alumno eso es
 * ruido sin significado —los índices son un detalle interno del generador— y
 * encima parece una cita bibliográfica que no existe.
 *
 * No se arregla pidiéndolo en el prompt: es un reflejo del formato de salida.
 * Se saca acá, que además cubre las corridas futuras sin depender del humor del
 * modelo. Solo al FINAL de una frase y solo si son puros números: "(3, 4, 5)"
 * se va, "(o rarefacciones)" y "(x - 3)" se quedan.
 */
const INDICES_SUELTOS = /\s*\(\s*\d+(\s*[,y]\s*\d+)*\s*\)(?=\s*[.,;:]|\s*$)/g;
const sinIndices = (t: string) => t.replace(INDICES_SUELTOS, "").replace(/\s+([.,;:])/g, "$1").trim();

/** El aviso del profesor no puede seguir hablándole al profesor. Ver leccion.ts. */
const HABLA_AL_DOCENTE =
  /\b(recu[eé]rd[ae]le|se[ñn][aá]lele|se[ñn]ale que|aclare que|expl[ií]quele|p[ií]dale|ind[ií]quele|mu[eé]strele|h[aá]gale|sus? (alumnos?|estudiantes?)|el (alumno|estudiante) debe|los (alumnos|estudiantes) (suelen|deben|tienden))\b/i;

export async function armarApunte(opts: {
  titulo: string;
  subjectName: string;
  oraciones: Oracion[];
  /** Aviso crudo de la guía docente. */
  errorFrecuente?: string | null;
  /** Lista cruda de lo que se evalúa, de la guía docente. */
  evaluacion?: string | null;
}): Promise<Apunte> {
  const { oraciones } = opts;
  if (oraciones.length < 4) throw new SinApunte("sin_material");
  const usables = oraciones.slice(0, 240);
  const numeradas = usables.map((o) => `${o.i}. ${o.texto}`).join("\n");

  let out: {
    idea: string;
    puntos: { titulo: string; texto: string; fuentes: number[] }[];
    palabras: { palabra: string; definicion: string; fuente: number }[];
    comoAcordarse: string; ojo: string | null;
    seEvalua: string[]; tresLineas: string[];
  };
  try {
    out = await chatJSON(
      [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content:
            `Materia: ${opts.subjectName}\nTema: ${opts.titulo}\n\n` +
            `ORACIONES DEL LIBRO:\n${numeradas}\n\n` +
            (opts.errorFrecuente ? `AVISO DEL LIBRO DEL PROFESOR:\n${opts.errorFrecuente}\n\n` : "") +
            (opts.evaluacion ? `LO QUE LA GUÍA DICE QUE SE EVALÚA:\n${opts.evaluacion}\n\n` : "") +
            `Devolvé el apunte en JSON.`,
        },
      ],
      SCHEMA,
      { maxTokens: 2600 },
    );
  } catch (e) {
    console.error(`[apunte] generación falló: ${e instanceof Error ? e.message : e}`);
    throw new SinApunte("generacion");
  }

  const porIndice = new Map(usables.map((o) => [o.i, o]));

  // Un punto sin fuentes no se puede verificar ni mandar a la página: se cae. Es
  // el mismo criterio que en la clase — lo que no se puede respaldar no se
  // muestra, sobre todo acá, que es de donde el alumno va a estudiar.
  const puntos: PuntoApunte[] = (out.puntos ?? [])
    .filter((p) => p.titulo?.trim() && p.texto?.trim())
    .map((p) => {
      const fuentes = (p.fuentes ?? []).filter((i) => porIndice.has(i));
      return {
        titulo: sinIndices(p.titulo),
        texto: sinIndices(p.texto),
        fuentes,
        pagina: fuentes.map((i) => porIndice.get(i)?.pagina).find((x) => x != null) ?? null,
      };
    })
    .filter((p) => p.fuentes.length > 0);

  if (puntos.length === 0) throw new SinApunte("vacio");

  const ojo = out.ojo ? sinIndices(out.ojo) || null : null;
  return {
    idea: sinIndices(out.idea ?? ""),
    puntos,
    palabras: (out.palabras ?? [])
      .filter((w) => w.palabra?.trim() && w.definicion?.trim())
      .map((w) => ({
        palabra: sinIndices(w.palabra),
        definicion: sinIndices(w.definicion),
        pagina: porIndice.get(w.fuente)?.pagina ?? null,
      })),
    comoAcordarse: sinIndices(out.comoAcordarse ?? ""),
    ojo: ojo && !HABLA_AL_DOCENTE.test(ojo) ? ojo : null,
    seEvalua: (out.seEvalua ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    tresLineas: (out.tresLineas ?? []).map(sinIndices).filter(Boolean).slice(0, 3),
  };
}

/**
 * EL GATE — veto, no sello. Igual que en la clase: está medido que la NLI
 * reconoce contradicciones pero da NEUTRAL en una paráfrasis correcta, y un
 * apunte es paráfrasis por definición. Usarla como sello tiraría el apunte
 * entero; usarla como veto saca lo que su propia fuente desmiente.
 */
export async function verificarApunte(
  apunte: Apunte,
  oraciones: Oracion[],
  nliPairs: (pairs: [string, string][]) => Promise<{ entailment: number; neutral: number; contradiction: number }[]>,
  minContra = 0.5,
): Promise<Apunte> {
  const porIndice = new Map(oraciones.map((o) => [o.i, o]));
  const pares: [string, string][] = apunte.puntos.map((p) => [
    p.fuentes.map((i) => porIndice.get(i)?.texto).filter(Boolean).join(" "),
    `${p.titulo}. ${p.texto}`,
  ]);
  if (pares.length === 0) {
    apunte.gate = { corrido: false, puntos: 0, respaldados: 0, contradichos: 0, motivo: "sin puntos" };
    return apunte;
  }
  let probs;
  try {
    probs = await nliPairs(pares);
  } catch (e) {
    apunte.gate = {
      corrido: false, puntos: pares.length, respaldados: 0, contradichos: 0,
      motivo: `sidecar: ${e instanceof Error ? e.message : e}`,
    };
    return apunte;
  }
  let respaldados = 0, contradichos = 0;
  probs.forEach((p, k) => {
    const pt = apunte.puntos[k]!;
    if (p.contradiction >= minContra) { pt.veredicto = "contradicho"; contradichos++; }
    else if (p.entailment >= 0.5) { pt.veredicto = "respaldado"; respaldados++; }
    else pt.veredicto = "neutral";
  });
  apunte.puntos = apunte.puntos.filter((p) => p.veredicto !== "contradicho");
  apunte.gate = { corrido: true, puntos: pares.length, respaldados, contradichos };
  if (apunte.puntos.length === 0) throw new SinApunte("vacio");
  return apunte;
}

/**
 * EL APUNTE COMO ARCHIVO — texto plano, para bajar, imprimir o pegar en el
 * cuaderno. Sin markdown: se lee igual en el bloc de notas del teléfono, que es
 * donde va a terminar.
 */
export function apunteATexto(a: Apunte, meta: { titulo: string; materia: string; p0?: number | null; p1?: number | null }): string {
  const L: string[] = [];
  const paginas = meta.p0 != null ? (meta.p1 && meta.p1 !== meta.p0 ? `págs. ${meta.p0}-${meta.p1}` : `pág. ${meta.p0}`) : "";
  L.push(meta.titulo.toUpperCase());
  L.push(`${meta.materia}${paginas ? ` · ${paginas}` : ""}`);
  L.push("=".repeat(Math.min(60, Math.max(meta.titulo.length, 30))), "");
  if (a.idea) L.push("LA IDEA PRINCIPAL", a.idea, "");
  if (a.puntos.length) {
    L.push("PARA ENTENDER");
    a.puntos.forEach((p, i) => {
      L.push(`${i + 1}. ${p.titulo}${p.pagina != null ? `  (pág. ${p.pagina})` : ""}`);
      L.push(`   ${p.texto}`, "");
    });
  }
  if (a.palabras.length) {
    L.push("PALABRAS QUE HAY QUE SABER");
    a.palabras.forEach((w) => L.push(`· ${w.palabra}: ${w.definicion}${w.pagina != null ? ` (pág. ${w.pagina})` : ""}`));
    L.push("");
  }
  if (a.comoAcordarse) L.push("CÓMO ACORDARSE  (no está en el libro)", a.comoAcordarse, "");
  if (a.ojo) L.push("OJO CON ESTO  (del libro del profesor)", a.ojo, "");
  if (a.seEvalua.length) {
    L.push("TE LO PUEDEN PREGUNTAR ASÍ");
    a.seEvalua.forEach((s) => L.push(`· ${s}`));
    L.push("");
  }
  if (a.tresLineas.length) {
    L.push("EN TRES LÍNEAS  (para la noche anterior)");
    a.tresLineas.forEach((s, i) => L.push(`${i + 1}. ${s}`));
    L.push("");
  }
  L.push("-".repeat(60));
  L.push("Este apunte tiene la forma de un buen apunte: la idea primero, los");
  L.push("puntos numerados con su página, las palabras aparte y el resumen al");
  L.push("final. Copiá esa forma en tu cuaderno y vas a estudiar mucho mejor.");
  return L.join("\n");
}
