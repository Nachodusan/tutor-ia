/**
 * ANCLAS DEL GOLDEN POR TEXTO — para que el instrumento sobreviva a un re-chunk.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * `questions.jsonl` ancla cada pregunta a sus `expect_chunks`, que son **uuids**.
 * Un uuid es la identidad de una FILA, no la de un PASAJE DEL LIBRO: cualquier
 * cosa que reescriba los chunks —re-ingesta, re-chunk, cambio de extractor— los
 * cambia todos y el golden queda apuntando a filas que ya no existen.
 *
 * No es hipotético, ya pasó: `golden/a3-set.jsonl` tiene 60 claims etiquetados a
 * mano y **0 de sus chunk_id sobreviven** (verificado). `a3-validate` evalúa 0
 * triples desde entonces, y con eso se perdió la única forma barata de saber
 * cuánto de la tasa de alucinación es ruido del NLI. Ese set costó trabajo humano
 * y hoy no vale nada por un detalle de plomería.
 *
 * El pasaje del libro, en cambio, no cambia porque cambie el corte. Guardando el
 * TEXTO se puede volver a encontrar el chunk que lo contiene, sea cual sea el
 * chunking del momento.
 *
 * ── Cómo resuelve ───────────────────────────────────────────────────────────
 * Containment de 4-gramas, la misma técnica que `reanchor-golden.ts` usó para
 * migrar el golden del macrotipo al libro oficial (ahí acertó 60/61). Con una
 * diferencia importante: acá el ancla puede quedar repartida entre VARIOS chunks
 * nuevos (si el re-chunk parte más fino, que es justamente el objetivo de la
 * Fase 1), así que se devuelven todos los que cubren una porción sustantiva —
 * si no, recall@5 caería por un cambio de corte y se leería como que el
 * retrieval empeoró.
 */
import { ngrams, norm } from "@tutor-ia/rag";

/** Un pasaje del libro, identificado por su TEXTO y no por un uuid. */
export interface GoldAnchor {
  /** Pregunta del golden a la que pertenece. */
  questionId: string;
  /** El uuid que tenía cuando se creó el ancla. Solo trazabilidad: NO se usa
   *  para resolver, porque es exactamente lo que deja de existir. */
  chunkIdOriginal: string;
  /** Título del documento — acota la búsqueda y evita cruzar libros. */
  documentTitle: string;
  page: number | null;
  /** El pasaje. Es lo único que de verdad ancla. */
  texto: string;
}

export interface ChunkLite {
  id: string;
  content: string;
  documentTitle?: string | null;
}

/**
 * Los chunks actuales que contienen el pasaje del ancla, por COBERTURA ACUMULADA.
 *
 * ── Por qué acumulada y no un umbral fijo por chunk ─────────────────────────
 * Medido sobre el corpus actual (donde los chunks son todavía los que generaron
 * el ancla, o sea el caso fácil):
 *
 *   umbral 0,25 → resuelve 72/72 pero devuelve 2,24 ids por pregunta contra 1,69
 *                 del gold real: **32% de inflación**. Un gold inflado sube
 *                 recall@5 SOLO, que es la forma exacta de los bugs de
 *                 instrumento que este proyecto ya tuvo cuatro veces.
 *   umbral 0,60 → 2% de inflación hoy… pero mañana subestima: si el re-chunk
 *                 parte el pasaje en tres, cada pedazo cubre ~33%, ninguno llega
 *                 al piso, y el ancla devolvería uno solo de los tres chunks que
 *                 de verdad la contienen.
 *
 * Ningún umbral fijo sirve para los dos casos, porque la pregunta no es "¿este
 * chunk cubre bastante?" sino "¿ya tengo el pasaje entero?". Por eso se acumulan
 * chunks —en orden de cuántos 4-gramas NUEVOS aportan— hasta cubrir `objetivo`
 * del ancla, y ahí se corta. Si un chunk la cubre solo, devuelve uno; si el
 * pasaje quedó repartido en tres, devuelve tres. Se adapta al chunking sin que
 * haya que recalibrar nada.
 */
export function resolverAncla(
  ancla: GoldAnchor,
  chunks: ChunkLite[],
  objetivo = 0.9,
): { ids: string[]; cobertura: number } {
  const g = ngrams(norm(ancla.texto).split(" "));
  if (g.size === 0) return { ids: [], cobertura: 0 };
  const candidatos = (ancla.documentTitle
    ? chunks.filter((c) => !c.documentTitle || c.documentTitle === ancla.documentTitle)
    : chunks
  ).map((c) => ({ id: c.id, g: ngrams(norm(c.content).split(" ")) }));

  const faltan = new Set(g);
  const ids: string[] = [];
  // Greedy por APORTE NUEVO, no por cobertura absoluta: ordenar por cobertura
  // metería dos chunks que se solapan entre sí y traen lo mismo.
  while (faltan.size > 0 && ids.length < 8) {
    let mejor: { id: string; aporta: string[] } | null = null;
    for (const c of candidatos) {
      if (ids.includes(c.id)) continue;
      const aporta: string[] = [];
      for (const q of faltan) if (c.g.has(q)) aporta.push(q);
      if (!mejor || aporta.length > mejor.aporta.length) mejor = { id: c.id, aporta };
    }
    // Nadie aporta nada nuevo: lo que falta del pasaje no está en ningún chunk.
    if (!mejor || mejor.aporta.length === 0) break;
    ids.push(mejor.id);
    for (const q of mejor.aporta) faltan.delete(q);
    if (1 - faltan.size / g.size >= objetivo) break;
  }
  return { ids, cobertura: 1 - faltan.size / g.size };
}

/** Resuelve todas las anclas de una pregunta contra el corpus actual. */
export function resolverAnclas(
  anclas: GoldAnchor[],
  chunks: ChunkLite[],
  objetivo = 0.9,
): { ids: string[]; peorCobertura: number } {
  const ids = new Set<string>();
  let peor = 1;
  for (const a of anclas) {
    const r = resolverAncla(a, chunks, objetivo);
    for (const id of r.ids) ids.add(id);
    peor = Math.min(peor, r.cobertura);
  }
  return { ids: [...ids], peorCobertura: anclas.length ? peor : 1 };
}
