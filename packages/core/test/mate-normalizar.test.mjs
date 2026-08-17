/**
 * El normalizador del modo ejercicio: de lo que teclea el chico a SymPy.
 *
 *   tsx packages/core/test/mate-normalizar.test.mjs
 *
 * Es el cimiento y por eso tiene el test más terco: si esto traduce mal, el
 * resultado sale igual —un número— y nadie se entera. Todo lo que va arriba
 * (pasos verificados, gráfico) queda construido sobre una expresión que no era
 * la que el alumno escribió.
 *
 * Los caracteres de acá salen del teclado real (`teclado-mate.tsx`): superíndices
 * Unicode, el menos U+2212 que se ve idéntico al guion ASCII y no lo es, √, ×, ÷.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { aSintaxisSympy, leerEjercicio, operacionPedida, extraerExpresion, esEjercicio } from "../src/mate-normalizar.ts";

test("⚠️ la prosa NO puede entrar en la fórmula", () => {
  // Sin esto, "resolvé 3x + 5 = 20" llegaba al CAS como
  // `solve(Eq(resolvé 3x + 5, 20), x)`: el verbo del alumno viajaba adentro de
  // la ecuación y no resolvía nada.
  assert.equal(extraerExpresion("resolvé 3x + 5 = 20"), "3x + 5 = 20");
  assert.equal(extraerExpresion("factorizá x^2 - 5x + 6"), "x^2 - 5x + 6");
  assert.equal(extraerExpresion("resolvé 2x^2 - 8 = 0 paso a paso porfa"), "2x^2 - 8 = 0");
  assert.equal(
    extraerExpresion("no entiendo cómo se hace este ejercicio: (2x + 1)(x - 3) = 0"),
    "(2x + 1)(x - 3) = 0",
  );
});

test("una expresión sola pasa entera", () => {
  assert.equal(extraerExpresion("x^2 - 5x + 6 = 0"), "x^2 - 5x + 6 = 0");
});

test("⚠️ un paréntesis no puede cortar la expresión", () => {
  // "(x" no traía dígito ni era una letra suelta, así que la tira se cortaba ahí
  // y "desarrollá (x + 5)^2" se iba al chat en vez de armar tarjeta.
  assert.equal(extraerExpresion("desarrollá (x + 5)^2"), "(x + 5)^2");
  assert.equal(extraerExpresion("factorizá (x + 1)(x - 3)"), "(x + 1)(x - 3)");
  assert.equal(extraerExpresion("simplificá (x^2 - 4)/(x - 2)"), "(x^2 - 4)/(x - 2)");
});

test("superíndices Unicode → exponente", () => {
  assert.equal(aSintaxisSympy("5x⁴ − 3x + 2"), "5x^4 - 3x + 2");
  assert.equal(aSintaxisSympy("x² - 5x + 6 = 0"), "x^2 - 5x + 6 = 0");
  assert.equal(aSintaxisSympy("2x²⁵"), "2x^25", "dos superíndices seguidos son UN exponente");
});

test("⚠️ el menos U+2212 no es el guion ASCII", () => {
  // Se ven iguales en pantalla. Sin convertirlo, SymPy no parsea la resta.
  const conUnicode = "5x⁴ − 3x";
  assert.ok(conUnicode.includes("−"), "el caso de prueba tiene que traer el menos raro");
  assert.equal(aSintaxisSympy(conUnicode), "5x^4 - 3x");
  assert.ok(!aSintaxisSympy(conUnicode).includes("−"));
});

test("los símbolos del teclado", () => {
  assert.equal(aSintaxisSympy("3 × 4 ÷ 2"), "3 * 4 / 2");
  assert.equal(aSintaxisSympy("2 · 3"), "2 * 3");
  assert.equal(aSintaxisSympy("√(x+9)"), "sqrt(x+9)");
  assert.equal(aSintaxisSympy("√25"), "sqrt(25)");
  assert.equal(aSintaxisSympy("√x"), "sqrt(x)");
  assert.equal(aSintaxisSympy("2π"), "2pi");
});

test("⚠️ LA COMA DECIMAL: acá 2,5 son dos y medio", () => {
  // Para SymPy la coma separa argumentos: sin esto "2,5*x" se lee como dos
  // argumentos y el ejercicio se resuelve mal, sin ningún error a la vista.
  assert.equal(aSintaxisSympy("2,5x + 1"), "2.5x + 1");
  assert.equal(aSintaxisSympy("0,75"), "0.75");
  // Pero la coma que SEPARA no se toca.
  assert.equal(aSintaxisSympy("solve(f, x)"), "solve(f, x)");
});

test("⚠️ EL PUNTO DE MILES: $5.000 son cinco mil, no cinco", () => {
  // SymPy lee "5.000" como 5.0 — error de factor MIL, y justo en los problemas
  // de plata. Silencioso: parsea bien y da otro número.
  assert.equal(aSintaxisSympy("5.000 + 2.500"), "5000 + 2500");
  assert.equal(aSintaxisSympy("1.234.567"), "1234567");
  // Un decimal de verdad no se toca (dos dígitos, no tres).
  assert.equal(aSintaxisSympy("5.25"), "5.25");
  assert.equal(aSintaxisSympy("0.5x"), "0.5x");
});

test("⚠️ log sin base es BASE 10 acá; en SymPy es natural", () => {
  // No es cosmético: log(x) + log(x-3) = 1 da 3/2 + sqrt(9+4e)/2 con log
  // natural, y 5 con base 10. El chico obtiene un irracional donde su libro
  // tiene un entero.
  assert.equal(aSintaxisSympy("log(100)"), "log(100, 10)");
  assert.equal(aSintaxisSympy("log(x) + log(x-3)"), "log(x, 10) + log(x-3, 10)");
  // Anidado: contar paréntesis, no cortar en el primero que aparece.
  assert.equal(aSintaxisSympy("log(x(x - 3))"), "log(x(x - 3), 10)");
  // Si ya trae base, no se toca.
  assert.equal(aSintaxisSympy("log(8, 2)"), "log(8, 2)");
  // ln sigue siendo natural.
  assert.equal(aSintaxisSympy("ln(x)"), "ln(x)");
});

test("log₂(8) con subíndice, y va antes que la base 10", () => {
  assert.equal(aSintaxisSympy("log₂(8)"), "log(8, 2)");
  assert.equal(aSintaxisSympy("log₃(27) + log(100)"), "log(27, 3) + log(100, 10)");
});

test("los nombres de funciones del colegio chileno", () => {
  assert.equal(aSintaxisSympy("sen(x) + tg(x)"), "sin(x) + tan(x)");
  // Ojo de no romper palabras que los contienen.
  assert.equal(aSintaxisSympy("sin(x)"), "sin(x)");
});

test("el dx de la integral es notación, no un factor", () => {
  // Sin sacarlo, SymPy multiplica por d·x y el resultado cambia.
  assert.equal(aSintaxisSympy("2x dx"), "2x");
  assert.equal(aSintaxisSympy("∫ 2x dx"), "2x");
});

test("lo que ya resuelve SymPy no se toca", () => {
  // `convert_xor` e `implicit_multiplication` ya manejan estos dos. Meter mano
  // acá solo agrega formas de romperlo.
  assert.equal(aSintaxisSympy("x^2 + 2x"), "x^2 + 2x");
});

test("⚠️ f(x) = … es una DEFINICIÓN, no una ecuación a resolver", () => {
  // Igualar a cero y buscar raíces no es lo que el chico pidió cuando escribe
  // una función para después derivarla. El `=` significa otra cosa en cada caso.
  const def = leerEjercicio("f(x) = 5x⁴ − 3x + 2");
  assert.equal(def.esDefinicion, true);
  assert.equal(def.expr, "5x^4 - 3x + 2");
  assert.equal(def.ecuacion, undefined);

  const ec = leerEjercicio("3x + 5 = 20");
  assert.equal(ec.esDefinicion, false);
  assert.deepEqual(ec.ecuacion, { izq: "3x + 5", der: "20" });
});

test("la incógnita sale del texto, con x por defecto", () => {
  assert.equal(leerEjercicio("3x + 5 = 20").variable, "x");
  assert.equal(leerEjercicio("2t - 4 = 10").variable, "t");
  assert.equal(leerEjercicio("5 + 3 = 8").variable, "x");
});

test("el verbo del alumno decide la operación", () => {
  assert.equal(operacionPedida("ayudame a derivar este problema", false), "diff");
  assert.equal(operacionPedida("resolvé x² - 5x + 6 = 0", true), "solve");
  assert.equal(operacionPedida("factorizá x² - 5x + 6", false), "factor");
  assert.equal(operacionPedida("¿cuánto da la integral de 2x?", false), "integrate");
  assert.equal(operacionPedida("simplificá esta fracción", false), "simplify");
});

test("⚠️ una pregunta de POR QUÉ no es un ejercicio, aunque traiga la ecuación", () => {
  // El chico pregunta por qué y recibía una ficha con "2, 3" y ninguna
  // explicación. La respuesta a un "por qué" no es un número.
  for (const q of [
    "¿por qué x² - 5x + 6 = 0 tiene dos soluciones?",
    "¿qué significa que el discriminante sea negativo?",
    "¿cuándo una ecuación no tiene solución?",
    "explicame de dónde sale la fórmula general",
    "¿en qué se diferencia resolver de factorizar?",
    "¿para qué sirve factorizar?",
    "¿qué pasa si a = 0 en ax² + bx + c = 0?",
  ]) {
    assert.equal(esEjercicio(q), null, `interceptó una duda conceptual: ${q}`);
  }
});

test("pero un pedido de resolver SÍ es un ejercicio, aunque sea pregunta", () => {
  // "cómo" no delata nada: acá sí quiere el procedimiento.
  assert.ok(esEjercicio("¿cómo se resuelve x² - 5x + 6 = 0?"));
  assert.ok(esEjercicio("resolvé 3x + 5 = 20"));
  assert.ok(esEjercicio("derivá f(x) = 5x⁴ - 3x + 2"));
});

test("una ecuación sin verbo se asume que hay que resolverla", () => {
  assert.equal(operacionPedida("x² - 5x + 6 = 0", true), "solve");
  // …pero un texto sin ecuación y sin verbo NO es un ejercicio.
  assert.equal(operacionPedida("¿qué es una función cuadrática?", false), null);
});
