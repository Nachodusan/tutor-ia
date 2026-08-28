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
/**
 * ¿El turno pisa un conocimiento esencial LOCAL (la respuesta depende de Chile)?
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * "Sin material" sobre energía mecánica y "sin material" sobre biodiversidad
 * chilena son riesgos distintos: el modelo sabe la primera de sobra y la
 * segunda la inventa con confianza. Y la red no cubre ahí: la NLI verifica
 * contra el citable, y en modo general no hay citable. Esta señal se conoce
 * ANTES de generar y sale del currículum (curriculum_map.local, lista cerrada
 * en schema_curriculum_local.sql), no de los veredictos — es un eje separado
 * del modo, a propósito, para poder medirlos por separado.
 *
 * ── Cómo resuelve ───────────────────────────────────────────────────────────
 * Por los chunks del turno: citables si hay; si el gate cortó (modo general),
 * los del ranking crudo — el tema se conoce aunque el material no alcance.
 * El chunk lleva su documento y páginas en la base, y eso se cruza contra los
 * tramos de los ítems locales (mismo documento + solape de páginas). Gana el
 * ítem con más chunks encima.
 */
export async function temaLocalDe(chunkIds: string[]): Promise<{ item: string } | null> {
  if (chunkIds.length === 0) return null;
  const sql = getSql();
  const filas = await sql<{ item: string; n: number }[]>`
    select cm.item, count(*)::int n
    from chunks c
    join curriculum_map_tramos t
      on t.document_id = c.document_id
     and t.pagina_desde <= coalesce(c.page_end, c.page_start)
     and coalesce(t.pagina_hasta, t.pagina_desde) >= c.page_start
    join curriculum_map cm on cm.id = t.map_id
    where c.id = any(${chunkIds}::uuid[])
      and cm.metodo = 'lector-v1'
      and cm.local
    group by cm.item
    order by n desc
    limit 1`;
  return filas[0] ? { item: filas[0].item } : null;
}

/**
 * Respaldo de temaLocalDe PARA EL MODO GENERAL: ¿la PREGUNTA pisa un ítem local?
 *
 * ── El agujero que tapa, encontrado probando ────────────────────────────────
 * La resolución por chunks falla justo en el caso peligroso: si el tema local
 * no tiene material en la materia, los chunks del ranking no pisan ningún tramo
 * y temaLocalDe devuelve null. Probado en vivo el 2026-08-25: "¿cómo explicaban
 * los mapuches la creación del universo?" en Física 1º Medio salió modo general
 * con temaLocal null, y el modelo afirmó particulares culturales con confianza
 * y sin advertencia — exactamente lo que la marca existe para impedir.
 *
 * ── Cómo ───────────────────────────────────────────────────────────────────
 * Reranker (el sidecar de siempre, sin LLM): la pregunta contra los ~20 textos
 * de ítems locales, umbral 0,15. Calibrado con 11 sondas: los universales dan
 * ≤ 0,002 ("fotosíntesis", "ecuación cuadrática", "Revolución Francesa",
 * charla), los locales que matchean dan ≥ 0,28. Margen de sobra.
 *
 * ── Límite conocido ─────────────────────────────────────────────────────────
 * Se escapa la pregunta cuyo léxico no toca el texto normativo del ítem:
 * "¿qué es la UF?" (el ítem dice "índices económicos") y "¿quiénes fueron los
 * presidentes del siglo XIX?" (el ítem habla de "desarrollo político") dieron
 * 0,000 y 0,007. Si hace falta cerrar eso, el camino es agregar SEÑAS escritas
 * a mano por ítem en schema_curriculum_local.sql — no bajar el umbral, que
 * hoy no produce ni un falso positivo.
 */
let cacheItemsLocales: { items: string[]; en: number } | null = null;

export async function temaLocalPorPregunta(pregunta: string): Promise<{ item: string } | null> {
  if (pregunta.trim().length < 8) return null;
  const ahora = Date.now();
  if (!cacheItemsLocales || ahora - cacheItemsLocales.en > 5 * 60_000) {
    const sql = getSql();
    const filas = await sql<{ item: string }[]>`
      select distinct item from curriculum_map where metodo = 'lector-v1' and local`;
    cacheItemsLocales = { items: filas.map((f) => f.item), en: ahora };
  }
  const items = cacheItemsLocales.items;
  if (items.length === 0) return null;
  const { rerank } = await import("./rerank");
  const scores = await rerank(pregunta, items);
  let mejor = -1, mejorScore = 0;
  for (let i = 0; i < scores.length; i++) {
    if ((scores[i] ?? 0) > mejorScore) { mejorScore = scores[i]!; mejor = i; }
  }
  return mejorScore >= 0.15 ? { item: items[mejor]! } : null;
}

/** Un conocimiento del programa que el libro NO desarrolla del todo, listo para
 *  ser una parada del camino. Ver `programaPendienteDe`. */
export interface ParadaPendiente {
  item: string;
  /** 'no_esta' · 'otro_año' · 'parcial' */
  estado: string;
  /** Clave estable para el progreso. No colisiona con las de `book_sections`
   *  (que son hash de documento+ord+título) porque lleva prefijo propio. */
  key: string;
  /** Dónde SÍ está, derivado de los componentes. Ver `pendientesDe`. */
  enHermana: Pendiente["enHermana"];
  repartido: boolean;
  /** Los componentes oficiales que faltan, para que la parada diga QUÉ falta. */
  faltan: string[];
}

/**
 * EL PROGRAMA COMPLETO como paradas: todo lo que el Estado exige y este libro no
 * desarrolla del todo.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 * Hasta ahora el camino era EL LIBRO con lo exigido marcado encima: lo que el
 * libro no traía vivía en un bloque al final, fuera del recorrido. Eso deja al
 * alumno recorriendo un camino que se siente completo mientras le falta parte
 * del programa. Ahora esos conocimientos son PARADAS: se ven, se cuentan y se
 * pueden abrir.
 *
 * ── Qué NO hace ────────────────────────────────────────────────────────────
 * No les inventa páginas ni los intercala entre las lecciones del libro. No
 * están en este tomo: meterlos en la secuencia del índice sería fingir que sí.
 * Van al final, en su propia unidad, con la etiqueta de por qué están ahí.
 *
 * `correcto` no aparece: eso ya está en el camino, marcado como pilar sobre la
 * lección que lo enseña.
 */
export async function programaPendienteDe(subjectId: string): Promise<ParadaPendiente[]> {
  const sql = getSql();
  const filas = await sql<{
    item: string; verificado: string; cobertura: CompCobertura[] | null;
  }[]>`
    select cm.item, cm.verificado, cm.componentes_cobertura cobertura
    from curriculum_map cm
    where cm.subject_id = ${subjectId}::uuid
      and cm.metodo = 'lector-v1'
      and cm.verificado in ('no_esta', 'otro_año', 'parcial')
      -- ⚠️ LO QUE YA ESTÁ ARRIBA EN EL CAMINO NO SE REPITE ACÁ.
      --
      -- Medido el 2026-08-27: de 112 paradas de esta unidad, 63 tenían tramos
      -- que caen sobre lecciones REALES del camino, o sea que ya se muestran
      -- como chapa de pilar sobre esas lecciones. No era solo repetirse: era
      -- CONTRADECIRSE. En Biología, "Evolución" aparecía marcado sobre SEIS
      -- lecciones ("¿Como cambian las poblaciones en la naturaleza?"...) y al
      -- mismo tiempo al final, bajo el titulo "Lo que el programa pide y tu
      -- libro no cubre". El libro lo cubre: por eso está arriba.
      --
      -- El criterio es EL MISMO que dibuja las chapas (tramosCurriculares +
      -- pilaresDe): verificado in (correcto, parcial), solapamiento de páginas y
      -- DEL MISMO TOMO. Si cambia allá, cambia acá — dos criterios distintos
      -- para "¿está en el camino?" es como se vuelve a duplicar.
      --
      -- otro_año NO entra en el filtro a propósito: tramosCurriculares lo
      -- excluye, así que no se dibuja como chapa y sacarlo de acá lo haría
      -- desaparecer del producto.
      -- ⚠️ ACÁ HUBO UN FILTRO ANTI-DUPLICADOS Y SE REVIRTIÓ. NO LO REPONGAS
      -- SIN LEER ESTO.
      --
      -- El problema es real: un conocimiento 'parcial' se dibuja DOS veces en el
      -- camino — como chapa de pilar sobre las lecciones que lo cubren
      -- (tramosCurriculares toma correcto+parcial) y como parada acá
      -- (no_esta+otro_año+parcial). 'parcial' cae en las dos listas porque
      -- "a medias" es legítimamente ambas cosas, y nadie decidió a quién le tocaba.
      --
      -- Pero el filtro que sacaba las 'parcial' ya cubiertas por una lección
      -- BORRABA CONTENIDO. Se repetía el TÍTULO, no el contenido: la chapa
      -- ETIQUETA una lección del libro, la parada ES una parada con apunte propio
      -- armado de VARIOS tomos. "Evolución" en Biología 1º tiene 8 componentes:
      -- 3 en su libro (los de la chapa) y 5 en Biología 2º y un módulo EPJA.
      --
      -- La segunda versión sumó "…y que no tenga componentes en otro libro", y
      -- también falló, por una razón más difícil de ver: MEDIDO, 37 de las 39
      -- filas que seguía sacando tienen componentes_cobertura NULL — nunca pasaron
      -- por buscar-componentes— y su mismo ítem aparece con páginas en libros que
      -- esa materia no tiene. El filtro leía "sin componentes anotados" como "no
      -- aporta nada", cuando era "nadie lo midió todavía". Ausencia de dato no es
      -- evidencia de ausencia.
      --
      -- PARA REPONERLO HAY QUE MEDIR PRIMERO:
      --   pnpm --filter @tutor-ia/eval buscar-componentes --aplicar
      -- y recién con componentes_cobertura lleno decidir. Mientras tanto, un
      -- título repetido es un costo menor que quitarle al alumno la única puerta
      -- que tiene al material de sus otros libros.
    order by
      case cm.verificado when 'no_esta' then 0 when 'otro_año' then 1 else 2 end,
      cm.item`;
  if (filas.length === 0) return [];

  // El puntero derivado ya lo calcula `pendientesDe` para no_esta/otro_año; para
  // `parcial` el destino sale de los componentes con la misma regla.
  const pend = await pendientesDe(subjectId);
  const porItem = new Map(pend.map((p) => [p.item, p]));

  return filas.map((f) => {
    const p = porItem.get(f.item);
    const faltantes = (f.cobertura ?? []).filter((x) => !x.ok);
    let enHermana = p?.enHermana ?? null;
    let repartido = p?.repartido ?? false;
    if (!p && faltantes.length) {
      // Fila `parcial`: misma derivación que en pendientesDe, sin repetir la
      // consulta de hermanas — el destino vive en los propios componentes.
      const conDestino = faltantes.filter((x) => x.en);
      const llaves = new Set(conDestino.map((x) => `${x.en!.materia}|${x.en!.doc ?? ""}`));
      if (llaves.size > 1) repartido = true;
      else if (conDestino.length) {
        const pags = conDestino.map((x) => x.en!.pag).filter((n): n is number => n != null);
        enHermana = {
          materia: conDestino[0]!.en!.materia,
          tomo: conDestino[0]!.en!.doc ?? null,
          paginaDesde: pags.length ? Math.min(...pags) : null,
          donde: "otro_nivel",
          // Un `parcial` siempre está a medias por definición.
          aMedias: true,
        };
      }
    }
    return {
      item: f.item,
      estado: f.verificado,
      key: claveParada(subjectId, f.item),
      enHermana,
      repartido,
      faltan: faltantes.map((x) => x.c),
    };
  });
}

/** Clave de progreso de una parada del programa. Prefijo `p` + hash, para no
 *  colisionar con las claves `s…` de `book_sections`. */
function claveParada(subjectId: string, item: string): string {
  const base = `${subjectId}|${item}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0;
  return `p${(h >>> 0).toString(36)}`;
}

/** Un fragmento de material para una parada del PROGRAMA, con su tomo a la vista. */
export interface FragmentoParada {
  content: string;
  page: number | null;
  /** El TÍTULO del documento. Va SIEMPRE, aunque sea el libro propio. */
  libro: string;
  /** Qué componente del currículum lo trajo. Para poder declarar la cobertura. */
  componente: string;
}

/**
 * EL MATERIAL DE UNA PARADA DEL PROGRAMA, juntado de todos los libros del alumno.
 *
 * ── Por qué esta función existe aparte de `fetchLessonMaterial` ─────────────
 * Una lección normal es UN rango de páginas de UN tomo, y con eso alcanza. Una
 * parada del programa es un conocimiento del currículum que el libro de la
 * materia NO cubre entero: sus componentes están repartidos entre el libro
 * propio y otros libros del alumno (medido: de 43 paradas, 21 tienen TODO su
 * material y 18 la mayor parte). Traerlo es juntar N pedacitos de N tomos.
 *
 * ⚠️ CADA FRAGMENTO SE LLEVA SU TOMO, y no es un adorno: cada libro empieza en
 * su página 1, así que una cita "pág. 181" sin decir de cuál manda a leer
 * cualquier cosa. Es el mismo error que produjo los 158 pilares falsos (§8.5) y
 * el puntero de §9.4 —"Física 1º Medio p.17" que era la p.17 de un módulo EPJA
 * colgado de esa materia—. Acá el riesgo es mayor porque el material viene de
 * varios tomos SIEMPRE, no por accidente.
 *
 * El destino de cada componente ya está resuelto y guardado por
 * `buscar-componentes`; esto NO vuelve a buscar. Si un componente no tiene
 * material, no aparece: el que llama sabe qué falta mirando `componentes_cobertura`.
 */
export async function materialDeParada(
  subjectId: string,
  item: string,
  opts: { radioPaginas?: number; topePorComponente?: number } = {},
): Promise<FragmentoParada[]> {
  const sql = getSql();
  // ±2 páginas: el destino guardado es UNA página (donde el lector encontró la
  // evidencia) y una idea rara vez entra entera ahí. Más ancho empieza a traer
  // la lección de al lado, que es de otro tema.
  const radio = opts.radioPaginas ?? 2;
  const tope = opts.topePorComponente ?? 6;

  const [fila] = await sql<{ cobertura: CompCobertura[] | null; doc: string | null }[]>`
    select cm.componentes_cobertura cobertura, d.title doc
      from curriculum_map cm
      left join documents d on d.id = cm.document_id
     where cm.subject_id = ${subjectId}::uuid
       and cm.metodo = 'lector-v1'
       and cm.item = ${item}
     order by cm.updated_at desc nulls last
     limit 1`;
  if (!fila?.cobertura) return [];

  const out: FragmentoParada[] = [];
  const vistos = new Set<string>();

  for (const comp of fila.cobertura) {
    // Dónde está: en su propio libro (`ok`, con `pag`) o en otro (`en`).
    const destino = comp.ok
      ? { doc: fila.doc, pag: comp.pag }
      : comp.en
        ? { doc: comp.en.doc ?? null, pag: comp.en.pag }
        : null;
    if (!destino?.doc || destino.pag == null) continue;

    const filas = await sql<{ content: string; page: number | null; title: string }[]>`
      select ch.content, ch.page, d.title
        from chunks ch join documents d on d.id = ch.document_id
       where d.title = ${destino.doc}
         and ch.corpus_role = 'content'
         and ch.page between ${destino.pag - radio} and ${destino.pag + radio}
         and length(ch.content) > 120
       order by abs(ch.page - ${destino.pag}), ch.page
       limit ${tope}`;

    for (const f of filas) {
      // Dedup por (tomo, página, prefijo): dos componentes vecinos apuntan a
      // páginas solapadas y el mismo chunk entraría dos veces, gastando lugar
      // en la muestra que `armarApunte` reparte.
      const clave = `${f.title}|${f.page}|${f.content.slice(0, 60)}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      out.push({ content: f.content, page: f.page, libro: f.title, componente: comp.c });
    }
  }
  return out;
}
