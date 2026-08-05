/**
 * CLI: verifica que el reranker SEPARA dentro/fuera del material (Plan v2 §2 A1).
 *
 *   pnpm --filter @tutor-ia/eval rerank-test
 *
 * Corre una batería etiquetada (dentro=SÍ/NO), imprime el mejor score de rerank
 * por query, y calcula si hay separación limpia + un umbral sugerido (punto medio
 * entre el mínimo "dentro" y el máximo "fuera"). Requiere: libro indexado en
 * Postgres, DEEPINFRA_API_KEY (los embeddings bge-m3 se piden a la API) y el
 * rerank_server local corriendo en 8790.
 */
import { getSql } from "@tutor-ia/db";
import { retrieveRanked, rerankHealthy } from "@tutor-ia/rag";

const DEV_USER_ID =
  process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

const BATTERY: { q: string; inMaterial: boolean }[] = [
  { q: "¿Qué es el amor cortés y los trovadores provenzales?", inMaterial: true },
  { q: "¿Quiénes son Tristán e Isolda?", inMaterial: true },
  { q: "¿Qué significa interpretar una obra literaria?", inMaterial: true },
  { q: "¿Qué le pasa a Yuriko en el cuento de Kawabata?", inMaterial: true },
  { q: "¿Qué es una discontinuidad evitable de una función?", inMaterial: false },
  { q: "¿Quién ganó el mundial de fútbol 2022?", inMaterial: false },
  { q: "receta de tortilla de papas paso a paso", inMaterial: false },
  { q: "cotización del dólar hoy en Argentina", inMaterial: false },
];

async function main() {
  const sql = getSql();
  if (!(await rerankHealthy())) {
    console.error(
      "El rerank_server no responde. Arrancalo:\n" +
        "  packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py",
    );
    await sql.end();
    process.exit(1);
  }

  console.log("🎯 Reranker vs coseno — separación dentro/fuera del material\n");
  console.log("dentro".padEnd(7), "topRerank", "  query");

  const inScores: number[] = [];
  const outScores: number[] = [];

  for (const { q, inMaterial } of BATTERY) {
    // minRerankScore 0 → no gateamos acá, solo queremos el topScore.
    const res = await retrieveRanked(q, { userId: DEV_USER_ID, k: 3, minRerankScore: 0 });
    (inMaterial ? inScores : outScores).push(res.topScore);
    console.log(
      (inMaterial ? "SÍ" : "NO").padEnd(7),
      res.topScore.toFixed(4).padStart(9),
      "  " + q.slice(0, 52),
    );
  }

  const minIn = Math.min(...inScores);
  const maxOut = Math.max(...outScores);
  console.log("\n── Resumen ──");
  console.log(`   dentro:  min=${minIn.toFixed(4)}  max=${Math.max(...inScores).toFixed(4)}`);
  console.log(`   fuera:   min=${Math.min(...outScores).toFixed(4)}  max=${maxOut.toFixed(4)}`);
  if (minIn > maxOut) {
    const thr = (minIn + maxOut) / 2;
    console.log(
      `   ✅ SEPARACIÓN LIMPIA. Margen = ${(minIn - maxOut).toFixed(4)}.\n` +
        `   Umbral sugerido RERANK_MIN_SCORE=${thr.toFixed(3)} (punto medio).`,
    );
  } else {
    console.log(
      `   ⚠️  Solapamiento: min(dentro)=${minIn.toFixed(4)} ≤ max(fuera)=${maxOut.toFixed(4)}.\n` +
        "   No hay umbral perfecto con esta batería; calibrar sobre el golden set (Fase 1).",
    );
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
