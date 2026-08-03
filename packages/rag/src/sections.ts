/**
 * TEMAS DEL PLAN DE ESTUDIO — la fuente ÚNICA de `/api/plan` y `/api/test`.
 *
 * Antes cada ruta tenía su propia copia (byte a byte) de una query que agrupaba
 * por `chunks.unit/lesson`, metadata rota que producía temas como "Organización
 * del texto de estudio · pág. 8-138". Acá se centraliza y se cambia la fuente:
 * el ÍNDICE del propio libro (`book-index.ts`), con un fallback saneado para los
 * libros cuyo índice no se puede leer.
 */
import { getSql } from "@tutor-ia/db";
import { buildBookIndex, type BookSection, type IndexChunk } from "./book-index";

export interface PlanTopic {
  /** Identidad estable: sobrevive al rebuild de las secciones. */
  key: string;
  title: string;
  documentId: string;
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

  // Reemplazo atómico: las secciones son derivadas, no hay estado que preservar.
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
export async function getPlanTopics(
  subjectId: string,
  opts: { limit?: number } = {},
): Promise<PlanTopic[]> {
  const sql = getSql();
  const limit = opts.limit ?? 14;

  const secciones = await sql<{
    document_id: string; doc_title: string; ord: number; title: string;
    unit_no: number | null; lesson_no: number | null;
    page_start: number; page_end: number;
  }[]>`
    select bs.document_id, d.title as doc_title, bs.ord, bs.title,
           bs.unit_no, bs.lesson_no, bs.page_start, bs.page_end
    from book_sections bs
    join documents d on d.id = bs.document_id
    where bs.subject_id = ${subjectId} and bs.level = 2
    order by d.title, bs.page_start`;

  if (secciones.length >= 3) {
    const variosTomos = new Set(secciones.map((s) => s.document_id)).size > 1;
    const elegidas = secciones.slice(0, limit);
    const muestras = await muestrasDeRango(elegidas.map((s) => ({
      documentId: s.document_id, pageStart: s.page_start, pageEnd: s.page_end,
    })));
    return elegidas.map((s, i) => ({
      key: claveTema(s.document_id, s.ord, s.title),
      title: variosTomos ? `${tomo(s.doc_title)}${s.title}` : s.title,
      documentId: s.document_id,
      documentTitle: s.doc_title,
      pageStart: s.page_start,
      pageEnd: s.page_end,
      unitNo: s.unit_no,
      lessonNo: s.lesson_no,
      sample: muestras[i] ?? "",
      source: "index" as const,
    }));
  }

  return legacyTopics(subjectId, limit);
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
