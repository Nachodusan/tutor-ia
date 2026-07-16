/**
 * EXPERIMENTO #3 (Fase −1, §8.2) — "La curva de prefill real, medida no estimada."
 *
 * Construye prompts de contexto de ~1000, ~2000 y ~4000 tokens (aprox 4 chars/token,
 * repitiendo un párrafo de relleno realista en español) + una pregunta corta, y mide
 * el PREFILL (prompt_eval_duration) para AMBOS modelos: el de tareas (7B) y el de voz
 * (3B). El prefill es el asesino de la latencia de voz: si tardás 1.5s en procesar el
 * contexto, el usuario ya colgó.
 *
 * Presupuesto de voz (§8.2):
 *   - prefill del 3B ≤ 600ms
 *   - primera oración hablada ≤ 400ms (time-to-first-token bajo)
 *
 * NO toca la base de datos: el contexto es relleno sintético embebido acá. Si Ollama
 * no responde, falla con un mensaje claro.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval exp3
 */
import { writeFile } from "node:fs/promises";
import { generate, listModels } from "./ollama";

const TASK_MODEL = process.env.LLM_MODEL ?? "qwen2.5:7b-instruct";
const VOICE_MODEL = process.env.LLM_VOICE_MODEL ?? "qwen2.5:3b-instruct";
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/** Tamaños objetivo de contexto en tokens (aprox 4 chars/token). */
const SIZES = [1000, 2000, 4000] as const;
const CHARS_PER_TOKEN = 4;
const NUM_CTX = 8192;
/** Corridas por combo: la primera es warm-up y se descarta. */
const REPS = 3;

/** Presupuesto §8.2 para el canal de voz. */
const BUDGET_PREFILL_MS = 600; // prefill del 3B
const BUDGET_FIRST_SENTENCE_MS = 400; // primera oración hablada
/** Aprox. de "primera oración": ~18 tokens generados. */
const FIRST_SENTENCE_TOKENS = 18;

/** Párrafo de relleno realista en español (temática educativa, como un apunte). */
const FILLER =
  "La fotosíntesis es el proceso mediante el cual las plantas, las algas y algunas " +
  "bacterias convierten la energía lumínica en energía química almacenada en forma de " +
  "glucosa. Ocurre principalmente en los cloroplastos, orgánulos que contienen clorofila, " +
  "el pigmento verde responsable de captar la luz solar. El proceso se divide en dos " +
  "fases: la fase luminosa, que depende de la luz y ocurre en los tilacoides, y la fase " +
  "oscura o ciclo de Calvin, que fija el dióxido de carbono en el estroma. Durante la fase " +
  "luminosa se produce oxígeno como subproducto de la ruptura de las moléculas de agua. ";

/** Construye un contexto de aproximadamente `targetTokens` tokens repitiendo el relleno. */
function buildContext(targetTokens: number): string {
  const targetChars = targetTokens * CHARS_PER_TOKEN;
  let ctx = "";
  while (ctx.length < targetChars) {
    ctx += FILLER;
  }
  return ctx.slice(0, targetChars);
}

/**
 * Prompt completo = contexto embebido + pregunta corta.
 *
 * `seed` hace ÚNICO el prompt desde el primer carácter. Es imprescindible: si
 * repitiéramos el mismo prompt, el KV-cache de Ollama saltearía el prefill y
 * mediríamos ~0ms (cache hit), no el prefill real. Con un prefijo distinto por
 * medición, el prefix-cache no matchea y el prefill se ejecuta de verdad.
 */
function buildPrompt(targetTokens: number, seed: string): string {
  const ctx = buildContext(targetTokens);
  return (
    `Nota de sesión ${seed}: material de estudio a continuación.\n` +
    `Contexto de estudio:\n${ctx}\n\n` +
    "Pregunta: En una sola oración breve, ¿qué gas se libera durante la fase luminosa?"
  );
}

interface MeasureRow {
  model: string;
  targetTokens: number;
  /** Tokens de prompt reales según Ollama (útil para verificar el ~4 chars/token). */
  promptTokens: number;
  prefillMs: number;
  promptTps: number;
  evalTps: number;
  /** ms para el primer token: prefill + tiempo de 1 token generado. */
  ttftMs: number;
  /** ms hasta terminar la primera oración (~18 tokens). */
  firstSentenceMs: number;
}

/** Promedio simple, tolerante a arrays vacíos. */
function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Mediana (más robusta a outliers que el promedio). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Asegura que el modelo esté cargado en RAM (paga load_duration una sola vez). */
async function warmModel(model: string): Promise<void> {
  await generate(buildPrompt(120, `warmup-${model}`), {
    model,
    numCtx: NUM_CTX,
    temperature: 0,
  });
}

/**
 * Mide REPS veces un combo (modelo × tamaño) con prompts ÚNICOS (sin cache hit).
 * El modelo ya está warm, así que promptEvalMs es prefill limpio (sin carga).
 * Reporta la MEDIANA.
 */
async function measure(model: string, targetTokens: number): Promise<MeasureRow> {
  const prefills: number[] = [];
  const promptTpsList: number[] = [];
  const evalTpsList: number[] = [];
  const promptTokensList: number[] = [];

  for (let rep = 0; rep < REPS; rep++) {
    // Prompt único por medición → el prefix-cache de Ollama no matchea.
    const prompt = buildPrompt(targetTokens, `${model}|${targetTokens}|rep${rep}`);
    const r = await generate(prompt, { model, numCtx: NUM_CTX, temperature: 0 });
    prefills.push(r.promptEvalMs);
    promptTpsList.push(r.promptTps);
    evalTpsList.push(r.evalTps);
    promptTokensList.push(r.promptTokens);
    // Señal de cache hit residual: prefill absurdamente rápido para el tamaño.
    if (r.promptTps > 5000) {
      console.log(
        `      ⚠ posible cache hit (${model}, ~${targetTokens}tok): ${r.promptTps.toFixed(0)} tok/s`,
      );
    }
  }

  const prefillMs = median(prefills);
  const promptTps = median(promptTpsList);
  const evalTps = median(evalTpsList);
  const promptTokens = Math.round(avg(promptTokensList));
  // TTFT ≈ prefill + tiempo de generar 1 token. firstSentence ≈ prefill + N tokens.
  const msPerToken = evalTps > 0 ? 1000 / evalTps : 0;
  const ttftMs = prefillMs + msPerToken;
  const firstSentenceMs = prefillMs + msPerToken * FIRST_SENTENCE_TOKENS;

  return {
    model,
    targetTokens,
    promptTokens,
    prefillMs,
    promptTps,
    evalTps,
    ttftMs,
    firstSentenceMs,
  };
}

/** Formatea una celda numérica a ancho fijo. */
function cell(s: string | number, width: number): string {
  return String(s).padStart(width);
}

function printTable(rows: MeasureRow[]): void {
  console.log(`\n${"═".repeat(84)}`);
  console.log("TABLA — curva de prefill (promedio sin warm-up)");
  console.log("─".repeat(84));
  console.log(
    [
      "modelo".padEnd(24),
      cell("~tok", 6),
      cell("real", 6),
      cell("prefill", 9),
      cell("prompt t/s", 11),
      cell("gen t/s", 9),
      cell("TTFT", 8),
      cell("1ª orac.", 9),
    ].join(" "),
  );
  console.log("─".repeat(84));
  for (const r of rows) {
    console.log(
      [
        r.model.padEnd(24),
        cell(r.targetTokens, 6),
        cell(r.promptTokens, 6),
        cell(`${r.prefillMs.toFixed(0)}ms`, 9),
        cell(r.promptTps.toFixed(0), 11),
        cell(r.evalTps.toFixed(0), 9),
        cell(`${r.ttftMs.toFixed(0)}ms`, 8),
        cell(`${r.firstSentenceMs.toFixed(0)}ms`, 9),
      ].join(" "),
    );
  }
  console.log("═".repeat(84));
}

/** Contrasta contra el budget de voz (§8.2) y concluye qué combos entran. */
function analyzeBudget(rows: MeasureRow[]): void {
  console.log("\n📏 Presupuesto de voz (§8.2):");
  console.log(`   - prefill del 3B ≤ ${BUDGET_PREFILL_MS}ms`);
  console.log(`   - primera oración ≤ ${BUDGET_FIRST_SENTENCE_MS}ms`);

  console.log("\n🎙️  ¿Qué combos entran en el budget de voz?");
  const voiceRows = rows.filter((r) => r.model === VOICE_MODEL);
  const fitting: MeasureRow[] = [];
  for (const r of rows) {
    const okPrefill = r.prefillMs <= BUDGET_PREFILL_MS;
    const okSentence = r.firstSentenceMs <= BUDGET_FIRST_SENTENCE_MS;
    const isVoice = r.model === VOICE_MODEL;
    // El budget de voz solo aplica al modelo de voz. Al 7B (tareas) no se lo
    // juzga contra este budget: se muestra neutro (➖).
    const mark = !isVoice ? "➖" : okPrefill && okSentence ? "✅" : "❌";
    const reasons: string[] = [];
    if (isVoice && !okPrefill)
      reasons.push(`prefill ${r.prefillMs.toFixed(0)}ms > ${BUDGET_PREFILL_MS}ms`);
    if (isVoice && !okSentence)
      reasons.push(`1ª oración ${r.firstSentenceMs.toFixed(0)}ms > ${BUDGET_FIRST_SENTENCE_MS}ms`);
    console.log(
      `   ${mark} ${r.model.padEnd(24)} ~${r.targetTokens}tok` +
        (isVoice ? "" : "  (modelo de tareas, no de voz — fuera del budget)") +
        (reasons.length ? `  → ${reasons.join("; ")}` : ""),
    );
    if (isVoice && okPrefill && okSentence) fitting.push(r);
  }

  console.log("\n🧾 Conclusión:");
  const voiceFits = fitting.filter((r) => r.model === VOICE_MODEL);
  if (voiceFits.length > 0) {
    const maxCtx = Math.max(...voiceFits.map((r) => r.targetTokens));
    console.log(
      `   El modelo de voz (${VOICE_MODEL}) entra en el budget hasta ~${maxCtx} tokens de contexto.`,
    );
  } else if (voiceRows.length > 0) {
    const best = voiceRows.reduce((a, b) => (a.prefillMs <= b.prefillMs ? a : b));
    console.log(
      `   ⚠️  Ningún tamaño del modelo de voz (${VOICE_MODEL}) entra en el budget.\n` +
        `   El mejor caso fue ~${best.targetTokens}tok con prefill ${best.prefillMs.toFixed(0)}ms ` +
        `(budget ${BUDGET_PREFILL_MS}ms). Hay que recortar el contexto de voz o cambiar de modelo.`,
    );
  } else {
    console.log(`   ⚠️  No se pudo medir el modelo de voz (${VOICE_MODEL}).`);
  }
  const taskFits = fitting.some((r) => r.model === TASK_MODEL);
  if (!taskFits) {
    console.log(
      `   El modelo de tareas (${TASK_MODEL}) NO se recomienda para el canal de voz: ` +
        "usalo para exámenes/corrección (no tiempo real).",
    );
  }
}

async function main() {
  console.log("\n🔬 EXPERIMENTO #3 — Curva de prefill real (§8.2)");
  console.log(`   Ollama:      ${BASE}`);
  console.log(`   Modelo tareas: ${TASK_MODEL}`);
  console.log(`   Modelo voz:    ${VOICE_MODEL}`);
  console.log(`   numCtx:        ${NUM_CTX}   ·  reps: ${REPS} (prompts únicos, mediana; modelo pre-cargado)`);

  // Chequeo de que Ollama está vivo y tiene los modelos.
  const available = await listModels();
  if (available.length === 0) {
    throw new Error(
      `Ollama no responde en ${BASE}. Arrancalo con 'ollama serve' y verificá con 'ollama list'.`,
    );
  }
  for (const m of [TASK_MODEL, VOICE_MODEL]) {
    if (!available.includes(m)) {
      console.log(
        `   ⚠️  El modelo '${m}' no aparece en 'ollama list'. Bajalo con 'ollama pull ${m}'.`,
      );
    }
  }

  const rows: MeasureRow[] = [];
  for (const model of [VOICE_MODEL, TASK_MODEL]) {
    console.log(`\n   Cargando ${model} en RAM (warm-up)...`);
    await warmModel(model); // paga load_duration una vez; prefill medido queda limpio
    for (const size of SIZES) {
      console.log(`   Midiendo ${model} @ ~${size}tok ...`);
      rows.push(await measure(model, size));
    }
  }

  printTable(rows);
  analyzeBudget(rows);

  const outPath = "exp3-latency.json";
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        base: BASE,
        taskModel: TASK_MODEL,
        voiceModel: VOICE_MODEL,
        numCtx: NUM_CTX,
        reps: REPS,
        budget: {
          prefillMs: BUDGET_PREFILL_MS,
          firstSentenceMs: BUDGET_FIRST_SENTENCE_MS,
          firstSentenceTokens: FIRST_SENTENCE_TOKENS,
        },
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n💾 Resultados guardados en: ${outPath}\n`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
