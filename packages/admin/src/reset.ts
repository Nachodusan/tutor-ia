/**
 * RESET DEL ESTADO DE LOS ALUMNOS — dejar la app como el primer día.
 *
 * Para probar el recorrido completo hace falta volver al punto de partida: sin
 * curso elegido, sin lecciones marcadas, sin pruebas rendidas, sin temas para
 * reforzar y con el panel del docente vacío. Hacerlo a mano son ocho DELETE en
 * el orden correcto, y equivocarse en uno deja un estado a medias que después
 * se confunde con un bug de la app.
 *
 * QUÉ BORRA (todo lo que produce un alumno usando la app):
 *   · perfil y materias prioritarias      · lecciones marcadas del plan
 *   · temas para reforzar                 · pruebas y sus intentos
 *   · conversaciones y sus mensajes       · sesiones de login abiertas
 *
 * QUÉ NO TOCA, y es deliberado:
 *   · Las CUENTAS. Se conservan con su contraseña: el colegio ya las repartió
 *     en papel y un reset de pruebas no puede obligar a reimprimirlas.
 *   · Los PLANES DE ESTUDIO cacheados (`subject_plans`). No son progreso de
 *     nadie: son el currículo derivado del libro, cuestan llamadas al modelo y
 *     son idénticos para todos. Borrarlos haría que el primer alumno de cada
 *     materia vuelva a esperar.
 *   · El CORPUS entero (documentos, chunks, embeddings, secciones del libro).
 *
 * Uso:
 *   pnpm --filter @tutor-ia/admin reset                 (muestra qué borraría)
 *   pnpm --filter @tutor-ia/admin reset --confirmar
 *   pnpm --filter @tutor-ia/admin reset --confirmar --borrar-demo
 */
import { getSql } from "@tutor-ia/db";

const argv = process.argv.slice(2);
const has = (n: string) => argv.includes(`--${n}`);

const sql = getSql();

/** Prefijo de las cuentas de juguete que crea `seed-demo`. */
const PREFIJO_DEMO = "demo-";

interface Conteo { que: string; n: number }

async function inventario(): Promise<Conteo[]> {
  const uno = async (que: string, q: Promise<{ n: number }[]>): Promise<Conteo> =>
    ({ que, n: Number((await q)[0]?.n ?? 0) });

  return Promise.all([
    uno("perfiles (curso elegido)", sql<{ n: number }[]>`select count(*)::int as n from student_profiles`),
    uno("materias prioritarias", sql<{ n: number }[]>`select count(*)::int as n from student_priority_subjects`),
    uno("lecciones marcadas", sql<{ n: number }[]>`select count(*)::int as n from student_plan_progress`),
    uno("temas para reforzar", sql<{ n: number }[]>`select count(*)::int as n from student_weak_topics`),
    uno("pruebas generadas", sql<{ n: number }[]>`select count(*)::int as n from exams`),
    uno("intentos de prueba", sql<{ n: number }[]>`select count(*)::int as n from exam_attempts`),
    uno("conversaciones", sql<{ n: number }[]>`select count(*)::int as n from study_sessions`),
    uno("mensajes", sql<{ n: number }[]>`select count(*)::int as n from messages`),
    uno("sesiones de login abiertas", sql<{ n: number }[]>`select count(*)::int as n from auth_sessions where revoked_at is null`),
    uno("cuentas de demostración", sql<{ n: number }[]>`select count(*)::int as n from users where username like ${PREFIJO_DEMO + "%"}`),
  ]);
}

async function main() {
  const confirmar = has("confirmar");
  const borrarDemo = has("borrar-demo");

  const antes = await inventario();
  const demo = antes.find((c) => c.que.startsWith("cuentas de demo"))!.n;
  const aBorrar = antes.filter((c) => !c.que.startsWith("cuentas de demo"));
  const total = aBorrar.reduce((s, c) => s + c.n, 0);

  console.log(`\n  Estado actual:\n`);
  for (const c of aBorrar) console.log(`    ${String(c.n).padStart(6)}  ${c.que}`);
  console.log(`    ${String(demo).padStart(6)}  cuentas de demostración (${PREFIJO_DEMO}…)${borrarDemo ? " → SE BORRAN" : " → se conservan"}`);

  if (!confirmar) {
    console.log(`\n  Esto es solo un informe: NO se borró nada.`);
    console.log(`  Para hacerlo de verdad:\n`);
    console.log(`    pnpm --filter @tutor-ia/admin reset --confirmar${demo > 0 ? " [--borrar-demo]" : ""}\n`);
    console.log(`  Las cuentas y los planes de estudio cacheados NO se tocan.\n`);
    return;
  }

  if (total === 0 && !(borrarDemo && demo > 0)) {
    console.log(`\n  ✅ Ya estaba limpio: no había nada que borrar.\n`);
    return;
  }

  // Todo en UNA transacción: un reset a medias (perfil borrado pero pruebas
  // vivas) se ve exactamente igual que un bug de la app, y se pierde tiempo
  // buscándolo donde no está.
  await sql.begin(async (tx) => {
    if (borrarDemo) {
      // Las cuentas demo caen enteras; su progreso se va por las FKs on delete cascade.
      await tx`delete from users where username like ${PREFIJO_DEMO + "%"}`;
    }
    await tx`delete from student_plan_progress`;
    await tx`delete from student_weak_topics`;
    await tx`delete from student_priority_subjects`;
    await tx`delete from student_profiles`;
    // exam_attempts cae por FK, pero se borra explícito: depender de un cascade
    // que alguien podría cambiar mañana es apostar a que nadie toque el esquema.
    await tx`delete from exam_attempts`;
    await tx`delete from exams`;
    // messages cae por cascade de study_sessions.
    await tx`delete from study_sessions`;
    // Cerrar las sesiones abiertas: la próxima pantalla tiene que ser el login,
    // que es donde empieza "el primer día".
    await tx`delete from auth_sessions`;
  });

  const despues = await inventario();
  console.log(`\n  ✅ Reset hecho. Estado nuevo:\n`);
  for (const c of despues) console.log(`    ${String(c.n).padStart(6)}  ${c.que}`);

  const [cuentas] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  const [planes] = await sql<{ n: number }[]>`select count(*)::int as n from subject_plans`;
  console.log(`\n  Intactos: ${cuentas?.n ?? 0} cuentas (con su contraseña) y ${planes?.n ?? 0} planes de estudio cacheados.`);
  console.log(`  Todos quedaron deslogueados: al entrar, la app pide usuario y arranca desde el curso.\n`);
}

main()
  .then(async () => { await sql.end(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
    try { await sql.end(); } catch { /* ya cerrado */ }
    process.exit(1);
  });
