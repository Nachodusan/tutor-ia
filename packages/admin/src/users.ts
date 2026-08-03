/**
 * Gestión de cuentas de alumno. NO hay registro en la app: las cuentas se crean
 * acá y el colegio reparte usuario y contraseña en papel.
 *
 * Las cuentas son ANÓNIMAS: el username es un identificador que no dice quién es
 * la persona ("7b-01"), y el mapeo a un alumno real vive en papel en el colegio,
 * nunca en esta base. Esa separación es lo que hace que el anonimato sea real.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/admin users crear  --usuario 7b-01 [--rol teacher]
 *   pnpm --filter @tutor-ia/admin users lote   --prefijo 7b --cantidad 35
 *   pnpm --filter @tutor-ia/admin users listar
 *   pnpm --filter @tutor-ia/admin users resetear  --usuario 7b-01
 *   pnpm --filter @tutor-ia/admin users desactivar --usuario 7b-01
 *   pnpm --filter @tutor-ia/admin users activar    --usuario 7b-01
 */
import { getSql } from "@tutor-ia/db";
import { generarPassword, hashPassword } from "@tutor-ia/core";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const sql = getSql();

/** Normalización única, igual que en el login: el alumno puede escribir "7B-01". */
const norm = (u: string) => u.trim().toLowerCase();

/**
 * Los tres roles que la app reconoce. La lista se valida acá porque el rol es
 * texto libre en la base: sin este chequeo, `--rol tacher` creaba en silencio
 * una cuenta que ningún handler reconoce — entra al login, y después no puede
 * hacer nada, sin ningún mensaje que explique por qué.
 *
 *   student → su propio panel y su progreso
 *   teacher → además, /docente: avance y temas débiles del curso (NO las charlas)
 *   admin   → además, subir y borrar material del currículo compartido
 */
const ROLES = ["student", "teacher", "admin"] as const;

async function crear(usuario: string, rol = "student"): Promise<{ usuario: string; password: string }> {
  const u = norm(usuario);
  if (!/^[a-z0-9][a-z0-9._-]{1,30}$/.test(u)) {
    throw new Error(`Usuario inválido: "${usuario}". Usá letras, números, punto, guion o guion bajo.`);
  }
  if (!(ROLES as readonly string[]).includes(rol)) {
    throw new Error(`Rol inválido: "${rol}". Los roles son: ${ROLES.join(", ")}.`);
  }
  const password = generarPassword();
  const hash = await hashPassword(password);
  const [row] = await sql<{ id: string }[]>`
    insert into users (username, password_hash, role)
    values (${u}, ${hash}, ${rol})
    on conflict do nothing
    returning id`;
  if (!row) throw new Error(`El usuario "${u}" ya existe.`);
  return { usuario: u, password };
}

function tabla(filas: { usuario: string; password: string }[]): void {
  const anchoU = Math.max(7, ...filas.map((f) => f.usuario.length));
  console.log(`\n  ${"USUARIO".padEnd(anchoU)}   CONTRASEÑA`);
  console.log(`  ${"─".repeat(anchoU)}   ${"─".repeat(28)}`);
  for (const f of filas) console.log(`  ${f.usuario.padEnd(anchoU)}   ${f.password}`);
  console.log(
    `\n  ⚠️  Esta es la ÚNICA vez que se ven las contraseñas: la base guarda solo\n` +
    `      el hash. Imprimilas o copialas ahora. Si se pierde una, se resetea con\n` +
    `      "users resetear --usuario <nombre>" (no hay recuperación: no guardamos\n` +
    `      ningún dato personal con el que verificar identidad).\n`,
  );
}

async function main() {
  switch (cmd) {
    case "crear": {
      const usuario = flag("usuario");
      if (!usuario) throw new Error("Falta --usuario");
      tabla([await crear(usuario, flag("rol") ?? "student")]);
      break;
    }

    case "lote": {
      const prefijo = flag("prefijo");
      const cantidad = Number(flag("cantidad") ?? "0");
      if (!prefijo || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 200) {
        throw new Error("Uso: users lote --prefijo 7b --cantidad 35");
      }
      const filas: { usuario: string; password: string }[] = [];
      const yaExistian: string[] = [];
      for (let i = 1; i <= cantidad; i++) {
        const u = `${norm(prefijo)}-${String(i).padStart(2, "0")}`;
        try {
          filas.push(await crear(u));
        } catch {
          yaExistian.push(u);
        }
      }
      tabla(filas);
      if (yaExistian.length) {
        console.log(`  (${yaExistian.length} ya existían y no se tocaron: ${yaExistian.join(", ")})\n`);
      }
      break;
    }

    case "listar": {
      const rows = await sql<{
        username: string; role: string; disabled_at: Date | null;
        grade: string | null; sesiones: number; ultimo: Date | null;
      }[]>`
        select u.username, u.role, u.disabled_at, p.grade,
               count(s.id) filter (where s.revoked_at is null and s.expires_at > now()) as sesiones,
               max(s.last_seen_at) as ultimo
        from users u
        left join student_profiles p on p.user_id = u.id
        left join auth_sessions s    on s.user_id = u.id
        group by u.id, u.username, u.role, u.disabled_at, p.grade
        order by u.username`;
      console.log(`\n  ${"USUARIO".padEnd(12)} ${"ROL".padEnd(8)} ${"CURSO".padEnd(6)} ${"SESIONES".padStart(8)}  ÚLTIMO ACCESO`);
      console.log(`  ${"─".repeat(12)} ${"─".repeat(8)} ${"─".repeat(6)} ${"─".repeat(8)}  ${"─".repeat(20)}`);
      for (const r of rows) {
        const marca = r.disabled_at ? " (desactivado)" : "";
        console.log(
          `  ${(r.username ?? "—").padEnd(12)} ${r.role.padEnd(8)} ${(r.grade ?? "—").padEnd(6)} ` +
          `${String(r.sesiones).padStart(8)}  ${r.ultimo ? new Date(r.ultimo).toISOString().slice(0, 16).replace("T", " ") : "nunca"}${marca}`,
        );
      }
      console.log();
      break;
    }

    case "resetear": {
      const usuario = flag("usuario");
      if (!usuario) throw new Error("Falta --usuario");
      const password = generarPassword();
      const hash = await hashPassword(password);
      const [row] = await sql<{ id: string }[]>`
        update users set password_hash = ${hash} where lower(username) = ${norm(usuario)} returning id`;
      if (!row) throw new Error(`No existe el usuario "${usuario}".`);
      // Revocar TODAS sus sesiones: si se resetea porque la contraseña se filtró,
      // dejar viva la sesión de quien la tenía haría inútil el reset.
      const revocadas = await sql`
        update auth_sessions set revoked_at = now()
        where user_id = ${row.id}::uuid and revoked_at is null returning id`;
      tabla([{ usuario: norm(usuario), password }]);
      console.log(`  Se cerraron ${revocadas.length} sesión(es) abiertas de esa cuenta.\n`);
      break;
    }

    case "desactivar":
    case "activar": {
      const usuario = flag("usuario");
      if (!usuario) throw new Error("Falta --usuario");
      const apagar = cmd === "desactivar";
      const [row] = await sql<{ id: string }[]>`
        update users set disabled_at = ${apagar ? new Date() : null}
        where lower(username) = ${norm(usuario)} returning id`;
      if (!row) throw new Error(`No existe el usuario "${usuario}".`);
      if (apagar) {
        await sql`update auth_sessions set revoked_at = now() where user_id = ${row.id}::uuid and revoked_at is null`;
      }
      // Desactivar y no borrar: borrar el usuario cascadearía todo su progreso.
      console.log(`\n  ✓ ${norm(usuario)} ${apagar ? "desactivado (y sesiones cerradas)" : "reactivado"}\n`);
      break;
    }

    default:
      console.log(`
  Gestión de cuentas (anónimas: solo usuario y contraseña).

    users crear      --usuario 7b-01 [--rol student|teacher|admin]
    users lote       --prefijo 7b --cantidad 35
    users listar
    users resetear   --usuario 7b-01     (nueva contraseña + cierra sus sesiones)
    users desactivar --usuario 7b-01     (bloquea sin borrar el progreso)
    users activar    --usuario 7b-01
`);
  }
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  try { await sql.end(); } catch { /* ya cerrado */ }
  process.exit(1);
});
