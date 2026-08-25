/**
 * BUSCAR-COMPONENTES — para cada componente faltante (✗), ¿dónde está el material?
 *
 *   pnpm --filter @tutor-ia/eval buscar-componentes
 *   pnpm --filter @tutor-ia/eval buscar-componentes --aplicar
 *
 * ── Qué resuelve ───────────────────────────────────────────────────────────
 * La verificación por componentes dejó la lista fina de lo que cada libro no
 * cubre. Antes de conseguir material afuera, la pregunta barata que esta sesión
 * ya validó dos veces (los 30 "no está" y 9 de 13 amarillos de ciencias): ¿el
 * trozo que falta ya está en OTRO libro del corpus?
 *
 * Para cada componente sin cubrir se busca en TODO el corpus (una consulta, no
 * una por materia) y un lector dictamina leyendo. El componente ya viene en
 * registro de libro ("estructuras básicas del sistema respiratorio"), así que
 * acá no hace falta expandir la consulta — la trampa de buscar con prosa de
 * ausencia no aplica.
 *
 * ── Qué escribe ────────────────────────────────────────────────────────────
 * Con --aplicar, anota en el MISMO componente de componentes_cobertura un campo
 * "en": {materia, pag} — dónde vive el material dentro del corpus. El informe
 * pasa de "✗ falta" a "✗ falta en tu libro; está en Biología 2º Medio p.130".
 * No cambia veredictos ni páginas del ítem: el libro de esa materia sigue sin
 * cubrirlo y eso se sigue diciendo.
 */
import { chatText } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { retrieveRanked, type RankedChunk } from "@tutor-ia/rag";

const DEV = process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const sql = getSql();
const APLICAR = process.argv.includes("--aplicar");

const JUZGAR = `Te doy un COMPONENTE de un conocimiento escolar y FRAGMENTOS de libros,
numerados, con su materia y página. ¿Algún fragmento ENSEÑA ese componente
(explicación o desarrollo, no una mención al pasar)?
Respondé dos líneas exactas:
FRAGMENTO: el número del que mejor lo enseña (o - si ninguno)
POR QUE: una oración corta.`;

async function main(): Promise<void> {
  // Cada componente faltante, con TODAS las filas del mapa donde aparece (el
  // mismo ítem vive en varias materias del casillero de ciencias).
  const faltantes = await sql<{ nivel: string; item: string; c: string; ids: string[] }[]>`
    with x as (
      select cm.id, cm.nivel, cm.item, comp->>'c' c
      from curriculum_map cm,
           jsonb_array_elements(cm.componentes_cobertura) comp
      where cm.componentes_cobertura is not null
        and not (comp->>'ok')::boolean)
    select nivel, item, c, array_agg(id::text) ids
    from x group by nivel, item, c
    order by nivel, item, c`;

  const nombre = new Map((await sql<{ id: string; name: string }[]>`
    select s.id, s.name from subjects s`).map((s) => [s.id, s.name]));

  console.log(`${faltantes.length} componente(s) faltantes${APLICAR ? "" : "  ·  SIMULACIÓN"}\n`);
  let hallados = 0, sinNada = 0, anotados = 0;

  for (const f of faltantes) {
    // Dos consultas: el componente pelado y con el contexto del ítem, porque
    // "célula" a secas trae de todo y "célula (niveles de organización de los
    // seres vivos)" ancla al tema.
    const vistos = new Map<string, RankedChunk>();
    for (const q of [f.c, `${f.c} (${f.item.slice(0, 70)})`]) {
      try {
        const r = await retrieveRanked(q, { userId: DEV, corpusRole: "content",
          incluirPausadas: false, k: 6, minRerankScore: 0.4, gateMargin: 0 });
        if (r.grounded) for (const ch of r.chunks as RankedChunk[]) if (!vistos.has(ch.chunkId)) vistos.set(ch.chunkId, ch);
      } catch { /* sigue con la otra consulta */ }
    }
    /**
     * BRAZO LÉXICO — la misma lección que reverificar, reaprendida acá: el
     * reranker se pierde material que un ILIKE encuentra. La primera corrida
     * declaró "en ningún libro" a "Reacciones químicas" (69 fragmentos en
     * Química 2º Medio) y a "respiración celular" (18 en Biología). El
     * componente es una frase de libro: se busca literal en todo el corpus y
     * los mejores por página más temprana se suman a los del reranker.
     */
    const lex = await sql<{ chunk_id: string; content: string; page_start: number; page_end: number;
        document_id: string; document_title: string; subject_id: string }[]>`
      select c.id chunk_id, c.content, c.page_start, c.page_end,
             d.id document_id, d.title document_title, d.subject_id
      from chunks c join documents d on d.id = c.document_id
      join subjects s on s.id = d.subject_id and s.disabled_at is null
      where c.corpus_role = 'content' and c.content_type <> 'index'
        and c.content ilike ${"%" + f.c + "%"}
      -- Por DENSIDAD y no por página temprana: la página que repite el término
      -- es la que lo enseña; la más temprana suele ser el índice o una mención.
      -- Medido: "respiración celular" tiene 18 fragmentos en Biología desde la
      -- p.95, y el orden por página traía las menciones de la p.19 de Química.
      order by (length(c.content) - length(replace(lower(c.content), lower(${f.c}), ''))) desc
      limit 4`;
    for (const r of lex) {
      if (!vistos.has(r.chunk_id)) vistos.set(r.chunk_id, {
        chunkId: r.chunk_id, content: r.content, pageStart: r.page_start, pageEnd: r.page_end,
        documentId: r.document_id, documentTitle: r.document_title, subjectId: r.subject_id,
      } as unknown as RankedChunk);
    }
    const frags = [...vistos.values()].slice(0, 8);
    console.log(`── [${f.nivel.replace(" Educación ", " ")}] ${f.c.slice(0, 72)}`);
    if (frags.length === 0) { sinNada++; console.log(`   ✗ nada supera el umbral en todo el corpus\n`); continue; }

    let out = "";
    try {
      out = await chatText([{ role: "system", content: JUZGAR },
        { role: "user", content: `COMPONENTE:\n${f.c}\n(del conocimiento: ${f.item.slice(0, 90)})\n\nFRAGMENTOS:\n` +
          frags.map((x, i) => `[${i + 1}] ${nombre.get(x.subjectId ?? "") ?? "?"} · p.${x.pageStart}\n${(x.content ?? "").slice(0, 700)}`).join("\n\n") }],
        { temperature: 0, maxTokens: 100 });
    } catch { console.log(`   ⚠️  el juez no respondió\n`); continue; }

    const n = Number(/FRAGMENTO:\s*(\d+)/i.exec(out)?.[1] ?? 0);
    const frag = n >= 1 && n <= frags.length ? frags[n - 1]! : null;
    if (!frag) {
      sinNada++;
      console.log(`   ✗ el corpus no lo enseña · visto: ${[...new Set(frags.map((x) => nombre.get(x.subjectId ?? "")))].slice(0, 3).join(", ")}\n`);
      continue;
    }
    hallados++;
    const materia = nombre.get(frag.subjectId ?? "") ?? "?";
    console.log(`   ✅ ${materia} p.${frag.pageStart}\n`);

    if (APLICAR) {
      for (const id of f.ids) {
        // Se re-lee y se reescribe la fila entera del jsonb: anotar un elemento
        // de un array anidado con jsonb_set exigiría conocer el índice, y el
        // array puede haber cambiado entre corridas.
        const [fila] = await sql<{ cob: { c: string; ok: boolean; pag: number | null; en?: unknown }[] }[]>`
          select componentes_cobertura cob from curriculum_map where id = ${id}::uuid`;
        if (!fila?.cob) continue;
        const cob = fila.cob.map((x) =>
          x.c === f.c && !x.ok
            ? { ...x, en: { materia, doc: (frag.documentTitle ?? null), pag: frag.pageStart ?? null } }
            : x);
        await sql`
          update curriculum_map set componentes_cobertura = ${toJson(sql, cob)}, updated_at = now()
          where id = ${id}::uuid`;
        anotados++;
      }
    }
  }
  console.log(`✅ hallados en el corpus: ${hallados} · ✗ en ningún libro: ${sinNada}` +
    (APLICAR ? ` · filas anotadas: ${anotados}` : ""));
  console.log(APLICAR ? "escrito." : "SIMULACIÓN: nada escrito. Agregá --aplicar.");
  process.exit(0);
}
void main();
