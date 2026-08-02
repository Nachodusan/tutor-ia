/**
 * AUDITORÍA DEL PLAN DE ESTUDIO — ¿los temas son plausibles?
 *
 * No hay un golden de planes contra el cual comparar, así que se mide la FORMA:
 * un tema real de un libro escolar ocupa un bloque contiguo de páginas, viene en
 * orden, no se solapa con el siguiente, tiene un título que parece un título, y
 * su título aparece dentro de su propio rango. Esa última —el anclaje— es la más
 * fuerte: si el título del tema no está en sus páginas, el rango está mal.
 *
 * Uso: pnpm --filter @tutor-ia/eval plan-audit
 */
import { getPlanTopics, enChunk, norm } from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";

/**
 * Títulos que NO son temas de estudio: el síntoma que originó todo esto.
 *
 * Deliberadamente ESPECÍFICOS. Una primera versión usaba "cómo se organiza" y
 * marcaba como basura la lección real "¿Cómo se organiza la vida en nuestro
 * planeta?" — un detector que castiga contenido legítimo es peor que no tenerlo.
 */
const BASURA = [
  /organizaci[óo]n del texto/i,
  /c[óo]mo se organiza tu texto/i,
  /c[óo]mo es tu libro/i,
  /\bqu[ée] ver\b\s*[?¿]/i,   // con el signo: "qué ver" suelto matchea "qué vergüenza"
];

/** Un título que ES el índice o un fragmento de portadilla, no un tema. */
const esFuga = (t: string): boolean =>
  /^índice\b|^indice\b|^ÍNDICE/i.test(t.trim()) || /magíster|licenciad[oa] en|universidad de/i.test(t);

async function main() {
  const sql = getSql();
  const materias = await sql<{ id: string; name: string }[]>`
    select distinct s.id, s.name from subjects s
    join documents d on d.subject_id = s.id
    where d.kind = 'content' and d.status = 'ready'
    order by s.name`;

  let conPlan = 0, sinPlan = 0, deIndice = 0, deLegacy = 0;
  let temas = 0, spanOk = 0, tituloOk = 0, ancladas = 0, anclaEval = 0;
  let monotonia = 0, solape = 0, docsEval = 0;
  const sospechosas: string[] = [];

  for (const m of materias) {
    const t = await getPlanTopics(m.id, { limit: 14 });
    if (t.length < 3) { sinPlan++; continue; }
    conPlan++;
    if (t[0]!.source === "index") deIndice++; else deLegacy++;

    // Monotonía y no solape, por documento.
    const porDoc = new Map<string, typeof t>();
    for (const x of t) porDoc.set(x.documentId, [...(porDoc.get(x.documentId) ?? []), x]);
    for (const [, lista] of porDoc) {
      docsEval++;
      let ok = true;
      for (let i = 1; i < lista.length; i++) {
        if (lista[i]!.pageStart <= lista[i - 1]!.pageStart) ok = false;
        if (lista[i]!.pageStart <= lista[i - 1]!.pageEnd) solape++;
      }
      if (ok) monotonia++;
    }

    for (const x of t) {
      temas++;
      const span = x.pageEnd - x.pageStart;
      if (span >= 0 && span <= 60) spanOk++;
      const esBasura = BASURA.some((b) => b.test(x.title)) || esFuga(x.title);
      const palabras = x.title.trim().split(/\s+/).length;
      if (!esBasura && (palabras >= 3 || x.title.trim().endsWith("?"))) tituloOk++;
      if (esBasura) sospechosas.push(`${m.name}: «${x.title.slice(0, 50)}»`);
      // Anclaje: ¿el título aparece dentro de su propio rango? Solo para los que
      // vienen del índice (los legacy no tienen título real que anclar).
      if (x.source === "index") {
        const rows = await sql<{ content: string }[]>`
          select content from chunks
          where document_id = ${x.documentId} and corpus_role = 'content'
            and coalesce(page_start, page) <= ${x.pageEnd}
            and coalesce(page_end, page)   >= ${x.pageStart}`;
        anclaEval++;
        if (rows.some((r) => enChunk(x.title, norm(r.content)) >= 0.7)) ancladas++;
      }
    }
  }

  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
  console.log(`\n📐 Auditoría del plan de estudio · ${materias.length} materias\n`);
  console.log(`  materias CON plan:        ${conPlan}   (del índice: ${deIndice} · legacy saneado: ${deLegacy})`);
  console.log(`  materias SIN plan:        ${sinPlan}   ← muestran el mensaje de "no puedo leer el índice"`);
  console.log(`  temas evaluados:          ${temas}\n`);
  console.log(`  span plausible (0-60 págs):        ${pct(spanOk, temas)}   objetivo ≥95%   (antes: 72%)`);
  console.log(`  título no basura:                  ${pct(tituloOk, temas)}   objetivo ≥95%`);
  console.log(`  anclaje (título dentro del rango): ${pct(ancladas, anclaEval)}   objetivo ≥90%   (n=${anclaEval})`);
  console.log(`  documentos monótonos:              ${pct(monotonia, docsEval)}   objetivo 100%`);
  console.log(`  solapes de rango:                  ${solape}   objetivo 0`);
  if (sospechosas.length) {
    console.log(`\n  ⚠️ títulos que NO deberían ser temas (${sospechosas.length}):`);
    for (const s of sospechosas.slice(0, 10)) console.log(`     · ${s}`);
  } else {
    console.log(`\n  ✓ ningún título del tipo "Organización del texto de estudio"`);
  }
  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
