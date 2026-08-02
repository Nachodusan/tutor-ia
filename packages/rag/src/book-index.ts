/**
 * ESTRUCTURA DEL LIBRO A PARTIR DE SU ÍNDICE.
 *
 * Por qué existe: el plan de estudio agrupaba por `chunks.unit/lesson`, metadata
 * que el extractor arma buscando "unidad N" en cualquier parte de la página y
 * arrastrando el valor entre páginas. Una mención en el cuerpo del texto cambia
 * el estado, y el resultado medido (2026-08-02) fue que 135 de 482 grupos
 * abarcan más de 60 páginas — una lección real abarca 19. El síntoma que lo
 * destapó: un tema del plan titulado "Organización del texto de estudio,
 * pág. 8-138", que es la página donde el libro explica cómo está organizado.
 *
 * La fuente correcta es el ÍNDICE del propio libro, que ya está ingestado.
 * Este módulo es PURO: recibe los chunks del documento y devuelve secciones con
 * su rango de páginas. Sin DB, sin red, testeable con fixtures.
 *
 * Dos formatos reales, ambos verificados en el corpus:
 *  - TIER A (31 materias): el índice trae el folio impreso con líderes de puntos
 *      "Lección 1 ¿Qué es el registro fósil?...............14"
 *  - TIER B (28 materias): sin folio, solo títulos en orden
 *      "Lección 1: ¿Cómo se consolidaron las ideas liberales...? Lo esencial"
 */
import { enChunk, norm } from "./text-match";

export interface IndexChunk {
  chunkId: string;
  page: number | null;
  content: string;
}

export type SectionLevel = 1 | 2 | 3; // unidad | lección | auxiliar

export interface BookSection {
  ord: number;
  level: SectionLevel;
  parentOrd: number | null;
  title: string;
  unitNo: number | null;
  lessonNo: number | null;
  /** Folio impreso en el índice (tier A). Null en tier B. */
  folio: number | null;
  pageStart: number;
  pageEnd: number;
  method: "index_folio" | "index_locate" | "index_interp";
  confidence: number;
}

export interface BookIndexResult {
  tier: "A" | "B" | null;
  sections: BookSection[];
  /** Páginas descartadas por ser índice (para depurar). */
  indexPages: number[];
  /** Desfase folio → chunks.page (tier A). */
  offset: number | null;
  /** Por qué no se pudo, si `tier` es null. */
  motivo?: string;
  /** Entradas crudas del índice con su página ubicada. Para auditar/depurar. */
  debug?: { title: string; folio: number | null; located: number | null; aux: boolean }[];
}

/** Líder de puntos seguido de folio: "....... 34" o "..........6". */
const LIDER = /\.{3,}\s*(\d{1,3})/g;

/** Marcadores de entrada del índice (tier B y clasificación en tier A). */
const MARCADOR = /(lecci[óo]n|unidad|tema|cap[íi]tulo|unit)\s*(\d+)?/gi;

/**
 * Secciones auxiliares: NO son temas de estudio, pero SÍ son fronteras. Sin
 * ellas la última lección de cada unidad se traga el glosario, el solucionario
 * y la síntesis — decenas de páginas que no son el tema.
 */
const AUXILIAR = [
  "desarrolla habilidades", "lo esencial", "cómo voy", "como voy", "sintetizo",
  "qué aprendí", "que aprendi", "taller de ciencias", "actividad final",
  "síntesis", "sintesis", "repaso mis aprendizajes", "nuestro proyecto",
  "ciencia en chile", "ciencia, tecnología", "ciencia tecnologia",
  "protagonistas de la ciencia", "glosario", "solucionario", "bibliografía",
  "bibliografia", "webgrafía", "webgrafia", "índice temático", "indice tematico",
  "presentación", "presentacion", "anexo",
];

const esAuxiliar = (t: string): boolean => {
  const n = norm(t);
  return AUXILIAR.some((a) => n.includes(norm(a)));
};

/**
 * Entradas que NO son temas aunque el índice las liste o la extracción las
 * arrastre: la palabra "Índice" como encabezado de la propia tabla, y los datos
 * de la portadilla (títulos académicos de los autores) que quedan pegados al
 * principio del texto del índice.
 */
const esFuga = (t: string): boolean =>
  /^[íi]ndice\b/i.test(t.trim()) ||
  /mag[íi]ster|licenciad[oa] en|doctor(a)? en|universidad de|profesor(a)? de estado/i.test(t);

/**
 * ¿Este chunk parece parte del índice?
 *
 * Dos trampas verificadas:
 *  - `norm()` CONSERVA acentos, y en JavaScript `\b` se define sobre `\w`
 *    (= [A-Za-z0-9_]), así que `\bíndice\b` NO matchea "índice": no hay frontera
 *    de palabra antes de una "í". Por eso el delimitador es explícito.
 *  - Un líder de puntos SOLO cuenta si lo sigue un número. Las líneas punteadas
 *    para completar de las actividades ("Escribe aquí: ......") tienen puntos y
 *    no son índice; sin esta guarda se excluían páginas de contenido real.
 */
function pareceIndice(c: IndexChunk): boolean {
  const n = norm(c.content);
  return folios(c.content) >= 3 || /(^|[\s.,;:])(índice|indice|contenidos?|contents|sumario)([\s.,;:]|$)/.test(n);
}

/** Cuántos "……… 34" (líder de puntos + folio) tiene el texto. */
function folios(texto: string): number {
  return (texto.match(/\.{3,}\s*\d{1,3}/g) ?? []).length;
}

/**
 * Páginas ocupadas por el índice. Se excluyen enteras (no chunk por chunk):
 * verificado que un chunk puede ser mitad índice y mitad contenido real.
 * Se expande a páginas contiguas que también lo parezcan — Historia tiene
 * índice en la 6 Y en la 8-9, y la 9 era la fuente de falsos positivos.
 */
function paginasDeIndice(chunks: IndexChunk[]): Set<number> {
  const paginas = chunks.map((c) => c.page).filter((p): p is number => p != null);
  const maxPage = paginas.length ? Math.max(...paginas) : 0;
  const ventana = Math.max(12, Math.round(maxPage * 0.08));
  const out = new Set<number>();
  for (const c of chunks) {
    if (c.page == null) continue;
    // Dentro del front matter, o con folios en cualquier lado (el índice
    // temático del final también arruina la ubicación).
    if ((c.page <= ventana && pareceIndice(c)) || folios(c.content) >= 3) out.add(c.page);
  }
  // Expansión a contiguas que sigan pareciendo índice.
  let creció = true;
  while (creció) {
    creció = false;
    for (const c of chunks) {
      if (c.page == null || out.has(c.page)) continue;
      if (c.page > ventana) continue;
      if ((out.has(c.page - 1) || out.has(c.page + 1)) && pareceIndice(c)) {
        out.add(c.page);
        creció = true;
      }
    }
  }
  return out;
}

/**
 * Concatena el texto del índice deduplicando el SOLAPE entre chunks: el chunk
 * siguiente reempieza repitiendo la cola del anterior (verificado en Biología),
 * y sin esto las entradas salen duplicadas y truncadas.
 */
function concatenarIndice(chunks: IndexChunk[]): string {
  let acc = "";
  for (const c of chunks) {
    const t = c.content.replace(/\s+/g, " ").trim();
    if (!acc) { acc = t; continue; }
    // Buscar el sufijo de `acc` más largo que sea prefijo de `t`.
    let solape = 0;
    const max = Math.min(300, acc.length, t.length);
    for (let k = max; k >= 30; k--) {
      if (acc.slice(-k) === t.slice(0, k)) { solape = k; break; }
    }
    acc += " " + t.slice(solape);
  }
  return acc;
}

interface Entrada {
  title: string;
  folio: number | null;
  unitNo: number | null;
  lessonNo: number | null;
  aux: boolean;
}

/** TIER A: partir por líderes de puntos. El título es lo que precede al líder. */
function entradasPorFolio(texto: string): Entrada[] {
  const out: Entrada[] = [];
  let ultimo = 0;
  LIDER.lastIndex = 0;
  for (const m of texto.matchAll(LIDER)) {
    const folio = Number(m[1]);
    const bruto = texto.slice(ultimo, m.index).trim();
    ultimo = (m.index ?? 0) + m[0].length;
    // El título es la COLA del tramo: lo anterior ya se consumió en la entrada
    // previa, pero puede quedar basura si el tramo es largo.
    // Anclar el arranque del título: si el tramo trae un marcador ("Lección 2")
    // o una pregunta, empezar ahí. Sin esto la primera entrada arrastra todo el
    // preámbulo del índice y sale truncada por el corte de 160 ("nteractúan…").
    let bruto2 = bruto.slice(-300);
    const anclas = [...bruto2.matchAll(/(lecci[óo]n\s*\d+|unidad\s*\d+|¿)/gi)];
    const ancla = anclas[anclas.length - 1];
    if (ancla?.index != null) bruto2 = bruto2.slice(ancla.index);
    const title = bruto2.slice(0, 160).replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñü¿]+/, "").trim();
    if (title.length < 4 || !Number.isFinite(folio) || folio < 1 || folio > 999) continue;
    if (esFuga(title)) continue;
    out.push({ title, folio, ...numeros(title), aux: esAuxiliar(title) });
  }
  return out;
}

/** TIER B: partir por marcadores "Lección N" / "Unidad N". */
function entradasPorMarcador(texto: string): Entrada[] {
  const marcas = [...texto.matchAll(MARCADOR)];
  const out: Entrada[] = [];
  for (let i = 0; i < marcas.length; i++) {
    const m = marcas[i]!;
    const desde = (m.index ?? 0) + m[0].length;
    const hasta = i + 1 < marcas.length ? (marcas[i + 1]!.index ?? texto.length) : texto.length;
    let t = texto.slice(desde, hasta).replace(/^\s*[:.\-–]\s*/, "").trim();
    // (a) Los títulos de lección de este corpus son PREGUNTAS: cortar en el
    //     signo de cierre es la señal más fuerte que hay.
    if (t.startsWith("¿")) {
      const q = t.indexOf("?");
      if (q > 0) t = t.slice(0, q + 1);
    } else {
      // (b) Cortar en la primera frase auxiliar.
      const n = norm(t);
      let corte = t.length;
      for (const a of AUXILIAR) {
        const idx = n.indexOf(norm(a));
        if (idx > 0) corte = Math.min(corte, idx);
      }
      t = t.slice(0, corte).trim();
    }
    t = t.slice(0, 160).trim(); // (c) tope duro
    // El marcador matchea también "unidad"/"tema" dentro de la prosa del índice
    // ("...Conocerás el tema de la unidad"), lo que produce entradas basura como
    // "de la" o "por medio de una". Un título de verdad tiene ≥3 palabras y
    // arranca en mayúscula o en signo de pregunta.
    if (t.split(/\s+/).length < 3) continue;
    if (!/^[¿A-ZÁÉÍÓÚÑ]/.test(t)) continue;
    if (esFuga(t)) continue;
    const marca = `${m[1]} ${m[2] ?? ""}`.trim();
    out.push({ title: t, folio: null, ...numeros(marca), aux: esAuxiliar(t) });
  }
  return out;
}

function numeros(s: string): { unitNo: number | null; lessonNo: number | null } {
  const u = /unidad\s*(\d+)/i.exec(s);
  const l = /(?:lecci[óo]n|unit)\s*(\d+)/i.exec(s);
  return { unitNo: u ? Number(u[1]) : null, lessonNo: l ? Number(l[1]) : null };
}

const mediana = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Subsecuencia creciente más larga sobre las páginas ubicadas (tier B). */
function lis(paginas: (number | null)[]): Set<number> {
  const idx: number[] = [];
  for (let i = 0; i < paginas.length; i++) if (paginas[i] != null) idx.push(i);
  const n = idx.length;
  if (n === 0) return new Set();
  const largo = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (paginas[idx[j]!]! < paginas[idx[i]!]! && largo[j]! + 1 > largo[i]!) {
        largo[i] = largo[j]! + 1;
        prev[i] = j;
      }
    }
    if (largo[i]! > largo[best]!) best = i;
  }
  const keep = new Set<number>();
  for (let k = best; k !== -1; k = prev[k]!) keep.add(idx[k]!);
  return keep;
}

/**
 * Deriva la estructura del libro. `chunks` son TODOS los chunks de contenido del
 * documento, con su página.
 */
export function buildBookIndex(chunks: IndexChunk[]): BookIndexResult {
  const idxPages = paginasDeIndice(chunks);
  const delIndice = chunks
    .filter((c) => c.page != null && idxPages.has(c.page))
    .sort((a, b) => (a.page! - b.page!));
  if (delIndice.length === 0) {
    return { tier: null, sections: [], indexPages: [], offset: null, motivo: "sin páginas de índice" };
  }

  const texto = concatenarIndice(delIndice);
  const conFolio = entradasPorFolio(texto);
  const tier: "A" | "B" = conFolio.length >= 4 ? "A" : "B";
  const entradas = tier === "A" ? conFolio : entradasPorMarcador(texto);
  if (entradas.length < 3) {
    return { tier: null, sections: [], indexPages: [...idxPages], offset: null, motivo: `solo ${entradas.length} entradas` };
  }

  // Cuerpo del libro: todo lo que NO es índice, normalizado una sola vez.
  const cuerpo = chunks
    .filter((c) => c.page != null && !idxPages.has(c.page))
    .map((c) => ({ page: c.page!, n: norm(c.content) }))
    .sort((a, b) => a.page - b.page);

  /**
   * Páginas que matchean MUCHOS títulos distintos: son índices o resúmenes
   * ("¿Qué ver?", "Inicio de unidad"), no el comienzo de una lección. Se
   * detectan solas, sin heurística de front matter: la página 9 de Historia
   * matchea 5 títulos y era la fuente de todos los falsos positivos.
   */
  const golpes = new Map<number, number>();
  for (const e of entradas) {
    for (const c of cuerpo) {
      if (enChunk(e.title, c.n) >= 0.7) { golpes.set(c.page, (golpes.get(c.page) ?? 0) + 1); break; }
    }
  }
  const resumen = new Set([...golpes].filter(([, n]) => n >= 3).map(([p]) => p));

  /** Primera página donde el título aparece como encabezado (score >= 0.7). */
  const ubicar = (title: string): number | null => {
    for (const c of cuerpo) {
      if (resumen.has(c.page)) continue;
      if (enChunk(title, c.n) >= 0.7) return c.page;
    }
    return null;
  };
  // Los títulos AUXILIARES ("Actividad final", "Síntesis") se repiten en todo el
  // libro: ubicarlos por texto da cualquier página. En tier A se colocan por
  // folio; acá se dejan sin ubicar para que no contaminen el cálculo del offset.
  const ubicadas = entradas.map((e) => (e.aux ? null : ubicar(e.title)));
  const debug = entradas.map((e, i) => ({ title: e.title, folio: e.folio, located: ubicadas[i] ?? null, aux: e.aux }));

  let offset: number | null = null;
  let paginas: (number | null)[] = [...ubicadas];
  const metodo: BookSection["method"][] = entradas.map(() => "index_locate");

  if (tier === "A") {
    // Reconciliar folio ↔ ubicación. El folio impreso y chunks.page difieren por
    // un desfase constante por documento (verificado: +2 en 92 páginas de
    // Biología). La mediana lo calibra y detecta los falsos positivos.
    const res: number[] = [];
    for (let i = 0; i < entradas.length; i++) {
      const u = ubicadas[i], f = entradas[i]!.folio;
      if (u != null && f != null) res.push(u - f);
    }
    if (res.length >= 3) {
      const off = Math.round(mediana(res));
      const mad = mediana(res.map((r) => Math.abs(r - off)));
      if (off >= 0 && off <= 20 && mad <= 3) {
        offset = off;
        paginas = entradas.map((e, i): number | null => {
          const u = ubicadas[i] ?? null;
          const f = e.folio;
          if (f == null) return u;
          const esperado = f + off;
          if (u != null && Math.abs(u - esperado) <= 2) { metodo[i] = "index_locate"; return u; }
          metodo[i] = "index_folio";
          return esperado;
        });
      }
    }
  }

  if (offset == null) {
    // Tier B (o tier A degradado): sin folio, la única señal es la MONOTONÍA —
    // el índice lista los temas en el orden en que aparecen en el libro.
    //
    // Se conservan SOLO los sobrevivientes de la subsecuencia creciente, sin
    // interpolar: el ruido del índice (Historia arrastra prosa de la página de
    // presentación) produce entradas que no son temas, y una entrada
    // interpolada es un tema inventado con páginas inventadas. Preferimos un
    // plan más corto y correcto que uno completo y falso.
    //
    // El criterio NO es un porcentaje sobre el total de entradas: la basura
    // infla el denominador y castigaría a un índice que se leyó bien. En
    // Historia la LIS encuentra las 11 lecciones reales en orden perfecto entre
    // 25 entradas — eso es un acierto, no un fallo.
    const keep = lis(paginas);
    if (keep.size < 3) {
      return { tier: null, sections: [], indexPages: [...idxPages], offset: null, motivo: `monotonía débil (${keep.size}/${entradas.length})`, debug };
    }
    paginas = paginas.map((p, i) => (keep.has(i) ? p : null));
  }

  // Armar secciones ordenadas por página, con las auxiliares como FRONTERA.
  const maxPage = Math.max(...chunks.map((c) => c.page ?? 0));
  const crudas = entradas
    .map((e, i) => ({ e, page: paginas[i], method: metodo[i]! }))
    .filter((x): x is { e: Entrada; page: number; method: BookSection["method"] } => x.page != null)
    .sort((a, b) => a.page - b.page);

  const sections: BookSection[] = [];
  let ord = 0;
  let unidadActual: number | null = null;
  for (let i = 0; i < crudas.length; i++) {
    const { e, page, method } = crudas[i]!;
    const sig = crudas[i + 1]?.page;
    const pageEnd = sig != null ? sig - 1 : Math.min(maxPage, page + 60);
    if (pageEnd < page) continue;
    const level: SectionLevel = e.aux ? 3 : e.unitNo != null && e.lessonNo == null ? 1 : 2;
    if (level === 1) unidadActual = ord;
    sections.push({
      ord: ord++,
      level,
      parentOrd: level === 2 ? unidadActual : null,
      title: e.title,
      unitNo: e.unitNo,
      lessonNo: e.lessonNo,
      folio: e.folio,
      pageStart: page,
      pageEnd,
      method,
      confidence: method === "index_locate" ? 1 : method === "index_folio" ? 0.7 : 0.4,
    });
  }

  if (sections.filter((s) => s.level !== 3).length < 3) {
    return { tier: null, sections: [], indexPages: [...idxPages], offset, motivo: "menos de 3 temas", debug };
  }
  return { tier, sections, indexPages: [...idxPages].sort((a, b) => a - b), offset, debug };
}
