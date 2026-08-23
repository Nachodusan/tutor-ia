/**
 * Muestra QUÉ material devuelve cada pregunta del golden, para poder juzgar a
 * mano si la expectativa sigue siendo válida.
 *
 *   pnpm --filter @tutor-ia/eval inspeccionar-golden -- q120 q122 q125
 *
 * Existe porque re-baselinear un golden mirando solo el `scope` que devuelve es
 * circular: se estaría escribiendo la expectativa a partir del comportamiento
 * actual. Lo que decide es si el MATERIAL responde la pregunta, y para eso hay
 * que leerlo.
 */
import { readFile } from "node:fs/promises";
import { getTeachingContext, isStruggling } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

const IDS = process.argv.slice(2).filter((a) => /^q\d+$/.test(a));
const SUBJECT = "Lengua Y Literatura 8º";

async function main() {
  const sql = getSql();
  const [s] = await sql<{ id: string }[]>`select id from subjects where name = ${SUBJECT}`;
  const fam = await sql<{ id: string }[]>`
    select s2.id from subjects s1 join subjects s2 on s2.family = s1.family
    where s1.id = ${s!.id}::uuid and s1.family is not null and s2.disabled_at is null`;
  const ar = await sql<{ id: string }[]>`
    select s2.id from subjects s1 join subjects s2 on s2.area = s1.area
    where s1.id = ${s!.id}::uuid and s1.area is not null and s2.disabled_at is null`;
  const raw = await readFile("golden/questions.jsonl", "utf8").catch(() =>
    readFile("packages/eval/golden/questions.jsonl", "utf8"));
  const G = new Map<string, any>();
  for (const ln of raw.split("\n")) { if (!ln.trim()) continue; const d = JSON.parse(ln); G.set(d.id, d); }

  for (const id of IDS) {
    const g = G.get(id);
    if (!g) { console.log(`\n${id}: no está en el golden`); continue; }
    const q = g.question ?? g.q;
    // MISMOS PARÁMETROS QUE `retrieval-guard`, o esto no reproduce lo que pasa.
    // Faltaba `studentGrade`: activa la penalización por cercanía de grado, que
    // reordena el material y cambia cuál queda arriba — con él q029 devuelve
    // material y sin él se abstiene. Un inspector que no reproduce el caso que
    // se quiere mirar es peor que no tenerlo.
    const [perfil] = await sql<{ grade: string | null }[]>`
      select grade from student_profiles
      where user_id = '00000000-0000-0000-0000-000000000001'::uuid`;
    const res = await getTeachingContext({
      userId: "00000000-0000-0000-0000-000000000001", subjectId: s!.id,
      question: q, history: [], familyIds: fam.map((r) => r.id), areaIds: ar.map((r) => r.id),
      studentGrade: perfil?.grade ?? null, struggling: isStruggling(q),
    });
    const ctx = res.ctx;
    console.log(`\n${"═".repeat(78)}\n${id} · espera ${g.expect_mode}/${g.expect_scope} · dio ${res.mode}/${ctx?.scope}`);
    console.log(`«${q}»`);
    for (const c of (ctx?.citable ?? []).slice(0, 2)) {
      console.log(`\n  ── ${c.documentTitle} · pág ${c.pageStart}${c.pageEnd !== c.pageStart ? "-" + c.pageEnd : ""} · score ${c.score.toFixed(4)}`);
      console.log("     " + c.content.replace(/\s+/g, " ").slice(0, 420));
    }
    if (!(ctx?.citable ?? []).length) console.log("  (sin material citable)");
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
