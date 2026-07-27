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
import { getSql } from "@tutor-ia/db";
import { retrieveHybrid, type HybridChunk } from "./retrieve-hybrid";
import { retrieveRanked, rerank } from "./rerank";

/** Los tipos de pedagogía que alimentan el flujo de enseñanza, en orden de uso. */
export const TEACHING_TYPES = [
  "proposito",
  "ideas_previas",
  "ambiente_aprendizaje",
  "habilidad",
  "errores_frecuentes",
  "evaluacion",
  "solucionario",
] as const;
export type TeachingType = (typeof TEACHING_TYPES)[number];

export interface PedagogyChunk extends HybridChunk {
  rerankScore: number;
}

/** Un fragmento citable (el "qué"), venga del TE o de la GDD. */
export interface CitableChunk {
  chunkId: string;
  content: string;
  source: "content" | "pedagogy";
  unit: number | null;
  lesson: number | null;
  oa: string | null;
  headingPath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
}

export interface TeachingContext {
  /** El "qué": contenido citable. Contenido (TE) preferido; si el TE no alcanza
   *  (típico en grados bajos, muy visuales), cae a la GDD como material oficial. */
  citable: CitableChunk[];
  /** false → ni el TE ni la GDD tienen material del tema: abstenerse. */
  grounded: boolean;
  /** De dónde salió el material citable (para transparencia). */
  citableSource: "content" | "pedagogy" | "none";
  /** El "cómo": pedagogía por tipo (guía la estrategia de enseñanza). */
  pedagogy: Record<TeachingType, PedagogyChunk[]>;
  /** OA(s) del material top, para anclar el chequeo de comprensión. */
  oas: string[];
  /** Score del gate (mejor rerank del material citable). */
  topScore: number;
}

export interface TeachingOptions {
  userId: string;
  subjectId?: string | null;
  /** Cuántos chunks de contenido citable (default 6). */
  contentK?: number;
  /** Cuántos chunks de pedagogía por tipo (default 2). */
  perType?: number;
  minRerankScore?: number;
  /** ESTUDIO DIRIGIDO POR EL PLAN: si viene la unidad (y opcionalmente la
   *  lección), el contenido citable se toma DE ESA unidad/lección (rerankeado
   *  por la consulta) en vez del gate semántico. Garantiza material para un tema
   *  del plan aunque el título sea una paráfrasis floja. */
  unit?: number | null;
  lesson?: number | null;
}

interface LessonChunk {
  chunkId: string; content: string; unit: number | null; lesson: number | null;
  oa: string | null; headingPath: string | null; pageStart: number | null; pageEnd: number | null;
}

/** Trae los chunks de contenido de una unidad/lección concreta (orden de página). */
async function fetchLessonChunks(subjectId: string, unit: number, lesson: number | null): Promise<LessonChunk[]> {
  const sql = getSql();
  const rows = (lesson == null
    ? await sql`
        select ch.id as chunk_id, ch.content, ch.unit, ch.lesson, ch.oa, ch.heading_path,
               coalesce(ch.page_start, ch.page) as page_start, coalesce(ch.page_end, ch.page) as page_end
        from chunks ch join documents d on d.id = ch.document_id
        where d.subject_id = ${subjectId} and ch.corpus_role = 'content' and ch.unit = ${unit}
        order by ch.page nulls last, ch.chunk_index
        limit 28`
    : await sql`
        select ch.id as chunk_id, ch.content, ch.unit, ch.lesson, ch.oa, ch.heading_path,
               coalesce(ch.page_start, ch.page) as page_start, coalesce(ch.page_end, ch.page) as page_end
        from chunks ch join documents d on d.id = ch.document_id
        where d.subject_id = ${subjectId} and ch.corpus_role = 'content' and ch.unit = ${unit} and ch.lesson = ${lesson}
        order by ch.page nulls last, ch.chunk_index
        limit 28`) as unknown as {
    chunk_id: string; content: string; unit: number | null; lesson: number | null;
    oa: string | null; heading_path: string | null; page_start: number | null; page_end: number | null;
  }[];
  return rows.map((r) => ({
    chunkId: r.chunk_id, content: r.content, unit: r.unit, lesson: r.lesson,
    oa: r.oa, headingPath: r.heading_path, pageStart: r.page_start, pageEnd: r.page_end,
  }));
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
/** Tipos de pedagogía que contienen "qué" factual, usables como respaldo citable
 *  cuando el TE no alcanza (el solucionario trae respuestas; ambiente, contenido
 *  de actividad). Las ideas_previas/evaluación son preguntas, no material a citar. */
const CITABLE_PEDAGOGY: TeachingType[] = ["solucionario", "ambiente_aprendizaje", "habilidad"];

export async function retrieveForTeaching(
  query: string,
  opts: TeachingOptions,
): Promise<TeachingContext> {
  const contentK = opts.contentK ?? 6;
  const perType = opts.perType ?? 2;
  const threshold = opts.minRerankScore ?? Number(process.env.RERANK_MIN_SCORE ?? "0.3");

  // 0) ESTUDIO DIRIGIDO POR EL PLAN: unidad/lección conocida → material citable
  //    de esa unidad, rerankeado por la consulta. Grounding garantizado (el tema
  //    ES del material), sin depender del gate semántico sobre un título flojo.
  let directCitable: CitableChunk[] = [];
  if (opts.unit != null && opts.subjectId) {
    try {
      const lessonChunks = await fetchLessonChunks(opts.subjectId, opts.unit, opts.lesson ?? null);
      if (lessonChunks.length > 0) {
        // Rerank sobre texto TRUNCADO (los primeros ~600 chars alcanzan como
        // señal): mantiene la relevancia y evita el timeout del reranker con
        // unidades grandes (era la causa del 500 al estudiar un tema del plan).
        const scores = await rerank(query, lessonChunks.map((c) => c.content.slice(0, 600)), true);
        directCitable = lessonChunks
          .map((c, i) => ({ c, s: scores[i] ?? 0 }))
          .sort((a, b) => b.s - a.s)
          .slice(0, contentK)
          .map(({ c, s }) => ({
            chunkId: c.chunkId, content: c.content, source: "content" as const,
            unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
            pageStart: c.pageStart, pageEnd: c.pageEnd, score: s,
          }));
      }
    } catch {
      // Si el estudio dirigido falla (timeout del sidecar, etc.), NO reventamos:
      // caemos al retrieval normal con gate.
      directCitable = [];
    }
  }

  // 1) CONTENIDO por el gate del reranker (solo si no hay estudio dirigido).
  const content = directCitable.length > 0
    ? null
    : await retrieveRanked(query, {
        userId: opts.userId,
        subjectId: opts.subjectId,
        k: contentK,
        minRerankScore: threshold,
        corpusRole: "content",
      });

  // 2) PEDAGOGÍA por relevancia (corpus_role='pedagogy'), rerankeada.
  const pedaCandidates = await retrieveHybrid(query, {
    userId: opts.userId,
    subjectId: opts.subjectId,
    k: 40,
    corpusRole: "pedagogy",
  });

  const oaSrc = directCitable.length > 0 ? directCitable : (content?.chunks ?? []);
  const oasContent = [...new Set(oaSrc.map((c) => c.oa).filter(Boolean))] as string[];
  const pedagogy = empty();
  let rankedPeda: PedagogyChunk[] = [];
  if (pedaCandidates.length > 0) {
    const scores = await rerank(query, pedaCandidates.map((c) => c.content.slice(0, 600)), true);
    rankedPeda = pedaCandidates
      .map((c, i) => ({ ...c, rerankScore: scores[i] ?? 0 }))
      // Boost si el OA del bloque coincide con el del contenido top.
      .map((c) => ({ ...c, rerankScore: c.oa && oasContent.includes(c.oa) ? c.rerankScore + 0.15 : c.rerankScore }))
      .sort((a, b) => b.rerankScore - a.rerankScore);
    for (const c of rankedPeda) {
      const t = c.pedagogyType as TeachingType;
      if (TEACHING_TYPES.includes(t) && pedagogy[t].length < perType) pedagogy[t].push(c);
    }
  }

  // 3) GROUNDING sobre AMBOS corpus: contenido (TE) preferido; si no alcanza,
  //    la GDD (solucionario/ambiente/habilidad) como material oficial de respaldo.
  let citable: CitableChunk[];
  let citableSource: "content" | "pedagogy" | "none";
  let topScore: number;
  if (directCitable.length > 0) {
    citableSource = "content";
    topScore = directCitable[0]!.score;
    citable = directCitable;
  } else if (content && content.grounded && content.chunks.length > 0) {
    citableSource = "content";
    topScore = content.topScore;
    citable = content.chunks.map((c) => ({
      chunkId: c.chunkId, content: c.content, source: "content" as const,
      unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
      pageStart: c.pageStart, pageEnd: c.pageEnd, score: c.rerankScore,
    }));
  } else {
    const fallback = rankedPeda
      .filter((c) => CITABLE_PEDAGOGY.includes(c.pedagogyType as TeachingType) && c.rerankScore >= threshold)
      .slice(0, contentK);
    if (fallback.length > 0) {
      citableSource = "pedagogy";
      topScore = fallback[0]!.rerankScore;
      citable = fallback.map((c) => ({
        chunkId: c.chunkId, content: c.content, source: "pedagogy" as const,
        unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
        pageStart: c.pageStart, pageEnd: c.pageEnd, score: c.rerankScore,
      }));
    } else {
      citableSource = "none";
      topScore = Math.max(content?.topScore ?? 0, rankedPeda[0]?.rerankScore ?? 0);
      citable = [];
    }
  }

  const oas = [...new Set([...citable.map((c) => c.oa), ...oasContent].filter(Boolean))] as string[];
  return { citable, grounded: citable.length > 0, citableSource, pedagogy, oas, topScore };
}
