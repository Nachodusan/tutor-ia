/**
 * BATCH de ingesta — guiado por el MANIFIESTO, no por regex sobre el nombre.
 *
 * RESUMABLE: saltea documentos ya ingestados (status='ready'), así sobrevive
 * interrupciones y se puede re-correr.
 *
 * Uso:
 *   EVAL_USER_ID=... pnpm --filter @tutor-ia/eval batch-ingest [rootDir] [manifestCsv]
 *   BATCH_DRY=1 ... → valida y cuenta, sin extraer ni embeber.
 *
 * QUÉ CAMBIÓ Y POR QUÉ. Antes la clasificación era `PED_RE`/`CON_RE` sobre el
 * nombre de archivo, y fallaba en silencio en las dos direcciones:
 *   · `teacher´s_book_–_volumen_{1,2}` (inglés 1º y 2º medio) no matcheaba
 *     `teacher.?s_guide` → 4 guías docentes desaparecieron sin un warning, y
 *     esas materias figuraban como "sin GDD" aunque el archivo estaba en disco.
 *   · `leo_primero_cuaderno_de_actividades` sí matcheaba `leo_primero` → 4
 *     cuadernos de ejercicios entraron como contenido citable y contaminaron el
 *     retrieval del alumno con actividades sin resolver.
 * Ahora la verdad la fija el manifiesto y el disco tiene que coincidir con él
 * EXACTAMENTE, o la corrida aborta antes de tocar la base.
 *
 * `tipo` (qué es) e `indexado` (si entra a la búsqueda) son campos separados a
 * propósito: los ejercicios se registran con indexado=false en vez de tirarse,
 * porque se van a usar para generar pruebas. Ahí será cambiar el flag y
 * re-indexar, no volver a extraer y re-embeber todo el PDF.
 */
import { join, resolve } from "node:path";
import { getSql } from "@tutor-ia/db";
import { ingestCurriculum, type CorpusKind } from "@tutor-ia/rag";
import {
  ManifestError,
  assertCorpusMatchesManifest,
  assertNombresVisibles,
  gradeFor,
  loadManifest,
  subjectNameFor,
  titleFor,
  type ManifestRow,
} from "./corpus-manifest";
import { librosDir } from "./lib/libros";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = librosDir(process.argv[2]);   // ver lib/libros.ts: no hay default
const MANIFEST = process.argv[3] ?? resolve(HERE, "../corpus-manifest.csv");
const uid = process.env.EVAL_USER_ID!;
const DRY = process.env.BATCH_DRY === "1";
/**
 * Re-ingerir UN libro sin tocar los otros 217. Filtra por substring de la ruta.
 *
 * Hace falta para trabajar por libro con puntos de control —que es la única forma
 * segura de cambiar la extracción— y para no arrastrar los 5 documentos en
 * `status='error'` dentro de un experimento que mide otra cosa. El chequeo de
 * huérfanos y la validación disco≡manifiesto siguen corriendo sobre el manifiesto
 * COMPLETO: filtrar qué se ingiere no puede aflojar qué se valida.
 */
const SOLO = process.env.INGEST_SOLO?.trim() || null;

/** El corpus tipado de la base solo distingue contenido de pedagogía. Los
 *  ejercicios no se indexan, así que no necesitan rol propio. */
function corpusKind(row: ManifestRow): CorpusKind {
  return row.tipo === "pedagogia" ? "pedagogy" : "content";
}

/** Dos filas no pueden producir el mismo título: la segunda se perdería. */
function assertTitulosUnicos(rows: ManifestRow[]): void {
  const m = new Map<string, string[]>();
  for (const r of rows.filter((x) => x.indexado)) {
    const k = titleFor(r);
    m.set(k, [...(m.get(k) ?? []), r.ruta]);
  }
  const dup = [...m].filter(([, v]) => v.length > 1);
  if (dup.length) {
    console.error(
      `❌ ${dup.length} título(s) de documento colisionan: dos filas del manifiesto\n` +
        `   producirían el mismo registro y una se perdería.\n\n` +
        dup.map(([k, v]) => `     "${k}"\n${v.map((x) => `       · ${x}`).join("\n")}`).join("\n") +
        `\n`,
    );
    process.exit(1);
  }
}

async function main() {
  if (!uid) {
    console.error("❌ Falta EVAL_USER_ID.");
    process.exit(2);
  }

  console.log(`\n📚 Ingesta guiada por manifiesto`);
  console.log(`   corpus:     ${ROOT}`);
  console.log(`   manifiesto: ${MANIFEST}\n`);

  // 1) Cargar y validar el manifiesto (formato, tipos, rutas duplicadas).
  // 2) REGLA DE ORO: disco ≡ manifiesto, o no se empieza.
  // Las dos cosas ANTES de abrir la base: si el corpus no está descrito por
  // completo, no se toca nada.
  let rows: ManifestRow[];
  try {
    rows = await loadManifest(MANIFEST);
    await assertCorpusMatchesManifest(ROOT, rows);
    assertNombresVisibles(rows);
  } catch (e) {
    if (e instanceof ManifestError) {
      console.error(`❌ ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  assertTitulosUnicos(rows);

  const pendientes = rows.filter((r) => r.verificar);
  // El filtro se aplica DESPUÉS de validar el manifiesto entero contra el disco:
  // acotar qué se ingiere no puede acotar qué se verifica.
  const aIndexar = rows.filter((r) => r.indexado && (!SOLO || r.ruta.includes(SOLO)));
  if (SOLO) {
    console.log(`🎯 INGEST_SOLO="${SOLO}" → ${aIndexar.length} de ${rows.filter((r) => r.indexado).length} documentos`);
    for (const r of aIndexar) console.log(`     · ${r.ruta}`);
    if (aIndexar.length === 0) {
      console.error(`❌ Ninguna ruta del manifiesto contiene "${SOLO}".`);
      process.exit(1);
    }
  }
  const materias = new Map<string, ManifestRow[]>();
  for (const r of aIndexar) {
    const k = subjectNameFor(r);
    const list = materias.get(k) ?? [];
    list.push(r);
    materias.set(k, list);
  }

  console.log(`✅ Manifiesto ≡ disco: ${rows.length} PDFs, sin diferencias.`);
  console.log(
    `   ${rows.filter((r) => r.tipo === "contenido").length} contenido · ` +
      `${rows.filter((r) => r.tipo === "pedagogia").length} pedagogía · ` +
      `${rows.filter((r) => r.tipo === "ejercicios").length} ejercicios`,
  );
  console.log(`   ${aIndexar.length} a indexar · ${rows.length - aIndexar.length} sin indexar`);
  console.log(`   ${materias.size} materias`);
  if (pendientes.length) {
    console.log(`\n⚠️  ${pendientes.length} fila(s) con verificar=si (clasificación sin confirmar):`);
    for (const r of pendientes) console.log(`     · ${r.ruta}`);
  }
  console.log("");

  // El dry-run NO ESCRIBE en la base. Antes creaba filas en `subjects` aunque
  // dijera "solo clasifica y cuenta": validar el manifiesto dejaba efectos.
  // Sí LEE, para poder reportar el delta (qué se saltea, qué se ingiere, qué
  // queda huérfano) sin tener que adivinarlo por fuera.
  if (DRY) {
    const sqlRO = getSql();
    // Por `storage_path` y no por título: el título es texto de presentación y
    // ahora puede cambiar sin que el documento deje de ser el mismo. Emparejar
    // por título haría que un retoque cosmético reportara el documento viejo
    // como huérfano y el nuevo como faltante — que es exactamente el
    // acoplamiento que este cambio vino a romper.
    const esperados = new Map(rows.filter((r) => r.indexado).map((r) => [r.ruta, r]));
    const enBase = await sqlRO<{ ruta: string | null; title: string; status: string; n: number }[]>`
      select d.storage_path as ruta, d.title, d.status, count(c.id)::int as n
      from documents d left join chunks c on c.document_id = d.id
      where d.owner_user_id is null group by d.storage_path, d.title, d.status`;
    const listos = new Set(enBase.filter((d) => d.status === "ready").map((d) => d.ruta));
    const seSaltean = [...esperados.keys()].filter((t) => listos.has(t));
    const seIngieren = [...esperados.keys()].filter((t) => !listos.has(t));
    const huerfanos = enBase.filter((d) => !d.ruta || !esperados.has(d.ruta));

    console.log(`${"═".repeat(60)}`);
    console.log(`DELTA contra la base (solo lectura):`);
    console.log(`   ya están (se saltean): ${seSaltean.length}`);
    console.log(`   se ingieren:           ${seIngieren.length}`);
    for (const t of seIngieren.slice(0, 30)) console.log(`      + ${t}`);
    if (seIngieren.length > 30) console.log(`      … y ${seIngieren.length - 30} más`);
    console.log(
      `   huérfanos en la base:  ${huerfanos.length}` +
        ` (${huerfanos.reduce((s, d) => s + d.n, 0)} chunks)`,
    );
    console.log(`\nBATCH (dry-run) — ${aIndexar.length} filas indexables · ${materias.size} materias · base NO modificada`);
    await sqlRO.end();
    process.exit(0);
  }

  const sql = getSql();

  // LA REGLA DE ORO, DEL LADO DE LA BASE. El resumable empareja por título; un
  // documento que ya está en la base y NO corresponde a ninguna fila del
  // manifiesto no se re-ingiere ni se borra: se queda indexado para siempre y el
  // alumno lo sigue viendo. Si se dejara pasar, esta corrida DUPLICARÍA el
  // corpus en vez de migrarlo.
  //
  // Hoy pasa por dos motivos reales: (a) 158 títulos viejos tienen la
  // capitalización rota tras el acento ("MatemáTica", "IngléS") por un bug ya
  // corregido en el armado del nombre, y (b) las materias "Sumo Primero Nº" y
  // "Lengua 8vo" dejan de existir al colapsar en matemática.
  //
  // No borramos por cuenta propia: eso es decisión del dueño de los datos.
  // Frenamos y lo decimos. INGEST_ALLOW_STALE=1 sigue igual, a sabiendas.
  // Emparejado por `storage_path` (la ruta del PDF), no por título: ver el
  // comentario del UPSERT más abajo. El título dejó de ser identidad.
  const esperados = new Set(rows.filter((r) => r.indexado).map((r) => r.ruta));
  const enBase = await sql<{ ruta: string | null; title: string; n: number }[]>`
    select d.storage_path as ruta, d.title, count(c.id)::int as n
    from documents d left join chunks c on c.document_id = d.id
    where d.owner_user_id is null group by d.storage_path, d.title`;
  const huerfanos = enBase.filter((d) => !d.ruta || !esperados.has(d.ruta));
  if (huerfanos.length > 0 && process.env.INGEST_ALLOW_STALE !== "1") {
    const chunks = huerfanos.reduce((s, d) => s + d.n, 0);
    console.error(
      `❌ Hay ${huerfanos.length} documento(s) en la base que el manifiesto ya no describe\n` +
        `   (${chunks} chunks). Si se ingiere ahora, el corpus queda DUPLICADO: los\n` +
        `   viejos siguen indexados y se suman los nuevos.\n\n` +
        huerfanos.slice(0, 12).map((d) => `     · ${d.title}  (${d.n} chunks)`).join("\n") +
        (huerfanos.length > 12 ? `\n     … y ${huerfanos.length - 12} más` : "") +
        `\n\n   Decidí qué hacer con ellos (migrar o borrar) y volvé a correr.\n` +
        `   Para ingerir igual, a sabiendas: INGEST_ALLOW_STALE=1\n`,
    );
    await sql.end();
    process.exit(1);
  }

  let done = 0, skipped = 0, failed = 0, totalChunks = 0;
  const t0 = Date.now();

  // Una materia por (curso × materia_canonica): `sumo_primero` colapsa dentro de
  // matemática, así que el alumno ve UNA materia y no dos.
  for (const [subjectName, filas] of [...materias].sort((a, b) => a[0].localeCompare(b[0]))) {
    const first = filas[0]!;
    const grade = gradeFor(first);
    const subjectArea = first.materiaCanonica;

    let subjectId: string;
    // El corpus oficial es GLOBAL (user_id null): es el mismo currículo para
    // todos los alumnos. Keyearlo por usuario haría que ningún documento ya
    // ingestado matcheara y la próxima corrida duplicaría los 218 en silencio.
    const found = await sql<{ id: string }[]>`
      select id from subjects where user_id is null and name=${subjectName} limit 1`;
    if (found[0]) subjectId = found[0].id;
    else {
      const [ins] = await sql<{ id: string }[]>`
        insert into subjects (user_id, name, description)
        values (null, ${subjectName}, 'Corpus MINEDUC — doble corpus') returning id`;
      subjectId = ins!.id;
    }

    for (const row of filas) {
      const title = titleFor(row);
      const kind = corpusKind(row);

      // ⚠️ LA IDENTIDAD DEL DOCUMENTO ES `storage_path`, NO EL TÍTULO.
      //
      // Antes esto buscaba por `title` y hacía `delete` + `insert`, así que el
      // uuid del documento cambiaba en CADA re-ingesta. Y `topic_key` —la
      // identidad del progreso del alumno— es `hash(documentId|ord|title)`
      // (sections.ts), sin ninguna FK que lo proteja. O sea: cada re-ingesta le
      // vaciaba la barra de progreso y la lista de "Para reforzar" a todos los
      // alumnos, en silencio. Con `titleFor()` derivando del nombre VISIBLE de
      // la materia, hasta un retoque cosmético disparaba esa cascada.
      //
      // `storage_path` es la ruta del PDF: no cambia porque alguien edite un
      // texto de pantalla. El UPSERT conserva el uuid y solo borra los CHUNKS,
      // que sí son derivados y hay que rehacer.
      const existing = await sql<{ id: string; status: string }[]>`
        select id, status from documents
        where owner_user_id is null and storage_path = ${row.ruta} limit 1`;
      if (existing[0]?.status === "ready") { skipped++; continue; }

      let docId: string;
      if (existing[0]) {
        docId = existing[0].id;
        // El título y la materia SÍ se refrescan (pueden haber cambiado en el
        // manifiesto); lo que no cambia es el id.
        await sql`
          update documents
             set subject_id = ${subjectId}, title = ${title}, kind = ${kind},
                 grade = ${grade}, subject_area = ${subjectArea}, status = 'pending'
           where id = ${docId}::uuid`;
        // Los chunks son derivados del PDF: se rehacen. `book_sections` NO se
        // toca acá — lo reconstruye `build-sections` y su `ord`/`title` entran
        // en la clave del progreso, así que borrarlo de prepo sería el mismo
        // agujero por otra puerta.
        await sql`delete from chunks where document_id = ${docId}::uuid`;
      } else {
        const [doc] = await sql<{ id: string }[]>`
          insert into documents (owner_user_id, subject_id, title, source_type, storage_path, kind, grade, subject_area, status)
          values (null, ${subjectId}, ${title}, 'pdf', ${row.ruta}, ${kind}, ${grade}, ${subjectArea}, 'pending')
          returning id`;
        docId = doc!.id;
      }
      const doc = { id: docId };
      const tt = Date.now();
      try {
        const { chunks } = await ingestCurriculum({
          documentId: doc!.id,
          pdfPath: join(ROOT, row.ruta),
          kind,
        });
        totalChunks += chunks;
        done++;
        console.log(
          `  ✅ ${grade}/${subjectArea} · ${kind} · ${row.ruta.split("/").pop()} → ${chunks} chunks (${((Date.now() - tt) / 1000).toFixed(0)}s)`,
        );
      } catch (e) {
        failed++;
        console.log(`  ❌ ${grade}/${subjectArea} · ${row.ruta} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`BATCH ${DRY ? "(dry-run) " : ""}— ${done} ingestados, ${skipped} saltados (ya ready), ${failed} fallidos`);
  console.log(`${totalChunks} chunks · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
