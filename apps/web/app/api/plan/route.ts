import { chatJSON, logDecision } from "@tutor-ia/core";
import { getPlanTopics, type PlanTopic } from "@tutor-ia/rag";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
// Titular el plan con el 7B (con recarga por keep_alive:0) puede tardar.
export const maxDuration = 120;

/**
 * POST /api/plan — arma un PLAN DE ESTUDIO fundamentado en el material.
 * body: { subjectId, subjectName? }
 *
 * La ESTRUCTURA (orden, títulos, páginas) sale del ÍNDICE REAL del libro, vía
 * `getPlanTopics` — la misma fuente que usa /api/test. El LLM SOLO reescribe el
 * título para que sea corto y motivador y agrega la línea de "qué vas a
 * aprender"; no inventa temas ni decide el orden.
 *
 * Antes esto agrupaba por `chunks.unit/lesson`, metadata rota que producía temas
 * como "Organización del texto de estudio · pág. 8-138". Si el libro no tiene un
 * índice legible ni grupos sanos, devuelve items: [] — un plan equivocado es
 * peor que ninguno, porque el alumno estudia lo que no es.
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  await getCurrentUserId(req);
  const body = (await req.json()) as { subjectId?: string; subjectName?: string };
  const subjectId = body.subjectId;
  if (!subjectId) {
    return Response.json({ error: "Falta subjectId" }, { status: 400 });
  }

  const temas: PlanTopic[] = await getPlanTopics(subjectId, { limit: 14 });
  if (temas.length < 2) {
    logDecision({ route: "plan", abstained: true, cause: "no_structure", nCitable: temas.length, ms: Date.now() - t0 });
    return Response.json({ items: [] });
  }

  // Índice REAL que ve el LLM: el título del libro + una muestra del contenido
  // de esas páginas exactas.
  const toc = temas
    .map((t, i) => `${i + 1}. ${t.title} (pág. ${t.pageStart}-${t.pageEnd}): ${t.sample.slice(0, 320)}`)
    .join("\n");

  const schema = {
    type: "object", additionalProperties: false, required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["title", "focus"],
          properties: { title: { type: "string" }, focus: { type: "string" } },
        },
      },
    },
  };

  let titled: { title: string; focus: string }[] = [];
  try {
    const out = await chatJSON<{ items: { title: string; focus: string }[] }>(
      [
        {
          role: "system",
          content:
            "Sos un profesor que arma un plan de estudio para un alumno de secundaria en Chile. Te paso el ÍNDICE REAL del libro por unidad y lección, con un fragmento de muestra de cada una. Para CADA lección, en el MISMO orden y cantidad, escribí: un título claro y motivador (máx 6 palabras, sin la palabra 'Unidad' ni 'Lección' ni números) y una línea de 'qué vas a aprender' (máx 14 palabras). Basate SOLO en el fragmento; no inventes temas que no aparezcan. Escribí en español de Chile.",
        },
        {
          role: "user",
          content: `Materia: ${body.subjectName ?? ""}\n\nÍndice del libro:\n${toc}\n\nDevolvé JSON { items: [{title, focus}, ...] } con EXACTAMENTE ${temas.length} ítems, en el mismo orden.`,
        },
      ],
      schema,
      { maxTokens: 900 },
    );
    titled = out.items ?? [];
  } catch (err) {
    // NO se traga el error. Antes este catch devolvía 200 con títulos genéricos
    // ("Unidad 1 · Lección 2") cuando el LLM fallaba, y eso se ve EXACTAMENTE
    // igual que un plan mal generado: el alumno recibía un plan mecánico y
    // nadie se enteraba de que el proveedor había caído.
    logDecision({
      route: "plan",
      abstained: true,
      cause: "plan_llm_failed",
      nCitable: temas.length,
      ms: Date.now() - t0,
    });
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `No pude armar el plan: falló la generación de títulos. ${msg}` },
      { status: 502 },
    );
  }
  // Llegar acá ya implica que el LLM tituló: si hubiera fallado, el catch de
  // arriba devolvió 502 y no seguimos.
  logDecision({
    route: "plan",
    abstained: false,
    cause: "answered",
    nCitable: temas.length,
    ms: Date.now() - t0,
  });

  const items = temas.map((t, i) => ({
    n: i + 1,
    // Si el LLM devolvió menos ítems de los pedidos, el título del índice es un
    // fallback mucho mejor que "Unidad 1 · Lección 2": ya es el título real.
    title: titled[i]?.title?.trim() || t.title,
    focus: titled[i]?.focus?.trim() || "",
    // Identidad estable del tema (sobrevive al rebuild de las secciones).
    key: t.key,
    documentId: t.documentId,
    pageStart: t.pageStart,
    pageEnd: t.pageEnd,
    // Retrocompatibles: el estudio dirigido sigue usando unit/lesson por ahora.
    unit: t.unitNo,
    lesson: t.lessonNo,
    p0: t.pageStart,
    p1: t.pageEnd,
  }));

  return Response.json({ items });
}
