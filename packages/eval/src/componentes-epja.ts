/**
 * COMPONENTES-EPJA — la descomposición oficial de cada conocimiento esencial.
 *
 *   pnpm --filter @tutor-ia/eval componentes-epja
 *   pnpm --filter @tutor-ia/eval componentes-epja --aplicar
 *
 * ── Qué hace ───────────────────────────────────────────────────────────────
 * Lee los Programas de Estudio EPJA 2026 del Mineduc (texto ya extraído en
 * ~/Documents/libros/media/programas_epja_2026/) y, para cada conocimiento del
 * mapa curricular cuyo nivel y asignatura tienen programa publicado, extrae los
 * COMPONENTES en que el programa lo descompone. Los guarda en
 * curriculum_map.componentes (jsonb) con su fuente.
 *
 * ── Por qué del programa y no del modelo ───────────────────────────────────
 * Una descomposición inventada por el modelo es opinión; la del programa es la
 * norma. El modelo acá solo DESTILA: recibe los tramos del programa donde el
 * conocimiento aparece y devuelve los subtemas que EL TEXTO nombra. Si los
 * extractos no alcanzan para descomponer, responde NINGUNO y la fila queda
 * NULL — un componente inventado contamina la verificación que viene después.
 *
 * ── Cobertura, y por qué hay NULL a propósito ──────────────────────────────
 * Al 2026-08-24 el Mineduc publicó programas para Nivel 1 y 2 Básica, Nivel 1
 * Media, Lengua y Literatura Media y Filosofía NM1-NM2. NO existen los de
 * Nivel 3 Básica ni casi todo Nivel 2 Media (se verificó sondeando los slugs:
 * 404). Esos conocimientos quedan sin componentes hasta que salgan.
 */
import { chatText } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import * as fs from "node:fs";
import * as path from "node:path";
import { librosDir } from "./lib/libros";

const sql = getSql();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APLICAR = process.argv.includes("--aplicar");
const DIR = arg("dir") ?? `${librosDir()}/media/programas_epja_2026`;

/** Qué programa cubre qué (nivel, asignatura) del mapa. */
const PROGRAMAS: { archivo: string; url: string; asignatura: RegExp; niveles: string[] }[] = [
  { archivo: "epja-ciencias-naturales-nivel-2-educacion-basica.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-ciencias-naturales-nivel-2-educacion-basica",
    asignatura: /Ciencias Naturales/i, niveles: ["Nivel 2 Educación Básica"] },
  { archivo: "epja-ciencias-naturales-nivel-1-educacion-media.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-ciencias-naturales-nivel-1-educacion-media",
    asignatura: /Ciencias Naturales/i, niveles: ["Nivel 1 Educación Media"] },
  { archivo: "epja-matematica-nivel-2-educacion-basica.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-matematica-nivel-2-educacion-basica",
    asignatura: /Matem/i, niveles: ["Nivel 2 Educación Básica"] },
  { archivo: "epja-matematica-nivel-1-educacion-media.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-matematica-nivel-1-educacion-media",
    asignatura: /Matem/i, niveles: ["Nivel 1 Educación Media"] },
  { archivo: "epja-lenguaje-comunicacion-nivel-2-educacion-basica.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-lenguaje-comunicacion-nivel-2-educacion-basica",
    asignatura: /Lenguaje|Lengua/i, niveles: ["Nivel 2 Educación Básica"] },
  { archivo: "epja-lengua-literatura-educacion-media.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-lengua-literatura-educacion-media",
    asignatura: /Lenguaje|Lengua/i, niveles: ["Nivel 1 Educación Media", "Nivel 2 Educación Media"] },
  { archivo: "epja-historia-geografia-ciencias-sociales-nivel-2-educacion-basica.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-historia-geografia-ciencias-sociales-nivel-2-educacion-basica",
    asignatura: /Historia/i, niveles: ["Nivel 2 Educación Básica"] },
  { archivo: "epja-historia-geografia-ciencias-sociales-nivel-1-educacion-media-0.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-historia-geografia-ciencias-sociales-nivel-1-educacion-media-0",
    asignatura: /Historia/i, niveles: ["Nivel 1 Educación Media"] },
  { archivo: "epja-filosofia-nivel-1-2-educacion-media-0.txt",
    url: "https://www.curriculumnacional.cl/recursos/programa-estudio-epja-filosofia-nivel-1-2-educacion-media-0",
    asignatura: /Filosof/i, niveles: ["Nivel 1 Educación Media", "Nivel 2 Educación Media"] },
];

const DESTILAR = `Sos un curriculista chileno. Te doy un CONOCIMIENTO ESENCIAL del
currículum EPJA y EXTRACTOS del Programa de Estudio oficial donde ese conocimiento se
desarrolla (módulos, actividades, preguntas orientadoras).

Devolvé los COMPONENTES en que el programa descompone ese conocimiento: los subtemas
que un libro tendría que enseñar para cubrirlo.

Reglas, en orden de importancia:
- SOLO componentes que los extractos efectivamente nombran o desarrollan. Nada que
  venga de tu conocimiento general y no esté en el texto.
- Entre 3 y 10, cortos (3 a 10 palabras), uno por línea, sin numerar ni viñetas.
- Una pregunta orientadora se convierte en su tema ("¿qué es el efecto invernadero?"
  → "el efecto invernadero").
- Si los extractos NO permiten descomponerlo, respondé exactamente: NINGUNO`;

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Ventanas del programa donde el conocimiento aparece (o sus palabras clave). */
function ventanas(texto: string, item: string): string[] {
  const nt = norm(texto);
  const firmas = [norm(item).slice(0, 60), norm(item).slice(0, 35)];
  // Palabras distintivas (largas) del ítem, como red de emergencia.
  const claves = norm(item).split(" ").filter((w) => w.length >= 7).slice(0, 3);
  if (claves.length >= 2) firmas.push(claves.join(" "));
  const posiciones: number[] = [];
  for (const f of firmas) {
    if (f.length < 12) continue;
    let i = 0;
    while ((i = nt.indexOf(f, i)) >= 0 && posiciones.length < 5) {
      if (!posiciones.some((p) => Math.abs(p - i) < 2000)) posiciones.push(i);
      i += f.length;
    }
    if (posiciones.length) break;
  }
  // norm() conserva la longitud aproximada; se usa la posición tal cual sobre
  // el texto original — el corrimiento por tildes es de pocos caracteres y la
  // ventana es ancha.
  return posiciones.slice(0, 4).map((p) =>
    texto.slice(Math.max(0, p - 400), p + 3600));
}

async function main(): Promise<void> {
  const textos = new Map<string, string>();
  for (const p of PROGRAMAS) {
    const ruta = path.join(DIR, p.archivo);
    if (fs.existsSync(ruta)) textos.set(p.archivo, fs.readFileSync(ruta, "utf8"));
    else console.log(`⚠️  falta ${p.archivo}`);
  }

  const filas = await sql<{ nivel: string; asignatura: string; item: string; n: number }[]>`
    select cm.nivel, cm.asignatura, cm.item, count(*)::int n
    from curriculum_map cm join subjects s on s.id = cm.subject_id
    where cm.metodo = 'lector-v1' and s.disabled_at is null
    group by cm.nivel, cm.asignatura, cm.item
    order by cm.nivel, cm.asignatura, cm.item`;

  let con = 0, sinPrograma = 0, sinVentana = 0, ninguno = 0;
  for (const f of filas) {
    const prog = PROGRAMAS.find((p) =>
      p.niveles.includes(f.nivel) && p.asignatura.test(f.asignatura) && textos.has(p.archivo));
    if (!prog) { sinPrograma++; continue; }
    const vs = ventanas(textos.get(prog.archivo)!, f.item);
    if (vs.length === 0) {
      sinVentana++;
      console.log(`── ${f.item.slice(0, 64)}\n   ⚠️  no aparece en ${prog.archivo.slice(5, 40)}\n`);
      continue;
    }
    let out = "";
    try {
      out = await chatText(
        [{ role: "system", content: DESTILAR },
         { role: "user", content: `CONOCIMIENTO ESENCIAL (${f.nivel}, ${f.asignatura}):\n${f.item}\n\nEXTRACTOS DEL PROGRAMA:\n${vs.map((v, i) => `--- extracto ${i + 1} ---\n${v}`).join("\n\n")}` }],
        { temperature: 0, maxTokens: 300 },
      );
    } catch { console.log(`── ${f.item.slice(0, 64)}\n   ⚠️  el proveedor no respondió\n`); continue; }
    const comps = out.split("\n").map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim())
      .filter((l) => l.length >= 4 && l.length <= 90 && !/^NINGUNO/i.test(l)).slice(0, 10);
    if (/NINGUNO/i.test(out) || comps.length < 2) {
      ninguno++;
      console.log(`── ${f.item.slice(0, 64)}\n   (el programa no lo descompone)\n`);
      continue;
    }
    con++;
    console.log(`── ${f.item.slice(0, 64)}`);
    for (const c of comps) console.log(`     · ${c}`);
    console.log("");
    if (APLICAR) {
      await sql`
        update curriculum_map set
          -- toJson y no JSON.stringify: con stringify, postgres.js guarda el
          -- array como STRING jsonb (escalar) y jsonb_array_length explota.
          -- Es la trampa documentada en la memoria del proyecto, y aun así
          -- caí: la primera corrida guardó 138 filas dobles-encodeadas.
          componentes = ${toJson(sql, comps)},
          componentes_fuente = ${`Programa de Estudio EPJA 2026 · ${prog.archivo.replace(".txt", "")} · ${prog.url}`}
        where metodo = 'lector-v1' and nivel = ${f.nivel} and item = ${f.item}`;
    }
  }
  console.log(`✅ con componentes: ${con} · sin programa publicado: ${sinPrograma} · no aparece en el programa: ${sinVentana} · el programa no descompone: ${ninguno}`);
  console.log(APLICAR ? "escrito." : "SIMULACIÓN: nada escrito. Agregá --aplicar.");
  process.exit(0);
}
void main();
