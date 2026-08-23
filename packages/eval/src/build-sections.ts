/**
 * Deriva `book_sections` a partir del ÍNDICE de cada libro de contenido.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval build-sections --dry-run     # no escribe nada
 *   pnpm --filter @tutor-ia/eval build-sections --all
 *   pnpm --filter @tutor-ia/eval build-sections --doc "Historia"
 *
 * No toca la ingesta ni los chunks: solo lee `chunks.content` ya ingestado.
 *
 * ⚠️ BORRA LAS UNIDADES DE NIVEL 1, QUE LAS HACE OTRO JOB.
 * Al reescribir las secciones de un documento se lleva puestas las filas de
 * `level = 1` que produjo `build-units`. Sin ellas `getPlanUnits` devuelve vacío
 * y `buildStudyPlan` cae al camino plano: el alumno pierde las unidades y las
 * lecciones dejan de anidar. Pasó el 2026-08-23 — las 34 materias vivas quedaron
 * con planes de cero lecciones.
 *
 * EL ORDEN COMPLETO, y hay que correrlo entero:
 *   1. pnpm --filter @tutor-ia/eval build-sections --all
 *   2. pnpm --filter @tutor-ia/eval build-units
 *   3. psql -f packages/db/schema_book_sections_limpieza.sql   (fin de libro)
 *   4. psql -f packages/db/schema_book_sections_titulos.sql    (puntos guía)
 *   5. pnpm --filter @tutor-ia/admin plans generar --forzar    (las claves de
 *      tema son hash de documento+ord+título: si cambia el índice, cambian)
 */
import { buildSectionsForDocument } from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const filtroIdx = args.indexOf("--doc");
const FILTRO = filtroIdx >= 0 ? args[filtroIdx + 1] : null;

async function main() {
  const sql = getSql();
  const docs = await sql<{ id: string; title: string; materia: string }[]>`
    select d.id, d.title, s.name as materia
    from documents d join subjects s on s.id = d.subject_id
    where d.kind = 'content' and d.status = 'ready'
      ${FILTRO ? sql`and (d.title ilike ${"%" + FILTRO + "%"} or s.name ilike ${"%" + FILTRO + "%"})` : sql``}
    order by s.name`;

  console.log(`\n📚 Secciones por índice — ${docs.length} libros${DRY ? " · SIMULACRO (no escribe)" : ""}\n`);

  let a = 0, b = 0, sin = 0, temas = 0;
  const fallos: string[] = [];
  for (const d of docs) {
    const r = await buildSectionsForDocument(d.id, { dryRun: DRY });
    const lecciones = r.sections.filter((s) => s.level === 2).length;
    if (r.tier === "A") a++;
    else if (r.tier === "B") b++;
    else { sin++; fallos.push(`${d.materia} — ${r.motivo ?? "?"}`); }
    temas += lecciones;
    const marca = r.tier ? `tier ${r.tier}` : "sin índice";
    console.log(`  ${marca.padEnd(11)} ${String(lecciones).padStart(3)} temas  ${d.materia}${r.motivo ? `  (${r.motivo})` : ""}`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  tier A (índice con folios): ${a}`);
  console.log(`  tier B (índice sin folios): ${b}`);
  console.log(`  sin índice legible:         ${sin}   → caen al fallback saneado`);
  console.log(`  temas totales:              ${temas}`);
  if (fallos.length) {
    console.log(`\n  los ${fallos.length} sin índice:`);
    for (const f of fallos.slice(0, 20)) console.log(`    · ${f}`);
  }
  if (DRY) console.log(`\n  (simulacro: la base NO se modificó)`);
  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
