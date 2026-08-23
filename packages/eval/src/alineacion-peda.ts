/**
 * Qué guía docente entra al prompt, por materia y por tipo.
 *
 *   pnpm --filter @tutor-ia/eval alineacion-peda
 *
 * No hay métrica automática para la calidad de la guía —`correct_mode` mide
 * encuadre y no se mueve con esto—, así que la única forma de juzgarla es
 * mirarla. Nació para un A/B de alineación contenido↔pedagogía que se descartó
 * (ver `oaBoostFromEnv`), y quedó porque el problema que lo motivó sigue en pie:
 * la guía se elige por parecido con la PREGUNTA, no con lo que se va a enseñar.
 */
import { getTeachingContext } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

const CASOS: { materia: string; pregunta: string }[] = [
  { materia: "Ciencias Naturales 8º", pregunta: "¿Qué es la teoría celular y quiénes la formularon?" },
  { materia: "Matemática 8º", pregunta: "¿Cómo se usa el teorema de Pitágoras?" },
  { materia: "Lengua Y Literatura 8º", pregunta: "¿Qué es el narrador omnisciente?" },
  { materia: "Historia Geografía Y Ciencias Sociales 7º", pregunta: "¿Cómo era la sociedad en la Edad Media?" },
];

async function correr(materia: string, pregunta: string) {
  const sql = getSql();
  const [s] = await sql<{ id: string }[]>`select id from subjects where name = ${materia}`;
  const fam = await sql<{ id: string }[]>`
    select s2.id from subjects s1 join subjects s2 on s2.family = s1.family
    where s1.id = ${s!.id}::uuid and s1.family is not null and s2.disabled_at is null`;
  const ar = await sql<{ id: string }[]>`
    select s2.id from subjects s1 join subjects s2 on s2.area = s1.area
    where s1.id = ${s!.id}::uuid and s1.area is not null and s2.disabled_at is null`;
  const res = await getTeachingContext({
    userId: "00000000-0000-0000-0000-000000000001", subjectId: s!.id,
    question: pregunta, history: [],
    familyIds: fam.map((r) => r.id), areaIds: ar.map((r) => r.id),
  });
  const ctx = res.ctx;
  const bloques: string[] = [];
  for (const [tipo, cs] of Object.entries(ctx?.pedagogy ?? {})) {
    for (const c of cs as { content: string; rerankScore: number; rankScore: number }[]) {
      // Los DOS puntajes: el crudo decide el gate, el rankScore decide el orden
      // (y con 2 bloques por tipo, el orden decide cuáles entran).
      bloques.push(
        `${tipo.padEnd(22)} crudo ${c.rerankScore.toFixed(4)} · orden ${c.rankScore.toFixed(4)}  ${c.content.replace(/\s+/g, " ").slice(0, 44)}`,
      );
    }
  }
  return { contenido: ctx?.citable[0]?.content.replace(/\s+/g, " ").slice(0, 70) ?? "(nada)", bloques };
}

async function main() {
  const conBoost = process.env.RAG_PEDAGOGY_ALIGN_BOOST !== "0";
  console.log(`\nAlineación: ${conBoost ? "ENCENDIDA" : "APAGADA"}\n`);
  for (const c of CASOS) {
    const r = await correr(c.materia, c.pregunta);
    console.log(`■ ${c.materia} — «${c.pregunta}»`);
    console.log(`  contenido: ${r.contenido}`);
    r.bloques.forEach((b) => console.log(`     · ${b}`));
    console.log();
  }
  await getSql().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
