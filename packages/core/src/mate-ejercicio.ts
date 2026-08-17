/**
 * MODO EJERCICIO — el desglose paso a paso, con el resultado garantizado.
 *
 * El orden importa y es al revés de lo intuitivo: **primero resuelve el CAS, y
 * recién después escribe el modelo**. Al modelo se le entrega el resultado ya
 * calculado y se le pide que explique CÓMO se llega ahí, no que lo averigüe. Así
 * la explicación puede ser floja pero el número nunca está mal — y en una tarjeta
 * que se parece a Photomath el formato presta autoridad: un error ahí se lee como
 * verdad.
 *
 * Después cada renglón que escribió el modelo se verifica contra el anterior. Un
 * paso que no valida no se muestra.
 */
import { chatJSON } from "./client";
import { leerEjercicio, esEjercicio, type Operacion } from "./mate-normalizar";
import { resolver, verificarPasos, equivalentes, type PasoVerificado } from "./mate-sympy";

/** ¿El último renglón dice lo mismo que el resultado del CAS? */
const mismoValor = (a: string, b: string) => equivalentes(a.includes("=") ? a.split("=").pop()!.trim() : a, b);

export interface PasoExplicado {
  /** La expresión de este renglón, en texto plano. */
  expr: string;
  /** Qué se hizo, en una frase corta y para un chico. */
  porque: string;
  /** Veredicto de SymPy sobre este renglón. */
  veredicto?: PasoVerificado["veredicto"];
}

export interface TarjetaEjercicio {
  enunciado: string;
  operacion: Operacion;
  /** El resultado del CAS. Esta es la verdad. */
  resultado: string;
  pasos: PasoExplicado[];
  /** Raíces reales, para marcarlas en el plano. */
  raices?: number[];
  /** La función a graficar, en sintaxis SymPy. Ausente = no hay nada que dibujar. */
  grafico?: { expr: string; variable: string };
  /** Un renglón no validó: se avisa en vez de mostrarlo como si estuviera bien. */
  aviso?: string;
  /** Título de la ficha. Lo decide el servidor porque depende de cómo se leyó el
   *  enunciado: "resolver" sobre una FUNCIÓN es buscar dónde corta el eje, y
   *  llamarlo "resolver la ecuación" es contarle otra cosa al alumno. */
  titulo?: string;
  /** No hay raíces reales. La ficha lo explica en vez de mostrar un renglón seco. */
  sinSolucionReal?: boolean;
}

// ⚠️ MODO ESTRICTO: `additionalProperties: false` en CADA objeto, todas las
// propiedades en `required`, y NADA de minItems/maxItems (ver
// llm/strict-schema.ts, que valida esto y explica por qué). El límite de pasos
// va en el prompt, que es donde el modelo lo puede leer.
const PASOS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pasos"],
  properties: {
    pasos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["expr", "porque"],
        properties: {
          expr: {
            type: "string",
            description: "SOLO la expresión matemática de este renglón, en texto plano (3*x = 15). Sin palabras.",
          },
          porque: {
            type: "string",
            description: "Qué se hizo para llegar acá, en UNA frase corta, para un chico de secundaria.",
          },
        },
      },
    },
  },
} as const;

const SISTEMA = `Sos un profesor de matemática de secundaria en Chile. Te dan un ejercicio Y SU RESULTADO YA CALCULADO, y escribís el procedimiento que lleva de uno al otro.

Reglas:
- El resultado que te doy es correcto y NO se discute: tu procedimiento tiene que terminar en él.
- Un renglón por paso. En "expr" va SOLO la expresión de ese renglón, sin palabras, en texto plano (3*x = 15, x = 5). En "porque" va qué hiciste, en una frase corta.
- Cada renglón tiene que seguirse del anterior por una operación válida. Nada de saltos.
- El primer renglón es el ejercicio como te lo dieron; el último es el resultado.
- Escribí la matemática como se teclea: * para multiplicar, / para dividir, ** o ^ para potencias, sqrt() para raíces. NADA de LaTeX ni de símbolos raros.
- Si hay VARIAS soluciones, el último renglón las trae a TODAS separadas por " o ": "x = 2 o x = 3". Un renglón con una sola rama deja afuera la otra respuesta.
- Como mucho 8 pasos.
- Nombrá el método como lo nombra un libro escolar chileno.`;

/**
 * Arma la tarjeta. `null` = no se pudo, y el chat contesta como siempre.
 * Nunca lanza: el modo ejercicio no puede dejar a un chico sin respuesta.
 */
export async function armarTarjeta(texto: string): Promise<TarjetaEjercicio | null> {
  const det = esEjercicio(texto);
  if (!det) return null;

  // 1) LA VERDAD PRIMERO. Sin resultado del CAS no hay tarjeta: mostrar pasos sin
  //    nada que los respalde es exactamente lo que este modo vino a evitar.
  const r = await resolver(texto, det.op);
  if (!r) return null;

  const e = leerEjercicio(texto);
  // Sin raíces reales no hay procedimiento que redactar, y pedirle pasos al
  // modelo produce un desarrollo que termina en la nada. La explicación la da la
  // ficha, con el gráfico al lado mostrando que la curva nunca cruza el eje.
  if (r.sinSolucionReal) {
    return {
      enunciado: det.expr, operacion: det.op, resultado: r.valor, pasos: [],
      titulo: e.esDefinicion ? "Dónde corta el eje x" : undefined,
      sinSolucionReal: true,
      grafico: graficable(e.expr, e.variable, det.op),
    };
  }
  // RESULTADO APROXIMADO = no hay procedimiento de colegio que mostrar.
  //
  // Una cúbica como x³ - 2x - 5 = 0 no se factoriza ni sale con fórmula: su raíz
  // es 2,0945… y SymPy la devuelve así. Cualquier cadena de pasos que el modelo
  // escriba va a fallar la verificación en el último renglón —porque un decimal
  // redondeado NO es exactamente la raíz— y la ficha quedaba con un paso suelto y
  // nada más. Es más honesto decir por qué.
  if (r.valor.startsWith("≈")) {
    return {
      enunciado: det.expr, operacion: det.op, resultado: r.valor, pasos: [],
      titulo: e.esDefinicion ? "Dónde corta el eje x" : undefined,
      raices: r.nums,
      grafico: graficable(e.expr, e.variable, det.op),
      aviso: "Esta no sale con los métodos que se ven en el colegio (factorizar o la fórmula general): su solución no es un número exacto. Te muestro el valor aproximado y dónde corta el eje.",
    };
  }

  let pasos: PasoExplicado[] = [];
  try {
    const out = await chatJSON<{ pasos: PasoExplicado[] }>(
      [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content: `Ejercicio: ${det.expr}\nOperación: ${det.op}\nResultado correcto: ${r.valor}`,
        },
      ],
      PASOS_SCHEMA,
      { temperature: 0.1, maxTokens: 700 },
    );
    pasos = (out.pasos ?? []).filter((p) => p?.expr?.trim()).slice(0, 8);
  } catch (err) {
    // Sin pasos igual se muestra el resultado: es mejor que nada. Pero el error
    // SE REGISTRA — este catch mudo ya escondió un schema inválido, y la tarjeta
    // salía sin pasos sin que nada dijera por qué. El validador de strict-schema
    // explica exactamente qué corregir; tragarse ese mensaje cuesta una tarde.
    console.error("[ejercicio] no se pudieron redactar los pasos:", err);
    pasos = [];
  }

  // 2) CADA RENGLÓN CONTRA EL ANTERIOR. Lo que el modelo escribió es una
  //    hipótesis hasta que SymPy la confirma.
  //
  // ⚠️ DERIVAR E INTEGRAR NO SON EQUIVALENCIAS, y por eso quedan afuera de la
  // verificación en cadena. f(x) y f'(x) NO son iguales, así que el verificador
  // de expresiones marcaba "mal" en el paso 1 —con razón— y el procedimiento se
  // cortaba entero SIEMPRE. En una transformación lo que se puede comprobar es
  // el destino: que el último renglón coincida con lo que dio el CAS.
  let aviso: string | undefined;
  const enCadena = det.op !== "diff" && det.op !== "integrate";
  if (!enCadena && pasos.length >= 1) {
    const ultimo = pasos[pasos.length - 1]!.expr;
    const igual = await mismoValor(ultimo, r.valor);
    if (igual === false) {
      pasos = [];
      aviso = "Preferí no mostrarte el procedimiento: no me terminó de cerrar con el resultado.";
    }
  }
  if (enCadena && pasos.length >= 2) {
    const c = await verificarPasos(pasos.map((p) => p.expr), det.op);
    if (c) {
      c.pasos.forEach((v) => {
        const destino = pasos[v.paso];
        if (destino) destino.veredicto = v.veredicto;
      });
      if (!c.valida && c.primerError != null) {
        // No se tira todo: se corta ANTES del renglón malo y se dice por qué. Un
        // procedimiento a medias y honesto sirve; uno completo y equivocado, no.
        pasos = pasos.slice(0, c.primerError);
        aviso = "Te muestro hasta acá: el resto del procedimiento no me cerró y prefiero no enseñarte algo mal.";
      }
    }
  }

  return {
    enunciado: det.expr,
    operacion: det.op,
    titulo: e.esDefinicion && det.op === "solve" ? "Dónde corta el eje x" : undefined,
    sinSolucionReal: r.sinSolucionReal,
    // La constante de integración la pone la tarjeta: SymPy nunca la devuelve, y
    // sin ella la respuesta está incompleta para cualquier profesor.
    resultado: det.op === "integrate" ? `${r.valor} + C` : r.valor,
    pasos,
    raices: r.nums,
    grafico: graficable(e.expr, e.variable, det.op),
    aviso,
  };
}

/**
 * ¿Hay algo que dibujar?
 *
 * Solo funciones de UNA variable. Una cuenta aritmética no se grafica, y una
 * ecuación se grafica como la función de su lado izquierdo menos el derecho: los
 * ceros de esa función son las soluciones, que es justo lo que hay que marcar.
 */
function graficable(expr: string, variable: string, op: Operacion): { expr: string; variable: string } | undefined {
  if (op === "integrate") return undefined;
  const cuerpo = expr.includes("=")
    ? `(${expr.split("=")[0]!.trim()}) - (${expr.split("=")[1]!.trim()})`
    : expr;
  // Sin la incógnita no hay curva: es un número.
  const re = new RegExp(`(?<![a-z])${variable}(?![a-z])`, "i");
  return re.test(cuerpo) ? { expr: cuerpo, variable } : undefined;
}
