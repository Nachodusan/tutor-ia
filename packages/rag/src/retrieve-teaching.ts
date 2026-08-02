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
import {
  retrieveRanked,
  rerank,
  rerankMinScoreFromEnv,
  RERANK_SNIPPET_CHARS,
  type RankedStats,
} from "./rerank";

/** Default de chunks de contenido citable. Configurable con RAG_CONTENT_K. */
export const DEFAULT_CONTENT_K = 6;

export function contentKFromEnv(): number {
  const n = Number(process.env.RAG_CONTENT_K ?? "");
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CONTENT_K;
}

/** Boost aditivo al orden de pedagogía cuando su OA coincide con el del contenido
 *  top. SOLO afecta el ORDEN (rankScore), nunca el gate (rerankScore crudo):
 *  antes se sumaba sobre la sigmoide sin clamp y un chunk con score real 0.03
 *  cruzaba el gate de 0.18 solo por el boost. Configurable con RAG_OA_BOOST. */
export const DEFAULT_OA_BOOST = 0.15;

export function oaBoostFromEnv(): number {
  const n = Number(process.env.RAG_OA_BOOST ?? "");
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_OA_BOOST;
}

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
  /** Sigmoide del cross-encoder, SIN boost — la escala del gate. */
  rerankScore: number;
  /** rerankScore + boost de OA (clampeado a 1) — SOLO para ordenar. */
  rankScore: number;
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
  /** El estudio dirigido sirvió material POR DEBAJO del umbral del gate: se
   *  entrega igual (es material real de la unidad pedida) pero queda contable
   *  en vez de camuflado como grounding normal. */
  gateBypassed?: boolean;
  /** Contadores del retrieval de contenido (brazos, pool, ranker) para el log. */
  stats?: RankedStats;
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
  const contentK = opts.contentK ?? contentKFromEnv();
  const perType = opts.perType ?? 2;
  const threshold = opts.minRerankScore ?? rerankMinScoreFromEnv();
  const oaBoost = oaBoostFromEnv();

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
        const scores = await rerank(query, lessonChunks.map((c) => c.content.slice(0, RERANK_SNIPPET_CHARS)), true);
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

  // El dirigido solo REEMPLAZA al gate cuando su material pasa el umbral. Si
  // quedó flojo (score < threshold), el retrieval semántico corre igual y el
  // dirigido pasa a ser último recurso — antes salteaba el gate por completo y
  // `grounded=true` con score 0.001 se camuflaba como grounding normal.
  const directedOk = directCitable.length > 0 && directCitable[0]!.score >= threshold;

  // 1) CONTENIDO por el gate del reranker (salvo estudio dirigido sólido).
  const content = directedOk
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
    // Sin esto, pedir 40 sobre brazos de 20 era un número que no se cumplía.
    poolPerSide: 40,
    corpusRole: "pedagogy",
  });

  const oaSrc = directedOk ? directCitable : (content?.chunks ?? directCitable);
  const oasContent = [...new Set(oaSrc.map((c) => c.oa).filter(Boolean))] as string[];
  const pedagogy = empty();
  let rankedPeda: PedagogyChunk[] = [];
  if (pedaCandidates.length > 0) {
    const scores = await rerank(query, pedaCandidates.map((c) => c.content.slice(0, RERANK_SNIPPET_CHARS)), true);
    rankedPeda = pedaCandidates
      // rerankScore queda CRUDO (gate); el boost de OA solo mueve rankScore (orden).
      .map((c, i) => {
        const rerankScore = scores[i] ?? 0;
        const boosted = c.oa && oasContent.includes(c.oa) ? rerankScore + oaBoost : rerankScore;
        return { ...c, rerankScore, rankScore: Math.min(1, boosted) };
      })
      .sort((a, b) => b.rankScore - a.rankScore);
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
  let gateBypassed = false;
  if (directedOk) {
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
    // El filtro del gate usa el rerankScore CRUDO: con el boost separado en
    // rankScore, un chunk de pedagogía con score real 0.03 ya no cruza 0.18.
    const fallback = rankedPeda
      .filter((c) => CITABLE_PEDAGOGY.includes(c.pedagogyType as TeachingType) && c.rerankScore >= threshold)
      .slice(0, contentK);
    if (fallback.length > 0) {
      citableSource = "pedagogy";
      topScore = fallback.reduce((m, c) => Math.max(m, c.rerankScore), 0);
      citable = fallback.map((c) => ({
        chunkId: c.chunkId, content: c.content, source: "pedagogy" as const,
        unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
        pageStart: c.pageStart, pageEnd: c.pageEnd, score: c.rerankScore,
      }));
    } else if (directCitable.length > 0) {
      // ÚLTIMO RECURSO del estudio dirigido: el alumno pidió estudiar ESTA
      // unidad del plan y el material existe, así que se entrega — pero flojo
      // según el reranker, y eso queda CONTABLE (gateBypassed) en vez de
      // camuflado como grounding normal. Decisión de producto, ahora visible.
      citableSource = "content";
      topScore = directCitable[0]!.score;
      citable = directCitable;
      gateBypassed = true;
    } else {
      citableSource = "none";
      topScore = Math.max(content?.topScore ?? 0, rankedPeda[0]?.rerankScore ?? 0);
      citable = [];
    }
  }

  const oas = [...new Set([...citable.map((c) => c.oa), ...oasContent].filter(Boolean))] as string[];
  return {
    citable,
    grounded: citable.length > 0,
    citableSource,
    pedagogy,
    oas,
    topScore,
    gateBypassed,
    stats: content?.stats,
  };
}
