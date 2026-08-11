/**
 * Lecturas de la API que usan varias páginas.
 *
 * Existe por un bug concreto: cinco lugares hacían
 *
 *     fetch("/api/subjects").then(r => r.json()).then(j => usar(j.subjects ?? j))
 *
 * y ese `?? j` es una trampa. Cuando la sesión vence, la ruta responde 401 con
 * `{ error: "No autenticado" }`: `j.subjects` es undefined, el `??` cae al
 * OBJETO DE ERROR, y lo que sigue hace `.map`/`.find` sobre algo que no es un
 * array. Reventaba con "subjects.map is not a function" en el onboarding, que
 * es la primera pantalla que ve alguien sin sesión — el peor lugar posible.
 *
 * El fallback razonable no es "lo que haya venido" sino LA LISTA VACÍA: una
 * pantalla sin materias se puede dibujar; un objeto de error, no.
 */
import type { Subject } from "./tipos";

/** Las materias del alumno. SIEMPRE un array, pase lo que pase. */
export async function traerMaterias(): Promise<Subject[]> {
  try {
    const r = await fetch("/api/subjects");
    if (!r.ok) return [];          // 401 y demás: sin materias que mostrar
    const j = (await r.json()) as { subjects?: unknown };
    return Array.isArray(j?.subjects) ? (j.subjects as Subject[]) : [];
  } catch {
    return [];                     // sin red
  }
}

/** Una materia por id, o `undefined` si no está (o si no hay sesión). */
export async function traerMateria(id: string): Promise<Subject | undefined> {
  return (await traerMaterias()).find((s) => s.id === id);
}
