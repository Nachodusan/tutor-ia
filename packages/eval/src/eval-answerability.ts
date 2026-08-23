/**
 * Mide un discriminador de answerability contra el banco ETIQUETADO A MANO.
 *
 *   pnpm --filter @tutor-ia/eval eval-answerability
 *
 * Existe porque los cuatro intentos de arreglar el discriminador (ver
 * `answerability.ts`) se calibraron contra 6 casos con etiquetas discutibles, y
 * eso no permite decidir nada. Acá cada trío se etiquetó LEYENDO el material
 * servido, con una línea de justificación por caso — el mismo método que hace
 * defendibles los anclajes de `lector-v1`.
 *
 * La etiqueta es sobre el MATERIAL SERVIDO, no sobre el corpus: la pregunta es
 * "¿esto responde?", no "¿existe en alguna parte algo que responda?". Un banco
 * que confunda las dos manda a arreglar el retrieval cuando falla el juez.
 */
import { readFile } from "node:fs/promises";
import { nliVerify, comoAfirmacion } from "@tutor-ia/rag";

interface Caso {
  id: string; clase: string; materia: string; pregunta: string;
  scope: string; topScore: number;
  servido: { libro: string; pag: number; score: number; texto: string }[];
  responde: "si" | "parcial" | "no"; porque: string;
}

const UMBRAL = Number(process.env.RAG_ANSWERABILITY_MIN ?? "0.85");
const ruta = new URL("../golden/answerability-banco.jsonl", import.meta.url).pathname;
const casos: Caso[] = (await readFile(ruta, "utf8")).split("\n")
  .filter((l) => l.trim()).map((l) => JSON.parse(l) as Caso);

console.log(`\nBanco: ${casos.length} tríos · umbral ${UMBRAL}\n`);
console.log(`${"id".padEnd(5)} ${"etiqueta".padEnd(9)} ${"entail".padStart(7)} ${"dice".padEnd(7)} ${"ok".padEnd(4)} pregunta`);
let aciertos = 0, evaluables = 0;
const filas: { lab: string; e: number }[] = [];
for (const c of casos) {
  if (c.servido.length === 0) {
    // Sin material el discriminador ni corre: el gate ya abstuvo. Cuenta como
    // acierto del sistema pero NO mide al discriminador — se informa aparte.
    console.log(`${c.id.padEnd(5)} ${c.responde.padEnd(9)} ${"—".padStart(7)} ${"—".padEnd(7)} ${"n/a".padEnd(4)} ${c.pregunta.slice(0, 46)}`);
    continue;
  }
  const e = (await nliVerify(comoAfirmacion(c.pregunta), c.servido.map((s) => s.texto))).entailment;
  const dice = e >= UMBRAL ? "si" : "no";
  // "parcial" se cuenta aparte: el discriminador binario no puede acertarlo.
  const ok = c.responde === "parcial" ? null : dice === (c.responde === "si" ? "si" : "no");
  if (ok !== null) { evaluables++; if (ok) aciertos++; }
  filas.push({ lab: c.responde, e });
  console.log(`${c.id.padEnd(5)} ${c.responde.padEnd(9)} ${e.toFixed(3).padStart(7)} ${dice.padEnd(7)} ${(ok === null ? "—" : ok ? "sí" : "NO").padEnd(4)} ${c.pregunta.slice(0, 46)}`);
}
const si = filas.filter((f) => f.lab === "si").map((f) => f.e);
const no = filas.filter((f) => f.lab === "no").map((f) => f.e);
console.log(`\nacierto: ${aciertos}/${evaluables}`);
console.log(`entailment cuando SÍ responde: mín ${Math.min(...si).toFixed(3)} · máx ${Math.max(...si).toFixed(3)}`);
console.log(`entailment cuando NO responde: mín ${Math.min(...no).toFixed(3)} · máx ${Math.max(...no).toFixed(3)}`);
console.log(`separación (mín sí − máx no): ${(Math.min(...si) - Math.max(...no)).toFixed(3)}   ← >0 significa que UN umbral los separa`);
