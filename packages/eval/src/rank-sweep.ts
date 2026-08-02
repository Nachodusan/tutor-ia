/**
 * FASE B del experimento de ranking: BARRIDO (sin red, sin LLM, sin GPU).
 *
 * Toma una o dos capturas de `rank-capture` y evalúa la grilla
 * estrategia × pool × snippet sobre los MISMOS candidatos, reusando:
 *  - `orderCandidates` de @tutor-ia/rag — la MISMA función que despacha
 *    producción: la variante que gana acá es literalmente el código shippeable;
 *  - `recallAtK` / `citationPrecision` de lib/metrics — los mismos números que
 *    `pnpm eval`, comparables punto a punto;
 *  - bootstrap PAREADO de lib/stats para el IC95 de cada Δ contra el baseline.
 *
 * El pool se simula truncando por denseRank/lexRank ≤ P y RECALCULANDO el RRF
 * sobre lo que queda (misma fórmula 1/(rrfK+rank) de retrieve-hybrid.ts).
 *
 * Regla de decisión (escrita ANTES de mirar resultados):
 *   se adopta V sobre el baseline si el IC95 de Δrecall@5 excluye el 0 por
 *   arriba en ≥1 set Y no baja de −2 puntos en el otro; empate → la más simple.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval rank-sweep captures/golden-pool100.json \
 *     [captures/parafraseadas-pool100.json]
 */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  orderCandidates,
  parseRankStrategy,
  describeStrategy,
  type RankStrategy,
} from "@tutor-ia/rag";
import { recallAtK, citationPrecision } from "./lib/metrics";
import { pairedBootstrapCI } from "./lib/stats";
import { sweepThreshold, type GateRow } from "./lib/threshold";
import type { CaptureFile, CapturedCandidate } from "./rank-capture";

const K_FINAL = 5; // recall@K objetivo (el del §9.2)
const RRF_K = 60; // misma constante que retrieve-hybrid.ts

interface Cell {
  strategy: string;
  pool: number;
  snippet: "full" | "600";
  set: string;
  n: number;
  recallAt5: number;
  recallAtPool: number;
  perdida: number;
  recallAt1: number;
  recallAt3: number;
  recallAt8: number;
  precisionGold: number;
  mrr: number;
  rangoMedianoGold: number | null;
  deltaVsBaseline?: number;
  ic95?: [number, number];
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

/** Simula un pool más chico: cada brazo truncado a P y RRF recalculado. */
function simulatePool(cands: CapturedCandidate[], pool: number): CapturedCandidate[] {
  return cands
    .filter(
      (c) =>
        (c.denseRank != null && c.denseRank <= pool) ||
        (c.lexRank != null && c.lexRank <= pool),
    )
    .map((c) => {
      const dr = c.denseRank != null && c.denseRank <= pool ? c.denseRank : null;
      const lr = c.lexRank != null && c.lexRank <= pool ? c.lexRank : null;
      return {
        ...c,
        denseRank: dr,
        lexRank: lr,
        rrf: (dr != null ? 1 / (RRF_K + dr) : 0) + (lr != null ? 1 / (RRF_K + lr) : 0),
      };
    });
}

/** Orden final de una pregunta bajo (estrategia, pool, snippet). */
function finalOrder(
  cands: CapturedCandidate[],
  strategy: RankStrategy,
  pool: number,
  snippet: "full" | "600",
): string[] {
  const sim = simulatePool(cands, pool);
  const logits = sim.map((c) => (snippet === "full" ? c.ceLogitFull : c.ceLogit600));
  return orderCandidates(
    sim.map((c) => ({ ...c, lexicalRank: c.lexRank })),
    logits,
    strategy,
  ).map((c) => c.chunkId);
}

interface EvalSet {
  name: string;
  questions: { id: string; expect: string[]; cands: CapturedCandidate[] }[];
  /** TODAS las preguntas (incl. must_abstain) para calibrar el gate. */
  gateQuestions: { type: string; cands: CapturedCandidate[] }[];
}

function evalCell(
  set: EvalSet,
  strategy: RankStrategy,
  pool: number,
  snippet: "full" | "600",
): { cell: Cell; perQ: number[] } {
  const perQ: number[] = [];
  let rPool = 0, r1 = 0, r3 = 0, r8 = 0, prec = 0, mrr = 0;
  const rangos: number[] = [];
  for (const q of set.questions) {
    const order = finalOrder(q.cands, strategy, pool, snippet);
    const r5 = recallAtK(order, q.expect, K_FINAL);
    perQ.push(r5);
    rPool += recallAtK(order, q.expect, order.length);
    r1 += recallAtK(order, q.expect, 1);
    r3 += recallAtK(order, q.expect, 3);
    r8 += recallAtK(order, q.expect, 8);
    prec += citationPrecision(order.slice(0, Math.max(1, q.expect.length)), q.expect);
    const pos = order.findIndex((id) => q.expect.includes(id));
    if (pos >= 0) {
      mrr += 1 / (pos + 1);
      rangos.push(pos + 1);
    }
  }
  const n = set.questions.length;
  rangos.sort((a, b) => a - b);
  const media = (x: number) => x / Math.max(1, n);
  const cell: Cell = {
    strategy: describeStrategy(strategy),
    pool,
    snippet,
    set: set.name,
    n,
    recallAt5: media(perQ.reduce((a, b) => a + b, 0)),
    recallAtPool: media(rPool),
    perdida: media(rPool) - media(perQ.reduce((a, b) => a + b, 0)),
    recallAt1: media(r1),
    recallAt3: media(r3),
    recallAt8: media(r8),
    precisionGold: media(prec),
    mrr: media(mrr),
    rangoMedianoGold: rangos.length ? (rangos[rangos.length >> 1] ?? null) : null,
  };
  return { cell, perQ };
}

const STRATEGIES: RankStrategy[] = [
  { kind: "ce" },
  { kind: "rrf" },
  { kind: "dense" },
  { kind: "lexical" },
  ...[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].flatMap((alpha): RankStrategy[] => [
    { kind: "linear", alpha, norm: "minmax" },
    { kind: "linear", alpha, norm: "z" },
  ]),
  ...[5, 10, 15].map((topN): RankStrategy => ({ kind: "rrf_then_ce", topN })),
];
const POOLS = [10, 20, 25, 30, 50, 100];
const SNIPPETS: ("full" | "600")[] = ["full", "600"];

/** Baseline = producción de hoy: ce · pool 20 · texto completo. */
const BASELINE = { strategy: "ce", pool: 20, snippet: "full" as const };

async function main() {
  const paths = process.argv.slice(2).filter(Boolean).map(resolvePath);
  if (paths.length === 0) {
    console.error("uso: rank-sweep <captura.json> [captura2.json]");
    process.exit(1);
  }
  const sets: EvalSet[] = [];
  let provRef: string | null = null;
  for (const p of paths) {
    const cap = JSON.parse(await readFile(p, "utf8")) as CaptureFile;
    // Dos capturas solo son comparables sobre el MISMO corpus.
    const huella = `${cap.corpusChunkCount}@${cap.corpusMaxCreatedAt}`;
    if (provRef == null) provRef = huella;
    else if (provRef !== huella) {
      console.error(`❌ Capturas de corpus distintos: "${provRef}" vs "${huella}". No comparables.`);
      process.exit(1);
    }
    sets.push({
      name: cap.goldenPath.includes("parafraseadas") ? "parafraseadas" : "golden",
      questions: cap.questions
        .filter((q) => q.expectChunks.length > 0)
        .map((q) => ({ id: q.id, expect: q.expectChunks, cands: q.candidates })),
      gateQuestions: cap.questions.map((q) => ({ type: q.type, cands: q.candidates })),
    });
    console.log(
      `📂 ${p} → set "${sets[sets.length - 1]!.name}" · ${sets[sets.length - 1]!.questions.length} preguntas con gold · corpus ${huella}`,
    );
  }

  // Vector base por set (pareado por pregunta) para el bootstrap.
  const basePerSet = new Map<string, number[]>();
  for (const s of sets) {
    basePerSet.set(
      s.name,
      evalCell(s, parseRankStrategy(BASELINE.strategy), BASELINE.pool, BASELINE.snippet).perQ,
    );
  }

  const cells: Cell[] = [];
  for (const s of sets) {
    const base = basePerSet.get(s.name)!;
    for (const strategy of STRATEGIES) {
      for (const pool of POOLS) {
        for (const snippet of SNIPPETS) {
          const { cell, perQ } = evalCell(s, strategy, pool, snippet);
          const ci = pairedBootstrapCI(base, perQ);
          cell.deltaVsBaseline = ci.delta;
          cell.ic95 = [ci.lo, ci.hi];
          cells.push(cell);
        }
      }
    }
  }

  // Regla de decisión programática (ver cabecera). Orden de simplicidad:
  const simplicidad = (s: string) =>
    s === "rrf" || s === "dense" || s === "lexical" ? 0 : s === "ce" ? 1 : s.startsWith("rrf_then_ce") ? 2 : 3;
  const porVariante = new Map<string, Cell[]>();
  for (const c of cells) {
    const key = `${c.strategy}|${c.pool}|${c.snippet}`;
    const arr = porVariante.get(key) ?? [];
    arr.push(c);
    porVariante.set(key, arr);
  }
  const candidatas: { key: string; cells: Cell[]; sumDelta: number }[] = [];
  for (const [key, cs] of porVariante) {
    const ganaEnUno = cs.some((c) => (c.ic95?.[0] ?? -1) > 0);
    const noRompeOtro = cs.every((c) => (c.ic95?.[0] ?? -1) >= -0.02 || (c.ic95?.[0] ?? -1) > 0);
    if (ganaEnUno && noRompeOtro) {
      candidatas.push({ key, cells: cs, sumDelta: cs.reduce((a, c) => a + (c.deltaVsBaseline ?? 0), 0) });
    }
  }
  candidatas.sort(
    (a, b) =>
      b.sumDelta - a.sumDelta ||
      simplicidad(a.key.split("|")[0]!) - simplicidad(b.key.split("|")[0]!),
  );

  // Reporte: top-25 por recall@5 de parafraseadas (golden como desempate).
  const fmtPct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const byKey = new Map<string, { g?: Cell; p?: Cell }>();
  for (const c of cells) {
    const key = `${c.strategy}|${c.pool}|${c.snippet}`;
    const e = byKey.get(key) ?? {};
    if (c.set === "golden") e.g = c;
    else e.p = c;
    byKey.set(key, e);
  }
  const filas = [...byKey.entries()].sort(
    (a, b) =>
      (b[1].p?.recallAt5 ?? b[1].g?.recallAt5 ?? 0) - (a[1].p?.recallAt5 ?? a[1].g?.recallAt5 ?? 0) ||
      (b[1].g?.recallAt5 ?? 0) - (a[1].g?.recallAt5 ?? 0),
  );
  console.log(
    `\n${"variante".padEnd(26)} ${"pool".padStart(4)} ${"snip".padStart(4)}` +
      ` │ ${"g:r@5".padStart(6)} ${"g:Δ".padStart(6)} ${"g:IC95".padStart(15)} ${"g:pérd".padStart(6)}` +
      ` │ ${"p:r@5".padStart(6)} ${"p:Δ".padStart(6)} ${"p:IC95".padStart(15)} ${"p:pérd".padStart(6)}`,
  );
  for (const [key, e] of filas.slice(0, 25)) {
    const [st, pool, snip] = key.split("|");
    const f = (c?: Cell) =>
      c
        ? `${fmtPct(c.recallAt5).padStart(6)} ${((c.deltaVsBaseline ?? 0) * 100).toFixed(1).padStart(6)} ` +
          `[${(100 * (c.ic95?.[0] ?? 0)).toFixed(1)},${(100 * (c.ic95?.[1] ?? 0)).toFixed(1)}]`.padStart(15) +
          ` ${fmtPct(c.perdida).padStart(6)}`
        : "—".padStart(36);
    console.log(`${st!.padEnd(26)} ${pool!.padStart(4)} ${snip!.padStart(4)} │ ${f(e.g)} │ ${f(e.p)}`);
  }

  const winner = candidatas[0] ?? null;
  console.log(
    winner
      ? `\n🏆 GANADORA bajo la regla pre-escrita: ${winner.key}  (ΣΔ=${(100 * winner.sumDelta).toFixed(1)} pts)`
      : `\n🏳️ NINGUNA variante gana bajo la regla → el baseline se queda. El problema no está en el ordenamiento.`,
  );
  if (candidatas.length > 1) {
    console.log(`   otras que también cumplen: ${candidatas.slice(1, 6).map((c) => c.key).join(" · ")}`);
  }

  // ── GATE: re-derivar RERANK_MIN_SCORE para el pool ganador ──
  // El score del gate es el MÁXIMO rerankScore (sigmoide del logit CE) del pool,
  // que es la semántica EXACTA del gate de hoy (con orden "ce", max == top-1) y
  // es invariante a la estrategia: cambiar el orden no cambia si hay material.
  const winnerPool = winner ? Number(winner.key.split("|")[1]) : BASELINE.pool;
  const winnerSnip = winner ? (winner.key.split("|")[2] as "full" | "600") : BASELINE.snippet;
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  console.log(`\n── Gate (max rerankScore del pool ${winnerPool}, snippet ${winnerSnip}) ──`);
  for (const s of sets) {
    const rows: GateRow[] = s.gateQuestions.map((q) => {
      const sim = simulatePool(q.cands, winnerPool);
      const top = sim.reduce(
        (m, c) => Math.max(m, sigmoid(winnerSnip === "full" ? c.ceLogitFull : c.ceLogit600)),
        0,
      );
      return { abstainExpected: q.type === "must_abstain", topScore: top };
    });
    const sw = sweepThreshold(rows);
    console.log(
      `  ${s.name}: maxAbstain=${sw.maxAbstain.toFixed(4)} minAnswer=${sw.minAnswer.toFixed(4)} ` +
        (sw.separacionLimpia
          ? `gap=${sw.gap.toFixed(4)} → RERANK_MIN_SCORE=${sw.recomendado.toFixed(3)}`
          : `SOLAPADO → mejor J en thr=${sw.recomendado.toFixed(2)}`),
    );
  }

  const outPath = resolvePath(`rank-sweep-${Date.now()}.json`);
  await writeFile(
    outPath,
    JSON.stringify({ baseline: BASELINE, corpus: provRef, cells, winner: winner?.key ?? null }, null, 1),
    "utf8",
  );
  console.log(`💾 grilla completa: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
