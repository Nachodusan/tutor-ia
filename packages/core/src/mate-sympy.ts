/**
 * PUENTE A SymPy — el que dice la verdad sobre el resultado.
 *
 * La decisión de diseño del modo ejercicio: **SymPy manda sobre el RESULTADO, el
 * modelo escribe la EXPLICACIÓN**. El tutor resuelve bien la mayoría de los
 * ejercicios de escuela, pero nada lo comprobaba, y en una tarjeta que se parece
 * a Photomath un error se lee como verdad — el formato presta autoridad. Acá el
 * número lo pone un CAS y el modelo pone las palabras.
 *
 * FALLA HACIA ADELANTE, SIEMPRE. Si Python no está, si tarda, si la expresión no
 * parsea: se devuelve `null` y el chat contesta como contestaba antes. El modo
 * ejercicio es una mejora sobre el camino normal, nunca un requisito para que el
 * alumno reciba respuesta.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aSintaxisSympy, leerEjercicio, type Operacion } from "./mate-normalizar";

const execFileAsync = promisify(execFile);

// Mismo criterio que el sidecar de ingesta: relativo a este módulo, con override
// por env, para que funcione desde cualquier paquete que lo consuma.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const PY_BIN = process.env.MATE_PY_BIN ?? resolve(REPO, "packages/ingest-py/.venv/bin/python");
const PY_SCRIPT = process.env.MATE_PY_SCRIPT ?? resolve(REPO, "packages/ingest-py/sympy_check.py");
const TIMEOUT_MS = Number(process.env.MATE_SYMPY_TIMEOUT_MS ?? "8000");

async function llamar<T>(payload: unknown): Promise<T | null> {
  try {
    // El JSON va por ARGV, no por shell: no hay interpolación de comandos y la
    // expresión del alumno nunca toca un intérprete de shell.
    const { stdout } = await execFileAsync(PY_BIN, [PY_SCRIPT, JSON.stringify(payload)], {
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout) as T;
  } catch {
    return null;   // ver "falla hacia adelante" arriba
  }
}

export interface Resultado {
  /** Lo que hay que mostrar como respuesta final. */
  valor: string;
  /** Las raíces por separado, para marcarlas en el plano cartesiano. */
  soluciones?: string[];
  nums?: number[];
}

/** Arma la expresión SymPy para la operación pedida. */
export function comoLlamada(texto: string, op: Operacion): string | null {
  const e = leerEjercicio(texto);
  if (!e.expr) return null;
  const v = e.variable;
  switch (op) {
    case "solve":
      // Una DEFINICIÓN no se resuelve: `f(x) = 5x⁴ − 3x + 2` no es una ecuación.
      // Si alguien pide resolverla, se buscan sus ceros, que es lo que quiere
      // decir "resolver" sobre una función.
      if (e.ecuacion) return `solve(Eq(${e.ecuacion.izq}, ${e.ecuacion.der}), ${v})`;
      return `solve(Eq(${e.expr}, 0), ${v})`;
    case "diff":
      return `diff(${e.expr}, ${v})`;
    case "integrate":
      return `integrate(${e.expr}, ${v})`;
    case "factor":
      return `factor(${e.expr})`;
    case "expand":
      return `expand(${e.expr})`;
    case "simplify":
      return `simplify(${e.expr})`;
    default:
      return null;
  }
}

/** Resuelve el ejercicio con el CAS. `null` = no se pudo, seguí por el camino normal. */
export async function resolver(texto: string, op: Operacion): Promise<Resultado | null> {
  const expr = comoLlamada(texto, op);
  if (!expr) return null;
  const r = await llamar<{ ok: boolean; value?: string; soluciones?: string[]; nums?: number[] }>(
    { mode: "eval", expr },
  );
  if (!r?.ok || !r.value) return null;
  return { valor: r.value, soluciones: r.soluciones, nums: r.nums };
}

export type Veredicto = "ok" | "pierde" | "agrega" | "mal" | "indeciso";

export interface PasoVerificado {
  paso: number;
  de: string;
  a: string;
  veredicto: Veredicto;
  perdidas?: string[];
  extranas?: string[];
}

export interface Cadena {
  valida: boolean;
  /** Índice del PRIMER paso que falla; null si está toda bien. */
  primerError: number | null;
  pasos: PasoVerificado[];
}

/**
 * Verifica el procedimiento renglón por renglón.
 *
 * ⚠️ EL `tipo` NO ES COSMÉTICO. Las ecuaciones se validan por conservación del
 * conjunto solución y las expresiones por diferencia simbólica; usar el de
 * ecuaciones sobre expresiones deja pasar el error más clásico del colegio,
 * porque `(x+5)² = x²+25` tiene el mismo conjunto solución que `x = 0`. Se elige
 * por la operación: solve → ecuación; factor/expand/simplify → expresión.
 */
export async function verificarPasos(
  pasos: string[],
  op: Operacion,
): Promise<Cadena | null> {
  if (pasos.length < 2) return null;
  const tipo = op === "solve" ? "ecuacion" : "expresion";
  const limpios = pasos.map((p) => aSintaxisSympy(p));
  const r = await llamar<{ ok: boolean; valida: boolean; primerError: number | null; pasos: PasoVerificado[] }>(
    { mode: "cadena", tipo, pasos: limpios },
  );
  if (!r?.ok) return null;
  return { valida: r.valida, primerError: r.primerError, pasos: r.pasos };
}

/** ¿El puente está vivo? Corre la autoprueba del lado Python. */
export async function sympySano(): Promise<boolean> {
  const r = await llamar<{ ok: boolean }>({ mode: "autotest" });
  return r?.ok === true;
}
