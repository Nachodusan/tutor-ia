/**
 * FALTANTES-DOC — el documento de lo que hay que conseguir, materia por materia.
 *
 *   pnpm --filter @tutor-ia/eval faltantes-doc --salida docs/contenidos-faltantes.md
 *
 * Es un VOLCADO, no una fuente: la verdad vive en `curriculum_map`. Si el
 * documento y la tabla difieren, manda la tabla y hay que regenerar.
 *
 * ── Qué se considera "falta" ───────────────────────────────────────────────
 * Dos cosas distintas, y se separan porque se consiguen distinto:
 *
 *   NO ESTÁ    el libro de esa materia no lo enseña. Puede estar en otro libro
 *              del alumno —y entonces no hay nada que conseguir, hay que
 *              mandarlo ahí— o en ninguno, y ahí sí hay que buscar material.
 *
 *   INCOMPLETO el libro lo toca pero le falta una parte. Es el caso más común
 *              y el más accionable: el lector escribió QUÉ parte falta, así que
 *              se puede ir a buscar exactamente eso en vez de un tema entero.
 *
 * `correcto` no aparece: no falta nada.
 *
 * Se ordena por curso y materia, y dentro de cada materia lo que no está va
 * primero — es lo que puede dejar a un alumno sin nada que leer.
 */
import { getSql } from "@tutor-ia/db";
import { pendientesDe } from "@tutor-ia/rag";

const sql = getSql();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const ORDEN = ["6B", "7B", "8B", "1M", "2M", "3M", "4M"];
const CURSO: Record<string, string> = {
  "6B": "6º Básico", "7B": "7º Básico", "8B": "8º Básico",
  "1M": "1º Medio", "2M": "2º Medio", "3M": "3º Medio", "4M": "4º Medio",
};
const SELLO: Record<string, string> = {
  no_esta: "🔴 No está en este libro",
  "otro_año": "🟠 Está en el tomo, pero en la mitad del otro curso",
  parcial: "🟡 Incompleto",
};

interface Fila {
  subject_id: string; materia: string; curso: string; asignatura: string;
  item: string; verificado: string; pagina_desde: number | null;
  pagina_hasta: number | null; verificacion: string | null; doc: string | null;
  /** La descomposición oficial del programa EPJA y su cobertura medida. */
  componentes: string[] | null;
  cobertura: { c: string; ok: boolean; pag: number | null;
    en?: { materia: string; pag: number | null } }[] | null;
}

/**
 * El texto del lector, dejado en lo que le sirve a quien va a conseguir material.
 *
 * Viene con el rastro de las auditorías: la lista de términos que se probaron
 * ("Términos probados: biodiversidad, endémic, nativ, …" — a veces treinta), las
 * marcas de quién lo revisó, y varios tramos separados por ‖. Todo eso es la
 * evidencia de que el veredicto es serio, y sirve para auditar el mapa; para
 * decidir QUÉ COMPRAR es ruido que tapa la frase útil.
 *
 * Cuando el lector escribió "LO QUE FALTA DE VERDAD", esa es la frase y el resto
 * sobra. Si no, se sacan las listas de términos y se deja la prosa.
 */
function limpiar(s: string | null): string {
  let t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const puntual = /LO QUE FALTA DE VERDAD:\s*(.+)$/i.exec(t);
  if (puntual?.[1]) return puntual[1].trim();
  t = t
    // La lista de términos y el sello del auditor no le dicen nada a quien compra.
    .replace(/T[ée]rminos probados:.*?(?=‖|$)/gi, "")
    .replace(/HUECO CONFIRMADO por un segundo lector\.\s*/gi, "")
    .replace(/RESCATADO por el auditor de huecos:\s*/gi, "")
    .replace(/\[(?:buscar-huecos|reverificado)[^\]]*\]\s*/gi, "");
  // Los tramos que quedan van como párrafos del mismo blockquote.
  const texto = t.split("‖").map((x) => x.trim()).filter(Boolean).join("\n>\n> ");
  // El veredicto se guardó cortado a 900 caracteres, así que a veces termina a
  // media palabra. Se marca: un corte sin avisar parece un error del documento.
  return /[.!?)\]"']$/.test(texto) ? texto : `${texto}…`;
}

async function main(): Promise<void> {
  const salida = arg("salida") ?? "docs/contenidos-faltantes.md";

  const filas = await sql<Fila[]>`
    select cm.subject_id, s.name materia,
           (select max(d.grade) from documents d where d.subject_id = s.id) curso,
           coalesce(cm.asignatura, '') asignatura,
           cm.item, cm.verificado, cm.pagina_desde, cm.pagina_hasta, cm.verificacion,
           (select d2.title from documents d2 where d2.id = cm.document_id) doc,
           cm.componentes, cm.componentes_cobertura cobertura
    from curriculum_map cm
    join subjects s on s.id = cm.subject_id
    where cm.metodo = 'lector-v1'
      and cm.verificado in ('no_esta', 'otro_año', 'parcial')
      and s.disabled_at is null
      and (select max(d.grade) from documents d where d.subject_id = s.id)
          not in ('1B','2B','3B','4B','5B')
    order by cm.verificado, cm.item`;

  // Dónde sí está cada hueco, con el mismo criterio que ve el alumno en su
  // camino: no tiene sentido pedirle a alguien que consiga material que ya tiene.
  const donde = new Map<string, { materia: string; pagina: number | null; donde: string }>();
  for (const sid of new Set(filas.map((f) => f.subject_id))) {
    for (const p of await pendientesDe(sid)) {
      if (p.enHermana) {
        donde.set(`${sid}|${p.item}`, {
          materia: p.enHermana.materia, pagina: p.enHermana.paginaDesde, donde: p.enHermana.donde,
        });
      }
    }
  }

  const porCurso = new Map<string, Map<string, Fila[]>>();
  for (const f of filas) {
    if (!porCurso.has(f.curso)) porCurso.set(f.curso, new Map());
    const m = porCurso.get(f.curso)!;
    if (!m.has(f.materia)) m.set(f.materia, []);
    m.get(f.materia)!.push(f);
  }

  const L: string[] = [];
  L.push("# Contenidos que faltan\n");
  L.push("Lo que el currículum EPJA exige y el libro de cada materia no cubre, o cubre a medias.");
  L.push("Sale de `curriculum_map`, donde cada veredicto lo dictó un lector sobre el texto real\n" +
         "del libro. **Es un volcado: si esto y la tabla difieren, manda la tabla.**\n");
  L.push("## Cómo leerlo\n");
  L.push("| Marca | Qué quiere decir | Qué hacer |");
  L.push("|---|---|---|");
  L.push("| 🔴 | El libro de esa materia no lo enseña | Si abajo dice dónde sí está, no hay nada que conseguir: hay que mandar al alumno ahí. Si no dice nada, falta material. |");
  L.push("| 🟠 | Está en el tomo, en la mitad del otro curso | No falta material; falta que el camino lo alcance. |");
  L.push("| 🟡 | El libro lo toca pero incompleto | Lo más accionable: abajo está **qué parte** falta. |\n");

  const cuenta = (v: string) => filas.filter((f) => f.verificado === v).length;
  L.push(`Hoy: **${cuenta("no_esta")}** sin estar en su libro · ` +
         `**${cuenta("otro_año")}** en la mitad del otro curso · ` +
         `**${cuenta("parcial")}** incompletos.\n`);

  // ── Resumen por curso ──
  L.push("## Resumen\n");
  L.push("| Curso | Materias con algo que falta | 🔴 | 🟠 | 🟡 |");
  L.push("|---|---|---|---|---|");
  for (const c of ORDEN) {
    const m = porCurso.get(c);
    if (!m) continue;
    const todas = [...m.values()].flat();
    L.push(`| ${CURSO[c]} | ${m.size} | ${todas.filter((f) => f.verificado === "no_esta").length} | ` +
           `${todas.filter((f) => f.verificado === "otro_año").length} | ` +
           `${todas.filter((f) => f.verificado === "parcial").length} |`);
  }
  L.push("");

  // ── Índice ──
  // 126 contenidos en 1.100 líneas no se recorren de arriba abajo: quien busca
  // material entra por su materia.
  L.push("## Índice\n");
  for (const c of ORDEN) {
    const m = porCurso.get(c);
    if (!m) continue;
    const links = [...m.keys()].sort()
      .map((n) => `[${n}](#${n.toLowerCase().replace(/[^a-z0-9áéíóúñ º]/gi, "").replace(/\s+/g, "-")})`)
      .join(" · ");
    L.push(`**${CURSO[c]}** — ${links}\n`);
  }

  // ── Detalle ──
  const peso: Record<string, number> = { no_esta: 0, "otro_año": 1, parcial: 2 };
  for (const c of ORDEN) {
    const m = porCurso.get(c);
    if (!m) continue;
    L.push(`\n---\n\n# ${CURSO[c]}\n`);
    for (const materia of [...m.keys()].sort()) {
      const items = m.get(materia)!.sort(
        (a, b) => (peso[a.verificado]! - peso[b.verificado]!) || a.item.localeCompare(b.item));
      L.push(`## ${materia}\n`);
      for (const f of items) {
        L.push(`### ${SELLO[f.verificado] ?? f.verificado} · ${f.item.replace(/\.$/, "")}\n`);
        if (f.asignatura) L.push(`*Asignatura del currículum: ${f.asignatura}*\n`);
        const d = donde.get(`${f.subject_id}|${f.item}`);
        if (d) {
          const como = d.donde === "materia"
            ? "en otra materia del mismo curso"
            : d.donde === "curso_vecino" ? "en el otro año del mismo nivel EPJA" : "en otro nivel";
          L.push(`**Ya lo tiene el alumno** — ${d.materia}${d.pagina ? `, página ${d.pagina}` : ""} (${como}). No hay nada que conseguir.\n`);
        } else if (f.verificado !== "parcial") {
          L.push(`**No está en ningún libro del alumno.** Acá sí hace falta conseguir material.\n`);
        }
        if (f.pagina_desde) {
          const hasta = f.pagina_hasta && f.pagina_hasta !== f.pagina_desde ? `-${f.pagina_hasta}` : "";
          L.push(`Lo que hay, en su libro: página ${f.pagina_desde}${hasta}${f.doc ? ` · ${f.doc}` : ""}\n`);
        }
        /**
         * CON COBERTURA POR COMPONENTES, EL CHECKLIST REEMPLAZA LA PROSA. Es la
         * descomposición OFICIAL del programa EPJA con lo medido contra el
         * libro: quien busca material lee exactamente qué componente conseguir,
         * con la página de los que sí están. La prosa del lector queda para los
         * ítems sin componentes (niveles sin programa publicado).
         */
        if (f.cobertura?.length) {
          for (const x of f.cobertura) {
            // El ✗ con "en" no es lo mismo que el ✗ pelado: uno se resuelve
            // mandando al alumno a otro libro que ya tiene; el otro, consiguiendo
            // material. Son dos listas de compras distintas.
            const donde = !x.ok && x.en ? ` — está en ${x.en.materia}${x.en.pag ? ` p.${x.en.pag}` : ""}` : "";
            L.push(`- ${x.ok ? "✓" : "✗"} ${x.c}${x.ok && x.pag ? ` (p.${x.pag})` : ""}${donde}`);
          }
          L.push("");
          L.push(`*Componentes según el Programa de Estudio EPJA 2026.*\n`);
        } else {
          const v = limpiar(f.verificacion);
          if (v) L.push(`> ${v}\n`);
        }
      }
    }
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(salida, L.join("\n"), "utf8");
  console.log(`✓ ${salida} · ${filas.length} contenidos en ${porCurso.size} cursos`);
  process.exit(0);
}
void main();
