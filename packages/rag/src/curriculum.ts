/**
 * LOS PILARES: qué exige el Estado en cada tramo del libro.
 *
 * El camino del alumno sale del ÍNDICE del libro, y el índice no sabe nada del
 * currículum: pone al mismo nivel "Productos notables" —que el Estado evalúa—
 * y "¿Qué sabes?" —una página de diagnóstico—. Esto cruza una cosa con la otra
 * para poder destacar en el camino lo que de verdad se le va a exigir.
 *
 * ── Por qué se calcula al leer y no se guarda en el plan ─────────────────────
 * El plan vive cacheado en `subject_plans.items` y regenerarlo cuesta una
 * llamada al LLM por materia. Los pilares, en cambio, son dato DERIVADO de
 * `curriculum_map`, que se sigue corrigiendo. Guardarlos adentro del plan los
 * congelaría en el estado del mapa del día que se armó, y una corrección del
 * mapa no llegaría nunca a la pantalla. Calcular al vuelo cuesta una consulta.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 * No decide qué se puede saltar. Marcar una lección como salteable exige que el
 * marcado sea confiable en TODAS las materias, y hoy no lo es: medido el
 * 2026-08-20, Física 1º Medio engancha 3 de sus 88 lecciones y Matemática 5º
 * 6 de 100 — decirle a ese alumno que puede saltarse el resto sería falso.
 * Acá solo se destaca lo que sí está enganchado.
 */
import { getSql } from "@tutor-ia/db";

export interface Pilar {
  /** El conocimiento esencial, textual del currículum. */
  item: string;
  /** La asignatura del currículum EPJA (no la materia de la app). */
  asignatura: string;
  /** 'correcto' | 'parcial' | 'otro_año' — cuán bien lo cubre el libro. */
  cobertura: string;
}

interface Tramo extends Pilar {
  desde: number;
  hasta: number;
}

/**
 * Los tramos con exigencia curricular de una materia, listos para cruzar contra
 * los rangos de página del plan.
 *
 * Se toman los tramos de `curriculum_map_tramos` y no solo `curriculum_map`,
 * porque un conocimiento vive en varias partes del libro: "Operaciones con
 * racionales, potencias y raíces" son cuatro temas en cuatro páginas distintas.
 * Con el rango principal nada más, tres cuartos de sus lecciones quedaban sin
 * destacar.
 *
 * `otro_año` se excluye: ese contenido está en el tomo pero en la mitad del otro
 * curso, así que destacarlo en el camino de este alumno sería mandarlo a
 * estudiar lo que no le toca.
 */
export async function tramosCurriculares(subjectId: string): Promise<Tramo[]> {
  const sql = getSql();
  return await sql<Tramo[]>`
    select t.pagina_desde as desde,
           coalesce(t.pagina_hasta, t.pagina_desde) as hasta,
           cm.item, coalesce(cm.asignatura, '') as asignatura,
           cm.verificado as cobertura
    from curriculum_map cm
    join curriculum_map_tramos t on t.map_id = cm.id
    where cm.subject_id = ${subjectId}::uuid
      and cm.metodo = 'lector-v1'
      and cm.verificado in ('correcto', 'parcial')
      and t.pagina_desde is not null
    order by t.pagina_desde`;
}

/**
 * Qué conocimientos del currículum caen dentro de un rango de páginas.
 *
 * Solapamiento y no contención: una lección de las páginas 27-28 y un tramo
 * curricular de la 21 a la 43 se tocan, aunque ninguno contenga al otro. Pedir
 * contención dejaba sin marcar justo las lecciones de las unidades largas.
 */
export function pilaresDe(
  tramos: Tramo[],
  p0: number | null,
  p1: number | null,
): Pilar[] {
  if (p0 == null) return [];
  const hasta = p1 ?? p0;
  const vistos = new Set<string>();
  const out: Pilar[] = [];
  for (const t of tramos) {
    if (t.desde > hasta || t.hasta < p0) continue;
    if (vistos.has(t.item)) continue;
    vistos.add(t.item);
    out.push({ item: t.item, asignatura: t.asignatura, cobertura: t.cobertura });
  }
  return out;
}
