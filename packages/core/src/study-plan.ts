/**
 * ARMADO DEL PLAN DE ESTUDIO — la fuente única.
 *
 * Vivía dentro de `apps/web/app/api/plan/route.ts`, que estaba bien mientras el
 * único que armaba planes era un alumno apretando un botón. Ahora también los
 * pre-genera el CLI (`admin plans`), y dos copias de este prompt divergirían: el
 * plan que el colegio deja cacheado la noche anterior tiene que ser exactamente
 * el mismo que el que se arma en vivo, o el alumno recibe uno u otro según quién
 * llegó primero.
 *
 * Acá NO se persiste: `buildStudyPlan` devuelve los ítems y quien llama decide
 * qué hacer con ellos (la ruta cachea y responde; el CLI cachea y sigue).
 */
import { chatJSON } from "./client";
import { getPlanTopics, type PlanTopic } from "@tutor-ia/rag";

/** Lecciones que entran en un plan. Igual que el límite de `getPlanTopics`. */
export const PLAN_LIMIT = 14;

/** Cuántos puntos clave se muestran por lección. Más que esto deja de ser un
 *  resumen y pasa a ser la lección otra vez. */
const MAX_PUNTOS = 3;

/**
 * Se genera EN TANDAS de a pocas lecciones, no las 14 de una.
 *
 * Con solo título + línea, una sola llamada para 14 ítems andaba. Sumar tres
 * puntos clave por lección triplica lo que el modelo tiene que sostener a la
 * vez, y un 7B con 14 ítems × 5 campos empieza a acortar, a repetir el título
 * como punto y a perder el orden. En tandas de 5 cada llamada es chica y el
 * resultado se mantiene parejo de la primera lección a la última.
 */
const TANDA = 5;

export interface PlanItem {
  n: number;
  /** Identidad estable del tema: sobrevive al rebuild de las secciones. */
  key: string;
  title: string;
  focus: string;
  /** Qué tenés que poder explicar cuando termines esa lección. Puede venir
   *  vacío si el fragmento no daba para nada concreto. */
  points: string[];
  documentId: string;
  pageStart: number;
  pageEnd: number;
  unit: number | null;
  lesson: number | null;
  /** Retrocompatibles: el estudio dirigido sigue usando unit/lesson y p0/p1. */
  p0: number;
  p1: number;
}

/** Sin acentos, sin puntuación y en minúsculas: para comparar, no para mostrar. */
const norm = (s: string) =>
  // `\p{Diacritic}` y no un rango literal: ese rango en el fuente son caracteres
  // INVISIBLES que cualquier editor puede comerse sin que se note.
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Un punto clave que no dice nada. El modelo, cuando el fragmento no le alcanza,
 * rellena con estas fórmulas — y un plan lleno de "comprender los conceptos
 * principales" se ve igual de completo que uno bueno, que es justamente lo que
 * lo hace peligroso: el alumno cree que tiene una guía y no tiene ninguna.
 */
const VACIOS = [
  /^(comprender|entender|conocer|aprender|estudiar|repasar|analizar|identificar|reconocer)( el| la| los| las| sobre)?( tema| unidad| leccion| capitulo| contenido)/,
  /conceptos (importantes|principales|clave|basicos|fundamentales)$/,
  /(temas|contenidos|ideas) (importantes|principales|clave|centrales)$/,
  /^(introduccion|repaso|resumen|conclusion)( general| del tema| de la unidad)?$/,
  /lo (mas )?importante (del tema|de la leccion|de la unidad)/,
];

/**
 * Deja los puntos que aportan algo, hasta `MAX_PUNTOS`.
 *
 * Descarta tres cosas: los vacíos de la lista de arriba, los que son el título
 * dicho de nuevo (el modelo cae mucho en eso y ocupa un renglón sin sumar), y
 * los de una o dos palabras, que nunca son un punto de estudio.
 *
 * Exportada para poder probarla sin base ni modelo.
 */
export function limpiarPuntos(puntos: string[] | undefined, titulo: string): string[] {
  if (!Array.isArray(puntos)) return [];
  const t = norm(titulo);
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const raw of puntos) {
    const p = (raw ?? "").replace(/\s+/g, " ").trim().replace(/^[-•·*]\s*/, "");
    const n = norm(p);
    if (!n || n.split(" ").length < 3) continue;
    if (VACIOS.some((re) => re.test(n))) continue;
    if (t && (n === t || n.includes(t) || t.includes(n))) continue;
    if (vistos.has(n)) continue;
    vistos.add(n);
    out.push(p);
    if (out.length === MAX_PUNTOS) break;
  }
  return out;
}

const SISTEMA =
  "Sos un profesor que arma un plan de estudio para un alumno de secundaria en Chile. " +
  "Te paso lecciones REALES del libro, cada una con fragmentos tomados a lo largo de sus páginas. " +
  "Para CADA lección, en el MISMO orden y cantidad, escribí:\n" +
  "- title: claro y motivador, máx 6 palabras, sin las palabras 'Unidad' ni 'Lección' ni números.\n" +
  "- focus: una línea de 'qué vas a aprender', máx 14 palabras.\n" +
  "- points: 3 PUNTOS CLAVE de esa lección. Cada punto es UNA cosa concreta que el alumno " +
  "tiene que poder explicar o hacer cuando termine: un concepto con su nombre, una distinción, " +
  "un procedimiento, una relación causa-efecto. Máx 12 palabras cada uno.\n" +
  "REGLAS DE LOS PUNTOS: usá los términos que aparecen en el fragmento (si dice 'variable dependiente', " +
  "escribí 'variable dependiente'). NO repitas el título con otras palabras. NO escribas puntos vagos " +
  "tipo 'entender el tema', 'conocer conceptos importantes' o 'aprender sobre la unidad'. " +
  "Si el fragmento no alcanza para tres puntos concretos, devolvé menos: es mejor dos buenos que tres inventados. " +
  "Escribí en español de Chile.";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "focus", "points"],
        properties: {
          title: { type: "string" },
          focus: { type: "string" },
          points: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

interface ItemLLM { title: string; focus: string; points?: string[] }

/** El libro no tiene un índice del que se pueda sacar un plan creíble. */
export class SinEstructura extends Error {
  constructor(public temas: number) {
    super(`El libro no dio suficientes lecciones legibles (${temas}).`);
    this.name = "SinEstructura";
  }
}

/**
 * Arma el plan de una materia. Tira `SinEstructura` si el libro no da para uno,
 * y propaga el error del LLM si falla.
 *
 * NO devuelve un plan mecánico ante un fallo: un plan equivocado se ve igual que
 * uno bueno, y el alumno termina estudiando lo que no es.
 */
export async function buildStudyPlan(
  subjectId: string,
  subjectName?: string | null,
): Promise<PlanItem[]> {
  const temas: PlanTopic[] = await getPlanTopics(subjectId, { limit: PLAN_LIMIT });
  if (temas.length < 2) throw new SinEstructura(temas.length);

  const titled: ItemLLM[] = [];
  for (let desde = 0; desde < temas.length; desde += TANDA) {
    const lote = temas.slice(desde, desde + TANDA);
    const toc = lote
      .map((t, i) => `${i + 1}. ${t.title} (pág. ${t.pageStart}-${t.pageEnd}): ${t.sample.slice(0, 900)}`)
      .join("\n\n");

    const out = await chatJSON<{ items: ItemLLM[] }>(
      [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content: `Materia: ${subjectName ?? ""}\n\nLecciones del libro:\n${toc}\n\nDevolvé JSON { items: [{title, focus, points}, ...] } con EXACTAMENTE ${lote.length} ítems, en el mismo orden.`,
        },
      ],
      SCHEMA,
      { maxTokens: 1400 },
    );
    // Si una tanda devuelve de menos, se rellena para que los índices sigan
    // alineados con `temas` y el fallback por ítem haga su trabajo.
    const recibidos = out.items ?? [];
    for (let i = 0; i < lote.length; i++) titled.push(recibidos[i] ?? { title: "", focus: "" });
  }

  return temas.map((t, i) => ({
    n: i + 1,
    // Si el LLM devolvió menos ítems de los pedidos, el título del índice es un
    // fallback mucho mejor que "Unidad 1 · Lección 2": ya es el título real.
    title: titled[i]?.title?.trim() || t.title,
    focus: titled[i]?.focus?.trim() || "",
    points: limpiarPuntos(titled[i]?.points, titled[i]?.title ?? t.title),
    key: t.key,
    documentId: t.documentId,
    pageStart: t.pageStart,
    pageEnd: t.pageEnd,
    unit: t.unitNo,
    lesson: t.lessonNo,
    p0: t.pageStart,
    p1: t.pageEnd,
  }));
}
