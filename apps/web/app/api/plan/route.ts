import { chatJSON, logDecision } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
// Titular el plan con el 7B (con recarga por keep_alive:0) puede tardar.
export const maxDuration = 120;

interface Group {
  unit: number | null;
  lesson: number | null;
  p0: number | null;
  p1: number | null;
  sample: string | null;
}

/**
 * POST /api/plan — arma un PLAN DE ESTUDIO fundamentado en el material.
 * body: { subjectId, subjectName? }
 *
 * La ESTRUCTURA (orden, cantidad, páginas) sale de la tabla de contenidos real
 * del libro (unidad/lección del corpus `content`). El LLM SOLO pone títulos y
 * la línea de "qué vas a aprender" a partir de un fragmento de muestra; no
 * inventa temas. Si la materia no tiene estructura, devuelve items: [].
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  await getCurrentUserId(req);
  const body = (await req.json()) as { subjectId?: string; subjectName?: string };
  const subjectId = body.subjectId;
  if (!subjectId) {
    return Response.json({ error: "Falta subjectId" }, { status: 400 });
  }

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

  // Preferir lecciones "limpias" (unidad + lección); las filas de resumen de
  // unidad (lección nula, rango de páginas enorme) y el material preliminar
  // (unidad nula) sólo se usan si no hay suficientes lecciones reales.
  const clean = rows.filter((r) => r.unit != null && r.lesson != null);
  const chosen = clean.length >= 3 ? clean : rows;

  if (chosen.length < 2) {
    logDecision({ route: "plan", abstained: true, cause: "no_structure", nCitable: rows.length, ms: Date.now() - t0 });
    return Response.json({ items: [] });
  }

  const genericTitle = (r: Group) =>
    r.unit != null && r.lesson != null ? `Unidad ${r.unit} · Lección ${r.lesson}`
      : r.unit != null ? `Unidad ${r.unit}`
        : `Lección ${r.lesson}`;

  // Índice real → el LLM solo titula (mismo orden y cantidad).
  const toc = chosen
    .map((r, i) => `${i + 1}. ${genericTitle(r)} (pág. ${r.p0}-${r.p1}): ${(r.sample ?? "").replace(/\s+/g, " ").slice(0, 320)}`)
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
          content: `Materia: ${body.subjectName ?? ""}\n\nÍndice del libro:\n${toc}\n\nDevolvé JSON { items: [{title, focus}, ...] } con EXACTAMENTE ${chosen.length} ítems, en el mismo orden.`,
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
      nCitable: chosen.length,
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
    nCitable: chosen.length,
    ms: Date.now() - t0,
  });

  const items = chosen.map((r, i) => ({
    n: i + 1,
    title: titled[i]?.title?.trim() || genericTitle(r),
    focus: titled[i]?.focus?.trim() || "",
    unit: r.unit,
    lesson: r.lesson,
    p0: r.p0,
    p1: r.p1,
  }));

  return Response.json({ items });
}
