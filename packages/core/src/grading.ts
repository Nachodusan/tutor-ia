/**
 * Grading DESCOMPUESTO (§4-C, Eje "correcto"). En vez de una corrección holística
 * (una sola llamada "¿está bien?"), que el exp2 mostró demasiado SEVERA (marca
 * respuestas correctas como incorrectas), descompone en dos pasos determinísticos:
 *
 *   1) extraer los PUNTOS CLAVE de la respuesta de referencia,
 *   2) chequear cada punto por separado contra la respuesta del estudiante,
 *      tolerando la paráfrasis.
 *
 * score = puntos cubiertos / total. La nota parcial cae natural del recuento, y
 * el veredicto "correcto" = todos los puntos cubiertos (no una decisión global
 * sesgada). Cada check es binario y local → menos falsos negativos.
 */
import { chatJSON } from "./client";
import { buildKeyPointsPrompt, buildPointChecksPrompt } from "./prompts";
import { KEYPOINTS_SCHEMA, POINTCHECKS_SCHEMA } from "./schemas";

export interface DecomposedGrade {
  /** Puntos clave de la referencia. */
  points: string[];
  /** Por punto: ¿lo cubre el estudiante? */
  covered: boolean[];
  /** Fracción cubierta (0..1). */
  score: number;
  /** true → cubrió TODOS los puntos clave. */
  correct: boolean;
}

/**
 * Corrige una respuesta abierta descomponiéndola en puntos clave (2 llamadas LLM,
 * temperatura 0). `reference` es la respuesta modelo; `rubric` es opcional y guía
 * qué cuenta como punto.
 */
export async function gradeDecomposed(params: {
  prompt: string;
  reference: string;
  rubric?: string;
  studentAnswer: string;
}): Promise<DecomposedGrade> {
  const { points } = await chatJSON<{ points: string[] }>(
    [
      {
        role: "user",
        content: buildKeyPointsPrompt({
          prompt: params.prompt,
          reference: params.reference,
          rubric: params.rubric,
        }),
      },
    ],
    KEYPOINTS_SCHEMA,
    { temperature: 0 },
  );

  const clean = (points ?? []).map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) {
    return { points: [], covered: [], score: 0, correct: false };
  }

  const { checks } = await chatJSON<{ checks: { point: string; covered: boolean }[] }>(
    [
      {
        role: "user",
        content: buildPointChecksPrompt({
          points: clean,
          studentAnswer: params.studentAnswer,
        }),
      },
    ],
    POINTCHECKS_SCHEMA,
    { temperature: 0 },
  );

  // Alinear por posición; si el modelo devolvió otra cantidad, faltantes = no cubierto.
  const covered = clean.map((_, i) => Boolean(checks?.[i]?.covered));
  const nCovered = covered.filter(Boolean).length;
  return {
    points: clean,
    covered,
    score: nCovered / clean.length,
    correct: nCovered === clean.length,
  };
}
