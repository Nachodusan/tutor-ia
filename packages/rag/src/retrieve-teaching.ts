/**
 * Retrieval para ENSEÑAR (Plan v3 T4). Trae los dos corpus con roles distintos:
 *
 *   CONTENIDO (el "qué") — por relevancia a la pregunta, con el gate del reranker
 *     (corpus_role='content'). Es lo citable, la fuente de verdad.
 *   PEDAGOGÍA (el "cómo") — por relevancia al mismo tema (corpus_role='pedagogy'),
 *     rerankeada y ORGANIZADA por pedagogy_type (ideas_previas, ambiente, habilidad,
 *     evaluación, solucionario). Alimenta la estrategia de enseñanza.
 *
 * El link NO es el join rígido (unit,lesson) — el piloto mostró que TE y GDD
 * numeran distinto (re-medido el 2026-08-23: 21% de acierto, azar 25%).
 *
 * ⚠️ El link es RELEVANCIA A LA PREGUNTA, y nada más. El diseño decía
 * "relevancia + boost cuando el OA coincide", pero ese boost NUNCA se ejecutó:
 * ningún chunk de contenido tiene OA y no se le puede poner (ver el comentario
 * de `oaBoostFromEnv`). Conviene saberlo antes de razonar sobre este archivo:
 * la guía docente se elige por parecido con la PREGUNTA, no con el material que
 * el tutor efectivamente va a enseñar.
 */
import { getSql } from "@tutor-ia/db";
import {
  answerabilityEnabled, apoyadoEnabled, apoyadoMinEntailFromEnv,
  apoyadoMinRelevanciaFromEnv, contesta,
} from "./answerability";
import { retrieveHybrid, type HybridChunk } from "./retrieve-hybrid";
import {
  retrieveRanked,
  rerank,
  rerankMinScoreFromEnv,
  RERANK_SNIPPET_CHARS,
  type RankedStats,
} from "./rerank";

/** Default de chunks de contenido citable. Configurable con RAG_CONTENT_K. */
export const DEFAULT_CONTENT_K = 6;

export function contentKFromEnv(): number {
  const n = Number(process.env.RAG_CONTENT_K ?? "");
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CONTENT_K;
}

/** Boost aditivo al orden de pedagogía cuando su OA coincide con el del contenido
 *  top. SOLO afecta el ORDEN (rankScore), nunca el gate (rerankScore crudo):
 *  antes se sumaba sobre la sigmoide sin clamp y un chunk con score real 0.03
 *  cruzaba el gate de 0.18 solo por el boost. Configurable con RAG_OA_BOOST. */
export const DEFAULT_OA_BOOST = 0.15;

/**
 * ⚠️ EL BOOST DE OA ESTÁ MUERTO Y NO SE PUEDE REVIVIR. Medido el 2026-08-22/23.
 *
 * `oasContent` sale de los chunks de CONTENIDO y siempre está vacío: 0 de 16.548
 * tienen `oa`. Los únicos 349 con OA son de pedagogía, de Ciencias Naturales 1º y
 * 2º — dos cursos cerrados. O sea que la línea del boost, más abajo, nunca se
 * ejecuta.
 *
 * NO es un dato que falte cargar. Se midieron tres caminos y los tres cierran:
 *
 *  1. EXTRAER EL OA DEL TEXTO. Los libros no imprimen los códigos: solo el 0,9%
 *     de los chunks de contenido y el 1,7% de los de pedagogía mencionan un
 *     "OA n". El caso de CN 1º/2º es la excepción — un formato de GDD que ponía
 *     el OA en cada encabezado de lección.
 *
 *  2. USAR (unit, lesson) COMO LLAVE. Se midió si la unidad N del TE se
 *     corresponde con la N de la GDD: 21% de acierto, con azar en 25%. La
 *     numeración efectivamente no coincide, como decía el piloto. Un boost por
 *     unidad empujaría la guía equivocada 4 de cada 5 veces.
 *
 *  3. ALINEAR POR PARECIDO CON EL CONTENIDO ELEGIDO — que es el OBJETIVO real
 *     del boost: preferir la guía de lo que se va a enseñar. Se implementó
 *     rerankeando la pedagogía contra el fragmento citable top y NO SIRVIÓ: los
 *     puntajes salían todos entre 0,003 y 0,013, sin discriminar. El reranker es
 *     un modelo de pregunta→pasaje y se lo estaba usando para pasaje↔pasaje.
 *     Con COSENO DE EMBEDDINGS sí discrimina (0,739 → 0,592, y los 8 primeros
 *     resultaron ser todos de la lección correcta), y es gratis porque los
 *     vectores ya están en la base. Pero no se implementó: en los casos medidos
 *     el orden por pregunta YA elegía la guía de esa misma lección, así que la
 *     ganancia no se pudo demostrar. Si alguna vez se retoma, el camino es el
 *     coseno, no el reranker.
 *
 * Se deja la línea del boost como está: es inerte, no cuesta nada, y el día que
 * un corpus traiga OA en los dos lados vuelve a servir sola.
 */
export function oaBoostFromEnv(): number {
  const n = Number(process.env.RAG_OA_BOOST ?? "");
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_OA_BOOST;
}

/**
 * Umbral mínimo de rerankScore (crudo, sin boost) para que un bloque de
 * pedagogía entre al prompt. Antes no había NINGUNO: se tomaban los top-2 por
 * tipo aunque puntuaran 0.001, y "ideas previas" de una lección ajena moldeaban
 * la explicación sin que nadie lo viera (la verificación NLI solo mira el
 * contenido citable, no la guía).
 *
 * MEDIDO (2026-08-05, Lengua Y Literatura 8º, 5 consultas reales — los scores de
 * los bloques que ENTRABAN al prompt, top-2 por tipo):
 *
 *   "narrador"              0.697 · 0.016 0.005 0.003 0.003 0.003 0.002 0.001
 *   "texto argumentativo"   0.179 0.121 · 0.008 0.001 0.001 0.001 0.001 0.001
 *   "género lírico"         0.188 · 0.003 0.001 0.000 …
 *   "quién cuenta vs vive"  TODO ruido (máx 0.007)
 *   "metáfora"              TODO ruido (máx 0.013)
 *
 * Las dos poblaciones NO se solapan: lo relevante vive en 0.12-0.70 y el ruido
 * en ≤0.016, con un HUECO VACÍO en el medio. 0.05 cae dentro de ese hueco, así
 * que no hay nada que perder ni umbral que afinar. El efecto real es que la
 * guía pasa de ~7-8 bloques por turno (6 de ellos basura) a 0-2 de verdad
 * relevantes; en las consultas donde no pasa ninguno el prompt dice "(sin guía
 * para este tema)", que es honesto — mejor sin guía que con la de otra lección.
 */
export const DEFAULT_PEDAGOGY_MIN_SCORE = 0.05;

export function pedagogyMinScoreFromEnv(): number {
  const v = process.env.RAG_PEDAGOGY_MIN_SCORE;
  if (v == null || v.trim() === "") return DEFAULT_PEDAGOGY_MIN_SCORE;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PEDAGOGY_MIN_SCORE;
}

/** Los tipos de pedagogía que alimentan el flujo de enseñanza, en orden de uso. */
export const TEACHING_TYPES = [
  "proposito",
  "ideas_previas",
  "ambiente_aprendizaje",
  "habilidad",
  "errores_frecuentes",
  "evaluacion",
  "solucionario",
] as const;
export type TeachingType = (typeof TEACHING_TYPES)[number];

export interface PedagogyChunk extends HybridChunk {
  /** Sigmoide del cross-encoder, SIN boost — la escala del gate. */
  rerankScore: number;
  /** rerankScore + boost de OA (clampeado a 1) — SOLO para ordenar. */
  rankScore: number;
}

/** Forma citable de un chunk de CONTENIDO ya rerankeado. Estaba repetida en dos
 *  ramas de la cascada y ahora hace falta en una tercera (`retrieved`). */
const aCitable = (c: {
  chunkId: string; content: string; unit: number | null; lesson: number | null;
  oa: string | null; headingPath: string | null;
  pageStart: number | null; pageEnd: number | null; rerankScore: number;
  documentTitle?: string | null; grade?: string | null;
}): CitableChunk => ({
  chunkId: c.chunkId, content: c.content, source: "content",
  unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
  pageStart: c.pageStart, pageEnd: c.pageEnd, score: c.rerankScore,
  documentTitle: c.documentTitle ?? null, grade: c.grade ?? null,
});

/** Un fragmento citable (el "qué"), venga del TE o de la GDD. */
export interface CitableChunk {
  chunkId: string;
  content: string;
  source: "content" | "pedagogy";
  unit: number | null;
  lesson: number | null;
  oa: string | null;
  headingPath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
  /** De qué libro y de qué curso salió. Ver citationLabel(). */
  documentTitle: string | null;
  grade: string | null;
}

export interface TeachingContext {
  /** El "qué": contenido citable. Contenido (TE) preferido; si el TE no alcanza
   *  (típico en grados bajos, muy visuales), cae a la GDD como material oficial. */
  citable: CitableChunk[];
  /** false → ni el TE ni la GDD tienen material del tema: abstenerse. */
  grounded: boolean;
  /** De dónde salió el material citable (para transparencia). */
  citableSource: "content" | "pedagogy" | "none";
  /** El "cómo": pedagogía por tipo (guía la estrategia de enseñanza). */
  pedagogy: Record<TeachingType, PedagogyChunk[]>;
  /** OA(s) del material top, para anclar el chequeo de comprensión. */
  oas: string[];
  /** Score del gate (mejor rerank del material citable). */
  topScore: number;
  /** El estudio dirigido sirvió material POR DEBAJO del umbral del gate: se
   *  entrega igual (es material real de la unidad pedida) pero queda contable
   *  en vez de camuflado como grounding normal. */
  gateBypassed?: boolean;
  /**
   * Lo que el retrieval ENCONTRÓ, antes de que el gate decidiera si alcanza.
   *
   * `citable` responde "¿qué material se le puede mostrar al alumno?" y queda
   * VACÍO cuando el gate corta. `retrieved` responde otra pregunta —"¿el
   * ranking trajo lo correcto?"— y se llena siempre. Son cosas distintas y
   * confundirlas arruina la medición: `recall@5` calculado sobre `citable`
   * cuenta 0 cada vez que el gate corta, así que AFLOJAR EL GATE SUBE EL RECALL
   * SOLO, sin que el ranking haya mejorado en nada. Con este campo, recall mide
   * el ranking y el gate se mide aparte, que es la única forma de saber cuál de
   * los dos se movió.
   */
  retrieved: CitableChunk[];
  /** Hasta dónde hubo que ir a buscar: el curso del alumno, otro curso de la
   *  misma asignatura, u otra materia. Es lo que permite decirle al alumno
   *  "esto se ve en 2º Medio". */
  scope: TeachingScope;
  /** Contadores del retrieval de contenido (brazos, pool, ranker) para el log. */
  stats?: RankedStats;
  /**
   * Entailment del discriminador de answerability en la última etapa cross-scope
   * que lo ejerció; null si no corrió (flag apagado, turno vago, sidecar caído o
   * la respuesta salió del libro del propio curso).
   *
   * Se PERSISTE porque sin esto las decisiones del discriminador no son
   * auditables: cuando bloquea, el material desaparece del resultado y no queda
   * rastro de con qué número se lo bloqueó. Es la diferencia entre "medimos con
   * un script y corremos con otro" (el patrón de los tres bugs del §7) y poder
   * verificar que el runtime reproduce la calibración.
   */
  answerabilityEntail?: number | null;
  /**
   * El material es DEL TEMA pero NO contesta la pregunta: se sirve igual, con el
   * límite a la vista (sello `apoyado`). Es el tercer casillero — antes había que
   * elegir entre presentarlo como "esto está en tu material" o tirarlo y contestar
   * de memoria. Ver `apoyadoEnabled` en answerability.ts.
   */
  parcial?: boolean;
}

export interface TeachingOptions {
  userId: string;
  subjectId?: string | null;
  /** Cuántos chunks de contenido citable (default 6). */
  contentK?: number;
  /** Cuántos chunks de pedagogía por tipo (default 2). */
  perType?: number;
  minRerankScore?: number;
  /** ESTUDIO DIRIGIDO POR EL PLAN: si viene la unidad (y opcionalmente la
   *  lección), el contenido citable se toma DE ESA unidad/lección (rerankeado
   *  por la consulta) en vez del gate semántico. Garantiza material para un tema
   *  del plan aunque el título sea una paráfrasis floja. */
  unit?: number | null;
  lesson?: number | null;
  /** Todas las materias de la MISMA asignatura (todos los cursos), incluida la
   *  del alumno. Etapa 1 de la cascada. Sin esto la cascada saltea directo a
   *  todo el corpus. */
  familyIds?: string[] | null;
  /**
   * Todas las materias del MISMO CASILLERO del plan EPJA (`subjects.area`):
   * Biología + Física + Química + Ciencias para la Ciudadanía son una sola
   * "Ciencias Naturales" para el currículum, e Historia va con Educación
   * Ciudadana. Etapa 2 de la cascada, entre la familia y el corpus completo.
   *
   * NO es "aflojar el alcance": une lo que el plan de estudio ya cuenta como una
   * materia. Lengua sigue sin ver Biología — ese es el caso que hizo apagar la
   * etapa de corpus completo, y sigue apagado.
   */
  areaIds?: string[] | null;
  /**
   * Buscar en el corpus ENTERO (otras asignaturas) cuando la propia no alcanza.
   *
   * ⚠️ APAGADO POR DEFECTO, y es una decisión de producto, no una calibración:
   * el alumno entra a UNA materia y espera que le contesten con ESA materia. Ver
   * el comentario de la etapa, abajo. Las herramientas de medición pueden
   * encenderlo para estudiar el corpus completo.
   */
  corpusCompleto?: boolean;
  /** Curso del alumno ("1M"): ordena el material por cercanía de nivel. */
  studentGrade?: string | null;
  /**
   * El turno no trae tema propio ("no entendí", "otro ejemplo") o el alumno está
   * trabado. APAGA el discriminador de answerability: la consulta que le llega
   * es el turno previo pegado al actual, y `comoAfirmacion()` sobre eso produce
   * hipótesis compuestas o degeneradas ("El texto explica no cacho, me lo
   * explicás más fácil porfa.") cuyo entailment se hunde por la FORMA de la
   * frase, no por el material. Sin esto, un "no entendí" en una charla
   * cross-scope le arranca el material al chico a mitad de la conversación —
   * y las 101 del golden corren con `history: []`, así que el eval no lo ve.
   */
  vagueTurn?: boolean;
}

/** Hasta dónde hubo que ir a buscar el material que se está citando. */
export type TeachingScope = "curso" | "otro_curso" | "area" | "otra_materia" | "ninguno";

/**
 * "1B".."8B" → 1..8 · "1M".."4M" → 9..12. Escala CONTINUA, para poder restar
 * dos cursos y obtener una distancia.
 *
 * El `gradeSort` de la UI (ui.tsx) NO sirve para esto: da 100+n a la media, así
 * que 8º Básico → 1º Medio mide 93 en vez de 1. Sirve para ordenar una lista,
 * no para medir cercanía.
 */
export function gradeOrdinal(g: string | null | undefined): number | null {
  if (!g) return null;
  const n = Number(g.slice(0, -1));
  if (!Number.isFinite(n) || n <= 0) return null;
  return g.endsWith("M") ? 8 + n : n;
}

/**
 * Penalización por distancia de curso, en la escala del rankScore.
 *
 * ASIMÉTRICA a propósito: bajar de curso es más seguro que subir. Material de un
 * curso anterior explica lo mismo más simple; material de un curso posterior
 * puede dar por sabido lo que el alumno todavía no vio.
 *
 * Se aplica SOLO al orden (`rankScore`), nunca al `rerankScore` que mira el
 * gate — la misma disciplina que ya rige para el boost de OA, y por el mismo
 * motivo: un chunk flojo no debe cruzar el umbral por un ajuste de orden, ni
 * quedar afuera por él.
 */
/**
 * Umbral del gate para la etapa de OTRA MATERIA. Más alto que el normal a
 * propósito: ver el comentario en la cascada. Configurable para poder barrerlo.
 */
export const UMBRAL_OTRA_MATERIA = Number(process.env.RAG_UMBRAL_OTRA_MATERIA ?? "") || 0.5;

/**
 * Listón de la etapa `area` — el casillero del plan EPJA, un libro hermano.
 *
 * Va en el medio a propósito: más que el 0,18 de la propia asignatura (esto ya
 * no es el libro que el chico tiene sobre la mesa) y mucho menos que el 0,5 del
 * corpus entero (sí es la materia que el currículum le exige, y hay contexto de
 * materia que lo respalda).
 *
 * ⚠️ 0,30 sale de la medición del mapa curricular, no de un barrido: con ese
 * corte, las 13 exigencias que un libro debía y su hermano cubría puntúan entre
 * 0,30 y 0,83, y nada de lo descartado quedó arriba de 0,22. Es un piso
 * defendible, no un óptimo — cuando haya golden set de esta etapa, recalibrar.
 */
export const UMBRAL_AREA = Number(process.env.RAG_UMBRAL_AREA ?? "") || 0.3;

export const PENAL_GRADO_ABAJO = 0.02;
export const PENAL_GRADO_ARRIBA = 0.05;

export function penalizacionGrado(
  studentGrade: string | null | undefined,
  chunkGrade: string | null | undefined,
): number {
  const a = gradeOrdinal(studentGrade);
  const b = gradeOrdinal(chunkGrade);
  if (a == null || b == null) return 0;
  const d = b - a;
  return d === 0 ? 0 : d > 0 ? d * PENAL_GRADO_ARRIBA : -d * PENAL_GRADO_ABAJO;
}

interface LessonChunk {
  chunkId: string; content: string; unit: number | null; lesson: number | null;
  oa: string | null; headingPath: string | null; pageStart: number | null; pageEnd: number | null;
  documentTitle: string | null; grade: string | null;
}

/** Trae los chunks de contenido de una unidad/lección concreta (orden de página). */
async function fetchLessonChunks(subjectId: string, unit: number, lesson: number | null): Promise<LessonChunk[]> {
  const sql = getSql();
  const rows = (lesson == null
    ? await sql`
        select ch.id as chunk_id, ch.content, ch.unit, ch.lesson, ch.oa, ch.heading_path,
               coalesce(ch.page_start, ch.page) as page_start, coalesce(ch.page_end, ch.page) as page_end,
               d.title as document_title, d.grade
        from chunks ch join documents d on d.id = ch.document_id
        where d.subject_id = ${subjectId} and ch.corpus_role = 'content' and ch.unit = ${unit}
        order by ch.page nulls last, ch.chunk_index
        limit 28`
    : await sql`
        select ch.id as chunk_id, ch.content, ch.unit, ch.lesson, ch.oa, ch.heading_path,
               coalesce(ch.page_start, ch.page) as page_start, coalesce(ch.page_end, ch.page) as page_end,
               d.title as document_title, d.grade
        from chunks ch join documents d on d.id = ch.document_id
        where d.subject_id = ${subjectId} and ch.corpus_role = 'content' and ch.unit = ${unit} and ch.lesson = ${lesson}
        order by ch.page nulls last, ch.chunk_index
        limit 28`) as unknown as {
    chunk_id: string; content: string; unit: number | null; lesson: number | null;
    oa: string | null; heading_path: string | null; page_start: number | null; page_end: number | null;
    document_title: string | null; grade: string | null;
  }[];
  return rows.map((r) => ({
    chunkId: r.chunk_id, content: r.content, unit: r.unit, lesson: r.lesson,
    oa: r.oa, headingPath: r.heading_path, pageStart: r.page_start, pageEnd: r.page_end,
    documentTitle: r.document_title, grade: r.grade,
  }));
}

/**
 * El material de UNA lección del plan, para poder armarle preguntas.
 *
 * ⚠️ NO usa `unit`/`lesson` como el estudio dirigido, y es a propósito: en varios
 * libros el plan sale con `unit: null` (el índice no trae la unidad), y ahí
 * `fetchLessonChunks` no devuelve nada. En cambio TODO ítem del plan trae rango
 * de páginas, porque sale del índice del libro. Filtrar por páginas funciona
 * para las 29 materias con plan, no solo para las que tienen unidad.
 *
 * Sin gate: el que pide esto ya sabe qué lección quiere: no hay nada que decidir
 * sobre relevancia.
 *
 * ⚠️ `documentId` es OBLIGATORIO, y es el arreglo de un bug real. Una materia
 * puede tener varios libros y las páginas se pisan entre ellos: Matemática 6º
 * tiene el texto del estudiante más dos tomos de Sumo Primero, y Lenguaje 1º
 * tiene ocho documentos. Filtrando solo por materia y rango, la lección "Tema 1
 * Operaciones, múltiplos y factores" (págs. 15-16) devolvía 2 fragmentos del
 * libro correcto y 1 de Sumo Primero — medido el 2026-08-20. Eso alimenta las
 * preguntas del quiz, así que el ruido terminaba en la nota del alumno.
 *
 * Va como parámetro requerido y no opcional a propósito: si fuera opcional, el
 * próximo llamador lo omite y el bug vuelve sin que nadie se entere.
 * `muestrasDeRango` en sections.ts ya lo hacía bien; esta función no.
 */
export async function fetchLessonMaterial(opts: {
  subjectId: string;
  /** El libro del que sale la lección. Resolver con `documentoDeTema()`. */
  documentId: string;
  pageStart: number;
  pageEnd: number;
  /** Techo de fragmentos. 40 y no 28 (el del estudio dirigido) porque acá la
   *  muestra se reparte a lo largo de la lección y conviene tenerla entera. */
  limite?: number;
}): Promise<{ chunkId: string; content: string; page: number | null }[]> {
  const sql = getSql();
  const desde = Math.min(opts.pageStart, opts.pageEnd);
  const hasta = Math.max(opts.pageStart, opts.pageEnd);
  const rows = (await sql`
    select ch.id as chunk_id, ch.content,
           coalesce(ch.page_start, ch.page) as page
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${opts.subjectId}
      and ch.document_id = ${opts.documentId}
      and ch.corpus_role = 'content'
      and coalesce(ch.page_start, ch.page) between ${desde} and ${hasta}
    order by ch.page nulls last, ch.chunk_index
    limit ${opts.limite ?? 40}`) as unknown as {
    chunk_id: string; content: string; page: number | null;
  }[];
  return rows.map((r) => ({ chunkId: r.chunk_id, content: r.content, page: r.page }));
}

const empty = (): Record<TeachingType, PedagogyChunk[]> => {
  const o = {} as Record<TeachingType, PedagogyChunk[]>;
  for (const t of TEACHING_TYPES) o[t] = [];
  return o;
};

/**
 * Recupera contenido (gated) + pedagogía tipada para enseñar un tema.
 * Devuelve content.grounded=false si no hay material de contenido: el tutor se
 * abstiene igual que en el chat (anti-alucinación intacto).
 */
/** Tipos de pedagogía que contienen "qué" factual, usables como respaldo citable
 *  cuando el TE no alcanza (el solucionario trae respuestas; ambiente, contenido
 *  de actividad). Las ideas_previas/evaluación son preguntas, no material a citar. */
const CITABLE_PEDAGOGY: TeachingType[] = ["solucionario", "ambiente_aprendizaje", "habilidad"];

export async function retrieveForTeaching(
  query: string,
  opts: TeachingOptions,
): Promise<TeachingContext> {
  const contentK = opts.contentK ?? contentKFromEnv();
  const perType = opts.perType ?? 2;
  const threshold = opts.minRerankScore ?? rerankMinScoreFromEnv();
  const oaBoost = oaBoostFromEnv();

  // 0) ESTUDIO DIRIGIDO POR EL PLAN: unidad/lección conocida → material citable
  //    de esa unidad, rerankeado por la consulta. Grounding garantizado (el tema
  //    ES del material), sin depender del gate semántico sobre un título flojo.
  let directCitable: CitableChunk[] = [];
  if (opts.unit != null && opts.subjectId) {
    try {
      const lessonChunks = await fetchLessonChunks(opts.subjectId, opts.unit, opts.lesson ?? null);
      if (lessonChunks.length > 0) {
        // Rerank sobre texto TRUNCADO (los primeros ~600 chars alcanzan como
        // señal): mantiene la relevancia y evita el timeout del reranker con
        // unidades grandes (era la causa del 500 al estudiar un tema del plan).
        const scores = await rerank(query, lessonChunks.map((c) => c.content.slice(0, RERANK_SNIPPET_CHARS)), true);
        directCitable = lessonChunks
          .map((c, i) => ({ c, s: scores[i] ?? 0 }))
          .sort((a, b) => b.s - a.s)
          .slice(0, contentK)
          .map(({ c, s }) => ({
            chunkId: c.chunkId, content: c.content, source: "content" as const,
            unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
            pageStart: c.pageStart, pageEnd: c.pageEnd, score: s,
            documentTitle: c.documentTitle, grade: c.grade,
          }));
      }
    } catch {
      // Si el estudio dirigido falla (timeout del sidecar, etc.), NO reventamos:
      // caemos al retrieval normal con gate.
      directCitable = [];
    }
  }

  // El dirigido solo REEMPLAZA al gate cuando su material pasa el umbral. Si
  // quedó flojo (score < threshold), el retrieval semántico corre igual y el
  // dirigido pasa a ser último recurso — antes salteaba el gate por completo y
  // `grounded=true` con score 0.001 se camuflaba como grounding normal.
  const directedOk = directCitable.length > 0 && directCitable[0]!.score >= threshold;

  // 1) CONTENIDO — CASCADA DE ALCANCE.
  //
  //    El gate deja de ser un cortacircuito y pasa a ser el DISPARADOR de la
  //    etapa siguiente: si con el material del curso del alumno no alcanza, se
  //    busca en la misma asignatura de los otros cursos, y si tampoco, en todo
  //    el corpus. Ningún umbral cambia — cambia qué se hace cuando no se llega.
  //
  //    Escalonada y no una búsqueda global de entrada porque el brazo léxico une
  //    los lexemas con OR: abrir el alcance en el 100% de los turnos pagaría ese
  //    costo siempre, cuando solo hace falta en el ~20% que hoy se abstiene.
  let content = directedOk
    ? null
    : await retrieveRanked(query, {
        userId: opts.userId,
        subjectIds: opts.subjectId ? [opts.subjectId] : null,
        // La materia que el alumno abrió explícitamente entra aunque esté en
        // pausa: cortarle la conversación a mitad es otra decisión, y no esta.
        incluirPausadas: true,
        k: contentK,
        minRerankScore: threshold,
        corpusRole: "content",
      });

  let scope: TeachingScope = "curso";
  // EL ESTUDIO DIRIGIDO NO SE AMPLÍA NUNCA, ni cuando su material queda flojo.
  // El alumno pidió estudiar ESTA lección de SU plan: traerle la unidad 3 de
  // otro curso sería responder otra cosa. Y `unit`/`lesson` son números que se
  // repiten en los 67 libros, así que ampliar acá devuelve mezcla.
  const dirigido = opts.unit != null;
  // Al ampliar, el pool trae varios cursos: se reordena por cercanía de nivel
  // para que, a igualdad de relevancia, gane el material del curso del alumno.
  // Solo el ORDEN — el gate ya decidió con el score crudo.
  const porCercania = <T extends { content: string; grade: string | null; rerankScore: number; rankScore: number }>(cs: T[]): T[] => {
    const ordenados = [...cs]
      .map((c) => ({ ...c, rankScore: c.rankScore - penalizacionGrado(opts.studentGrade, c.grade) }))
      .sort((a, b) => b.rankScore - a.rankScore);
    // DEDUPE, y solo acá: el corpus tiene ~19% de chunks repetidos y cruzando
    // cursos eso se amplifica (Biología 1º y 2º Medio son literalmente el mismo
    // libro cargado dos veces). Sin esto, el alumno recibe la misma explicación
    // cinco veces y el pool se desperdicia.
    //
    // DESPUÉS del gate y no antes, a propósito: `gapMed` mide el top-1 contra la
    // MEDIANA del pool, y esa mediana está calibrada CON los duplicados dentro.
    // Deduplicar antes recalibraría el margen del gate en silencio.
    const vistos = new Set<string>();
    const out: T[] = [];
    for (const c of ordenados) {
      const k = c.content.replace(/\s+/g, " ").trim().slice(0, 300).toLowerCase();
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(c);
    }
    return out;
  };

  // DISCRIMINADOR DE ANSWERABILITY (solo cross-scope, detrás de flag): el gate
  // dice "esto es relevante", no "esto contesta". Ver answerability.ts — y ojo
  // que SOLO gobierna las etapas de acá abajo: el libro del propio curso no pasa
  // por él, a propósito.
  const answerOn = answerabilityEnabled() && !opts.vagueTurn;
  const apoyadoOn = apoyadoEnabled() && !opts.vagueTurn;
  const minRelevancia = apoyadoMinRelevanciaFromEnv();
  const minEntailParcial = apoyadoMinEntailFromEnv();
  let answerEntail: number | null = null;
  // El material NO contesta la pregunta pero es del tema: se sirve marcado como
  // PARCIAL en vez de descartarse. Ver el comentario de `contesta`/apoyado.
  let parcial = false;
  const pasaAnswerability = async (
    chunks: { content: string }[],
    topScore: number,
  ): Promise<boolean> => {
    if (!answerOn) return true;
    const v = await contesta(query, chunks.map((c) => c.content));
    // null = sidecar caído: no negarle material a un alumno por un filtro mudo.
    if (v === null) return true;
    answerEntail = v.entailment;
    if (v.ok) { parcial = false; return true; }
    // No contesta. Para valer como apoyo PARCIAL tiene que cumplir las DOS: ser
    // del tema (relevancia) Y decir algo al respecto (piso de entailment). Con la
    // relevancia sola entraba material como el de q129 —0,847 de relevancia y
    // 0,147 de entailment: un texto de geometría que del teorema de Pitágoras no
    // dice nada—, que es el mismo ruido con cara de respuesta un nivel más abajo.
    if (apoyadoOn && topScore >= minRelevancia && v.entailment >= minEntailParcial) {
      parcial = true;
      return true;
    }
    return false;
  };

  if (!dirigido && !directedOk && opts.subjectId && !content?.grounded && (opts.familyIds?.length ?? 0) > 1) {
    const ampliado = await retrieveRanked(query, {
      userId: opts.userId,
      subjectIds: opts.familyIds,
      k: contentK,
      minRerankScore: threshold,
      // MARGEN APAGADO, igual que en `area` y en el corpus completo.
      //
      // El margen distribucional existe para rescatar el registro coloquial
      // DENTRO del material del alumno: ahí el contexto de materia respalda un
      // score absoluto bajo. Fuera de su libro no hay tal respaldo, y el margen
      // deja de ser un rescate para volverse una puerta lateral.
      //
      // Medido (q034, 2026-08-22): a "¿qué es la fotosíntesis?" preguntada desde
      // Lengua 8º entraba Lengua 7º pág. 134 —"los restos nudosos de un
      // antiquísimo tocón"— con topScore 0.1598, POR DEBAJO del gate de 0.18,
      // rescatado por el margen. Después el NLI le dio 0.981 de entailment
      // (el texto menciona células, azúcares y respiración) y salió como
      // respuesta respaldada. Dos mecanismos sanos encadenados dan uno insano.
      //
      // Es la misma fuga que `otra_materia` ya tapaba con este mismo `0` — ver
      // el comentario de `gateMargin` en rerank.ts, que la documenta con
      // "¿cuánto hervir un huevo?" a 0.16 pese al listón de 0.50.
      gateMargin: 0,
      corpusRole: "content",
    });
    if (ampliado.grounded && (await pasaAnswerability(ampliado.chunks, ampliado.topScore))) {
      content = { ...ampliado, chunks: porCercania(ampliado.chunks) };
      scope = "otro_curso";
    }
  }

  // ETAPA `area`: EL CASILLERO DEL PLAN, NO LA ASIGNATURA DEL LIBRO.
  //
  // El EPJA no tiene Biología, Física ni Química: tiene UN casillero "Ciencias
  // Naturales" con un solo juego de conocimientos esenciales, que la enseñanza
  // regular reparte en tres libros. Un chico de Biología al que le preguntan por
  // ondas está rindiendo Ciencias Naturales, y la respuesta está en el libro de
  // Física de su MISMO curso.
  //
  // Esto no existía y el agujero estaba tapado por la etapa de corpus completo,
  // que se apagó el 2026-08-11 sin revisar qué se apoyaba en ella (ver
  // schema_subject_area.sql). Medido sobre el mapa curricular: de 47 exigencias
  // que un libro no cubría, 43 estaban en un libro hermano.
  //
  // Corre DESPUÉS de la familia y solo si la familia no llegó al listón de ESTA
  // etapa — misma disciplina que la cascada de abajo: umbrales distintos por
  // etapa significan que frenar en la primera que supera el suyo deja ganar a un
  // match flojo por venir antes en el código. Y como allá, gana el mejor
  // `rerankScore`, que es comparable porque es el mismo cross-encoder.
  const familiaFloja =
    (scope === "curso" || scope === "otro_curso") &&
    (content?.topScore ?? 0) < UMBRAL_AREA;
  // El libro del PROPIO curso se queda aunque puntúe bajo: es el que el chico
  // tiene sobre la mesa y con el que lo van a evaluar. Solo se sigue buscando si
  // no hubo material, o si lo que hay vino de otro curso y quedó flojo.
  const cedeElPropio = scope !== "curso" || !content?.grounded;
  if (
    !dirigido && !directedOk && (opts.areaIds?.length ?? 0) > 1 &&
    (!content?.grounded || (familiaFloja && cedeElPropio))
  ) {
    const porArea = await retrieveRanked(query, {
      userId: opts.userId,
      subjectIds: opts.areaIds,
      k: contentK,
      minRerankScore: Math.max(threshold, UMBRAL_AREA),
      // Igual que en la etapa de corpus completo: el margen existe para rescatar
      // registro coloquial DENTRO del material del alumno, no para perforar un
      // listón que justamente sube porque el material es de otro libro.
      gateMargin: 0,
      corpusRole: "content",
    });
    if (
      porArea.grounded &&
      porArea.topScore > (content?.grounded ? content.topScore : -1) &&
      (await pasaAnswerability(porArea.chunks, porArea.topScore))
    ) {
      content = { ...porArea, chunks: porCercania(porArea.chunks) };
      scope = "area";
    }
  }
  // LA CASCADA NO PUEDE SER "EL PRIMERO QUE PASA GANA".
  //
  // Las etapas tienen umbrales distintos —0.18 la propia asignatura, 0.5 el
  // corpus entero— así que frenar en la primera que supera SU umbral hace que un
  // 0.18 flojo le gane a un 0.99 excelente, nada más que por venir antes.
  //
  // Medido, y es el caso que lo destapó. "¿Qué es la fotosíntesis?" desde Lengua
  // 8º, con la etapa de familia activa:
  //   otro_curso   0.18  Lengua 7º pág. 134: "los restos nudosos de un
  //                      antiquísimo tocón" — un cuento sobre un tronco.
  // y lo que había esperando dos líneas más abajo:
  //   otra_materia 0.99  Ciencias Naturales 6º pág. 83: "la glucosa producida
  //                      es utilizada por el organismo fotosintetizador".
  // El chico recibía el cuento del tocón, rotulado "está en tu libro de 7º".
  //
  // Así que cuando lo de la propia asignatura queda FLOJO se sigue buscando, y
  // gana el mejor por `rerankScore` —comparable entre etapas porque es el mismo
  // cross-encoder sobre la misma consulta, la misma disciplina que ya rige para
  // el boost de OA y la penalización de grado. No se paga siempre: solo cuando
  // la etapa anterior no llegó al listón alto.
  // Solo se sigue buscando cuando lo flojo vino de OTRO CURSO. Si salió del
  // libro del propio curso se queda, aunque puntúe bajo: es el libro que el
  // chico tiene sobre la mesa y con el que lo van a evaluar, y esa es la promesa
  // del producto. La etapa que hay que vigilar es la de al lado, no la de casa.
  //
  // ── 2026-08-11: ESTA ETAPA YA NO CORRE EN EL PRODUCTO ───────────────────────
  // Todo lo de arriba sigue siendo cierto y por eso el código queda: cuando la
  // etapa corría, así es como tenía que decidir. Lo que cambió es si tiene que
  // correr, y la respuesta es NO — por producto, no por calibración.
  //
  // El alumno entra a Biología y pregunta algo de Biología. Que el tutor le
  // conteste con el libro de Lengua es raro aunque el fragmento sea bueno:
  // rompe la promesa de la materia en la que está parado, y el sello que lo
  // avisaba ("esto lo saqué de otro libro tuyo") explica el salto pero no lo
  // justifica. Sin esta etapa, lo que antes venía de otra asignatura ahora se
  // responde en modo `general` —conocimiento propio del tutor, marcado como no
  // respaldado— que es un encuadre honesto y no mezcla materias.
  //
  // Se enciende con `corpusCompleto: true` para medir, nunca para atender.
  const flojo =
    (scope === "otro_curso" || scope === "area") &&
    (content?.topScore ?? 0) < UMBRAL_OTRA_MATERIA;
  if (
    !dirigido && !directedOk && opts.corpusCompleto === true &&
    (!content?.grounded || flojo)
  ) {
    // LISTÓN MÁS ALTO para la etapa de otra materia. Un fragmento de Ciencias
    // Naturales que responde una duda planteada en Lengua necesita MÁS evidencia
    // que uno del propio libro: no hay contexto de materia que lo respalde, y un
    // match flojo es simplemente ruido de 29.000 chunks.
    //
    // La vía del MARGEN va APAGADA en esta etapa (gateMargin: 0): el margen
    // existe para rescatar registro coloquial DENTRO del material del alumno,
    // no para perforar el listón alto — por ahí se coló "¿cuánto hervir un
    // huevo?" con topScore 0.16 pese al 0.5.
    const todo = await retrieveRanked(query, {
      userId: opts.userId,
      subjectIds: null,
      k: contentK,
      minRerankScore: Math.max(threshold, UMBRAL_OTRA_MATERIA),
      gateMargin: 0,
      corpusRole: "content",
    });
    // Solo desplaza a lo anterior si es ESTRICTAMENTE mejor. Ante empate se
    // queda la asignatura propia: mismo valor para el alumno, y su libro.
    if (
      todo.grounded && todo.topScore > (content?.grounded ? content.topScore : -1) &&
      (await pasaAnswerability(todo.chunks, todo.topScore))
    ) {
      content = { ...todo, chunks: porCercania(todo.chunks) };
      scope = "otra_materia";
    }
  }

  // 2) PEDAGOGÍA por relevancia (corpus_role='pedagogy'), rerankeada.
  //    NO se amplía nunca: la guía docente de otro curso es pedagogía
  //    activamente equivocada (dice cómo enseñarle a chicos de otra edad).
  const pedaCandidates = await retrieveHybrid(query, {
    userId: opts.userId,
    subjectIds: opts.subjectId ? [opts.subjectId] : null,
    incluirPausadas: true,
    k: 40,
    // Sin esto, pedir 40 sobre brazos de 20 era un número que no se cumplía.
    poolPerSide: 40,
    corpusRole: "pedagogy",
  });

  const oaSrc = directedOk ? directCitable : (content?.chunks ?? directCitable);
  const oasContent = [...new Set(oaSrc.map((c) => c.oa).filter(Boolean))] as string[];
  const pedagogy = empty();
  let rankedPeda: PedagogyChunk[] = [];
  if (pedaCandidates.length > 0) {
    const scores = await rerank(query, pedaCandidates.map((c) => c.content.slice(0, RERANK_SNIPPET_CHARS)), true);
    rankedPeda = pedaCandidates
      // rerankScore queda CRUDO (gate); el boost de OA solo mueve rankScore (orden).
      .map((c, i) => {
        const rerankScore = scores[i] ?? 0;
        // El boost SOLO dentro del mismo curso: los códigos de OA son "OA6" a
        // secas y se repiten en TODOS los grados, así que cruzando cursos el
        // "OA6" de 1º Básico haría boost contra el de 4º Medio.
        const mismoCurso = scope === "curso";
        const boosted = mismoCurso && c.oa && oasContent.includes(c.oa) ? rerankScore + oaBoost : rerankScore;
        return { ...c, rerankScore, rankScore: Math.min(1, boosted) };
      })
      .sort((a, b) => b.rankScore - a.rankScore);

    const pedaMin = pedagogyMinScoreFromEnv();
    for (const c of rankedPeda) {
      // Gate por score CRUDO (misma disciplina que el resto: el boost de OA solo
      // mueve el orden, nunca decide si un bloque entra al prompt).
      if (c.rerankScore < pedaMin) continue;
      const t = c.pedagogyType as TeachingType;
      if (TEACHING_TYPES.includes(t) && pedagogy[t].length < perType) pedagogy[t].push(c);
    }
  }

  // 3) GROUNDING sobre AMBOS corpus: contenido (TE) preferido; si no alcanza,
  //    la GDD (solucionario/ambiente/habilidad) como material oficial de respaldo.
  let citable: CitableChunk[];
  let citableSource: "content" | "pedagogy" | "none";
  let topScore: number;
  let gateBypassed = false;
  if (directedOk) {
    citableSource = "content";
    topScore = directCitable[0]!.score;
    citable = directCitable;
  } else if (content && content.grounded && content.chunks.length > 0) {
    citableSource = "content";
    topScore = content.topScore;
    citable = content.chunks.map(aCitable);
  } else {
    // El filtro del gate usa el rerankScore CRUDO: con el boost separado en
    // rankScore, un chunk de pedagogía con score real 0.03 ya no cruza 0.18.
    const fallback = rankedPeda
      .filter((c) => CITABLE_PEDAGOGY.includes(c.pedagogyType as TeachingType) && c.rerankScore >= threshold)
      .slice(0, contentK);
    if (fallback.length > 0) {
      citableSource = "pedagogy";
      topScore = fallback.reduce((m, c) => Math.max(m, c.rerankScore), 0);
      citable = fallback.map((c) => ({
        chunkId: c.chunkId, content: c.content, source: "pedagogy" as const,
        unit: c.unit, lesson: c.lesson, oa: c.oa, headingPath: c.headingPath,
        pageStart: c.pageStart, pageEnd: c.pageEnd, score: c.rerankScore,
        documentTitle: c.documentTitle, grade: c.grade,
      }));
    } else if (directCitable.length > 0) {
      // ÚLTIMO RECURSO del estudio dirigido: el alumno pidió estudiar ESTA
      // unidad del plan y el material existe, así que se entrega — pero flojo
      // según el reranker, y eso queda CONTABLE (gateBypassed) en vez de
      // camuflado como grounding normal. Decisión de producto, ahora visible.
      citableSource = "content";
      topScore = directCitable[0]!.score;
      citable = directCitable;
      gateBypassed = true;
    } else {
      citableSource = "none";
      topScore = Math.max(content?.topScore ?? 0, rankedPeda[0]?.rerankScore ?? 0);
      citable = [];
    }
  }

  // Lo que el RANKING trajo, sin que el gate opine. Ver `TeachingContext.retrieved`.
  // `content.chunks` viene poblado aunque `content.grounded` sea false (rerank.ts
  // devuelve `ranked.slice(0, k)` en los dos casos): es la cascada de acá arriba
  // la que los descarta, no el retrieval.
  const retrieved: CitableChunk[] =
    directCitable.length > 0 ? directCitable : (content?.chunks ?? []).map(aCitable);

  const oas = [...new Set([...citable.map((c) => c.oa), ...oasContent].filter(Boolean))] as string[];
  return {
    citable,
    retrieved,
    scope: citable.length > 0 ? scope : "ninguno",
    grounded: citable.length > 0,
    citableSource,
    pedagogy,
    oas,
    topScore,
    gateBypassed,
    stats: content?.stats,
    answerabilityEntail: answerEntail,
    // Solo tiene sentido si lo que se sirve salió de la etapa que lo evaluó: si
    // al final ganó el libro del propio curso o la pedagogía, el material NO es
    // parcial aunque una etapa descartada lo fuera.
    parcial: parcial && citableSource === "content" && scope !== "curso",
  };
}
