/**
 * Repasa los apuntes YA GUARDADOS y les saca los bloques que dicen venir de la
 * guía docente cuando esa guía no tiene nada para esa lección.
 *
 * No regenera: el resto del apunte está bien y regenerar cuesta una hora de
 * modelo. Solo saca lo que la pantalla firma y el dato no sostiene.
 */
import { getSql, toJson } from "@tutor-ia/db";
import { errorFrecuente, queSeEvalua } from "./paradas-lib";

const sql = getSql();
const APLICAR = process.argv.includes("--aplicar");

const filas = (await sql`
  select subject_id, topic_key, topic_title, apunte from lesson_notes
  order by topic_key`) as unknown as {
  subject_id: string; topic_key: string; topic_title: string | null;
  apunte: { ojo: string | null; seEvalua: string[] };
}[];

let sinOjo = 0, sinChips = 0;
for (const f of filas) {
  const titulo = f.topic_title ?? "";
  const [ef, ev] = await Promise.all([
    errorFrecuente(f.subject_id, titulo),
    queSeEvalua(f.subject_id, titulo),
  ]);
  const quitarOjo = f.apunte.ojo != null && !ef;
  const quitarChips = (f.apunte.seEvalua?.length ?? 0) > 0 && !ev;
  if (!quitarOjo && !quitarChips) continue;

  if (quitarOjo) sinOjo++;
  if (quitarChips) sinChips++;
  console.log(`  ${f.topic_key}  ${left(titulo, 44)}` +
    (quitarOjo ? "  · ojo SIN fuente" : "") + (quitarChips ? "  · chips SIN fuente" : ""));

  if (APLICAR) {
    const nuevo = {
      ...f.apunte,
      ojo: quitarOjo ? null : f.apunte.ojo,
      seEvalua: quitarChips ? [] : f.apunte.seEvalua,
    };
    await sql`update lesson_notes set apunte = ${toJson(sql, nuevo)}
              where subject_id = ${f.subject_id} and topic_key = ${f.topic_key}`;
  }
}
function left(s: string, n: number) { return s.length > n ? s.slice(0, n) + "…" : s.padEnd(n); }

console.log(`\n${filas.length} apuntes · ${sinOjo} con "ojo" sin fuente · ${sinChips} con chips sin fuente`);
if (!APLICAR && (sinOjo || sinChips)) console.log("Ensayo: no se escribió nada. Con --aplicar se limpian.");
await sql.end();
