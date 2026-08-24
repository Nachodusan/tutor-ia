/**
 * REVERIFICAR — vuelve a preguntarle al corpus COMPLETO si el libro enseña cada
 * conocimiento del currículum.
 *
 *   pnpm --filter @tutor-ia/eval reverificar --estados no_esta,otro_año,parcial
 *   pnpm --filter @tutor-ia/eval reverificar --materia "Matemática 7º" --aplicar
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 * El mapa se verificó el 2026-08-20. El corpus del programa EPJA se ingirió el
 * 21 y el 22. O sea que TODOS los veredictos se dictaron contra un corpus que
 * no tenía ese material, y "no está en tu libro" quiere decir, en realidad, "no
 * estaba en lo que miré".
 *
 * Medido antes de escribir esto: "Teorema de Pitágoras" figura como ausente en
 * Matemática 7º y hay 12 fragmentos que lo enseñan, con tres lecciones en el
 * índice. "Sistemas de ecuaciones (2x2)" figura ausente en Matemática 2º Medio
 * con 20 fragmentos. Al menos 10 de los 21 huecos son falsos.
 *
 * ── Por qué LEE en vez de mirar el score ───────────────────────────────────
 * `ubicar` decide con el score del reranker y midió 7 aciertos de 63: el
 * parecido léxico entre un conocimiento normativo y un párrafo de libro es
 * débil en las dos direcciones —dice que sí donde no y que no donde sí—. Acá el
 * modelo recibe el TEXTO de los fragmentos y contesta leyéndolos, que es lo que
 * hace defendibles los veredictos `lector-v1`.
 *
 * ── SOLO PUEDE MEJORAR UN VEREDICTO, NUNCA EMPEORARLO ──────────────────────
 * Esta pasada existe para encontrar material que la anterior no podía ver. No
 * tiene autoridad para borrar lo que alguien estableció LEYENDO: que este
 * retrieval no recupere fragmentos no prueba que el libro no lo enseñe — prueba
 * que esta consulta no lo encontró, que es otra cosa.
 *
 * Pasó en la primera prueba: "Funciones lineales y afines" estaba en `parcial`
 * con página, y la corrida no trajo un solo fragmento. Aplicar eso habría
 * borrado una ubicación buena a cambio de nada.
 *
 * Los intentos de degradar se cuentan y se imprimen: si son muchos, el problema
 * es del retrieval de esta herramienta y hay que mirarlo, no aceptarlo.
 *
 * ── Qué escribe ────────────────────────────────────────────────────────────
 * Con `--aplicar`, y solo cuando MEJORA: `verificado`, `verificacion`,
 * `document_id`, `pagina_desde/hasta` y `cita`, más un tramo nuevo. NO borra
 * los tramos existentes.
 *
 * Sin `--aplicar` imprime lo que haría y no toca nada.
 */
import { chatText } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { retrieveRanked, type RankedChunk } from "@tutor-ia/rag";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const sql = getSql();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APLICAR = process.argv.includes("--aplicar");
const ESTADOS = (arg("estados") ?? "no_esta,otro_año,parcial").split(",").map((s) => s.trim());
const UMBRAL = Number(arg("umbral") ?? 0.25);

const EXPANDIR = `Sos un bibliotecario de textos escolares chilenos del Mineduc.
Te doy un CONOCIMIENTO ESENCIAL del currículum, escrito en el registro normativo del
Ministerio, y la asignatura y curso donde se enseña.

Devolvés entre 3 y 5 frases de búsqueda, UNA POR LÍNEA, sin numerar y sin viñetas.
Cada frase tiene que estar redactada COMO LA ESCRIBIRÍA EL LIBRO DE TEXTO: el título de
la lección, el nombre del tema, o la frase con que el libro lo explica.

Reglas:
- Si el conocimiento junta varios temas ("potencias, raíces y sus propiedades"),
  hacé una frase POR TEMA. Es lo más importante: cada tema vive en otra página.
- Usá el vocabulario del aula, no el del decreto.
- Nada de explicaciones, comillas ni comentarios. Solo las frases, una por línea.`;

const JUZGAR = `Sos un profesor que revisa si el material de un alumno alcanza para
aprender un conocimiento que el Estado va a evaluar.

Te doy el CONOCIMIENTO ESENCIAL y FRAGMENTOS del material del alumno, cada uno con su
libro y su página. Contestá leyendo los fragmentos, no por parecido de palabras.

Respondé EXACTAMENTE en este formato, tres líneas:
VEREDICTO: correcto | parcial | no_esta
FRAGMENTO: el número del fragmento que MEJOR lo enseña (o - si ninguno)
POR QUE: una oración, concreta, diciendo qué enseña el material y qué le falta.

Criterio:
- correcto = el material desarrolla el conocimiento, con explicación y ejemplos.
- parcial  = lo toca pero incompleto: falta una parte del enunciado, o solo lo menciona.
- no_esta  = los fragmentos no lo enseñan. Mencionarlo al pasar NO es enseñarlo.

Si el conocimiento junta varios temas, alcanza con que el material desarrolle la
mayoría para decir "correcto".`;

interface Fila {
  id: string; item: string; subject_id: string; materia: string;
  asignatura: string; verificado: string;
}

async function frases(f: Fila): Promise<string[]> {
  const out = await chatText(
    [{ role: "system", content: EXPANDIR },
     { role: "user", content: `Asignatura: ${f.asignatura || f.materia}\nCurso: ${f.materia}\nConocimiento esencial: ${f.item}` }],
    { temperature: 0, maxTokens: 220 },
  );
  const fs = out.split("\n").map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim())
    .filter((l) => l.length >= 4 && l.length <= 160).slice(0, 5);
  return fs.length ? fs : [f.item];
}

async function main(): Promise<void> {
  const filtroMateria = arg("materia");
  const filas = await sql<Fila[]>`
    select cm.id, cm.item, cm.subject_id, s.name materia,
           coalesce(cm.asignatura,'') asignatura, cm.verificado
    from curriculum_map cm join subjects s on s.id = cm.subject_id
    where cm.metodo = 'lector-v1'
      and cm.verificado = any(${ESTADOS})
      and s.disabled_at is null
      and (select max(d.grade) from documents d where d.subject_id = s.id)
          not in ('1B','2B','3B','4B','5B')
      and (${filtroMateria ?? null}::text is null or s.name = ${filtroMateria ?? null})
    order by s.name, cm.item`;

  console.log(`${filas.length} fila(s)${APLICAR ? "" : "  ·  SIMULACIÓN"}\n`);
  const cambios = { mejora: 0, igual: 0, empeora: 0 };

  for (const f of filas) {
    // BUSCAR en TODO el material de la materia, con las frases del aula.
    const vistos = new Map<string, RankedChunk>();
    for (const q of await frases(f)) {
      const r = await retrieveRanked(q, {
        userId: DEV_USER_ID, subjectIds: [f.subject_id], corpusRole: "content",
        incluirPausadas: true, k: 6, minRerankScore: UMBRAL, gateMargin: 0,
      });
      if (!r.grounded) continue;
      for (const c of r.chunks as RankedChunk[]) if (!vistos.has(c.chunkId)) vistos.set(c.chunkId, c);
    }
    const frags = [...vistos.values()].slice(0, 8);
    if (frags.length === 0) {
      // Sin fragmentos NO se degrada: ver el bloque de arriba.
      const nota = f.verificado === "no_esta" ? "sigue sin encontrarse" : "esta corrida no trajo nada; se respeta el veredicto leído";
      console.log(`── ${f.materia} · ${f.item.slice(0,50)}\n   ${f.verificado} — ${nota}\n`);
      cambios[f.verificado === "no_esta" ? "igual" : "empeora"]++;
      continue;
    }

    const texto = frags.map((c, i) =>
      `[${i + 1}] ${c.documentTitle ?? "?"} · p.${c.pageStart}\n${(c.content ?? "").slice(0, 900)}`).join("\n\n");
    const out = await chatText(
      [{ role: "system", content: JUZGAR },
       { role: "user", content: `CONOCIMIENTO ESENCIAL:\n${f.item}\n\nFRAGMENTOS:\n${texto}` }],
      { temperature: 0, maxTokens: 260 },
    );
    const ver = /VEREDICTO:\s*(correcto|parcial|no_esta)/i.exec(out)?.[1]?.toLowerCase() ?? null;
    const nFrag = Number(/FRAGMENTO:\s*(\d+)/i.exec(out)?.[1] ?? 0);
    const porQue = /POR QUE:\s*(.+)/i.exec(out)?.[1]?.trim() ?? "";
    if (!ver) { console.log(`── ${f.materia} · ${f.item.slice(0,50)}\n   ⚠️  sin veredicto legible\n`); continue; }

    const rank = { no_esta: 0, "otro_año": 0, parcial: 1, correcto: 2 } as Record<string, number>;
    const mejora = (rank[ver] ?? 0) > (rank[f.verificado] ?? 0);
    cambios[mejora ? "mejora" : ver === f.verificado ? "igual" : "empeora"]++;
    const elegido = nFrag >= 1 && nFrag <= frags.length ? frags[nFrag - 1]! : null;
    const marca = mejora ? "✅" : ver === f.verificado ? "  " : "🔻";
    console.log(`── ${f.materia} · ${f.item.slice(0,50)}`);
    console.log(`   ${marca} ${f.verificado} → ${ver}${elegido ? `  ·  ${(elegido.documentTitle ?? "").slice(0,34)} p.${elegido.pageStart}` : ""}`);
    console.log(`   ${porQue.slice(0, 130)}\n`);

    if (APLICAR && mejora) {
      await sql`
        update curriculum_map set
          verificado = ${ver},
          verificacion = ${`[reverificado 2026-08-23 sobre el corpus completo] ${porQue}`.slice(0, 900)},
          document_id = ${mejora && elegido ? elegido.documentId : null} ,
          pagina_desde = case when ${mejora && !!elegido} then ${elegido?.pageStart ?? null} else pagina_desde end,
          pagina_hasta = case when ${mejora && !!elegido} then ${elegido?.pageEnd ?? null} else pagina_hasta end,
          cita = case when ${mejora && !!elegido} then ${(elegido?.content ?? "").slice(0, 400)} else cita end,
          updated_at = now()
        where id = ${f.id}::uuid`;
      if (mejora && elegido) {
        await sql`
          insert into curriculum_map_tramos (map_id, orden, seccion, pagina_desde, pagina_hasta, que_cubre, fuente, document_id)
          values (${f.id}::uuid, 0, ${elegido.headingPath ?? null}, ${elegido.pageStart},
                  ${elegido.pageEnd}, ${porQue.slice(0,200)}, 'reverificado', ${elegido.documentId})
          on conflict do nothing`;
      }
    }
  }
  console.log(`\n✅ mejoran (se escriben): ${cambios.mejora}`);
  console.log(`·  quedan igual: ${cambios.igual}`);
  console.log(`🔻 esta corrida los habría bajado y NO se tocan: ${cambios.empeora}`);
  console.log(APLICAR ? "escrito." : "SIMULACIÓN: nada escrito. Agregá --aplicar.");
  process.exit(0);
}
void main();
