/**
 * Validación del verificador A3 contra un set ETIQUETADO (Fase 2, auditoría).
 *
 * A3 usa un cross-encoder de RELEVANCIA como proxy de entailment. Este script
 * mide qué tan bien discrimina de verdad, con triples (claim, chunk, label):
 *   supported     → paráfrasis fiel: DEBE puntuar >= umbral
 *   contradiction → contradicción SUTIL on-topic: DEBE puntuar < umbral
 *                   (el caso que la relevancia estructuralmente tiende a dejar pasar)
 *   neutral       → mismo tema, no afirmado por el chunk: DEBE puntuar < umbral
 *
 * Reporta la matriz a ENTAIL_MIN (0.5), el leak-rate de contradicciones (la
 * métrica que importa para "relevante pero falso") y un barrido de umbral.
 *
 * Uso: pnpm --filter @tutor-ia/eval a3-validate   (requiere DB + rerank server)
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql } from "@tutor-ia/db";
import { entails } from "@tutor-ia/rag";

const HERE = dirname(fileURLToPath(import.meta.url));
const SET_PATH = resolve(HERE, "../golden/a3-set.jsonl");
const ENTAIL_MIN = Number(process.env.EVAL_ENTAIL_MIN ?? process.env.ENTAIL_MIN_SCORE ?? "0.5");

type Label = "supported" | "contradiction" | "neutral";
interface Triple {
  claim: string;
  chunk_id: string;
  label: Label;
  rationale?: string;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const raw = await readFile(SET_PATH, "utf8").catch(() => null);
  if (!raw) {
    console.error(`❌ No existe ${SET_PATH}. Generalo primero (ver golden/README.md).`);
    process.exit(1);
  }
  const triples: Triple[] = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const sql = getSql();
  const scored: { label: Label; score: number; claim: string }[] = [];
  let missing = 0;

  for (const t of triples) {
    const rows = await sql<{ content: string }[]>`
      select content from chunks where id = ${t.chunk_id}
    `;
    if (rows.length === 0) {
      missing++;
      continue; // chunk reingestado/borrado: no evaluable
    }
    const score = await entails(t.claim, [rows[0]!.content]);
    scored.push({ label: t.label, score, claim: t.claim });
  }
  if (missing > 0) console.log(`⚠ ${missing} triples con chunk_id inexistente (excluidos).`);

  const by = (l: Label) => scored.filter((s) => s.label === l);
  const stats = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return {
      min: s[0] ?? 0,
      med: s.length % 2 ? s[mid]! : ((s[mid - 1]! + s[mid]!) / 2),
      max: s[s.length - 1] ?? 0,
    };
  };

  console.log(`\n🧪 Validación A3 — ${scored.length} triples · umbral actual ${ENTAIL_MIN}\n`);
  console.log("label          n    min    mediana  max");
  for (const l of ["supported", "contradiction", "neutral"] as Label[]) {
    const xs = by(l).map((s) => s.score);
    const st = stats(xs);
    console.log(
      `${l.padEnd(13)} ${String(xs.length).padStart(3)}  ${st.min.toFixed(3)}  ${st.med.toFixed(3)}    ${st.max.toFixed(3)}`,
    );
  }

  // Matriz al umbral actual. El número CRÍTICO: contradiction leak-rate.
  const okSup = by("supported").filter((s) => s.score >= ENTAIL_MIN).length;
  const leakCon = by("contradiction").filter((s) => s.score >= ENTAIL_MIN).length;
  const leakNeu = by("neutral").filter((s) => s.score >= ENTAIL_MIN).length;
  console.log(`\nAl umbral ${ENTAIL_MIN}:`);
  console.log(`  supported aceptadas (recall del verificador): ${okSup}/${by("supported").length} = ${pct(okSup / Math.max(1, by("supported").length))}`);
  console.log(`  contradiction QUE SE CUELAN (falso 'respaldada'): ${leakCon}/${by("contradiction").length} = ${pct(leakCon / Math.max(1, by("contradiction").length))}  ← la métrica que importa`);
  console.log(`  neutral que se cuelan: ${leakNeu}/${by("neutral").length} = ${pct(leakNeu / Math.max(1, by("neutral").length))}`);

  // Barrido: ¿existe un umbral mejor?
  console.log("\numbral  acc    sup_ok  con_leak  neu_leak");
  let best = { t: ENTAIL_MIN, acc: -1 };
  for (let t = 0.05; t <= 0.95; t += 0.05) {
    const th = Number(t.toFixed(2));
    const tp = by("supported").filter((s) => s.score >= th).length;
    const tnC = by("contradiction").filter((s) => s.score < th).length;
    const tnN = by("neutral").filter((s) => s.score < th).length;
    const acc = (tp + tnC + tnN) / Math.max(1, scored.length);
    if (acc > best.acc) best = { t: th, acc };
    console.log(
      `${th.toFixed(2)}    ${pct(acc).padStart(6)} ${pct(tp / Math.max(1, by("supported").length)).padStart(7)} ${pct((by("contradiction").length - tnC) / Math.max(1, by("contradiction").length)).padStart(8)} ${pct((by("neutral").length - tnN) / Math.max(1, by("neutral").length)).padStart(9)}`,
    );
  }
  console.log(`\nMejor umbral por accuracy: ${best.t} (${pct(best.acc)})`);

  // Los peores errores, para leerlos con ojos humanos.
  const worstLeaks = by("contradiction").filter((s) => s.score >= ENTAIL_MIN).sort((a, b) => b.score - a.score).slice(0, 5);
  const worstMisses = by("supported").filter((s) => s.score < ENTAIL_MIN).sort((a, b) => a.score - b.score).slice(0, 5);
  if (worstLeaks.length) {
    console.log("\nPeores contradicciones que PASAN (revisar a mano):");
    for (const s of worstLeaks) console.log(`  ${s.score.toFixed(3)}  ${s.claim.slice(0, 90)}`);
  }
  if (worstMisses.length) {
    console.log("\nPeores supported que FALLAN (falsos positivos de alucinación):");
    for (const s of worstMisses) console.log(`  ${s.score.toFixed(3)}  ${s.claim.slice(0, 90)}`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
