/**
 * DISCRIMINADOR DE ANSWERABILITY — ¿el material CONTESTA la pregunta, o solo
 * habla del tema?
 *
 * El cross-encoder del gate mide RELEVANCIA, y eso no es lo mismo. Una ficha
 * catalográfica que nombra "Cien años de soledad" es máximamente relevante a una
 * pregunta sobre esa novela y no responde nada. Medido sobre las 13 preguntas que
 * la cascada respondió con material de fuera del libro del curso, con veredicto
 * humano de si el material GENUINAMENTE contesta:
 *
 *   cubiertas de verdad: 0.99  0.99  0.81  0.80  0.69  0.63
 *   ruido on-topic:      0.89  0.85  0.83  0.75  0.57  0.51
 *
 * Se solapan por completo: NINGÚN umbral de rerankScore las separa. Por eso
 * mover el umbral nunca pudo arreglar `correct_mode` (62,5%).
 *
 * ── Qué usa esto y por qué ──────────────────────────────────────────────────
 * El ganador medido por `answerability-sweep` sobre 91 preguntas: el NLI con la
 * PREGUNTA CONVERTIDA EN AFIRMACIÓN, umbral 0,91 — frena 7 de 8 ruidos y pierde
 * 0 de 6 materiales buenos, contra un juez LLM que frena 7/8 pero pierde 1/6 y
 * cuesta una llamada al modelo. Determinista y de decenas de ms en el sidecar.
 *
 * ⚠️ DÓNDE APLICA, que es la mitad del hallazgo: SOLO en las etapas cross-scope
 * de la cascada (`otro_curso` / `otra_materia`). Medirlo sobre las 91 daba "el
 * NLI destroza el 52% del material bueno" — cierto e IRRELEVANTE: 77 de esas 91
 * son del libro del propio curso y nunca pasarían por este filtro. Aplicarlo al
 * libro del alumno sería romper la promesa del producto para arreglar el
 * problema de al lado.
 *
 * ⚠️ Y el umbral 0,91 se eligió sobre 13 puntos y después se derrumbó al ampliar
 * (sobreajuste: se eligió el corte con los mismos datos con que se medía). Por
 * eso esto va detrás de `RAG_ANSWERABILITY` y lo juzga la corrida de 101, no la
 * intuición. Con el flag apagado el comportamiento es EXACTAMENTE el de antes.
 */
import { nliVerify } from "./nli";

/**
 * Default del umbral de entailment: **0.85, no el 0.91 que ganó el sweep.**
 *
 * El 0.91 del sweep es IN-SAMPLE en el sentido fuerte: se barrió de a 0,01 sobre
 * las mismas 14 preguntas cross-scope del golden que después se usan para
 * puntuarlo (`answerability-sweep.ts` lee el volcado de esa misma corrida). El
 * test set ES el training set.
 *
 * Curva medida de `correct_mode` sobre las 24 con `expect_mode`, con los
 * entailments de RUNTIME:
 *
 *   0,50 → 83,3% · 0,70-0,80 → 87,5% · 0,85-0,90 → 91,7%
 *   0,902-0,9314 → 95,8%  ← el pico
 *   0,932 → 91,7% · 0,95 → 83,3%
 *
 * El pico del 95,8% vive en una rendija de **0,030** entre q120 = 0,9017 (ruido
 * que hay que frenar) y q126 = 0,9314 (material bueno que hay que dejar pasar).
 * Compra UNA pregunta y la paga enhebrando una ventana ajustada a los mismos
 * puntos con los que se mide: es la forma exacta de los tres bugs de instrumento
 * del HANDOFF §7.
 *
 * 0,85 da 91,7% —sigue arriba del objetivo del 90%— con **0,081 de aire** hasta
 * el positivo más bajo en vez de 0,021. Y eso importa porque toda la deriva del
 * uso real empuja el entailment PARA ABAJO (registro coloquial, hipótesis
 * compuesta en multiturno), o sea contra el material bueno: a 0,91 el primer
 * falso bloqueo aparece con 0,022 de deriva; a 0,85, con 0,081.
 *
 * Subir a 0,91 es defendible SOLO cuando exista un set held-out que no haya
 * participado de la calibración. Se hace con `RAG_ANSWERABILITY_MIN`.
 */
export const DEFAULT_ANSWERABILITY_MIN = 0.85;

export function answerabilityEnabled(): boolean {
  const v = process.env.RAG_ANSWERABILITY;
  return v === "1" || v === "true";
}

export function answerabilityMinFromEnv(): number {
  const n = Number(process.env.RAG_ANSWERABILITY_MIN ?? "");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_ANSWERABILITY_MIN;
}

/**
 * La pregunta como HIPÓTESIS declarativa. El NLI espera una afirmación: pasarle
 * "¿qué es la fotosíntesis?" es preguntarle si el fragmento implica una
 * pregunta, que no significa nada. Convertida en "el texto explica qué es la
 * fotosíntesis" sí es evaluable.
 *
 * Idéntica a la de `answerability-sweep.ts` a propósito: si divergen, lo que se
 * midió deja de ser lo que corre.
 */
export function comoAfirmacion(pregunta: string): string {
  const limpia = pregunta
    .replace(/^[¿¡\s]+/, "")
    .replace(/[?¿!¡\s]+$/, "")
    .trim();
  return `El texto explica ${limpia.charAt(0).toLowerCase()}${limpia.slice(1)}.`;
}

/**
 * ¿Este material CONTESTA la pregunta? `null` = no se pudo decidir (sidecar
 * caído): el llamador debe seguir como si el filtro no existiera — un
 * discriminador que no puede opinar no debe negarle material a un alumno.
 */
export async function contesta(
  pregunta: string,
  chunkTexts: string[],
  min = answerabilityMinFromEnv(),
): Promise<{ ok: boolean; entailment: number } | null> {
  if (chunkTexts.length === 0 || pregunta.trim() === "") return null;
  try {
    const v = await nliVerify(comoAfirmacion(pregunta), chunkTexts);
    return { ok: v.entailment >= min, entailment: v.entailment };
  } catch {
    return null;
  }
}

/**
 * MATERIAL PARCIAL — el casillero que le faltaba al sistema.
 *
 * El encuadre era binario (hay material citable / no hay) y eso obliga a elegir
 * entre dos respuestas malas cuando el material es DEL TEMA pero no contesta la
 * pregunta. Medido, q035 ("¿resultado de las últimas elecciones presidenciales
 * en Chile?"): el material de Educación Ciudadana habla de PARTICIPACIÓN
 * electoral. Servirlo como `libro` le dice al chico "esto está en tu material"
 * sobre algo que no responde; descartarlo lo manda a `general`, donde el modelo
 * contesta de memoria y desactualizado. Las dos son peores que la tercera:
 * servirlo DICIENDO que cubre una parte.
 *
 * Se decide con las dos señales que ya se calculan, que solas no alcanzan y
 * juntas sí: `rerankScore` dice si el material es DEL TEMA, el entailment dice si
 * CONTESTA.
 *
 *   contesta                          → libro
 *   no contesta pero es del tema      → apoyado   (se sirve, con el límite a la vista)
 *   no contesta y tampoco es del tema → general   (se descarta: es ruido)
 *
 * El corte de relevancia sale de `pnpm --filter @tutor-ia/eval apoyado-sweep`,
 * que vuelca el par de cada etapa cross-scope con el veredicto del golden al
 * lado. NO se elige a ojo: es exactamente así como se llegó al 0,91 in-sample
 * que hubo que bajar después.
 */
export const DEFAULT_APOYADO_MIN_RELEVANCIA = 0.8;

export function apoyadoMinRelevanciaFromEnv(): number {
  const n = Number(process.env.RAG_APOYADO_MIN_RELEVANCIA ?? "");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_APOYADO_MIN_RELEVANCIA;
}

/** ¿El modo `apoyado` por material parcial está activo? Va con el discriminador:
 *  sin él no hay entailment con que decidir. `RAG_APOYADO=0` lo apaga aparte. */
export function apoyadoEnabled(): boolean {
  return answerabilityEnabled() && process.env.RAG_APOYADO !== "0";
}
