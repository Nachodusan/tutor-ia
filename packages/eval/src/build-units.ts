/**
 * Deriva las UNIDADES de cada libro de contenido (`book_sections` nivel 1).
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval build-units --dry-run    # no escribe nada
 *   pnpm --filter @tutor-ia/eval build-units
 *   pnpm --filter @tutor-ia/eval build-units --doc "Ciencias Naturales"
 *
 * El camino del alumno se arma por unidad: engloba más que una lección suelta y
 * da para enseñar de verdad en cada nodo. Las lecciones del índice (nivel 2) NO
 * se tocan — son la granularidad que después se cruza con las bases curriculares
 * del estado. Este job solo agrega la capa de arriba.
 */
import { buildUnitsForDocument } from "@tutor-ia/rag";
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

  console.log(`\n📚 Unidades por libro — ${docs.length} libros${DRY ? " · SIMULACRO (no escribe)" : ""}\n`);

  let con = 0, sin = 0, unidades = 0;
  const porTitulo = { encabezado: 0, indice: 0, generico: 0 };
  const fallos: string[] = [];

  for (const d of docs) {
    const r = await buildUnitsForDocument(d.id, { dryRun: DRY });
    if (r.sections.length === 0) {
      sin++;
      fallos.push(`${d.materia} — ${r.motivo ?? "?"}`);
      console.log(`  ${"sin unidades".padEnd(13)}   ·  ${d.materia}  (${r.motivo ?? "?"})`);
      continue;
    }
    con++;
    unidades += r.sections.length;
    for (const s of r.sections) {
      if (s.confidence >= 0.9) porTitulo.encabezado++;
      else if (s.confidence >= 0.7) porTitulo.indice++;
      else porTitulo.generico++;
    }
    console.log(`  ${String(r.sections.length).padStart(2)} unidades      ·  ${d.materia}`);
    for (const s of r.sections) {
      console.log(`       ${s.title.slice(0, 54).padEnd(56)} p.${s.pageStart}-${s.pageEnd}`);
    }
  }

  const pct = (n: number) => (unidades ? `${Math.round((100 * n) / unidades)}%` : "—");
  console.log(`\n${"═".repeat(64)}`);
  console.log(`  libros con unidades:      ${con}`);
  console.log(`  libros sin unidades:      ${sin}   → se quedan con el camino por lecciones`);
  console.log(`  unidades escritas:        ${unidades}`);
  console.log(`  título del encabezado:    ${porTitulo.encabezado}  (${pct(porTitulo.encabezado)})`);
  console.log(`  título del índice:        ${porTitulo.indice}  (${pct(porTitulo.indice)})`);
  console.log(`  sin título ("Unidad N"):  ${porTitulo.generico}  (${pct(porTitulo.generico)})`);
  if (fallos.length) {
    console.log(`\n  los ${fallos.length} sin unidades:`);
    for (const f of fallos.slice(0, 25)) console.log(`    · ${f}`);
  }
  if (DRY) console.log(`\n  (simulacro: la base NO se modificó)`);
  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
