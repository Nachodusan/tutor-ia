/**
 * CLI: ingesta del material EPJA del Mineduc (epja.mineduc.cl) al corpus.
 *
 *   pnpm --filter @tutor-ia/eval ingest-epja --plan <plan.json> [--dry]
 *
 * A DIFERENCIA de `index-book`, este NO crea materias: cuelga cada documento de
 * una materia que YA existe. El plan dice, para cada par (documento EPJA,
 * materia), qué se inserta; lo arma `plan-epja.py` a partir de los huecos reales
 * del camino de cada materia, no por regla general.
 *
 * Por qué `corpus_role='content'`: el Texto Cuaderno y las Guías de Aprendizaje
 * son el material oficial de la modalidad EPJA — el libro del alumno adulto, no
 * material del profe. Entra citable, como los textos del Mineduc que ya están.
 *
 * `storage_path` lleva el curso adentro (`epja/<curso>/<asig>/<id>.pdf`) porque
 * hay un UNIQUE global sobre esa columna para los documentos sin dueño: el mismo
 * PDF colgado de dos cursos necesita dos rutas distintas. Es la misma forma en
 * que ya conviven los tomos "1º y 2º Medio" del Mineduc.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getSql } from "@tutor-ia/db";
import { ingestDocumentV2, type SidecarDoc } from "@tutor-ia/rag";

interface PlanItem {
  moduloId: string;
  sidecarPath: string;
  titulo: string;
  fuenteUrl: string;
  subjectId: string;
  materia: string;
  curso: string;
  subjectArea: string;
  storagePath: string;
}

const rp = (p: string) => (isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p));

async function main() {
  const pi = process.argv.indexOf("--plan");
  if (pi === -1) { console.error("Falta --plan <plan.json>"); process.exit(2); }
  const dry = process.argv.includes("--dry");
  const plan = JSON.parse(readFileSync(rp(process.argv[pi + 1]!), "utf8")) as PlanItem[];
  const sql = getSql();

  console.log(`\n📥 Plan: ${plan.length} pares (documento EPJA × materia)${dry ? "  [DRY RUN]" : ""}\n`);
  let ok = 0, fail = 0, chunks = 0, saltados = 0;

  for (const [i, it] of plan.entries()) {
    const pref = `[${String(i + 1).padStart(3)}/${plan.length}] ${it.moduloId} → ${it.materia}`;
    // Idempotente: si ya está ingerido con chunks, no se repite.
    // Idempotencia: tiene que estar 'ready' Y con chunks. Mirar solo los chunks
    // deja pasar los documentos que se cortaron a la mitad (timeout de la API de
    // embeddings): quedan con chunks parciales y status 'error', y un reintento
    // los saltearía creyéndolos hechos.
    const [ya] = await sql<{ id: string; n: number; status: string }[]>`
      select d.id, d.status, count(c.id)::int as n from documents d
      left join chunks c on c.document_id = d.id
      where d.storage_path = ${it.storagePath} group by d.id, d.status`;
    if (ya && ya.n > 0 && ya.status === "ready") { console.log(`${pref}  ya estaba (${ya.n} chunks)`); saltados++; continue; }
    if (ya && ya.status !== "ready") console.log(`${pref}  reintentando (quedó ${ya.status} con ${ya.n} chunks)`);
    if (dry) { console.log(`${pref}  [dry]`); continue; }

    const doc = JSON.parse(readFileSync(rp(it.sidecarPath), "utf8")) as SidecarDoc;
    const [row] = await sql<{ id: string }[]>`
      insert into documents (owner_user_id, subject_id, title, source_type, status,
                             kind, grade, subject_area, storage_path)
      values (null, ${it.subjectId}::uuid, ${it.titulo}, 'pdf', 'pending',
              'content', ${it.curso}, ${it.subjectArea}, ${it.storagePath})
      on conflict (storage_path) where owner_user_id is null and storage_path is not null
      do update set title = excluded.title
      returning id`;
    try {
      const r = await ingestDocumentV2({ documentId: row!.id, doc, corpusRole: "content" });
      chunks += r.chunks; ok++;
      console.log(`${pref}  ✓ ${r.chunks} chunks`);
    } catch (e) {
      fail++;
      console.log(`${pref}  ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nListo: ${ok} ingeridos · ${saltados} ya estaban · ${fail} fallaron · ${chunks} chunks nuevos`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
