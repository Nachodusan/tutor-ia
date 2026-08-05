/**
 * EXPERIMENTO #6 (Plan v3, Eje "enseñanza") — mide CALIDAD PEDAGÓGICA y
 * ADAPTATIVIDAD del tutor facilitador, ancladas al OA. Reemplaza a math/grading
 * como criterio de éxito (esos salieron de scope: ver exp5).
 *
 * Por escenario (un OA del material): corre 2 turnos —enseñar + "no entendí"— y
 * mide comportamientos CHECKEABLES (no impresiones):
 *   - grounded        : ¿el gate encontró material (TE o GDD)?  [determinístico]
 *   - cita            : ¿la explicación cita la fuente "(pág…)"?  [determinístico]
 *   - conceptual      : ¿explica en vez de resolver por el alumno?  [juez]
 *   - chequea         : ¿termina con una pregunta de comprensión?  [determinístico]
 *   - adaptó          : ¿el turno 2 usa una estrategia DISTINTA al turno 1?  [juez]
 *   - usó_pedagogía   : ¿el retrieval trajo el movimiento de la GDD para el OA?  [determinístico]
 *
 * Uso: pnpm --filter @tutor-ia/eval exp6
 * Requiere: Postgres con el piloto ingestado, DEEPINFRA_API_KEY (los embeddings
 * y la generación salen por la API) y el rerank_server local en 8790.
 */
import { getSql } from "@tutor-ia/db";
import {
  getTeachingContext,
  streamTeaching,
  chatJSON,
  type ChatMessage,
} from "@tutor-ia/core";

const uid = process.env.EVAL_USER_ID!;
const SUBJECT = process.env.PILOT_SUBJECT ?? "Ciencias Naturales 1º Básico";

// Escenarios anclados a OAs reales del piloto.
const SCENARIOS = [
  "Enséñame para qué sirven los órganos de los sentidos",
  "Explícame cómo son los seres vivos",
  "Quiero aprender sobre los hábitos de vida saludable",
];
const STRUGGLE = "No entendí, ¿me lo podés explicar de otra manera?";

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    conceptual: { type: "boolean" },
    distinta: { type: "boolean" },
  },
  required: ["conceptual", "distinta"],
  additionalProperties: false,
} as const;

async function stream(req: Parameters<typeof getTeachingContext>[0], ctx: any) {
  let t = "";
  for await (const c of streamTeaching(req as any, ctx)) t += c;
  return t;
}

async function main() {
  const sql = getSql();
  const [s] = await sql<{ id: string }[]>`select id from subjects where name=${SUBJECT} order by created_at desc limit 1`;
  if (!s) throw new Error(`No existe la materia "${SUBJECT}". Corré pilot-ingest primero.`);
  const subjectId = s.id;

  const rows: any[] = [];
  for (const q of SCENARIOS) {
    const r1 = await getTeachingContext({ userId: uid, subjectId, question: q });
    if (!r1.grounded) { rows.push({ q, grounded: false }); console.log(`· ${q.slice(0, 40)} → abstención`); continue; }
    const a1 = await stream({ userId: uid, subjectId, question: q }, r1.ctx);

    const history: ChatMessage[] = [{ role: "user", content: q }, { role: "assistant", content: a1 }];
    const r2 = await getTeachingContext({ userId: uid, subjectId, question: STRUGGLE, history, struggling: true });
    const a2 = r2.grounded ? await stream({ userId: uid, subjectId, question: STRUGGLE, history, struggling: true }, r2.ctx) : "";

    // Juez (binario, simple): ¿conceptual? ¿turno 2 distinto al turno 1?
    let conceptual = false, distinta = false;
    try {
      const j = await chatJSON<{ conceptual: boolean; distinta: boolean }>(
        [{ role: "user", content:
          `Evaluá dos cosas sobre este tutor (respondé solo el JSON):\n` +
          `1) "conceptual": ¿EXPLICA el tema en vez de resolver ejercicios o hacer cálculos por el alumno?\n` +
          `2) "distinta": ¿la SEGUNDA explicación usa un ENFOQUE DISTINTO a la primera (otro ejemplo/analogía/actividad), no una repetición?\n\n` +
          `=== PRIMERA EXPLICACIÓN ===\n${a1}\n\n=== SEGUNDA EXPLICACIÓN (tras "no entendí") ===\n${a2}` }],
        JUDGE_SCHEMA, { temperature: 0 },
      );
      conceptual = !!j.conceptual; distinta = !!j.distinta;
    } catch { /* juez falló */ }

    // Detección de citación tolerante al formato: "(pág X)", "página 27",
    // "según el material/texto/guía", "Fragmento N".
    const CITA_RE = /\(\s*p[áa]g|p[áa]g(?:ina)?\.?\s*\d|seg[uú]n (?:el|la|tu|los|las) (?:material|texto|gu[íi]a|apunte|fragmento)|fragmento\s*\d/i;
    const pedaTypes = Object.entries(r1.ctx.pedagogy).filter(([, v]: any) => v.length).map(([k]) => k);
    rows.push({
      q, grounded: true,
      source: r1.ctx.citableSource, oas: r1.ctx.oas.join(","),
      cita: CITA_RE.test(a1),
      chequea: /\?/.test(a1.trim().split("\n").filter(Boolean).at(-1) ?? ""),
      usoPedagogia: pedaTypes.length > 0,
      turno2Grounded: r2.grounded,
      conceptual, distinta,
    });
    console.log(`· ${q.slice(0, 40)} → grounded(${r1.ctx.citableSource}) cita=${CITA_RE.test(a1)} adaptó=${distinta} conceptual=${conceptual}`);
  }

  // Scorecard
  const answered = rows.filter((r) => r.grounded);
  const pct = (n: number) => `${((100 * n) / Math.max(1, answered.length)).toFixed(0)}%`;
  console.log(`\n${"═".repeat(60)}\nEXP #6 — Enseñanza (n=${rows.length}, respondidos=${answered.length})\n${"═".repeat(60)}`);
  console.log(`  grounded (TE o GDD):     ${rows.filter((r) => r.grounded).length}/${rows.length}`);
  console.log(`  cita la fuente:          ${pct(answered.filter((r) => r.cita).length)}`);
  console.log(`  cierra con pregunta:     ${pct(answered.filter((r) => r.chequea).length)}`);
  console.log(`  usó pedagogía del OA:    ${pct(answered.filter((r) => r.usoPedagogia).length)}`);
  console.log(`  conceptual (no resuelve):${pct(answered.filter((r) => r.conceptual).length)}`);
  console.log(`  turno 2 no se abstuvo:   ${pct(answered.filter((r) => r.turno2Grounded).length)}`);
  console.log(`  ADAPTÓ (2º ≠ 1º):        ${pct(answered.filter((r) => r.distinta).length)}   ← prioridad #1`);

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
