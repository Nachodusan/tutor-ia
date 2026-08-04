/**
 * Retrieval híbrido (Plan v2 §2/§3): combina búsqueda densa (bge-m3 + pgvector)
 * y léxica (tsvector español) y las fusiona con Reciprocal Rank Fusion (RRF).
 *
 * Por qué híbrido: el denso falla justo donde abunda el material de estudio
 * (siglas, nombres propios, definiciones exactas); el léxico lo rescata. RRF
 * combina ambos rankings sin tener que calibrar pesos entre scores de escalas
 * distintas (coseno vs ts_rank).
 */
import { getSql, toVectorLiteral } from "@tutor-ia/db";
import { embedQuery } from "./embeddings";

export interface HybridChunk {
  chunkId: string;
  documentId: string;
  content: string;
  headingPath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  /** Doble corpus tipado (Plan v3): rol + metadata curricular. */
  corpusRole: string | null;
  pedagogyType: string | null;
  unit: number | null;
  lesson: number | null;
  oa: string | null;
  /** PROCEDENCIA: de qué libro y de qué curso salió. Sin esto, cuando el tutor
   *  trae material de otro curso "pág. 87" no le dice nada al alumno. */
  documentTitle: string | null;
  grade: string | null;
  /** Posición (1-based) en el ranking denso / léxico; null si no apareció. */
  denseRank: number | null;
  lexicalRank: number | null;
  denseScore: number | null;
  lexicalScore: number | null;
  /** Score de fusión RRF (mayor = más relevante). */
  rrf: number;
}

export interface HybridOptions {
  userId: string;
  subjectId?: string | null;
  /** Cuántos devolver tras la fusión (default 8). */
  k?: number;
  /** Candidatos por lado antes de fusionar (default 20). */
  poolPerSide?: number;
  /** Constante de RRF (default 60; estándar de la literatura). */
  rrfK?: number;
  /** Filtrar por corpus: 'content' | 'pedagogy' | null (todo). */
  corpusRole?: string | null;
}

interface Row {
  chunk_id: string;
  document_id: string;
  content: string;
  heading_path: string | null;
  page_start: number | null;
  page_end: number | null;
  score: number;
  corpus_role: string | null;
  pedagogy_type: string | null;
  unit: number | null;
  lesson: number | null;
  oa: string | null;
  document_title: string | null;
  grade: string | null;
}

/** Default del pool por brazo. Configurable con RAG_POOL_PER_SIDE (mismo patrón
 *  que DEFAULT_RERANK_MIN_SCORE / rerankMinScoreFromEnv en rerank.ts). */
export const DEFAULT_POOL_PER_SIDE = 20;

export function poolPerSideFromEnv(): number {
  const n = Number(process.env.RAG_POOL_PER_SIDE ?? "");
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_POOL_PER_SIDE;
}

/**
 * Contadores del retrieval híbrido. Viajan en el valor de retorno (packages/rag
 * no loguea) y los emite el decision-log de core. Motivo: el brazo léxico
 * devolvía 0 filas en el 92% de las preguntas reales (AND de plainto_tsquery,
 * medido 2026-08-01) y NADIE lo veía — el RRF degeneraba a denso puro en
 * silencio.
 */
export interface RetrievalStats {
  nDense: number;
  nLexical: number;
  /** Candidatos únicos tras la fusión (antes del corte a k). */
  nFused: number;
  poolPerSide: number;
  /** Redundante a propósito: `grep -c "lexEmpty=true"` responde la pregunta. */
  lexEmpty: boolean;
}

export interface HybridResult {
  chunks: HybridChunk[];
  stats: RetrievalStats;
}

export async function retrieveHybrid(
  query: string,
  opts: HybridOptions,
): Promise<HybridChunk[]> {
  return (await retrieveHybridWithStats(query, opts)).chunks;
}

export async function retrieveHybridWithStats(
  query: string,
  opts: HybridOptions,
): Promise<HybridResult> {
  const sql = getSql();
  const pool = opts.poolPerSide ?? poolPerSideFromEnv();
  const rrfK = opts.rrfK ?? 60;
  const k = opts.k ?? 8;
  const subject = opts.subjectId ?? null;

  const embedding = toVectorLiteral(await embedQuery(query));

  const role = opts.corpusRole ?? null;
  const [dense, lexical] = await Promise.all([
    sql<Row[]>`
      select * from match_chunks_dense(${embedding}::vector, ${opts.userId}::uuid, ${subject}, ${pool}, ${role})
    `,
    sql<Row[]>`
      select * from match_chunks_lexical(${query}, ${opts.userId}::uuid, ${subject}, ${pool}, ${role})
    `,
  ]);

  const merged = new Map<string, HybridChunk>();

  const ensure = (r: Row): HybridChunk => {
    let hc = merged.get(r.chunk_id);
    if (!hc) {
      hc = {
        chunkId: r.chunk_id,
        documentId: r.document_id,
        content: r.content,
        headingPath: r.heading_path,
        pageStart: r.page_start,
        pageEnd: r.page_end,
        corpusRole: r.corpus_role,
        pedagogyType: r.pedagogy_type,
        unit: r.unit,
        lesson: r.lesson,
        oa: r.oa,
        documentTitle: r.document_title,
        grade: r.grade,
        denseRank: null,
        lexicalRank: null,
        denseScore: null,
        lexicalScore: null,
        rrf: 0,
      };
      merged.set(r.chunk_id, hc);
    }
    return hc;
  };

  dense.forEach((r, i) => {
    const hc = ensure(r);
    hc.denseRank = i + 1;
    hc.denseScore = r.score;
    hc.rrf += 1 / (rrfK + i + 1);
  });
  lexical.forEach((r, i) => {
    const hc = ensure(r);
    hc.lexicalRank = i + 1;
    hc.lexicalScore = r.score;
    hc.rrf += 1 / (rrfK + i + 1);
  });

  return {
    chunks: [...merged.values()].sort((a, b) => b.rrf - a.rrf).slice(0, k),
    stats: {
      nDense: dense.length,
      nLexical: lexical.length,
      nFused: merged.size,
      poolPerSide: pool,
      lexEmpty: lexical.length === 0,
    },
  };
}

/** "1M" → "1º Medio". Duplicado chico de la UI: el rótulo de la cita se arma
 *  del lado del servidor, donde no hay componentes. */
export function gradeLabel(g: string | null | undefined): string {
  if (!g) return "";
  const n = g.slice(0, -1);
  return g.endsWith("M") ? `${n}º Medio` : `${n}º Básico`;
}

/** El nombre del libro, sin el sufijo de tomo ni el curso que ya va aparte. */
function tituloCorto(t: string | null): string {
  if (!t) return "";
  return t
    .replace(/\s*[—–-]\s*(texto del estudiante|guía didáctica del docente|gu[ií]a).*/i, "")
    .replace(/\s*[—–-]\s*tomo\s*\d+.*/i, "")
    .replace(/\s+\d+º.*$/, "")
    .trim();
}

/**
 * Cita legible ("Biología · 1º Medio · pág. 87 · Unidad 1 › Lección 1").
 *
 * El libro y el curso van ADELANTE y no al final: en cuanto el tutor puede
 * traer material de otro curso, "pág. 87" a secas es ambiguo — el alumno no
 * puede saber si eso salió de su libro o del de 4º Medio. Y esa es exactamente
 * la información que necesita para ir a buscarlo.
 */
export function citationLabel(c: HybridChunk): string {
  const page =
    c.pageStart != null
      ? c.pageStart === c.pageEnd || c.pageEnd == null
        ? `pág. ${c.pageStart}`
        : `págs. ${c.pageStart}-${c.pageEnd}`
      : "";
  return [tituloCorto(c.documentTitle), gradeLabel(c.grade), page, c.headingPath]
    .filter(Boolean).join(" · ") || "(sin ubicación)";
}
