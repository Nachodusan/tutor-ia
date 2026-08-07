/**
 * PLANILLAS CIEGAS + LLAVE (§6 y §7 del plan).
 *
 * Muestrea del snapshot y emite:
 *   · `planilla-A.csv` / `planilla-B.csv`  — una por etiquetador, mismas filas en
 *     ORDEN DISTINTO (para que dos personas en paralelo no se cansen en el mismo
 *     tramo). NO llevan veredicto, ni score, ni materia: nada que delate.
 *   · `planilla-A.html` / `planilla-B.html` — lo mismo, pero LEGIBLE. Cada
 *     afirmación con su material al lado. El CSV es para volcar las etiquetas;
 *     el HTML es para poder trabajar sin volverse loco: hay ~10 KB de material
 *     por fila y eso en una celda de planilla es ilegible.
 *   · `llave.csv` — CERRADA hasta que las dos planillas estén completas. Lleva el
 *     veredicto del NLI, la materia, el tipo de pregunta y la meta.
 *
 * MUESTREO ALEATORIO SIMPLE, sin estratos. El plan original estratificaba para
 * juntar suficientes casos marcados positivos, asumiendo que el NLI marcaba el
 * 13,3%. Medido sobre el tráfico real, marca el **41%** (28% contradichas + 13%
 * sin respaldo), así que una muestra aleatoria ya trae de sobra y estratificar
 * solo agregaría una ponderación que después hay que explicar.
 *
 * Semilla FIJA: dos corridas dan la misma muestra. Sin eso no se puede reproducir
 * ni auditar la auditoría.
 *
 *   pnpm --filter @tutor-ia/eval auditoria-planillas -- --n 70
 */
import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const flag = (n: string, def: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : def;
};
const N = Number(flag("n", "70"));
const SEMILLA = Number(flag("semilla", "20260806"));

/** LCG determinístico. `Math.random()` haría irreproducible la muestra. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function mezclar<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const csvCell = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Afirmacion {
  afirmacion_id: string; message_id: string; materia: string;
  tipo_pregunta: string; registro: string; modo: string | null;
  pregunta_alumno: string; afirmacion: string; respuesta_completa: string;
  material: { chunk_id: string; pagina: number | null; etiqueta: string; texto: string | null }[];
  nli_veredicto: string; nli_entailment: number | null;
  meta: Record<string, unknown> | null;
}
interface SinMaterial {
  respuesta_id: string; message_id: string; materia: string;
  tipo_pregunta: string; pregunta_alumno: string; respuesta_completa: string;
}

const CONSIGNA_RESPALDO = `Para cada afirmación, mirá SOLO el material que está al lado y decidí:

  FUNDAMENTADA — lo que dice se puede sostener con ese material, aunque esté dicho
                 con otras palabras. La paráfrasis fiel es FUNDAMENTADA.
  ALUCINACION  — agrega, cambia o contradice algo que el material no dice. También
                 si es CIERTO en el mundo pero no está en el material (anotalo en
                 la nota: lo que se mide es si sale del libro, no si es verdad).
  NO_APLICA    — no afirma nada verificable: saludo, pregunta al alumno, conector,
                 andamiaje ("vamos a ver…", "pensá en un ejemplo tuyo").

Inferencia de un paso (el material dice A y B, el tutor concluye C que se sigue
directo) es FUNDAMENTADA. Si para concluir hay que traer algo de afuera, es
ALUCINACION.`;

const CONSIGNA_GENERAL = `Estas respuestas salieron SIN material del libro. No hay
nada contra qué contrastarlas, así que la pregunta es otra:

  AVISO     — le dijo al alumno, de alguna forma, que esto no está en su libro.
  NO_AVISO  — respondió como si viniera del material, sin aclararlo.

Es la pregunta que importa acá: el tutor sin red puede equivocarse, pero no puede
hacerle creer al chico que lo que le dice salió de su libro.`;

function html(titulo: string, consigna: string, filas: string[]): string {
  // Soporta tema claro y oscuro: dos personas van a leer esto durante días, y en
  // un lector con modo oscuro el título quedaba negro sobre negro.
  return `<!doctype html><meta charset="utf-8"><title>${esc(titulo)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 :root{--bg:#fff;--tx:#1a1a1a;--dim:#555;--bd:#ddd;--pan:#f4f4f8;--mat:#fafafa;--matbd:#eee;
       --afbg:#fffbe6;--afbd:#f0d98a;--ac:#6C5CE7}
 @media (prefers-color-scheme:dark){
  :root{--bg:#16161a;--tx:#e8e8ea;--dim:#a0a0a8;--bd:#33333a;--pan:#1f1f26;--mat:#1c1c22;--matbd:#2a2a32;
        --afbg:#2a2416;--afbd:#5a4a1e;--ac:#a99bff}
 }
 body{font:16px/1.6 -apple-system,system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:24px;
      color:var(--tx);background:var(--bg)}
 h1{font-size:22px;color:var(--tx)}
 .consigna{background:var(--pan);border-left:4px solid var(--ac);padding:14px 18px;white-space:pre-wrap;
           font-size:14px;border-radius:0 8px 8px 0;color:var(--tx)}
 .item{border:1px solid var(--bd);border-radius:10px;padding:18px;margin:22px 0}
 .id{font:600 13px ui-monospace,monospace;color:var(--ac)}
 .preg{color:var(--dim);font-size:14px;margin:6px 0 14px}
 .afirm{background:var(--afbg);border:1px solid var(--afbd);border-radius:8px;padding:14px;
        font-size:17px;margin-bottom:14px}
 details{margin-top:10px} summary{cursor:pointer;font-size:14px;color:var(--dim)}
 .mat{background:var(--mat);border:1px solid var(--matbd);border-radius:8px;padding:12px;margin-top:8px;
      font-size:14px;white-space:pre-wrap}
 .mat b{display:block;color:var(--ac);font:600 12px ui-monospace,monospace;margin-bottom:4px}
 .etq{margin-top:14px;font-size:14px;color:var(--dim)}
 .aviso{font-size:14px;color:var(--dim)}
</style>
<h1>${esc(titulo)}</h1>
<div class="consigna">${esc(consigna)}</div>
<p class="aviso">Etiquetá en el CSV que acompaña este archivo, usando el mismo <code>id</code>. No mires la planilla del otro etiquetador ni la llave.</p>
${filas.join("\n")}`;
}

async function main(): Promise<void> {
  const lineas = (await readFile(
    new URL("../golden/auditoria-snapshot.jsonl", import.meta.url), "utf8",
  )).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);

  const cabecera = lineas.find((l) => l._snapshot);
  const todas = lineas.filter((l) => l.afirmacion_id) as unknown as Afirmacion[];
  const generales = lineas.filter((l) => l.respuesta_id) as unknown as SinMaterial[];

  const rnd = prng(SEMILLA);
  const muestra = mezclar(todas, rnd).slice(0, Math.min(N, todas.length));

  const dir = new URL("../golden/auditoria/", import.meta.url).pathname;
  await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));

  // ── Planillas ciegas, una por etiquetador, en orden distinto ──
  for (const quien of ["A", "B"] as const) {
    const orden = mezclar(muestra, prng(SEMILLA + (quien === "A" ? 1 : 2)));
    const csv = [
      "id,pregunta_del_alumno,afirmacion,etiqueta,nota",
      ...orden.map((a) =>
        [a.afirmacion_id, a.pregunta_alumno, a.afirmacion, "", ""].map(csvCell).join(","),
      ),
    ].join("\n");
    await writeFile(`${dir}planilla-${quien}.csv`, csv + "\n", "utf8");

    const filas = orden.map((a) => `<div class="item">
  <div class="id">${a.afirmacion_id}</div>
  <div class="preg">El alumno preguntó: <i>${esc(a.pregunta_alumno)}</i></div>
  <div class="afirm">${esc(a.afirmacion)}</div>
  <details><summary>Ver el material que se le mostró al tutor (${a.material.length} fragmentos)</summary>
    ${a.material.map((m) => `<div class="mat"><b>${esc(m.etiqueta)}</b>${esc((m.texto ?? "(sin texto)").slice(0, 3000))}</div>`).join("")}
  </details>
  <details><summary>Ver la respuesta completa (por si hace falta el contexto)</summary>
    <div class="mat">${esc(a.respuesta_completa)}</div></details>
  <div class="etq">Etiqueta para <b>${a.afirmacion_id}</b>: FUNDAMENTADA · ALUCINACION · NO_APLICA</div>
</div>`);
    await writeFile(
      `${dir}planilla-${quien}.html`,
      html(`Auditoría de alucinación — etiquetador ${quien} (${orden.length} afirmaciones)`, CONSIGNA_RESPALDO, filas),
      "utf8",
    );

    // Bloque 2: respuestas sin material, consigna distinta.
    const ordenG = mezclar(generales, prng(SEMILLA + (quien === "A" ? 11 : 22)));
    await writeFile(
      `${dir}planilla-${quien}-sin-material.csv`,
      ["id,pregunta_del_alumno,etiqueta,nota",
        ...ordenG.map((g) => [g.respuesta_id, g.pregunta_alumno, "", ""].map(csvCell).join(","))].join("\n") + "\n",
      "utf8",
    );
    const filasG = ordenG.map((g) => `<div class="item">
  <div class="id">${g.respuesta_id}</div>
  <div class="preg">El alumno preguntó: <i>${esc(g.pregunta_alumno)}</i></div>
  <div class="afirm">${esc(g.respuesta_completa)}</div>
  <div class="etq">Etiqueta para <b>${g.respuesta_id}</b>: AVISO · NO_AVISO</div>
</div>`);
    await writeFile(
      `${dir}planilla-${quien}-sin-material.html`,
      html(`Auditoría — respuestas SIN material — etiquetador ${quien} (${ordenG.length})`, CONSIGNA_GENERAL, filasG),
      "utf8",
    );
  }

  // ── La llave. NO SE ABRE hasta que las dos planillas estén cerradas. ──
  const llave = [
    "id,materia,tipo_pregunta,registro,modo,nli_veredicto,nli_entailment,topScore,message_id",
    ...muestra.map((a) =>
      [a.afirmacion_id, a.materia, a.tipo_pregunta, a.registro, a.modo,
       a.nli_veredicto, a.nli_entailment ?? "", (a.meta?.topScore as number) ?? "", a.message_id]
        .map(csvCell).join(","),
    ),
    ...generales.map((g) =>
      [g.respuesta_id, g.materia, g.tipo_pregunta, "", "general", "sin_material", "", "", g.message_id]
        .map(csvCell).join(","),
    ),
  ].join("\n");
  await writeFile(`${dir}llave.csv`, llave + "\n", "utf8");

  // Reparto de la muestra, para poder decir sobre qué se está midiendo.
  const cuenta = <T>(xs: T[], f: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log(
    `🗂  Planillas generadas — semilla ${SEMILLA}, commit del snapshot ${cabecera?.commit}\n\n` +
      `   muestra:            ${muestra.length} de ${todas.length} afirmaciones\n` +
      `   sin material:       ${generales.length} respuestas (bloque aparte)\n`,
  );
  console.log("   por materia:");
  for (const [m, c] of cuenta(muestra, (a) => a.materia)) console.log(`      ${m.slice(0, 40).padEnd(42)} ${c}`);
  console.log("\n   veredicto del NLI en la muestra (solo en la llave):");
  for (const [v, c] of cuenta(muestra, (a) => a.nli_veredicto)) {
    console.log(`      ${v.padEnd(14)} ${String(c).padStart(3)}  ${((100 * c) / muestra.length).toFixed(0)}%`);
  }
  console.log(`\n💾 ${dir}`);
  console.log(`   planilla-A.html / .csv   ← para la persona A`);
  console.log(`   planilla-B.html / .csv   ← para la persona B`);
  console.log(`   *-sin-material.*         ← el bloque de modo general`);
  console.log(`   llave.csv                ← ⚠️ NO ABRIR hasta que las dos estén completas`);
}

await main();
process.exit(0);
