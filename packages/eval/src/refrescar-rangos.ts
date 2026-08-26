/**
 * Refresca `p0`/`p1` de las paradas guardadas en `subject_plans` contra lo que
 * dice hoy `book_sections`.
 *
 *   pnpm --filter @tutor-ia/eval refrescar-rangos --aplicar
 *
 * ⚠️ POR QUÉ NO `plans generar --forzar`. Ese comando rehace el plan llamando al
 * modelo para reescribir los títulos de unidad: son minutos por materia y horas
 * para el corpus. Acá lo único que cambió son DOS NÚMEROS por fila —el rango de
 * páginas— y el resto del plan está bien.
 *
 * Y hay una razón más fuerte: regenerar puede cambiar títulos, y el título entra
 * en `topic_key`, que es la identidad del alumno en siete tablas más el jsonb del
 * propio plan. Refrescar el rango no toca la clave: es la operación barata.
 *
 * La correspondencia se hace por CLAVE, no por posición: dos paradas del mismo
 * libro pueden compartir título y el orden del plan no es el de book_sections.
 */
import { getSql, toJson } from "@tutor-ia/db";

const sql = getSql();
const APLICAR = process.argv.includes("--aplicar");

/** Igual que `claveTema` en packages/rag/src/sections.ts. */
function clave(documentId: string, ord: number, title: string): string {
  const base = `${documentId}|${ord}|${title.toLowerCase().replace(/\s+/g, " ").trim()}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0;
  return `s${(h >>> 0).toString(36)}`;
}

const secciones = (await sql`
  select document_id, ord, title, page_start, page_end from book_sections
  where method <> 'unidad_chunks'`) as unknown as {
  document_id: string; ord: number; title: string; page_start: number; page_end: number;
}[];
const porClave = new Map(secciones.map((s) => [clave(s.document_id, s.ord, s.title), s]));

interface Leccion { key: string; p0?: number; p1?: number; title?: string }
interface Item { lecciones?: Leccion[] }
const planes = (await sql`
  select sp.subject_id, s.name, sp.items from subject_plans sp
  join subjects s on s.id = sp.subject_id order by s.name`) as unknown as {
  subject_id: string; name: string; items: Item[];
}[];

let cambios = 0, materias = 0, huerfanas = 0;
for (const p of planes) {
  let toco = false;
  const nuevos = (p.items ?? []).map((it) => {
    const lecc = (it.lecciones ?? []).map((l) => {
      const s = porClave.get(l.key);
      if (!s) { huerfanas++; return l; }
      if (s.page_start === l.p0 && s.page_end === l.p1) return l;
      console.log(`  ${p.name.slice(0, 26).padEnd(26)}  ${String(l.title ?? l.key).slice(0, 38).padEnd(38)}  p.${l.p0}-${l.p1} → p.${s.page_start}-${s.page_end}`);
      cambios++; toco = true;
      return { ...l, p0: s.page_start, p1: s.page_end };
    });
    return toco ? { ...it, lecciones: lecc } : it;
  });
  if (!toco) continue;
  materias++;
  if (APLICAR) {
    await sql`update subject_plans set items = ${toJson(sql, nuevos)} where subject_id = ${p.subject_id}`;
  }
}
console.log(`\n${cambios} paradas con el rango desactualizado, en ${materias} materias`);
if (huerfanas > 0) console.log(`${huerfanas} paradas del plan ya no existen en book_sections (el índice cambió; se dejan como están)`);
if (!APLICAR && cambios > 0) console.log(`\nEnsayo: no se escribió nada. Con --aplicar se refrescan.`);
await sql.end();
