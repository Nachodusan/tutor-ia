/**
 * BACKFILL de `chunks.heading_path` para el CONTENIDO, desde `book_sections`.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 * 0 de 16.548 chunks de contenido tienen `heading_path` (los de pedagogía sí, por
 * otra vía). La causa está en `extract_curriculum.py:111`: usa `get_text()`, que
 * devuelve texto plano, así que `RE_HEADING` de clean.ts nunca matchea un `#` y
 * la pila de headings de `chunk-structural.ts` queda siempre vacía.
 *
 * El efecto que ve el alumno: la cita dice "Biología · 1º Medio · pág. 136" y
 * nada más. No puede saber de qué lección salió sin ir a buscar la página.
 *
 * ── Por qué desde `book_sections` y no re-extrayendo ────────────────────────
 * El índice del libro ya está parseado, curado y en la base: 1.992 secciones con
 * span medio de 4,6 páginas en nivel 2. Es JERARQUÍA REAL del libro, no la
 * inferida por tamaño de fuente que devuelve pymupdf4llm (que además cuesta 100×
 * y extrae 30% menos texto). Mapear por rango de páginas es determinístico y no
 * toca los PDFs.
 *
 * ── Por qué solo el 43,8% ───────────────────────────────────────────────────
 * Solo se etiqueta cuando la sección es de NIVEL 2 y su span es ≤20 páginas.
 * Los 2.899 chunks que caen dentro de secciones gigantes (una "lección" de 60
 * páginas es un fallo del parser, no una lección) se dejan en NULL a propósito:
 * un breadcrumb equivocado es peor que ninguno, porque convierte un fallo de
 * retrieval en una cita con cara de correcta. Y 3.215 chunks son de los 47 libros
 * sin índice parseado, donde no hay nada que mapear.
 *
 * VERIFICADO antes de aplicar sobre 14 citas al azar: 14/14 nombran la lección
 * correcta ("¿Qué funciones cumple el sistema nervioso?" sobre un texto de
 * reflejos, "La metamorfosis, Franz Kafka" sobre Gregor y su carpintería).
 *
 *   pnpm --filter @tutor-ia/eval backfill-heading-path            # informa
 *   pnpm --filter @tutor-ia/eval backfill-heading-path -- --aplicar
 */
import { getSql } from "@tutor-ia/db";

const APLICAR = process.argv.includes("--aplicar");
/** Una sección de más de 20 páginas no es una lección: es el parser fallando. */
const MAX_SPAN = Number(process.env.HEADING_MAX_SPAN ?? "20");

async function main(): Promise<void> {
  const sql = getSql();

  const [antes] = await sql<{ total: number; con: number }[]>`
    select count(*)::int as total,
           count(heading_path)::int as con
      from chunks where corpus_role = 'content'`;

  const [cand] = await sql<{ n: number }[]>`
    select count(*)::int as n from chunks ch
     where ch.corpus_role = 'content'
       and exists (
         select 1 from book_sections bs
          where bs.document_id = ch.document_id and bs.level = 2
            and coalesce(ch.page_start, ch.page) between bs.page_start and bs.page_end
            and bs.page_end - bs.page_start <= ${MAX_SPAN})`;

  console.log(
    `📖 heading_path en contenido\n` +
      `   chunks de contenido:       ${antes!.total}\n` +
      `   con heading_path ahora:    ${antes!.con}\n` +
      `   se pueden etiquetar:       ${cand!.n} (${((100 * cand!.n) / antes!.total).toFixed(1)}%)\n` +
      `   quedan en NULL:            ${antes!.total - cand!.n} (sin índice, o sección de más de ${MAX_SPAN} págs)`,
  );

  if (!APLICAR) {
    const muestra = await sql<{ pag: number; sec: string; texto: string }[]>`
      select coalesce(ch.page_start, ch.page) as pag,
             (select bs.title from book_sections bs
               where bs.document_id = ch.document_id and bs.level = 2
                 and coalesce(ch.page_start, ch.page) between bs.page_start and bs.page_end
                 and bs.page_end - bs.page_start <= ${MAX_SPAN}
               order by bs.page_end - bs.page_start asc limit 1) as sec,
             left(regexp_replace(ch.content, '\\s+', ' ', 'g'), 90) as texto
        from chunks ch
       where ch.corpus_role = 'content' and ch.heading_path is null
       order by random() limit 8`;
    console.log(`\n   muestra de lo que quedaría (para juzgar leyendo):`);
    for (const m of muestra.filter((x) => x.sec)) {
      console.log(`     pág. ${m.pag} § ${m.sec}\n        ↳ ${m.texto}`);
    }
    console.log(`\n(dry-run) Volvé a correr con --aplicar para escribir.`);
    await sql.end();
    return;
  }

  // Un solo UPDATE correlacionado: la sección de NIVEL 2 más ajustada que
  // contiene la página del chunk. `heading_path is null` lo hace idempotente y
  // además impide pisar los de pedagogía, que ya lo traen del encabezado del
  // bloque.
  const res = await sql`
    update chunks ch
       set heading_path = bs.title
      from book_sections bs
     where bs.document_id = ch.document_id
       and bs.level = 2
       and coalesce(ch.page_start, ch.page) between bs.page_start and bs.page_end
       and bs.page_end - bs.page_start <= ${MAX_SPAN}
       and ch.corpus_role = 'content'
       and ch.heading_path is null
       and bs.id = (
         select bs2.id from book_sections bs2
          where bs2.document_id = ch.document_id and bs2.level = 2
            and coalesce(ch.page_start, ch.page) between bs2.page_start and bs2.page_end
            and bs2.page_end - bs2.page_start <= ${MAX_SPAN}
          order by bs2.page_end - bs2.page_start asc, bs2.ord asc
          limit 1)`;

  const [despues] = await sql<{ con: number }[]>`
    select count(heading_path)::int as con from chunks where corpus_role = 'content'`;
  console.log(
    `\n✅ ${res.count} chunks etiquetados · ahora con heading_path: ${despues!.con}/${antes!.total}` +
      ` (${((100 * despues!.con) / antes!.total).toFixed(1)}%)`,
  );
  console.log(
    `   El texto del chunk NO se tocó: esto solo cambia la CITA que ve el alumno\n` +
      `   ("Biología · 1º Medio · pág. 136 · ¿Qué funciones cumple el sistema nervioso?").`,
  );
  await sql.end();
}

await main();
process.exit(0);
