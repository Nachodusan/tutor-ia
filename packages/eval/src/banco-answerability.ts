/**
 * CAPTURA para el banco etiquetado de answerability.
 *
 *   pnpm --filter @tutor-ia/eval banco-answerability > golden/answerability-crudo.jsonl
 *
 * Emite tríos (pregunta, MATERIAL SERVIDO, metadatos) sin etiqueta. La etiqueta
 * se pone LEYENDO, en un paso aparte — es lo que hace defendible al banco y lo
 * que hoy no existe: los intentos anteriores de arreglar el discriminador se
 * calibraron contra 6 casos con etiquetas discutibles (ver answerability.ts).
 *
 * Se captura el material SERVIDO y no "el material correcto" a propósito: el
 * discriminador ve lo que el retrieval le entrega, así que la pregunta que hay
 * que etiquetar es "¿ESTO responde?", no "¿existe algo que responda?".
 */
import { getTeachingContext, isStruggling } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

// clase: pos = el libro debería responderla (sale de un título de sección real)
//        neg = claramente fuera del libro
//        dif = VECINA: el tema está en el libro, la pregunta puntual quizá no
// ⚠️ Los ids son EXPLÍCITOS y estables. Antes eran posicionales (b01, b02…) y
// agregar un caso al medio renumeraba todos los siguientes, o sea que despegaba
// cada etiqueta de su trío. Un id que se mueve arruina el banco en silencio.
const CASOS: [string, string, string, string][] = [
  ["b01", "pos", "Matemática 6º", "¿Cómo se ubican las fracciones y los números mixtos en la recta numérica?"],
  ["b02", "pos", "Matemática 6º", "¿Cómo se clasifican los triángulos?"],
  ["b03", "pos", "Historia Geografía Y Ciencias Sociales 7º", "¿Cómo se organizaba social y políticamente el Imperio inca?"],
  ["b04", "pos", "Historia Geografía Y Ciencias Sociales 7º", "¿Qué técnicas agrícolas usaban en Mesoamérica?"],
  ["b05", "pos", "Historia Geografía Y Ciencias Sociales 7º", "¿Cómo trataba Roma a los pueblos que conquistaba?"],
  ["b06", "pos", "Historia Geografía Y Ciencias Sociales 6º", "¿Cómo se amplió el derecho a voto en Chile en el siglo XX?"],
  ["b07", "pos", "Historia Geografía Y Ciencias Sociales 6º", "¿Cómo fue la transición a la democracia en Chile?"],
  ["b08", "pos", "Biología 1º Medio", "¿Cómo evolucionan los seres vivos?"],
  ["b09", "pos", "Ciencias Naturales 8º", "¿Qué dice la teoría celular?"],
  ["b10", "pos", "Ciencias Naturales 7º", "¿Qué son las fuerzas y cómo actúan sobre la Tierra?"],
  ["b11", "dif", "Historia Geografía Y Ciencias Sociales 7º", "¿Quién fue Julio César y cómo murió?"],
  ["b12", "dif", "Historia Geografía Y Ciencias Sociales 6º", "¿Cuántos senadores tiene el Congreso de Chile hoy?"],
  ["b13", "dif", "Biología 1º Medio", "¿Qué es el ADN mitocondrial y para qué se usa?"],
  ["b14", "dif", "Ciencias Naturales 8º", "¿Cuáles son las fases de la mitosis?"],
  ["b15", "dif", "Matemática 6º", "¿Cómo se resuelve una ecuación de segundo grado?"],
  ["b16", "dif", "Lengua Y Literatura 7º", "¿Quién escribió Don Quijote y en qué año?"],
  ["b17", "dif", "Química 1º Medio", "¿Qué es el pH y cómo se mide?"],
  ["b18", "neg", "Historia Geografía Y Ciencias Sociales 7º", "¿Quién ganó el Mundial de fútbol de 2022?"],
  ["b19", "neg", "Matemática 6º", "¿Cuánto cuesta un celular nuevo en Chile?"],
  ["b20", "neg", "Lengua Y Literatura 7º", "¿De qué trata la serie Stranger Things?"],
  ["b21", "neg", "Ciencias Naturales 8º", "¿Cómo se cura la gripe?"],
  ["b22", "neg", "Biología 1º Medio", "¿Cómo se entrena para correr una maratón?"],
  // ── VECINOS: el tema está en el libro, la pregunta puntual quizá no ─────────
  ["b23", "dif", "Historia Geografía Y Ciencias Sociales 7º", "¿En qué año se fundó Roma?"],
  ["b24", "dif", "Historia Geografía Y Ciencias Sociales 7º", "¿Quién fue Napoleón Bonaparte?"],
  ["b25", "dif", "Historia Geografía Y Ciencias Sociales 8º", "¿Cuántas carabelas llevó Colón en su primer viaje?"],
  ["b26", "dif", "Historia Geografía Y Ciencias Sociales 8º", "¿Qué fue la Revolución Industrial?"],
  ["b27", "dif", "Ciencias Naturales 7º", "¿Cómo se forma un volcán?"],
  ["b28", "dif", "Ciencias Naturales 7º", "¿Cuántos huesos tiene el esqueleto humano?"],
  ["b29", "dif", "Ciencias Naturales 8º", "¿Cuántos cromosomas tiene una persona?"],
  ["b30", "dif", "Ciencias Naturales 8º", "¿Qué es la fotosíntesis?"],
  ["b31", "dif", "Matemática 6º", "¿Qué es una raíz cuadrada?"],
  ["b32", "dif", "Matemática 8º", "¿Qué es una derivada?"],
  ["b33", "dif", "Matemática 8º", "¿Cómo se calcula el área de un círculo?"],
  ["b34", "dif", "Biología 1º Medio", "¿Cuántos cromosomas tiene el ser humano?"],
  ["b35", "dif", "Biología 1º Medio", "¿Qué es una vacuna y cómo funciona?"],
  ["b36", "dif", "Química 1º Medio", "¿Qué es la tabla periódica?"],
  ["b37", "dif", "Física 1º Medio", "¿A qué velocidad viaja la luz?"],
  ["b38", "dif", "Física 1º Medio", "¿Qué es un agujero negro?"],
  ["b39", "dif", "Lengua Y Literatura 8º", "¿Qué es una metáfora?"],
  ["b40", "dif", "Lengua Y Literatura 8º", "¿Qué fue el Modernismo literario?"],
  ["b41", "dif", "Educación Ciudadana 3º Medio", "¿Cada cuántos años se elige presidente en Chile?"],
  ["b42", "dif", "Lengua Y Literatura 7º", "¿Qué diferencia hay entre cuento y novela?"],
  // ── CROSS-SCOPE: donde el discriminador REALMENTE corre ────────────────────
  // `pasaAnswerability` solo se invoca en las etapas de la cascada (otro_curso,
  // area, corpus completo). Con scope=curso ni se llama: el libro del alumno
  // contesta siempre, por diseño. Un banco sin casos cross-scope mide al
  // discriminador donde no se ejecuta — pasó con los primeros 42.
  ["c01", "dif", "Matemática 6º", "¿Cómo se factoriza un trinomio?"],
  ["c02", "dif", "Matemática 6º", "¿Qué es el teorema de Pitágoras?"],
  ["c03", "dif", "Matemática 6º", "¿Qué es una función lineal?"],
  ["c04", "dif", "Biología 1º Medio", "¿Cómo se propaga el sonido?"],
  ["c05", "dif", "Biología 1º Medio", "¿Qué es el trabajo mecánico?"],
  ["c06", "dif", "Química 1º Medio", "¿Qué es la selección natural?"],
  ["c07", "dif", "Química 1º Medio", "¿Cómo funciona el sistema nervioso?"],
  ["c08", "dif", "Física 1º Medio", "¿Qué es el ADN?"],
  ["c09", "dif", "Lengua Y Literatura 7º", "¿Qué es el realismo mágico?"],
  ["c10", "dif", "Lengua Y Literatura 7º", "¿Qué es un soneto?"],
  ["c11", "dif", "Historia Geografía Y Ciencias Sociales 6º", "¿Qué fue la Edad Media?"],
  ["c12", "dif", "Historia Geografía Y Ciencias Sociales 6º", "¿Quiénes eran los mayas?"],
  ["c13", "dif", "Ciencias Naturales 6º", "¿Qué es la tectónica de placas?"],
  ["c14", "dif", "Ciencias Naturales 6º", "¿Qué es una célula procarionte?"],
];

const sql = getSql();
const ctxDe = async (materia: string) => {
  const [s] = await sql<{ id: string }[]>`select id from subjects where name = ${materia}`;
  const fam = await sql<{ id: string }[]>`select s2.id from subjects s1 join subjects s2 on s2.family=s1.family
    where s1.id=${s!.id}::uuid and s1.family is not null and s2.disabled_at is null`;
  const ar = await sql<{ id: string }[]>`select s2.id from subjects s1 join subjects s2 on s2.area=s1.area
    where s1.id=${s!.id}::uuid and s1.area is not null and s2.disabled_at is null`;
  return { id: s!.id, fam: fam.map((r) => r.id), ar: ar.map((r) => r.id) };
};
for (const [id, clase, materia, pregunta] of CASOS) {
  // OJO con el nombre: `id` acá es el de la MATERIA y pisaba el del caso.
  const { id: subjectId, fam, ar } = await ctxDe(materia);
  const [perf] = await sql<{ grade: string | null }[]>`select grade from student_profiles
    where user_id = '00000000-0000-0000-0000-000000000001'::uuid`;
  const res = await getTeachingContext({ userId: "00000000-0000-0000-0000-000000000001", subjectId,
    question: pregunta, history: [], familyIds: fam, areaIds: ar,
    studentGrade: perf?.grade ?? null, struggling: isStruggling(pregunta) });
  const ctx = res.ctx;
  console.log(JSON.stringify({
    id, clase, materia, pregunta,
    scope: ctx?.scope ?? "ninguno", topScore: Number((ctx?.topScore ?? 0).toFixed(4)),
    entail: ctx?.answerabilityEntail ?? null,
    // ⚠️ TODOS los fragmentos y SIN TRUNCAR: es lo que el discriminador recibe
    // (`contesta(query, chunks.map(c => c.content))`). Truncar a 3 × 600
    // caracteres hacía que el banco midiera una entrada distinta a la real —
    // medido: con el material completo el juez pasó de decir NO a decir SI en el
    // mismo caso. Un banco que no reproduce la entrada mide otra cosa.
    servido: (ctx?.citable ?? []).map((c) => ({
      libro: c.documentTitle, pag: c.pageStart, score: Number(c.score.toFixed(4)),
      texto: c.content.replace(/\s+/g, " "),
    })),
    responde: null, porque: "",
  }));
}
await sql.end();
