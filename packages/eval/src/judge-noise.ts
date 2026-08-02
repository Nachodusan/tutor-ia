/**
 * ¿Cuánto de la varianza de `hallucination_rate` es RUIDO DEL JUEZ?
 *
 * Cuatro corridas del golden sobre el mismo corpus dieron 38,4% · 42,9% · 48,7% ·
 * 41,6% — 10 puntos de dispersión con `topScore` idéntico en las 101 preguntas.
 * Comparar dos corridas no alcanza para atribuirlo: la generación corre a
 * temperature 0.1 y el 100% de las respuestas cambia de texto entre corridas, así
 * que juez y generación quedan confundidos.
 *
 * Este script rompe el empate: toma las respuestas YA GENERADAS y persistidas en
 * `eval-results.json` y corre el juez N veces sobre EXACTAMENTE la misma entrada.
 * Cualquier cambio de veredicto ahí es del juez y de nadie más.
 *
 * No genera nada: cero llamadas de tutor. Solo el juez.
 *
 * Uso:
 *   EVAL_USER_ID=... pnpm --filter @tutor-ia/eval judge-noise [results.json] [repeticiones]
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CLAIMS_JUDGE_SYSTEM,
  CLAIMS_SCHEMA,
  chatJSON,
  verifyClaims,
  type RawClaim,
} from "@tutor-ia/core";
import { entails } from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";

const RESULTS = process.argv[2] ?? resolve(process.cwd(), "eval-results.json");
const REPS = Number(process.argv[3] ?? "2");
const ENTAIL_MIN = Number(process.env.EVAL_ENTAIL_MIN ?? "0.5");

/** Mismo prompt de descomposición que usa el eval, para medir el mismo juez. */
function buildClaimsPrompt(context: string, question: string, answer: string): string {
  return `Descompón la RESPUESTA en afirmaciones atómicas. Para cada afirmación:
- "text": la afirmación en una frase.
- "quote": si HAY un tramo del fragmento que dice lo mismo, copialo tal cual como evidencia. Es OPCIONAL: si la afirmación está sostenida por el sentido del fragmento pero con otras palabras, dejá "quote" vacío. NO fuerces una cita literal que no exista, y NO marques como sin respaldo algo que el fragmento sí implica.
- "chunkIndex": el número de fragmento (1-based) que la sostiene.

Parafrasear bien NO es inventar: la cita literal es evidencia cómoda cuando aparece, no el criterio.

=== FRAGMENTOS ===
${context}
=== PREGUNTA ===
${question}
=== RESPUESTA A DESCOMPONER ===
${answer}
=== FIN ===`;
}

/** Un veredicto de alucinación sobre una respuesta fija. Réplica exacta de eval.ts. */
async function juzgar(context: string, chunkTexts: string[], q: string, answer: string) {
  const raw = await chatJSON<{ claims: RawClaim[] }>(
    [
      { role: "system", content: CLAIMS_JUDGE_SYSTEM },
      { role: "user", content: buildClaimsPrompt(context, q, answer) },
    ],
    CLAIMS_SCHEMA,
    { temperature: 0 },
  );
  const report = verifyClaims(raw.claims ?? [], chunkTexts);
  // Se evalúan TODAS las claims, sin cortar en la primera que falla: hace falta
  // la cuenta completa para comparar el criterio booleano contra el de tasa.
  let sinRespaldo = 0;
  for (const c of report.claims) {
    if (c.label === "respaldada") continue;
    const cand =
      c.chunkIndex && chunkTexts[c.chunkIndex - 1] != null
        ? [chunkTexts[c.chunkIndex - 1] as string]
        : chunkTexts;
    if ((await entails(c.text, cand)) < ENTAIL_MIN) sinRespaldo++;
  }
  const n = report.claims.length;
  return {
    // Criterio ACTUAL: basta UNA claim sin respaldo. Es un máximo sobre una lista
    // de largo variable, o sea lo más sensible posible al ruido del decompositor.
    alucinó: sinRespaldo > 0,
    // Criterio alternativo: qué FRACCIÓN de las afirmaciones quedó sin respaldo.
    // Una claim espuria de más mueve 1/n en vez de dar vuelta el veredicto entero.
    tasa: n === 0 ? 0 : sinRespaldo / n,
    nClaims: n,
  };
}

async function main() {
  const data = JSON.parse(await readFile(RESULTS, "utf8")) as {
    perQuestion: { id: string; q: string; result?: Record<string, unknown> }[];
  };
  const casos = data.perQuestion.filter(
    (x) => x.result && typeof x.result.answer === "string" && (x.result.answer as string).length > 0,
  );
  console.log(`\n🎲 Ruido del juez — ${casos.length} respuestas YA generadas · ${REPS} repeticiones`);
  console.log(`   fuente: ${RESULTS}`);
  console.log(`   La generación NO se repite: la entrada del juez es idéntica en cada pasada.\n`);

  const sql = getSql();
  const veredictos = new Map<string, boolean[]>();
  const tasas = new Map<string, number[]>();

  for (const c of casos) {
    const ids = (c.result!.retrievedIds as string[]) ?? [];
    if (ids.length === 0) continue;
    const filas = await sql<{ id: string; content: string }[]>`
      select id, content from chunks where id = any(${ids}::uuid[])`;
    const porId = new Map(filas.map((f) => [f.id, f.content]));
    const chunkTexts = ids.map((i) => porId.get(i) ?? "").filter(Boolean);
    if (chunkTexts.length === 0) continue;
    const context = chunkTexts.map((t, i) => `[Fragmento ${i + 1}]\n${t}`).join("\n\n");

    const vs: boolean[] = [];
    const ts: number[] = [];
    for (let r = 0; r < REPS; r++) {
      try {
        const j = await juzgar(context, chunkTexts, c.q, c.result!.answer as string);
        vs.push(j.alucinó); ts.push(j.tasa);
      } catch {
        vs.push(false); ts.push(0); // fallo del juez: igual que el eval, no cuenta
      }
    }
    veredictos.set(c.id, vs); tasas.set(c.id, ts);
    const inest = new Set(vs).size > 1;
    process.stdout.write(`  ${c.id} ${vs.map((v) => (v ? "A" : ".")).join("")}${inest ? "  ← INESTABLE" : ""}\n`);
  }

  const todos = [...veredictos.values()];
  const inestables = todos.filter((v) => new Set(v).size > 1).length;
  const tasaBool = Array.from({ length: REPS }, (_, r) =>
    todos.length ? todos.filter((v) => v[r]).length / todos.length : 0,
  );
  console.log(`\n${"═".repeat(60)}`);
  console.log(`respuestas juzgadas:        ${todos.length}`);
  console.log(`veredicto INESTABLE:        ${inestables}  (${((100 * inestables) / Math.max(1, todos.length)).toFixed(0)}%)`);
  console.log(`tasa por pasada:            ${tasaBool.map((t) => `${(t * 100).toFixed(1)}%`).join(" · ")}`);
  console.log(`dispersión entre pasadas:   ${((Math.max(...tasaBool) - Math.min(...tasaBool)) * 100).toFixed(1)} puntos`);
  // ¿Y si el criterio fuera la TASA de claims sin respaldo en vez del booleano?
  // Misma entrada, mismas pasadas: solo cambia cómo se agrega.
  const tt = [...tasas.values()];
  const medias = Array.from({ length: REPS }, (_, r) =>
    tt.length ? tt.reduce((s2, v) => s2 + (v[r] ?? 0), 0) / tt.length : 0,
  );
  const rango = (v: number[]) => Math.max(...v) - Math.min(...v);
  const inestTasa = tt.filter((v) => rango(v) > 0.15).length;
  console.log(`\n── criterio alternativo: TASA de claims sin respaldo ──`);
  console.log(`media por pasada:           ${medias.map((t) => `${(t * 100).toFixed(1)}%`).join(" · ")}`);
  console.log(`dispersión entre pasadas:   ${((Math.max(...medias) - Math.min(...medias)) * 100).toFixed(1)} puntos`);
  console.log(`respuestas que se mueven >15 puntos: ${inestTasa}  (${((100 * inestTasa) / Math.max(1, tt.length)).toFixed(0)}%)`);
  console.log(
    `\nCon la entrada FIJA, todo lo de arriba es del juez. Si la inestabilidad es\n` +
      `alta, la métrica no mide al tutor y no sirve para decidir nada.`,
  );
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
