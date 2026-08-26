/**
 * LO QUE COMPARTEN EL GENERADOR DE CLASES Y EL DE APUNTES.
 *
 * Las dos herramientas recorren las MISMAS paradas del camino y buscan la MISMA
 * pedagogía del libro del docente; lo único que cambia es qué le piden al
 * modelo. Vive acá desde el principio y no duplicado en los dos comandos,
 * porque la primera consecuencia de duplicarlo sería arreglar el corte del aviso
 * del profesor en un archivo y no en el otro.
 */
import { getSql } from "@tutor-ia/db";

const sql = getSql();

export interface Parada {
  subjectId: string; subjectName: string; documentId: string | null;
  key: string; title: string; p0: number; p1: number;
}

/**
 * Las paradas salen de `subject_plans.items[].lecciones[]`, que es donde viven
 * desde que el camino es de unidades. El `documentId` está en el PADRE, no en la
 * lección: sin él, un rango de páginas cae en varios libros a la vez — la misma
 * materia cuelga el texto del estudiante, cuatro tomos de guía docente y los
 * módulos EPJA, y "págs. 18-19" existe en todos.
 *
 * `materia` matchea PARCIAL a propósito: el nombre real casi nunca es el que uno
 * escribe ("Historia Geografía Y Ciencias Sociales 1º Medio", sin coma), y un
 * filtro que no matchea devolvía cero paradas sin decir por qué.
 */
export async function paradas(filtros: { materia?: string; key?: string } = {}): Promise<Parada[]> {
  const m = filtros.materia ?? null;
  const k = filtros.key ?? null;
  const rows = (await sql`
    select s.id as subject_id, s.name as subject_name,
           it->>'documentId' as document_id,
           l->>'key' as key, l->>'title' as title,
           (l->>'p0')::int as p0, (l->>'p1')::int as p1
    from subject_plans sp
    join subjects s on s.id = sp.subject_id
    cross join lateral jsonb_array_elements(sp.items) it
    cross join lateral jsonb_array_elements(it->'lecciones') l
    where l->>'p0' is not null
      and (${m}::text is null or s.name ilike ${m ? `%${m}%` : null})
      and (${k}::text is null or l->>'key' = ${k})
    order by s.name, (l->>'p0')::int`) as unknown as {
    subject_id: string; subject_name: string; document_id: string | null;
    key: string; title: string; p0: number; p1: number;
  }[];
  return rows.map((r) => ({
    subjectId: r.subject_id, subjectName: r.subject_name, documentId: r.document_id,
    key: r.key, title: r.title, p0: r.p0, p1: r.p1,
  }));
}

/** Materias que tienen plan, para avisar cuando un filtro no matchea nada. */
export async function materiasConPlan(): Promise<string[]> {
  const rows = (await sql`
    select distinct s.name from subjects s
    join subject_plans sp on sp.subject_id = s.id
    order by s.name limit 60`) as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * Palabras del título que sirven para buscar en la guía del docente.
 *
 * ⚠️ "LECCIÓN" Y "UNIDAD" NO SON TEMAS, y dejarlas adentro traía el aviso de
 * cualquier otra lección. Medido: la parada "Lección 2 Mundos familiares" sacó
 * su recuadro de la guía de Lengua p.286, que habla de identificar conflictos en
 * un texto literario — de otro cuento y de otra unidad. Matcheó por la palabra
 * "lección", que aparece en media guía.
 */
function palabrasDe(titulo: string): string[] {
  return titulo
    .toLowerCase()
    .replace(/[¿?¡!.,:;()"“”]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !/^(sobre|para|como|cual|cuales|nuestro|nuestra|manera|parte|mundo|mundos|lecci[oó]n|unidad|m[oó]dulo|cap[ií]tulo|tema|temas|texto|textos|primera|segunda|tercera)$/.test(w));
}

/**
 * Limpia un chunk de la guía docente para usarlo como insumo del prompt.
 * Junta los guiones de corte del PDF ("se pro- pagan" → "se propagan") y corta en
 * ORACIÓN ENTERA: cortar a los N caracteres dejaba la premisa del gate terminada
 * a mitad de palabra ("la estructura especializada para prod").
 */
function limpiarGuia(t: string, max: number): string {
  const limpio = t
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/([a-záéíóúñü])-\s+([a-záéíóúñü])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max).lastIndexOf(".");
  return corte > max * 0.3 ? limpio.slice(0, corte + 1) : limpio.slice(0, max);
}

/**
 * Un chunk de pedagogía de esta materia que hable de ESTE tema.
 *
 * ⚠️ La guía NO se puede ligar por índice: de las 1.846 paradas solo 3 tienen
 * `unit` y 198 tienen `lesson`, y los `heading_path` de la guía dicen
 * literalmente "Unidad ? Lección ?". Así que se busca por PALABRAS del título,
 * que es pobre pero determinístico. Lo que no matchea se queda sin bloque, y
 * está bien: es mejor no mostrarlo que mostrar el de otra lección.
 */
async function pedagogia(subjectId: string, titulo: string, tipo: string, max: number): Promise<string | null> {
  const palabras = palabrasDe(titulo);
  if (palabras.length === 0) return null;
  const rows = (await sql`
    select ch.content
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId}
      and ch.corpus_role = 'pedagogy'
      and ch.pedagogy_type = ${tipo}
      and length(ch.content) > 200
      -- Los índices del libro entran como pedagogía y son puro relleno de puntos.
      and ch.content not like '%......%'
      -- DOS palabras del título como mínimo, y ordenado por cuántas matchean.
      -- Con UNA sola y sin orden, "limit 1" devolvía el primer chunk que rozara
      -- cualquier palabra: así fue como dos paradas distintas de Matemática
      -- terminaron mostrando EL MISMO aviso, y la que le correspondía a una de
      -- ellas ("la confusión entre -2⁴ y (-2)⁴") quedó sin usar en el corpus.
      and (select count(*) from unnest(${palabras}::text[]) w
           where ch.content ilike '%' || w || '%') >= ${Math.min(2, palabras.length)}
    order by (select count(*) from unnest(${palabras}::text[]) w
              where ch.content ilike '%' || w || '%') desc, ch.page
    limit 1`) as unknown as { content: string }[];
  const t = rows[0]?.content;
  return t ? limpiarGuia(t, max) : null;
}

/** El error que el autor de la guía predijo para este tema. */
export const errorFrecuente = (subjectId: string, titulo: string) =>
  pedagogia(subjectId, titulo, "errores_frecuentes", 700);

/**
 * Lo que la guía docente dice que se evalúa. Es el insumo que hace que un apunte
 * sea distinto de un resumen: le dice al alumno QUÉ le van a preguntar, escrito
 * por quien escribió la prueba.
 */
export const queSeEvalua = (subjectId: string, titulo: string) =>
  pedagogia(subjectId, titulo, "evaluacion", 900);

export { sql };
