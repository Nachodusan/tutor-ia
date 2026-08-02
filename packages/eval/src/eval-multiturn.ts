/**
 * EVAL MULTITURNO — ¿el tutor ADAPTA cuando el alumno no entiende, o repite?
 *
 * El golden clásico es de una vuelta y la adaptatividad solo existe en el
 * segundo turno: este runner corre conversaciones de 2 turnos (pregunta →
 * confusión) por el MISMO camino de producción y mide, por conversación:
 *
 *   - repetición: coseno bge-m3 entre la respuesta 1 y la 2. Alto = repitió
 *     reformulado = fracaso. Determinista (módulo generación).
 *   - adaptó (juez): el binario de exp6-ensenanza ("¿enfoque distinto?").
 *     Conocido ruidoso (±5 pts en booleanos) — por eso conviven ambas señales.
 *   - sigue fundamentado: grounded + nº de citas del turno 2.
 *   - cambió el material: Jaccard de chunkIds citables turno 1 vs turno 2.
 *
 * Fidelidad a producción que eval.ts NO tiene: replica el corto-circuito
 * social/vago de la route (socialReply/needsTopicReply con hasContext real) y
 * `struggling` sale del regex real (isStruggling), no hardcodeado — el set
 * incluye a propósito una variante de confusión que el regex NO cubre ("sigo
 * sin entender"), para medir también la rama por defecto.
 *
 * Uso:
 *   EVAL_USER_ID=... EVAL_SUBJECT_ID=... pnpm --filter @tutor-ia/eval eval-multiturn \
 *     [golden/conversations.jsonl]
 */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  chatJSON,
  describeActiveLLM,
  getTeachingContext,
  getUsageTotals,
  isStruggling,
  needsTopicReply,
  socialReply,
  streamTeaching,
  type ChatMessage,
} from "@tutor-ia/core";
import { textCosine } from "./lib/similarity";

interface ConvTurn {
  q: string;
  kind?: "struggle";
  expect_chunks?: string[];
}
interface Conversation {
  id: string;
  from?: string;
  turns: ConvTurn[];
}

interface TurnResult {
  q: string;
  routed: "social" | "vague" | "teach";
  struggling: boolean;
  grounded: boolean;
  topScore: number;
  chunkIds: string[];
  answer: string;
  ms: number;
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: { distinta: { type: "boolean" } },
  required: ["distinta"],
  additionalProperties: false,
} as const;

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

async function runTurn(
  userId: string,
  subjectId: string,
  q: string,
  history: ChatMessage[],
): Promise<TurnResult> {
  const t0 = Date.now();
  // Réplica del corto-circuito de la route (eval.ts clásico se lo saltea).
  const hasContext = history.length > 0;
  const social = socialReply(q, undefined, hasContext);
  if (social) {
    return { q, routed: "social", struggling: false, grounded: true, topScore: 0, chunkIds: [], answer: social, ms: Date.now() - t0 };
  }
  const vague = needsTopicReply(q, hasContext, undefined);
  if (vague) {
    return { q, routed: "vague", struggling: false, grounded: true, topScore: 0, chunkIds: [], answer: vague, ms: Date.now() - t0 };
  }
  const struggling = isStruggling(q);
  const req = { userId, subjectId, question: q, history, struggling };
  const res = await getTeachingContext(req);
  if (!res.grounded) {
    return { q, routed: "teach", struggling, grounded: false, topScore: res.ctx?.topScore ?? 0, chunkIds: [], answer: "", ms: Date.now() - t0 };
  }
  let answer = "";
  for await (const chunk of streamTeaching(req, res.ctx)) answer += chunk;
  return {
    q,
    routed: "teach",
    struggling,
    grounded: true,
    topScore: res.ctx.topScore,
    chunkIds: res.ctx.citable.map((c) => c.chunkId),
    answer,
    ms: Date.now() - t0,
  };
}

async function main() {
  const path = resolvePath(process.argv[2] ?? "golden/conversations.jsonl");
  const userId = process.env.EVAL_USER_ID;
  const subjectId = process.env.EVAL_SUBJECT_ID;
  if (!userId || !subjectId) {
    console.error("❌ Falta EVAL_USER_ID y/o EVAL_SUBJECT_ID.");
    process.exit(1);
  }
  const convos = (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Conversation);

  console.log(`\n🔁 Eval multiturno — ${convos.length} conversaciones · ${path}`);
  console.log(`   motor: ${describeActiveLLM()}\n`);

  interface Row {
    id: string;
    t1: TurnResult;
    t2: TurnResult;
    coseno: number | null;
    distintaJuez: boolean | null;
    jaccardChunks: number | null;
  }
  const rows: Row[] = [];

  for (const c of convos) {
    const [turn1, turn2] = c.turns;
    if (!turn1 || !turn2) continue;
    process.stdout.write(`  · ${c.id} `);
    const t1 = await runTurn(userId, subjectId, turn1.q, []);
    if (!t1.grounded || t1.routed !== "teach") {
      // El turno 1 viene del golden con formulación de libro: no debería pasar.
      console.log(`⚠ turno 1 ${t1.routed === "teach" ? "ABSTUVO" : t1.routed} — conversación no evaluable`);
      rows.push({ id: c.id, t1, t2: t1, coseno: null, distintaJuez: null, jaccardChunks: null });
      continue;
    }
    const history: ChatMessage[] = [
      { role: "user", content: turn1.q },
      { role: "assistant", content: t1.answer },
    ];
    const t2 = await runTurn(userId, subjectId, turn2.q, history);

    let coseno: number | null = null;
    let distintaJuez: boolean | null = null;
    let jaccardChunks: number | null = null;
    if (t2.routed === "teach" && t2.grounded && t2.answer) {
      coseno = await textCosine(t1.answer, t2.answer);
      jaccardChunks = jaccard(t1.chunkIds, t2.chunkIds);
      try {
        const j = await chatJSON<{ distinta: boolean }>(
          [
            {
              role: "user",
              content:
                `¿La SEGUNDA explicación usa un ENFOQUE DISTINTO a la primera ` +
                `(otro ejemplo, otra analogía, otra actividad, más simple), o es una repetición reformulada?\n` +
                `Respondé solo el JSON.\n\n=== PRIMERA ===\n${t1.answer}\n\n=== SEGUNDA (tras la confusión del alumno) ===\n${t2.answer}`,
            },
          ],
          JUDGE_SCHEMA,
          { temperature: 0 },
        );
        distintaJuez = !!j.distinta;
      } catch {
        distintaJuez = null; // juez falló: queda el coseno
      }
    }
    rows.push({ id: c.id, t1, t2, coseno, distintaJuez, jaccardChunks });
    console.log(
      t2.routed !== "teach"
        ? `t2→${t2.routed} (cortocircuito)`
        : !t2.grounded
          ? `t2 ABSTUVO (topScore ${t2.topScore.toFixed(3)})`
          : `cos=${coseno?.toFixed(3)} juez=${distintaJuez === null ? "?" : distintaJuez ? "adaptó" : "REPITIÓ"} jac=${jaccardChunks?.toFixed(2)} strug=${t2.struggling}`,
    );
  }

  // ── Resumen ──
  const evaluables = rows.filter((r) => r.coseno != null);
  const t2Abst = rows.filter((r) => r.t2.routed === "teach" && !r.t2.grounded).length;
  const t2Corto = rows.filter((r) => r.t2.routed !== "teach").length;
  const cosenos = evaluables.map((r) => r.coseno!).sort((a, b) => a - b);
  const pct = (p: number) => cosenos[Math.min(cosenos.length - 1, Math.floor(p * cosenos.length))] ?? 0;
  const adaptoJuez = evaluables.filter((r) => r.distintaJuez === true).length;
  const juezOk = evaluables.filter((r) => r.distintaJuez !== null).length;
  const conFlag = evaluables.filter((r) => r.t2.struggling);
  const sinFlag = evaluables.filter((r) => !r.t2.struggling);
  const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`conversaciones:        ${rows.length}`);
  console.log(`turno 2 evaluable:     ${evaluables.length}   (abstuvo: ${t2Abst} · cortocircuito social/vago: ${t2Corto})`);
  console.log(`\n── repetición (coseno respuesta 1 ↔ 2; alto = repitió) ──`);
  console.log(`   p25 ${pct(0.25).toFixed(3)} · mediana ${pct(0.5).toFixed(3)} · p75 ${pct(0.75).toFixed(3)} · max ${(cosenos[cosenos.length - 1] ?? 0).toFixed(3)}`);
  console.log(`   media con flag adaptativo (${conFlag.length}): ${media(conFlag.map((r) => r.coseno!)).toFixed(3)}`);
  console.log(`   media SIN flag (regex no cubrió) (${sinFlag.length}): ${media(sinFlag.map((r) => r.coseno!)).toFixed(3)}`);
  console.log(`\n── juez ("enfoque distinto") ──`);
  console.log(`   adaptó: ${adaptoJuez}/${juezOk}  (${juezOk ? ((100 * adaptoJuez) / juezOk).toFixed(0) : 0}%)`);
  console.log(`\n── material del turno 2 ──`);
  console.log(`   Jaccard medio de chunks 1↔2: ${media(evaluables.map((r) => r.jaccardChunks!)).toFixed(2)}   (1 = mismo material)`);
  console.log(`   grounded en turno 2: ${rows.filter((r) => r.t2.routed === "teach" && r.t2.grounded).length}/${rows.filter((r) => r.t2.routed === "teach").length}`);

  const outPath = resolvePath("multiturn-results.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        golden: path,
        engine: describeActiveLLM(),
        usage: getUsageTotals(),
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n💾 ${outPath}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
