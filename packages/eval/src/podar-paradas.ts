/**
 * SACA DEL CAMINO LAS PÁGINAS QUE NO SE ESTUDIAN.
 *
 *   pnpm --filter @tutor-ia/eval podar-paradas            (ensayo)
 *   pnpm --filter @tutor-ia/eval podar-paradas --aplicar
 *
 * Un libro escolar no es todo lecciones: trae páginas de EVALUACIÓN, de
 * navegación y de metacognición, y el índice las lista igual. Entraban al camino
 * como paradas y generaban su apunte — un apunte hecho de las preguntas de una
 * prueba. Ver `esParadaEnsenable` en packages/rag/src/sections.ts, que es donde
 * vive el criterio y de dónde salen los ejemplos medidos.
 *
 * ⚠️ NO REGENERA LOS PLANES CON EL MODELO. `plans generar --forzar` rehace las 34
 * materias llamando al LLM para reescribir los títulos de unidad, y eso son
 * horas para un cambio que solo afecta a QUÉ LECCIONES cuelgan de cada unidad.
 * Acá se poda la lista guardada y listo; las regeneraciones futuras aplican el
 * filtro solas desde `getPlanUnits`.
 *
 * ⚠️ EL AVANCE DEL ALUMNO NO SE TOCA. `student_plan_progress` guarda `topic_key`
 * sin FK, así que las filas de una parada podada quedan huérfanas — y está bien:
 * son inertes, no rompen nada, y si algún día la parada vuelve, el avance vuelve
 * con ella. Borrarlas sería tirar información que no molesta.
 */
import { esParadaEnsenable } from "@tutor-ia/rag";
import { getSql, toJson } from "@tutor-ia/db";

const sql = getSql();
const APLICAR = process.argv.includes("--aplicar");

interface Leccion { key: string; title: string }
interface Item { lecciones?: Leccion[] }

const planes = (await sql`
  select sp.subject_id, s.name, sp.items
  from subject_plans sp join subjects s on s.id = sp.subject_id
  order by s.name`) as unknown as { subject_id: string; name: string; items: Item[] }[];

let paradasAntes = 0, paradasDespues = 0, materiasTocadas = 0;
const podadas: { materia: string; key: string; title: string }[] = [];

for (const p of planes) {
  let cambio = false;
  const nuevos = (p.items ?? []).map((it) => {
    const lecc = it.lecciones ?? [];
    paradasAntes += lecc.length;
    const quedan = lecc.filter((l) => esParadaEnsenable(l.title ?? ""));
    paradasDespues += quedan.length;
    if (quedan.length !== lecc.length) {
      cambio = true;
      for (const l of lecc) {
        if (!esParadaEnsenable(l.title ?? "")) podadas.push({ materia: p.name, key: l.key, title: l.title });
      }
    }
    return quedan.length === lecc.length ? it : { ...it, lecciones: quedan };
  });
  if (!cambio) continue;
  materiasTocadas++;
  if (APLICAR) {
    await sql`update subject_plans set items = ${toJson(sql, nuevos)}
              where subject_id = ${p.subject_id}`;
  }
}

const porTitulo = new Map<string, number>();
for (const x of podadas) porTitulo.set(x.title, (porTitulo.get(x.title) ?? 0) + 1);
console.log(`${paradasAntes} paradas → ${paradasDespues} (${podadas.length} podadas en ${materiasTocadas} materias)\n`);
for (const [t, n] of [...porTitulo].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${t}`);
}

// Los apuntes y clases YA generados de esas paradas quedan colgando: nadie va a
// poder abrirlos, pero ocupan y confunden cualquier conteo de cobertura.
const claves = podadas.map((x) => x.key);
if (claves.length > 0) {
  const [{ n: apuntes }] = (await sql`
    select count(*)::int as n from lesson_notes where topic_key = any(${claves})`) as unknown as { n: number }[];
  const [{ n: clases }] = (await sql`
    select count(*)::int as n from lesson_classes where topic_key = any(${claves})`) as unknown as { n: number }[];
  const [{ n: progreso }] = (await sql`
    select count(*)::int as n from student_plan_progress where topic_key = any(${claves})`) as unknown as { n: number }[];
  console.log(`\n${apuntes} apuntes y ${clases} clases quedaron sin parada que los abra.`);
  console.log(`${progreso} filas de avance del alumno apuntan a una parada podada (NO se tocan: son inertes).`);
  if (APLICAR && (apuntes > 0 || clases > 0)) {
    await sql`delete from lesson_notes where topic_key = any(${claves})`;
    await sql`delete from lesson_classes where topic_key = any(${claves})`;
    console.log(`Borrados: eran contenido generado sobre páginas de evaluación.`);
  }
}

if (!APLICAR) console.log(`\nEnsayo: no se escribió nada. Con --aplicar se poda.`);
await sql.end();
