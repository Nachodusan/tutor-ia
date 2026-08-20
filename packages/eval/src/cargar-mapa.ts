/**
 * CARGAR-MAPA — mete la salida de `ubicar` en la tabla `curriculum_map`.
 *
 *   pnpm --filter @tutor-ia/eval cargar-mapa --entrada /tmp/mapa_1m2m.json
 *   pnpm --filter @tutor-ia/eval cargar-mapa --entrada /tmp/mapa.json --veredictos /tmp/ver.json
 *
 * `--veredictos` es opcional y espera el JSON del verificador adversarial:
 * `[{ conocimiento, materia, veredicto, por_que }]`. Sin él las filas quedan con
 * `verificado = null`, que significa "todavía nadie lo revisó" — y esas filas NO
 * se le muestran a un alumno.
 *
 * ── Lo que NO se pierde ───────────────────────────────────────────────────────
 * Los ítems que el buscador no encontró se guardan igual, con `pagina_desde` en
 * null. Es la mitad que contesta "¿qué exige el Estado que ningún libro cubre?".
 * Si se guardaran solo los encontrados, un hueco sería indistinguible de un ítem
 * que nunca se buscó.
 *
 * Es idempotente: re-correrlo actualiza en vez de duplicar (índice único por
 * materia + rol + método + ítem).
 */
import { getSql } from "@tutor-ia/db";

interface Seccion {
  titulo: string;
  unidad: number | null;
  leccion: number | null;
  pagina_desde: number | null;
  pagina_hasta: number | null;
  score: number;
}
interface Fila {
  materia: string;
  texto: string;
  capa?: string;
  nivel?: string;
  asignatura?: string;
  encontrado: boolean;
  top_score: number;
  secciones: Seccion[];
  evidencia: { pagina: number | null; cita: string }[];
  error?: string;
}
interface Veredicto {
  conocimiento: string;
  materia: string;
  veredicto: string;
  por_que?: string;
}

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Los veredictos truncan el conocimiento a ~80 chars: se casa por prefijo normalizado. */
const norm = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);

async function main(): Promise<void> {
  const entrada = arg("entrada");
  if (!entrada) {
    console.error(
      "uso: cargar-mapa --entrada <salida-de-ubicar.json> [--veredictos <ver.json>] [--metodo ubicar-v1]",
    );
    process.exit(1);
  }
  const metodo = arg("metodo") ?? "ubicar-v1";
  const fs = await import("node:fs/promises");
  const filas: Fila[] = JSON.parse(await fs.readFile(entrada, "utf8"));

  const ver = new Map<string, Veredicto>();
  const rutaVer = arg("veredictos");
  if (rutaVer) {
    const vs: Veredicto[] = JSON.parse(await fs.readFile(rutaVer, "utf8"));
    for (const v of vs) ver.set(`${v.materia}|${norm(v.conocimiento)}`, v);
    process.stderr.write(`veredictos cargados: ${vs.length}\n`);
  }

  const sql = getSql();
  let ok = 0;
  let huecos = 0;
  let saltados = 0;

  for (const f of filas) {
    if (f.error) {
      saltados += 1;
      continue;
    }
    const [m] = await sql<{ id: string }[]>`
      select id from subjects where name = ${f.materia} limit 1`;
    if (!m) {
      saltados += 1;
      process.stderr.write(`⚠️  sin materia: ${f.materia}\n`);
      continue;
    }

    // Solo se toma la MEJOR sección. Las otras candidatas viven en el JSON; la
    // tabla contesta "dónde estudio esto", que admite una respuesta, no cuatro.
    const s = f.secciones[0] ?? null;
    const cita = f.evidencia[0]?.cita ?? null;
    // Si el índice del libro no sirvió (secciones vacías) pero SÍ hubo evidencia,
    // se guarda la página del chunk: peor granularidad, pero ubica igual.
    const desde = s?.pagina_desde ?? (f.encontrado ? (f.evidencia[0]?.pagina ?? null) : null);
    const hasta = s?.pagina_hasta ?? desde;
    if (desde == null) huecos += 1;
    else ok += 1;

    const v = ver.get(`${f.materia}|${norm(f.texto)}`) ?? null;

    await sql`
      insert into curriculum_map (
        nivel, asignatura, capa, item,
        subject_id, corpus_role,
        seccion, unidad, leccion, pagina_desde, pagina_hasta, cita,
        score, metodo, verificado, verificacion
      ) values (
        ${f.nivel ?? "?"}, ${f.asignatura ?? "?"}, ${f.capa ?? "conocimiento esencial"}, ${f.texto},
        ${m.id}::uuid, 'content',
        ${s?.titulo ?? null}, ${s?.unidad ?? null}, ${s?.leccion ?? null}, ${desde}, ${hasta}, ${cita},
        ${f.top_score}, ${metodo}, ${v?.veredicto ?? null}, ${v?.por_que ?? null}
      )
      on conflict (subject_id, corpus_role, metodo, md5(item)) do update set
        nivel = excluded.nivel, asignatura = excluded.asignatura, capa = excluded.capa,
        seccion = excluded.seccion, unidad = excluded.unidad, leccion = excluded.leccion,
        pagina_desde = excluded.pagina_desde, pagina_hasta = excluded.pagina_hasta,
        cita = excluded.cita, score = excluded.score,
        verificado = excluded.verificado, verificacion = excluded.verificacion,
        updated_at = now()`;
  }

  process.stderr.write(
    `\n── ${ok} ubicaciones · ${huecos} huecos declarados · ${saltados} saltados\n`,
  );
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
