/**
 * ¿La etapa `area` alcanza los libros hermanos? (CLI de verificación)
 *
 *   pnpm --filter @tutor-ia/eval ruteo-area
 *
 * Cada caso es una exigencia REAL del mapa curricular que un libro debía y su
 * hermano cubría. Antes de la etapa `area` todas caían a modo `general`.
 * Corre con `--sin-area` para ver el comportamiento anterior.
 */
import { getSql } from "@tutor-ia/db";
import { getTeachingContext } from "@tutor-ia/core";

const SIN_AREA = process.argv.includes("--sin-area");

const CASOS: { materia: string; pregunta: string; espera: string }[] = [
  { materia: "Biología 1º Medio", pregunta: "¿Qué es el sonido y cómo se propaga?", espera: "Física" },
  { materia: "Biología 1º Medio", pregunta: "¿Cómo se formó el universo según la ciencia?", espera: "Física" },
  { materia: "Física 1º Medio", pregunta: "¿Cómo se transmite la información genética de padres a hijos?", espera: "Biología" },
  { materia: "Química 1º Medio", pregunta: "¿Qué es el trabajo mecánico y la energía?", espera: "Física" },
  { materia: "Física 2º Medio", pregunta: "¿Qué son los grupos funcionales en química orgánica?", espera: "Química" },
  { materia: "Ciencias Naturales 7º", pregunta: "¿Qué es la biodiversidad y por qué hay que preservarla en Chile?", espera: "cualquiera" },
];

async function main() {
  const sql = getSql();
  console.log(`\nEtapa \`area\` ${SIN_AREA ? "APAGADA (comportamiento anterior)" : "ENCENDIDA"}\n`);
  let ok = 0;
  for (const c of CASOS) {
    const [s] = await sql<{ id: string }[]>`select id from subjects where name = ${c.materia}`;
    if (!s) { console.log(`  ⚠️  materia no encontrada: ${c.materia}`); continue; }
    const fam = await sql<{ id: string }[]>`
      select s2.id from subjects s1 join subjects s2 on s2.family = s1.family
      where s1.id = ${s.id}::uuid and s1.family is not null and s2.disabled_at is null`;
    const ar = await sql<{ id: string }[]>`
      select s2.id from subjects s1 join subjects s2 on s2.area = s1.area
      where s1.id = ${s.id}::uuid and s1.area is not null and s2.disabled_at is null`;
    const res = await getTeachingContext({
      userId: "00000000-0000-0000-0000-000000000001",
      subjectId: s.id,
      question: c.pregunta,
      history: [],
      familyIds: fam.map((r) => r.id),
      areaIds: SIN_AREA ? null : ar.map((r) => r.id),
    });
    const ctx = res.ctx;
    const libro = ctx?.citable[0]?.documentTitle ?? "(sin material)";
    const scope = ctx?.scope ?? "ninguno";
    const marca = scope === "ninguno" ? "✗" : "✓";
    if (scope !== "ninguno") ok++;
    console.log(`  ${marca} ${c.materia.padEnd(22)} scope=${String(scope).padEnd(12)} ${(ctx?.topScore ?? 0).toFixed(3)}  ${libro.slice(0, 52)}`);
    console.log(`      «${c.pregunta}»  → esperaba ${c.espera}`);
  }
  console.log(`\n  con material: ${ok}/${CASOS.length}\n`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
