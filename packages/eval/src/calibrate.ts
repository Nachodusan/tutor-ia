/**
 * Calibración del umbral de abstención (Plan v2 §9.3). `pnpm calibrate`.
 *
 * Para cada pregunta del golden set mide el MEJOR score del reranker (topScore) y
 * su etiqueta (¿debería abstenerse?). Luego barre umbrales y reporta, en cada uno,
 * la tasa de abstención verdadera (must_abstain que abstienen) y falsa (preguntas
 * con material que abstienen de más). Elige el umbral con datos, no a ojo.
 *
 * Etiquetas:
 *  - must_abstain            → DEBE abstenerse (no hay material).
 *  - answerable/adversarial/multi_hop/false_premise → NO debe abstenerse
 *    (el material existe; en false_premise el modelo debe corregir, no abstenerse).
 *
 * Requiere: golden set + Postgres (libro indexado) + DEEPINFRA_API_KEY (los
 * embeddings bge-m3 se piden a la API) + rerank_server local en 8790.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql } from "@tutor-ia/db";
import { retrieveRanked, rerankHealthy } from "@tutor-ia/rag";
import { sweepThreshold } from "./lib/threshold";

const DEV_USER_ID =
  process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

interface GoldenQuestion {
  id: string;
  type: string;
  q: string;
  expect_chunks?: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(HERE, "../golden");

function shouldAbstain(type: string): boolean {
  return type === "must_abstain";
}

async function main() {
  const sql = getSql();
  if (!(await rerankHealthy())) {
    console.error("rerank_server no responde. Arrancalo antes de calibrar.");
    await sql.end();
    process.exit(1);
  }

  const arg = process.argv[2];
  const path = arg
    ? isAbsolute(arg)
      ? arg
      : resolve(process.env.INIT_CWD ?? process.cwd(), arg)
    : resolve(GOLDEN_DIR, "questions.jsonl");
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw == null) {
    console.error(`No pude leer el golden set: ${path}`);
    await sql.end();
    process.exit(1);
  }
  const questions: GoldenQuestion[] = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenQuestion);

  console.log(`\n📐 Calibración del umbral — ${questions.length} preguntas de ${path}\n`);

  // 1) topScore + etiqueta por pregunta (umbral 0 → siempre devuelve el score).
  const rows: { type: string; abstainExpected: boolean; topScore: number }[] = [];
  for (const q of questions) {
    const res = await retrieveRanked(q.q, {
      userId: DEV_USER_ID,
      k: 3,
      minRerankScore: 0,
    });
    rows.push({
      type: q.type,
      abstainExpected: shouldAbstain(q.type),
      topScore: res.topScore,
    });
  }

  const abstainSet = rows.filter((r) => r.abstainExpected);
  const answerSet = rows.filter((r) => !r.abstainExpected);

  // 2) Separación cruda.
  const maxAbstain = Math.max(...abstainSet.map((r) => r.topScore));
  const minAnswer = Math.min(...answerSet.map((r) => r.topScore));
  console.log("── Scores crudos ──");
  console.log(`   DEBE abstener (n=${abstainSet.length}): max topScore = ${maxAbstain.toFixed(4)}`);
  console.log(`   DEBE responder (n=${answerSet.length}): min topScore = ${minAnswer.toFixed(4)}`);

  // 3) Barrido de umbral — misma lógica que usa rank-sweep offline (lib/threshold).
  const sweep = sweepThreshold(rows);
  console.log("\n── Barrido de umbral ──");
  console.log("  thr   trueAbst  falseAbst   (objetivo: trueAbst≥0.95, falseAbst≤0.10)");
  for (const p of sweep.points) {
    console.log(
      `  ${p.thr.toFixed(2)}   ${(p.trueAbstention * 100).toFixed(0).padStart(6)}%   ` +
        `${(p.falseAbstention * 100).toFixed(0).padStart(7)}%${p.cumpleObjetivos ? " ✅" : ""}`,
    );
  }

  // 4) Recomendación: si hay separación limpia, el punto medio del gap.
  console.log("\n── Recomendación ──");
  if (sweep.separacionLimpia) {
    console.log(
      `   ✅ Separación limpia (gap ${sweep.gap.toFixed(4)}).\n` +
        `   RERANK_MIN_SCORE=${sweep.recomendado.toFixed(3)}  (punto medio del gap; robusto).`,
    );
  } else {
    const best = sweep.points.reduce((a, b) => (b.j > a.j ? b : a));
    console.log(
      `   ⚠️  Hay solapamiento. Mejor punto (Youden J): thr=${best.thr.toFixed(2)} ` +
        `(trueAbst ${(best.trueAbstention * 100).toFixed(0)}%, falseAbst ${(best.falseAbstention * 100).toFixed(0)}%).\n` +
        `   Revisá los casos solapados (¿pregunta mal etiquetada? ¿chunk faltante?).`,
    );
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
