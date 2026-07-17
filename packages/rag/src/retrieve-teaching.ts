/**
 * Retrieval para ENSEÑAR (Plan v3 T4). Trae los dos corpus con roles distintos:
 *
 *   CONTENIDO (el "qué") — por relevancia a la pregunta, con el gate del reranker
 *     (corpus_role='content'). Es lo citable, la fuente de verdad.
 *   PEDAGOGÍA (el "cómo") — por relevancia al mismo tema (corpus_role='pedagogy'),
 *     rerankeada y ORGANIZADA por pedagogy_type (ideas_previas, ambiente, habilidad,
 *     evaluación, solucionario). Alimenta la estrategia de enseñanza.
 *
 * El link NO es el join rígido (unit,lesson) — el piloto mostró que TE y GDD
 * numeran distinto. Es RELEVANCIA + boost cuando el OA coincide con el del
 * contenido top. La metadata (unit/lesson/oa) queda como señal blanda.
 */
import { retrieveHybrid, type HybridChunk } from "./retrieve-hybrid";
import { retrieveRanked, rerank, type RankedResult } from "./rerank";

/** Los tipos de pedagogía que alimentan el flujo de enseñanza, en orden de uso. */
export const TEACHING_TYPES = [
  "ideas_previas",
  "ambiente_aprendizaje",
  "habilidad",
  "evaluacion",
  "solucionario",
] as const;
export type TeachingType = (typeof TEACHING_TYPES)[number];

export interface PedagogyChunk extends HybridChunk {
  rerankScore: number;
}

export interface TeachingContext {
  /** El "qué": contenido citable (con gate de abstención). */
  content: RankedResult;
  /** El "cómo": pedagogía por tipo (ya priorizada por relevancia + OA). */
  pedagogy: Record<TeachingType, PedagogyChunk[]>;
  /** OA(s) del contenido top, para anclar el chequeo de comprensión. */
  oas: string[];
}

export interface TeachingOptions {
  userId: string;
  subjectId?: string | null;
  /** Cuántos chunks de contenido citable (default 6). */
  contentK?: number;
  /** Cuántos chunks de pedagogía por tipo (default 2). */
  perType?: number;
  minRerankScore?: number;
}

const empty = (): Record<TeachingType, PedagogyChunk[]> => {
  const o = {} as Record<TeachingType, PedagogyChunk[]>;
  for (const t of TEACHING_TYPES) o[t] = [];
  return o;
};

/**
 * Recupera contenido (gated) + pedagogía tipada para enseñar un tema.
 * Devuelve content.grounded=false si no hay material de contenido: el tutor se
 * abstiene igual que en el chat (anti-alucinación intacto).
 */
export async function retrieveForTeaching(
  query: string,
  opts: TeachingOptions,
): Promise<TeachingContext> {
  const contentK = opts.contentK ?? 6;
  const perType = opts.perType ?? 2;

  // 1) CONTENIDO por el gate del reranker (solo corpus_role='content').
  const content = await retrieveRanked(query, {
    userId: opts.userId,
    subjectId: opts.subjectId,
    k: contentK,
    minRerankScore: opts.minRerankScore,
    corpusRole: "content",
  });

  // OA(s) del contenido top: ancla para priorizar la pedagogía y el chequeo.
  const oas = [...new Set(content.chunks.map((c) => c.oa).filter(Boolean))] as string[];

  // 2) PEDAGOGÍA por relevancia (corpus_role='pedagogy'), rerankeada.
  const pedaCandidates = await retrieveHybrid(query, {
    userId: opts.userId,
    subjectId: opts.subjectId,
    k: 40,
    corpusRole: "pedagogy",
  });

  const pedagogy = empty();
  if (pedaCandidates.length > 0) {
    const scores = await rerank(query, pedaCandidates.map((c) => c.content), true);
    const ranked: PedagogyChunk[] = pedaCandidates
      .map((c, i) => ({ ...c, rerankScore: scores[i] ?? 0 }))
      // Boost si el OA del bloque coincide con el del contenido top.
      .map((c) => ({ ...c, rerankScore: c.oa && oas.includes(c.oa) ? c.rerankScore + 0.15 : c.rerankScore }))
      .sort((a, b) => b.rerankScore - a.rerankScore);

    for (const c of ranked) {
      const t = c.pedagogyType as TeachingType;
      if (TEACHING_TYPES.includes(t) && pedagogy[t].length < perType) {
        pedagogy[t].push(c);
      }
    }
  }

  return { content, pedagogy, oas };
}
