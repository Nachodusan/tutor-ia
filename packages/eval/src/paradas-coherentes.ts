/**
 * ¿EL TÍTULO DE CADA PARADA TIENE QUE VER CON SUS PÁGINAS?
 *
 *   pnpm --filter @tutor-ia/eval paradas-coherentes
 *   pnpm --filter @tutor-ia/eval paradas-coherentes --materia "Química 2º Medio" --ver
 *
 * ── DE DÓNDE SALE ESTO ──────────────────────────────────────────────────────
 *
 * La auditoría de los apuntes encontró que la parada "¿Qué es la
 * estereoisomería?" de Química 2º Medio tiene el rango p.101-135, y que en esas
 * páginas hay 20 chunks que hablan de propiedades coligativas y UNO de
 * estereoisomería. La estereoisomería está en las páginas 155-178, dentro del
 * rango de OTRA parada. Los títulos quedaron corridos una lección respecto de
 * los rangos.
 *
 * El apunte de esa parada es correcto RESPECTO DE SUS PÁGINAS — el que está mal
 * es el plan. Y como el alumno ve el título, estudia otra cosa creyendo que
 * estudia la que eligió. Ningún gate de contenido puede detectar eso: hay que
 * comparar el título con el material.
 *
 * ── CÓMO MIDE ───────────────────────────────────────────────────────────────
 *
 * Cuenta cuántos chunks del rango mencionan alguna palabra del título. Compara
 * por RAÍZ de 7 letras y no por palabra entera, porque el título dice
 * "¿Cómo evolucionan los seres vivos?" y el cuerpo dice "evolución", "evolutivo"
 * y "evolucionaron" — exigir la forma exacta daría cero en lecciones perfectas.
 *
 * ⚠️ ES UN SEMÁFORO, NO UN VEREDICTO. Un 0% en Matemática puede ser el corpus
 * roto (las fórmulas se aplanaron y no queda ninguna palabra del título) y no un
 * rango corrido. Por eso imprime el título y las páginas: lo que sale marcado se
 * MIRA, no se borra.
 */
import { getSql } from "@tutor-ia/db";

const sql = getSql();
const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const MATERIA = arg("--materia") ?? null;
const VER = process.argv.includes("--ver");
/** Por debajo de esto, la parada se marca. */
const UMBRAL = Number(arg("--umbral") ?? 0.10);

const filas = (await sql`
  with paradas as (
    select s.name as materia, (it->>'documentId')::uuid as doc,
           l->>'key' as key, l->>'title' as titulo,
           (l->>'p0')::int as p0, (l->>'p1')::int as p1
    from subject_plans sp
    join subjects s on s.id = sp.subject_id
    cross join lateral jsonb_array_elements(sp.items) it
    cross join lateral jsonb_array_elements(it->'lecciones') l
    where l->>'p0' is not null and it->>'documentId' is not null
      and (${MATERIA}::text is null or s.name ilike ${MATERIA ? `%${MATERIA}%` : null})
  ),
  conRaices as (
    select p.*, array(
      select left(w, 7)
      from unnest(regexp_split_to_array(
             lower(regexp_replace(p.titulo, '[¿?¡!.,:;()"“”]', ' ', 'g')), '\\s+')) w
      where length(w) > 4
        and w !~ '^(sobre|para|como|cual|cuales|nuestro|nuestra|manera|parte|mundo|mundos|leccion|lección|unidad|modulo|módulo|capitulo|capítulo|tema|temas|texto|textos|primera|segunda|tercera|cuando|donde|porque|entre|estos|estas|otros|otras|desde|hasta|puede|pueden|sabes|saber)$'
    ) as raices
    from paradas p
  )
  select c.materia, c.key, c.titulo, c.p0, c.p1, c.raices,
         (select count(*) from chunks ch
           where ch.document_id = c.doc and ch.corpus_role = 'content'
             and coalesce(ch.page_start, ch.page) between c.p0 and c.p1)::int as total,
         (select count(*) from chunks ch
           where ch.document_id = c.doc and ch.corpus_role = 'content'
             and coalesce(ch.page_start, ch.page) between c.p0 and c.p1
             and exists (select 1 from unnest(c.raices) r where ch.content ilike '%' || r || '%'))::int as hits
  from conRaices c
  order by c.materia, c.p0`) as unknown as {
  materia: string; key: string; titulo: string; p0: number; p1: number;
  raices: string[]; total: number; hits: number;
}[];

interface Fila { materia: string; key: string; titulo: string; p0: number; p1: number; raices: string[]; total: number; hits: number }
const conMaterial = filas.filter((f) => f.total > 0);
// Sin raíces no hay nada que comparar ("¿Qué sabes?", "Lección 1"): no se juzga,
// pero se cuenta — son paradas cuyo título no dice de qué es la lección, y eso
// también es un problema, solo que otro.
const evaluables = conMaterial.filter((f) => f.raices.length > 0);
const sinTitulo = conMaterial.length - evaluables.length;

/**
 * ⚠️ TRES PROBLEMAS DISTINTOS SALEN MARCADOS Y SOLO UNO ES DEL PLAN. Correrlo
 * sobre las 1.846 paradas lo dejó claro, y mezclarlos hace inútil la lista:
 *
 *  1. RANGO CORRIDO — mucho material y casi nada del título. Es el bug real:
 *     "¿Qué es la estereoisomería?" con 33 chunks y UNO que la menciona, porque
 *     esas páginas son de propiedades coligativas. El alumno estudia otra cosa
 *     creyendo que estudia la que eligió.
 *
 *  2. NO ES UNA LECCIÓN — "Evaluación de unidad", "¿Qué necesito saber?",
 *     "Recortables", "Mi proceso". No tienen contenido que enseñar y no
 *     deberían ser paradas; hoy generan un apunte igual.
 *
 *  3. FALSO POSITIVO DE LENGUA — el título es el NOMBRE DE LA LECTURA o su
 *     autor ("Kim Wilde, Marjane Satrapi", "Instagram Grimlock_raul"), así que
 *     por definición no aparece en el cuerpo. La parada está perfecta.
 *
 * El tamaño los separa: un rango corrido de verdad tiene MUCHOS chunks que no
 * matchean; los otros dos tienen dos, tres o cuatro. Por eso el corte de abajo.
 */
const MINIMO_CHUNKS = Number(arg("--min-chunks") ?? 8);
const NO_ES_LECCION = /(evaluaci[oó]n|qu[eé] necesito saber|c[oó]mo vas|qu[eé] aprend|qu[eé] s[eé]\b|qu[eé] sabes|recortable|mi proceso|desarrolla tus|s[ií]ntesis|repaso|antes de empezar|para comenzar|lo que s[eé])/i;

const flojas = evaluables.filter((f) => f.hits / f.total < UMBRAL);
const noLeccion = flojas.filter((f) => NO_ES_LECCION.test(f.titulo));
const marcadas = flojas
  .filter((f) => !NO_ES_LECCION.test(f.titulo) && f.total >= MINIMO_CHUNKS)
  .sort((a, b) => (a.hits / a.total) - (b.hits / b.total) || b.total - a.total);
const chicas = flojas.filter((f) => !NO_ES_LECCION.test(f.titulo) && f.total < MINIMO_CHUNKS);

const porMateria = new Map<string, { n: number; malas: number }>();
for (const f of evaluables) {
  const m = porMateria.get(f.materia) ?? { n: 0, malas: 0 };
  m.n++;
  if (f.hits / f.total < UMBRAL) m.malas++;
  porMateria.set(f.materia, m);
}

console.log(`${filas.length} paradas · ${filas.length - conMaterial.length} sin material · ${sinTitulo} con título que no dice el tema\n`);
console.log(`── RANGO PROBABLEMENTE CORRIDO ──`);
console.log(`   ${MINIMO_CHUNKS}+ chunks y menos del ${(UMBRAL * 100).toFixed(0)}% menciona el título. Esto es lo que hay que MIRAR.\n`);
for (const f of marcadas.slice(0, VER ? 500 : 40)) {
  const pct = ((f.hits / f.total) * 100).toFixed(0).padStart(3);
  console.log(`${pct}%  ${f.hits}/${f.total}  ${f.materia.slice(0, 28).padEnd(28)}  p.${String(f.p0).padStart(3)}-${String(f.p1).padEnd(3)}  ${f.titulo.slice(0, 52)}`);
}
if (!VER && marcadas.length > 40) console.log(`… y ${marcadas.length - 40} más (con --ver salen todas)`);

console.log(`\n── POR MATERIA ──\n`);
for (const [m, v] of [...porMateria].sort((a, b) => (b[1].malas / b[1].n) - (a[1].malas / a[1].n))) {
  if (v.malas === 0) continue;
  console.log(`${String(v.malas).padStart(3)}/${String(v.n).padEnd(3)} (${((v.malas / v.n) * 100).toFixed(0).padStart(3)}%)  ${m}`);
}
console.log(`\n── SECCIONES QUE NO SON LECCIONES (${noLeccion.length}) ──`);
console.log(`   No tienen contenido que enseñar y hoy generan un apunte igual.\n`);
for (const f of noLeccion.slice(0, VER ? 500 : 12)) {
  console.log(`      ${f.materia.slice(0, 28).padEnd(28)}  p.${String(f.p0).padStart(3)}-${String(f.p1).padEnd(3)}  ${f.titulo.slice(0, 46)}`);
}

console.log(`\n${chicas.length} más quedaron abajo del corte de ${MINIMO_CHUNKS} chunks: casi todas son`);
console.log(`de Lengua, donde el título es el NOMBRE DE LA LECTURA ("Instagram Grimlock_raul")`);
console.log(`y por definición no aparece en el cuerpo. Son falsos positivos del test.`);

console.log(`\n${marcadas.length} de ${evaluables.length} paradas con rango sospechoso (${((marcadas.length / evaluables.length) * 100).toFixed(1)}%)`);
console.log(`⚠️  Es un semáforo: lo marcado se MIRA, no se borra. Un 0% en Matemática puede ser`);
console.log(`   el corpus roto (fórmulas aplanadas) y no un rango corrido.`);
await sql.end();
