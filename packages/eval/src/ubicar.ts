/**
 * UBICAR — dónde está, en el libro del alumno, cada conocimiento que pide el Estado.
 *
 *   pnpm --filter @tutor-ia/eval ubicar --lote /tmp/lote.json > /tmp/salida.json
 *
 * El lote es un JSON `[{ id, materia, texto }]` donde `texto` es un conocimiento
 * esencial del currículum EPJA tal como lo escribe el Mineduc, y `materia` el
 * nombre exacto de la fila en `subjects`.
 *
 * ── Por qué existe, y por qué no alcanza con retrieve-test ────────────────────
 * `retrieve-test` contesta "qué chunks se parecen a esta pregunta". Acá la
 * pregunta es otra: "¿en qué LECCIÓN del libro se enseña esto, y en qué páginas?".
 * Un chunk suelto no le sirve a un alumno —no puede abrir "el chunk 812"—, así
 * que cada chunk que sobrevive al reranker se resuelve contra `book_sections`,
 * que es el índice real del libro, y lo que se devuelve son SECCIONES con su
 * rango de páginas, ordenadas por la evidencia que las respalda.
 *
 * ── Cuatro decisiones que condicionan el resultado ────────────────────────────
 * 1. `corpusRole: "content"`. Se busca SOLO en el texto del estudiante. La guía
 *    del docente queda para una segunda pasada: mezclarlas ahora daría páginas
 *    de un libro que el alumno no tiene.
 * 2. Umbral propio (`--umbral`, default 0.30) en vez del RERANK_MIN_SCORE del
 *    tutor (0.18). Ese 0.18 está calibrado para NO abstenerse ante un chico que
 *    pregunta mal; acá el costo del error es el inverso: una ubicación falsa
 *    ensucia el mapa curricular y nadie la va a revisar.
 * 3. EXPANSIÓN DE LA CONSULTA (`--sin-expandir` la apaga). El currículum escribe
 *    "Estrategias de persuasión." — tres palabras, en registro normativo. Medido
 *    el 2026-08-19: esa consulta da topScore 0.0697 sobre Lengua 1º Medio y el
 *    libro se declara SIN cubrir… teniendo en la página 216 "para alcanzar tu
 *    objetivo de convencer o persuadir al lector". Un falso hueco es peor que una
 *    página equivocada: nadie va a ir a verificar un "no está". Así que cada
 *    conocimiento se traduce antes a 3-5 frases como las diría el libro, se busca
 *    con todas y se une el resultado.
 *    Para Inglés las frases se piden EN INGLÉS: el texto del estudiante es
 *    "High School English 1 Student's Book" y la consulta normativa en castellano
 *    daba 0.0199.
 * 4. SE DESCARTA EL FINAL DEL LIBRO Y LAS SECCIONES ABSURDAS. El solucionario
 *    responde a todo (Biología 1º Medio: "Solucionario, p.245" salió primero con
 *    0.969 para Evolución) y no le sirve a nadie para estudiar. Y el índice
 *    parseado tiene tramos de 61 páginas —"Los deportes, p.147-208"—, la
 *    patología que documenta schema_book_sections.sql. Una lección real ronda
 *    las 19 páginas: por encima de `--max-tramo` (40) la sección no ubica nada.
 *
 * La salida es JSON a stdout y el progreso va a stderr, para poder redirigir.
 */
import { chatText } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { retrieveRanked, type RankedChunk } from "@tutor-ia/rag";

const DEV_USER_ID =
  process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

interface ItemLote {
  id: string;
  materia: string;
  texto: string;
  /** Opcional, solo para que la salida sea legible sin volver al currículum. */
  capa?: string;
  nivel?: string;
  asignatura?: string;
}

interface Seccion {
  titulo: string;
  unidad: number | null;
  leccion: number | null;
  pagina_desde: number | null;
  pagina_hasta: number | null;
  /** Cuántos chunks de la evidencia caen adentro de esta sección. */
  respaldo: number;
  /** El mejor score de rerank entre esos chunks. */
  score: number;
}

interface Evidencia {
  pagina: number | null;
  heading: string | null;
  score: number;
  cita: string;
}

interface Salida extends ItemLote {
  encontrado: boolean;
  top_score: number;
  secciones: Seccion[];
  evidencia: Evidencia[];
  /** Con qué frases se buscó realmente (la 1ª es el texto del currículum). */
  consultas: string[];
  /** Poblado solo si la materia no existe o no tiene material. */
  error?: string;
}

/**
 * Partes del libro que responden a todo y no enseñan nada: el solucionario cita
 * el enunciado de cada ejercicio, así que empata semánticamente con cualquier
 * tema del curso. Mandar a un alumno ahí es mandarlo a las respuestas.
 */
const COLA_DEL_LIBRO =
  /^\s*(solucionario|glosario|bibliograf|índice|indice|anexo|créditos|creditos|webgraf|referencias|tabla periódica)/i;

/** ¿Esta sección sirve para ubicar? Falla si es cola del libro o si su tramo es absurdo. */
function seccionUtil(s: SeccionFila, maxTramo: number): boolean {
  if (COLA_DEL_LIBRO.test(s.title)) return false;
  if (s.page_start == null) return false;
  const tramo = (s.page_end ?? s.page_start) - s.page_start;
  return tramo <= maxTramo;
}

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Cache de subjectId por nombre: el lote repite la misma materia decenas de veces. */
const cacheMateria = new Map<string, string | null>();

async function idDeMateria(nombre: string): Promise<string | null> {
  if (cacheMateria.has(nombre)) return cacheMateria.get(nombre) ?? null;
  const sql = getSql();
  // Sin filtrar por disabled_at: Inglés está apagada en los 12 cursos y el mapa
  // se quiere igual, para que encenderla algún día no exija rehacer esto.
  const [f] = await sql<{ id: string }[]>`
    select id from subjects where name = ${nombre} limit 1`;
  cacheMateria.set(nombre, f?.id ?? null);
  return f?.id ?? null;
}

/** Todas las secciones de una materia, una sola vez por materia. */
const cacheSecciones = new Map<string, SeccionFila[]>();
interface SeccionFila {
  title: string;
  unit_no: number | null;
  lesson_no: number | null;
  page_start: number | null;
  page_end: number | null;
  level: number | null;
}

async function seccionesDe(subjectId: string): Promise<SeccionFila[]> {
  const hit = cacheSecciones.get(subjectId);
  if (hit) return hit;
  const sql = getSql();
  const filas = await sql<SeccionFila[]>`
    select bs.title, bs.unit_no, bs.lesson_no, bs.page_start, bs.page_end, bs.level
    from book_sections bs
    join documents d on d.id = bs.document_id
    where bs.subject_id = ${subjectId}::uuid and d.kind = 'content'
    order by bs.page_start nulls last, bs.ord`;
  cacheSecciones.set(subjectId, filas);
  return filas;
}

/**
 * A qué sección pertenece una página. Se elige la MÁS ESPECÍFICA que la contenga
 * (la de rango más corto): el índice tiene unidades y lecciones anidadas, y
 * decirle a un alumno "Unidad 2, págs. 60-120" es no decirle nada.
 */
function seccionDe(
  pagina: number | null,
  secs: SeccionFila[],
  maxTramo: number,
): SeccionFila | null {
  if (pagina == null) return null;
  const dentro = secs.filter(
    (s) =>
      seccionUtil(s, maxTramo) &&
      pagina >= s.page_start! &&
      pagina <= (s.page_end ?? s.page_start!),
  );
  if (dentro.length === 0) return null;
  return dentro.reduce((mejor, s) => {
    const largo = (x: SeccionFila) => (x.page_end ?? x.page_start!) - x.page_start!;
    return largo(s) < largo(mejor) ? s : mejor;
  });
}

/** ¿La página cae en el solucionario / glosario / anexos? Entonces no es evidencia. */
function esColaDelLibro(pagina: number | null, secs: SeccionFila[]): boolean {
  if (pagina == null) return false;
  return secs.some(
    (s) =>
      COLA_DEL_LIBRO.test(s.title) &&
      s.page_start != null &&
      pagina >= s.page_start &&
      pagina <= (s.page_end ?? s.page_start),
  );
}

const EXPANDIR_SYSTEM = `Sos un bibliotecario de textos escolares chilenos del Mineduc.
Te doy un CONOCIMIENTO ESENCIAL del currículum, escrito en el registro normativo del
Ministerio, y la asignatura y curso donde se enseña.

Devolvés entre 3 y 5 frases de búsqueda, UNA POR LÍNEA, sin numerar y sin viñetas.
Cada frase tiene que estar redactada COMO LA ESCRIBIRÍA EL LIBRO DE TEXTO: el título de
la lección, el nombre del tema, o la frase con que el libro lo explica.

Reglas:
- Si el conocimiento junta varios temas ("potencias, raíces y sus propiedades"),
  hacé una frase POR TEMA. Es lo más importante: cada tema vive en otra página.
- Usá el vocabulario del aula, no el del decreto. "Estrategias de persuasión" se
  busca como "convencer al lector", "texto argumentativo", "recursos retóricos".
- Nada de explicaciones, comillas ni comentarios. Solo las frases, una por línea.`;

const EXPANDIR_SYSTEM_EN = `You are a librarian of Chilean Mineduc school textbooks.
I give you an ESSENTIAL KNOWLEDGE item from the national curriculum, written in Spanish
in ministerial register, plus the subject and grade.

The textbook is an ENGLISH-language student's book. Return 3 to 5 search phrases,
ONE PER LINE, no numbering, no bullets, **written in English** exactly as the textbook
would phrase them: unit titles, topic names, or the wording used to teach it.

Rules:
- If the item bundles several topics, write one phrase PER topic.
- Use classroom English, not ministerial Spanish.
- No explanations, no quotes. Only the phrases, one per line.`;

/** Cache por (texto + idioma): el mismo conocimiento se busca en varias materias. */
const cacheExpansion = new Map<string, string[]>();

async function expandir(item: ItemLote, enIngles: boolean): Promise<string[]> {
  const clave = `${enIngles ? "en" : "es"}|${item.texto}`;
  const hit = cacheExpansion.get(clave);
  if (hit) return hit;
  try {
    const out = await chatText(
      [
        { role: "system", content: enIngles ? EXPANDIR_SYSTEM_EN : EXPANDIR_SYSTEM },
        {
          role: "user",
          content: `Asignatura: ${item.asignatura ?? item.materia}\nCurso: ${item.materia}\nConocimiento esencial: ${item.texto}`,
        },
      ],
      { temperature: 0, maxTokens: 220 },
    );
    const frases = out
      .split("\n")
      .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").replace(/^["“]|["”]$/g, "").trim())
      .filter((l) => l.length >= 4 && l.length <= 160)
      .slice(0, 5);
    cacheExpansion.set(clave, frases);
    return frases;
  } catch {
    // Sin expansión se busca igual con el texto crudo: peor recall, no un corte.
    cacheExpansion.set(clave, []);
    return [];
  }
}

interface Opciones {
  umbral: number;
  k: number;
  maxTramo: number;
  expandir: boolean;
}

async function ubicar(item: ItemLote, o: Opciones): Promise<Salida> {
  const base: Salida = {
    ...item,
    encontrado: false,
    top_score: 0,
    secciones: [],
    evidencia: [],
    consultas: [item.texto],
  };

  const subjectId = await idDeMateria(item.materia);
  if (!subjectId) return { ...base, error: `no existe la materia "${item.materia}"` };

  const enIngles = /ingl[ée]s/i.test(item.materia);
  const consultas = [item.texto];
  if (o.expandir) consultas.push(...(await expandir(item, enIngles)));

  // Se busca con cada frase y se QUEDA EL MEJOR score por chunk. No se promedia:
  // que una frase de las cinco lo encuentre alcanza — las otras cuatro apuntan a
  // los otros temas que el mismo conocimiento junta en una línea.
  const mejorPorChunk = new Map<string, RankedChunk>();
  let topScore = 0;
  for (const q of consultas) {
    const r = await retrieveRanked(q, {
      userId: DEV_USER_ID,
      subjectIds: [subjectId],
      corpusRole: "content",
      incluirPausadas: true, // Inglés está apagada y se mapea igual.
      k: o.k,
      minRerankScore: o.umbral,
      // El margen rescata registro coloquial dentro del material del alumno; acá
      // la consulta ya viene reescrita como la diría el libro. Se apaga para que
      // el único camino de entrada sea el score absoluto.
      gateMargin: 0,
    });
    topScore = Math.max(topScore, r.topScore);
    if (!r.grounded) continue;
    for (const c of r.chunks as RankedChunk[]) {
      const ya = mejorPorChunk.get(c.chunkId);
      if (!ya || c.rerankScore > ya.rerankScore) mejorPorChunk.set(c.chunkId, c);
    }
  }

  const secs = await seccionesDe(subjectId);
  const utiles = [...mejorPorChunk.values()]
    .filter((c) => !esColaDelLibro(c.pageStart ?? null, secs))
    .sort((a, b) => b.rerankScore - a.rerankScore);

  if (utiles.length === 0) {
    return { ...base, top_score: Number(topScore.toFixed(4)), consultas };
  }

  const porSeccion = new Map<string, Seccion>();
  const evidencia: Evidencia[] = [];

  for (const c of utiles.slice(0, o.k)) {
    const pagina = c.pageStart ?? null;
    evidencia.push({
      pagina,
      heading: c.headingPath ?? null,
      score: Number(c.rerankScore.toFixed(4)),
      cita: c.content.replace(/\s+/g, " ").slice(0, 240),
    });
    const s = seccionDe(pagina, secs, o.maxTramo);
    if (!s) continue;
    const clave = `${s.title}@${s.page_start}`;
    const ya = porSeccion.get(clave);
    if (ya) {
      ya.respaldo += 1;
      ya.score = Math.max(ya.score, c.rerankScore);
    } else {
      porSeccion.set(clave, {
        titulo: s.title,
        unidad: s.unit_no,
        leccion: s.lesson_no,
        pagina_desde: s.page_start,
        pagina_hasta: s.page_end,
        respaldo: 1,
        score: Number(c.rerankScore.toFixed(4)),
      });
    }
  }

  const secciones = [...porSeccion.values()].sort(
    (a, b) => b.score - a.score || b.respaldo - a.respaldo,
  );

  return {
    ...base,
    encontrado: true,
    // El top que se reporta es el de la evidencia que SOBREVIVIÓ, no el crudo:
    // si el 0.969 era el solucionario, decir 0.969 sería mentir sobre el hallazgo.
    top_score: Number(utiles[0]!.rerankScore.toFixed(4)),
    secciones,
    evidencia,
    consultas,
  };
}

async function main(): Promise<void> {
  const ruta = arg("lote");
  if (!ruta) {
    console.error(
      'uso: ubicar --lote <archivo.json> --salida <archivo.json> [--umbral 0.30] [--k 12] [--max-tramo 40] [--sin-expandir]\n' +
        '  el lote es [{ id, materia, texto, capa?, nivel?, asignatura? }]',
    );
    process.exit(1);
  }
  const o: Opciones = {
    umbral: Number(arg("umbral") ?? "0.30"),
    k: Number(arg("k") ?? "12"),
    maxTramo: Number(arg("max-tramo") ?? "40"),
    expandir: !process.argv.includes("--sin-expandir"),
  };

  const fs = await import("node:fs/promises");
  const lote: ItemLote[] = JSON.parse(await fs.readFile(ruta, "utf8"));

  const salida: Salida[] = [];
  let n = 0;
  for (const item of lote) {
    n += 1;
    try {
      const res = await ubicar(item, o);
      salida.push(res);
      const marca = res.error ? "⚠️ " : res.encontrado ? "✓" : "·";
      const donde = res.secciones[0]
        ? `${res.secciones[0].titulo.slice(0, 34)} p.${res.secciones[0].pagina_desde}`
        : res.error ?? "sin ubicación";
      process.stderr.write(
        `${marca} [${n}/${lote.length}] ${item.materia.slice(0, 26).padEnd(28)} ${String(res.top_score).padEnd(7)} ${donde}\n`,
      );
    } catch (e) {
      // Un fallo de red no puede matar un lote de cientos: se registra y sigue.
      salida.push({
        ...item,
        encontrado: false,
        top_score: 0,
        secciones: [],
        evidencia: [],
        consultas: [item.texto],
        error: e instanceof Error ? e.message : String(e),
      });
      process.stderr.write(`✗ [${n}/${lote.length}] ${item.materia} — ${String(e).slice(0, 90)}\n`);
    }
  }

  // A archivo y no a stdout: el logger del LLM escribe en stdout y rompía el JSON.
  const destino = arg("salida");
  if (destino) await fs.writeFile(destino, JSON.stringify(salida, null, 1), "utf8");
  else process.stdout.write(JSON.stringify(salida, null, 1));
  const ok = salida.filter((s) => s.encontrado).length;
  const conSeccion = salida.filter((s) => s.secciones.length > 0).length;
  process.stderr.write(
    `\n── ${ok}/${salida.length} ubicados · ${conSeccion} con lección del índice · ` +
      `${salida.filter((s) => s.error).length} con error\n`,
  );
  await getSql().end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
