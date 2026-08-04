/**
 * ACTIVAR / DESACTIVAR MATERIAS.
 *
 * Sacar una materia de circulación sin borrarla. Sirve mientras se revisa si el
 * libro cargado es el que corresponde, o mientras falta material: es mejor que
 * la materia no aparezca a que un alumno estudie de un libro equivocado.
 *
 * Apagar y NO borrar, igual que con las cuentas: borrar una materia cascadearía
 * sus documentos, sus chunks —horas de ingesta— y el progreso de todos los
 * alumnos que la hayan tocado. Al reactivarla, todo vuelve como estaba.
 *
 * El patrón matchea por el nombre SIN el curso: "Inglés" apaga las 12 (de 1º
 * básico a 4º medio) de una. Para una sola, pasá el nombre completo.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/admin subjects listar
 *   pnpm --filter @tutor-ia/admin subjects desactivar --materia "Inglés" [--materia "Física"]
 *   pnpm --filter @tutor-ia/admin subjects activar    --materia "Inglés"
 *   pnpm --filter @tutor-ia/admin subjects activar    --todas
 */
import { getSql } from "@tutor-ia/db";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const has = (n: string) => argv.includes(`--${n}`);
/** Todos los valores de una bandera repetible: --materia A --materia B. */
const flags = (n: string): string[] =>
  argv.reduce<string[]>((acc, v, i) => (v === `--${n}` && argv[i + 1] ? [...acc, argv[i + 1]!] : acc), []);

const sql = getSql();

interface Fila { id: string; name: string; grade: string | null; disabled_at: Date | null }

async function todas(): Promise<Fila[]> {
  return sql<Fila[]>`
    select s.id, s.name, max(d.grade) as grade, s.disabled_at
    from subjects s
    left join documents d on d.subject_id = s.id
    where s.user_id is null
    group by s.id, s.name, s.disabled_at
    order by s.name`;
}

/** Base del nombre, sin el curso: "Inglés 3º Medio" → "inglés". */
const base = (n: string) => n.replace(/\s+\d+º.*$/, "").trim().toLowerCase();

/** Matchea por nombre base O por nombre completo, sin distinguir mayúsculas. */
function coincide(f: Fila, patrones: string[]): boolean {
  const b = base(f.name), completo = f.name.toLowerCase();
  return patrones.some((p) => {
    const q = p.trim().toLowerCase();
    return b === q || completo === q;
  });
}

async function listar(): Promise<void> {
  const fs = await todas();
  const activas = fs.filter((f) => !f.disabled_at);
  const off = fs.filter((f) => f.disabled_at);
  const ancho = Math.min(48, Math.max(10, ...fs.map((f) => f.name.length)));

  console.log(`\n  ${fs.length} materias · ${activas.length} activas · ${off.length} desactivadas\n`);
  for (const f of fs) {
    const marca = f.disabled_at ? "⛔ desactivada" : "✅";
    console.log(`  ${(f.grade ?? "—").padEnd(4)} ${f.name.slice(0, ancho).padEnd(ancho)}  ${marca}`);
  }
  console.log();
  if (off.length) {
    const bases = [...new Set(off.map((f) => f.name.replace(/\s+\d+º.*$/, "").trim()))];
    console.log(`  Desactivadas: ${bases.join(", ")}`);
    console.log(`  Para reactivar: pnpm --filter @tutor-ia/admin subjects activar --todas\n`);
  }
}

async function cambiar(apagar: boolean): Promise<void> {
  const patrones = flags("materia");
  const todasLasMaterias = has("todas");

  if (!patrones.length && !todasLasMaterias) {
    throw new Error(`Falta --materia "Inglés" (repetible) o --todas.`);
  }
  if (todasLasMaterias && apagar) {
    throw new Error(`--todas solo se admite para activar: apagar todo dejaría la app sin nada que estudiar.`);
  }

  const fs = await todas();
  const objetivo = todasLasMaterias ? fs : fs.filter((f) => coincide(f, patrones));

  if (objetivo.length === 0) {
    const disponibles = [...new Set(fs.map((f) => f.name.replace(/\s+\d+º.*$/, "").trim()))];
    throw new Error(
      `Ninguna materia coincide con ${patrones.map((p) => `"${p}"`).join(", ")}.\n` +
      `    Las que hay: ${disponibles.join(", ")}`,
    );
  }

  // Solo las que cambian de estado: así el resumen dice la verdad y no cuenta
  // como "desactivadas" a las que ya lo estaban.
  const cambian = objetivo.filter((f) => (apagar ? !f.disabled_at : !!f.disabled_at));
  if (cambian.length === 0) {
    console.log(`\n  Nada que hacer: las ${objetivo.length} ya estaban ${apagar ? "desactivadas" : "activas"}.\n`);
    return;
  }

  await sql`
    update subjects set disabled_at = ${apagar ? new Date() : null}
    where id = any(${cambian.map((f) => f.id)}::uuid[])`;

  console.log(`\n  ${apagar ? "⛔ Desactivadas" : "✅ Reactivadas"} ${cambian.length} materias:\n`);
  for (const f of cambian) console.log(`    ${(f.grade ?? "—").padEnd(4)} ${f.name}`);
  console.log(
    apagar
      ? `\n  Ya no aparecen en el panel del alumno ni en el del docente, y las rutas de\n` +
        `  plan y prueba las rechazan. NO se borró nada: el material y el progreso\n` +
        `  siguen intactos y vuelven al reactivarlas.\n`
      : `\n  Vuelven a aparecer con todo su material y el progreso que tenían.\n`,
  );
}

async function main() {
  switch (cmd) {
    case "listar": await listar(); break;
    case "desactivar": await cambiar(true); break;
    case "activar": await cambiar(false); break;
    default:
      console.log(`
  Activar o desactivar materias (se apagan, no se borran).

    subjects listar
    subjects desactivar --materia "Inglés" [--materia "Física" …]
    subjects activar    --materia "Inglés"
    subjects activar    --todas

  El patrón matchea el nombre SIN el curso: "Inglés" apaga las 12 de una.
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
