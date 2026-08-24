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
/** La fecha va en la nota del veredicto: sirve para saber contra qué corpus se
 *  dictó. Estaba escrita a mano y quedó vieja al día siguiente. */
const HOY = new Date().toISOString().slice(0, 10);

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

const TERMINOS = `Te doy un CONOCIMIENTO ESENCIAL del currículum escolar chileno.

Devolvé entre 8 y 15 TÉRMINOS DISTINTIVOS que aparecerían escritos en un libro que
enseña ese tema. Uno por línea, sin numerar.

Reglas:
- Palabras y frases cortas que un libro USA, no que el decreto escribe.
  "Clasificación de la materia" → sustancia pura, elemento, compuesto, mezcla
  homogénea, mezcla heterogénea, solución, disolvente, soluto.
- Nada de palabras genéricas que aparecen en cualquier página: "material",
  "estudiar", "importante", "proceso", "sistema" a secas.
- Podés usar raíces sin terminación para cubrir variantes: "mezcla", "digesti".
- Solo los términos, uno por línea.`;

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
mayoría para decir "correcto".

Algunos fragmentos vienen marcados con "encontrado buscando: …". Esas palabras se
buscaron literalmente en el libro y aparecen en ese fragmento: revisalo antes de
decir que el libro no trata ese punto.`;

interface Fila {
  id: string; item: string; subject_id: string; materia: string;
  asignatura: string; verificado: string;
}

/**
 * BARRIDO LÉXICO — buscar las palabras del tema en el libro entero.
 *
 * Por qué existe: el retrieval con reranker se pierde material que un grep
 * encuentra. Medido el 2026-08-23 sobre Ciencias Naturales 6º y el conocimiento
 * "Materia: clasificación, mezclas homogéneas y heterogéneas": la corrida trajo
 * la página 13 —la Unidad 1, que habla de estados de la materia— y nunca la
 * Unidad 2, "Sustancias puras y mezclas", que ocupa de la 31 a la 57 y es
 * exactamente lo que se estaba buscando. El veredicto quedó en "parcial" con la
 * razón "no desarrolla la clasificación de la materia", que es falsa.
 *
 * Lo mismo con "Sistemas digestivo, respiratorio y circulatorio" en el mismo
 * libro: está la Unidad 1 de Nutrición, con "La importancia del sistema
 * digestivo" en la 112 y "Sistema respiratorio y circulatorio" en la 113.
 *
 * Los auditores anteriores ya lo hacían a mano —sus notas dicen "Términos
 * probados: biodiversidad, endémic, nativ…"—; esto lo vuelve parte del método.
 *
 * NO reemplaza al retrieval: lo complementa. El léxico encuentra la página donde
 * está la palabra y es ciego a la paráfrasis; el reranker entiende la paráfrasis
 * y a veces no llega a la página. Los dos conjuntos se unen y el lector decide.
 */
async function barrido(f: Fila): Promise<(RankedChunk & { porQue?: string })[]> {
  let out = "";
  try {
    out = await chatText(
      [{ role: "system", content: TERMINOS },
       { role: "user", content: `Asignatura: ${f.asignatura || f.materia}\nCurso: ${f.materia}\nConocimiento: ${f.item}` }],
      { temperature: 0, maxTokens: 200 });
  } catch { return []; }

  const terminos = out.split("\n")
    .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim().toLowerCase())
    // Menos de 4 letras cazan cualquier cosa dentro de otra palabra.
    .filter((t) => t.length >= 4 && t.length <= 40 && !/[|\\()\[\]]/.test(t))
    .slice(0, 15);
  if (terminos.length === 0) return [];

  const patron = terminos.map((t) => t.replace(/[.*+?^${}]/g, "\\$&")).join("|");

  /**
   * CADA TÉRMINO PESA SEGÚN LO RARO QUE SEA EN ESTE LIBRO.
   *
   * Contar términos a secas premia al glosario y a las páginas que rozan muchas
   * palabras comunes. Medido: buscando "clasificación de la materia y mezclas"
   * en Ciencias Naturales 6º ganó la página 175 —el modelo heliocéntrico de
   * Copérnico— porque tocaba "masa", "volumen" y "temperatura", mientras que la
   * 43, que enseña mezclas homogéneas y destilación, quedaba abajo.
   *
   * "masa" aparece en cien fragmentos de ese libro y no distingue nada; "mezcla
   * homogénea" aparece en tres y señala exactamente la página buscada. El peso
   * es inverso a en cuántos fragmentos aparece el término.
   */
  const frecuencias = await sql<{ t: string; n: number }[]>`
    select t, (select count(*)::int from chunks c
                join documents d on d.id = c.document_id
               where d.subject_id = ${f.subject_id}::uuid
                 and d.kind = 'content' and d.status = 'ready'
                 and c.corpus_role = 'content' and c.content_type <> 'index'
                 and c.content ilike '%' || t || '%') n
    from unnest(${terminos}::text[]) t`;
  const peso = new Map(frecuencias.map((x) => [x.t, 1 / Math.log(2 + x.n)]));
  const filas = await sql<{
    chunk_id: string; content: string; page_start: number; page_end: number;
    document_id: string; document_title: string;
  }[]>`
    select c.id chunk_id, c.content, c.page_start, c.page_end,
           d.id document_id, d.title document_title
    from chunks c join documents d on d.id = c.document_id
    where d.subject_id = ${f.subject_id}::uuid
      and d.kind = 'content' and d.status = 'ready'
      and c.corpus_role = 'content' and c.content_type <> 'index'
      and c.content ~* ${patron}
    limit 200`;

  // Gana el fragmento que toca MÁS términos distintos, no el que repite uno.
  // Un chunk con "mezcla homogénea", "soluto" y "disolvente" enseña el tema; uno
  // que dice "mezcla" seis veces puede estar hablando de otra cosa.
  const puntuado = filas.map((r) => {
    const tocados = terminos.filter((t) => r.content.toLowerCase().includes(t));
    return { r, tocados, n: tocados.reduce((a, t) => a + (peso.get(t) ?? 0), 0) };
  });
  puntuado.sort((a, b) => b.n - a.n || a.r.page_start - b.r.page_start);
  if (process.env.DEBUG_BARRIDO) {
    console.log(`      [barrido] términos: ${terminos.join(", ")}`);
    console.log(`      [barrido] ${filas.length} chunks tocan algún término; top: ` +
      puntuado.slice(0, 5).map((x) => `p.${x.r.page_start}(${x.n.toFixed(2)}: ${x.tocados.slice(0,3).join(",")})`).join(" | "));
  }
  // Dos términos distintos como mínimo: uno solo es casi siempre una mención.
  return puntuado.filter((x) => x.tocados.length >= 2).slice(0, 4).map((x) => ({
    chunkId: x.r.chunk_id, content: x.r.content,
    pageStart: x.r.page_start, pageEnd: x.r.page_end,
    documentId: x.r.document_id, documentTitle: x.r.document_title,
    porQue: x.tocados.slice(0, 5).join(", "),
  } as unknown as RankedChunk & { porQue: string }));
}

async function frases(f: Fila): Promise<string[]> {
  // Un timeout del proveedor no puede tirar abajo una corrida de 171 filas: se
  // sigue con el texto del conocimiento, que es peor consulta pero es una.
  let out = "";
  try {
    out = await chatText(
    [{ role: "system", content: EXPANDIR },
     { role: "user", content: `Asignatura: ${f.asignatura || f.materia}\nCurso: ${f.materia}\nConocimiento esencial: ${f.item}` }],
      { temperature: 0, maxTokens: 220 },
    );
  } catch { out = ""; }
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
    /**
     * EL BARRIDO TIENE LUGAR RESERVADO, NO VA A LA COLA.
     *
     * La primera versión los concatenaba y cortaba a 10. Cuatro consultas por
     * seis candidatos dejan hasta 24 fragmentos del retrieval, así que el corte
     * se comía el barrido ENTERO y la herramienta se comportaba igual que antes
     * —con el costo de las llamadas extra—. Se notó porque los dos casos que
     * motivaron el barrido seguían fallando aunque el debug mostraba que había
     * encontrado la página correcta.
     *
     * Y el lugar del barrido se AGREGA, no se le quita al reranker. Probado
     * recortándolo de 8 a 6 para hacer sitio: la corrida pasó de 1 mejora a 0 y
     * encima habría degradado una fila. Los fragmentos que el reranker pone
     * séptimo y octavo estaban haciendo falta.
     */
    const delReranker = [...vistos.values()].slice(0, 8);
    const puestos = new Set(delReranker.map((c) => c.chunkId));
    const delBarrido = (await barrido(f)).filter((c) => !puestos.has(c.chunkId)).slice(0, 4);
    const frags = [...delReranker, ...delBarrido];
    if (frags.length === 0) {
      // Sin fragmentos NO se degrada: ver el bloque de arriba.
      const nota = f.verificado === "no_esta" ? "sigue sin encontrarse" : "esta corrida no trajo nada; se respeta el veredicto leído";
      console.log(`── ${f.materia} · ${f.item.slice(0,50)}\n   ${f.verificado} — ${nota}\n`);
      cambios[f.verificado === "no_esta" ? "igual" : "empeora"]++;
      continue;
    }

    /**
     * SE LE DICE AL LECTOR POR QUÉ ESTÁ CADA FRAGMENTO.
     *
     * Sin la etiqueta, los del barrido llegan al final de una lista de doce y el
     * modelo los pasa por arriba: contestó "no desarrolla la clasificación de
     * mezclas" teniendo delante la página que dice "mezcla homogénea", "soluto"
     * y "disolvente". Marcar que ese fragmento salió de buscar ESAS palabras le
     * dirige la atención a lo que hay que comprobar.
     */
    const texto = frags.map((c, i) => {
      const t = (c as RankedChunk & { porQue?: string }).porQue;
      const sello = t ? ` · encontrado buscando: ${t}` : "";
      return `[${i + 1}] ${c.documentTitle ?? "?"} · p.${c.pageStart}${sello}\n${(c.content ?? "").slice(0, 900)}`;
    }).join("\n\n");
    let out = "";
    try {
      out = await chatText(
        [{ role: "system", content: JUZGAR },
         { role: "user", content: `CONOCIMIENTO ESENCIAL:\n${f.item}\n\nFRAGMENTOS:\n${texto}` }],
        { temperature: 0, maxTokens: 260 },
      );
    } catch {
      // Sin veredicto no se toca la fila: el silencio del proveedor no es un
      // juicio sobre el libro.
      console.log(`── ${f.materia} · ${f.item.slice(0,50)}\n   ⚠️  el proveedor no respondió; se deja como está\n`);
      cambios.igual++;
      continue;
    }
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
          verificacion = ${`[reverificado ${HOY} sobre el corpus completo] ${porQue}`.slice(0, 900)},
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
