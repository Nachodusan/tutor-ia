/**
 * DIAGNÓSTICO DE LA SIMULACIÓN DE PRUEBA.
 *
 * Corre los MISMOS pasos que `POST /api/test`, sin pasar por HTTP ni por auth,
 * para ver en cuál se rompe y con qué. La ruta responde 503 con un texto amable
 * ("No pude armar una prueba confiable…") que no dice nada sobre la causa, así
 * que desde el navegador el fallo es opaco.
 *
 *   pnpm --filter @tutor-ia/eval prueba-diag                  → todas las de 1º Medio
 *   pnpm --filter @tutor-ia/eval prueba-diag --materia <uuid>
 *   pnpm --filter @tutor-ia/eval prueba-diag --curso 1M --repeticiones 2
 */
import { generarPreguntas, SinPreguntas, type QuizItem } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";
import { getPlanTopics, type PlanTopic } from "@tutor-ia/rag";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : d;
};
const CURSO = arg("curso", "1M")!;
const REPS = Number(arg("repeticiones", "1"));
const UNA = arg("materia");

/**
 * COPIA DE `apps/web/app/reparto-prueba.ts`, y a propósito.
 *
 * Importarlo cruzando de `packages/eval` a `apps/web` rompe el `rootDir` del
 * paquete (TS6059). Son diez líneas sin dependencias, así que se duplican en
 * vez de mover el módulo a un paquete compartido solo por un diagnóstico.
 * ⚠️ Si cambia el reparto allá, cambiarlo acá: este banco dejaría de reproducir
 * lo que hace la ruta, que es su única razón de existir.
 */
const TOPE_TEMAS = 10;
const OBJETIVO = 8;
function repartoPrueba(elegidos: number) {
  const temas = Math.min(Math.max(elegidos, 0), TOPE_TEMAS);
  if (temas === 0) return { temas: 0, porTema: 0, total: 0, recortados: 0 };
  const porTema = Math.min(OBJETIVO, Math.max(1, Math.round(OBJETIVO / temas)));
  return { temas, porTema, total: temas * porTema, recortados: Math.max(0, elegidos - TOPE_TEMAS) };
}

interface Paso { paso: string; ok: boolean; ms: number; detalle: string }

async function diagnosticar(subjectId: string, nombre: string): Promise<Paso[]> {
  const sql = getSql();
  const pasos: Paso[] = [];
  const cron = async <T>(paso: string, f: () => Promise<T>): Promise<T | null> => {
    const t = Date.now();
    try {
      const r = await f();
      pasos.push({ paso, ok: true, ms: Date.now() - t, detalle: "" });
      return r;
    } catch (e) {
      pasos.push({ paso, ok: false, ms: Date.now() - t, detalle: (e as Error).message.slice(0, 150) });
      return null;
    }
  };

  // 1) LOS TEMAS. Sin elección del alumno: el camino de "tomame de todo".
  const temas = await cron("getPlanTopics", () =>
    getPlanTopics(subjectId, { limit: 6, spread: true })) as PlanTopic[] | null;
  if (!temas) return pasos;

  pasos[pasos.length - 1]!.detalle = `${temas.length} temas`;
  if (temas.length < 2) {
    pasos.push({ paso: "CORTE", ok: false, ms: 0, detalle: `solo ${temas.length} tema(s) → la ruta devuelve items: [] y la UI muestra una prueba vacía` });
    return pasos;
  }

  // ¿Los temas traen material? Es lo que alimenta al modelo.
  const sinMuestra = temas.filter((t) => !t.sample || t.sample.trim().length < 200).length;
  pasos.push({
    paso: "material por tema", ok: sinMuestra === 0, ms: 0,
    detalle: `${temas.length - sinMuestra}/${temas.length} con muestra usable · ` +
      `largo medio ${Math.round(temas.reduce((n, t) => n + (t.sample?.length ?? 0), 0) / temas.length)} chars`,
  });

  const reparto = repartoPrueba(temas.length);

  const evalRows = (await sql`
    select left(string_agg(ch.content, ' ' order by ch.chunk_index), 1000) as sample
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId} and ch.corpus_role = 'pedagogy'
      and ch.pedagogy_type in ('evaluacion', 'proposito')
  `) as unknown as { sample: string | null }[];
  const evalFocus = (evalRows[0]?.sample ?? "").replace(/\s+/g, " ").slice(0, 750);

  // 2) LAS TANDAS, igual que la ruta: de a 4 temas, en paralelo.
  const GRUPO = 4;
  const grupos: PlanTopic[][] = [];
  for (let i = 0; i < temas.length; i += GRUPO) grupos.push(temas.slice(i, i + GRUPO));

  const t0 = Date.now();
  const tandas = await Promise.allSettled(
    grupos.map((g) =>
      generarPreguntas(
        g.map((t) => ({ key: t.key, title: t.title, sample: t.sample })),
        { subjectName: nombre, evalFocus, porTema: reparto.porTema, tipos: ["multiple", "vf", "abierta"] },
      ),
    ),
  );
  const ms = Date.now() - t0;

  const okTandas = tandas.filter((t) => t.status === "fulfilled").length;
  const generadas: QuizItem[] = tandas.flatMap((t) => (t.status === "fulfilled" ? t.value : []));

  for (const [i, t] of tandas.entries()) {
    if (t.status === "rejected") {
      const r = t.reason;
      pasos.push({
        paso: `tanda ${i + 1}/${grupos.length}`, ok: false, ms,
        detalle: r instanceof SinPreguntas
          ? `SinPreguntas(razon="${r.razon}")${r.causa ? ` · ${r.causa}` : ""}`
          : `${(r as Error)?.name ?? "Error"}: ${String((r as Error)?.message).slice(0, 140)}`,
      });
    } else {
      pasos.push({ paso: `tanda ${i + 1}/${grupos.length}`, ok: true, ms, detalle: `${t.value.length} preguntas` });
    }
  }

  // 3) LOS CORTES DE LA RUTA, que son los que producen el 503 en pantalla.
  pasos.push({
    paso: "VEREDICTO", ok: generadas.length >= 2,
    ms,
    detalle:
      generadas.length === 0
        ? `503 — las ${grupos.length} tandas fallaron`
        : generadas.length < 2 && reparto.total >= 2
          ? `503 — solo ${generadas.length} pregunta sobrevivió (el verificador tachó el resto)`
          : `OK — ${generadas.length} preguntas de ${reparto.total} pedidas (${okTandas}/${grupos.length} tandas)`,
  });

  return pasos;
}

async function main() {
  const sql = getSql();
  const materias = UNA
    ? await sql<{ id: string; name: string }[]>`select id, name from subjects where id = ${UNA}::uuid`
    : await sql<{ id: string; name: string }[]>`
        select s.id, s.name
        from subjects s join documents d on d.subject_id = s.id
        where s.disabled_at is null and d.grade = ${CURSO}
        group by s.id, s.name order by s.name`;

  console.log(`Diagnóstico de la simulación de prueba · ${materias.length} materia(s)\n`);

  const resumen: { materia: string; veredicto: string }[] = [];

  for (const m of materias) {
    for (let r = 0; r < REPS; r++) {
      console.log(`── ${m.name}${REPS > 1 ? ` (intento ${r + 1})` : ""}`);
      const pasos = await diagnosticar(m.id, m.name);
      for (const p of pasos) {
        console.log(`   ${p.ok ? "✓" : "✗"} ${p.paso.padEnd(22)} ${String(p.ms).padStart(6)} ms  ${p.detalle}`);
      }
      const v = pasos.find((p) => p.paso === "VEREDICTO") ?? pasos[pasos.length - 1]!;
      resumen.push({ materia: m.name, veredicto: `${v.ok ? "OK" : "FALLA"} · ${v.detalle}` });
      console.log();
    }
  }

  console.log("─".repeat(78));
  for (const r of resumen) console.log(`  ${r.veredicto.startsWith("OK") ? "✓" : "✗"} ${r.materia.padEnd(46)} ${r.veredicto}`);
  const fallan = resumen.filter((r) => !r.veredicto.startsWith("OK")).length;
  console.log(`\n  ${resumen.length - fallan} de ${resumen.length} arman prueba.`);

  await sql.end?.();
}

void main();
