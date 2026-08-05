/**
 * SCRIPT DE HUMO — compara proveedores lado a lado con el MISMO modelo.
 *
 * Manda el mismo prompt por los tres métodos de la interfaz contra cada
 * baseURL, e imprime latencia, tokens, tokens de RAZONAMIENTO y si hubo LEAK.
 *
 * Por qué la columna LEAK importa: un typo en el switch de razonamiento NO da
 * error 400 — da un modelo que piensa (verificado: `enable_thinkingg` →
 * HTTP 200 con 237 tokens de razonamiento). El status code no sirve para
 * detectarlo; hay que mirar tokens y campos de la respuesta.
 *
 * Correr:
 *   pnpm --filter @tutor-ia/eval llm-smoke
 *   pnpm --filter @tutor-ia/eval llm-smoke -- --only=deepinfra
 *   pnpm --filter @tutor-ia/eval llm-smoke -- --base-urls=https://api.deepinfra.com/v1/openai,https://api.scaleway.ai/v1
 *
 * Nota: acá SÍ se imprime la respuesta (es una herramienta de dev y es lo que
 * hay que comparar). El logging de producción nunca imprime prompt ni respuesta.
 */
import {
  activeReasoningParams,
  describeParams,
  formatUsageTotals,
  getUsageTotals,
  hostOf,
  isLLMError,
  makeProvider,
  resetUsage,
  resolveGenParams,
  type LLMProvider,
  type LLMProviderName,
} from "@tutor-ia/core";

const PROMPT =
  "Explicá en 3 frases simples qué es la fotosíntesis, para un estudiante de 12 años.";
const STRUCT_PROMPT =
  "Devolvé un objeto con el nombre de un proceso biológico y una explicación de una línea.";

/** Schema mínimo compatible con strict mode. */
const STRUCT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proceso", "explicacion"],
  properties: {
    proceso: { type: "string" },
    explicacion: { type: "string" },
  },
} as const;

interface Row {
  method: string;
  target: string;
  model: string;
  latencyMs: number;
  inTok: number | string;
  outTok: number | string;
  reasonTok: number | string;
  leak: boolean;
  ok: boolean;
  note: string;
}

const rows: Row[] = [];
const answers: { label: string; text: string }[] = [];

async function timeIt<T>(fn: () => Promise<T>): Promise<[T | null, number, unknown]> {
  const t0 = Date.now();
  try {
    return [await fn(), Date.now() - t0, null];
  } catch (err) {
    return [null, Date.now() - t0, err];
  }
}

function errNote(err: unknown): string {
  if (isLLMError(err)) return `${err.kind}${err.status ? ` ${err.status}` : ""}`;
  return err instanceof Error ? err.message.slice(0, 50) : String(err).slice(0, 50);
}

/** Un provider + un baseURL = un "target" a comparar. */
async function runTarget(
  name: LLMProviderName,
  baseUrl: string | undefined,
  label: string,
): Promise<void> {
  let provider: LLMProvider;
  try {
    provider = makeProvider(name, undefined, baseUrl);
  } catch (err) {
    rows.push({
      method: "(init)", target: label, model: "-", latencyMs: 0,
      inTok: "-", outTok: "-", reasonTok: "-", leak: false, ok: false, note: errNote(err),
    });
    return;
  }

  const delta = (b: ReturnType<typeof getUsageTotals>) => {
    const a = getUsageTotals();
    return {
      inTok: a.inputTokens - b.inputTokens,
      outTok: a.outputTokens - b.outputTokens,
      reasonTok: a.reasoningTokens - b.reasoningTokens,
    };
  };

  const push = (
    method: string,
    ms: number,
    d: { inTok: number; outTok: number; reasonTok: number },
    text: string | null,
    err: unknown,
  ) => {
    rows.push({
      method, target: label, model: provider.model, latencyMs: ms,
      ...d,
      // LEAK: hubo razonamiento que tuvimos que filtrar/contar.
      leak: d.reasonTok > 0,
      ok: !err && !!text && String(text).trim().length > 0,
      note: err ? errNote(err) : text ? "" : "respuesta vacía",
    });
  };

  { // generate
    const b = getUsageTotals();
    const [text, ms, err] = await timeIt(() => provider.generate(PROMPT));
    push("generate", ms, delta(b), text, err);
    if (text) answers.push({ label: `${label} · generate`, text });
  }
  { // generateStream
    const b = getUsageTotals();
    const [text, ms, err] = await timeIt(async () => {
      let out = "";
      for await (const c of provider.generateStream(PROMPT)) out += c;
      return out;
    });
    push("generateStream", ms, delta(b), text, err);
    if (text) answers.push({ label: `${label} · stream`, text });
  }
  { // generateStructured
    const b = getUsageTotals();
    const [obj, ms, err] = await timeIt(() =>
      provider.generateStructured<{ proceso: string; explicacion: string }>(
        STRUCT_PROMPT, STRUCT_SCHEMA,
      ),
    );
    push("generateStructured", ms, delta(b), obj ? JSON.stringify(obj) : null, err);
    if (obj) answers.push({ label: `${label} · structured`, text: JSON.stringify(obj) });
  }
}

const pad = (s: string | number, n: number) => {
  const v = String(s);
  return v.length >= n ? v.slice(0, n) : v + " ".repeat(n - v.length);
};

async function main(): Promise<void> {
  const arg = (k: string) =>
    process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");

  const only = arg("only");
  const baseUrls = (arg("base-urls") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // Cada target: [provider, baseURL, etiqueta]. Ya no hay proveedor local, así
  // que `--only` solo sirve para acotar entre varios endpoints remotos.
  const targets: [LLMProviderName, string | undefined, string][] = [];
  if (baseUrls.length > 0) {
    for (const u of baseUrls) targets.push(["deepinfra", u, hostOf(u)]);
  } else {
    targets.push(["deepinfra", undefined, "remoto(default)"]);
  }
  void only;

  console.log(`\n🔬 Humo LLM — mismo prompt contra: ${targets.map((t) => t[2]).join(", ")}\n`);
  resetUsage();
  for (const [name, url, label] of targets) await runTarget(name, url, label);

  console.log(
    pad("MÉTODO", 20) + pad("TARGET", 22) + pad("MODELO", 24) +
      pad("LAT", 9) + pad("IN", 6) + pad("OUT", 6) + pad("REASON", 8) + pad("LEAK", 6) + "OK",
  );
  console.log("─".repeat(105));
  for (const r of rows) {
    console.log(
      pad(r.method, 20) + pad(r.target, 22) + pad(r.model, 24) +
        pad(`${r.latencyMs}ms`, 9) + pad(r.inTok, 6) + pad(r.outTok, 6) +
        pad(r.reasonTok, 8) + pad(r.leak ? "✗ sí" : "✓ no", 6) +
        (r.ok ? "✓" : `✗ ${r.note}`),
    );
  }

  // Premisa de la comparación: los params tienen que ser IDÉNTICOS entre targets.
  const p = resolveGenParams(undefined);
  console.log(`\nparams efectivos (idénticos en todos): ${describeParams(p)}`);
  console.log(`structured fuerza:                     ${describeParams(resolveGenParams(undefined, true))}`);
  console.log(`switches de razonamiento enviados:     ${activeReasoningParams().join(", ")}`);
  console.log(`baseURL(s):                            ${targets.map((t) => t[1] ?? "(default/local)").join(" · ")}`);
  console.log(`\n${formatUsageTotals()}`);
  console.log(
    "\nLEAK ✗ = llegó razonamiento y hubo que filtrarlo. Un typo en el switch\n" +
      "no da error HTTP, así que esta columna es la única forma de detectarlo.",
  );

  console.log("\n─── respuestas lado a lado ───");
  for (const a of answers) console.log(`\n[${a.label}]\n${a.text.trim().slice(0, 500)}`);
  console.log("");

  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
