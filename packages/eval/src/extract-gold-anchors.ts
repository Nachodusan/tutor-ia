/**
 * EXTRAE las anclas por TEXTO del golden, desde los `expect_chunks` actuales.
 *
 * Se corre UNA VEZ, mientras los uuids todavía existen: saca el texto de cada
 * chunk gold y lo guarda en `golden/gold-anchors.jsonl`. A partir de ahí el
 * golden se resuelve por contenido y sobrevive a cualquier re-chunk — que es lo
 * que `a3-set.jsonl` no tuvo y por eso está muerto (0 de sus 18 chunk_id viven).
 *
 * Verifica de paso que el archivo generado REPRODUCE los ids actuales: si las
 * anclas no encuentran hoy lo mismo que ya está anclado, no sirven para mañana.
 *
 *   pnpm --filter @tutor-ia/eval extract-gold-anchors
 */
import { readFile, writeFile } from "node:fs/promises";
import { getSql } from "@tutor-ia/db";
import { resolverAnclas, type ChunkLite, type GoldAnchor } from "./lib/gold-anchors";

const OUT = new URL("../golden/gold-anchors.jsonl", import.meta.url).pathname;
const GOLDEN = new URL("../golden/questions.jsonl", import.meta.url).pathname;

async function main(): Promise<void> {
  const sql = getSql();
  const rows = (await readFile(GOLDEN, "utf8"))
    .split("\n").filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { id: string; expect_chunks?: string[] });

  const ids = [...new Set(rows.flatMap((r) => r.expect_chunks ?? []))];
  console.log(`📌 ${rows.filter((r) => r.expect_chunks?.length).length} preguntas con ancla · ${ids.length} chunks gold`);

  const chunks = await sql<{ id: string; content: string; page: number | null; title: string }[]>`
    select c.id, c.content, coalesce(c.page_start, c.page) as page, d.title
    from chunks c join documents d on d.id = c.document_id
    where c.id = any(${ids}::uuid[])`;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const muertos = ids.filter((i) => !byId.has(i));
  if (muertos.length) {
    console.error(`\n❌ ${muertos.length} de ${ids.length} chunk_id gold YA NO EXISTEN.`);
    console.error(`   Las anclas se extraen del contenido, así que sin el chunk no hay nada que extraer.`);
    console.error(`   (Es exactamente lo que le pasó a a3-set.jsonl. Restaurá un backup o re-anclá primero.)`);
    process.exit(1);
  }

  const anclas: GoldAnchor[] = [];
  for (const r of rows) {
    for (const cid of r.expect_chunks ?? []) {
      const c = byId.get(cid)!;
      anclas.push({
        questionId: r.id,
        chunkIdOriginal: cid,
        documentTitle: c.title,
        page: c.page,
        // El texto COMPLETO del chunk, no un fragmento: el containment de
        // 4-gramas es más robusto cuanto más material tiene, y 68 chunks de
        // ~1.600 chars son ~110 KB — un archivo versionable sin drama.
        texto: c.content,
      });
    }
  }
  await writeFile(OUT, anclas.map((a) => JSON.stringify(a)).join("\n") + "\n", "utf8");
  console.log(`💾 ${anclas.length} anclas → ${OUT}`);

  // ── VERIFICACIÓN: ¿las anclas reproducen lo que ya está anclado? ──
  // Si hoy, con el MISMO corpus, no encuentran los mismos ids, entonces no son
  // un ancla: son otra cosa que casualmente estaba cerca.
  const todos = await sql<ChunkLite[]>`
    select c.id, c.content, d.title as "documentTitle"
    from chunks c join documents d on d.id = c.document_id
    where d.title = any(${[...new Set(anclas.map((a) => a.documentTitle))]})`;
  console.log(`\n🔍 Verificación contra el corpus actual (${todos.length} chunks del mismo libro):`);

  let exactas = 0, contienen = 0, fallan = 0;
  const problemas: string[] = [];
  for (const r of rows) {
    const esperados = r.expect_chunks ?? [];
    if (!esperados.length) continue;
    const mias = anclas.filter((a) => a.questionId === r.id);
    const { ids: resueltos, peorCobertura } = resolverAnclas(mias, todos);
    const set = new Set(resueltos);
    const todosPresentes = esperados.every((e) => set.has(e));
    if (todosPresentes && resueltos.length === esperados.length) exactas++;
    else if (todosPresentes) contienen++;
    else {
      fallan++;
      problemas.push(`   ✗ ${r.id}: esperaba ${esperados.map((e) => e.slice(0, 8)).join(",")} · resolvió ${resueltos.map((e) => e.slice(0, 8)).join(",")} (cob ${peorCobertura.toFixed(2)})`);
    }
  }
  console.log(`   idénticas:            ${exactas}`);
  console.log(`   contienen el gold +extras: ${contienen}`);
  console.log(`   FALLAN:               ${fallan}`);
  for (const p of problemas.slice(0, 10)) console.log(p);

  await sql.end();
  if (fallan > 0) {
    console.error(`\n❌ ${fallan} anclas no reproducen su propio chunk. No sirven como reemplazo.`);
    process.exit(1);
  }
  console.log(`\n✅ Las anclas reproducen el 100% de los ids actuales. El golden puede sobrevivir a un re-chunk.`);
}

await main();
process.exit(0);
