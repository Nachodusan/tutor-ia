import { chatJSON } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { getPlanTopics, type PlanTopic } from "@tutor-ia/rag";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
// Generar la prueba con el 7B (recarga por keep_alive:0) puede tardar.
export const maxDuration = 180;

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
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const body = (await req.json()) as { subjectId?: string; subjectName?: string };
  const subjectId = body.subjectId;
  if (!subjectId) return Response.json({ error: "Falta subjectId" }, { status: 400 });

  const sql = getSql();
  // MISMA fuente que /api/plan: el índice real del libro. Antes esta query era
  // una copia byte a byte de la de plan/route.ts, con la misma metadata rota.
  // El material del currículo es global (user_id null), pero la guarda importa:
  // el día que un colegio suba libros propios, esto impide que cualquier alumno
  // autenticado lea material de otro pasando un uuid.
  const sqlGuard = getSql();
  const [visible] = await sqlGuard`
    select 1 from subjects where id = ${subjectId}::uuid
      and (user_id is null or user_id = ${auth.userId}::uuid)
      -- disabled_at acá y no solo en /api/subjects: esconder la materia de la
      -- lista no alcanza, porque el cliente puede tener el id de antes (pestaña
      -- vieja, historial). Desactivar tiene que impedir el uso, no solo la vista.
      and disabled_at is null`;
  if (!visible) return Response.json({ error: "Materia no disponible" }, { status: 404 });

  const temas: PlanTopic[] = await getPlanTopics(subjectId, { limit: 6 });
  if (temas.length < 2) return Response.json({ items: [] });

  // LIBRO DEL PROFESOR: qué se evalúa + propósito, para alinear las preguntas a
  // lo que realmente se toma en la prueba (si la materia tiene guía docente).
  const evalRows = (await sql`
    select left(string_agg(ch.content, ' ' order by ch.chunk_index), 1000) as sample
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId} and ch.corpus_role = 'pedagogy'
      and ch.pedagogy_type in ('evaluacion', 'proposito')
  `) as unknown as { sample: string | null }[];
  const evalFocus = (evalRows[0]?.sample ?? "").replace(/\s+/g, " ").slice(0, 750);

  const toc = temas
    .map((t, i) => `Tema ${i + 1} (${t.title}): ${t.sample.slice(0, 340)}`)
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
            // Sin minItems/maxItems/minimum/maximum: el modo estricto de
            // Structured Outputs no los soporta. No se pierde garantía —
            // más abajo se descarta la pregunta si no trae 4 opciones y se
            // clampea `correct` al rango 0-3.
            options: { type: "array", items: { type: "string" } },
            correct: { type: "integer" },
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
          content: `Materia: ${body.subjectName ?? ""}\n\nTemas (con un fragmento de muestra de cada uno):\n${toc}${evalFocus ? `\n\nQUÉ EVALÚA EL PROFESOR (del libro del docente; priorizá preguntas alineadas a este foco):\n${evalFocus}` : ""}\n\nDevolvé JSON { items: [...] } con EXACTAMENTE ${temas.length} preguntas, en el mismo orden que los temas.`,
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
      const g = temas[i];
      if (!g) return null;
      if (!q.question?.trim() || !Array.isArray(q.options) || q.options.length !== 4) return null;
      const correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3 ? q.correct : 0;
      return {
        n: i + 1,
        // El título del índice es mejor fallback que "Unidad 1 · Lección 2".
        topic: q.topic?.trim() || g.title,
        question: q.question.trim(),
        options: q.options.map((o) => String(o)),
        correct,
        explain: q.explain?.trim() || "",
        key: g.key,
        documentId: g.documentId,
        pageStart: g.pageStart,
        pageEnd: g.pageEnd,
        // Retrocompatibles con el estudio dirigido actual.
        unit: g.unitNo,
        lesson: g.lessonNo,
        p0: g.pageStart,
        p1: g.pageEnd,
      };
    })
    .filter(Boolean);

  return Response.json({ items });
}
