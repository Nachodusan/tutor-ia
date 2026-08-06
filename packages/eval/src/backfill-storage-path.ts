/**
 * BACKFILL de `documents.storage_path` — el paso que vuelve NO DESTRUCTIVA a la
 * re-ingesta.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 * `batch-ingest` identifica un documento por su TÍTULO, y el título sale de
 * `titleFor()`, que empieza por `subjectNameFor()` — el nombre VISIBLE de la
 * materia. Así que la identidad del documento en la base depende de un texto de
 * presentación. Y como la re-ingesta hace `delete from documents where title=`
 * seguido de un `insert`, **el uuid del documento cambia en cada corrida**.
 *
 * Eso no es un detalle de implementación: `topic_key = hash(documentId|ord|title)`
 * (sections.ts) es la identidad del PROGRESO DEL ALUMNO. Con el uuid nuevo, las
 * filas de `student_plan_progress` y `student_weak_topics` quedan huérfanas y el
 * chico ve su barra de progreso en cero y su lista de "Para reforzar" vacía. Sin
 * error, sin log, sin FK que lo impida.
 *
 * `storage_path` (la ruta del PDF dentro del corpus) es la llave estable que
 * siempre debió usarse: no cambia porque alguien edite un nombre para que se lea
 * mejor en la pantalla del alumno. Hoy está NULL en 213 de 218 documentos porque
 * recién se empezó a guardar hace poco.
 *
 * Este script la rellena matcheando por el título actual —el único puente que
 * existe entre lo que está en la base y el manifiesto— y crea el índice único
 * que habilita el UPSERT. Es IDEMPOTENTE: correrlo dos veces no cambia nada.
 *
 *   pnpm --filter @tutor-ia/eval backfill-storage-path            # informa
 *   pnpm --filter @tutor-ia/eval backfill-storage-path -- --aplicar
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql } from "@tutor-ia/db";
import { loadManifest, titleFor, type ManifestRow } from "./corpus-manifest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MANIFEST = process.argv.find((a) => a.endsWith(".csv")) ?? resolve(HERE, "../corpus-manifest.csv");

const APLICAR = process.argv.includes("--aplicar");

async function main(): Promise<void> {
  const sql = getSql();
  const rows: ManifestRow[] = await loadManifest(MANIFEST);
  const porTitulo = new Map<string, ManifestRow>();
  for (const r of rows) porTitulo.set(titleFor(r), r);

  const docs = await sql<{ id: string; title: string; storage_path: string | null }[]>`
    select id, title, storage_path from documents where owner_user_id is null order by title`;

  const aRellenar: { id: string; title: string; ruta: string }[] = [];
  const yaTiene: string[] = [];
  const sinMatch: string[] = [];
  for (const d of docs) {
    if (d.storage_path) { yaTiene.push(d.title); continue; }
    const row = porTitulo.get(d.title);
    if (!row) { sinMatch.push(d.title); continue; }
    aRellenar.push({ id: d.id, title: d.title, ruta: row.ruta });
  }

  console.log(
    `📎 storage_path — ${docs.length} documentos del corpus\n` +
      `   ya lo tienen:    ${yaTiene.length}\n` +
      `   se pueden llenar: ${aRellenar.length}\n` +
      `   SIN match en el manifiesto: ${sinMatch.length}${sinMatch.length ? "  ⚠️" : ""}`,
  );
  for (const t of sinMatch.slice(0, 10)) console.log(`      · ${t}`);
  if (sinMatch.length > 10) console.log(`      … y ${sinMatch.length - 10} más`);

  // Dos documentos distintos no pueden apuntar al mismo PDF: si pasa, el UPSERT
  // por storage_path uniría dos filas y perdería una. Se detecta ANTES de tocar
  // nada, porque después sería una corrupción silenciosa.
  const rutas = new Map<string, string[]>();
  for (const a of [...aRellenar, ...docs.filter((d) => d.storage_path).map((d) => ({ ruta: d.storage_path!, title: d.title }))]) {
    const l = rutas.get(a.ruta) ?? [];
    l.push(a.title);
    rutas.set(a.ruta, l);
  }
  const dup = [...rutas.entries()].filter(([, v]) => v.length > 1);
  if (dup.length) {
    console.error(`\n❌ ${dup.length} rutas apuntadas por MÁS DE UN documento. El UPSERT las uniría:`);
    for (const [ruta, titulos] of dup.slice(0, 5)) console.error(`   ${ruta}\n      ${titulos.join("\n      ")}`);
    console.error(`\nResolvé los duplicados antes de aplicar.`);
    process.exit(1);
  }

  if (!APLICAR) {
    console.log(`\n(dry-run) Volvé a correr con --aplicar para escribir.`);
    await sql.end();
    return;
  }

  let n = 0;
  for (const a of aRellenar) {
    await sql`update documents set storage_path = ${a.ruta} where id = ${a.id}::uuid`;
    n++;
  }
  // Índice ÚNICO PARCIAL: solo sobre el corpus global (owner_user_id is null).
  // Sin el `where`, el día que un colegio suba su propio PDF con la misma ruta
  // relativa chocaría contra el del currículo.
  await sql`
    create unique index if not exists idx_documents_storage_path_global
      on documents (storage_path) where owner_user_id is null and storage_path is not null`;

  const [check] = await sql<{ faltan: number }[]>`
    select count(*)::int as faltan from documents
    where owner_user_id is null and storage_path is null`;
  console.log(
    `\n✅ ${n} documentos actualizados · índice único creado\n` +
      `   quedan sin storage_path: ${check!.faltan}` +
      (check!.faltan ? "  ⚠️ esos NO se pueden re-ingestar sin destruir su id" : ""),
  );
  await sql.end();
}

await main();
process.exit(0);
