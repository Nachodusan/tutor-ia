/**
 * Runner del eval harness — Fase 1 (§9). `pnpm eval`.
 *
 * Corre el golden set (golden/questions.jsonl, o el path por argv, o el
 * .example por defecto) por el PIPELINE REAL de core y reporta las métricas del
 * §9.2 contra sus objetivos.
 *
 * ⚠️  REQUIERE ENTORNO COMPLETO, no corre en seco:
 *   - Postgres (DATABASE_URL) con los PDFs del golden YA INGESTADOS. El retrieval
 *     real consulta la base; sin ella, falla con mensaje claro (no se puede
 *     evaluar contra un corpus que no existe).
 *   - Ollama corriendo (OLLAMA_BASE_URL) con el modelo de tareas disponible.
 *   - EVAL_USER_ID: uuid del usuario dueño de los PDFs ingestados (el retrieval
 *     filtra por usuario). EVAL_SUBJECT_ID es opcional.
 *
 * Cada pregunta produce un PerQuestionResult:
 *   - retrievedIds = ctx.chunks.map(c => c.chunkId)
 *   - abstained    = !ctx.grounded  (o texto == ABSTENTION)
 *   - hallucinated = si NO se abstuvo, se re-pide la respuesta descompuesta en
 *     afirmaciones (CLAIMS_SCHEMA) y se verifica cada cita literal contra los
 *     chunks (verifyClaims). hallucinated = report.hasUnsupported.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAIMS_SCHEMA,
  TUTOR_SYSTEM,
  buildTutorUserTurn,
  chatText,
  chatJSON,
  getTutorContext,
  verifyClaims,
  verifyAnswerA3,
  checkFalsePremise,
  buildFalsePremiseDirective,
  type RawClaim,
} from "@tutor-ia/core";
import { entails } from "@tutor-ia/rag";
import { listModels } from "./ollama";
import {
  aggregate,
  type EvalMetrics,
  type PerQuestionResult,
} from "./lib/metrics";

/** Una línea del golden set (§9.1). */
interface GoldenQuestion {
  id: string;
  type: string;
  q: string;
  expect_chunks?: string[];
  expect_answer?: string;
  note?: string;
}

/** Objetivos del §9.2 (nombre legible, valor, comparador). */
interface Target {
  key: keyof EvalMetrics;
  label: string;
  goal: number;
  /** ">=" => métrica debe ser >= goal; "<=" => debe ser <= goal. */
  cmp: ">=" | "<=";
}

const TARGETS: Target[] = [
  { key: "recallAt5", label: "recall@5", goal: 0.9, cmp: ">=" },
  // precision@|gold| (proxy de ranking: ¿el reranker pone el gold arriba?). La
  // citation_precision "real" (¿el modelo citó la fuente correcta?) necesita las
  // citas verificadas del modelo → Fase 2 (A3 con el cross-encoder).
  { key: "citationPrecision", label: "precision@gold", goal: 0.8, cmp: ">=" },
  { key: "hallucinationRate", label: "hallucination_rate", goal: 0.02, cmp: "<=" },
  { key: "falseAbstentionRate", label: "false_abstention", goal: 0.1, cmp: "<=" },
  { key: "trueAbstentionRate", label: "true_abstention", goal: 0.95, cmp: ">=" },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(HERE, "../golden");

/** Resuelve el path del golden: argv > questions.jsonl > questions.example.jsonl. */
async function resolveGoldenPath(): Promise<string> {
  const arg = process.argv[2];
  if (arg) {
    return isAbsolute(arg)
      ? arg
      : resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  }
  const real = resolve(GOLDEN_DIR, "questions.jsonl");
  if (await exists(real)) return real;
  return resolve(GOLDEN_DIR, "questions.example.jsonl");
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** Parsea JSONL a mano (sin dependencias): una pregunta por línea no vacía. */
function parseJsonl(raw: string): GoldenQuestion[] {
  const out: GoldenQuestion[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as GoldenQuestion);
  }
  return out;
}

/**
 * Prompt de descomposición en afirmaciones (para la variante CLAIMS_SCHEMA).
 * Le pedimos que parta la respuesta en afirmaciones atómicas, cada una con su
 * cita LITERAL (substring exacto) del fragmento que la respalda y el número de
 * fragmento. verifyClaims luego confirma esa cita por string-match.
 */
function buildClaimsPrompt(
  context: string,
  question: string,
  answer: string,
): string {
  return `Descompón la RESPUESTA en afirmaciones atómicas. Para cada afirmación:
- "text": la afirmación en una frase.
- "quote": el substring EXACTO y LITERAL del fragmento que la respalda (copiado tal cual, sin parafrasear). Si es una inferencia tuya sin respaldo textual, dejá "quote" vacío.
- "chunkIndex": el número de fragmento (1-based) del que sale la cita.

No inventes citas: si el texto no está literal en ningún fragmento, dejá "quote" vacío.

=== FRAGMENTOS ===
${context}
=== PREGUNTA ===
${question}
=== RESPUESTA A DESCOMPONER ===
${answer}
=== FIN ===`;
}

/** ¿Correr la verificación de alucinación (necesita el LLM)? EVAL_HALLUCINATION=0 la apaga. */
const DO_HALLUCINATION = (process.env.EVAL_HALLUCINATION ?? "1") !== "0";

/** Umbral de entailment (A3) para rescatar paráfrasis que el string-match perdió. */
const ENTAIL_MIN = Number(process.env.EVAL_ENTAIL_MIN ?? "0.5");

export interface QResult extends PerQuestionResult {
  /** el LLM falló/timeout al verificar (no cuenta para hallucinationRate). */
  errored: boolean;
  /** Baseline A2-solo (string-match): alucinación ANTES del entailment A3. */
  hallucinatedA2Only: boolean;
  /** Veredicto del verificador de PRODUCCIÓN (verify.ts) sobre esta respuesta. */
  hallucinatedProd: boolean;
  /** false si el verificador prod no pudo correr para esta pregunta. */
  prodKnown: boolean;
}

async function runQuestion(
  gq: GoldenQuestion,
  userId: string,
  subjectId: string | null,
): Promise<QResult> {
  // 1) RETRIEVAL + GATE (rápido, sin LLM): base de recall/precisión/abstención.
  const ctx = await getTutorContext({ userId, subjectId, question: gq.q });
  const retrievedIds = ctx.chunks.map((c) => c.chunkId);
  const abstained = !ctx.grounded;
  const expectedIds = gq.expect_chunks ?? [];

  // 2) ALUCINACIÓN (opcional, con LLM): solo si respondió. Guardada por try/catch:
  //    un timeout del 7B marca la pregunta como no-evaluable, NO tira toda la corrida.
  let hallucinated = false;
  let hallucinatedA2Only = false;
  let hallucinatedProd = false;
  let prodKnown = false;
  let hallucinationKnown = false;
  let errored = false;
  if (!abstained && DO_HALLUCINATION) {
    try {
      const context = ctx.chunks
        .map((c, i) => `[Fragmento ${i + 1}]\n${c.content}`)
        .join("\n\n");
      // Replicar el flujo de PRODUCCIÓN: chequear premisa falsa y, si el material
      // la contradice, anteponer la directiva de corrección (si no, el eval no
      // mediría lo que el chat realmente hace ante false_premise).
      const premise = await checkFalsePremise(
        gq.q,
        ctx.chunks.map((c) => c.content),
      );
      const userTurn = premise.falsePremise
        ? `${buildFalsePremiseDirective(premise.premise!)}\n\n${buildTutorUserTurn(gq.q, context)}`
        : buildTutorUserTurn(gq.q, context);
      const answer = await chatText([
        { role: "system", content: TUTOR_SYSTEM },
        { role: "user", content: userTurn },
      ]);
      const raw = await chatJSON<{ claims: RawClaim[] }>(
        [
          { role: "system", content: TUTOR_SYSTEM },
          { role: "user", content: buildClaimsPrompt(context, gq.q, answer) },
        ],
        CLAIMS_SCHEMA,
        { temperature: 0 },
      );
      const chunkTexts = ctx.chunks.map((c) => c.content);
      const report = verifyClaims(raw.claims ?? [], chunkTexts);
      hallucinatedA2Only = report.hasUnsupported; // baseline string-match (antes de A3)
      // A3 (Fase 2): verificación híbrida. Una afirmación se considera respaldada
      // si la cita literal matchea (A2) O si el cross-encoder dice que algún chunk
      // la implica (entailment >= umbral). Esto rescata las paráfrasis fieles que
      // el string-match perdía (la causa del hallucination_rate 30% inflado).
      // Las "inferida" (sin cita) TAMBIÉN pasan por entailment: antes se saltaban
      // toda verificación y un invento declarado como inferencia pasaba limpio
      // (subestimaba la métrica — hallazgo de la auditoría).
      let unsupported = false;
      for (const c of report.claims) {
        if (c.label === "respaldada") continue; // cita literal ya verificada
        // Chunk citado si el modelo lo indicó y es válido; si no, todos.
        const candidates =
          c.chunkIndex && chunkTexts[c.chunkIndex - 1] != null
            ? [chunkTexts[c.chunkIndex - 1] as string]
            : chunkTexts;
        const score = await entails(c.text, candidates);
        if (score < ENTAIL_MIN) {
          unsupported = true;
          break; // basta una no respaldada para marcar alucinación
        }
      }
      hallucinated = unsupported;
      hallucinationKnown = true;

      // Métrica PROD: el MISMO verificador que corre en producción (verify.ts,
      // oraciones + entailment, sin claims del LLM), aplicado a la respuesta ya
      // generada. Mide lo que un estudiante recibiría — la brecha eval-vs-prod
      // se mide acá en vez de asumirse cerrada.
      const prodV = await verifyAnswerA3(answer, chunkTexts);
      if (!prodV.unavailable) {
        hallucinatedProd = !prodV.grounded;
        prodKnown = true;
      }
    } catch {
      errored = true; // timeout/fallo del LLM: no contamos esta para alucinación
    }
  }

  return {
    type: gq.type,
    retrievedIds,
    expectedIds,
    abstained,
    hallucinated,
    hallucinationKnown,
    errored,
    hallucinatedA2Only,
    hallucinatedProd,
    prodKnown,
  };
}

/** ¿Parece un fallo por falta de base de datos? Mensaje claro en ese caso. */
function looksLikeDbFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /DATABASE_URL/i.test(msg) ||
    /ECONNREFUSED|ENOTFOUND|connect|password|pg|postgres|match_chunks|relation|vector/i.test(
      msg,
    )
  );
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1).padStart(5)}%`;
}

function passes(t: Target, value: number): boolean {
  return t.cmp === ">=" ? value >= t.goal : value <= t.goal;
}

async function main() {
  console.log("\n🧪 Eval harness — Fase 1 (§9)");
  console.log(
    "   Requiere Postgres (PDFs del golden ingestados) + Ollama corriendo.\n",
  );

  const userId = process.env.EVAL_USER_ID;
  if (!userId) {
    console.error(
      "❌ Falta EVAL_USER_ID: el uuid del usuario dueño de los PDFs ingestados.\n" +
        "   El retrieval filtra por usuario; sin esto no hay contra qué medir.\n" +
        "   Ej: EVAL_USER_ID=xxxx-xxxx pnpm --filter @tutor-ia/eval eval",
    );
    process.exit(2);
  }
  const subjectId = process.env.EVAL_SUBJECT_ID ?? null;

  // Chequeo de vida de Ollama antes de gastar tiempo.
  const models = await listModels();
  if (models.length === 0) {
    console.error(
      `❌ Ollama no responde en ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}.\n` +
        "   Arrancá Ollama (ollama serve) y descargá el modelo de tareas antes de evaluar.",
    );
    process.exit(1);
  }

  const goldenPath = await resolveGoldenPath();
  const raw = await readFile(goldenPath, "utf8").catch(() => null);
  if (raw == null) {
    console.error(`❌ No pude leer el golden set en: ${goldenPath}`);
    process.exit(1);
  }
  const questions = parseJsonl(raw);
  console.log(`📋 Golden: ${goldenPath}`);
  console.log(`   Preguntas: ${questions.length}\n`);
  if (goldenPath.endsWith(".example.jsonl")) {
    console.log(
      "⚠️  Estás usando questions.example.jsonl (ids de chunk PLACEHOLDER).\n" +
        "   El recall/precisión no serán reales hasta que armes tu golden con\n" +
        "   chunk ids de TU corpus. Ver golden/README.md.\n",
    );
  }

  const results: QResult[] = [];
  for (const gq of questions) {
    process.stdout.write(`  · ${gq.id} [${gq.type}] ... `);
    let r: QResult;
    try {
      r = await runQuestion(gq, userId, subjectId);
    } catch (err) {
      if (looksLikeDbFailure(err)) {
        console.log("");
        console.error(
          "\n❌ Falló el retrieval contra Postgres.\n" +
            `   ${err instanceof Error ? err.message : String(err)}\n\n` +
            "   Este runner NO puede correr sin base de datos: necesita Postgres\n" +
            "   con los PDFs del golden ya ingestados. Configurá DATABASE_URL y\n" +
            "   asegurate de haber ingestado el corpus (ver golden/README.md).",
        );
        process.exit(1);
      }
      // Timeout transitorio del retrieval/gate (rerank u Ollama bajo carga): NO
      // debe tumbar toda la corrida (mismo criterio que el bloque de alucinación).
      // Se saltea la pregunta y se excluye del cómputo; se avisa.
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      if (
        name === "TimeoutError" ||
        name === "AbortError" ||
        /timeout|aborted/i.test(msg)
      ) {
        console.log(`⏱ timeout en retrieval — ${gq.id} saltada (excluida)`);
        continue;
      }
      throw err;
    }
    console.log(
      `${r.abstained ? "abstuvo" : "respondió"}` +
        `${!r.abstained && r.hallucinated ? " · ⚠ ALUCINÓ" : ""}` +
        `${r.errored ? " · ⏱ LLM error (no evaluada)" : ""}` +
        ` · ${r.retrievedIds.length} chunks`,
    );
    results.push(r);
  }

  const erroredCount = results.filter((r) => r.errored).length;
  if (erroredCount > 0) {
    console.log(
      `\n⏱  ${erroredCount}/${results.length} preguntas no se pudieron verificar por` +
        " timeout/fallo del LLM (excluidas de hallucination_rate).",
    );
  }

  const metrics = aggregate(results);

  // A/B del entailment A3 sobre las MISMAS generaciones del LLM: comparamos la
  // tasa de alucinación con verificación A2-solo (string-match) vs híbrida A2+A3.
  const evaluable = results.filter(
    (r) => !r.abstained && r.hallucinationKnown !== false && !r.errored,
  );
  const rateOf = (pick: (r: QResult) => boolean) =>
    evaluable.length === 0
      ? 0
      : evaluable.filter(pick).length / evaluable.length;
  const hallA2 = rateOf((r) => r.hallucinatedA2Only);
  const hallHybrid = rateOf((r) => r.hallucinated);
  const prodEvaluable = evaluable.filter((r) => r.prodKnown);
  const hallProd =
    prodEvaluable.length === 0
      ? 0
      : prodEvaluable.filter((r) => r.hallucinatedProd).length /
        prodEvaluable.length;
  console.log(
    `\n🔬 A3 entailment (umbral ${ENTAIL_MIN}) — mismas generaciones:\n` +
      `   hallucination_rate  A2-solo (string-match):   ${fmtPct(hallA2)}\n` +
      `   hallucination_rate  A2+A3 (claims, +inferida): ${fmtPct(hallHybrid)}\n` +
      `   hallucination_rate  PROD (verify.ts, oraciones): ${fmtPct(hallProd)} (n=${prodEvaluable.length})\n` +
      `   Δ claims = ${fmtPct(hallHybrid - hallA2)}  (sobre ${evaluable.length} respuestas evaluables)\n` +
      `   La fila PROD es el verificador que corre en el chat real — lo que un\n` +
      `   estudiante recibiría marcado. Divergencia claims-vs-prod = brecha a vigilar.`,
  );

  // Tabla final contra objetivos §9.2.
  console.log("\n📊 Métricas vs. objetivos (§9.2):");
  console.log("   ┌──────────────────────┬─────────┬──────────┬──────┐");
  console.log("   │ métrica              │  valor  │ objetivo │  ok  │");
  console.log("   ├──────────────────────┼─────────┼──────────┼──────┤");
  let allOk = true;
  for (const t of TARGETS) {
    const value = metrics[t.key];
    const ok = passes(t, value);
    if (!ok) allOk = false;
    const label = t.label.padEnd(20);
    const goal = `${t.cmp}${(t.goal * 100).toFixed(0)}%`.padStart(8);
    console.log(
      `   │ ${label} │ ${fmtPct(value)}  │ ${goal} │  ${ok ? "✅" : "❌"}  │`,
    );
  }
  console.log("   └──────────────────────┴─────────┴──────────┴──────┘");
  console.log(
    `\n${allOk ? "✅ Todos los objetivos cumplidos." : "❌ Hay objetivos sin cumplir (calibrá RAG_MIN_SIMILARITY, ver §9.3)."}\n`,
  );

  const outPath = resolve(process.env.INIT_CWD ?? process.cwd(), "eval-results.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        golden: goldenPath,
        model: process.env.LLM_MODEL ?? "qwen2.5:7b-instruct",
        minSimilarity: process.env.RAG_MIN_SIMILARITY ?? "(default core)",
        userId,
        subjectId,
        metrics,
        targets: TARGETS.map((t) => ({
          key: t.key,
          goal: t.goal,
          cmp: t.cmp,
          value: metrics[t.key],
          ok: passes(t, metrics[t.key]),
        })),
        allOk,
        perQuestion: questions.map((gq, i) => ({ ...gq, result: results[i] })),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`💾 Resultados guardados en: ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
