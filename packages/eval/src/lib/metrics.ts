/**
 * Métricas del eval harness (Fase 1, §9.2). Funciones PURAS: sin I/O, sin red,
 * sin estado. Todo lo que entra son arrays/objetos planos y todo lo que sale son
 * números o structs. Esto las hace testeables a mano y determinísticas.
 *
 * Convención de "tasas": una tasa es un número en [0,1]. Cuando el denominador
 * es 0 (no hay casos de ese tipo) devolvemos 0 en vez de NaN, para que la tabla
 * final no muestre "NaN" y las comparaciones con los objetivos no exploten.
 */

/** Categorías del golden set (§9.1). Se deja abierto a string por robustez. */
export type QuestionCategory =
  | "answerable"
  | "must_abstain"
  | "adversarial"
  | "multi_hop"
  | "false_premise"
  | "computational";

/**
 * recall@k: de los chunks ESPERADOS (gold), qué fracción aparece entre los
 * primeros k recuperados. Denominador = |esperados|. Si no hay esperados,
 * devuelve 0 (el agregador ya excluye esas preguntas del promedio).
 */
export function recallAtK(
  retrievedChunkIds: string[],
  expectedChunkIds: string[],
  k: number,
): number {
  if (expectedChunkIds.length === 0) return 0;
  const topK = new Set(retrievedChunkIds.slice(0, Math.max(0, k)));
  let found = 0;
  for (const id of expectedChunkIds) {
    if (topK.has(id)) found++;
  }
  return found / expectedChunkIds.length;
}

/**
 * Precisión de citas: de los chunks CITADOS por el modelo, qué fracción está en
 * el conjunto fuente (los relevantes/esperados). |citados ∩ fuente| / |citados|.
 * Sin citas, devuelve 0 (no citó nada útil).
 */
export function citationPrecision(
  citedIds: string[],
  sourceIds: string[],
): number {
  if (citedIds.length === 0) return 0;
  const source = new Set(sourceIds);
  let hit = 0;
  for (const id of citedIds) {
    if (source.has(id)) hit++;
  }
  return hit / citedIds.length;
}

/** Tasa segura: denom 0 => 0 (evita NaN). Reutilizada para promedios y ratios. */
export function rate(numerator: number, denom: number): number {
  return denom === 0 ? 0 : numerator / denom;
}

/** Métricas agregadas del set completo (los objetivos del §9.2 se comparan contra esto). */
export interface EvalMetrics {
  /** recall@5 promediado sobre preguntas con chunks esperados. Objetivo ≥ 0.90. */
  recallAt5: number;
  /** precisión de citas promediada sobre preguntas con esperados. Objetivo ≥ 0.95. */
  citationPrecision: number;
  /** fracción de respuestas NO abstenidas que alucinaron. Objetivo ≤ 0.02. */
  hallucinationRate: number;
  /** fracción de preguntas respondibles que se abstuvieron de más. Objetivo ≤ 0.10. */
  falseAbstentionRate: number;
  /**
   * @deprecated El tutor YA NO SE ABSTIENE por falta de material: responde y
   * avisa. Esta métrica va a ~0 por diseño y dejó de significar algo. Se
   * conserva para poder releer las corridas anteriores al 2026-08-03.
   * La reemplaza `falseBookClaim`.
   */
  trueAbstentionRate: number;
  /**
   * LA MÉTRICA DE SEGURIDAD del cambio de motor. Fracción de las preguntas que
   * el libro NO cubre (`must_abstain`, ahora `expect_mode: "general"`) que el
   * tutor presentó como si vinieran del libro.
   *
   * DEBE SER ~0. Si sube, el producto está mintiendo: un chico recibe contenido
   * que el tutor sacó de su conocimiento general con el sello de "esto está en
   * tu libro", y no tiene forma de saberlo.
   */
  falseBookClaim: number;
  /** Fracción de preguntas con `expect_mode` donde el modo mostrado fue el
   *  esperado. Reemplaza a trueAbstentionRate como medida de "acertó el
   *  encuadre". Sobre las que no declaran expect_mode no se computa. */
  correctModeRate: number;
}

/**
 * Resultado por pregunta que alimenta a aggregate(). Es el mínimo necesario para
 * derivar todas las métricas: se computa en el runner (eval.ts) a partir del
 * pipeline real, y aquí solo se agrega.
 */
export interface PerQuestionResult {
  /** Categoría del golden set (answerable, must_abstain, ...). */
  type: QuestionCategory | string;
  /** Modo esperado, cuando el golden lo declara ("general" en las que el libro
   *  no cubre). Sin esto no se puede saber si el encuadre fue correcto. */
  expectMode?: string;
  /** Modo que el tutor efectivamente mostró: "libro" | "apoyado" | "general". */
  mode?: string;
  /** Hasta dónde fue a buscar: "curso" | "otro_curso" | "otra_materia". */
  scope?: string;
  /** chunkIds recuperados por el retrieval (en orden de relevancia). */
  retrievedIds: string[];
  /** chunkIds esperados (gold). Vacío si la pregunta no los define. */
  expectedIds: string[];
  /** true si el tutor se abstuvo (no había material suficiente / dijo la frase fija). */
  abstained: boolean;
  /** true si, habiendo respondido, alguna afirmación quedó "fuera del material". */
  hallucinated: boolean;
  /**
   * false => no se pudo determinar si alucinó (no se corrió el LLM, o falló/timeout).
   * Esas preguntas se excluyen del denominador de hallucinationRate. Default true.
   */
  hallucinationKnown?: boolean;
}

/**
 * Deriva las métricas del §9.2 a partir de los resultados por pregunta.
 *
 * Reglas (exactas al enunciado):
 *  - hallucinationRate  = alucinadas / respuestas NO abstenidas.
 *  - falseAbstentionRate = (type!=='must_abstain' que abstuvieron) / (type!=='must_abstain').
 *  - trueAbstentionRate  = (type==='must_abstain' que abstuvieron) / (type==='must_abstain').
 *  - recallAt5 / citationPrecision: promediados SOLO sobre las que tienen esperados.
 */
export function aggregate(results: PerQuestionResult[]): EvalMetrics {
  const answered = results.filter((r) => !r.abstained);
  // Solo las respondidas donde SÍ se pudo verificar cuentan para alucinación.
  const evaluable = answered.filter((r) => r.hallucinationKnown !== false);
  const hallucinated = evaluable.filter((r) => r.hallucinated);

  const answerable = results.filter((r) => r.type !== "must_abstain");
  const falseAbstentions = answerable.filter((r) => r.abstained);

  const mustAbstain = results.filter((r) => r.type === "must_abstain");
  const trueAbstentions = mustAbstain.filter((r) => r.abstained);

  // El encuadre: ¿el tutor mostró el modo que correspondía? Solo sobre las
  // preguntas que lo declaran — no se inventa un esperado para el resto.
  const conModo = results.filter((r) => r.expectMode);
  const modoOk = conModo.filter((r) => r.mode === r.expectMode);
  // Y la de seguridad: de las que el libro NO cubre, cuántas se presentaron
  // como si vinieran del libro.
  const deberianSerGeneral = results.filter((r) => r.expectMode === "general");
  // Cuenta lo que el alumno VE. Si el material salió de otra materia, la UI no
  // dice "de tu libro" sino "esto no está en el libro de esta materia, lo saqué
  // de Ciencias Naturales 6º" — eso no es una falsa atribución, es procedencia
  // correcta. Solo miente cuando presenta como propio del curso algo que no lo es.
  const mintieron = deberianSerGeneral.filter(
    (r) => r.mode === "libro" && (r.scope ?? "curso") === "curso",
  );

  const withExpected = results.filter((r) => r.expectedIds.length > 0);
  const recallSum = withExpected.reduce(
    (s, r) => s + recallAtK(r.retrievedIds, r.expectedIds, 5),
    0,
  );
  // precision@|gold|: sobre los top-|gold| recuperados, cuántos son gold. Con un
  // gold disperso (1-2 chunks clave), medir precisión sobre los 8 recuperados
  // daba ~1/8 (engañoso); esto mide si el reranker pone el/los gold ARRIBA.
  const precisionSum = withExpected.reduce(
    (s, r) =>
      s +
      citationPrecision(
        r.retrievedIds.slice(0, Math.max(1, r.expectedIds.length)),
        r.expectedIds,
      ),
    0,
  );

  return {
    recallAt5: rate(recallSum, withExpected.length),
    citationPrecision: rate(precisionSum, withExpected.length),
    hallucinationRate: rate(hallucinated.length, evaluable.length),
    falseAbstentionRate: rate(falseAbstentions.length, answerable.length),
    trueAbstentionRate: rate(trueAbstentions.length, mustAbstain.length),
    falseBookClaim: rate(mintieron.length, deberianSerGeneral.length),
    correctModeRate: rate(modoOk.length, conModo.length),
  };
}
