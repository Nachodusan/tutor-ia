/**
 * ¿HAY MATERIAS QUE OFRECEN CONTENIDO DE OTRA DISCIPLINA?
 *
 *   pnpm --filter @tutor-ia/eval materias-cruzadas
 *   pnpm --filter @tutor-ia/eval materias-cruzadas --ver
 *
 * ── DE DÓNDE SALE ESTO ──────────────────────────────────────────────────────
 *
 * El alumno de Física 1º Medio abría la prueba y le ofrecían "Estructura celular
 * eucariota". La ingesta había asignado cuatro módulos EPJA de Ciencias
 * Naturales por NIVEL y no por disciplina.
 *
 * ⚠️ Y EL DETECTOR OBVIO NO LO HABRÍA ENCONTRADO. Comparar el título del
 * documento contra el nombre de la materia funciona con "Módulo 5: La célula",
 * pero el peor caso era "Módulo 7: Fuentes de energía y materia prima" — un
 * título que suena a física y cuyo subtítulo, en la portada, dice "Bases de la
 * vida… EN LOS SERES VIVOS". El título miente; el contenido no.
 *
 * Por eso esto cuenta MARCADORES DE DISCIPLINA en el texto de cada unidad del
 * plan: las palabras que solo aparecen cuando estás hablando de esa ciencia.
 *
 * ── CÓMO NO DAR FALSOS POSITIVOS ────────────────────────────────────────────
 *
 * "Energía" está en física y en biología; "célula" solo en biología. El léxico
 * de abajo es corto a propósito: solo palabras que casi no cruzan. Y no alcanza
 * con ganar — la disciplina ajena tiene que DUPLICAR a la propia y tener un piso
 * de menciones, porque un libro de biología nombra átomos sin ser de química.
 */
import { getSql } from "@tutor-ia/db";

const sql = getSql();
const VER = process.argv.includes("--ver");

/** Marcadores que casi no cruzan de disciplina. Cortos y en minúscula. */
const LEXICO: Record<string, string[]> = {
  biologia: ["célula", "celular", "adn", "cromosoma", "fotosíntesis", "organismo",
    "ecosistema", "especie", "tejido", "enzima", "mitosis", "meiosis", "biodiversidad",
    "neurona", "hormona", "genética", "herencia", "reproducción", "evolución"],
  quimica: ["átomo", "molécula", "enlace covalente", "reacción química", "ácido",
    "tabla periódica", "estequiometr", "disolución", "soluto", "solvente", "isómero",
    "hidrocarburo", "compuesto orgánico", "electrón de valencia"],
  fisica: ["velocidad", "aceleración", "newton", "onda", "frecuencia", "amplitud",
    "circuito", "voltaje", "refracción", "movimiento rectilíneo", "energía cinética",
    "fuerza neta", "vector", "trayectoria"],
  matematica: ["ecuación", "función", "fracción", "polinomio", "teorema", "ángulo",
    "probabilidad", "porcentaje", "raíz cuadrada", "logaritmo", "expresión algebraica"],
  lengua: ["narrador", "poema", "verso", "estrofa", "ortografía", "sujeto y predicado",
    "texto narrativo", "personaje", "argumentativo", "conector"],
  historia: ["siglo", "república", "independencia", "colonia", "revolución", "tratado",
    "constitución", "migración", "conquista", "dictadura"],
};

/**
 * ⚠️ POR PALABRA COMPLETA, NO POR SUBSTRING — y es la TERCERA vez que este
 * repositorio tropieza con lo mismo.
 *
 * La primera versión contaba con `split(palabra).length - 1`, y "verso" matcheaba
 * adentro de "uni·VERSO": la unidad "Estructuras y evolución estelar" de Física
 * salió acusada de ser de Lengua con 30 marcadores. Antes ya había pasado con
 * "foto·SÍNTESIS" en el parser de índices y con "re·PRESENTACIÓN" en el corte de
 * títulos auxiliares.
 *
 * El delimitador es explícito y no \b: en JavaScript \b se define sobre
 * [A-Za-z0-9_], así que no hay frontera de palabra antes de una "á" y "\bácido"
 * no matchearía nada.
 */
const DELIM = "[\\s.,;:¿?¡!()\\-–—/\"']";
const rx = (w: string) => new RegExp(
  `(^|${DELIM})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(${DELIM}|s${DELIM}|es${DELIM}|$)`, "g");

/** La disciplina de una materia, por su nombre. `null` = no se juzga. */
function disciplina(nombre: string): string | null {
  const n = nombre.toLowerCase();
  if (/f[ií]sica/.test(n)) return "fisica";
  if (/qu[ií]mica/.test(n)) return "quimica";
  if (/biolog/.test(n)) return "biologia";
  if (/matem/.test(n)) return "matematica";
  if (/lengua|lenguaje/.test(n)) return "lengua";
  if (/histor/.test(n)) return "historia";
  // Ciencias Naturales, Ciencias para la Ciudadanía, Ed. Ciudadana e Inglés son
  // MULTIDISCIPLINARIAS por definición: acusarlas de cruzar no significa nada.
  return null;
}

const filas = (await sql`
  select s.name as materia, (it->>'documentId')::uuid as doc,
         it->>'title' as unidad, (it->>'p0')::int as p0, (it->>'p1')::int as p1
  from subject_plans sp
  join subjects s on s.id = sp.subject_id
  cross join lateral jsonb_array_elements(sp.items) it
  where s.disabled_at is null and it->>'documentId' is not null and it->>'p0' is not null
  order by s.name`) as unknown as {
  materia: string; doc: string; unidad: string; p0: number; p1: number;
}[];

interface Cruce { materia: string; unidad: string; propia: number; ajena: number; cual: string }
const cruces: Cruce[] = [];
let juzgadas = 0;

for (const f of filas) {
  const propia = disciplina(f.materia);
  if (!propia) continue;
  juzgadas++;
  const [row] = (await sql`
    select string_agg(lower(ch.content), ' ') as txt from chunks ch
    where ch.document_id = ${f.doc} and ch.corpus_role = 'content'
      and coalesce(ch.page_start, ch.page) between ${f.p0} and ${f.p1}`) as unknown as { txt: string | null }[];
  const txt = row?.txt;
  if (!txt) continue;

  const cuenta = (d: string) => LEXICO[d]!.reduce((a, w) => a + (txt.match(rx(w))?.length ?? 0), 0);
  const mio = cuenta(propia);
  let peorAjena = "", peorN = 0;
  for (const d of Object.keys(LEXICO)) {
    if (d === propia) continue;
    const n = cuenta(d);
    if (n > peorN) { peorN = n; peorAjena = d; }
  }
  // DUPLICAR no alcanza sin un piso: en una unidad de tres chunks, 4 contra 2 es
  // ruido. Y con la propia en cero, cualquier mención ajena "duplica".
  if (peorN >= 12 && peorN >= mio * 2) {
    cruces.push({ materia: f.materia, unidad: f.unidad, propia: mio, ajena: peorN, cual: peorAjena });
  }
}

console.log(`${juzgadas} unidades juzgadas (las materias multidisciplinarias no se juzgan)\n`);
if (cruces.length === 0) {
  console.log("✓ Ninguna unidad ofrece contenido de otra disciplina.");
} else {
  console.log(`── UNIDADES QUE HABLAN DE OTRA DISCIPLINA (${cruces.length}) ──\n`);
  for (const c of cruces.sort((a, b) => (b.ajena / (b.propia + 1)) - (a.ajena / (a.propia + 1)))) {
    console.log(`  ${c.materia.slice(0, 26).padEnd(26)}  ${c.unidad.slice(0, 42).padEnd(42)}  ${c.cual}: ${c.ajena}  vs  propio: ${c.propia}`);
  }
  console.log(`\n⚠️  Es un semáforo: lo marcado se MIRA. Un libro de biología nombra átomos`);
  console.log(`   sin ser de química, y una unidad de ondas sonoras nombra el oído.`);
}
if (VER) {
  const porMateria = new Map<string, number>();
  for (const c of cruces) porMateria.set(c.materia, (porMateria.get(c.materia) ?? 0) + 1);
  console.log("\n── POR MATERIA ──");
  for (const [m, n] of [...porMateria].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}  ${m}`);
}
await sql.end();
