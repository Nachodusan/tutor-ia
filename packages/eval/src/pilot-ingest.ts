/**
 * PILOTO (Plan v3 T3) — ingesta UN par (Texto del Estudiante + GDD) con roles
 * tipados, ANTES del batch de 480. Valida chunking tipado + link + metadata.
 *
 * Uso:
 *   EVAL_USER_ID=... pnpm --filter @tutor-ia/eval pilot-ingest
 * (rutas por env PILOT_TE / PILOT_GDD1 / PILOT_GDD2 o los defaults de abajo)
 */
import { getSql } from "@tutor-ia/db";
import { ingestCurriculum, type CorpusKind } from "@tutor-ia/rag";

const DIR = "/Users/dusan/Documents/libros/basica/1_básico/ciencias_naturales";
const GRADE = "1B";
const SUBJECT_AREA = "ciencias_naturales";
const FILES: { path: string; kind: CorpusKind; title: string }[] = [
  { path: process.env.PILOT_TE ?? `${DIR}/texto_del_estudiante.pdf`, kind: "content", title: "Ciencias Naturales 1º — Texto del Estudiante" },
  { path: process.env.PILOT_GDD1 ?? `${DIR}/guía_didáctica_del_docente_–_tomo_1.pdf`, kind: "pedagogy", title: "Ciencias Naturales 1º — GDD Tomo 1" },
  { path: process.env.PILOT_GDD2 ?? `${DIR}/guía_didáctica_del_docente_–_tomo_2.pdf`, kind: "pedagogy", title: "Ciencias Naturales 1º — GDD Tomo 2" },
];

async function main() {
  const userId = process.env.EVAL_USER_ID;
  if (!userId) {
    console.error("❌ Falta EVAL_USER_ID (dueño del material).");
    process.exit(2);
  }
  const sql = getSql();

  // Materia del piloto (idempotente por nombre + usuario).
  const subjectName = "Ciencias Naturales 1º Básico";
  const [subj] = await sql<{ id: string }[]>`
    insert into subjects (user_id, name, description)
    values (null, ${subjectName}, 'Piloto doble corpus tipado')
    on conflict do nothing
    returning id
  `;
  const subjectId =
    subj?.id ??
    (await sql<{ id: string }[]>`select id from subjects where user_id is null and name=${subjectName} limit 1`)[0]!.id;
  console.log(`📚 Materia: ${subjectName} (${subjectId})`);

  for (const f of FILES) {
    // Documento (borra el previo con mismo título para re-ingestar limpio).
    await sql`delete from documents where owner_user_id is null and title=${f.title}`;
    const [doc] = await sql<{ id: string }[]>`
      insert into documents (owner_user_id, subject_id, title, source_type, kind, grade, subject_area, status)
      values (null, ${subjectId}, ${f.title}, 'pdf', ${f.kind}, ${GRADE}, ${SUBJECT_AREA}, 'pending')
      returning id
    `;
    process.stdout.write(`\n▶ ${f.kind.padEnd(8)} ${f.title} ... `);
    const t0 = Date.now();
    try {
      const { chunks } = await ingestCurriculum({ documentId: doc!.id, pdfPath: f.path, kind: f.kind });
      console.log(`✅ ${chunks} chunks (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    } catch (e) {
      console.log(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Resumen de lo ingestado.
  console.log("\n📊 Chunks del piloto:");
  const byRole = await sql`
    select corpus_role, count(*) n, count(distinct (unit,lesson)) lecciones,
           count(*) filter (where oa is not null) con_oa
    from chunks c join documents d on d.id=c.document_id
    where d.subject_id=${subjectId} group by corpus_role`;
  for (const r of byRole) console.log(`   ${r.corpus_role}: ${r.n} chunks · ${r.lecciones} lecciones · ${r.con_oa} con OA`);
  const byType = await sql`
    select pedagogy_type, count(*) n from chunks c join documents d on d.id=c.document_id
    where d.subject_id=${subjectId} and pedagogy_type is not null group by pedagogy_type order by n desc`;
  console.log("   pedagogy_type:", byType.map((r) => `${r.pedagogy_type}=${r.n}`).join(", "));

  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
