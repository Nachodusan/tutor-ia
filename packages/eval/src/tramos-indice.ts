/**
 * TRAMOS-ÍNDICE — todas las lecciones del libro que enseñan un conocimiento.
 *
 *   pnpm --filter @tutor-ia/eval tramos-indice --area "ciencias naturales"
 *   pnpm --filter @tutor-ia/eval tramos-indice --materia "Física 1º Medio" --aplicar
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 * `curriculum_map` guarda UN rango por conocimiento y `curriculum_map_tramos`
 * los demás, pero esos "demás" se extrajeron de la prosa que un revisor había
 * escrito a mano en `verificacion`. Donde nadie escribió prosa, quedó el tramo
 * principal solo. Medido el 2026-08-23: de 520 tramos, 213 son el principal
 * copiado, y las materias de ciencias tienen 1,0 tramos por fila.
 *
 * El efecto en pantalla: Física 1º Medio marca "Características y propiedades
 * del sonido y la luz" en las páginas 25-30 —UNA lección— cuando el libro las
 * enseña de la 5 a la 56, que son 22 lecciones. El alumno ve 1 pilar en 88.
 *
 * ── Por qué se pregunta sobre el ÍNDICE y no sobre los chunks ───────────────
 * Porque el índice del libro es una lista corta, real y ya verificada, y el
 * modelo solo puede ELEGIR de esa lista: no puede inventar una página. Buscar
 * por chunks es lo que hace `ubicar`, y midió 7 aciertos de 63 — el parecido
 * léxico entre un conocimiento normativo y un párrafo del libro es débil,
 * mientras que "¿Qué es el sonido?" contra "propiedades del sonido y la luz" es
 * una decisión que se toma leyendo dos títulos.
 *
 * ── Qué NO hace ────────────────────────────────────────────────────────────
 * No cruza libros. Los tramos son rangos de página y las páginas son de CADA
 * tomo: la 40 de Química no es la 40 de Física. Un conocimiento que este libro
 * no enseña no se convierte en tramo — sale en el bloque de pendientes del
 * camino, que sí nombra el libro hermano.
 *
 * Sin `--aplicar` no escribe nada: imprime lo que haría.
 */
import { chatText } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

const sql = getSql();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APLICAR = process.argv.includes("--aplicar");
/**
 * TOPE DE PÁGINAS POR LECCIÓN — el mismo criterio que `ubicar --max-tramo`.
 * El índice parseado tiene secciones de 60 páginas ("¿Qué son los compuestos
 * orgánicos?", p.136-196 en Química 1º Medio), la patología que documenta
 * `schema_book_sections.sql`. Marcar una de esas como pilar no le dice al alumno
 * dónde estudiar: le señala un tercio del libro. Una lección real ronda las 19.
 */
const MAX_TRAMO = Number(arg("max-tramo") ?? 40);

interface Leccion { ord: number; title: string; page_start: number; page_end: number }

const SYSTEM = `Sos un profesor que conoce el currículum chileno y tiene el índice de un libro de texto.

Te doy un CONOCIMIENTO ESENCIAL que exige el Estado y la lista de LECCIONES del libro.
Decidí qué lecciones enseñan ese conocimiento.

Reglas:
- Respondé SOLO con los números de lección, separados por comas. Ejemplo: 3, 4, 5, 12
- Si ninguna lección lo enseña, respondé exactamente: NINGUNA
- Elegí solo de la lista. No inventes números.
- Incluí TODAS las que corresponden, no solo la más obvia: un conocimiento suele
  ocupar una unidad entera del libro.
- No incluyas lecciones que solo lo mencionan de paso, ni evaluaciones, síntesis,
  proyectos o páginas de repaso.`;

async function main(): Promise<void> {
  const filtroArea = arg("area");
  const filtroMateria = arg("materia");
  if (!filtroArea && !filtroMateria) {
    console.error('uso: tramos-indice (--area "ciencias naturales" | --materia "Física 1º Medio") [--aplicar]');
    process.exit(1);
  }

  const filas = await sql<{
    map_id: string; item: string; subject_id: string; materia: string; verificado: string;
  }[]>`
    select cm.id map_id, cm.item, s.id subject_id, s.name materia, cm.verificado
    from curriculum_map cm
    join subjects s on s.id = cm.subject_id
    where cm.metodo = 'lector-v1'
      and cm.verificado in ('correcto', 'parcial')
      and s.disabled_at is null
      and (${filtroArea ?? null}::text is null or s.area = ${filtroArea ?? null})
      and (${filtroMateria ?? null}::text is null or s.name = ${filtroMateria ?? null})
      -- Sin índice legible no hay lecciones que marcar.
      and exists (select 1 from book_sections bs where bs.subject_id = s.id and bs.level = 2)
    order by s.name, cm.item`;

  console.log(`${filas.length} conocimiento(s) a expandir${APLICAR ? "" : "  ·  SIMULACIÓN (sin --aplicar)"}\n`);

  const porMateria = new Map<string, Leccion[]>();
  let nuevos = 0;

  for (const f of filas) {
    if (!porMateria.has(f.subject_id)) {
      porMateria.set(f.subject_id, await sql<Leccion[]>`
        select bs.ord, bs.title, bs.page_start, bs.page_end
        from book_sections bs
        where bs.subject_id = ${f.subject_id}::uuid and bs.level = 2
          and bs.page_end - bs.page_start <= ${MAX_TRAMO}
        order by bs.page_start`);
    }
    const lecciones = porMateria.get(f.subject_id)!;
    if (lecciones.length === 0) continue;

    const lista = lecciones
      .map((l, i) => `${i + 1}. ${l.title} (p.${l.page_start}-${l.page_end})`)
      .join("\n");

    const out = await chatText(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `CONOCIMIENTO ESENCIAL:\n${f.item}\n\nLECCIONES DE "${f.materia}":\n${lista}` },
      ],
      { temperature: 0, maxTokens: 300 },
    );

    // Solo números, y solo los que existen en la lista: el modelo elige, no inventa.
    const elegidas = [...new Set(
      (out.match(/\d+/g) ?? [])
        .map((n) => Number(n))
        .filter((n) => n >= 1 && n <= lecciones.length),
    )].sort((a, b) => a - b).map((n) => lecciones[n - 1]!);

    console.log(`── ${f.materia} · ${f.item.slice(0, 58)}`);
    if (elegidas.length === 0) {
      console.log(`   (el modelo no eligió ninguna: "${out.trim().slice(0, 60)}")\n`);
      continue;
    }
    console.log(`   ${elegidas.length} lección(es):`);
    for (const l of elegidas) console.log(`     · ${l.title.slice(0, 56)} (p.${l.page_start}-${l.page_end})`);
    console.log("");

    if (APLICAR) {
      for (const [i, l] of elegidas.entries()) {
        // `on conflict do nothing`: el índice único cubre (map_id, desde, hasta),
        // así que re-correr no duplica y el tramo principal ya cargado se respeta.
        const res = await sql`
          insert into curriculum_map_tramos (map_id, orden, seccion, pagina_desde, pagina_hasta, que_cubre, fuente)
          values (${f.map_id}::uuid, ${i + 1}, ${l.title}, ${l.page_start}, ${l.page_end},
                  ${l.title}, 'indice')
          on conflict do nothing
          returning id`;
        nuevos += res.length;
      }
    }
  }

  console.log(APLICAR ? `\n✓ ${nuevos} tramo(s) nuevos.` : "\nSimulación: nada escrito. Agregá --aplicar.");
  process.exit(0);
}

void main();
