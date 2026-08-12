/**
 * La limpieza de muletillas de la CONSULTA.
 *
 *   node --experimental-strip-types packages/core/test/query-normalize.test.mjs
 *
 * Existe por una medición concreta: la misma duda, escrita de dos formas,
 * recuperaba material o no recuperaba nada.
 *   "¿qué es una célula?"                    → topScore 0.383, 6 fragmentos
 *   "no, mejor explicame qué es una célula"  → topScore 0.084, NADA
 *
 * Lo que estas pruebas cuidan es el otro lado: que sacar muletillas NUNCA se
 * lleve puesto el tema. Un falso positivo acá le borra la pregunta al alumno.
 */
import assert from "node:assert/strict";
import { limpiarMuletillas } from "../src/query-normalize.ts";

const casos = [
  // — se limpia lo que no aporta tema —
  ["no, mejor explicame qué es una célula", "qué es una célula"],
  ["oye profe, me podés explicar la mitosis", "la mitosis"],
  ["dale, contame de la fotosíntesis", "de la fotosíntesis"],
  ["porfa explicame el sistema endocrino", "el sistema endocrino"],
  // Solo se saca el "¿" de apertura; el "?" del final no molesta a la búsqueda.
  ["a ver, ¿qué es la evolución?", "qué es la evolución?"],

  // — el tema queda intacto —
  ["¿qué es una célula?", "qué es una célula?"],
  ["la célula animal", "la célula animal"],
  ["¿por qué las plantas hacen fotosíntesis?", "por qué las plantas hacen fotosíntesis?"],
  // "no" como parte del contenido: no puede desaparecer la pregunta
  ["¿por qué no todas las células tienen núcleo?", "por qué no todas las células tienen núcleo?"],

  // — nunca queda vacío —
  ["dale", "dale"],
  ["no, mejor", "no, mejor"],
];

let fallos = 0;
for (const [entrada, esperado] of casos) {
  const salida = limpiarMuletillas(entrada);
  if (salida !== esperado) {
    fallos++;
    console.error(`FALLA  ${JSON.stringify(entrada)}\n       dio ${JSON.stringify(salida)}\n       esperaba ${JSON.stringify(esperado)}`);
  } else {
    console.log(`  ok  ${JSON.stringify(entrada)} → ${JSON.stringify(salida)}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos`);
process.exit(fallos ? 1 : 0);
