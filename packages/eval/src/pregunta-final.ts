/**
 * ¿LA PREGUNTA DE CIERRE OBLIGA AL ALUMNO A PENSAR, O YA ESTÁ CONTESTADA ARRIBA?
 *
 * El tutor tiene que terminar cada respuesta con UNA pregunta de chequeo. Medido
 * sobre los 25 turnos reales que había en la base, el 40% se contestaba solo:
 * decía "el tamaño del pico es la variable dependiente" y dos renglones después
 * preguntaba "¿cuál sería la variable dependiente?". El chico no piensa, copia.
 *
 * Esto REGENERA respuestas por el camino real de producción (getTeachingContext
 * + streamTeaching, el mismo que consume /api/chat) para poder medir el antes y
 * el después de un cambio de prompt sobre las MISMAS preguntas. No juzga: vuelca
 * pregunta + respuesta a JSON, y el veredicto lo da un juez aparte.
 *
 *   pnpm --filter @tutor-ia/eval pregunta-final <preguntas.json>
 *
 * El archivo de entrada es una lista de { pregunta } (acepta las claves extra
 * que traiga; se ignoran).
 */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { getTeachingContext, isStruggling, streamTeaching } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

async function main(): Promise<void> {
  const inPath = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!inPath) {
    console.error("uso: pregunta-final <preguntas.json>");
    process.exit(2);
  }
  const entrada = JSON.parse(await readFile(abs(inPath), "utf8")) as {
    pregunta: string;
  }[];

  const userId = process.env.EVAL_USER_ID!;
  const subjectId = process.env.EVAL_SUBJECT_ID ?? null;
  const sql = getSql();
  // La familia, igual que /api/chat. Sin esto la cascada corre con una etapa
  // menos y las respuestas salen de otro material — el antes/después dejaría de
  // ser comparable por un motivo que no tiene nada que ver con el prompt.
  const fam = subjectId
    ? await sql<{ id: string }[]>`
        select s2.id from subjects s1
        join subjects s2 on s2.family = s1.family
        where s1.id = ${subjectId}::uuid and s1.family is not null
          and s2.disabled_at is null
          and (s2.user_id is null or s2.user_id = ${userId}::uuid)`
    : [];
  const familyIds = fam.length ? fam.map((r) => r.id) : null;

  console.log(`✍️  Regenerando ${entrada.length} respuestas por el camino real.\n`);

  const salida: unknown[] = [];
  for (const [i, e] of entrada.entries()) {
    const req = {
      userId,
      subjectId,
      question: e.pregunta,
      history: [],
      struggling: isStruggling(e.pregunta),
      familyIds,
      studentGrade: null,
    };
    const res = await getTeachingContext(req);
    let texto = "";
    try {
      for await (const chunk of streamTeaching(req, res.ctx)) texto += chunk;
    } catch {
      console.log(`   ${i + 1}. ⏱ falló la generación — se omite`);
      continue;
    }
    salida.push({ id: `n${i + 1}`, pregunta: e.pregunta, texto });
    const cierre = texto.match(/[^.!?¿]*\?\s*$/)?.[0]?.trim() ?? "(no cierra con pregunta)";
    console.log(`   ${i + 1}. ${e.pregunta.slice(0, 44)}\n      → ${cierre.slice(0, 96)}`);
  }

  const outPath = abs("pregunta-final.json");
  await writeFile(outPath, JSON.stringify(salida, null, 2), "utf8");
  console.log(`\n💾 ${salida.length} respuestas → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
