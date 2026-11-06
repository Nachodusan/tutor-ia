/**
 * DÓNDE SE VA EL TIEMPO DE UNA RESPUESTA DEL CHAT.
 *
 * Motivo: los `meta.ms` guardados en `messages` dan una mediana de 38,9 s y un
 * p90 de 114,4 s sobre 312 respuestas reales. Ese número es el TOTAL y no dice
 * qué etapa lo consume, así que no se puede optimizar contra él.
 *
 * Este banco corre la MISMA tubería que `/api/chat` y la cronometra por partes:
 *
 *   1. `getTeachingContext`  → embedding remoto + pgvector + reranker (sidecar)
 *   2. `streamTeachingChecked` → generación remota; se separa el TIEMPO HASTA EL
 *      PRIMER CHUNK del total, porque son dos cosas distintas: lo primero es lo
 *      que el alumno vive como "no pasa nada", lo segundo no lo espera mirando
 *      la pantalla en blanco.
 *   3. `verifyAnswerA3`      → NLI por oración (sidecar)
 *
 * ⚠️ La distinción del punto 2 es la que ordena todo el análisis. El texto se
 * transmite en streaming, así que la latencia PERCIBIDA es (1) + primer chunk.
 * Lo que viene después el alumno ya lo está leyendo.
 *
 *   pnpm --filter @tutor-ia/eval latencia
 *   pnpm --filter @tutor-ia/eval latencia --repeticiones 3
 */
import { getTeachingContext, streamTeachingChecked, verifyAnswerA3, config } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : d;
};
const REPS = Number(arg("repeticiones", "2"));

/** Preguntas de distinta forma: la latencia no tiene por qué ser la misma. */
const PREGUNTAS = [
  { etiqueta: "corta / concepto", q: "¿Qué es la amplitud de una onda?" },
  { etiqueta: "larga / explicación", q: "Explicame cómo se relacionan las ondas con el sonido y por qué el sonido no viaja en el vacío" },
  { etiqueta: "ejercicio", q: "¿Cómo se resuelve x²-5x+6=0?" },
];

interface Marca { etapa: string; ms: number }

async function unaCorrida(subjectId: string, userId: string, pregunta: string) {
  const marcas: Marca[] = [];
  const cron = async <T>(etapa: string, f: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    const r = await f();
    marcas.push({ etapa, ms: Date.now() - t });
    return r;
  };

  const sql = getSql();
  const [mat] = await sql<{ name: string }[]>`select name from subjects where id = ${subjectId}::uuid`;

  const req = {
    userId, subjectId, question: pregunta, history: [] as { role: string; content: string }[],
    struggling: false, unit: null, lesson: null,
    studentGrade: null as string | null, subjectName: mat?.name ?? null,
    familyIds: null as string[] | null, areaIds: null as string[] | null, primerTema: null,
  };

  // 1) RETRIEVAL
  const ctx = await cron("retrieval", () => getTeachingContext(req as never));

  // 2) GENERACIÓN, separando el primer chunk del total.
  const tGen = Date.now();
  let primerChunk = -1;
  let full = "";
  let nChunks = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of streamTeachingChecked(req as never, (ctx as any).ctx, () => {})) {
    if (primerChunk < 0) primerChunk = Date.now() - tGen;
    full += chunk;
    nChunks++;
  }
  marcas.push({ etapa: "gen:primer-chunk", ms: primerChunk });
  marcas.push({ etapa: "gen:total", ms: Date.now() - tGen });

  // 3) NLI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const citable = ((ctx as any).ctx?.citable ?? []) as { content: string }[];
  if (citable.length) {
    await cron("nli", () => verifyAnswerA3(full, citable.map((c) => c.content)));
  } else {
    marcas.push({ etapa: "nli", ms: 0 });
  }

  return { marcas, chars: full.length, nChunks, citables: citable.length };
}

async function main() {
  const sql = getSql();
  const subjectId = process.env.EVAL_SUBJECT_ID
    ?? (await sql<{ id: string }[]>`select id from subjects where name ilike 'F%sica 1%' limit 1`)[0]?.id;
  const userId = process.env.EVAL_USER_ID ?? process.env.DEV_USER_ID
    ?? (await sql<{ id: string }[]>`select id from users limit 1`)[0]?.id;
  if (!subjectId || !userId) { console.error("Falta EVAL_SUBJECT_ID o EVAL_USER_ID"); process.exit(1); }

  console.log(`modelo: ${config.llmModelEnv || "(default del provider)"} · razonamiento: ${config.reasoning}`);
  console.log(`max_tokens: ${config.maxTokens} · temp: ${config.temperature}\n`);

  const todas: { etiqueta: string; marcas: Marca[]; chars: number; nChunks: number }[] = [];

  for (const p of PREGUNTAS) {
    for (let i = 0; i < REPS; i++) {
      process.stdout.write(`· ${p.etiqueta} (${i + 1}/${REPS})… `);
      try {
        const r = await unaCorrida(subjectId, userId, p.q);
        todas.push({ etiqueta: p.etiqueta, ...r });
        const tot = r.marcas.find((m) => m.etapa === "gen:total")!.ms
          + r.marcas.find((m) => m.etapa === "retrieval")!.ms
          + r.marcas.find((m) => m.etapa === "nli")!.ms;
        console.log(`${(tot / 1000).toFixed(1)} s · ${r.chars} caracteres`);
      } catch (e) {
        console.log(`FALLÓ: ${(e as Error).message.slice(0, 90)}`);
      }
    }
  }

  if (!todas.length) { console.log("\nNinguna corrida terminó."); return; }

  // ── El desglose ──────────────────────────────────────────────────────────
  const ETAPAS = ["retrieval", "gen:primer-chunk", "gen:total", "nli"];
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };

  console.log("\n" + "─".repeat(62));
  console.log("ETAPA                    mediana      mín      máx");
  console.log("─".repeat(62));
  const medianas: Record<string, number> = {};
  for (const e of ETAPAS) {
    const xs = todas.map((t) => t.marcas.find((m) => m.etapa === e)?.ms ?? 0);
    medianas[e] = med(xs);
    console.log(
      `${e.padEnd(22)} ${(med(xs) / 1000).toFixed(1).padStart(7)} s ${(Math.min(...xs) / 1000).toFixed(1).padStart(7)} s ${(Math.max(...xs) / 1000).toFixed(1).padStart(7)} s`,
    );
  }
  console.log("─".repeat(62));

  const r = medianas["retrieval"]!, pc = medianas["gen:primer-chunk"]!;
  const gt = medianas["gen:total"]!, nli = medianas["nli"]!;
  console.log(`\nLO QUE EL ALUMNO ESPERA MIRANDO LA PANTALLA EN BLANCO:`);
  console.log(`  retrieval + primer chunk = ${((r + pc) / 1000).toFixed(1)} s`);
  console.log(`\nLO QUE PASA MIENTRAS YA ESTÁ LEYENDO:`);
  console.log(`  resto de la generación   = ${((gt - pc) / 1000).toFixed(1)} s`);
  console.log(`  NLI (después del texto)  = ${(nli / 1000).toFixed(1)} s`);
  console.log(`\n  TOTAL (lo que guarda meta.ms) = ${((r + gt + nli) / 1000).toFixed(1)} s`);

  const chars = med(todas.map((t) => t.chars));
  if (gt > 0) console.log(`\n  velocidad de salida ≈ ${(chars / (gt / 1000)).toFixed(0)} caracteres/s`);

  await sql.end?.();
}

void main();
