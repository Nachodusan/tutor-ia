/**
 * GUARDA DE REGRESIÓN DE RETRIEVAL — sin generación, en minutos.
 *
 * `correct_mode` (y todo el encuadre modo/alcance) sale del RETRIEVAL: el modo
 * lo decide si hubo material citable, no el texto generado. Así que se puede
 * medir sin pagar la generación — el golden completo tarda ~2,5 h y esto ~2 min.
 *
 * Para qué sirve, que es lo que faltaba:
 *  - BARRER UMBRALES sin una corrida completa por celda (`--min 0.80,0.85,0.91`).
 *  - Detectar DERIVA DE INFRAESTRUCTURA. Entre el baseline del 2026-08-04 y el
 *    del 2026-08-05, dos preguntas cross-scope cambiaron de alcance sin que
 *    ningún cambio de código las tocara (el proveedor de embeddings se había
 *    movido de Ollama local a la API). No lo vio nadie porque `recall@5` y
 *    `precision@gold` se promedian sobre las 72 con `expect_chunks`, y NINGUNA
 *    de esas es cross-scope: las dos métricas salieron idénticas al bit mientras
 *    el retrieval cross-scope se movía por debajo.
 *  - PERSISTIR el entailment del discriminador, que el camino normal descarta.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval retrieval-guard                    # umbral actual
 *   pnpm --filter @tutor-ia/eval retrieval-guard -- --min 0.80,0.85,0.91
 *   pnpm --filter @tutor-ia/eval retrieval-guard -- --todas         # las 101, no solo las 24
 */
import { readFile, writeFile } from "node:fs/promises";
import { getTeachingContext, isStruggling } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { recallPorCobertura, resolverAnclas, type ChunkLite, type GoldAnchor } from "./lib/gold-anchors";
import { citationPrecision, recallAtK } from "./lib/metrics";

interface Golden {
  id: string;
  type: string;
  expect_chunks?: string[];
  question?: string;
  q?: string;
  expect_mode?: string;
  expect_scope?: string;
}

const argv = process.argv.slice(2);
const flag = (n: string): string | null => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
};
const todas = argv.includes("--todas");
/** Solo las que tienen ancla: es el subconjunto que mide RECALL, y correr 72 en
 *  vez de 101 hace que barrer un parámetro cueste minutos en vez de una tarde. */
const soloGold = argv.includes("--gold");

const umbrales = (flag("min") ?? process.env.RAG_ANSWERABILITY_MIN ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function main(): Promise<void> {
  const raw = await readFile(
    new URL("../golden/questions.jsonl", import.meta.url), "utf8",
  );
  const golden: Golden[] = raw.trim().split("\n").map((l) => JSON.parse(l) as Golden);
  const preguntas = soloGold
    ? golden.filter((g) => g.expect_chunks?.length)
    : todas ? golden : golden.filter((g) => g.expect_mode);

  const sql = getSql();
  const userId = process.env.EVAL_USER_ID!;
  const subjectId = process.env.EVAL_SUBJECT_ID!;
  const [perfil, familia] = await Promise.all([
    sql<{ grade: string | null }[]>`
      select grade from student_profiles where user_id = ${userId}::uuid`,
    sql<{ id: string }[]>`
      select s2.id from subjects s1 join subjects s2 on s2.family = s1.family
      where s1.id = ${subjectId}::uuid and s1.family is not null
        and s2.disabled_at is null and (s2.user_id is null or s2.user_id = ${userId}::uuid)`,
  ]);
  const studentGrade = perfil[0]?.grade ?? null;
  const familyIds = familia.length ? familia.map((r) => r.id) : null;

  console.log(
    `🔎 Guarda de retrieval — ${preguntas.length} preguntas · SIN generación\n` +
      `   curso ${studentGrade ?? "(sin perfil)"} · familia ${familyIds?.length ?? 0} cursos · ` +
      `answerability=${process.env.RAG_ANSWERABILITY === "1" ? "ON" : "off"}\n` +
      `   umbrales: ${umbrales.length ? umbrales.join(" · ") : "(el del entorno)"}\n`,
  );

  // Anclas por texto: recall@5 y precision@gold necesitan saber cuáles son los
  // chunks gold, y los uuids del jsonl no sobreviven a un re-chunk. Sin esto,
  // este guard no podría medir el paso 4 de la Fase 1 — que es justamente el que
  // reescribe los chunks.
  const goldPorPregunta = new Map<string, string[]>();
  const anclasPorPregunta = new Map<string, GoldAnchor[]>();
  try {
    const anclas = (await readFile(
      new URL("../golden/gold-anchors.jsonl", import.meta.url), "utf8",
    )).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as GoldAnchor);
    const corpus = await sql<ChunkLite[]>`
      select c.id, c.content, d.title as "documentTitle"
      from chunks c join documents d on d.id = c.document_id
      where d.title = any(${[...new Set(anclas.map((a) => a.documentTitle))]})`;
    for (const g of golden) {
      const mias = anclas.filter((a) => a.questionId === g.id);
      if (mias.length) {
        goldPorPregunta.set(g.id, resolverAnclas(mias, corpus).ids);
        anclasPorPregunta.set(g.id, mias);
      }
    }
    console.log(`   anclas por texto: ${goldPorPregunta.size} preguntas\n`);
  } catch {
    for (const g of golden) if (g.expect_chunks?.length) goldPorPregunta.set(g.id, g.expect_chunks);
    console.log(`   sin gold-anchors.jsonl: se usan los uuids del jsonl\n`);
  }

  const celdas = umbrales.length ? umbrales : [null];
  const salida: unknown[] = [];

  for (const u of celdas) {
    if (u) process.env.RAG_ANSWERABILITY_MIN = u;
    const filas: {
      id: string; type: string; mode: string; scope: string;
      topScore: number; entail: number | null; ok: boolean | null;
      recall: number | null; precision: number | null; cobertura: number | null;
    }[] = [];
    for (const g of preguntas) {
      const q = g.question ?? g.q ?? "";
      const res = await getTeachingContext({
        userId, subjectId, question: q, history: [],
        struggling: isStruggling(q), familyIds, studentGrade,
      });
      const ctx = res.ctx;
      const hay = (ctx?.citable.length ?? 0) > 0;
      const mode = hay ? "libro" : "general";
      const scope = ctx?.scope ?? "ninguno";
      const ok = g.expect_mode
        ? mode === g.expect_mode && (!g.expect_scope || scope === g.expect_scope)
        : null;
      // recall@5 / precision@gold sobre lo que el RANKING trajo (`retrieved`),
      // no sobre `citable`: calcularlos post-gate hace que aflojar el gate suba
      // el recall solo, sin que el ranking haya mejorado en nada (HANDOFF §7).
      const gold = goldPorPregunta.get(g.id) ?? [];
      const traidos = (ctx?.retrieved ?? []).map((c) => c.chunkId);
      const recall = gold.length ? recallAtK(traidos, gold, 5) : null;
      // Invariante al chunking: cuánto del PASAJE quedó dentro del top-5.
      const mias = anclasPorPregunta.get(g.id);
      const cobertura = mias?.length
        ? recallPorCobertura(mias, (ctx?.retrieved ?? []).map((c) => ({ id: c.chunkId, content: c.content })), 5)
        : null;
      const precision = gold.length
        ? citationPrecision(traidos.slice(0, Math.max(1, gold.length)), gold)
        : null;
      filas.push({
        id: g.id, type: g.type, mode, scope,
        topScore: Number((ctx?.topScore ?? 0).toFixed(4)),
        entail: ctx?.answerabilityEntail ?? null,
        ok, recall, precision, cobertura,
      });
      process.stdout.write(ok === false ? "✗" : ok === true ? "·" : "-");
    }
    const conModo = filas.filter((f) => f.ok !== null);
    const bien = conModo.filter((f) => f.ok).length;
    const conRecall = filas.filter((f) => f.recall != null);
    const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    console.log(
      `\n   min=${u ?? "(entorno)"} → correct_mode ${bien}/${conModo.length} = ` +
        `${((bien / Math.max(1, conModo.length)) * 100).toFixed(1)}%`,
    );
    if (conRecall.length) {
      console.log(
        `      recall@5 ${(100 * media(conRecall.map((f) => f.recall!))).toFixed(1)}% · ` +
          `precision@gold ${(100 * media(conRecall.map((f) => f.precision!))).toFixed(1)}% ` +
          `(sobre ${conRecall.length} preguntas con gold)`,
      );
      const conCob = filas.filter((f) => f.cobertura != null);
      if (conCob.length) {
        console.log(
          `      ⭐ recall por COBERTURA del pasaje: ${(100 * media(conCob.map((f) => f.cobertura!))).toFixed(1)}%` +
            `   ← invariante al chunking; es el comparable entre cortes distintos`,
        );
      }
    }
    const mal = conModo.filter((f) => !f.ok);
    for (const m of mal) {
      const g = preguntas.find((p) => p.id === m.id)!;
      console.log(
        `      ✗ ${m.id} ${m.type}: dio ${m.mode}/${m.scope} (score ${m.topScore}` +
          `${m.entail != null ? `, entail ${m.entail.toFixed(3)}` : ""}) · esperaba ${g.expect_mode}/${g.expect_scope ?? "*"}`,
      );
    }
    salida.push({ min: u, correctMode: bien / Math.max(1, conModo.length), filas });
  }

  const out = "retrieval-guard.json";
  await writeFile(out, JSON.stringify(salida, null, 2));
  console.log(`\n💾 ${out} — incluye el entailment por pregunta (el camino normal lo descarta).`);
}

await main();
process.exit(0);
