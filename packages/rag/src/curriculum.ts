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
  /** De qué tomo son estas páginas. Ver `schema_curriculum_tramos_doc.sql`. */
  documentId: string | null;
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
           t.document_id as "documentId",
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
 *
 * ── Y DEL MISMO TOMO ────────────────────────────────────────────────────────
 * Comparar páginas de libros distintos no significa nada: cada tomo empieza en
 * su página 1. Mientras al camino solo entraban secciones del texto del
 * estudiante esto no se notaba; con los módulos EPJA adentro sí — el pilar
 * "Relación entre salud y enfermedad" apareció colgado de cinco unidades,
 * incluida "Estructura interna de la Tierra". 36 materias tienen más de un tomo.
 *
 * `documentId` null en el nodo (un plan viejo, cacheado antes de que el ítem lo
 * llevara) NO desactiva el filtro: se comparan igual, que es el comportamiento
 * de antes. Un tramo sin tomo, en cambio, no existe: la migración los llenó
 * todos.
 */
export function pilaresDe(
  tramos: Tramo[],
  p0: number | null,
  p1: number | null,
  documentId?: string | null,
): Pilar[] {
  if (p0 == null) return [];
  const hasta = p1 ?? p0;
  const vistos = new Set<string>();
  const out: Pilar[] = [];
  for (const t of tramos) {
    if (documentId && t.documentId && t.documentId !== documentId) continue;
    if (t.desde > hasta || t.hasta < p0) continue;
    if (vistos.has(t.item)) continue;
    vistos.add(t.item);
    out.push({ item: t.item, asignatura: t.asignatura, cobertura: t.cobertura });
  }
  return out;
}

/**
 * Un conocimiento que el Estado exige y el libro del alumno NO enseña.
 *
 * Existe porque `pilaresDe` solo puede destacar lo que el libro sí trae, y así
 * el hueco es INVISIBLE: el alumno recorre su camino entero sin enterarse de que
 * hay algo que le van a exigir y que su tomo no cubre.
 */
export interface Pendiente {
  item: string;
  asignatura: string;
  /** 'no_esta' | 'otro_año' */
  motivo: string;
  /** Dónde SÍ está, si algún otro libro del corpus lo cubre. */
  enHermana: {
    materia: string;
    /** El TOMO concreto (título del documento), cuando se conoce. Sin esto la
     *  página miente: "Física 1º Medio p.17" era la p.17 del Módulo 6 EPJA. */
    tomo: string | null;
    paginaDesde: number | null;
    /**
     *   'materia'      otra materia del MISMO curso (Física → Química)
     *   'curso_vecino' el otro año del MISMO nivel EPJA (1º → 2º Medio)
     *   'otro_nivel'   la misma asignatura en otro nivel (7º → 6º)
     */
    donde: "materia" | "curso_vecino" | "otro_nivel";
    /** true = esa ubicación NO desarrolla el ítem completo (veredicto parcial,
     *  o quedan componentes sin destino). El consumidor dice "está a medias en…"
     *  y NUNCA "ya lo tiene, no hay nada que conseguir". */
    aMedias: boolean;
  } | null;
  /** Los componentes faltantes viven en varios tomos distintos: un puntero
   *  único mentiría. El consumidor muestra el checklist por componente. */
  repartido: boolean;
}

interface CompCobertura {
  c: string; ok: boolean; pag: number | null;
  en?: { materia: string; doc?: string | null; pag: number | null };
}

/**
 * Lo que le van a exigir a este alumno y su libro no trae, con el puntero de
 * dónde sí está DERIVADO DE LOS COMPONENTES, no de otra tubería.
 *
 * ── El bug que esta derivación reemplaza ────────────────────────────────────
 * La cabecera salía del pagina_desde a nivel ítem de la fila hermana del mapa,
 * y los punteros por componente salían de buscar-componentes: dos tuberías que
 * nunca se cruzaron. Revisadas las 8 entradas del informe que tenían cabecera y
 * desglose: las 8 se contradecían (0 coincidencias). Y encima la cabecera
 * imprimía la MATERIA con la página de un MÓDULO EPJA colgado de ella —
 * "Física 1º Medio p.17" era el Módulo 6 de reproducción y herencia—, y
 * admitía como destino ubicaciones marcadas parcial para el mismo ítem
 * ("Biodiversidad… ya lo tiene — CN 6º p.81" cuando esa página figura
 * incompleta dos pantallas más arriba).
 *
 * ── La regla, determinista y en código ──────────────────────────────────────
 *  1. Si el ítem tiene cobertura por componentes con destinos anotados:
 *     · todos los componentes faltantes apuntan al MISMO tomo → ese tomo,
 *       página más baja;
 *     · repartidos en varios tomos → sin puntero único (repartido: true), el
 *       consumidor muestra el checklist;
 *     · si el destino está marcado parcial para este ítem, o quedan
 *       componentes sin destino → aMedias: true.
 *  2. Sin cobertura (niveles sin programa publicado): la búsqueda por filas
 *     hermanas de siempre, con dos arreglos — el veredicto se rankea explícito
 *     (nada de confiar en el orden alfabético de un text), el tomo sale de
 *     document_id, y parcial se marca aMedias en vez de venderse como completo.
 *
 * No se usa el LLM: la información correcta ya está en la base, y esto tiene
 * que ser reproducible — el bug se encontró con una consulta.
 */
export async function pendientesDe(subjectId: string): Promise<Pendiente[]> {
  const sql = getSql();

  const faltan = await sql<{
    item: string; asignatura: string; motivo: string; cobertura: CompCobertura[] | null;
  }[]>`
    select cm.item, coalesce(cm.asignatura, '') asignatura, cm.verificado motivo,
           cm.componentes_cobertura cobertura
    from curriculum_map cm
    where cm.subject_id = ${subjectId}::uuid
      and cm.metodo = 'lector-v1'
      and cm.verificado in ('no_esta', 'otro_año')
    order by cm.item`;
  if (faltan.length === 0) return [];

  // Filas hermanas: el fallback, y también el veredicto del destino para aMedias.
  const hermanas = await sql<{
    item: string; materia: string; verificado: string; pagina_desde: number | null;
    tomo: string | null; donde: string; rango: number;
  }[]>`
    with yo as (
      select s.id, s.area, s.family,
             (select max(d.grade) from documents d where d.subject_id = s.id) curso
      from subjects s where s.id = ${subjectId}::uuid
    )
    select cm.item, s.name materia, cm.verificado, cm.pagina_desde,
           (select d.title from documents d where d.id = cm.document_id) tomo,
           case
             when (select max(d.grade) from documents d where d.subject_id = s.id) = yo.curso
               then 'materia'
             when nivel_epja((select max(d.grade) from documents d where d.subject_id = s.id))
                  = nivel_epja(yo.curso)
               then 'curso_vecino'
             else 'otro_nivel'
           end donde,
           case
             when (select max(d.grade) from documents d where d.subject_id = s.id) = yo.curso then 1
             when nivel_epja((select max(d.grade) from documents d where d.subject_id = s.id))
                  = nivel_epja(yo.curso) then 2
             else 3
           end rango
    from curriculum_map cm
    join subjects s on s.id = cm.subject_id
    join yo on s.id <> yo.id
    where cm.metodo = 'lector-v1'
      and cm.verificado in ('correcto', 'parcial')
      and s.disabled_at is null
      and (s.area = yo.area or s.family = yo.family)`;

  const veredictoDe = (item: string, materia: string): string | null =>
    hermanas.find((h) => h.item === item && h.materia === materia)?.verificado ?? null;
  const dondeDe = (item: string, materia: string): "materia" | "curso_vecino" | "otro_nivel" => {
    const h = hermanas.find((x) => x.item === item && x.materia === materia);
    return (h?.donde as "materia" | "curso_vecino" | "otro_nivel") ?? "otro_nivel";
  };

  const out: Pendiente[] = [];
  for (const f of faltan) {
    const faltantes = (f.cobertura ?? []).filter((x) => !x.ok);
    const conDestino = faltantes.filter((x) => x.en);

    if (conDestino.length > 0) {
      // ── Derivado de los componentes ──
      const llaves = new Set(conDestino.map((x) => `${x.en!.materia}|${x.en!.doc ?? ""}`));
      if (llaves.size > 1) {
        out.push({ item: f.item, asignatura: f.asignatura, motivo: f.motivo,
          enHermana: null, repartido: true });
        continue;
      }
      const materia = conDestino[0]!.en!.materia;
      const tomo = conDestino[0]!.en!.doc ?? null;
      const pags = conDestino.map((x) => x.en!.pag).filter((p): p is number => p != null);
      const aMedias = veredictoDe(f.item, materia) === "parcial"
        || conDestino.length < faltantes.length;
      out.push({ item: f.item, asignatura: f.asignatura, motivo: f.motivo,
        enHermana: { materia, tomo, paginaDesde: pags.length ? Math.min(...pags) : null,
          donde: dondeDe(f.item, materia), aMedias },
        repartido: false });
      continue;
    }

    // ── Fallback sin cobertura: la mejor hermana, con rankeo explícito ──
    const cands = hermanas.filter((h) => h.item === f.item)
      .sort((a, b) => a.rango - b.rango
        || (a.verificado === "correcto" ? 0 : 1) - (b.verificado === "correcto" ? 0 : 1)
        || (a.pagina_desde ?? 1e9) - (b.pagina_desde ?? 1e9));
    const h = cands[0];
    out.push({ item: f.item, asignatura: f.asignatura, motivo: f.motivo,
      enHermana: h ? { materia: h.materia, tomo: h.tomo, paginaDesde: h.pagina_desde,
        donde: h.donde as "materia" | "curso_vecino" | "otro_nivel",
        aMedias: h.verificado === "parcial" } : null,
      repartido: false });
  }
  out.sort((a, b) => Number(b.enHermana === null && !b.repartido) - Number(a.enHermana === null && !a.repartido)
    || a.item.localeCompare(b.item));
  return out;
}