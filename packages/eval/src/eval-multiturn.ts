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
  streamTeachingChecked,
  type ChatMessage,
} from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
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
  /** Encuadre servido. Sin esto no se puede ver lo único que este eval existe
   *  para medir: si el turno 2 PIERDE el material que el turno 1 tenía. */
  scope: string;
  mode: "libro" | "apoyado" | "general";
  parcial: boolean;
  /** Entailment del discriminador de answerability, si llegó a correr. */
  answEntail: number | null;
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

const vacio = (q: string, routed: "social" | "vague", answer: string, ms: number): TurnResult => ({
  q, routed, struggling: false, grounded: true, topScore: 0, chunkIds: [], answer, ms,
  scope: "ninguno", mode: "general", parcial: false, answEntail: null,
});

async function runTurn(
  userId: string,
  subjectId: string,
  q: string,
  history: ChatMessage[],
  familyIds: string[] | null,
  studentGrade: string | null,
): Promise<TurnResult> {
  const t0 = Date.now();
  // Réplica del corto-circuito de la route (eval.ts clásico se lo saltea).
  const hasContext = history.length > 0;
  const social = socialReply(q, undefined, hasContext);
  if (social) return vacio(q, "social", social, Date.now() - t0);
  const vague = needsTopicReply(q, hasContext, undefined);
  if (vague) return vacio(q, "vague", vague, Date.now() - t0);

  const struggling = isStruggling(q);
  // ⚠️ `familyIds` y `studentGrade` NO son opcionales, por el mismo motivo que en
  // eval.ts: sin familia la etapa `otro_curso` de la cascada NUNCA CORRE y esto
  // mediría un motor con una etapa menos que el que atiende al alumno. Es el bug
  // que ya escondió el de producción una vez (HANDOFF §7).
  const req = { userId, subjectId, question: q, history, struggling, familyIds, studentGrade };
  const res = await getTeachingContext(req);
  const ctx = res.ctx;
  const hayMaterial = (ctx?.citable.length ?? 0) > 0;

  // SIEMPRE GENERA, haya material o no. Acá había un corte por `!res.grounded`
  // que devolvía answer:"" — o sea, este eval medía el tutor que se NEGABA, y
  // ese tutor no existe desde el 2026-08-03: hoy responde con conocimiento
  // general y lo reconoce. Con el corte, toda conversación que perdiera material
  // en el turno 2 quedaba fuera del promedio en vez de contarse como el problema
  // que es.
  let answer = "";
  for await (const chunk of streamTeachingChecked(req, ctx)) answer += chunk;
  return {
    q,
    routed: "teach",
    struggling,
    grounded: hayMaterial,
    topScore: ctx?.topScore ?? 0,
    chunkIds: ctx?.citable.map((c) => c.chunkId) ?? [],
    answer,
    ms: Date.now() - t0,
    scope: ctx?.scope ?? "ninguno",
    mode: !hayMaterial ? "general" : ctx?.parcial ? "apoyado" : "libro",
    parcial: ctx?.parcial === true,
    answEntail: ctx?.answerabilityEntail ?? null,
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

  // La familia y el curso, con LA MISMA consulta que /api/chat y eval.ts.
  const sqlCtx = getSql();
  const [perfilFilas, familiaFilas] = await Promise.all([
    sqlCtx<{ grade: string | null }[]>`
      select grade from student_profiles where user_id = ${userId}::uuid`,
    sqlCtx<{ id: string }[]>`
      select s2.id from subjects s1 join subjects s2 on s2.family = s1.family
      where s1.id = ${subjectId}::uuid and s1.family is not null
        and s2.disabled_at is null and (s2.user_id is null or s2.user_id = ${userId}::uuid)`,
  ]);
  const studentGrade = perfilFilas[0]?.grade ?? null;
  const familyIds = familiaFilas.length ? familiaFilas.map((r) => r.id) : null;
  console.log(
    `   curso ${studentGrade ?? "(sin perfil)"} · asignatura en ${familyIds?.length ?? 0} cursos` +
      ((familyIds?.length ?? 0) > 1 ? "" : "  ⚠️ la etapa `otro_curso` no va a correr") +
      `\n   answerability=${process.env.RAG_ANSWERABILITY === "1" ? "ON" : "off"}\n`,
  );

  interface Row {
    id: string;
    t1: TurnResult;
    t2: TurnResult;
    /** Todos los turnos, para las charlas de 3+. */
    turnos: TurnResult[];
    coseno: number | null;
    distintaJuez: boolean | null;
    jaccardChunks: number | null;
    /** ⭐ LO QUE ESTE EVAL EXISTE PARA MEDIR: el turno 1 tenía material y algún
     *  turno posterior lo perdió. Es el único escenario donde el discriminador
     *  puede arrancarle el material a un chico a mitad de conversación, y el
     *  golden de 101 no puede verlo porque corre con `history: []`. */
    perdioMaterial: boolean;
  }
  const rows: Row[] = [];

  for (const c of convos) {
    if (c.turns.length < 2) continue;
    process.stdout.write(`  · ${c.id} `);
    const turnos: TurnResult[] = [];
    const history: ChatMessage[] = [];
    for (const turno of c.turns) {
      const r = await runTurn(userId, subjectId, turno.q, [...history], familyIds, studentGrade);
      turnos.push(r);
      history.push({ role: "user", content: turno.q });
      history.push({ role: "assistant", content: r.answer });
    }
    const t1 = turnos[0]!;
    const t2 = turnos[1]!;
    // El turno 1 marca la línea base: si tenía material, ningún turno posterior
    // de la MISMA charla debería quedarse sin él.
    const perdioMaterial = t1.grounded && turnos.slice(1).some((t) => t.routed === "teach" && !t.grounded);
    if (t1.routed !== "teach") {
      console.log(`⚠ turno 1 ${t1.routed} — conversación no evaluable`);
      rows.push({ id: c.id, t1, t2, turnos, coseno: null, distintaJuez: null, jaccardChunks: null, perdioMaterial: false });
      continue;
    }

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
    rows.push({ id: c.id, t1, t2, turnos, coseno, distintaJuez, jaccardChunks, perdioMaterial });
    const trazaModo = turnos.map((t) => (t.routed === "teach" ? t.mode[0]!.toUpperCase() : t.routed[0])).join("→");
    console.log(
      `[${trazaModo}] ` +
        (t2.routed !== "teach"
          ? `t2→${t2.routed} (cortocircuito)`
          : `cos=${coseno?.toFixed(3) ?? "-"} juez=${distintaJuez === null ? "?" : distintaJuez ? "adaptó" : "REPITIÓ"} jac=${jaccardChunks?.toFixed(2) ?? "-"} strug=${t2.struggling}`) +
        (perdioMaterial ? "  ⛔ PERDIÓ MATERIAL" : ""),
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

  // ⭐ LA MÉTRICA QUE JUSTIFICA ESTE EVAL. El golden de 101 corre con history
  // vacío, así que es estructuralmente incapaz de ver esto.
  const conMaterialT1 = rows.filter((r) => r.t1.routed === "teach" && r.t1.grounded);
  const perdieron = conMaterialT1.filter((r) => r.perdioMaterial);
  console.log(`\n── ⭐ CONTINUIDAD DEL MATERIAL (lo que el golden no puede ver) ──`);
  console.log(
    `   charlas que EMPEZARON con material y lo PERDIERON después: ${perdieron.length}/${conMaterialT1.length}` +
      (perdieron.length ? `   ⛔ ${perdieron.map((r) => r.id).join(", ")}` : "   ✅"),
  );
  const cross = rows.filter((r) => r.turnos.some((t) => t.scope === "otro_curso" || t.scope === "otra_materia"));
  console.log(`   charlas que tocaron material cross-scope (donde rige el discriminador): ${cross.length}`);
  const conEntail = rows.flatMap((r) => r.turnos).filter((t) => t.answEntail != null);
  if (conEntail.length) {
    console.log(
      `   entailment observado en ${conEntail.length} turnos: ` +
        conEntail.map((t) => t.answEntail!.toFixed(2)).join(" · "),
    );
  }
  const modos = rows.flatMap((r) => r.turnos).filter((t) => t.routed === "teach");
  const cuenta = (m: string) => modos.filter((t) => t.mode === m).length;
  console.log(`   modos servidos: libro ${cuenta("libro")} · apoyado ${cuenta("apoyado")} · general ${cuenta("general")}`);

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
