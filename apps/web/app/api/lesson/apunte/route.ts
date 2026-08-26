import {
  armarApunte, verificarApunte, partirEnOraciones, SinApunte, type Apunte,
} from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { documentoDeTema, fetchLessonMaterial, nliPairs } from "@tutor-ia/rag";
import { requireCursoAbierto } from "@/lib/auth";

export const runtime = "nodejs";
// Generar el apunte es una llamada al modelo; el gate son unos pares de NLI.
export const maxDuration = 120;

/**
 * POST /api/lesson/apunte — el apunte de una parada del camino.
 * body: { subjectId, topicKey, title?, p0?, p1? }
 *
 * ⚠️ SE GENERA A PEDIDO SI NO ESTÁ, y esto arregla el problema que tenía la
 * primera versión: la ruta SOLO LEÍA de `lesson_notes`, que se llena con el CLI
 * offline. Con seis apuntes generados sobre 1.846 paradas, el 99,7% de las veces
 * la pantalla no mostraba nada y la función era invisible — el alumno abría una
 * parada cualquiera y veía exactamente lo de antes, sin ninguna señal de que
 * esto existiera.
 *
 * Es el mismo patrón que ya usa /api/lesson/quiz: la primera visita paga la
 * generación y queda cacheada para todos los que vengan después. El batch
 * offline sigue existiendo, pero como forma de PRECALENTAR y de poder leer los
 * apuntes a mano antes que un alumno, no como requisito para que la función
 * exista.
 */
export async function POST(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    subjectId?: string; topicKey?: string; title?: string;
    p0?: number | null; p1?: number | null;
  };
  const { subjectId, topicKey } = body;
  if (!subjectId || !topicKey) {
    return Response.json({ error: "Falta subjectId o topicKey." }, { status: 400 });
  }

  const sql = getSql();

  // 1) ¿Ya está? El apunte se relee muchas veces: la caché es la ruta normal, no
  //    la excepción.
  const [ya] = (await sql`
    select apunte from lesson_notes
    where subject_id = ${subjectId} and topic_key = ${topicKey}`) as unknown as { apunte: Apunte }[];
  if (ya) return Response.json({ apunte: ya.apunte });

  // 2) Si no, se arma. Igual que el quiz, el material se lee POR RANGO DE
  //    PÁGINAS y con el documento resuelto en el servidor: varias materias
  //    tienen más de un libro y sus páginas se pisan.
  if (body.p0 == null || body.p1 == null) {
    return Response.json({ error: "sin_paginas" }, { status: 422 });
  }
  const documentId = await documentoDeTema(subjectId, topicKey);
  if (!documentId) return Response.json({ error: "sin_libro" }, { status: 422 });

  let frags: { content: string; page: number | null }[] = [];
  try {
    frags = await fetchLessonMaterial({
      subjectId, documentId, pageStart: body.p0, pageEnd: body.p1,
    });
  } catch (e) {
    console.error(`[apunte] no pude leer la lección: ${e instanceof Error ? e.message : e}`);
  }
  const oraciones = partirEnOraciones(frags.map((f) => ({ content: f.content, page: f.page })));
  if (oraciones.length < 4) return Response.json({ error: "sin_material" }, { status: 422 });

  const [materia] = (await sql`select name from subjects where id = ${subjectId}`) as unknown as { name: string }[];

  // La pedagogía del libro del docente: el error típico y qué se evalúa. Las dos
  // se buscan por PALABRAS del título porque la guía no se puede ligar por
  // índice (`heading_path` dice "Unidad ? Lección ?"). Lo que no matchea se
  // queda sin bloque, que es mejor que mostrar el de otra lección.
  // ⚠️ "lección" y "unidad" NO son temas: dejarlas traía el aviso de cualquier
  // otra lección (medido: "Lección 2 Mundos familiares" sacó el suyo de la guía
  // de otro cuento, por la palabra "lección").
  const palabras = (body.title ?? "")
    .toLowerCase().replace(/[¿?¡!.,:;()"“”]/g, " ").split(/\s+/)
    .filter((w) => w.length > 4 && !/^(sobre|para|como|cual|cuales|nuestro|nuestra|manera|parte|mundo|mundos|lecci[oó]n|unidad|m[oó]dulo|cap[ií]tulo|tema|temas|texto|textos|primera|segunda|tercera)$/.test(w));
  const guia = async (tipo: string, max: number): Promise<string | null> => {
    if (palabras.length === 0) return null;
    const rows = (await sql`
      select ch.content from chunks ch join documents d on d.id = ch.document_id
      where d.subject_id = ${subjectId} and ch.corpus_role = 'pedagogy'
        and ch.pedagogy_type = ${tipo} and length(ch.content) > 200
        and ch.content not like '%......%'
        -- DOS palabras del título como mínimo, y la que más matchea primero.
        and (select count(*) from unnest(${palabras}::text[]) w
             where ch.content ilike '%' || w || '%') >= ${Math.min(2, palabras.length)}
      order by (select count(*) from unnest(${palabras}::text[]) w
                where ch.content ilike '%' || w || '%') desc, ch.page
      limit 1`) as unknown as { content: string }[];
    const t = rows[0]?.content;
    if (!t) return null;
    const limpio = t.replace(/^\[[^\]]*\]\s*/, "")
      .replace(/([a-záéíóúñü])-\s+([a-záéíóúñü])/g, "$1$2")
      .replace(/\s+/g, " ").trim();
    if (limpio.length <= max) return limpio;
    const corte = limpio.slice(0, max).lastIndexOf(".");
    return corte > max * 0.3 ? limpio.slice(0, corte + 1) : limpio.slice(0, max);
  };
  const [ef, ev] = await Promise.all([guia("errores_frecuentes", 700), guia("evaluacion", 900)]);

  let apunte: Apunte;
  try {
    const bruto = await armarApunte({
      titulo: body.title ?? "", subjectName: materia?.name ?? "", oraciones,
      errorFrecuente: ef, evaluacion: ev,
    });
    // El gate corre si el sidecar contesta. Si no, el apunte sale igual marcado
    // `gate.corrido: false`: dejar al alumno sin apunte porque un sidecar local
    // no responde es peor que un apunte sin el veto, que además se puede volver
    // a pasar después con el CLI.
    apunte = await verificarApunte(bruto, oraciones, nliPairs);
  } catch (e) {
    if (e instanceof SinApunte) {
      console.warn(`[apunte] ${topicKey}: ${e.razon}`);
      return Response.json({ error: e.razon }, { status: 503 });
    }
    throw e;
  }

  // `do nothing` en el conflicto: dos alumnos que abren la misma parada a la vez
  // generan en paralelo y el segundo no debe pisar al primero — se quedan con el
  // mismo apunte, que es lo que corresponde.
  await sql`
    insert into lesson_notes (subject_id, topic_key, apunte, gate, topic_title)
    values (${subjectId}, ${topicKey}, ${toJson(sql, apunte)}, ${toJson(sql, apunte.gate ?? null)}, ${body.title ?? null})
    on conflict (subject_id, topic_key) do nothing`;

  return Response.json({ apunte });
}
