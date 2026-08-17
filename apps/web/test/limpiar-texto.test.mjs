/**
 * El limpiador del texto del tutor.
 *
 *   node --experimental-strip-types apps/web/test/limpiar-texto.test.mjs
 *
 * Existe por un cambio concreto: cuando el tutor pasó a resolver ejercicios paso a
 * paso, hubo que permitirle numerar los pasos — y con el formato más suelto empezó
 * a filtrar markdown y LaTeX. La burbuja pinta TEXTO PLANO, así que un `**` o un
 * `$x$` los ve el chico en la pantalla y la voz los pronuncia.
 *
 * Los dos casos que valen más que todos los demás son los que casi rompo al
 * escribirlo, y por eso quedan clavados acá:
 *
 *  1. LOS PRECIOS. "cuesta $5 y el otro $8" tiene dos `$` pareados que NO son
 *     LaTeX. La primera versión los borraba y dejaba "cuesta 5 y el otro 8".
 *  2. EL ORDEN. Traducir los comandos antes de sacar los `$` borra las marcas que
 *     distinguen una fórmula de un monto, y entonces los signos sobreviven:
 *     `$ax^2+bx+c$` quedaba `$ax²+bx+c$`.
 *
 * Si alguien toca las regex, esto falla antes que el alumno.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { limpiarMarcas, cleanTutorText, latexAMano } from "../app/limpiar-texto.ts";

test("la negrita que el prompt no logra frenar se saca igual", () => {
  assert.equal(
    limpiarMarcas("si dan cero, **una de las dos tiene que ser cero**."),
    "si dan cero, una de las dos tiene que ser cero.",
  );
  assert.equal(limpiarMarcas("es __muy__ importante"), "es muy importante");
});

test("los backticks y los títulos también", () => {
  assert.equal(limpiarMarcas("escribí `2x + 1 = 0` y despejá"), "escribí 2x + 1 = 0 y despejá");
  assert.equal(limpiarMarcas("### Paso 1\ntexto"), "Paso 1\ntexto");
});

test("el LaTeX queda como se escribe a mano", () => {
  assert.equal(limpiarMarcas("la forma $ax^2 + bx + c$ se factoriza"), "la forma ax² + bx + c se factoriza");
  assert.equal(limpiarMarcas("queda $\\frac{1}{2}$ del total"), "queda (1)/(2) del total");
  assert.equal(limpiarMarcas("$\\sqrt{x^2+9}$ con x=4"), "√(x²+9) con x=4");
  assert.equal(limpiarMarcas("$2 \\times 3 = 6$"), "2 × 3 = 6");
});

test("la fórmula general sale legible aunque venga sin delimitadores", () => {
  assert.equal(
    latexAMano("x = (-b \\pm \\sqrt{b^2-4ac}) / 2a"),
    "x = (-b ± √(b²-4ac)) / 2a",
  );
});

test("⚠️ LOS PRECIOS NO SON LaTeX: dos signos pesos pareados se dejan en paz", () => {
  assert.equal(
    limpiarMarcas("cuesta $5 y el otro $8 pesos"),
    "cuesta $5 y el otro $8 pesos",
    "borró los pesos: en Historia o Ciudadanía eso cambia la frase",
  );
  assert.equal(
    limpiarMarcas("el sueldo va de $500.000 a $700.000"),
    "el sueldo va de $500.000 a $700.000",
  );
});

test("⚠️ EL ORDEN: sacar los $ va ANTES de traducir, o los signos sobreviven", () => {
  const r = limpiarMarcas("la forma $ax^2 + bx + c$ se factoriza");
  assert.ok(!r.includes("$"), `quedaron signos de peso: ${r}`);
  assert.ok(r.includes("ax²"), `no tradujo el exponente: ${r}`);
});

test("la matemática en texto plano no se toca", () => {
  const pasos = "3x + 5 - 5 = 20 - 5\n3x = 15\nx = 5";
  assert.equal(limpiarMarcas(pasos), pasos);
  assert.equal(limpiarMarcas("√(x²+9) con x=4 da 5"), "√(x²+9) con x=4 da 5");
});

test("un asterisco suelto puede ser una multiplicación, no una negrita", () => {
  assert.equal(limpiarMarcas("el área es 2*3 = 6"), "el área es 2*3 = 6");
});

test("un exponente con letra se deja: no tiene forma en Unicode", () => {
  assert.equal(limpiarMarcas("3^x crece rápido"), "3^x crece rápido");
});

test("los pasos numerados sobreviven enteros — son la razón del cambio", () => {
  const r = cleanTutorText("1. Restamos 5 a los dos lados:\n3x = 15\n2. Dividimos por 3:\nx = 5");
  assert.ok(r.includes("1. Restamos"), `se comió el primer paso: ${r}`);
  assert.ok(r.includes("2. Dividimos"), `se comió el segundo paso: ${r}`);
  assert.ok(r.includes("x = 5"), `se comió el resultado: ${r}`);
});

test("cleanTutorText sigue sacando las páginas y el 'según el material'", () => {
  assert.equal(
    cleanTutorText("La célula (pág. 8) tiene núcleo."),
    "La célula tiene núcleo.",
  );
  assert.equal(
    cleanTutorText("según tu material, la mitocondria produce energía."),
    "La mitocondria produce energía.",
  );
});
