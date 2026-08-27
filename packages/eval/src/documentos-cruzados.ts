/**
 * ¿HAY ALGÚN LIBRO COLGADO DE LA MATERIA EQUIVOCADA? — corpus entero, todos los
 * grados.
 *
 *   pnpm --filter @tutor-ia/eval documentos-cruzados
 *
 * Es la pregunta que dejó el caso de Física: cuatro módulos EPJA de Ciencias
 * Naturales colgaban de Física 1º Medio, así que el alumno veía "Estructura
 * celular eucariota" en su prueba. ¿Le pasa a alguna otra materia, de este grado
 * o de otro?
 *
 * ⚠️ SE MIDE POR DOCUMENTO Y NO POR UNIDAD, que es donde vivía el bug. Un libro
 * mal asignado ensucia TODAS sus unidades; mirarlo unidad por unidad diluye la
 * señal y encima deja afuera las materias multidisciplinarias, que no se pueden
 * juzgar contra una sola disciplina.
 *
 * ⚠️ Y SE MIDE POR CONTENIDO, NO POR TÍTULO. "Módulo 7: Fuentes de energía y
 * materia prima" suena a física y es biología —su portada dice "Bases de la
 * vida… en los seres vivos"—. El título miente; el texto no.
 */
import { getSql } from "@tutor-ia/db";

const sql = getSql();
const VER = process.argv.includes("--ver");

const DELIM = "[\\s.,;:¿?¡!()\\-–—/\"']";
/** Palabra completa. Ver por qué no \b en materias-cruzadas.ts. */
const rx = (w: string) => new RegExp(
  `(^|${DELIM})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(${DELIM}|s${DELIM}|es${DELIM}|$)`, "g");

const LEXICO: Record<string, string[]> = {
  biologia: ["célula", "celular", "adn", "cromosoma", "fotosíntesis", "organismo",
    "ecosistema", "especie", "tejido", "enzima", "mitosis", "meiosis", "biodiversidad",
    "neurona", "hormona", "genética", "herencia", "reproducción"],
  quimica: ["átomo", "molécula", "enlace covalente", "reacción química", "ácido",
    "tabla periódica", "estequiometría", "disolución", "soluto", "solvente", "isómero",
    "hidrocarburo", "electrón"],
  fisica: ["velocidad", "aceleración", "newton", "onda", "frecuencia", "amplitud",
    "circuito", "voltaje", "refracción", "energía cinética", "vector", "trayectoria"],
  matematica: ["ecuación", "función", "fracción", "polinomio", "teorema", "ángulo",
    "probabilidad", "porcentaje", "raíz cuadrada", "logaritmo"],
  lengua: ["narrador", "poema", "verso", "estrofa", "ortografía", "texto narrativo",
    "personaje", "argumentativo", "conector", "sinónimo"],
  historia: ["siglo", "república", "independencia", "colonia", "revolución", "tratado",
    "constitución", "migración", "conquista", "dictadura"],
};

/**
 * QUÉ DISCIPLINAS PUEDE TRAER CADA MATERIA.
 *
 * Las de una sola disciplina admiten la suya. Las MULTIDISCIPLINARIAS admiten un
 * conjunto: no se las puede acusar de cruzar, pero sí de traer algo que no está
 * en su conjunto — un libro de lengua en Ciencias Naturales sigue estando mal.
 * `null` = no se juzga (Inglés: su texto está en inglés y el léxico es español).
 */
function admitidas(nombre: string): string[] | null {
  const n = nombre.toLowerCase();
  if (/ingl/.test(n)) return null;
  if (/f[ií]sica/.test(n)) return ["fisica"];
  if (/qu[ií]mica/.test(n)) return ["quimica"];
  if (/biolog/.test(n)) return ["biologia"];
  if (/matem/.test(n)) return ["matematica"];
  if (/lengua|lenguaje/.test(n)) return ["lengua"];
  if (/histor/.test(n)) return ["historia"];
  // Ciencias Naturales y Ciencias para la Ciudadanía SON las tres ciencias.
  if (/ciencias naturales|ciudadan[ií]a/.test(n) && !/educaci/.test(n)) return ["biologia", "quimica", "fisica"];
  // Educación Ciudadana es ciencias sociales.
  if (/educaci[oó]n ciudadana/.test(n)) return ["historia"];
  return null;
}

const docs = (await sql`
  select d.id, d.title, s.name as materia
  from documents d join subjects s on s.id = d.subject_id
  where s.disabled_at is null
    -- Las guías del docente hablan de didáctica, no de la disciplina: su léxico
    -- es otro y compararlas con este contaría cualquier cosa.
    and d.title not ilike '%docente%' and d.title not ilike '%guía did%'
  order by s.name, d.title`) as unknown as { id: string; title: string; materia: string }[];

interface Cruce { materia: string; doc: string; cual: string; n: number; propio: number }
const cruces: Cruce[] = [];
let juzgados = 0, sinSenal = 0;

for (const d of docs) {
  const ok = admitidas(d.materia);
  if (!ok) continue;
  const [r] = (await sql`
    select string_agg(lower(content), ' ') txt from chunks
    where document_id = ${d.id} and corpus_role = 'content'`) as unknown as { txt: string | null }[];
  const txt = r?.txt;
  if (!txt) continue;
  juzgados++;

  const cuenta = (k: string) => LEXICO[k]!.reduce((a, w) => a + (txt.match(rx(w))?.length ?? 0), 0);
  const propio = Math.max(...ok.map(cuenta));
  let ajenaN = 0, ajenaCual = "";
  for (const k of Object.keys(LEXICO)) {
    if (ok.includes(k)) continue;
    const n = cuenta(k);
    if (n > ajenaN) { ajenaN = n; ajenaCual = k; }
  }
  // Un libro entero da miles de marcadores: el piso es alto y la ventaja tiene
  // que ser clara. Sin señal propia NI ajena, el libro no es de ninguna de estas
  // disciplinas (un texto de artes, de filosofía) y no se acusa.
  if (propio < 20 && ajenaN < 20) { sinSenal++; continue; }
  if (ajenaN >= 40 && ajenaN >= propio * 2) {
    cruces.push({ materia: d.materia, doc: d.title, cual: ajenaCual, n: ajenaN, propio });
  }
}

console.log(`${juzgados} libros de contenido juzgados · ${sinSenal} sin señal de ninguna disciplina\n`);
if (cruces.length === 0) {
  console.log("✓ Ningún libro está colgado de una materia que no le corresponde.");
} else {
  console.log(`── LIBROS EN LA MATERIA EQUIVOCADA (${cruces.length}) ──\n`);
  for (const c of cruces.sort((a, b) => (b.n / (b.propio + 1)) - (a.n / (a.propio + 1)))) {
    console.log(`  ${c.materia.slice(0, 26).padEnd(26)}  ${c.doc.slice(0, 50).padEnd(50)}`);
    console.log(`  ${"".padEnd(26)}  → ${c.cual}: ${c.n}  vs  lo suyo: ${c.propio}`);
  }
}
if (VER) {
  const noJuzgados = docs.length - juzgados;
  console.log(`\n${noJuzgados} libros no se juzgaron (Inglés y materias sin disciplina en el léxico).`);
}

/**
 * SEGUNDO EJE: EL NIVEL.
 *
 * La disciplina no es la única forma de estar en la materia equivocada. Un
 * material de I Ciclo Media (1º-2º) colgado de una materia de 3º-4º le ofrece al
 * alumno una parada que no es de su año.
 *
 * ⚠️ PERO ESTO NO ES NECESARIAMENTE UN BUG, y por eso se lista aparte y no se
 * cuenta como cruce. El ingestor EPJA arma su plan "a partir de los huecos
 * reales del camino de cada materia, no por regla general": si el camino de
 * Matemática 4º tenía un hueco en proporcionalidad, la guía de I Ciclo lo llena
 * a propósito. Y el currículum EPJA comprime años, así que pedir contenido de
 * otro año es parte del diseño.
 *
 * La diferencia con el cruce de disciplina es la que importa: un alumno de
 * física NUNCA necesita biología celular COMO física. Un adulto de 4º Medio sí
 * puede necesitar razones y proporciones.
 */
const nivel = (t: string) =>
  // ⚠️ II PRIMERO: "I Ciclo Media" es SUBSTRING de "II Ciclo Media", y buscarlo
  // antes clasifica mal TODOS los de segundo ciclo. Cuarta vez que este
  // repositorio tropieza con un substring.
  /II Ciclo Media|Segundo Nivel Media/i.test(t) ? [3, 4]
  : /I Ciclo Media|Primer Nivel Media/i.test(t) ? [1, 2]
  : /Nivel 3 B[aá]sica/i.test(t) ? [7, 8]
  : /Nivel 2 B[aá]sica/i.test(t) ? [6] : null;

const gradoDe = (n: string) => {
  const m = n.match(/([1-4])º Medio/) ?? n.match(/([6-8])º/);
  return m ? Number(m[1]) : null;
};

const desnivel = docs
  .map((d) => ({ d, esperado: nivel(d.title), g: gradoDe(d.materia) }))
  .filter((x) => x.esperado && x.g != null && !x.esperado.includes(x.g!));

console.log(`\n── MATERIAL DE OTRO NIVEL (${desnivel.length}) ──`);
if (desnivel.length === 0) {
  console.log("   Ninguno.");
} else {
  console.log(`   No es un bug por sí solo: el plan de ingesta EPJA se armó por HUECOS del`);
  console.log(`   camino, no por nivel. Se lista para decidir, no para borrar.\n`);
  for (const x of desnivel) {
    console.log(`  ${x.d.materia.slice(0, 30).padEnd(30)}  ${x.d.title.slice(0, 52)}`);
  }
}
await sql.end();
