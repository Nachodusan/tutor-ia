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
const CASOS: [string, string, string][] = [
  ["pos", "Matemática 6º", "¿Cómo se ubican las fracciones y los números mixtos en la recta numérica?"],
  ["pos", "Matemática 6º", "¿Cómo se clasifican los triángulos?"],
  ["pos", "Historia Geografía Y Ciencias Sociales 7º", "¿Cómo se organizaba social y políticamente el Imperio inca?"],
  ["pos", "Historia Geografía Y Ciencias Sociales 7º", "¿Qué técnicas agrícolas usaban en Mesoamérica?"],
  ["pos", "Historia Geografía Y Ciencias Sociales 7º", "¿Cómo trataba Roma a los pueblos que conquistaba?"],
  ["pos", "Historia Geografía Y Ciencias Sociales 6º", "¿Cómo se amplió el derecho a voto en Chile en el siglo XX?"],
  ["pos", "Historia Geografía Y Ciencias Sociales 6º", "¿Cómo fue la transición a la democracia en Chile?"],
  ["pos", "Biología 1º Medio", "¿Cómo evolucionan los seres vivos?"],
  ["pos", "Ciencias Naturales 8º", "¿Qué dice la teoría celular?"],
  ["pos", "Ciencias Naturales 7º", "¿Qué son las fuerzas y cómo actúan sobre la Tierra?"],
  ["dif", "Historia Geografía Y Ciencias Sociales 7º", "¿Quién fue Julio César y cómo murió?"],
  ["dif", "Historia Geografía Y Ciencias Sociales 6º", "¿Cuántos senadores tiene el Congreso de Chile hoy?"],
  ["dif", "Biología 1º Medio", "¿Qué es el ADN mitocondrial y para qué se usa?"],
  ["dif", "Ciencias Naturales 8º", "¿Cuáles son las fases de la mitosis?"],
  ["dif", "Matemática 6º", "¿Cómo se resuelve una ecuación de segundo grado?"],
  ["dif", "Lengua Y Literatura 7º", "¿Quién escribió Don Quijote y en qué año?"],
  ["dif", "Química 1º Medio", "¿Qué es el pH y cómo se mide?"],
  ["neg", "Historia Geografía Y Ciencias Sociales 7º", "¿Quién ganó el Mundial de fútbol de 2022?"],
  ["neg", "Matemática 6º", "¿Cuánto cuesta un celular nuevo en Chile?"],
  ["neg", "Lengua Y Literatura 7º", "¿De qué trata la serie Stranger Things?"],
  ["neg", "Ciencias Naturales 8º", "¿Cómo se cura la gripe?"],
  ["neg", "Biología 1º Medio", "¿Cómo se entrena para correr una maratón?"],
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
let n = 0;
for (const [clase, materia, pregunta] of CASOS) {
  const { id, fam, ar } = await ctxDe(materia);
  const [perf] = await sql<{ grade: string | null }[]>`select grade from student_profiles
    where user_id = '00000000-0000-0000-0000-000000000001'::uuid`;
  const res = await getTeachingContext({ userId: "00000000-0000-0000-0000-000000000001", subjectId: id,
    question: pregunta, history: [], familyIds: fam, areaIds: ar,
    studentGrade: perf?.grade ?? null, struggling: isStruggling(pregunta) });
  const ctx = res.ctx;
  console.log(JSON.stringify({
    id: `b${String(++n).padStart(2, "0")}`, clase, materia, pregunta,
    scope: ctx?.scope ?? "ninguno", topScore: Number((ctx?.topScore ?? 0).toFixed(4)),
    entail: ctx?.entailment ?? null,
    servido: (ctx?.citable ?? []).slice(0, 3).map((c) => ({
      libro: c.documentTitle, pag: c.pageStart, score: Number(c.score.toFixed(4)),
      texto: c.content.replace(/\s+/g, " ").slice(0, 600),
    })),
    responde: null, porque: "",
  }));
}
await sql.end();
