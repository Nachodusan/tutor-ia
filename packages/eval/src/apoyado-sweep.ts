/**
 * CALIBRACIÓN DEL MODO `apoyado` — el vocabulario que le falta al sistema.
 *
 * Hoy el encuadre es binario: o hay material citable (`libro`) o no lo hay
 * (`general`). El sello `apoyado` existe, pero su única vía es la DERIVA del NLI
 * (`supportedFrac<=0 && strong>=3`), que dispara 2 veces en 101 — o sea que en la
 * práctica el sistema tiene dos casilleros para tres situaciones.
 *
 * El tercer caso está medido y duele: q035 ("¿resultado de las últimas elecciones
 * presidenciales en Chile?"). El material de Educación Ciudadana habla de
 * PARTICIPACIÓN electoral, no de resultados. Con el binario hay que elegir entre
 * dos respuestas malas:
 *   - servirlo como `libro` → el chico lee "esto está en tu material" sobre algo
 *     que no contesta su pregunta;
 *   - descartarlo → cae a `general` y el modelo responde de memoria, desactualizado.
 * La respuesta correcta es la tercera y el baseline la había producido sin querer:
 * *"el material se centra en participación más que en resultados; sí menciona que
 * en 2017 resultó electo Piñera"* — material PARCIAL, servido con su límite a la
 * vista. Eso es `apoyado`.
 *
 * ── Qué mide este script ────────────────────────────────────────────────────
 * La hipótesis es que las dos señales que YA se calculan separan los tres casos
 * cuando se las mira JUNTAS, cosa que ninguna hace sola:
 *   - `rerankScore` (relevancia): ¿el material es del tema?
 *   - `entailment`  (answerability): ¿el material CONTESTA?
 *
 *      relevante + contesta        → libro
 *      relevante + NO contesta     → apoyado   ← el casillero que falta
 *      NO relevante                → general
 *
 * Vuelca el par de cada etapa cross-scope de las 101 con el veredicto del golden
 * al lado, para poder ELEGIR los cortes leyendo, no a ojo. NO cablea nada: el
 * proyecto ya se quemó una vez eligiendo un umbral sobre los mismos puntos con
 * los que después lo medía (ver answerability.ts).
 *
 *   pnpm --filter @tutor-ia/eval apoyado-sweep
 */
import { readFile, writeFile } from "node:fs/promises";
import { getSql } from "@tutor-ia/db";
import { retrieveRanked, contesta, rerankMinScoreFromEnv } from "@tutor-ia/rag";

interface Golden {
  id: string; type: string; question?: string; q?: string;
  expect_mode?: string; expect_scope?: string;
}

async function main(): Promise<void> {
  const raw = await readFile(new URL("../golden/questions.jsonl", import.meta.url), "utf8");
  const golden: Golden[] = raw.trim().split("\n").map((l) => JSON.parse(l) as Golden);

  const sql = getSql();
  const userId = process.env.EVAL_USER_ID!;
  const subjectId = process.env.EVAL_SUBJECT_ID!;
  const familia = await sql<{ id: string }[]>`
    select s2.id from subjects s1 join subjects s2 on s2.family = s1.family
    where s1.id = ${subjectId}::uuid and s1.family is not null
      and s2.disabled_at is null and (s2.user_id is null or s2.user_id = ${userId}::uuid)`;
  const familyIds = familia.map((r) => r.id);
  const threshold = rerankMinScoreFromEnv();

  console.log(
    `📐 Calibración de \`apoyado\` — ${golden.length} preguntas\n` +
      `   Mide el par (relevancia, entailment) de las etapas CROSS-SCOPE.\n` +
      `   No cablea nada: es para elegir los cortes leyendo.\n`,
  );

  const filas: {
    id: string; type: string; etapa: string; rerank: number; entail: number;
    expectMode: string | null; expectScope: string | null; deberiaServir: boolean;
  }[] = [];

  for (const g of golden) {
    const q = g.question ?? g.q ?? "";
    // Solo interesa lo que el libro del PROPIO curso no cubre: es la población
    // que gobierna el discriminador. Si la etapa `curso` alcanza, no hay decisión
    // que tomar acá.
    const propio = await retrieveRanked(q, {
      userId, subjectIds: [subjectId], incluirPausadas: true, k: 6,
      minRerankScore: threshold, corpusRole: "content",
    });
    if (propio.grounded) { process.stdout.write("."); continue; }

    for (const [etapa, ids, umbral] of [
      ["otro_curso", familyIds, threshold],
      ["otra_materia", null, Math.max(threshold, 0.5)],
    ] as const) {
      const r = await retrieveRanked(q, {
        userId, subjectIds: ids, k: 6, minRerankScore: umbral,
        gateMargin: etapa === "otra_materia" ? 0 : undefined, corpusRole: "content",
      });
      if (!r.grounded || r.chunks.length === 0) continue;
      const v = await contesta(q, r.chunks.map((c) => c.content), 1.1); // min alto: solo queremos el número
      filas.push({
        id: g.id, type: g.type, etapa,
        rerank: Number(r.topScore.toFixed(4)),
        entail: Number((v?.entailment ?? 0).toFixed(4)),
        expectMode: g.expect_mode ?? null,
        expectScope: g.expect_scope ?? null,
        // El golden dice si ese material DEBÍA servirse: `must_abstain` con
        // expect_scope=ninguno significa "nada de esto contesta".
        deberiaServir: !(g.expect_mode === "general" && (g.expect_scope ?? "ninguno") === "ninguno"),
      });
      process.stdout.write(filas[filas.length - 1]!.deberiaServir ? "✓" : "✗");
    }
  }

  console.log(`\n\n${filas.length} etapas cross-scope con material.\n`);
  const sirve = filas.filter((f) => f.deberiaServir);
  const noSirve = filas.filter((f) => !f.deberiaServir);

  const tabla = (t: string, xs: typeof filas) => {
    console.log(`${t} (${xs.length}):`);
    for (const f of [...xs].sort((a, b) => b.entail - a.entail)) {
      console.log(
        `   ${f.id} ${f.type.padEnd(13)} ${f.etapa.padEnd(13)} rerank ${f.rerank.toFixed(3)}  entail ${f.entail.toFixed(3)}`,
      );
    }
  };
  tabla("MATERIAL QUE SÍ DEBE SERVIRSE", sirve);
  console.log();
  tabla("MATERIAL QUE NO CONTESTA (hoy: descartado → general)", noSirve);

  // La pregunta que importa: entre lo que NO contesta, ¿hay un subgrupo que es
  // claramente DEL TEMA (relevancia alta) y merecería `apoyado` en vez de nada?
  console.log("\n¿Qué pasaría con un corte de relevancia para `apoyado`?");
  console.log("   (de lo que NO contesta: relevante = apoyado · no relevante = general)");
  for (const corte of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const ap = noSirve.filter((f) => f.rerank >= corte).length;
    console.log(`   rerank >= ${corte.toFixed(2)} → ${ap} irían a \`apoyado\`, ${noSirve.length - ap} a \`general\``);
  }

  await writeFile("apoyado-sweep.json", JSON.stringify(filas, null, 2));
  console.log("\n💾 apoyado-sweep.json");
}

await main();
process.exit(0);
