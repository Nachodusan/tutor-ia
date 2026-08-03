/**
 * CURSO DE DEMOSTRACIÓN — solo para desarrollo.
 *
 * El panel del docente muestra avance y temas fallados. Los dos salen de que un
 * alumno haya estudiado y rendido pruebas, así que en una base recién instalada
 * la pantalla está vacía y no se puede ni mirar ni criticar. Esto la llena con un
 * curso verosímil.
 *
 * Dos reglas que hacen que sea seguro tenerlo en el repo:
 *
 *  1. **Solo toca cuentas con el prefijo `demo-`.** No modifica ni borra ninguna
 *     otra fila de `users`, y por lo tanto tampoco el progreso de un alumno real.
 *  2. **Los temas son REALES**, sacados de `getPlanTopics` — las mismas claves
 *     que produce la app. Sembrar claves inventadas fue exactamente el bug que
 *     dejó tres filas huérfanas (`demo-1`, `tema-A`) apuntando a lecciones que no
 *     existen: se ven en el panel y no se pueden reforzar.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/admin seed-demo --curso 1M [--cantidad 8]
 *   pnpm --filter @tutor-ia/admin seed-demo --limpiar
 */
import { getSql, toJson } from "@tutor-ia/db";
import { hashPassword } from "@tutor-ia/core";
import { getPlanTopics } from "@tutor-ia/rag";

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n: string) => argv.includes(`--${n}`);

const sql = getSql();

/** Prefijo reservado. Todo lo que este script escribe o borra empieza así. */
const PREFIJO = "demo-";
/** Contraseña común: son cuentas de juguete, no hay nada que proteger. */
const PASSWORD = "demo-demo-demo-demo";

/**
 * Generador determinista (LCG). Sin esto, cada corrida produce un curso distinto
 * y comparar dos capturas de pantalla del panel deja de significar algo.
 */
function rng(semilla: number) {
  let s = semilla >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

async function limpiar(): Promise<void> {
  const borrados = await sql<{ username: string }[]>`
    delete from users where username like ${PREFIJO + "%"} returning username`;
  // El resto cae por las FKs `on delete cascade` que apuntan a users.
  console.log(`\n  ✓ ${borrados.length} cuenta(s) de demostración borradas (y su progreso).\n`);
}

async function sembrar(curso: string, cantidad: number): Promise<void> {
  // Materias del curso. El grado vive en `documents`, no en `subjects`.
  const materias = await sql<{ id: string; name: string }[]>`
    select s.id, s.name
    from subjects s
    join documents d on d.subject_id = s.id
    where s.user_id is null
    group by s.id, s.name
    having max(d.grade) = ${curso}
    order by s.name`;
  if (materias.length === 0) {
    throw new Error(`No hay materias con material para el curso "${curso}". Probá con otro (ej. 1M).`);
  }

  // Los temas REALES de cada materia, los mismos que ve el alumno en su plan.
  const temasPorMateria = new Map<string, { key: string; title: string; unitNo: number | null; lessonNo: number | null }[]>();
  for (const m of materias) {
    const t = await getPlanTopics(m.id);
    if (t.length) {
      temasPorMateria.set(m.id, t.map((x) => ({ key: x.key, title: x.title, unitNo: x.unitNo, lessonNo: x.lessonNo })));
    }
  }
  const conTemas = materias.filter((m) => temasPorMateria.has(m.id));
  if (conTemas.length === 0) {
    throw new Error(`Las materias de "${curso}" no tienen plan legible: no hay temas que sembrar.`);
  }

  const hash = await hashPassword(PASSWORD);
  const azar = rng(20260802);
  const prioridad = conTemas.slice(0, 3);

  for (let i = 1; i <= cantidad; i++) {
    const username = `${PREFIJO}${curso.toLowerCase()}-${String(i).padStart(2, "0")}`;

    // El índice único es sobre `lower(username)`, no sobre la columna: el
    // conflict target tiene que ser la MISMA expresión o Postgres lo rechaza.
    const [u] = await sql<{ id: string }[]>`
      insert into users (username, password_hash, role)
      values (${username}, ${hash}, 'student')
      on conflict (lower(username)) do update set password_hash = excluded.password_hash
      returning id`;
    const userId = u!.id;

    await sql`
      insert into student_profiles (user_id, grade, grade_set_at)
      values (${userId}::uuid, ${curso}, now())
      on conflict (user_id) do update set grade = excluded.grade`;

    await sql`delete from student_priority_subjects where user_id = ${userId}::uuid`;
    for (const [pos, m] of prioridad.entries()) {
      await sql`
        insert into student_priority_subjects (user_id, subject_id, position)
        values (${userId}::uuid, ${m.id}::uuid, ${pos})`;
    }

    // Una sesión con antigüedad variable, para que "último acceso" tenga rango.
    // token_hash es un sha256 imposible de producir: nadie puede entrar con ella.
    const diasSinEntrar = Math.floor(azar() * 14);
    await sql`delete from auth_sessions where user_id = ${userId}::uuid`;
    await sql`
      insert into auth_sessions (user_id, token_hash, last_seen_at, expires_at)
      values (${userId}::uuid, sha256(convert_to(${`demo-no-token-${username}`}, 'UTF8')),
              now() - make_interval(days => ${diasSinEntrar}),
              now() + interval '30 days')`;

    // El avance: los primeros N temas de cada materia prioritaria. Que sean los
    // PRIMEROS y no al azar es lo realista — un chico avanza en orden.
    await sql`delete from student_plan_progress where user_id = ${userId}::uuid`;
    await sql`delete from student_weak_topics    where user_id = ${userId}::uuid`;
    for (const m of prioridad) {
      const temas = temasPorMateria.get(m.id)!;
      const hechos = Math.floor(azar() * (temas.length * 0.7));
      for (const t of temas.slice(0, hechos)) {
        await sql`
          insert into student_plan_progress (user_id, subject_id, topic_key)
          values (${userId}::uuid, ${m.id}::uuid, ${t.key})
          on conflict (user_id, topic_key) do nothing`;
      }

      // La prueba: se rinde sobre lo estudiado. Los primeros temas del libro los
      // falla más gente que los últimos porque más gente llegó a ellos — que es
      // justamente lo que el ranking del panel tiene que reflejar.
      if (hechos < 3) continue;
      const preguntas = temas.slice(0, Math.min(6, hechos));
      const fallados = preguntas.filter(() => azar() < 0.35);
      const score = preguntas.length - fallados.length;

      const [ex] = await sql<{ id: string }[]>`
        insert into exams (user_id, subject_id, title, questions)
        values (${userId}::uuid, ${m.id}::uuid, 'Simulación de prueba (demo)',
                ${toJson(sql, preguntas.map((t, n) => ({ n: n + 1, key: t.key, topic: t.title })))}::jsonb)
        returning id`;
      await sql`
        insert into exam_attempts (exam_id, user_id, answers, score, submitted_at)
        values (${ex!.id}::uuid, ${userId}::uuid,
                ${toJson(sql, preguntas.map(() => 0))}::jsonb, ${score},
                now() - make_interval(days => ${diasSinEntrar}))`;

      for (const t of fallados) {
        await sql`
          insert into student_weak_topics (user_id, subject_id, topic_key, topic, unit, lesson, misses)
          values (${userId}::uuid, ${m.id}::uuid, ${t.key}, ${t.title}, ${t.unitNo}, ${t.lessonNo},
                  ${1 + Math.floor(azar() * 2)})
          on conflict (user_id, subject_id, topic_key) do update set misses = excluded.misses`;
      }
    }
  }

  console.log(`\n  ✓ ${cantidad} alumnos de demostración en ${curso}, en ${prioridad.length} materias:`);
  for (const m of prioridad) console.log(`      · ${m.name} (${temasPorMateria.get(m.id)!.length} temas)`);
  console.log(`\n    Usuarios: ${PREFIJO}${curso.toLowerCase()}-01 … -${String(cantidad).padStart(2, "0")}`);
  console.log(`    Contraseña de todos: ${PASSWORD}`);
  console.log(`\n    Para borrarlos: pnpm --filter @tutor-ia/admin seed-demo --limpiar\n`);
}

async function main() {
  if (has("limpiar")) { await limpiar(); return; }

  const curso = flag("curso");
  if (!curso) {
    console.log(`
  Curso de demostración (SOLO desarrollo). Solo toca cuentas "${PREFIJO}…".

    seed-demo --curso 1M [--cantidad 8]
    seed-demo --limpiar
`);
    return;
  }
  const cantidad = Number(flag("cantidad") ?? "8");
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 40) {
    throw new Error("--cantidad tiene que estar entre 1 y 40.");
  }
  await sembrar(curso.toUpperCase(), cantidad);
}

main()
  .then(async () => { await sql.end(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
    try { await sql.end(); } catch { /* ya cerrado */ }
    process.exit(1);
  });
