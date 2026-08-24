/**
 * BUSCAR-HUECOS — para lo que no está en ningún libro, buscar en TODO el corpus.
 *
 *   pnpm --filter @tutor-ia/eval buscar-huecos
 *   pnpm --filter @tutor-ia/eval buscar-huecos --aplicar
 *
 * ── Qué resuelve ───────────────────────────────────────────────────────────
 * `reverificar` vuelve a juzgar filas que YA existen: pregunta "¿el libro de
 * esta materia enseña esto?". Cuando la respuesta es no en todas las materias
 * donde el ítem fue mapeado, el camino le dice al alumno "pedile material a tu
 * profe" — y puede ser mentira, porque el ítem quizá nunca se buscó donde está.
 *
 * Pasa por cómo comprime el EPJA: pide en Nivel 3 Básica "Sistema solar y
 * estructuras cósmicas", que el sistema regular enseña en 6º. El ítem se mapeó
 * contra Ciencias Naturales 7º y 8º —los cursos del nivel— y contra 6º nunca,
 * así que nadie miró el único tomo que lo trae: el EPJA de Nivel 2 Básica, con
 * una unidad entera desde la página 148.
 *
 * Esto agarra los ítems sin ningún libro y los busca en TODA la asignatura, en
 * cualquier nivel. Si el lector dice que sí, escribe una fila nueva en
 * `curriculum_map` para esa materia, y el bloque de pendientes del camino pasa
 * de "pedile a tu profe" a "está en Ciencias Naturales 6º, página 148".
 *
 * ── Por qué no es hacer trampa ─────────────────────────────────────────────
 * No se cambia el veredicto de la materia del alumno: el libro de 7º sigue sin
 * traerlo, y eso se sigue diciendo. Se agrega DÓNDE está, que es información que
 * el alumno no tenía. Y no es material inventado: es el mismo Mineduc, y la
 * cascada de retrieval ya lo alcanza por `family`, así que el tutor ya contesta
 * desde ahí — lo único que faltaba era decirlo en la pantalla.
 */
import { chatText } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { retrieveRanked, type RankedChunk } from "@tutor-ia/rag";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const sql = getSql();
const APLICAR = process.argv.includes("--aplicar");

const JUZGAR = `Sos un profesor que revisa si un libro alcanza para aprender un
conocimiento que el Estado va a evaluar.

Te doy el CONOCIMIENTO ESENCIAL y FRAGMENTOS de un libro, con su página. Contestá
leyendo los fragmentos, no por parecido de palabras.

Respondé EXACTAMENTE en tres líneas:
VEREDICTO: correcto | parcial | no_esta
FRAGMENTO: el número del que MEJOR lo enseña (o - si ninguno)
POR QUE: una oración concreta.

correcto = lo desarrolla, con explicación y ejemplos.
parcial  = lo toca incompleto.
no_esta  = no lo enseña. Mencionarlo al pasar NO es enseñarlo.`;

async function main(): Promise<void> {
  // Los ítems que HOY no tienen ninguna materia que los cubra.
  const huecos = await sql<{ item: string; nivel: string; asignatura: string; capa: string; family: string; area: string; cursos: string[] }[]>`
    with v as (select s.id, s.family, s.area from subjects s where s.disabled_at is null
        and (select max(d.grade) from documents d where d.subject_id = s.id) not in ('1B','2B','3B','4B','5B')),
    x as (select cm.item, min(cm.nivel) nivel, min(cm.asignatura) asignatura, min(cm.capa) capa,
                 min(v.family) family, min(v.area) area,
                 -- Los cursos donde el currículum SÍ lo exige: son la referencia
                 -- para medir qué tan lejos está cada libro candidato.
                 array_agg(distinct (select max(d.grade) from documents d where d.subject_id = v.id)) cursos,
                 bool_or(cm.verificado in ('correcto','parcial')) hay
          from curriculum_map cm join v on v.id = cm.subject_id
          where cm.metodo = 'lector-v1' group by cm.item)
    select item, nivel, asignatura, capa, family, area, cursos from x where not hay order by item`;

  console.log(`${huecos.length} conocimiento(s) sin ningún libro${APLICAR ? "" : "  ·  SIMULACIÓN"}\n`);
  let escritas = 0;

  for (const h of huecos) {
    // Candidatas: la misma asignatura o el mismo casillero, en CUALQUIER nivel,
    // salvo las que ya lo tienen mapeado (ahí ya se sabe que no).
    const cands = await sql<{ id: string; name: string; grade: string }[]>`
      select s.id, s.name, (select max(d.grade) from documents d where d.subject_id = s.id) grade
      from subjects s
      where s.disabled_at is null
        and (s.family = ${h.family} or s.area = ${h.area})
        and not exists (select 1 from curriculum_map cm
                         where cm.subject_id = s.id and cm.item = ${h.item})
        and exists (select 1 from documents d where d.subject_id = s.id
                     and d.kind = 'content' and d.status = 'ready')`;

    // ORDEN POR CERCANÍA, no alfabético. Con `order by grade` el texto "1M" va
    // antes que "6B", así que a un chico de 7º básico se le ofrecía primero el
    // libro de 1º Medio: encontró material y cortó ahí, sin mirar el de 6º —que
    // es el que trae una unidad entera del tema—. La distancia se mide en años
    // de escolaridad, que es lo que el alumno siente como "lejos".
    const anio = (g: string | null): number =>
      !g ? 99 : (g.endsWith("M") ? 8 : 0) + Number(g.slice(0, -1) || 0);
    const propios = h.cursos.filter(Boolean).map(anio);
    cands.sort((a, b) =>
      Math.min(...propios.map((p) => Math.abs(anio(a.grade) - p))) -
      Math.min(...propios.map((p) => Math.abs(anio(b.grade) - p))));

    console.log(`── ${h.item.slice(0, 62)}`);
    if (cands.length === 0) { console.log(`   sin materias donde buscar\n`); continue; }

    /**
     * MANDA LA CERCANÍA, DESPUÉS EL VEREDICTO.
     *
     * La primera versión prefería un `correcto` lejano sobre un `parcial`
     * cercano, y con biodiversidad mandaba a un chico de 7º básico a Química 2º
     * Medio —tres años adelante— teniendo "Unidad 1: Biodiversidad" en el tomo
     * de 6º, un año atrás. Para el alumno el libro cercano es el que puede abrir
     * y entender; un veredicto un escalón mejor no compensa tres años de salto.
     *
     * El veredicto desempata solo entre libros a la MISMA distancia.
     */
    const anioDe = (g: string | null) => anio(g);
    const dist = (g: string | null) => Math.min(...propios.map((p) => Math.abs(anioDe(g) - p)));
    let mejor: { m: typeof cands[number]; ver: string; frag: RankedChunk; porQue: string; d: number } | null = null;
    for (const m of cands) {
      const vistos = new Map<string, RankedChunk>();
      for (const q of [h.item, h.item.split(/[,.]/)[0] ?? h.item]) {
        const r = await retrieveRanked(q, {
          userId: DEV_USER_ID, subjectIds: [m.id], corpusRole: "content",
          incluirPausadas: true, k: 6, minRerankScore: 0.25, gateMargin: 0,
        });
        if (r.grounded) for (const c of r.chunks as RankedChunk[]) if (!vistos.has(c.chunkId)) vistos.set(c.chunkId, c);
      }
      const frags = [...vistos.values()].slice(0, 8);
      if (frags.length === 0) continue;
      const out = await chatText(
        [{ role: "system", content: JUZGAR },
         { role: "user", content: `CONOCIMIENTO ESENCIAL:\n${h.item}\n\nFRAGMENTOS:\n` +
            frags.map((c, i) => `[${i+1}] ${c.documentTitle ?? "?"} · p.${c.pageStart}\n${(c.content ?? "").slice(0, 900)}`).join("\n\n") }],
        { temperature: 0, maxTokens: 240 },
      );
      const ver = /VEREDICTO:\s*(correcto|parcial|no_esta)/i.exec(out)?.[1]?.toLowerCase();
      if (!ver || ver === "no_esta") continue;
      const n = Number(/FRAGMENTO:\s*(\d+)/i.exec(out)?.[1] ?? 0);
      const frag = n >= 1 && n <= frags.length ? frags[n - 1]! : frags[0]!;
      const porQue = /POR QUE:\s*(.+)/i.exec(out)?.[1]?.trim() ?? "";
      const d = dist(m.grade);
      if (!mejor || d < mejor.d || (d === mejor.d && ver === "correcto" && mejor.ver === "parcial")) {
        mejor = { m, ver, frag, porQue, d };
      }
      // Ya no se puede mejorar: es el más cercano y además lo desarrolla.
      if (ver === "correcto" && d === dist(cands[0]!.grade)) break;
    }

    if (!mejor) { console.log(`   ✗ no está en ninguna de las ${cands.length} materias miradas\n`); continue; }
    console.log(`   ✅ ${mejor.ver} en ${mejor.m.name} (${mejor.d} año${mejor.d === 1 ? "" : "s"} de distancia) · ${(mejor.frag.documentTitle ?? "").slice(0,36)} p.${mejor.frag.pageStart}`);
    console.log(`   ${mejor.porQue.slice(0, 128)}\n`);

    if (APLICAR) {
      const [fila] = await sql<{ id: string }[]>`
        insert into curriculum_map (nivel, asignatura, capa, item, subject_id, document_id,
                                    corpus_role, pagina_desde, pagina_hasta, cita, metodo, verificado, verificacion)
        values (${h.nivel}, ${h.asignatura}, ${h.capa}, ${h.item}, ${mejor.m.id}::uuid,
                ${mejor.frag.documentId}, 'content', ${mejor.frag.pageStart}, ${mejor.frag.pageEnd},
                ${(mejor.frag.content ?? "").slice(0, 400)}, 'lector-v1', ${mejor.ver},
                ${`[buscar-huecos 2026-08-23] ${mejor.porQue}`.slice(0, 900)})
        on conflict do nothing
        returning id`;
      if (fila) {
        await sql`
          insert into curriculum_map_tramos (map_id, orden, seccion, pagina_desde, pagina_hasta, que_cubre, fuente, document_id)
          values (${fila.id}::uuid, 0, ${mejor.frag.headingPath ?? null}, ${mejor.frag.pageStart},
                  ${mejor.frag.pageEnd}, ${mejor.porQue.slice(0,200)}, 'buscar-huecos', ${mejor.frag.documentId})
          on conflict do nothing`;
        escritas++;
      }
    }
  }
  console.log(APLICAR ? `\n✓ ${escritas} fila(s) nuevas.` : "\nSIMULACIÓN: nada escrito.");
  process.exit(0);
}
void main();
