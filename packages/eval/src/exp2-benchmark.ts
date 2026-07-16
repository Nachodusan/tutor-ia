/**
 * EXPERIMENTO #2 (Fase −1, §10) — Benchmark del MODELO DE TAREAS (LLM_MODEL)
 * corriendo local en Ollama, en 4 suites que ejercitan las capacidades que el
 * producto necesita:
 *
 *   GROUNDING — el tutor responde SOLO desde el material y SE ABSTIENE cuando no
 *               está (Eje A). Para los casos respondibles, además descompone la
 *               respuesta en afirmaciones con cita literal y las verifica por
 *               string-match (A2) con verifyClaims().
 *   EXAM      — genera exámenes estructurados válidos (chequeos automáticos de
 *               forma). La CALIDAD real se califica a mano: cada examen se vuelca
 *               a exp2-exam-review.txt.
 *   GRADING   — corrige respuestas de alumno y acierta el veredicto correct/incorrect.
 *   MATH      — resuelve problemas cerrados y da la respuesta final correcta.
 *               (La ruta simbólica SymPy de Eje B llega en Fase 2; acá es match textual/numérico.)
 *
 * NO usa base de datos ni retrieval: el contexto viene EMBEBIDO en cada caso
 * (packages/eval/cases/*.jsonl). Si Ollama no está corriendo, falla con un mensaje claro.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval exp2
 *   LLM_MODEL=qwen2.5:14b-instruct pnpm --filter @tutor-ia/eval exp2
 *
 * Criterio §10: una suite "pasa" si su score >= 80%.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TUTOR_SYSTEM,
  ABSTENTION,
  buildTutorUserTurn,
  buildExamGenerationPrompt,
  buildGradingPrompt,
  EXAM_SCHEMA,
  GRADING_SCHEMA,
  CLAIMS_SCHEMA,
  verifyClaims,
  type Exam,
  type ExamQuestion,
  type GradingResult,
  type StudentAnswer,
} from "@tutor-ia/core";
import { generate, listModels } from "./ollama";
import { answerMatches, pct } from "./lib/score";

const MODEL = process.env.LLM_MODEL ?? "qwen2.5:7b-instruct";
const PASS_THRESHOLD = 0.8; // §10: >= 80%

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = resolve(HERE, "../cases");
const OUT_DIR = resolve(HERE, ".."); // raíz del paquete @tutor-ia/eval

// --- Tipos de los casos (formatos EXACTOS acordados con el otro agente) --------
interface GroundingCase {
  id: string;
  type: "answerable" | "must_abstain";
  context: string;
  q: string;
}
interface ExamCase {
  id: string;
  context: string;
  numQuestions: number;
  difficulty: "easy" | "medium" | "hard";
}
interface GradingCase {
  id: string;
  question: ExamQuestion;
  studentAnswer: string;
  gold: { correct: boolean; score: number };
}
interface MathCase {
  id: string;
  problem: string;
  expect_answer: string;
}

interface SuiteResult {
  suite: string;
  correct: number;
  total: number;
  score: number; // 0..1
  passed: boolean; // score >= 80%
  /** métrica extra específica de la suite (p.ej. tasa media de citas verificadas). */
  extra?: Record<string, number>;
}

/**
 * Lee un .jsonl parseando a mano (una línea JSON por caso). Devuelve null si el
 * archivo todavía no existe (los casos los escribe otro agente en paralelo).
 */
async function readJsonl<T>(file: string): Promise<T[] | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const out: T[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`JSON inválido en ${file}:${i + 1}`);
    }
  }
  return out;
}

/** Detecta abstención: el texto incluye una parte significativa de ABSTENTION. */
function isAbstention(text: string): boolean {
  const t = text.toLowerCase();
  // Fragmentos canónicos de ABSTENTION (§ prompts.ts).
  const marker1 = "no encontré esa información en tu material".toLowerCase();
  const marker2 = "no puedo responder".toLowerCase();
  const abst = ABSTENTION.toLowerCase();
  return t.includes(marker1) || t.includes(marker2) || t.includes(abst.slice(0, 40));
}

// --- Suite GROUNDING ----------------------------------------------------------
async function runGrounding(): Promise<SuiteResult | null> {
  const cases = await readJsonl<GroundingCase>(resolve(CASES_DIR, "grounding.jsonl"));
  if (cases === null) return null;

  let correct = 0;
  const verifiedRatios: number[] = []; // tasa de citas verificadas por caso respondible

  for (const c of cases) {
    const r = await generate(buildTutorUserTurn(c.q, c.context), {
      model: MODEL,
      system: TUTOR_SYSTEM,
      temperature: 0,
    });
    const abstained = isAbstention(r.text);

    if (c.type === "must_abstain") {
      if (abstained) correct++;
      console.log(
        `   [${c.id}] must_abstain → ${abstained ? "✅ se abstuvo" : "❌ RESPONDIÓ (inventó)"}`,
      );
    } else {
      // answerable: correcto si NO se abstuvo.
      if (!abstained) correct++;
      // Segunda llamada: respuesta descompuesta en afirmaciones con cita literal (A2).
      let ratioStr = "sin claims";
      if (!abstained) {
        const claimsPrompt =
          `Respondé la pregunta usando SOLO el material de abajo. Luego descomponé tu ` +
          `respuesta en afirmaciones individuales. Para CADA afirmación incluí "quote": el ` +
          `substring LITERAL y EXACTO del material que la respalda (copiado tal cual, sin ` +
          `parafrasear) y "chunkIndex": 1 (hay un solo fragmento). Devolvé JSON {claims:[...]}.\n\n` +
          `=== MATERIAL ===\n${c.context}\n=== FIN ===\n\nPregunta: ${c.q}`;
        const cr = await generate(claimsPrompt, {
          model: MODEL,
          system: TUTOR_SYSTEM,
          temperature: 0,
          format: CLAIMS_SCHEMA,
        });
        const rawClaims = parseClaims(cr.text);
        const report = verifyClaims(rawClaims, [c.context]);
        verifiedRatios.push(report.supportedRatio);
        ratioStr = `citas verificadas ${pct(
          report.claims.filter((cl) => cl.quoteVerified).length,
          report.claims.length,
        )}`;
      }
      console.log(
        `   [${c.id}] answerable → ${!abstained ? "✅ respondió" : "❌ se abstuvo de más"} · ${ratioStr}`,
      );
    }
  }

  const meanVerified =
    verifiedRatios.length === 0
      ? 0
      : verifiedRatios.reduce((a, b) => a + b, 0) / verifiedRatios.length;

  const score = correct / cases.length;
  return {
    suite: "GROUNDING",
    correct,
    total: cases.length,
    score,
    passed: score >= PASS_THRESHOLD,
    extra: { tasaMediaCitasVerificadas: meanVerified },
  };
}

/** Parsea {claims:[{text,quote?,chunkIndex?}]} de forma defensiva. */
function parseClaims(
  text: string,
): { text: string; quote?: string; chunkIndex?: number }[] {
  try {
    const j = JSON.parse(text) as {
      claims?: { text?: string; quote?: string; chunkIndex?: number }[];
    };
    const arr = j.claims ?? [];
    return arr
      .filter((c): c is { text: string; quote?: string; chunkIndex?: number } =>
        typeof c.text === "string",
      )
      .map((c) => ({ text: c.text, quote: c.quote, chunkIndex: c.chunkIndex }));
  } catch {
    return [];
  }
}

// --- Suite EXAM ---------------------------------------------------------------
async function runExam(examReviewLines: string[]): Promise<SuiteResult | null> {
  const cases = await readJsonl<ExamCase>(resolve(CASES_DIR, "exam.jsonl"));
  if (cases === null) return null;

  let passed = 0;
  for (const c of cases) {
    const prompt = buildExamGenerationPrompt({
      context: c.context,
      numQuestions: c.numQuestions,
      difficulty: c.difficulty,
      types: ["mcq", "true_false", "open"],
    });
    const r = await generate(prompt, {
      model: MODEL,
      temperature: 0,
      format: EXAM_SCHEMA,
    });

    const check = checkExamStructure(r.text);
    if (check.ok) passed++;
    console.log(
      `   [${c.id}] ${check.ok ? "✅" : "❌"} ${check.reason} (${check.numQuestions} preguntas)`,
    );

    // Volcado para calificación MANUAL de la calidad real.
    examReviewLines.push(
      `${"═".repeat(72)}\nCASO ${c.id} · dificultad ${c.difficulty} · pedidas ${c.numQuestions}\n` +
        `${"─".repeat(72)}\nCONTEXTO:\n${c.context}\n` +
        `${"─".repeat(72)}\nEXAMEN GENERADO (${check.ok ? "estructura OK" : "estructura FALLA: " + check.reason}):\n` +
        `${check.pretty ?? r.text}\n`,
    );
  }

  const score = passed / cases.length;
  return {
    suite: "EXAM",
    correct: passed,
    total: cases.length,
    score,
    passed: score >= PASS_THRESHOLD,
  };
}

/** Chequeos estructurales del examen generado. */
function checkExamStructure(text: string): {
  ok: boolean;
  reason: string;
  numQuestions: number;
  pretty?: string;
} {
  let exam: Exam;
  try {
    exam = JSON.parse(text) as Exam;
  } catch {
    return { ok: false, reason: "JSON no parseable", numQuestions: 0 };
  }
  const pretty = JSON.stringify(exam, null, 2);
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  if (questions.length === 0) {
    return { ok: false, reason: "sin preguntas", numQuestions: 0, pretty };
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || typeof q.answer !== "string" || q.answer.trim() === "") {
      return {
        ok: false,
        reason: `pregunta ${i} sin 'answer'`,
        numQuestions: questions.length,
        pretty,
      };
    }
    if (q.type === "mcq" && (!Array.isArray(q.options) || q.options.length === 0)) {
      return {
        ok: false,
        reason: `mcq ${i} sin 'options'`,
        numQuestions: questions.length,
        pretty,
      };
    }
  }
  return { ok: true, reason: "estructura válida", numQuestions: questions.length, pretty };
}

// --- Suite GRADING ------------------------------------------------------------
async function runGrading(): Promise<SuiteResult | null> {
  const cases = await readJsonl<GradingCase>(resolve(CASES_DIR, "grading.jsonl"));
  if (cases === null) return null;

  let correct = 0;
  for (const c of cases) {
    const exam: Exam = {
      title: `Corrección ${c.id}`,
      difficulty: "medium",
      questions: [c.question],
    };
    const answers: StudentAnswer[] = [
      { questionId: c.question.id, response: c.studentAnswer },
    ];
    const r = await generate(
      buildGradingPrompt({
        examJson: JSON.stringify(exam),
        answersJson: JSON.stringify(answers),
      }),
      { model: MODEL, temperature: 0, format: GRADING_SCHEMA },
    );

    let predCorrect: boolean | null = null;
    try {
      const g = JSON.parse(r.text) as GradingResult;
      const first = g.perQuestion?.[0];
      predCorrect = first ? first.correct : null;
    } catch {
      predCorrect = null;
    }

    const ok = predCorrect !== null && predCorrect === c.gold.correct;
    if (ok) correct++;
    console.log(
      `   [${c.id}] esperado correct=${c.gold.correct} · predicho=${
        predCorrect === null ? "PARSE-ERROR" : predCorrect
      } → ${ok ? "✅" : "❌"}`,
    );
  }

  const score = correct / cases.length;
  return {
    suite: "GRADING",
    correct,
    total: cases.length,
    score,
    passed: score >= PASS_THRESHOLD,
  };
}

// --- Suite MATH ---------------------------------------------------------------
async function runMath(): Promise<SuiteResult | null> {
  const cases = await readJsonl<MathCase>(resolve(CASES_DIR, "math.jsonl"));
  if (cases === null) return null;

  let correct = 0;
  for (const c of cases) {
    const r = await generate(
      `Resolvé el siguiente problema. Devolvé SOLO la respuesta final, sin ` +
        `explicación ni pasos, en una sola línea.\n\nProblema: ${c.problem}`,
      { model: MODEL, temperature: 0 },
    );
    const pred = extractFinalAnswer(r.text);
    const ok = answerMatches(pred, c.expect_answer);
    if (ok) correct++;
    console.log(
      `   [${c.id}] esperado="${c.expect_answer}" · predicho="${pred}" → ${ok ? "✅" : "❌"}`,
    );
  }

  const score = correct / cases.length;
  return {
    suite: "MATH",
    correct,
    total: cases.length,
    score,
    passed: score >= PASS_THRESHOLD,
  };
}

/** Extrae la respuesta final: última línea no vacía del texto del modelo. */
function extractFinalAnswer(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.length === 0 ? "" : (lines[lines.length - 1] as string);
}

// --- Main ---------------------------------------------------------------------
async function main() {
  console.log(`\n🧪 EXPERIMENTO #2 — Benchmark del modelo de tareas`);
  console.log(`   Modelo (LLM_MODEL): ${MODEL}`);
  console.log(`   Casos en: ${CASES_DIR}\n`);

  // Precondición: Ollama vivo y modelo disponible.
  const available = await listModels();
  if (available.length === 0) {
    throw new Error(
      `Ollama no responde en ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}. ` +
        `Arrancá el servidor con 'ollama serve' antes de correr este benchmark.`,
    );
  }
  if (!available.includes(MODEL)) {
    throw new Error(
      `El modelo '${MODEL}' no está descargado en Ollama. ` +
        `Corré:  ollama pull ${MODEL}\n` +
        `Modelos disponibles: ${available.join(", ")}`,
    );
  }

  const examReviewLines: string[] = [];
  const results: SuiteResult[] = [];
  const skipped: string[] = [];

  const runners: { name: string; fn: () => Promise<SuiteResult | null> }[] = [
    { name: "GROUNDING", fn: runGrounding },
    { name: "EXAM", fn: () => runExam(examReviewLines) },
    { name: "GRADING", fn: runGrading },
    { name: "MATH", fn: runMath },
  ];

  for (const runner of runners) {
    console.log(`\n▶ Suite ${runner.name}`);
    const res = await runner.fn();
    if (res === null) {
      skipped.push(runner.name);
      console.log(`   ⚠️  Saltada: no existe cases/${runner.name.toLowerCase()}.jsonl todavía.`);
    } else {
      results.push(res);
    }
  }

  // Volcado de exámenes para revisión manual (aunque EXAM se haya saltado quedará vacío).
  const examReviewPath = resolve(OUT_DIR, "exp2-exam-review.txt");
  if (examReviewLines.length > 0) {
    await writeFile(examReviewPath, examReviewLines.join("\n"), "utf8");
  }

  // --- Tabla resumen ---
  console.log(`\n${"═".repeat(60)}`);
  console.log(`RESUMEN — modelo ${MODEL}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`${"Suite".padEnd(12)} ${"Score".padEnd(16)} Veredicto (≥80%)`);
  console.log(`${"─".repeat(60)}`);
  for (const r of results) {
    const scoreCol = `${r.correct}/${r.total} = ${pct(r.correct, r.total)}`;
    console.log(
      `${r.suite.padEnd(12)} ${scoreCol.padEnd(16)} ${r.passed ? "✅ PASA" : "❌ NO PASA"}`,
    );
    if (r.extra) {
      for (const [k, v] of Object.entries(r.extra)) {
        console.log(`   ↳ ${k}: ${(v * 100).toFixed(1)}%`);
      }
    }
  }
  if (skipped.length > 0) {
    console.log(`${"─".repeat(60)}`);
    console.log(`Saltadas (sin casos): ${skipped.join(", ")}`);
  }
  if (examReviewLines.length > 0) {
    console.log(`\n📝 Exámenes para calificar A MANO: ${examReviewPath}`);
  }

  // --- Persistir números ---
  const resultsPath = resolve(OUT_DIR, "exp2-results.json");
  await writeFile(
    resultsPath,
    JSON.stringify(
      {
        model: MODEL,
        date: new Date().toISOString(),
        threshold: PASS_THRESHOLD,
        suites: results,
        skipped,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n💾 Resultados en: ${resultsPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
