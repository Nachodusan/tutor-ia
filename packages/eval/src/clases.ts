/**
 * GENERA LA CLASE DE CADA PARADA DEL CAMINO — el batch de noche.
 *
 *   pnpm --filter @tutor-ia/eval clases --materia "Física 1º Medio" --limite 5
 *   pnpm --filter @tutor-ia/eval clases --key siamqlm
 *   pnpm --filter @tutor-ia/eval clases --todas --aplicar
 *
 * Sin `--aplicar` imprime lo que saldría y NO escribe: la clase es lo que el
 * alumno va a leer como cierto, así que conviene mirarla antes.
 *
 * ⚠️ EL SIDECAR (rerank + NLI) TIENE QUE ESTAR ARRIBA para que corra el gate.
 * Si no está, las clases se guardan igual pero marcadas `gate.corrido: false`,
 * y hay que volver a pasarlas. No es un detalle: sin gate, la glosa que el
 * alumno lee no la verificó nadie.
 */
import { armarClase, verificarClase, partirEnOraciones, cuantosMomentos, SinClase } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { fetchLessonMaterial, documentoDeTema, nliPairs } from "@tutor-ia/rag";

const sql = getSql();
const APLICAR = process.argv.includes("--aplicar");
const TODAS = process.argv.includes("--todas");
const VER = process.argv.includes("--ver");
const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const MATERIA = arg("--materia");
const KEY = arg("--key");
const LIMITE = Number(arg("--limite") ?? (TODAS ? 100000 : 3));
/**
 * REINTENTOS, y no son un parche: el modelo es un MoE y a temperatura 0 igual
 * cambia de corrida. La misma parada de Matemática dio dos momentos en pie una
 * vez y CERO la siguiente, porque el gate encontró una afirmación contradicha en
 * la segunda glosa. Un lote de 1.846 sin reintentos deja huecos al azar.
 */
const REINTENTOS = Number(arg("--reintentos") ?? 2);

interface Parada {
  subjectId: string; subjectName: string; documentId: string | null;
  key: string; title: string; p0: number; p1: number;
}

/**
 * Las paradas salen de `subject_plans.items[].lecciones[]`, que es donde viven
 * desde que el camino es de unidades. El `documentId` está en el PADRE, no en la
 * lección: sin él, un rango de páginas cae en varios libros a la vez — la misma
 * materia cuelga el texto del estudiante, cuatro tomos de guía docente y los
 * módulos EPJA, y "págs. 18-19" existe en todos.
 */
async function paradas(): Promise<Parada[]> {
  const rows = (await sql`
    select s.id as subject_id, s.name as subject_name,
           it->>'documentId' as document_id,
           l->>'key' as key, l->>'title' as title,
           (l->>'p0')::int as p0, (l->>'p1')::int as p1
    from subject_plans sp
    join subjects s on s.id = sp.subject_id
    cross join lateral jsonb_array_elements(sp.items) it
    cross join lateral jsonb_array_elements(it->'lecciones') l
    where l->>'p0' is not null
      and (${MATERIA ?? null}::text is null or s.name ilike ${MATERIA ? `%${MATERIA}%` : null})
      and (${KEY ?? null}::text is null or l->>'key' = ${KEY ?? null})
    order by s.name, (l->>'p0')::int`) as unknown as {
    subject_id: string; subject_name: string; document_id: string | null;
    key: string; title: string; p0: number; p1: number;
  }[];
  return rows.map((r) => ({
    subjectId: r.subject_id, subjectName: r.subject_name, documentId: r.document_id,
    key: r.key, title: r.title, p0: r.p0, p1: r.p1,
  }));
}

/**
 * El error frecuente que el autor de la guía docente escribió para este tema.
 * Es el mejor insumo del corpus y hoy no lo usa nadie.
 *
 * ⚠️ La guía NO se puede ligar por índice: de las 1.846 paradas solo 3 tienen
 * `unit` y 198 tienen `lesson`, y los heading_path de la guía dicen literalmente
 * "Unidad ? Lección ?". Así que se busca por PALABRAS del título, que es pobre
 * pero determinístico. Lo que no matchea se queda sin bloque, y está bien: es
 * mejor no mostrarlo que mostrar el error frecuente de otra lección.
 */
async function errorFrecuente(subjectId: string, titulo: string): Promise<string | null> {
  const palabras = titulo
    .toLowerCase()
    .replace(/[¿?¡!.,:;()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !/^(sobre|para|como|cual|cuales|nuestro|nuestra|manera|parte|mundo)$/.test(w));
  if (palabras.length === 0) return null;
  const rows = (await sql`
    select ch.content
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId}
      and ch.corpus_role = 'pedagogy'
      and ch.pedagogy_type = 'errores_frecuentes'
      and ch.content ilike any(${palabras.map((w) => `%${w}%`)})
    limit 1`) as unknown as { content: string }[];
  const t = rows[0]?.content;
  if (!t) return null;
  // Se le saca el encabezado sintético del ingestor y se corta: es una pista para
  // el prompt, no un texto para mostrar entero.
  // Se juntan los guiones de corte del PDF ("se pro- pagan" → "se propagan") y se
  // corta en ORACIÓN ENTERA: cortar a los 700 caracteres dejaba la premisa del
  // gate terminada a mitad de palabra ("la estructura especializada para prod").
  const limpio = t
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/([a-záéíóúñü])-\s+([a-záéíóúñü])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (limpio.length <= 700) return limpio;
  const corte = limpio.slice(0, 700).lastIndexOf(".");
  return corte > 200 ? limpio.slice(0, corte + 1) : limpio.slice(0, 700);
}

async function main() {
  const lista = (await paradas()).slice(0, LIMITE);
  // Un filtro que no matchea devolvía "0 paradas" sin decir por qué, y el nombre
  // real de la materia casi nunca es el que uno escribe ("Historia Geografía Y
  // Ciencias Sociales 1º Medio", sin coma). Mejor fallar ruidoso.
  if (lista.length === 0) {
    console.log(`Ningún resultado para ${MATERIA ? `--materia "${MATERIA}"` : ""}${KEY ? `--key ${KEY}` : ""}.`);
    const cs = (await sql`select distinct s.name from subjects s join subject_plans sp on sp.subject_id = s.id order by s.name limit 40`) as unknown as { name: string }[];
    console.log(`Materias con plan:\n  ${cs.map((c) => c.name).join("\n  ")}`);
    await sql.end();
    return;
  }
  console.log(`${lista.length} parada(s)${APLICAR ? "" : "  [ensayo: no escribe]"}\n`);

  let ok = 0, sinMaterial = 0, fallo = 0, sinGate = 0;

  for (const p of lista) {
    const etiqueta = `${p.subjectName} · ${p.title} (${p.key}, p.${p.p0}-${p.p1})`;
    if (!p.documentId) { console.log(`  –  ${etiqueta}\n     sin documentId en el plan`); sinMaterial++; continue; }

    const frags = await fetchLessonMaterial({
      subjectId: p.subjectId, documentId: p.documentId, pageStart: p.p0, pageEnd: p.p1,
    });
    const oraciones = partirEnOraciones(frags.map((f) => ({ content: f.content, page: f.page })));
    if (oraciones.length < 3) {
      console.log(`  –  ${etiqueta}\n     ${frags.length} fragmento(s) → ${oraciones.length} oración(es) usables: no alcanza`);
      sinMaterial++; continue;
    }

    const ef = await errorFrecuente(p.subjectId, p.title);
    const t0 = Date.now();
    try {
      let clase = null as Awaited<ReturnType<typeof armarClase>> | null;
      let ultimo: unknown = null;
      for (let intento = 0; intento <= REINTENTOS && !clase; intento++) {
        try {
          const c = await armarClase({
            titulo: p.title, subjectName: p.subjectName, oraciones, errorFrecuente: ef,
          });
          clase = await verificarClase(c, oraciones, nliPairs);
        } catch (e) {
          ultimo = e;
          if (intento < REINTENTOS) console.log(`     · intento ${intento + 1} sin clase (${e instanceof SinClase ? e.razon : e}), reintento`);
        }
      }
      if (!clase) throw ultimo;
      const seg = ((Date.now() - t0) / 1000).toFixed(1);

      const g = clase.gate!;
      if (!g.corrido) sinGate++;
      console.log(
        `  ✓  ${etiqueta}\n` +
        `     ${oraciones.length} oraciones → ${clase.momentos.length}/${cuantosMomentos(oraciones)} momentos · ${seg}s · ` +
        (g.corrido
          ? `gate: ${g.respaldadas}/${g.afirmaciones} respaldadas, ${g.contradichas} contradichas`
          : `GATE NO CORRIÓ (${g.motivo})`) +
        (ef ? " · con error frecuente" : ""),
      );
      for (const m of clase.momentos) {
        if (!VER) { console.log(`       · ${m.titulo}  [p.${m.pagina}]  "${m.texto.slice(0, 90)}…"`); continue; }
        console.log(`\n     ── ${m.titulo}  [pág. ${m.pagina}] ──`);
        if (m.entrada) console.log(`     entrada: ${m.entrada}`);
        console.log(`     LIBRO: "${m.texto}"`);
        console.log(`     GLOSA: ${m.glosa}`);
        for (const a of m.afirmaciones) {
          const mk = a.veredicto === "respaldada" ? "✓" : a.veredicto === "contradicha" ? "✗" : "~";
          console.log(`       ${mk} ${a.texto}  [oraciones ${a.fuentes.join(",")}]`);
        }
        console.log(`     PALABRAS: ${m.palabras.map((x) => `${x.palabra} = ${x.enCriollo}`).join(" · ")}`);
        console.log(`     EJEMPLO (sin sello): ${m.ejemplo}`);
        console.log(`     CHEQUEO: ${m.chequeo.pregunta}`);
        m.chequeo.opciones.forEach((o, i) => console.log(`        ${i === m.chequeo.correcta ? "→" : " "} ${o}`));
      }
      if (VER) {
        console.log(`\n     APERTURA: ${clase.apertura}`);
        console.log(`     CIERRE: ${clase.cierre}`);
        if (clase.errorFrecuente) console.log(`     ERROR FRECUENTE (libro del profesor): ${clase.errorFrecuente.slice(0, 300)}`);
      }

      if (APLICAR) {
        await sql`
          insert into lesson_classes (subject_id, topic_key, clase, gate, topic_title)
          values (${p.subjectId}, ${p.key}, ${toJson(sql, clase)}, ${toJson(sql, clase.gate ?? null)}, ${p.title})
          on conflict (subject_id, topic_key) do update
            set clase = excluded.clase, gate = excluded.gate,
                topic_title = excluded.topic_title, generated_at = now()`;
      }
      ok++;
    } catch (e) {
      const razon = e instanceof SinClase ? e.razon : e instanceof Error ? e.message : String(e);
      console.log(`  ✗  ${etiqueta}\n     ${razon}`);
      fallo++;
    }
  }

  console.log(`\n${ok} listas · ${sinMaterial} sin material · ${fallo} fallaron`);
  if (sinGate > 0) console.log(`⚠️  ${sinGate} sin gate: el sidecar no estaba. Hay que volver a pasarlas.`);
  if (!APLICAR && ok > 0) console.log(`\nNo se escribió nada. Con --aplicar se guardan.`);
  await sql.end();
}

void main();
