/**
 * RE-ANCLAJE DEL GOLDEN SET — del macrotipo al libro oficial.
 *
 * Contexto. El golden estaba anclado a `Tomo_I_Lengua_y_Literatura8vo.pdf`, que
 * NO es el libro que se vende: es la transcripción MACROTIPO de la Biblioteca
 * Central Para Ciegos (2024) y solo el Tomo I (Unidades 1-2 de 4). El libro
 * oficial del corpus es `Lengua Y Literatura 8º — texto del estudiante`.
 * Verificado que son la MISMA EDICIÓN: mismos autores, mismos códigos internos
 * (LIC_LEN_8B_*, U1_ACT_*), misma errata ("Wislawa Szmborska"), y el macrotipo
 * conserva impresa la paginación original de B (rango 6→87 sin huecos).
 *
 * El mapeo va en DOS PASADAS porque una sola no alcanza:
 *
 *  1) CONTAINMENT de 4-gramas. Para cada chunk viejo busca el chunk de B con
 *     mayor solapamiento. Acierta ~80% solo; sube a 60/61 tomando los dos
 *     mejores, porque los cortes de chunk difieren (A tiene 208, B tiene 266) y
 *     un chunk de A cae a caballo de dos de B.
 *
 *  2) VERIFICACIÓN POR PALABRA CLAVE sobre `expect_answer`. La pasada 1 falla
 *     justo donde más duele: glosarios y listas cortas. Caso real q048 — el
 *     glosario de Tristán e Isolda está entero en un chunk de A pero partido en
 *     dos en B, y el containment elegía la mitad que llega hasta "pabellón",
 *     dejando afuera "singlar: navegar", que es LA respuesta. Esta pasada toma
 *     las palabras de contenido de la respuesta esperada y, si el chunk elegido
 *     no las contiene, busca en todo B el que sí.
 *
 * SOLO LECTURA sobre la base. Escribe un archivo nuevo; no pisa el original
 * (`golden-macrotipo.jsonl` queda intacto).
 */
import { readFile, writeFile } from "node:fs/promises";
import { getSql } from "@tutor-ia/db";
import { norm, ngrams, claves, NGRAM_N as N } from "@tutor-ia/rag";

const DOC_VIEJO = "Tomo_I_Lengua_y_Literatura8vo.pdf";
const DOC_NUEVO = "Lengua Y Literatura 8º — texto del estudiante";

interface Chunk { id: string; page: number | null; content: string }

/**
 * Frases que la `note` cita LITERALMENTE del libro. Es la señal más fuerte que
 * hay, y por lejos.
 *
 * Motivo: muchas preguntas del golden son adversariales por DESFASE DE
 * VOCABULARIO — la pregunta y la respuesta esperada dicen a propósito algo
 * distinto de lo que dice el libro. Caso real q104: el libro dice "divertir a la
 * AUDIENCIA y, a la vez, EDUCARLA" y `expect_answer` dice "divertir al PÚBLICO
 * y educarLO". Ni el containment ni las palabras de la respuesta encuentran el
 * pasaje; la nota, que transcribe la frase del libro entre comillas simples, sí.
 */
function citasDeLaNota(note: string): string[] {
  const out: string[] = [];
  for (const m of note.matchAll(/'([^']{15,200})'/g)) out.push(m[1]!);
  for (const m of note.matchAll(/[“"]([^”"]{15,200})[”"]/g)) out.push(m[1]!);
  return out;
}

async function main() {
  const sql = getSql();
  const viejos = await sql<Chunk[]>`
    select c.id, c.page, c.content from chunks c join documents d on d.id = c.document_id
    where d.title = ${DOC_VIEJO}`;
  const nuevos = await sql<Chunk[]>`
    select c.id, c.page, c.content from chunks c join documents d on d.id = c.document_id
    where d.title = ${DOC_NUEVO} order by c.chunk_index`;
  if (!viejos.length || !nuevos.length) {
    console.error(`❌ No encontré los documentos.\n   viejo(${DOC_VIEJO}): ${viejos.length} chunks\n   nuevo(${DOC_NUEVO}): ${nuevos.length} chunks`);
    process.exit(1);
  }
  console.log(`📖 viejo: ${viejos.length} chunks   ·   nuevo: ${nuevos.length} chunks\n`);

  const byId = new Map(viejos.map((c) => [c.id, c]));
  const nuevoGramas = nuevos.map((c) => ({ c, g: ngrams(norm(c.content).split(" ")), n: norm(c.content) }));

  const goldenPath = new URL("../golden/questions.jsonl", import.meta.url).pathname;
  const raw = await readFile(goldenPath, "utf8");
  const rows = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);

  let sinAncla = 0, porContainment = 0, corregidosPorClave = 0, corregidosPorCita = 0;
  const informe: string[] = [];

  for (const r of rows) {
    const ec = (r.expect_chunks as string[] | undefined) ?? [];
    if (!ec.length) { sinAncla++; continue; }

    const esperada = (r.expect_answer as string | undefined) ?? "";
    const kws = esperada ? claves(esperada) : [];
    const nuevosIds: string[] = [];
    const traza: string[] = [];

    for (const viejoId of ec) {
      const v = byId.get(viejoId);
      if (!v) { traza.push(`${viejoId.slice(0, 8)}=NO-EXISTE`); continue; }
      const g = ngrams(norm(v.content).split(" "));
      if (g.size === 0) { traza.push(`${viejoId.slice(0, 8)}=chunk-muy-corto`); continue; }

      // PASADA 1 — containment. Se queda con el mejor y, si el segundo aporta
      // cobertura real, también: un chunk de A suele caer entre dos de B.
      const rank = nuevoGramas
        .map((x) => ({ x, ov: [...g].filter((q) => x.g.has(q)).length / g.size }))
        .sort((a, b) => b.ov - a.ov);
      const elegidos = [rank[0]!];
      if (rank[1]) {
        const unidos = new Set([...rank[0]!.x.g, ...rank[1]!.x.g]);
        const comb = [...g].filter((q) => unidos.has(q)).length / g.size;
        if (comb - rank[0]!.ov > 0.12) elegidos.push(rank[1]!);
      }
      porContainment++;
      let ids = elegidos.map((e) => e.x.c.id);

      // PASADA 2 — verificación por palabra clave. Si la respuesta esperada tiene
      // términos distintivos y NINGUNO de los chunks elegidos los contiene, el
      // containment eligió mal: busca en todo B el que sí los tenga.
      if (kws.length) {
        const cubre = (txt: string) => kws.filter((k) => txt.includes(k)).length / kws.length;
        const actual = Math.max(...elegidos.map((e) => cubre(e.x.n)));
        if (actual < 0.5) {
          const mejorKw = nuevoGramas
            .map((x) => ({ x, c: cubre(x.n) }))
            .sort((a, b) => b.c - a.c)[0]!;
          if (mejorKw.c > actual + 0.2) {
            ids = [mejorKw.x.c.id, ...ids.filter((i) => i !== mejorKw.x.c.id)].slice(0, 2);
            corregidosPorClave++;
            informe.push(
              `  🔑 ${r.id} · ${viejoId.slice(0, 8)} → corregido por palabra clave ` +
                `(cobertura ${(actual * 100).toFixed(0)}% → ${(mejorKw.c * 100).toFixed(0)}%, pág ${mejorKw.x.c.page})`,
            );
          }
        }
      }
      // PASADA 3 — CITAS LITERALES DE LA NOTA. La más fuerte de las tres: si la
      // nota transcribe una frase del libro, el chunk correcto es el que la
      // contiene, sin discusión. Manda sobre las dos pasadas anteriores.
      const citas = citasDeLaNota((r.note as string | undefined) ?? "");
      if (citas.length) {
        const enChunk = (txt: string) =>
          Math.max(0, ...citas.map((q) => {
            const w = norm(q).split(" ");
            if (w.length < N) return txt.includes(norm(q)) ? 1 : 0;
            const g = ngrams(w);
            return [...g].filter((x) => txt.includes(x)).length / g.size;
          }));
        const actual = Math.max(...ids.map((i) => enChunk(nuevoGramas.find((x) => x.c.id === i)!.n)));
        if (actual < 0.6) {
          const mejor = nuevoGramas.map((x) => ({ x, s: enChunk(x.n) })).sort((a, b) => b.s - a.s)[0]!;
          if (mejor.s > actual + 0.25) {
            ids = [mejor.x.c.id, ...ids.filter((i) => i !== mejor.x.c.id)].slice(0, 2);
            corregidosPorCita++;
            informe.push(
              `  📝 ${r.id} · ${viejoId.slice(0, 8)} → corregido por CITA de la nota ` +
                `(${(actual * 100).toFixed(0)}% → ${(mejor.s * 100).toFixed(0)}%, pág ${mejor.x.c.page})`,
            );
          }
        }
      }

      for (const i of ids) if (!nuevosIds.includes(i)) nuevosIds.push(i);
      traza.push(`${viejoId.slice(0, 8)}→${ids.map((i) => i.slice(0, 8)).join("+")}@${elegidos[0]!.ov.toFixed(2)}`);
    }

    r.expect_chunks = nuevosIds;
    // Trazabilidad: de dónde salió cada ancla nueva, para poder auditar después.
    r.reanchored_from = { doc: DOC_VIEJO, chunks: ec, mapeo: traza.join(" ") };
  }

  const out = new URL("../golden/questions.jsonl", import.meta.url).pathname;
  await writeFile(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  console.log(informe.join("\n"));
  console.log(`\n${"═".repeat(64)}`);
  console.log(`preguntas: ${rows.length}  ·  sin ancla (must_abstain / false_premise): ${sinAncla}`);
  console.log(`chunks re-anclados por containment: ${porContainment}`);
  console.log(`de esos, corregidos por palabra clave:   ${corregidosPorClave}`);
  console.log(`de esos, corregidos por CITA de la nota:  ${corregidosPorCita}`);
  console.log(`escrito: ${out}`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
