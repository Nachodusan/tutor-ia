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
}

interface Row {
  chunk_id: string;
  document_id: string;
  content: string;
  heading_path: string | null;
  page_start: number | null;
  page_end: number | null;
  score: number;
}

export async function retrieveHybrid(
  query: string,
  opts: HybridOptions,
): Promise<HybridChunk[]> {
  const sql = getSql();
  const pool = opts.poolPerSide ?? 20;
  const rrfK = opts.rrfK ?? 60;
  const k = opts.k ?? 8;
  const subject = opts.subjectId ?? null;

  const embedding = toVectorLiteral(await embedQuery(query));

  const [dense, lexical] = await Promise.all([
    sql<Row[]>`
      select * from match_chunks_dense(${embedding}::vector, ${opts.userId}::uuid, ${subject}, ${pool})
    `,
    sql<Row[]>`
      select * from match_chunks_lexical(${query}, ${opts.userId}::uuid, ${subject}, ${pool})
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

  return [...merged.values()].sort((a, b) => b.rrf - a.rrf).slice(0, k);
}

/** Cita legible a partir de un chunk ("pág. 87 · Unidad 1 › Lección 1"). */
export function citationLabel(c: HybridChunk): string {
  const page =
    c.pageStart != null
      ? c.pageStart === c.pageEnd || c.pageEnd == null
        ? `pág. ${c.pageStart}`
        : `págs. ${c.pageStart}-${c.pageEnd}`
      : "";
  return [page, c.headingPath].filter(Boolean).join(" · ") || "(sin ubicación)";
}
