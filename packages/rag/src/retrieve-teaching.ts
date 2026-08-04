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

/** Forma citable de un chunk de CONTENIDO ya rerankeado. Estaba repetida en dos
 *  ramas de la cascada y ahora hace falta en una tercera (`retrieved`). */
const aCitable = (c: {
  chunkId: string; content: string; unit: number | null; lesson: number | null;
  oa: string | null; headingPath: string | null;
  pageStart: number | null; pageEnd: number | null; rerankScore: number;
  documentTitle?: string | null; grade?: string | null;
}): CitableChunk => ({
  chunkId: c.chunkId, content: c.content, source: "content",
  unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
  pageStart: c.pageStart, pageEnd: c.pageEnd, score: c.rerankScore,
  documentTitle: c.documentTitle ?? null, grade: c.grade ?? null,
});

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
  /** De qué libro y de qué curso salió. Ver citationLabel(). */
  documentTitle: string | null;
  grade: string | null;
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
  /**
   * Lo que el retrieval ENCONTRÓ, antes de que el gate decidiera si alcanza.
   *
   * `citable` responde "¿qué material se le puede mostrar al alumno?" y queda
   * VACÍO cuando el gate corta. `retrieved` responde otra pregunta —"¿el
   * ranking trajo lo correcto?"— y se llena siempre. Son cosas distintas y
   * confundirlas arruina la medición: `recall@5` calculado sobre `citable`
   * cuenta 0 cada vez que el gate corta, así que AFLOJAR EL GATE SUBE EL RECALL
   * SOLO, sin que el ranking haya mejorado en nada. Con este campo, recall mide
   * el ranking y el gate se mide aparte, que es la única forma de saber cuál de
   * los dos se movió.
   */
  retrieved: CitableChunk[];
  /** Hasta dónde hubo que ir a buscar: el curso del alumno, otro curso de la
   *  misma asignatura, u otra materia. Es lo que permite decirle al alumno
   *  "esto se ve en 2º Medio". */
  scope: TeachingScope;
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
  /** Todas las materias de la MISMA asignatura (todos los cursos), incluida la
   *  del alumno. Etapa 1 de la cascada. Sin esto la cascada saltea directo a
   *  todo el corpus. */
  familyIds?: string[] | null;
  /** false → no llegar nunca a la etapa de corpus completo. */
  corpusCompleto?: boolean;
  /** Curso del alumno ("1M"): ordena el material por cercanía de nivel. */
  studentGrade?: string | null;
}

/** Hasta dónde hubo que ir a buscar el material que se está citando. */
export type TeachingScope = "curso" | "otro_curso" | "otra_materia" | "ninguno";

/**
 * "1B".."8B" → 1..8 · "1M".."4M" → 9..12. Escala CONTINUA, para poder restar
 * dos cursos y obtener una distancia.
 *
 * El `gradeSort` de la UI (ui.tsx) NO sirve para esto: da 100+n a la media, así
 * que 8º Básico → 1º Medio mide 93 en vez de 1. Sirve para ordenar una lista,
 * no para medir cercanía.
 */
export function gradeOrdinal(g: string | null | undefined): number | null {
  if (!g) return null;
  const n = Number(g.slice(0, -1));
  if (!Number.isFinite(n) || n <= 0) return null;
  return g.endsWith("M") ? 8 + n : n;
}

/**
 * Penalización por distancia de curso, en la escala del rankScore.
 *
 * ASIMÉTRICA a propósito: bajar de curso es más seguro que subir. Material de un
 * curso anterior explica lo mismo más simple; material de un curso posterior
 * puede dar por sabido lo que el alumno todavía no vio.
 *
 * Se aplica SOLO al orden (`rankScore`), nunca al `rerankScore` que mira el
 * gate — la misma disciplina que ya rige para el boost de OA, y por el mismo
 * motivo: un chunk flojo no debe cruzar el umbral por un ajuste de orden, ni
 * quedar afuera por él.
 */
/**
 * Umbral del gate para la etapa de OTRA MATERIA. Más alto que el normal a
 * propósito: ver el comentario en la cascada. Configurable para poder barrerlo.
 */
export const UMBRAL_OTRA_MATERIA = Number(process.env.RAG_UMBRAL_OTRA_MATERIA ?? "") || 0.5;

export const PENAL_GRADO_ABAJO = 0.02;
export const PENAL_GRADO_ARRIBA = 0.05;

export function penalizacionGrado(
  studentGrade: string | null | undefined,
  chunkGrade: string | null | undefined,
): number {
  const a = gradeOrdinal(studentGrade);
  const b = gradeOrdinal(chunkGrade);
  if (a == null || b == null) return 0;
  const d = b - a;
  return d === 0 ? 0 : d > 0 ? d * PENAL_GRADO_ARRIBA : -d * PENAL_GRADO_ABAJO;
}

interface LessonChunk {
  chunkId: string; content: string; unit: number | null; lesson: number | null;
  oa: string | null; headingPath: string | null; pageStart: number | null; pageEnd: number | null;
  documentTitle: string | null; grade: string | null;
}

/** Trae los chunks de contenido de una unidad/lección concreta (orden de página). */
async function fetchLessonChunks(subjectId: string, unit: number, lesson: number | null): Promise<LessonChunk[]> {
  const sql = getSql();
  const rows = (lesson == null
    ? await sql`
        select ch.id as chunk_id, ch.content, ch.unit, ch.lesson, ch.oa, ch.heading_path,
               coalesce(ch.page_start, ch.page) as page_start, coalesce(ch.page_end, ch.page) as page_end,
               d.title as document_title, d.grade
        from chunks ch join documents d on d.id = ch.document_id
        where d.subject_id = ${subjectId} and ch.corpus_role = 'content' and ch.unit = ${unit}
        order by ch.page nulls last, ch.chunk_index
        limit 28`
    : await sql`
        select ch.id as chunk_id, ch.content, ch.unit, ch.lesson, ch.oa, ch.heading_path,
               coalesce(ch.page_start, ch.page) as page_start, coalesce(ch.page_end, ch.page) as page_end,
               d.title as document_title, d.grade
        from chunks ch join documents d on d.id = ch.document_id
        where d.subject_id = ${subjectId} and ch.corpus_role = 'content' and ch.unit = ${unit} and ch.lesson = ${lesson}
        order by ch.page nulls last, ch.chunk_index
        limit 28`) as unknown as {
    chunk_id: string; content: string; unit: number | null; lesson: number | null;
    oa: string | null; heading_path: string | null; page_start: number | null; page_end: number | null;
    document_title: string | null; grade: string | null;
  }[];
  return rows.map((r) => ({
    chunkId: r.chunk_id, content: r.content, unit: r.unit, lesson: r.lesson,
    oa: r.oa, headingPath: r.heading_path, pageStart: r.page_start, pageEnd: r.page_end,
    documentTitle: r.document_title, grade: r.grade,
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
            documentTitle: c.documentTitle, grade: c.grade,
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

  // 1) CONTENIDO — CASCADA DE ALCANCE.
  //
  //    El gate deja de ser un cortacircuito y pasa a ser el DISPARADOR de la
  //    etapa siguiente: si con el material del curso del alumno no alcanza, se
  //    busca en la misma asignatura de los otros cursos, y si tampoco, en todo
  //    el corpus. Ningún umbral cambia — cambia qué se hace cuando no se llega.
  //
  //    Escalonada y no una búsqueda global de entrada porque el brazo léxico une
  //    los lexemas con OR: abrir el alcance en el 100% de los turnos pagaría ese
  //    costo siempre, cuando solo hace falta en el ~20% que hoy se abstiene.
  let content = directedOk
    ? null
    : await retrieveRanked(query, {
        userId: opts.userId,
        subjectIds: opts.subjectId ? [opts.subjectId] : null,
        // La materia que el alumno abrió explícitamente entra aunque esté en
        // pausa: cortarle la conversación a mitad es otra decisión, y no esta.
        incluirPausadas: true,
        k: contentK,
        minRerankScore: threshold,
        corpusRole: "content",
      });

  let scope: TeachingScope = "curso";
  // EL ESTUDIO DIRIGIDO NO SE AMPLÍA NUNCA, ni cuando su material queda flojo.
  // El alumno pidió estudiar ESTA lección de SU plan: traerle la unidad 3 de
  // otro curso sería responder otra cosa. Y `unit`/`lesson` son números que se
  // repiten en los 67 libros, así que ampliar acá devuelve mezcla.
  const dirigido = opts.unit != null;
  // Al ampliar, el pool trae varios cursos: se reordena por cercanía de nivel
  // para que, a igualdad de relevancia, gane el material del curso del alumno.
  // Solo el ORDEN — el gate ya decidió con el score crudo.
  const porCercania = <T extends { content: string; grade: string | null; rerankScore: number; rankScore: number }>(cs: T[]): T[] => {
    const ordenados = [...cs]
      .map((c) => ({ ...c, rankScore: c.rankScore - penalizacionGrado(opts.studentGrade, c.grade) }))
      .sort((a, b) => b.rankScore - a.rankScore);
    // DEDUPE, y solo acá: el corpus tiene ~19% de chunks repetidos y cruzando
    // cursos eso se amplifica (Biología 1º y 2º Medio son literalmente el mismo
    // libro cargado dos veces). Sin esto, el alumno recibe la misma explicación
    // cinco veces y el pool se desperdicia.
    //
    // DESPUÉS del gate y no antes, a propósito: `gapMed` mide el top-1 contra la
    // MEDIANA del pool, y esa mediana está calibrada CON los duplicados dentro.
    // Deduplicar antes recalibraría el margen del gate en silencio.
    const vistos = new Set<string>();
    const out: T[] = [];
    for (const c of ordenados) {
      const k = c.content.replace(/\s+/g, " ").trim().slice(0, 300).toLowerCase();
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(c);
    }
    return out;
  };

  if (!dirigido && !directedOk && opts.subjectId && !content?.grounded && (opts.familyIds?.length ?? 0) > 1) {
    const ampliado = await retrieveRanked(query, {
      userId: opts.userId,
      subjectIds: opts.familyIds,
      k: contentK,
      minRerankScore: threshold,
      corpusRole: "content",
    });
    if (ampliado.grounded) {
      content = { ...ampliado, chunks: porCercania(ampliado.chunks) };
      scope = "otro_curso";
    }
  }
  if (!dirigido && !directedOk && !content?.grounded && opts.corpusCompleto !== false) {
    // LISTÓN MÁS ALTO para la etapa de otra materia. Un fragmento de Ciencias
    // Naturales que responde una duda planteada en Lengua necesita MÁS evidencia
    // que uno del propio libro: no hay contexto de materia que lo respalde, y un
    // match flojo es simplemente ruido de 29.000 chunks.
    //
    // Medido sobre las 24 preguntas del golden que ningún libro cubre: con el
    // umbral normal (0.18) pasaban 15, de las cuales 3 eran claramente basura
    // ("¿cuánto hervir un huevo?" a 0.16, "¿cuántos huesos tiene el cuerpo?" a
    // 0.35). Con 0.5 esas tres caen y las 12 que sí tenían material real siguen.
    const todo = await retrieveRanked(query, {
      userId: opts.userId,
      subjectIds: null,
      k: contentK,
      minRerankScore: Math.max(threshold, UMBRAL_OTRA_MATERIA),
      corpusRole: "content",
    });
    if (todo.grounded) {
      content = { ...todo, chunks: porCercania(todo.chunks) };
      scope = "otra_materia";
    }
  }

  // 2) PEDAGOGÍA por relevancia (corpus_role='pedagogy'), rerankeada.
  //    NO se amplía nunca: la guía docente de otro curso es pedagogía
  //    activamente equivocada (dice cómo enseñarle a chicos de otra edad).
  const pedaCandidates = await retrieveHybrid(query, {
    userId: opts.userId,
    subjectIds: opts.subjectId ? [opts.subjectId] : null,
    incluirPausadas: true,
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
        // El boost SOLO dentro del mismo curso: los códigos de OA son "OA6" a
        // secas y se repiten en TODOS los grados, así que cruzando cursos el
        // "OA6" de 1º Básico haría boost contra el de 4º Medio.
        const mismoCurso = scope === "curso";
        const boosted = mismoCurso && c.oa && oasContent.includes(c.oa) ? rerankScore + oaBoost : rerankScore;
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
    citable = content.chunks.map(aCitable);
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
        documentTitle: c.documentTitle, grade: c.grade,
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

  // Lo que el RANKING trajo, sin que el gate opine. Ver `TeachingContext.retrieved`.
  // `content.chunks` viene poblado aunque `content.grounded` sea false (rerank.ts
  // devuelve `ranked.slice(0, k)` en los dos casos): es la cascada de acá arriba
  // la que los descarta, no el retrieval.
  const retrieved: CitableChunk[] =
    directCitable.length > 0 ? directCitable : (content?.chunks ?? []).map(aCitable);

  const oas = [...new Set([...citable.map((c) => c.oa), ...oasContent].filter(Boolean))] as string[];
  return {
    citable,
    retrieved,
    scope: citable.length > 0 ? scope : "ninguno",
    grounded: citable.length > 0,
    citableSource,
    pedagogy,
    oas,
    topScore,
    gateBypassed,
    stats: content?.stats,
  };
}
