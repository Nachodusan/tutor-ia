import { chatJSON } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
// Generar la prueba con el 7B (recarga por keep_alive:0) puede tardar.
export const maxDuration = 180;

interface Group {
  unit: number | null;
  lesson: number | null;
  p0: number | null;
  p1: number | null;
  sample: string | null;
}

/**
 * POST /api/test — arma una SIMULACIÓN DE PRUEBA (opción múltiple) desde el
 * material real. body: { subjectId, subjectName? }
 *
 * Una pregunta por unidad/lección (fundamentada en su fragmento), así cada
 * pregunta sabe a qué TEMA pertenece: el feedback puede señalar los puntos
 * débiles y enlazar a "estudiar ese tema" (estudio dirigido por unit/lesson).
 * La corrección es determinística en el cliente (índice elegido vs correcto).
 */
export async function POST(req: Request) {
  await getCurrentUserId(req);
  const body = (await req.json()) as { subjectId?: string; subjectName?: string };
  const subjectId = body.subjectId;
  if (!subjectId) return Response.json({ error: "Falta subjectId" }, { status: 400 });

  const sql = getSql();
  const rows = (await sql`
    select ch.unit, ch.lesson,
           min(ch.page) as p0,
           max(ch.page) as p1,
           left(string_agg(ch.content, ' ' order by ch.page, ch.chunk_index), 700) as sample
    from chunks ch
    join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId}
      and ch.corpus_role = 'content'
      and (ch.unit is not null or ch.lesson is not null)
    group by ch.unit, ch.lesson
    order by ch.unit nulls last, ch.lesson nulls last
    limit 14
  `) as unknown as Group[];

  const clean = rows.filter((r) => r.unit != null && r.lesson != null);
  const chosen = (clean.length >= 3 ? clean : rows).slice(0, 6);
  if (chosen.length < 2) return Response.json({ items: [] });

  // LIBRO DEL PROFESOR: qué se evalúa + propósito, para alinear las preguntas a
  // lo que realmente se toma en la prueba (si la materia tiene guía docente).
  const evalRows = (await sql`
    select left(string_agg(ch.content, ' ' order by ch.chunk_index), 1000) as sample
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId} and ch.corpus_role = 'pedagogy'
      and ch.pedagogy_type in ('evaluacion', 'proposito')
  `) as unknown as { sample: string | null }[];
  const evalFocus = (evalRows[0]?.sample ?? "").replace(/\s+/g, " ").slice(0, 750);

  const genericTitle = (r: Group) =>
    r.unit != null && r.lesson != null ? `Unidad ${r.unit} · Lección ${r.lesson}`
      : r.unit != null ? `Unidad ${r.unit}` : `Lección ${r.lesson}`;

  const toc = chosen
    .map((r, i) => `Tema ${i + 1} (${genericTitle(r)}): ${(r.sample ?? "").replace(/\s+/g, " ").slice(0, 340)}`)
    .join("\n\n");

  const schema = {
    type: "object", additionalProperties: false, required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["topic", "question", "options", "correct", "explain"],
          properties: {
            topic: { type: "string" },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
            correct: { type: "integer", minimum: 0, maximum: 3 },
            explain: { type: "string" },
          },
        },
      },
    },
  };

  let gen: {
    topic: string; question: string; options: string[]; correct: number; explain: string;
  }[] = [];
  try {
    const out = await chatJSON<{ items: typeof gen }>(
      [
        {
          role: "system",
          content:
            "Sos un profesor que arma una PRUEBA CORTA de opción múltiple para ver cuánto aprendió un alumno de secundaria en Chile, a partir de SU material. Para CADA tema, en el MISMO orden y cantidad, escribí: un título corto del tema (2-4 palabras), UNA pregunta clara y concreta, EXACTAMENTE 4 opciones (una correcta y tres incorrectas pero plausibles según el material), el índice 0-3 de la correcta, y una explicación de 1 línea de por qué es esa (sirve para el feedback). REGLAS: la pregunta debe ser sobre el CONTENIDO del material (hechos, conceptos, procesos), NUNCA sobre la opinión, experiencia o sensaciones del alumno (prohibido '¿qué te resultó difícil?'). Las opciones son solo el texto, SIN letras ni números al inicio (nada de 'A)', '1.'). Basate SOLO en el fragmento; no inventes datos que no aparezcan. Lenguaje simple para la edad. Español de Chile.",
        },
        {
          role: "user",
          content: `Materia: ${body.subjectName ?? ""}\n\nTemas (con un fragmento de muestra de cada uno):\n${toc}${evalFocus ? `\n\nQUÉ EVALÚA EL PROFESOR (del libro del docente; priorizá preguntas alineadas a este foco):\n${evalFocus}` : ""}\n\nDevolvé JSON { items: [...] } con EXACTAMENTE ${chosen.length} preguntas, en el mismo orden que los temas.`,
        },
      ],
      schema,
      { maxTokens: 1400 },
    );
    gen = out.items ?? [];
  } catch {
    gen = [];
  }

  // Mapear cada pregunta a su unidad/lección/página (por índice) y validar.
  const items = gen
    .map((q, i) => {
      const g = chosen[i];
      if (!g) return null;
      if (!q.question?.trim() || !Array.isArray(q.options) || q.options.length !== 4) return null;
      const correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3 ? q.correct : 0;
      return {
        n: i + 1,
        topic: q.topic?.trim() || genericTitle(g),
        question: q.question.trim(),
        options: q.options.map((o) => String(o)),
        correct,
        explain: q.explain?.trim() || "",
        unit: g.unit,
        lesson: g.lesson,
        p0: g.p0,
        p1: g.p1,
      };
    })
    .filter(Boolean);

  return Response.json({ items });
}
