/**
 * TEMAS DEL PLAN DE ESTUDIO — la fuente ÚNICA de `/api/plan` y `/api/test`.
 *
 * Antes cada ruta tenía su propia copia (byte a byte) de una query que agrupaba
 * por `chunks.unit/lesson`, metadata rota que producía temas como "Organización
 * del texto de estudio · pág. 8-138". Acá se centraliza y se cambia la fuente:
 * el ÍNDICE del propio libro (`book-index.ts`), con un fallback saneado para los
 * libros cuyo índice no se puede leer.
 */
import { getSql, toJson } from "@tutor-ia/db";
import { buildBookIndex, type BookSection, type IndexChunk } from "./book-index";
import { rerank } from "./rerank";

export interface PlanTopic {
  /** Identidad estable: sobrevive al rebuild de las secciones. */
  key: string;
  title: string;
  documentId: string;
  /** Materia a la que pertenece la lección. En el plan sugerido es siempre la
   *  misma; en el plan A MEDIDA puede variar tema a tema, y el progreso la
   *  necesita (student_plan_progress.subject_id es NOT NULL). */
  subjectId: string;
  /** Título del libro; se usa como prefijo cuando la materia tiene varios tomos. */
  documentTitle: string;
  pageStart: number;
  pageEnd: number;
  unitNo: number | null;
  lessonNo: number | null;
  /** Muestra del contenido real del tema — 4 fragmentos repartidos a lo largo de
   *  la lección, no solo su comienzo. Ver `muestraRepresentativa`. */
  sample: string;
  source: "index" | "legacy";
}

/** Filas que devuelve el constructor sin escribir (modo simulacro). */
export interface BuildResult {
  documentId: string;
  documentTitle: string;
  tier: "A" | "B" | null;
  motivo?: string;
  sections: BookSection[];
}

/**
 * Deriva las secciones de UN documento a partir de su índice. Con `dryRun` no
 * escribe: sirve para iterar el parser contra el corpus real sin tocar la base.
 */
export async function buildSectionsForDocument(
  documentId: string,
  opts: { dryRun?: boolean } = {},
): Promise<BuildResult> {
  const sql = getSql();
  const [doc] = await sql<{ id: string; title: string; subject_id: string }[]>`
    select id, title, subject_id from documents where id = ${documentId}`;
  if (!doc) throw new Error(`documento inexistente: ${documentId}`);

  const chunks = await sql<IndexChunk[]>`
    select id as "chunkId", page, content
    from chunks
    where document_id = ${documentId} and corpus_role = 'content'`;

  const r = buildBookIndex(chunks);
  const out: BuildResult = {
    documentId,
    documentTitle: doc.title,
    tier: r.tier,
    motivo: r.motivo,
    sections: r.sections,
  };
  if (opts.dryRun || r.sections.length === 0) return out;

  // ⚠️ ESTE COMENTARIO DECÍA "las secciones son derivadas, no hay estado que
  // preservar". ES FALSO, y es la clase de frase que hace que alguien reconstruya
  // sin pensarlo dos veces.
  //
  // `topic_key = claveTema(documentId, ord, title)` (más abajo en este archivo)
  // es la identidad del PROGRESO DEL ALUMNO: `student_plan_progress` y
  // `student_weak_topics` la guardan como texto, sin FK. Si al reconstruir cambia
  // el `ord` de una sección o se le corrige el `title`, esas filas quedan
  // huérfanas y el chico ve su avance en cero y su lista de "Para reforzar"
  // vacía, sin ningún error.
  //
  // Reconstruir es correcto cuando el índice del libro no cambió (mismo `ord`,
  // mismo `title` → misma clave). Cuando SÍ cambia —por ejemplo al arreglar la
  // clasificación de secciones auxiliares— hay que migrar `topic_key` en la misma
  // transacción, no reconstruir y ver qué pasa.
  await sql.begin(async (tx) => {
    await tx`delete from book_sections where document_id = ${documentId}`;
    for (const s of r.sections) {
      await tx`
        insert into book_sections
          (document_id, subject_id, ord, level, parent_ord, title, unit_no, lesson_no,
           folio, page_start, page_end, method, confidence)
        values
          (${documentId}, ${doc.subject_id}, ${s.ord}, ${s.level}, ${s.parentOrd},
           ${s.title}, ${s.unitNo}, ${s.lessonNo}, ${s.folio},
           ${s.pageStart}, ${s.pageEnd}, ${s.method}, ${s.confidence})`;
    }
  });
  return out;
}

/** Identidad estable de un tema: no depende del uuid de la fila (que cambia en
 *  cada rebuild) ni de la posición en la lista. */
function claveTema(documentId: string, ord: number, title: string): string {
  const base = `${documentId}|${ord}|${title.toLowerCase().replace(/\s+/g, " ").trim()}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0;
  return `s${(h >>> 0).toString(36)}`;
}

/**
 * Los temas de estudio de una materia.
 *
 * Prefiere las secciones del índice; si el libro no las tiene, cae al agrupado
 * legacy por (unit, lesson) CON FILTRO DE SANIDAD. Devuelve vacío si no hay al
 * menos 3 temas creíbles — un plan malo es peor que ninguno: el alumno estudia
 * lo que no es.
 */
/** Elige k elementos REPARTIDOS a lo largo de la lista, con jitter dentro de
 *  cada ventana. Para la simulación de prueba: `slice(0, 6)` evaluaba SIEMPRE
 *  las primeras 6 lecciones del libro (todas de la Unidad 1) y encima la misma
 *  prueba en cada intento. Ventanas disjuntas → sin repetidos y en orden. */
function muestreoRepartido<T>(xs: T[], k: number): T[] {
  if (xs.length <= k) return xs;
  const paso = xs.length / k;
  const out: T[] = [];
  for (let i = 0; i < k; i++) {
    const j = Math.min(xs.length - 1, Math.floor(i * paso + Math.random() * paso));
    out.push(xs[j]!);
  }
  return out;
}

export async function getPlanTopics(
  subjectId: string,
  opts: { limit?: number; spread?: boolean; keys?: string[] } = {},
): Promise<PlanTopic[]> {
  const sql = getSql();
  const limit = opts.limit ?? 14;
  /**
   * LECCIONES PEDIDAS POR CLAVE — el alumno eligió qué entra en su prueba.
   *
   * Manda sobre `spread`: cuando hay un pedido explícito, repartir por todo el
   * libro sería ignorarlo. Y manda sobre el orden: se respeta el del índice,
   * que es el que el alumno vio en el camino.
   *
   * Si se piden MÁS de `limit`, se reparten a lo largo de LO ELEGIDO (no se
   * cortan las primeras): la prueba sigue tocando el principio y el final de lo
   * que el alumno marcó. Quien llama es el que avisa que hubo recorte.
   */
  const pedidas = opts.keys?.length ? new Set(opts.keys) : null;

  const secciones = await sql<{
    document_id: string; subject_id: string; doc_title: string; ord: number; title: string;
    unit_no: number | null; lesson_no: number | null;
    page_start: number; page_end: number;
  }[]>`
    select bs.document_id, bs.subject_id, d.title as doc_title, bs.ord, bs.title,
           bs.unit_no, bs.lesson_no, bs.page_start, bs.page_end
    from book_sections bs
    join documents d on d.id = bs.document_id
    where bs.subject_id = ${subjectId} and bs.level = 2
    order by d.title, bs.page_start`;

  if (secciones.length >= 3) {
    const variosTomos = new Set(secciones.map((s) => s.document_id)).size > 1;
    const candidatas = pedidas
      ? secciones.filter((s) => pedidas.has(claveTema(s.document_id, s.ord, s.title)))
      : secciones;
    // `spread` reparte por todo el libro (prueba); sin él, el ORDEN del índice
    // manda (plan de estudio: las primeras `limit` lecciones, como siempre).
    const elegidas = pedidas
      ? (candidatas.length > limit ? muestreoRepartido(candidatas, limit) : candidatas)
      : opts.spread
        ? muestreoRepartido(secciones, limit)
        : secciones.slice(0, limit);
    // Con pedido y cero coincidencias se devuelve VACÍO en vez de caer al
    // legacy: el libro sí tiene índice, así que las claves son de otra cosa
    // (un plan viejo, otra materia) y servir "el legacy de toda la materia"
    // sería tomarle una prueba de lo que no eligió.
    if (elegidas.length === 0) return [];
    const muestras = await muestrasDeRango(elegidas.map((s) => ({
      documentId: s.document_id, pageStart: s.page_start, pageEnd: s.page_end,
    })));
    return elegidas.map((s, i) => ({
      key: claveTema(s.document_id, s.ord, s.title),
      title: variosTomos ? `${tomo(s.doc_title)}${s.title}` : s.title,
      documentId: s.document_id,
      subjectId: s.subject_id,
      documentTitle: s.doc_title,
      pageStart: s.page_start,
      pageEnd: s.page_end,
      unitNo: s.unit_no,
      lessonNo: s.lesson_no,
      sample: muestras[i] ?? "",
      source: "index" as const,
    }));
  }

  // Sin índice legible: el fallback legacy. Se pide con el tope del PLAN (14) y
  // no con `limit`, porque las claves pedidas salieron de ese mismo plan: con un
  // límite menor, la lección elegida podía quedar fuera de la consulta y "no
  // existir" para la prueba.
  const legacy = await legacyTopics(subjectId, pedidas ? Math.max(limit, 14) : limit);
  if (!pedidas) return legacy;
  const filtradas = legacy.filter((t) => pedidas.has(t.key));
  return filtradas.length > limit ? muestreoRepartido(filtradas, limit) : filtradas;
}

/**
 * Temas para un plan A MEDIDA: las lecciones REALES que hablan de lo que el
 * alumno pidió.
 *
 * `getPlanTopics` recorre el índice de una materia en orden; esto hace lo otro:
 * busca en el corpus y devuelve las lecciones donde CAYERON los resultados.
 *
 * La diferencia con "generar temas con el LLM" es la que importa: acá los temas
 * siguen siendo lecciones del libro, con su título, su rango de páginas y su
 * unidad. Un plan inventado se ve igual de bien que uno real y manda al alumno
 * a estudiar páginas que no existen — el mismo error que ya costó rehacer el
 * plan sugerido una vez.
 *
 * Ordena por cuántos fragmentos relevantes cayeron en cada lección: la que el
 * retrieval señaló más veces va primero.
 */
export async function getPlanTopicsForQuery(
  query: string,
  chunks: { documentId: string; pageStart: number | null; pageEnd: number | null }[],
  opts: { limit?: number } = {},
): Promise<PlanTopic[]> {
  const limit = opts.limit ?? 8;
  const conPagina = chunks.filter((c) => c.pageStart != null);
  if (conPagina.length === 0) return [];

  const sql = getSql();
  // Una lección "contiene" un chunk si sus rangos de página se solapan. El
  // `document_id` es imprescindible: los números de página se repiten en todos
  // los libros.
  const filas = await sql<{
    document_id: string; subject_id: string; doc_title: string; ord: number; title: string;
    unit_no: number | null; lesson_no: number | null;
    page_start: number; page_end: number; hits: number;
  }[]>`
    with pedidos as (
      select * from jsonb_to_recordset(${toJson(sql, conPagina.map((c) => ({
        d: c.documentId, p0: c.pageStart, p1: c.pageEnd ?? c.pageStart,
      })))}::jsonb) as t(d uuid, p0 int, p1 int)
    )
    select bs.document_id, bs.subject_id, d.title as doc_title, bs.ord, bs.title,
           bs.unit_no, bs.lesson_no, bs.page_start, bs.page_end,
           count(*)::int as hits
    from book_sections bs
    join documents d on d.id = bs.document_id
    join pedidos p on p.d = bs.document_id
                  and bs.page_start <= p.p1 and bs.page_end >= p.p0
    where bs.level = 2
    group by bs.document_id, bs.subject_id, d.title, bs.ord, bs.title, bs.unit_no,
             bs.lesson_no, bs.page_start, bs.page_end
    order by count(*) desc, bs.page_start
    limit ${limit * 3}`;

  if (filas.length === 0) return [];
  // FILTRO DE RELEVANCIA. Sin esto, una lección con UN fragmento de 60 entra al
  // plan igual que la que concentró quince: medido sobre "cómo se arma un
  // argumento", de 14 temas devueltos solo uno era del pedido y el resto eran
  // lecciones que rozaban una palabra. Un plan a medida lleno de temas que no
  // pediste es peor que ninguno — el alumno pierde la confianza en la función.
  //
  // El corte es RELATIVO al mejor: un pedido amplio concentra hits en muchas
  // lecciones y uno específico en pocas, así que un mínimo fijo o deja pasar
  // ruido o vacía los pedidos precisos.
  const top = filas[0]!.hits;
  const corte = Math.max(2, Math.ceil(top * 0.3));
  const candidatas = filas.filter((f) => f.hits >= corte);
  if (candidatas.length === 0) return [];

  // El conteo de fragmentos dice DÓNDE cayó la búsqueda, no si la lección trata
  // del tema. Medido con "cómo se arma un argumento para convencer": de las 5
  // lecciones mejor puntuadas por conteo, 4 eran de narrativa e identidad y solo
  // una de argumentación. El brazo léxico une los lexemas con OR, así que
  // "cómo", "arma" y "para" matchean en todo el libro.
  //
  // Se juzga con el MISMO cross-encoder que usa el chat, sobre el TÍTULO de la
  // lección — que es corto, está escrito por el autor del libro y dice de qué
  // trata. Es una llamada más sobre ~24 textos de una línea.
  const puntajes = await rerank(query, candidatas.map((f) => f.title), true);
  const relevantes = candidatas
    .map((f, i) => ({ f, s: puntajes[i] ?? 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ f }) => f);
  const variosTomos = new Set(relevantes.map((f) => f.document_id)).size > 1;
  const muestras = await muestrasDeRango(relevantes.map((f) => ({
    documentId: f.document_id, pageStart: f.page_start, pageEnd: f.page_end,
  })));
  return relevantes.map((f, i) => ({
    key: claveTema(f.document_id, f.ord, f.title),
    title: variosTomos ? `${tomo(f.doc_title)}${f.title}` : f.title,
    documentId: f.document_id,
    subjectId: f.subject_id,
    documentTitle: f.doc_title,
    pageStart: f.page_start,
    pageEnd: f.page_end,
    unitNo: f.unit_no,
    lessonNo: f.lesson_no,
    sample: muestras[i] ?? "",
    source: "index" as const,
  }));
}

/** "… — tomo 2" → "Tomo 2 · " (para que no salgan dos "Lección 1" sin contexto). */
function tomo(docTitle: string): string {
  const m = /tomo\s*(\d+|[IVX]+)/i.exec(docTitle);
  return m ? `Tomo ${m[1]} · ` : "";
}

/** Cuántos fragmentos se toman a lo largo de la lección, y cuánto de cada uno. */
const MUESTRAS_POR_TEMA = 4;
const CHARS_POR_MUESTRA = 240;

/**
 * Un fragmento que RECORRE la lección, no solo su comienzo.
 *
 * Antes esto era `left(string_agg(...), 700)`: los primeros 700 caracteres, que
 * en una lección de diez páginas son la portadilla y el párrafo de motivación.
 * Alcanzaba para titular ("Analiza el registro fósil") pero no para decir QUÉ
 * hay que estudiar adentro — el modelo nunca veía el cuerpo de la lección.
 *
 * Ahora se toman 4 fragmentos repartidos de punta a punta. Cuesta lo mismo en
 * tokens y cubre la lección entera, que es lo que hace posible sacar puntos
 * clave que no sean una paráfrasis del título.
 *
 * Pura a propósito: es la parte con lógica y se puede probar sin base.
 */
export function muestraRepresentativa(contenidos: string[]): string {
  const limpio = contenidos.map((c) => (c ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (limpio.length === 0) return "";
  const n = Math.min(MUESTRAS_POR_TEMA, limpio.length);
  const paso = limpio.length / n;
  const partes: string[] = [];
  for (let i = 0; i < n; i++) {
    // `floor(i * paso)` reparte los índices de punta a punta sin repetir cuando
    // hay más chunks que muestras, y sin salirse cuando hay menos.
    const idx = Math.min(limpio.length - 1, Math.floor(i * paso));
    partes.push(limpio[idx]!.slice(0, CHARS_POR_MUESTRA));
  }
  return partes.join(" … ");
}

/** Muestra representativa del contenido de cada rango de páginas. */
async function muestrasDeRango(
  rangos: { documentId: string; pageStart: number; pageEnd: number }[],
): Promise<string[]> {
  const sql = getSql();
  const out: string[] = [];
  for (const r of rangos) {
    const filas = await sql<{ content: string }[]>`
      select content
      from chunks
      where document_id = ${r.documentId} and corpus_role = 'content'
        and coalesce(page_start, page) <= ${r.pageEnd}
        and coalesce(page_end, page)   >= ${r.pageStart}
      order by page, chunk_index`;
    out.push(muestraRepresentativa(filas.map((f) => f.content)));
  }
  return out;
}

/**
 * Fallback para libros sin índice legible: el agrupado viejo por (unit, lesson)
 * más un FILTRO DE SANIDAD.
 *
 * `densidad = páginas distintas con chunks / (p1 − p0 + 1)`. Un grupo roto es un
 * reguero de menciones sueltas a lo largo del libro, no un bloque: la densidad
 * mide exactamente eso y es adimensional. Medido sobre el corpus: por debajo de
 * 0,10 el 100% de los grupos tiene span absurdo; entre 0,40 y 0,48 ya no queda
 * ninguno. 0,5 deja margen. El tope de 60 páginas es el otro lado: la mediana
 * real de una lección es 19.
 */
async function legacyTopics(subjectId: string, limit: number): Promise<PlanTopic[]> {
  const sql = getSql();
  const rows = await sql<{
    document_id: string; doc_title: string; unit: number | null; lesson: number | null;
    p0: number; p1: number; sample: string | null;
  }[]>`
    select ch.document_id, d.title as doc_title, ch.unit, ch.lesson,
           min(ch.page) as p0, max(ch.page) as p1,
           left(string_agg(ch.content, ' ' order by ch.page, ch.chunk_index), 700) as sample
    from chunks ch
    join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId}
      and ch.corpus_role = 'content'
      and ch.unit is not null and ch.lesson is not null
      and ch.page is not null
    group by ch.document_id, d.title, ch.unit, ch.lesson
    having count(distinct ch.page)::float / (max(ch.page) - min(ch.page) + 1) >= 0.5
       and (max(ch.page) - min(ch.page)) <= 60
    order by d.title, min(ch.page)
    limit ${limit}`;

  if (rows.length < 3) return [];
  return rows.map((r) => ({
    key: `legacy:${r.document_id}:${r.unit}-${r.lesson}`,
    // El fallback legacy agrupa por (unit, lesson) DENTRO de una materia, así
    // que la materia es la que se pidió.
    subjectId,
    title: `Unidad ${r.unit} · Lección ${r.lesson}`,
    documentId: r.document_id,
    documentTitle: r.doc_title,
    pageStart: r.p0,
    pageEnd: r.p1,
    unitNo: r.unit,
    lessonNo: r.lesson,
    sample: (r.sample ?? "").replace(/\s+/g, " ").trim(),
    source: "legacy" as const,
  }));
}
