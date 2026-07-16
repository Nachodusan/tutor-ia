/**
 * EXPERIMENTO #5 (Fase 2, Eje "correcto") — de-risking head-to-head.
 *
 * Prueba, con el MISMO rigor que el eje "fundamentado", si la maquinaria del §4
 * levanta las dos capacidades que el exp2 dejó reprobadas:
 *
 *   GRADING:  holístico (baseline exp2 78%, falla por severidad)
 *             vs DESCOMPUESTO (checks binarios por punto clave).
 *   MATH:     7B directo (baseline exp2 ~75%)
 *             vs 7B→SymPy (el modelo traduce, el CAS calcula exacto).
 *             Scoring por equivalencia SIMBÓLICA (atrapa los 2 artefactos del exp2).
 *
 * Casos: packages/eval/cases/{grading,math}.jsonl (los mismos del exp2).
 * Uso:  pnpm --filter @tutor-ia/eval exp5   (requiere Ollama + venv con sympy)
 */
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGradingPrompt,
  gradeDecomposed,
  GRADING_SCHEMA,
  type Exam,
  type ExamQuestion,
  type GradingResult,
  type StudentAnswer,
} from "@tutor-ia/core";
import { generate, listModels } from "./ollama";
import { answerMatches, pct } from "./lib/score";

const execFileAsync = promisify(execFile);
const MODEL = process.env.LLM_MODEL ?? "qwen2.5:7b";
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = resolve(HERE, "../cases");
const REPO = resolve(HERE, "../../..");
const PY = process.env.INGEST_PY_BIN ?? resolve(REPO, "packages/ingest-py/.venv/bin/python");
const SYMPY = resolve(REPO, "packages/ingest-py/sympy_check.py");

interface GradingCase {
  id: string;
  question: ExamQuestion;
  studentAnswer: string;
  gold: { correct: boolean; score: number };
}
interface MathCase { id: string; problem: string; expect_answer: string }

async function readJsonl<T>(f: string): Promise<T[]> {
  const raw = await readFile(f, "utf8");
  return raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** Llama al puente SymPy (una invocación por request). Nunca tira. */
async function sympy(req: object): Promise<any> {
  try {
    const { stdout } = await execFileAsync(PY, [SYMPY, JSON.stringify(req)], {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (e) {
    return { ok: false, equal: false, error: String(e) };
  }
}

/** ¿pred ≡ gold? Primero SymPy (equivalencia simbólica), luego match textual. */
async function correctMath(pred: string, gold: string): Promise<boolean> {
  const r = await sympy({ mode: "equiv", a: pred, b: gold });
  if (r.equal) return true;
  return answerMatches(pred, gold); // fallback textual/numérico
}

function extractFinal(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1]! : "";
}

// ---- GRADING: holístico vs descompuesto -------------------------------------
async function runGrading() {
  const cases = await readJsonl<GradingCase>(resolve(CASES, "grading.jsonl"));
  let holOk = 0, decOk = 0, holFN = 0, decFN = 0;
  let holMae = 0, decMae = 0;

  for (const c of cases) {
    // Holístico (baseline exp2)
    const exam: Exam = { title: c.id, difficulty: "medium", questions: [c.question] };
    const answers: StudentAnswer[] = [{ questionId: c.question.id, response: c.studentAnswer }];
    let holCorrect: boolean | null = null, holScore = 0;
    try {
      const g = JSON.parse(
        (await generate(buildGradingPrompt({ examJson: JSON.stringify(exam), answersJson: JSON.stringify(answers) }),
          { model: MODEL, temperature: 0, format: GRADING_SCHEMA })).text,
      ) as GradingResult;
      holCorrect = g.perQuestion?.[0]?.correct ?? null;
      holScore = g.perQuestion?.[0]?.score ?? 0;
    } catch { holCorrect = null; }

    // Descompuesto (nuevo)
    const dec = await gradeDecomposed({
      prompt: c.question.prompt,
      reference: c.question.answer ?? "",
      rubric: c.question.rubric,
      studentAnswer: c.studentAnswer,
    });

    const holHit = holCorrect !== null && holCorrect === c.gold.correct;
    const decHit = dec.correct === c.gold.correct;
    if (holHit) holOk++;
    if (decHit) decOk++;
    // Falso negativo = gold correcta pero marcada incorrecta (el sesgo del exp2).
    if (c.gold.correct && holCorrect === false) holFN++;
    if (c.gold.correct && dec.correct === false) decFN++;
    if (holCorrect !== null) holMae += Math.abs(holScore - c.gold.score);
    decMae += Math.abs(dec.score - c.gold.score);

    console.log(
      `  [${c.id}] gold=${c.gold.correct}/${c.gold.score}  holístico=${holCorrect}/${holScore.toFixed(2)} ${holHit ? "✅" : "❌"}  ` +
      `descomp=${dec.correct}/${dec.score.toFixed(2)} (${dec.covered.filter(Boolean).length}/${dec.points.length}pts) ${decHit ? "✅" : "❌"}`,
    );
  }
  const n = cases.length;
  return { n, holOk, decOk, holFN, decFN, holMae: holMae / n, decMae: decMae / n };
}

// ---- MATH: 7B directo vs 7B→SymPy -------------------------------------------
async function runMath() {
  const cases = await readJsonl<MathCase>(resolve(CASES, "math.jsonl"));
  let direct = 0, cas = 0, transFail = 0;

  for (const c of cases) {
    // 7B directo (baseline), scoreado por equivalencia simbólica
    const dr = await generate(
      `Resolvé el problema. Devolvé SOLO la respuesta final, en una línea, sin pasos.\n\nProblema: ${c.problem}`,
      { model: MODEL, temperature: 0 },
    );
    const predDirect = extractFinal(dr.text);
    const directOk = await correctMath(predDirect, c.expect_answer);
    if (directOk) direct++;

    // 7B→SymPy: el modelo TRADUCE a una expresión, el CAS calcula
    const tr = await generate(
      `Traducí el problema a UNA expresión de SymPy (sintaxis Python) que calcule la respuesta final. ` +
        `Usá limit(expr, x, punto), diff(expr, x), integrate(expr, x), etc. La variable es x salvo indicación. ` +
        `Devolvé SOLO la expresión en una línea, sin explicación ni comillas.\n\nProblema: ${c.problem}`,
      { model: MODEL, temperature: 0 },
    );
    const expr = extractFinal(tr.text).replace(/^`+|`+$/g, "");
    const ev = await sympy({ mode: "eval", expr });
    let casOk = false;
    if (ev.ok) casOk = await correctMath(String(ev.value), c.expect_answer);
    else transFail++;
    if (casOk) cas++;

    console.log(
      `  [${c.id}] gold="${c.expect_answer}"  directo="${predDirect}" ${directOk ? "✅" : "❌"}  ` +
      `sympy(${expr})=${ev.ok ? ev.value : "ERR"} ${casOk ? "✅" : "❌"}`,
    );
  }
  return { n: cases.length, direct, cas, transFail };
}

async function main() {
  console.log(`\n🧪 EXP #5 — Eje "correcto" (de-risking). Modelo: ${MODEL}\n`);
  if ((await listModels()).length === 0) throw new Error("Ollama no responde.");

  console.log("▶ GRADING — holístico (baseline) vs descompuesto");
  const g = await runGrading();
  console.log("\n▶ MATH — 7B directo (baseline) vs 7B→SymPy");
  const m = await runMath();

  console.log(`\n${"═".repeat(64)}\nRESUMEN — Eje "correcto"\n${"═".repeat(64)}`);
  console.log(`GRADING (n=${g.n}, gate ≥80%):`);
  console.log(`   holístico:   ${g.holOk}/${g.n} = ${pct(g.holOk, g.n)}  · falsos neg: ${g.holFN} · MAE score: ${g.holMae.toFixed(2)}   (baseline exp2: 78%)`);
  console.log(`   DESCOMPUESTO:${g.decOk}/${g.n} = ${pct(g.decOk, g.n)}  · falsos neg: ${g.decFN} · MAE score: ${g.decMae.toFixed(2)}`);
  console.log(`MATH (n=${m.n}, gate ≥80%):`);
  console.log(`   7B directo:  ${m.direct}/${m.n} = ${pct(m.direct, m.n)}   (baseline exp2: ~75%; ahora con scoring SymPy)`);
  console.log(`   7B→SymPy:    ${m.cas}/${m.n} = ${pct(m.cas, m.n)}   · traducciones fallidas: ${m.transFail}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
