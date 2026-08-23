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
import { agruparEnUnidades, rangosDeUnidades, tituloDeUnidad } from "./unidades";
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

/**
 * Dónde empiezan a numerarse las unidades. El índice más largo del corpus tiene
 * 115 entradas, así que 1000 deja margen de sobra y hace evidente, mirando la
 * fila, que ese `ord` es de una unidad y no de una lección.
 */
const ORD_UNIDADES = 1000;

/**
 * Las UNIDADES de un documento, escritas como `book_sections` de nivel 1.
 *
 * NO toca el nivel 2. Las lecciones del índice se quedan donde están, enteras:
 * son la granularidad fina que después se cruza con las bases curriculares del
 * estado, y perderlas costaría volver a parsear 93 libros. Acá solo se agrega
 * una capa por encima, y el borrado previo está acotado a lo que este mismo job
 * escribió (`method = 'unidad_chunks'`), para poder re-correrlo sin miedo.
 *
 * El título se busca en tres lugares, en este orden (medido sobre 176 unidades):
 *   1. el encabezado corriente "Unidad N • Título"      → 56%
 *   2. la primera sección del índice dentro del rango   → 34%
 *   3. "Unidad N" a secas                               → 10%
 * El paso 2 es la razón por la que conservar el índice paga solo: la lección
 * "¿Qué es la sexualidad y cuáles son sus dimensiones?" nombra la unidad 2 de
 * Biología, que en el texto no tiene encabezado.
 */
export async function buildUnitsForDocument(
  documentId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ documentId: string; documentTitle: string; sections: BookSection[]; motivo?: string }> {
  const sql = getSql();
  const [doc] = await sql<{ id: string; title: string; subject_id: string }[]>`
    select id, title, subject_id from documents where id = ${documentId}`;
  if (!doc) throw new Error(`documento inexistente: ${documentId}`);

  // CON ÍNDICE: la unidad se deriva DE las lecciones — a cada una se le asigna
  // la unidad que más chunks tiene en su rango de páginas, y se agrupan las
  // corridas consecutivas. Así la cobertura es completa por construcción. La
  // otra vía (recortar rangos de páginas y ver qué lección cae adentro) dejaba
  // agujeros: en Biología se perdían 107 páginas entre la unidad 1 y la 2.
  const indice = await sql<{ ord: number; title: string; page_start: number; page_end: number; unit: number | null }[]>`
    select bs.ord, bs.title, bs.page_start, bs.page_end,
           (select ch.unit
              from chunks ch
             where ch.document_id = bs.document_id and ch.corpus_role = 'content'
               and ch.page between bs.page_start and bs.page_end and ch.unit is not null
             group by ch.unit
             order by count(*) desc, ch.unit
             limit 1) as unit
    from book_sections bs
    where bs.document_id = ${documentId} and bs.level = 2
    order by bs.ord`;

  // SIN ÍNDICE: la unidad se recorta de los chunks y el camino no se desglosa.
  const paginas = await sql<{ page: number; unit: number; chunks: number }[]>`
    select page, unit, count(*)::int as chunks
    from chunks
    where document_id = ${documentId} and corpus_role = 'content'
      and unit is not null and page is not null
    group by page, unit`;
  const porChunks = rangosDeUnidades(paginas);
  const porIndice = indice.length >= 3
    ? agruparEnUnidades(indice.map((l) => ({
        ord: l.ord, unit: l.unit, pageStart: l.page_start, pageEnd: l.page_end,
      })))
    : [];

  // Se elige la vía que produce MÁS unidades, no la primera que devuelve algo.
  // Historia 1º básico tiene un índice de apenas 3 lecciones: agruparlas daba
  // una sola unidad y el libro se quedaba sin camino, cuando sus chunks traen
  // las 4 unidades bien separadas. El índice gana los empates porque además
  // aporta las lecciones como puntos de control.
  const rangos = porIndice.length >= porChunks.length ? porIndice : porChunks;
  if (rangos.length < 2) {
    return {
      documentId, documentTitle: doc.title, sections: [],
      motivo: paginas.length === 0 && indice.length === 0 ? "sin unidad en los chunks"
            : rangos.length === 1 ? "una sola unidad"
            : "rangos no creíbles",
    };
  }

  const sections: BookSection[] = [];
  for (const [i, r] of rangos.entries()) {
    const contenidos = await sql<{ content: string }[]>`
      select content from chunks
      where document_id = ${documentId} and corpus_role = 'content'
        and page between ${r.pageStart} and ${r.pageEnd}
      order by page, chunk_index`;
    const delEncabezado = tituloDeUnidad(r.unit, contenidos.map((c) => c.content));
    // La primera lección del índice dentro del rango nombra la unidad cuando el
    // encabezado corriente no está en el texto. Medido: recupera el 34% de los
    // títulos, y por eso conservar el índice paga solo — "¿Qué es la sexualidad
    // y cuáles son sus dimensiones?" nombra una unidad que si no sería "Unidad 2".
    const delIndice = indice.find((s) => s.page_start >= r.pageStart && s.page_start <= r.pageEnd);
    const title = delEncabezado ?? delIndice?.title ?? `Unidad ${r.unit}`;
    sections.push({
      // `book_sections` tiene un unique (document_id, ord): unidades y lecciones
      // comparten el mismo espacio de numeración dentro de un libro. Las unidades
      // arrancan en ORD_UNIDADES para no chocar con los 0..N del índice, que ya
      // están escritos y no se tocan.
      ord: ORD_UNIDADES + i,
      level: 1,
      parentOrd: null,
      title,
      unitNo: r.unit,
      lessonNo: null,
      folio: null,
      pageStart: r.pageStart,
      pageEnd: r.pageEnd,
      method: "unidad_chunks",
      // La confianza dice de dónde salió el nombre, que es lo único incierto:
      // el rango ya pasó el saneado o no estaríamos acá.
      confidence: delEncabezado ? 0.9 : delIndice ? 0.7 : 0.5,
    });
  }

  if (opts.dryRun) return { documentId, documentTitle: doc.title, sections };

  await sql.begin(async (tx) => {
    // ACOTADO A PROPÓSITO: solo lo que escribió este job. Un `delete ... where
    // document_id = X` se llevaría puesto el índice, que es justamente lo que
    // no se puede perder.
    await tx`delete from book_sections
             where document_id = ${documentId} and level = 1 and method = 'unidad_chunks'`;
    for (const s of sections) {
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
  return { documentId, documentTitle: doc.title, sections };
}

/**
 * De qué LIBRO es un tema del plan. `null` si la clave no corresponde a esta materia.
 *
 * Hace falta porque una materia puede tener varios libros y sus páginas se pisan:
 * Matemática 6º tiene el texto del estudiante y dos tomos de Sumo Primero, y
 * Lenguaje 1º tiene ocho documentos. Sin esto, pedir "el material de las páginas
 * 15 a 16" devuelve fragmentos de todos los libros que tengan esas páginas
 * —medido: 1 de cada 3 fragmentos de esa lección venía de Sumo Primero—, y ese
 * material es el que alimenta las preguntas del quiz, o sea la nota del alumno.
 *
 * Se resuelve en el SERVIDOR y no se acepta del cliente: el documento decide qué
 * texto se evalúa, y eso no lo puede elegir el navegador.
 *
 * Dos formas de clave, las dos resolubles:
 *  · `legacy:{documentId}:{unit}-{lesson}` — el documento viene en la clave.
 *  · `s{hash}` de `claveTema(documentId, ord, title)` — no es reversible, así que
 *    se recalcula sobre las secciones de la materia y se busca la que coincide.
 */
export async function documentoDeTema(
  subjectId: string,
  topicKey: string,
): Promise<string | null> {
  const legacy = /^legacy:([0-9a-f-]{36}):/i.exec(topicKey);
  if (legacy) return legacy[1] ?? null;

  const sql = getSql();
  // Sin filtrar por `level`: la clave puede ser de una unidad o de una lección.
  const secciones = await sql<{ document_id: string; ord: number; title: string }[]>`
    select document_id, ord, title from book_sections where subject_id = ${subjectId}`;
  for (const s of secciones) {
    if (claveTema(s.document_id, s.ord, s.title) === topicKey) return s.document_id;
  }
  return null;
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

/** Una unidad del camino, con sus lecciones adentro. */
export interface PlanUnit extends PlanTopic {
  /** Los puntos de control de la unidad. Vacío cuando el libro no tiene índice:
   *  ahí la unidad es el nodo y no se desglosa. */
  lecciones: PlanTopic[];
}

/**
 * EL CAMINO: las unidades de una materia, cada una con sus lecciones adentro.
 *
 * Separado de `getPlanTopics` a propósito. El camino quiere nodos grandes —una
 * unidad engloba más y da para enseñar de verdad— pero la PRUEBA quiere
 * lecciones: un test sobre "toda la unidad 3" son cuarenta páginas y seis
 * preguntas no las cubren. Son dos granularidades para dos cosas distintas, y
 * meterlas en la misma función terminaba en un parámetro que nadie sabía cómo
 * pasar.
 *
 * La lección pertenece a la unidad cuyo rango de páginas la contiene. Se resuelve
 * al LEER y no escribiendo `parent_ord`, para no tocar una sola fila del índice:
 * son las que después se cruzan con las bases curriculares del estado.
 *
 * Devuelve vacío si la materia no tiene unidades — quien llama cae a
 * `getPlanTopics` y arma el camino por lecciones, como antes.
 */
export async function getPlanUnits(subjectId: string): Promise<PlanUnit[]> {
  const sql = getSql();
  // `unidad_chunks` primero: seis libros tienen unidades viejas sacadas del
  // índice y algunas están rotas (Matemática 2º Medio: cuatro unidades que
  // abarcan cuatro páginas). No se borran —son parte del índice— pero pierden.
  const unidades = await sql<{
    document_id: string; subject_id: string; doc_title: string; ord: number; title: string;
    unit_no: number | null; page_start: number; page_end: number;
  }[]>`
    select bs.document_id, bs.subject_id, d.title as doc_title, bs.ord, bs.title,
           bs.unit_no, bs.page_start, bs.page_end
    from book_sections bs
    join documents d on d.id = bs.document_id
    where bs.subject_id = ${subjectId} and bs.level = 1
      and (bs.method = 'unidad_chunks'
           or not exists (select 1 from book_sections o
                           where o.document_id = bs.document_id and o.level = 1
                             and o.method = 'unidad_chunks'))
    order by d.title, bs.page_start`;
  const lecciones = await sql<{
    document_id: string; subject_id: string; doc_title: string; ord: number; title: string;
    unit_no: number | null; lesson_no: number | null; page_start: number; page_end: number;
  }[]>`
    select bs.document_id, bs.subject_id, d.title as doc_title, bs.ord, bs.title,
           bs.unit_no, bs.lesson_no, bs.page_start, bs.page_end
    from book_sections bs
    join documents d on d.id = bs.document_id
    where bs.subject_id = ${subjectId} and bs.level = 2
    order by bs.page_start`;

  /**
   * ── LA UNIDAD LLEGA HASTA DONDE EMPIEZA LA SIGUIENTE ──────────────────────
   * Las unidades que el parser ubica por folio son MARCADORES DE UNA PÁGINA: la
   * portadilla donde dice "Unidad 2". Historia 6º tenía nueve unidades en
   * p.9-9, 25-25, 45-45, 65-65… y la lección de la página 27 no caía adentro de
   * ninguna. Medido el 2026-08-23: 108 de sus 186 lecciones quedaban huérfanas,
   * o sea que existían en el índice y no aparecían en el camino de nadie.
   *
   * Un libro no tiene huecos entre unidades: la unidad que arranca en la 25
   * llega hasta la 44 porque en la 45 arranca la siguiente. Eso es lo que se
   * calcula acá. Para las unidades que ya venían bien —las de `unidad_chunks`
   * embaldosan (10-49, 50-101, 102-149)— la cuenta da lo mismo y no las toca.
   *
   * Se hace al LEER y no corrigiendo `book_sections`: el rango guardado es lo
   * que el parser encontró de verdad, y pisarlo perdería el dato de que la
   * portadilla está en esa página.
   */
  type Unidad = (typeof unidades)[number];
  type Leccion = (typeof lecciones)[number];

  const finDeDoc = new Map<string, number>();
  const inicioDeDoc = new Map<string, number>();
  for (const l of lecciones) {
    finDeDoc.set(l.document_id, Math.max(finDeDoc.get(l.document_id) ?? 0, l.page_end));
    inicioDeDoc.set(l.document_id, Math.min(inicioDeDoc.get(l.document_id) ?? l.page_start, l.page_start));
  }
  const porDoc = new Map<string, Unidad[]>();
  for (const u of unidades) {
    if (!porDoc.has(u.document_id)) porDoc.set(u.document_id, []);
    porDoc.get(u.document_id)!.push(u);
  }
  for (const us of porDoc.values()) {
    us.sort((a, b) => a.page_start - b.page_start);
    for (const [i, u] of us.entries()) {
      const limite = i + 1 < us.length
        ? us[i + 1]!.page_start - 1
        // La última llega hasta donde termina la última lección del tomo.
        : (finDeDoc.get(u.document_id) ?? u.page_end);
      if (limite > u.page_end) u.page_end = limite;
    }
    // Y la PRIMERA arranca donde arranca la primera lección del tomo. Simétrico
    // con lo de arriba: la portadilla de la Unidad 1 está en la página 10 y la
    // lección de apertura en la 8, así que sin esto queda afuera de su propia
    // unidad. Son 15 lecciones en el corpus.
    const primera = us[0];
    if (primera) {
      const arranque = inicioDeDoc.get(primera.document_id);
      if (arranque !== undefined && arranque < primera.page_start) primera.page_start = arranque;
    }
  }

  /**
   * ── UN TOMO CON LECCIONES Y SIN UNIDADES TAMBIÉN ES UN NODO ───────────────
   * Varias materias tienen dos tomos: el texto del estudiante y el del programa
   * EPJA. A veces el parser saca unidades de uno y lecciones del otro, y como la
   * lección se asigna a una unidad DEL MISMO documento, las del tomo sin
   * unidades no aparecen en ningún lado. Lenguaje 6º perdía así sus 30 lecciones
   * del tomo EPJA — el 91% de las que tenía.
   *
   * Se le arma UNA unidad sintética al tomo, que es lo que el tomo es: un bloque
   * de material con nombre propio. Inventar divisiones adentro sería fabricar
   * una estructura que el libro no tiene.
   */
  const docsConUnidad = new Set(unidades.map((u) => u.document_id));
  const huerfanos = new Map<string, Leccion[]>();
  for (const l of lecciones) {
    if (docsConUnidad.has(l.document_id)) continue;
    if (!huerfanos.has(l.document_id)) huerfanos.set(l.document_id, []);
    huerfanos.get(l.document_id)!.push(l);
  }
  for (const [docId, ls] of huerfanos) {
    unidades.push({
      document_id: docId,
      subject_id: ls[0]!.subject_id,
      doc_title: ls[0]!.doc_title,
      // `ord` negativo: no colisiona con ninguna fila real de `book_sections`,
      // así que la clave del tema es estable y propia.
      ord: -1,
      title: tomo(ls[0]!.doc_title).replace(/\s*·\s*$/, "") || ls[0]!.doc_title,
      unit_no: null,
      page_start: Math.min(...ls.map((l) => l.page_start)),
      page_end: Math.max(...ls.map((l) => l.page_end)),
    });
  }
  unidades.sort((a, b) => a.doc_title.localeCompare(b.doc_title) || a.page_start - b.page_start);

  if (unidades.length < 2) return [];

  const variosTomos = new Set(unidades.map((u) => u.document_id)).size > 1;
  const muestras = await muestrasDeRango(unidades.map((u) => ({
    documentId: u.document_id, pageStart: u.page_start, pageEnd: u.page_end,
  })));

  return unidades.map((u, i) => ({
    key: claveTema(u.document_id, u.ord, u.title),
    title: variosTomos ? `${tomo(u.doc_title)}${u.title}` : u.title,
    documentId: u.document_id,
    subjectId: u.subject_id,
    documentTitle: u.doc_title,
    pageStart: u.page_start,
    pageEnd: u.page_end,
    unitNo: u.unit_no,
    lessonNo: null,
    sample: muestras[i] ?? "",
    source: "index" as const,
    lecciones: lecciones
      .filter((l) => l.document_id === u.document_id
                  && l.page_start >= u.page_start && l.page_start <= u.page_end)
      .map((l) => ({
        key: claveTema(l.document_id, l.ord, l.title),
        title: l.title,
        documentId: l.document_id,
        subjectId: l.subject_id,
        documentTitle: l.doc_title,
        pageStart: l.page_start,
        pageEnd: l.page_end,
        unitNo: l.unit_no,
        lessonNo: l.lesson_no,
        sample: "",
        source: "index" as const,
      })),
  }));
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
 * CUÁNTAS lecciones tendría el plan de cada materia, sin armarlo.
 *
 * Existe porque el panel contaba el plan por su cuenta y le salía distinto.
 * `/api/progress` hacía `from book_sections where level = 2 having count(*) >= 3`
 * y devolvía NADA para las materias sin índice legible — pero `getPlanTopics`,
 * en ese mismo caso, cae al fallback legacy y devuelve lecciones igual. El panel
 * leía `planTotal = 0`, marcaba `sinCamino` y APAGABA el botón "Camino" de una
 * materia que sí tenía siete lecciones. Ciencias Naturales 4º básico decía
 * "Con guía docente" y no se podía abrir.
 *
 * La regla es la de `getPlanTopics` y ahora vive en un solo lado: índice si hay
 * al menos 3 secciones, si no el legacy con su filtro de sanidad, si no nada.
 * Cambiar el criterio acá lo cambia en los dos lugares a la vez, que es
 * exactamente lo que no pasaba antes.
 */
export async function planSizes(subjectIds?: string[]): Promise<Record<string, number>> {
  const sql = getSql();
  // Con filtro, la consulta de UNA materia no recorre los 29.000 chunks del
  // corpus entero. El panel las pide todas de una; el camino, la suya.
  const soloEstas = subjectIds?.length ? subjectIds : null;
  const filas = await sql<{ subject_id: string; n: number }[]>`
    with uni as (
      -- Las UNIDADES mandan: son los nodos del camino. Si el panel contara las
      -- lecciones diría "0 de 14" mientras el camino muestra 6 unidades, que es
      -- exactamente el desfase que ya nos costó una vez.
      select bs.subject_id, count(*)::int as n
      from book_sections bs
      where bs.level = 1 and bs.method = 'unidad_chunks'
        ${soloEstas ? sql`and bs.subject_id = any(${soloEstas}::uuid[])` : sql``}
      group by bs.subject_id having count(*) >= 2
    ), idx as (
      select bs.subject_id, count(*)::int as n
      from book_sections bs where bs.level = 2
        ${soloEstas ? sql`and bs.subject_id = any(${soloEstas}::uuid[])` : sql``}
      group by bs.subject_id having count(*) >= 3
    ), leg as (
      select subject_id, count(*)::int as n from (
        select d.subject_id
        from chunks ch
        join documents d on d.id = ch.document_id
        where ch.corpus_role = 'content'
          and ch.unit is not null and ch.lesson is not null and ch.page is not null
          ${soloEstas ? sql`and d.subject_id = any(${soloEstas}::uuid[])` : sql``}
        group by d.subject_id, ch.document_id, ch.unit, ch.lesson
        having count(distinct ch.page)::float / (max(ch.page) - min(ch.page) + 1) >= 0.5
           and (max(ch.page) - min(ch.page)) <= 60
      ) g group by subject_id having count(*) >= 3
    )
    select s.id as subject_id, least(coalesce(uni.n, idx.n, leg.n), ${PLAN_TOPE})::int as n
    from subjects s
    left join uni on uni.subject_id = s.id
    left join idx on idx.subject_id = s.id
    left join leg on leg.subject_id = s.id
    where (uni.n is not null or idx.n is not null or leg.n is not null)
      ${soloEstas ? sql`and s.id = any(${soloEstas}::uuid[])` : sql``}`;
  const out: Record<string, number> = {};
  for (const f of filas) out[f.subject_id] = f.n;
  return out;
}

/** Tope de lecciones de un plan. El mismo `limit` por defecto de `getPlanTopics`. */
const PLAN_TOPE = 14;

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
