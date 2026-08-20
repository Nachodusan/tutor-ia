/**
 * MAPA-DOC — genera el documento del mapa curricular desde `curriculum_map`.
 *
 *   pnpm --filter @tutor-ia/eval mapa-doc --salida docs/mapa-curricular.md
 *
 * Es un VOLCADO, no una fuente: la verdad vive en la tabla. Si el documento y la
 * tabla difieren, la tabla manda y hay que regenerar.
 *
 * ── Cómo se ordena, y por qué ────────────────────────────────────────────────
 * Por nivel → materia → estado. Y dentro de cada materia primero lo que SÍ está
 * y después los huecos, porque el documento se usa de dos maneras distintas: un
 * alumno o un profe busca "dónde estudio esto" (necesita las ubicaciones arriba),
 * y quien decide qué material conseguir busca la lista de huecos (que conviene
 * junta y al final, no salpicada).
 *
 * ── Qué NO se muestra ────────────────────────────────────────────────────────
 * Nada de `metodo = 'ubicar-v1'`. Esa fue la corrida del buscador sin lector, y
 * quedó medida en 7 aciertos de 63: sirve como registro histórico en la tabla,
 * no como algo que alguien deba leer.
 */
import { getSql } from "@tutor-ia/db";

interface Tramo {
  map_id: string;
  pagina_desde: number;
  pagina_hasta: number | null;
  que_cubre: string | null;
  seccion: string | null;
}

interface Fila {
  id: string;
  nivel: string;
  materia: string;
  item: string;
  seccion: string | null;
  pagina_desde: number | null;
  pagina_hasta: number | null;
  cita: string | null;
  verificado: string | null;
  verificacion: string | null;
}

const ORDEN = [
  "Nivel 2 Educación Básica",
  "Nivel 3 Educación Básica",
  "Nivel 1 Educación Media",
  "Nivel 2 Educación Media",
];
const CURSOS: Record<string, string> = {
  "Nivel 2 Educación Básica": "6º Básico (5º está cerrado)",
  "Nivel 3 Educación Básica": "7º y 8º Básico",
  "Nivel 1 Educación Media": "1º y 2º Medio",
  "Nivel 2 Educación Media": "3º y 4º Medio",
};

/** El estado, dicho como lo entendería un profe y no como lo guarda la base. */
const SELLO: Record<string, string> = {
  correcto: "✅",
  parcial: "🟡",
  otro_año: "🔁",
  no_esta: "❌",
};

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Primera oración de la nota: el resto es el rastro de búsqueda, útil en la tabla, ruido acá. */
function resumen(t: string | null, max = 300): string {
  if (!t) return "";
  const limpio = t.replace(/^AUDITORÍA[^‖]*‖\s*/, "").replace(/\s+/g, " ").trim();
  return limpio.length > max ? limpio.slice(0, max).replace(/\s+\S*$/, "") + "…" : limpio;
}

async function main(): Promise<void> {
  const destino = arg("salida") ?? "docs/mapa-curricular.md";
  const sql = getSql();
  const filas = await sql<Fila[]>`
    select cm.id, cm.nivel, s.name as materia, cm.item, cm.seccion,
           cm.pagina_desde, cm.pagina_hasta, cm.cita, cm.verificado, cm.verificacion
    from curriculum_map cm join subjects s on s.id = cm.subject_id
    where cm.metodo = 'lector-v1'
    order by cm.nivel, s.name, cm.item`;

  // Los tramos ADICIONALES (orden > 0). El principal ya viaja en la fila madre.
  const tramosFilas = await sql<Tramo[]>`
    select map_id, pagina_desde, pagina_hasta, que_cubre, seccion
    from curriculum_map_tramos where orden > 0
    order by map_id, pagina_desde`;
  const tramos = new Map<string, Tramo[]>();
  for (const t of tramosFilas) {
    const l = tramos.get(t.map_id) ?? [];
    l.push(t);
    tramos.set(t.map_id, l);
  }

  const L: string[] = [];
  const tot = { correcto: 0, parcial: 0, otro_año: 0, no_esta: 0 } as Record<string, number>;
  for (const f of filas) if (f.verificado) tot[f.verificado] = (tot[f.verificado] ?? 0) + 1;

  L.push(
    "# Mapa curricular — dónde está en el libro lo que exige el Estado",
    "",
    "Cada **conocimiento esencial** de las *Bases Curriculares EPJA* (DS 10/2022), ubicado en",
    "el **texto del estudiante** de la materia que le corresponde, con la página y una cita",
    "textual como prueba. Generado desde la tabla `curriculum_map`.",
    "",
    "Fuente del currículum: [`docs/epja-objetivos-por-nivel.md`](epja-objetivos-por-nivel.md).",
    "Alcance: [`docs/materias-por-nivel.md`](materias-por-nivel.md) — Formación General + Filosofía.",
    "**Inglés queda fuera de esta pasada.** Los libros del profesor, también: son la segunda.",
    "",
    "## Cómo leer cada punto",
    "",
    "| | |",
    "|---|---|",
    "| ✅ | El libro lo enseña completo en ese tramo. |",
    "| 🟡 | El libro enseña una parte. La nota dice qué falta o dónde está el resto. |",
    "| 🔁 | El contenido existe, pero en la mitad del OTRO curso del tomo combinado. No es material de este alumno. |",
    "| ❌ | Se buscó con al menos tres formulaciones y no está en el libro. |",
    "",
    "Cada ubicación fue producida por un lector que abrió esas páginas, y **sin cita textual no",
    "se aceptó ninguna**. Una muestra pasó además por un auditor independiente que intentó",
    "refutarla: de 33 auditadas, las 33 citas existían en la página indicada.",
    "",
    "**Los 🟡 son la mayoría, y no es un defecto del mapa.** El currículum agrupa varios temas",
    "por línea — *\"Operaciones con números racionales, potencias, raíces y sus propiedades\"* son",
    "cuatro temas en cuatro páginas distintas. Por eso cada punto trae, además del tramo",
    "principal, la columna **También en** con las otras páginas y qué parte cubre cada una.",
    "Cuando algo falta de verdad, la nota lo dice con las palabras *LO QUE FALTA DE VERDAD*.",
    "",
    `| Estado | Puntos |`,
    "|---|---|",
    `| ✅ cubierto | ${tot.correcto ?? 0} |`,
    `| 🟡 parcial | ${tot.parcial ?? 0} |`,
    `| 🔁 otro curso | ${tot.otro_año ?? 0} |`,
    `| ❌ sin cubrir | ${tot.no_esta ?? 0} |`,
    `| **Total** | **${filas.length}** |`,
    "",
    "---",
    "",
  );

  for (const nivel of ORDEN) {
    const delNivel = filas.filter((f) => f.nivel === nivel);
    if (delNivel.length === 0) continue;
    L.push(`## ${nivel}`, "", `**Cursos:** ${CURSOS[nivel] ?? "—"}`, "");

    const materias = [...new Set(delNivel.map((f) => f.materia))].sort();
    for (const materia of materias) {
      const xs = delNivel.filter((f) => f.materia === materia);
      const ubicados = xs.filter((f) => f.pagina_desde != null && f.verificado !== "otro_año");
      const otroAno = xs.filter((f) => f.verificado === "otro_año");
      const huecos = xs.filter((f) => f.pagina_desde == null);

      L.push(`### ${materia}`, "");
      L.push(
        `${SELLO.correcto} ${xs.filter((f) => f.verificado === "correcto").length} · ` +
          `${SELLO.parcial} ${xs.filter((f) => f.verificado === "parcial").length} · ` +
          `${SELLO.otro_año} ${otroAno.length} · ${SELLO.no_esta} ${huecos.length}`,
        "",
      );

      if (ubicados.length > 0) {
        L.push("| | Punto a trabajar | Dónde se enseña | Págs. | También en |", "|---|---|---|---|---|");
        for (const f of ubicados) {
          const donde = f.seccion?.trim() ? f.seccion.replace(/\|/g, "·") : "*(el índice del libro no sirvió acá)*";
          const pags =
            f.pagina_hasta && f.pagina_hasta !== f.pagina_desde
              ? `${f.pagina_desde}–${f.pagina_hasta}`
              : `${f.pagina_desde}`;
          // "También en" es la razón de ser de curriculum_map_tramos: un conocimiento
          // que junta varios temas vive en varias páginas, y sin esta columna el
          // alumno solo ve una de ellas.
          const otros = (tramos.get(f.id) ?? [])
            .map((t) => (t.pagina_hasta && t.pagina_hasta !== t.pagina_desde
              ? `${t.pagina_desde}–${t.pagina_hasta}`
              : `${t.pagina_desde}`))
            .join(", ");
          L.push(
            `| ${SELLO[f.verificado ?? ""] ?? ""} | ${f.item.replace(/\|/g, "·")} | ${donde} | ${pags} | ${otros || "—"} |`,
          );
        }
        L.push("");
        // Las citas y las notas van APARTE de la tabla: adentro la rompen, y el que
        // busca "dónde estudio esto" no las necesita en el primer vistazo.
        for (const f of ubicados) {
          const nota = resumen(f.verificacion);
          if (!f.cita && !nota && (tramos.get(f.id) ?? []).length === 0) continue;
          L.push(`**${f.item.slice(0, 90)}**`);
          if (f.cita) L.push(`> «${f.cita.replace(/\s+/g, " ").trim()}» — pág. ${f.pagina_desde}`);
          const ts = tramos.get(f.id) ?? [];
          if (ts.length > 0) {
            L.push(`> `);
            for (const t of ts) {
              const p = t.pagina_hasta && t.pagina_hasta !== t.pagina_desde
                ? `${t.pagina_desde}–${t.pagina_hasta}` : `${t.pagina_desde}`;
              L.push(`> · **págs. ${p}** — ${t.que_cubre ?? "(sin detalle)"}`);
            }
          }
          if (nota) L.push(`> `, `> ${nota}`);
          L.push("");
        }
      }

      if (otroAno.length > 0) {
        L.push(`**${SELLO.otro_año} Están en el tomo, pero en la mitad del otro curso**`, "");
        for (const f of otroAno)
          L.push(`- ${f.item} — págs. ${f.pagina_desde}–${f.pagina_hasta}`);
        L.push("");
      }

      if (huecos.length > 0) {
        L.push(`**${SELLO.no_esta} No están en este libro**`, "");
        for (const f of huecos) {
          L.push(`- **${f.item}**`);
          const nota = resumen(f.verificacion, 400);
          if (nota) L.push(`  ${nota}`);
        }
        L.push("");
      }
    }
    L.push("---", "");
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(destino, L.join("\n") + "\n", "utf8");
  process.stderr.write(
    `${destino} · ${filas.length} puntos · ✅${tot.correcto ?? 0} 🟡${tot.parcial ?? 0} 🔁${tot.otro_año ?? 0} ❌${tot.no_esta ?? 0}\n`,
  );
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
