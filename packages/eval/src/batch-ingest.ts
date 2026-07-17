/**
 * BATCH de ingesta (Plan v3) — todos los libros de la básica, con roles tipados.
 * RESUMABLE: saltea documentos ya ingestados (status='ready'), así sobrevive
 * interrupciones y se puede re-correr. Robusto: un PDF que falla no tumba el batch.
 *
 * Uso:
 *   EVAL_USER_ID=... pnpm --filter @tutor-ia/eval batch-ingest [rootDir]
 *   BATCH_DRY=1 ... → solo clasifica y cuenta, sin extraer ni embeber.
 */
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { getSql } from "@tutor-ia/db";
import { ingestCurriculum, type CorpusKind } from "@tutor-ia/rag";

const ROOT = process.argv[2] ?? "/Users/dusan/Documents/libros/basica";
const uid = process.env.EVAL_USER_ID!;
const DRY = process.env.BATCH_DRY === "1";

const PED_RE = /gu[íi]a_did[áa]ctica|teacher.?s_guide/i;
const CON_RE = /texto_del_estudiante|leo_primero|student.?s_book/i;

/** Clasifica un PDF por nombre. Pedagogía se chequea PRIMERO (hay "GDD de leo_primero"). */
function classify(fname: string): CorpusKind | null {
  if (PED_RE.test(fname)) return "pedagogy";
  if (CON_RE.test(fname)) return "content";
  return null; // cuaderno, láminas, recortable, activity_book → fuera
}

const GRADE_RE = /^(\d+)_/;
// Capitaliza la 1ª letra de cada palabra (Unicode-safe; \b\w rompe con acentos).
const prettySubject = (s: string) =>
  s.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

async function main() {
  if (!uid) { console.error("❌ Falta EVAL_USER_ID"); process.exit(2); }
  const sql = getSql();

  const grades = (await readdir(ROOT)).filter((g) => /_(b[áa]sico|medio)$/i.test(g)).sort();
  let done = 0, skipped = 0, failed = 0, totalChunks = 0;
  const t0 = Date.now();

  for (const gradeDir of grades) {
    const gradeNum = GRADE_RE.exec(gradeDir)?.[1];
    const isMedio = /medio/i.test(gradeDir);
    const grade = gradeNum ? `${gradeNum}${isMedio ? "M" : "B"}` : gradeDir;
    const gradePath = join(ROOT, gradeDir);
    for (const subjDir of (await readdir(gradePath)).sort()) {
      const subjPath = join(gradePath, subjDir);
      if (!(await stat(subjPath)).isDirectory()) continue;
      const subjectArea = subjDir;
      // " Medio" solo en media: mantiene estables los títulos de básica (resumable)
      // y evita colisión de nombres entre "Matemática 1º" (básica) y media.
      const subjectName = `${prettySubject(subjDir)} ${gradeNum ?? gradeDir}º${isMedio ? " Medio" : ""}`;

      const files = (await readdir(subjPath)).filter((f) => f.toLowerCase().endsWith(".pdf"));
      const targets = files.map((f) => ({ f, kind: classify(f) })).filter((x) => x.kind);
      if (targets.length === 0) continue;

      // Materia idempotente por nombre (una por grado×asignatura).
      let subjectId: string;
      const found = await sql<{ id: string }[]>`select id from subjects where user_id=${uid} and name=${subjectName} limit 1`;
      if (found[0]) subjectId = found[0].id;
      else {
        const [ins] = await sql<{ id: string }[]>`
          insert into subjects (user_id, name, description) values (${uid}, ${subjectName}, 'Básica — doble corpus') returning id`;
        subjectId = ins!.id;
      }

      for (const { f, kind } of targets) {
        const title = `${subjectName} — ${basename(f, ".pdf").replace(/_/g, " ")}`;
        // Resumable: si ya está ready, saltear.
        const existing = await sql<{ status: string }[]>`
          select status from documents where owner_user_id=${uid} and title=${title} limit 1`;
        if (existing[0]?.status === "ready") { skipped++; continue; }

        if (DRY) { console.log(`  [dry] ${grade}/${subjectArea} · ${kind} · ${f}`); done++; continue; }

        // Documento (borra intento previo no-ready para reingesta limpia).
        await sql`delete from documents where owner_user_id=${uid} and title=${title}`;
        const [doc] = await sql<{ id: string }[]>`
          insert into documents (owner_user_id, subject_id, title, source_type, kind, grade, subject_area, status)
          values (${uid}, ${subjectId}, ${title}, 'pdf', ${kind}, ${grade}, ${subjectArea}, 'pending') returning id`;
        const tt = Date.now();
        try {
          const { chunks } = await ingestCurriculum({ documentId: doc!.id, pdfPath: join(subjPath, f), kind: kind! });
          totalChunks += chunks; done++;
          console.log(`  ✅ ${grade}/${subjectArea} · ${kind} · ${basename(f)} → ${chunks} chunks (${((Date.now() - tt) / 1000).toFixed(0)}s)`);
        } catch (e) {
          failed++;
          console.log(`  ❌ ${grade}/${subjectArea} · ${basename(f)} → ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`BATCH ${DRY ? "(dry-run) " : ""}— ${done} ingestados, ${skipped} saltados (ya ready), ${failed} fallidos`);
  console.log(`${totalChunks} chunks · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
