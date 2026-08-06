/**
 * HUECOS DE MATERIAL — qué preguntan los alumnos que su libro no cubre.
 *
 * Lee `content_gaps` (la llena /api/chat cada vez que un turno se responde con
 * material de fuera del libro del curso, o sin material). Es la lista de compras
 * de material con demanda real: qué conseguir, escanear o ingestar después.
 *
 * Cómo leer `score` (el mejor score del retrieval en ese turno):
 *   ~0        → no está en NINGÚN libro ingestado: hay que conseguir material.
 *   alto (>0.5) → material parecido existe pero no en el libro del curso:
 *               puede ser hueco real del libro o fallo de encuadre del motor.
 *
 * PRIVACIDAD: esta tabla no tiene user_id y este comando es SOLO de admin.
 * `question` conserva la formulación del alumno — jamás exponer en /docente.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/admin gaps listar [--dias 30] [--top 40]
 */
import { getSql } from "@tutor-ia/db";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "listar";
const flag = (n: string): string | null => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
};

const sql = getSql();

async function listar(): Promise<void> {
  const dias = Number(flag("dias") ?? "30") || 30;
  const top = Number(flag("top") ?? "40") || 40;

  // Agregado por materia + pregunta normalizada a minúsculas/espacios. Es un
  // agrupado grueso (dos formulaciones distintas del mismo tema no se juntan);
  // alcanza para ver la demanda — la normalización a "tema" vendrá con datos.
  const filas = await sql<{
    subject: string | null;
    question: string;
    scope: string;
    veces: number;
    best_score: number | null;
    ultima: Date;
  }[]>`
    select coalesce(s.name, '(sin materia)') as subject,
           lower(regexp_replace(g.question, '\\s+', ' ', 'g')) as question,
           g.scope,
           count(*)::int as veces,
           max(g.top_score) as best_score,
           max(g.created_at) as ultima
    from content_gaps g
    left join subjects s on s.id = g.subject_id
    where g.created_at > now() - make_interval(days => ${dias})
    group by 1, 2, 3
    order by veces desc, ultima desc
    limit ${top}`;

  if (filas.length === 0) {
    console.log(`Sin huecos registrados en los últimos ${dias} días. 🎉`);
    return;
  }
  console.log(
    `Huecos de material — últimos ${dias} días (${filas.length} temas distintos):\n`,
  );
  for (const f of filas) {
    const score = f.best_score == null ? "  —  " : f.best_score.toFixed(2);
    console.log(
      `  ${String(f.veces).padStart(3)}× · score ${score} · ${f.scope.padEnd(12)} · [${f.subject}] ${f.question.slice(0, 90)}`,
    );
  }
  console.log(
    `\nscore ~0 = conseguir material; score alto = existe en otro libro (¿hueco del libro o encuadre del motor?).`,
  );
}

if (cmd === "listar") {
  await listar();
} else {
  console.error(`Comando desconocido "${cmd}". Uso: gaps listar [--dias 30] [--top 40]`);
  process.exit(1);
}
process.exit(0);
