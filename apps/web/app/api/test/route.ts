import { chatJSON } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { getPlanTopics, type PlanTopic } from "@tutor-ia/rag";
import { requireUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
// Generar + verificar la clave son dos llamadas al modelo remoto.
export const maxDuration = 180;

/**
 * POST /api/test — arma una SIMULACIÓN DE PRUEBA (opción múltiple) desde el
 * material real. body: { subjectId, subjectName? }
 *
 * Temas REPARTIDOS por todo el libro (no las primeras 6 lecciones), así cada
 * pregunta sabe a qué TEMA pertenece: el feedback puede señalar los puntos
 * débiles y enlazar a "estudiar ese tema" (estudio dirigido por unit/lesson).
 *
 * LA CLAVE NUNCA VIAJA AL CLIENTE. La prueba completa (con `correct` y
 * `explain`) se persiste en `exams` al generarla; el cliente recibe `testId` +
 * preguntas sin clave, y la corrección la hace /api/test/submit contra lo
 * persistido. Antes la clave iba en el payload: cualquier chico con la pestaña
 * Red abierta la veía, y el submit confiaba en el `correct` que mandara el
 * navegador.
 *
 * LA CLAVE SE VERIFICA antes de servirla: una segunda llamada responde la
 * prueba a ciegas (sin ver la clave declarada) y toda pregunta donde no
 * coinciden se descarta. Un `correct` corrido en uno (el clásico modelo que
 * numera 1-based) marcaba bien lo que el alumno respondió mal, persistía el
 * error en student_weak_topics y alimentaba el panel del docente.
 */

/** Lo que se persiste por pregunta (la clave incluida). */
interface ItemPersistido {
  n: number;
  topic: string;
  question: string;
  options: string[];
  correct: number;
  explain: string;
  key: string;
  documentId: string;
  pageStart: number | null;
  pageEnd: number | null;
  unit: number | null;
  lesson: number | null;
  p0: number | null;
  p1: number | null;
}

/** Fisher-Yates + remapeo de la correcta. Sin shuffle, el sesgo de posición del
 *  modelo (tiende a poner la correcta en las primeras opciones) es explotable
 *  tras un par de pruebas. */
function shuffleOptions(options: string[], correct: number): { options: string[]; correct: number } {
  const idx = options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return {
    options: idx.map((i) => options[i]!),
    correct: idx.indexOf(correct),
  };
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const body = (await req.json()) as { subjectId?: string; subjectName?: string };
  const subjectId = body.subjectId;
  if (!subjectId) return Response.json({ error: "Falta subjectId" }, { status: 400 });

  const sql = getSql();
  // El material del currículo es global (user_id null), pero la guarda importa:
  // el día que un colegio suba libros propios, esto impide que cualquier alumno
  // autenticado lea material de otro pasando un uuid.
  const [visible] = await sql`
    select 1 from subjects where id = ${subjectId}::uuid
      and (user_id is null or user_id = ${auth.userId}::uuid)
      -- disabled_at acá y no solo en /api/subjects: esconder la materia de la
      -- lista no alcanza, porque el cliente puede tener el id de antes (pestaña
      -- vieja, historial). Desactivar tiene que impedir el uso, no solo la vista.
      and disabled_at is null`;
  if (!visible) return Response.json({ error: "Materia no disponible" }, { status: 404 });

  // `spread`: temas repartidos por TODO el libro, con jitter — cubre las cuatro
  // unidades y hace que cada intento traiga una prueba distinta (el modelo va a
  // temperatura 0: la variedad tiene que entrar por acá).
  const temas: PlanTopic[] = await getPlanTopics(subjectId, { limit: 6, spread: true });
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
            // más abajo se DESCARTA la pregunta si no trae 4 opciones o si
            // `correct` se sale del rango 0-3 (antes se clampeaba a 0: una
            // clave corrida pasaba la validación en silencio).
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
  } catch (e) {
    // Antes esto devolvía `items: []` con 200: una prueba vacía sin error, que
    // la UI mostraba como "no hay preguntas". Un fallo del modelo es un fallo.
    console.error(`[test] generación falló: ${e instanceof Error ? e.message : e}`);
    return Response.json(
      { error: "No pude armar la prueba ahora. Probá de nuevo en un momento." },
      { status: 503 },
    );
  }

  // Validación de FORMA: se descarta lo inválido, no se "arregla" en silencio.
  const candidatos = gen
    .map((q, i) => {
      const g = temas[i];
      if (!g) return null;
      if (!q.question?.trim() || !Array.isArray(q.options) || q.options.length !== 4) return null;
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) return null;
      return { q, g, i };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // VERIFICACIÓN DE LA CLAVE: el modelo responde la prueba A CIEGAS (sin ver la
  // clave declarada). Donde no coinciden, la pregunta se descarta: una clave
  // dudosa es peor que una pregunta menos. Si el verificador falla (red, 429),
  // la prueba sale igual — sin verificar es el comportamiento de antes.
  let verificados = candidatos;
  try {
    const vSchema = {
      type: "object", additionalProperties: false, required: ["answers"],
      properties: {
        answers: {
          type: "array",
          items: { type: "integer" },
        },
      },
    };
    const enunciado = candidatos
      .map(
        ({ q, g }, k) =>
          `Pregunta ${k + 1} (fragmento: ${g.sample.slice(0, 340)})\n${q.question}\n${q.options.map((o, j) => `${j}: ${o}`).join("\n")}`,
      )
      .join("\n\n");
    const v = await chatJSON<{ answers: number[] }>(
      [
        {
          role: "system",
          content:
            "Respondé esta prueba de opción múltiple usando SOLO el fragmento de material de cada pregunta. Devolvé JSON { answers: [...] } con el índice 0-3 de la opción correcta de cada pregunta, en orden. Si ninguna opción es correcta según el fragmento, devolvé -1 para esa pregunta.",
        },
        { role: "user", content: enunciado },
      ],
      vSchema,
      { maxTokens: 300 },
    );
    const respuestas = v.answers ?? [];
    verificados = candidatos.filter(({ q }, k) => respuestas[k] === q.correct);
    if (verificados.length < candidatos.length) {
      console.warn(
        `[test] clave no verificada en ${candidatos.length - verificados.length}/${candidatos.length} preguntas: descartadas`,
      );
    }
    // Si el verificador tachó casi todo, algo anda mal con el material o el
    // modelo: mejor avisar que servir una prueba de 1 pregunta.
    if (verificados.length < 2) {
      return Response.json(
        { error: "No pude armar una prueba confiable con este material. Probá de nuevo." },
        { status: 503 },
      );
    }
  } catch (e) {
    console.warn(`[test] verificador de clave no disponible (${e instanceof Error ? e.message : e}); la prueba sale sin verificar`);
  }

  // Shuffle de opciones + numeración final.
  const items: ItemPersistido[] = verificados.map(({ q, g }, k) => {
    const mezclado = shuffleOptions(q.options.map((o) => String(o)), q.correct);
    return {
      n: k + 1,
      // El título del índice es mejor fallback que "Unidad 1 · Lección 2".
      topic: q.topic?.trim() || g.title,
      question: q.question.trim(),
      options: mezclado.options,
      correct: mezclado.correct,
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
  });

  // La prueba completa (clave incluida) queda en `exams`; el intento del alumno
  // la referenciará. Un examen generado y nunca rendido no aparece en ningún
  // panel (todo consulta vía exam_attempts).
  const [ex] = await sql<{ id: string }[]>`
    insert into exams (user_id, subject_id, title, questions)
    values (${auth.userId}::uuid, ${subjectId}::uuid, ${"Simulación de prueba"},
            ${toJson(sql, items)}::jsonb)
    returning id`;

  // Al cliente: SIN `correct` ni `explain`. Se revelan en el submit.
  return Response.json({
    testId: ex!.id,
    items: items.map(({ correct: _c, explain: _e, ...rest }) => rest),
  });
}
