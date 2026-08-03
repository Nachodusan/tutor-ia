/**
 * PRE-GENERACIÓN DE PLANES DE ESTUDIO.
 *
 * El plan se cachea por materia (`subject_plans`) porque sale del índice del
 * libro y el libro es el mismo para todo el curso. Hasta ahora esa cache se
 * llenaba sola: el PRIMER alumno que apretaba "armame un plan" pagaba la espera
 * —varios minutos con el 7B local— y los demás lo recibían instantáneo.
 *
 * Esto hace ese primer trabajo de antemano, para todas las materias de una. Dos
 * motivos:
 *
 *  1. Nadie espera. Un chico de 13 años frente a una pantalla que dice "armando
 *     tu plan…" durante cuatro minutos cierra la app.
 *  2. Los planes cacheados ANTES de que existieran los puntos clave se quedaron
 *     sin ellos. `--viejos` los detecta y los rehace, sin tocar los que ya están.
 *
 * Es RESUMIBLE e IDEMPOTENTE: por defecto saltea lo que ya está bien, así que se
 * puede cortar con Ctrl-C y volver a correr.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/admin plans estado
 *   pnpm --filter @tutor-ia/admin plans generar               (lo que falta + los viejos)
 *   pnpm --filter @tutor-ia/admin plans generar --curso 1M
 *   pnpm --filter @tutor-ia/admin plans generar --forzar      (rehace TODO)
 */
import { getSql, toJson } from "@tutor-ia/db";
import { buildStudyPlan, SinEstructura } from "@tutor-ia/core";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n: string) => argv.includes(`--${n}`);

const sql = getSql();

interface Materia {
  id: string;
  name: string;
  grade: string | null;
  lecciones: number;
  /** Temas del plan cacheado, o null si no hay plan. */
  cacheados: number | null;
  /** Cuántos ítems del plan cacheado traen puntos clave. */
  conPuntos: number | null;
}

/**
 * Las materias que pueden tener plan, con el estado de su cache.
 *
 * El filtro `>= 3` es el mismo de `getPlanTopics`: con menos lecciones legibles
 * cae al fallback legacy y prefiere no dar plan antes que dar uno equivocado.
 */
async function materias(curso?: string): Promise<Materia[]> {
  return sql<Materia[]>`
    select s.id, s.name, max(d.grade) as grade,
           count(distinct bs.id)::int as lecciones,
           (select jsonb_array_length(sp.items) from subject_plans sp where sp.subject_id = s.id) as cacheados,
           (select count(*)::int from subject_plans sp,
                   jsonb_array_elements(sp.items) it
             where sp.subject_id = s.id
               and jsonb_array_length(coalesce(it->'points', '[]'::jsonb)) > 0) as "conPuntos"
    from subjects s
    join documents d on d.subject_id = s.id
    left join book_sections bs on bs.subject_id = s.id and bs.level = 2
    where s.user_id is null
    group by s.id, s.name
    having count(distinct bs.id) >= 3
       ${curso ? sql`and max(d.grade) = ${curso}` : sql``}
    order by max(d.grade), s.name`;
}

/** Un plan sirve si existe Y al menos la mitad de sus ítems trae puntos clave. */
function estaBien(m: Materia): boolean {
  if (!m.cacheados) return false;
  return (m.conPuntos ?? 0) >= Math.ceil(m.cacheados / 2);
}

function etiqueta(m: Materia): string {
  if (!m.cacheados) return "sin plan";
  if (!estaBien(m)) return `viejo (${m.conPuntos ?? 0}/${m.cacheados} con puntos)`;
  return `ok (${m.cacheados} temas)`;
}

async function estado(curso?: string): Promise<void> {
  const ms = await materias(curso);
  const ok = ms.filter(estaBien);
  const viejos = ms.filter((m) => m.cacheados && !estaBien(m));
  const faltan = ms.filter((m) => !m.cacheados);

  console.log(`\n  ${ms.length} materias con índice legible${curso ? ` en ${curso}` : ""}\n`);
  const anchoN = Math.min(46, Math.max(10, ...ms.map((m) => m.name.length)));
  for (const m of ms) {
    console.log(`  ${(m.grade ?? "—").padEnd(4)} ${m.name.slice(0, anchoN).padEnd(anchoN)}  ${etiqueta(m)}`);
  }
  console.log(`\n  ✅ ${ok.length} al día · ♻️  ${viejos.length} sin puntos clave · ⬜ ${faltan.length} sin plan\n`);
  if (viejos.length + faltan.length > 0) {
    console.log(`  Para generarlos: pnpm --filter @tutor-ia/admin plans generar${curso ? ` --curso ${curso}` : ""}\n`);
  }
}

async function generar(curso: string | undefined, forzar: boolean): Promise<void> {
  const todas = await materias(curso);
  const pendientes = forzar ? todas : todas.filter((m) => !estaBien(m));

  if (pendientes.length === 0) {
    console.log(`\n  ✅ Nada que hacer: las ${todas.length} materias ya tienen plan con puntos clave.\n`);
    return;
  }

  console.log(`\n  ${pendientes.length} materias por generar (de ${todas.length}).`);
  console.log(`  Se hace de a UNA: el modelo local atiende una consulta a la vez,`);
  console.log(`  lanzarlas en paralelo solo se pisa a sí mismo.\n`);

  let hechas = 0, sinEstructura = 0, fallidas = 0;
  const t0 = Date.now();

  for (const [i, m] of pendientes.entries()) {
    const marca = `[${i + 1}/${pendientes.length}]`;
    const nombre = `${(m.grade ?? "—").padEnd(4)} ${m.name}`;
    process.stdout.write(`  ${marca} ${nombre} … `);
    const t = Date.now();
    try {
      const items = await buildStudyPlan(m.id, m.name);
      await sql`
        insert into subject_plans (subject_id, items, generated_at)
        values (${m.id}::uuid, ${toJson(sql, items)}::jsonb, now())
        on conflict (subject_id) do update set items = excluded.items, generated_at = now()`;
      const puntos = items.reduce((n, it) => n + it.points.length, 0);
      console.log(`✅ ${items.length} temas · ${puntos} puntos · ${Math.round((Date.now() - t) / 1000)}s`);
      hechas++;
    } catch (e) {
      if (e instanceof SinEstructura) {
        // No es un error: el libro no da para un plan y eso ya se decidió antes.
        console.log(`⬜ sin estructura suficiente`);
        sinEstructura++;
      } else {
        // Una materia que falla NO corta la corrida: se anota y se sigue. Con 40
        // materias y varios minutos cada una, abortar por una sola tira a la
        // basura media hora de trabajo ya hecho.
        console.log(`✗ ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
        fallidas++;
      }
    }
  }

  const min = Math.round((Date.now() - t0) / 60000);
  console.log(`\n  ✅ ${hechas} generadas · ⬜ ${sinEstructura} sin estructura · ✗ ${fallidas} fallidas · ${min} min`);
  if (fallidas > 0) {
    console.log(`  Volvé a correr el mismo comando: saltea lo que ya quedó bien y reintenta las fallidas.`);
  }
  console.log();
}

async function main() {
  const curso = flag("curso")?.toUpperCase();
  switch (cmd) {
    case "estado": await estado(curso); break;
    case "generar": await generar(curso, has("forzar")); break;
    default:
      console.log(`
  Planes de estudio cacheados por materia.

    plans estado  [--curso 1M]     qué materias tienen plan y cuáles con puntos clave
    plans generar [--curso 1M]     genera lo que falta y rehace los que no tienen puntos
    plans generar --forzar         rehace TODOS (incluidos los que ya están bien)

  Es resumible: cortá con Ctrl-C y volvé a correrlo cuando quieras.
`);
  }
}

main()
  .then(async () => { await sql.end(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
    try { await sql.end(); } catch { /* ya cerrado */ }
    process.exit(1);
  });
