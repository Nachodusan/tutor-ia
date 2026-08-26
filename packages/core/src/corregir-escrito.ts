/**
 * CORREGIR LO QUE EL ALUMNO ESCRIBIÓ — la justificación de un verdadero/falso y
 * la respuesta de una pregunta abierta.
 *
 * ── POR QUÉ NO SE LE PREGUNTA AL MODELO "¿ESTÁ BIEN?" ───────────────────────
 *
 * Porque está MEDIDO que así corrige mal. El exp2 encontró que la corrección
 * holística —una sola llamada con la pregunta, la respuesta y "¿es correcta?"—
 * es demasiado SEVERA: marca como incorrectas respuestas que están bien.
 *
 * `gradeDecomposed` (grading.ts) lo resuelve en dos pasos: saca los PUNTOS CLAVE
 * de una respuesta modelo y después chequea cada punto por separado contra lo
 * que escribió el alumno, tolerando la paráfrasis. Cada chequeo es binario y
 * local, así que un error del modelo cuesta un punto y no la respuesta entera.
 *
 * ── Y DE AHÍ SALE EL "PODRÍAS COMPLETARLO CON ESTO" ─────────────────────────
 *
 * Los puntos clave que el alumno NO cubrió SON el comentario de mejora. No hace
 * falta una llamada más para redactarlo, y eso importa: un comentario generado
 * aparte podría inventar algo que el libro no dice, mientras que estos salen
 * todos de la respuesta modelo, que a su vez salió del material.
 *
 * ── EL VEREDICTO ES BINARIO, PERO NO ES "TODO O NADA" ───────────────────────
 *
 * El alumno ve correcto o incorrecto, sin porcentajes. Los umbrales de abajo son
 * decisiones de producto y están acá para que se puedan discutir en un solo
 * lugar, no repartidos por la ruta.
 */
import { gradeDecomposed } from "./grading";

export interface CorreccionEscrita {
  /** El veredicto que ve el alumno. */
  ok: boolean;
  /** Puntos de la respuesta modelo que SÍ cubrió. */
  cubiertos: string[];
  /** Los que le faltaron: esto es el "podrías completarlo con esto". */
  faltantes: string[];
  /** Fracción cubierta. No se muestra; sirve para medir cómo corrige el sistema. */
  score: number;
  /** El alumno no escribió nada. Se distingue de "escribió algo flojo". */
  vacia: boolean;
}

/** Mínimo de caracteres para tomar en serio lo escrito. Menos que esto es "vacía". */
const MINIMO = 8;

/**
 * EL VEREDICTO NO ES UN PUNTO CLAVE.
 *
 * La respuesta modelo de un verdadero/falso suele cerrar con "…por lo que la
 * afirmación es falsa", y el extractor la saca como punto clave igual que a los
 * demás. Resultado medido en pantalla: el alumno leía
 *
 *   Podrías completarlo con esto:
 *     · La afirmación es falsa.
 *
 * después de haber marcado Falso. Eso no le dice nada — ya lo contestó con el
 * botón, y verlo listado como algo que le faltó lo confunde sobre qué estuvo
 * mal. La mitad V/F se corrige aparte; acá solo interesa el POR QUÉ.
 */
const ES_VEREDICTO = /^(la\s+)?(afirmaci[oó]n|frase|oraci[oó]n|enunciado)\s+(es|resulta|ser[ií]a)\s+(falsa?|verdadera?|correcta?|incorrecta?)\b|^(es\s+)?(falso|verdadero)\b/i;

/**
 * Justificación de un VERDADERO/FALSO.
 *
 * ⚠️ EL UMBRAL ES DELIBERADAMENTE FLOJO: alcanza con UN punto clave. En una
 * justificación de dos renglones no se le puede exigir la respuesta modelo
 * entera, y el costo de equivocarse hacia el lado severo es alto — decirle a un
 * adulto que volvió a estudiar que se equivocó cuando no se equivocó es la forma
 * más rápida de que no vuelva. El comentario le muestra igual lo que le faltó.
 */
export async function corregirJustificacion(params: {
  afirmacion: string;
  referencia: string;
  escrito: string;
}): Promise<CorreccionEscrita> {
  const escrito = params.escrito?.trim() ?? "";
  if (escrito.length < MINIMO) {
    return { ok: false, cubiertos: [], faltantes: [], score: 0, vacia: true };
  }
  const g = await gradeDecomposed({
    prompt: `Justificá si esta afirmación es verdadera o falsa: ${params.afirmacion}`,
    reference: params.referencia,
    studentAnswer: escrito,
  });
  const utiles = g.points
    .map((p, i) => ({ p, cubierto: g.covered[i] ?? false }))
    .filter(({ p }) => !ES_VEREDICTO.test(p.trim()));
  const cubiertos = utiles.filter((x) => x.cubierto).map((x) => x.p);
  const faltantes = utiles.filter((x) => !x.cubierto).map((x) => x.p);
  return {
    // Si TODOS los puntos eran el veredicto, no quedó nada que juzgar de la
    // justificación: se acepta lo escrito en vez de reprobarlo por un artefacto
    // del extractor.
    ok: utiles.length === 0 ? true : cubiertos.length >= 1,
    cubiertos,
    faltantes,
    score: utiles.length === 0 ? 1 : cubiertos.length / utiles.length,
    vacia: false,
  };
}

/**
 * Respuesta ABIERTA.
 *
 * Acá el umbral es la MITAD de los puntos clave y no todos. `gradeDecomposed`
 * llama `correct` a cubrirlos todos, que para una respuesta de dos a cuatro
 * renglones es la vara de un ensayo: una respuesta que toca la mitad de lo
 * esencial es una respuesta de prueba aprobada, y la otra mitad es exactamente
 * lo que el comentario le nombra.
 */
export async function corregirAbierta(params: {
  pregunta: string;
  referencia: string;
  escrito: string;
}): Promise<CorreccionEscrita> {
  const escrito = params.escrito?.trim() ?? "";
  if (escrito.length < MINIMO) {
    return { ok: false, cubiertos: [], faltantes: [], score: 0, vacia: true };
  }
  const g = await gradeDecomposed({
    prompt: params.pregunta,
    reference: params.referencia,
    studentAnswer: escrito,
  });
  const cubiertos = g.points.filter((_, i) => g.covered[i]);
  return {
    ok: g.score >= 0.5,
    cubiertos,
    faltantes: g.points.filter((_, i) => !g.covered[i]),
    score: g.score,
    vacia: false,
  };
}
