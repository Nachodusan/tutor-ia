/**
 * FASE A del experimento de ranking: CAPTURA (con red, sin LLM).
 *
 * Por pregunta del golden: corre `retrieveHybrid` con pool grande (100 por lado)
 * — el MISMO camino de producción, que ya devuelve denseRank/lexicalRank/rrf por
 * chunk — y puntúa TODOS los candidatos con el cross-encoder en LOGITS CRUDOS
 * (normalize=false; la sigmoide se deriva en TS, al revés es imposible). Dos
 * pasadas de scoring: texto completo y truncado a RERANK_SNIPPET_CHARS.
 *
 * El resultado va a un JSON con procedencia (sha del golden, huella del corpus):
 * la FASE B (`rank-sweep`) barre estrategias × pools × k sobre ese JSON sin
 * volver a tocar la red. El pool se simula truncando por denseRank/lexicalRank,
 * así que UNA captura a 100 cubre todos los pools ≤ 100.
 *
 * No importa @tutor-ia/core: este experimento no puede llamar al LLM ni por
 * accidente.
 *
 * Uso:
 *   EVAL_USER_ID=... EVAL_SUBJECT_ID=... pnpm --filter @tutor-ia/eval rank-capture \
 *     [golden/questions.jsonl] [salida.json]
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  RERANK_SNIPPET_CHARS,
  rerank,
  rerankHealthy,
  retrieveHybrid,
} from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";

/** Pool por brazo de la captura: cubre todos los pools simulables ≤ este valor. */
const CAPTURE_POOL = Number(process.env.CAPTURE_POOL ?? "100");
/** Tamaño de lote hacia el sidecar: 200 pasajes en un POST revientan MPS. */
const BATCH = Number(process.env.CAPTURE_BATCH ?? "32");

interface GoldenQuestion {
  id: string;
  type: string;
  q: string;
  expect_chunks?: string[];
}

export interface CapturedCandidate {
  chunkId: string;
  denseRank: number | null;
  lexRank: number | null;
  denseScore: number | null;
  lexScore: number | null;
  /** RRF de la captura (pool 100). El sweep lo RECALCULA al simular pools chicos. */
  rrf: number;
  /** Logit crudo del CE sobre el contenido completo. */
  ceLogitFull: number;
  /** Logit crudo del CE sobre los primeros RERANK_SNIPPET_CHARS caracteres. */
  ceLogit600: number;
}

export interface CaptureFile {
  capturedAt: string;
  goldenPath: string;
  goldenSha256: string;
  capturePool: number;
  corpusRole: string;
  userId: string;
  subjectId: string;
  corpusChunkCount: number;
  corpusMaxCreatedAt: string | null;
  snippetChars: number;
  rerankBase: string;
  questions: {
    id: string;
    type: string;
    q: string;
    expectChunks: string[];
    candidates: CapturedCandidate[];
  }[];
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

/** Logits crudos en lotes: un POST gigante satura el sidecar y expira. */
async function rerankLogitsBatched(query: string, passages: string[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < passages.length; i += BATCH) {
    const scores = await rerank(query, passages.slice(i, i + BATCH), false);
    out.push(...scores);
  }
  return out;
}

async function main() {
  const goldenPath = resolvePath(process.argv[2] ?? "golden/questions.jsonl");
  const raw = await readFile(goldenPath, "utf8");
  const goldenSha256 = createHash("sha256").update(raw).digest("hex");
  const questions = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenQuestion);

  const userId = process.env.EVAL_USER_ID;
  const subjectId = process.env.EVAL_SUBJECT_ID;
  if (!userId || !subjectId) {
    // Sin materia, el retrieval corre sobre TODO el corpus (73 materias) y la
    // captura no representa nada — mismo argumento documentado en eval.ts.
    console.error("❌ Falta EVAL_USER_ID y/o EVAL_SUBJECT_ID. La captura por materia es obligatoria.");
    process.exit(1);
  }

  if (!(await rerankHealthy())) {
    console.error("❌ El sidecar de rerank no responde. Arrancalo antes de capturar.");
    process.exit(1);
  }

  const sql = getSql();
  const [prov] = await sql<{ n: string; max_created: string | null }[]>`
    select count(*)::text as n, max(created_at)::text as max_created from chunks`;

  const tag = goldenPath.includes("parafraseadas") ? "parafraseadas" : "golden";
  const outPath = resolvePath(
    process.argv[3] ?? `captures/${tag}-pool${CAPTURE_POOL}.json`,
  );
  await mkdir(dirname(outPath), { recursive: true });

  console.log(`\n📸 rank-capture — pool ${CAPTURE_POOL} por brazo · lotes de ${BATCH}`);
  console.log(`   golden:  ${goldenPath} (${questions.length} preguntas · sha ${goldenSha256.slice(0, 12)})`);
  console.log(`   corpus:  ${prov?.n} chunks · última ingesta ${prov?.max_created ?? "?"}`);
  console.log(`   salida:  ${outPath}\n`);

  const out: CaptureFile = {
    capturedAt: new Date().toISOString(),
    goldenPath,
    goldenSha256,
    capturePool: CAPTURE_POOL,
    corpusRole: "content",
    userId,
    subjectId,
    corpusChunkCount: Number(prov?.n ?? -1),
    corpusMaxCreatedAt: prov?.max_created ?? null,
    snippetChars: RERANK_SNIPPET_CHARS,
    rerankBase: process.env.RERANK_BASE_URL ?? "http://127.0.0.1:8790",
    questions: [],
  };

  const t0 = Date.now();
  for (const [qi, gq] of questions.entries()) {
    const tq = Date.now();
    // Mismo camino de producción; k alto para conservar la unión completa de
    // ambos brazos (hasta 2×pool si no se solapan).
    const candidates = await retrieveHybrid(gq.q, {
      userId,
      // null = todo el corpus, que es lo que hay que capturar para poder barrer
      // preguntas de alcance cruzado entre cursos.
      subjectIds: subjectId ? [subjectId] : null,
      incluirPausadas: true,
      corpusRole: "content",
      poolPerSide: CAPTURE_POOL,
      k: CAPTURE_POOL * 2,
    });

    const full = candidates.map((c) => c.content);
    const snip = candidates.map((c) => c.content.slice(0, RERANK_SNIPPET_CHARS));
    const logitsFull = await rerankLogitsBatched(gq.q, full);
    const logits600 = await rerankLogitsBatched(gq.q, snip);

    out.questions.push({
      id: gq.id,
      type: gq.type,
      q: gq.q,
      expectChunks: gq.expect_chunks ?? [],
      candidates: candidates.map((c, i) => ({
        chunkId: c.chunkId,
        denseRank: c.denseRank,
        lexRank: c.lexicalRank,
        denseScore: c.denseScore,
        lexScore: c.lexicalScore,
        rrf: c.rrf,
        ceLogitFull: logitsFull[i] ?? -100, // sentinela: JSON no serializa -Infinity (no debería ocurrir: largos iguales)
        ceLogit600: logits600[i] ?? -100, // sentinela: JSON no serializa -Infinity (no debería ocurrir: largos iguales)
      })),
    });
    console.log(
      `  ${String(qi + 1).padStart(3)}/${questions.length} ${gq.id} · ${candidates.length} candidatos · ${((Date.now() - tq) / 1000).toFixed(1)}s`,
    );
  }

  await writeFile(outPath, JSON.stringify(out), "utf8");
  console.log(
    `\n💾 ${outPath} · ${out.questions.length} preguntas · ${((Date.now() - t0) / 60000).toFixed(1)} min`,
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
