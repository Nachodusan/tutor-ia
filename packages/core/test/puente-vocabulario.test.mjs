/**
 * El PUENTE DE VOCABULARIO: la palabra del chico → la palabra del libro.
 *
 *   node --experimental-strip-types packages/core/test/puente-vocabulario.test.mjs
 *
 * Existe por un caso concreto y medido: "¿Cómo se factoriza un trinomio?"
 * abstenía con 0.1067 aunque el libro lo enseña en las págs. 55-56. La palabra
 * "trinomio" aparece 0 veces en el texto del estudiante de 2º Medio.
 *
 * ⚠️ LO QUE ESTAS PRUEBAS CUIDAN NO ES QUE ENCUENTRE, ES QUE NO INVENTE.
 *
 * Expandir la consulta es fácil; el peligro es abrir el gate cuando no hay nada
 * atrás. Medido: "¿cómo se calcula la derivada?" —que NO está en 2º Medio—
 * abstiene bien en crudo (0.0503) y con la forma correcta (0.0880), pero
 * concatenando la pregunta original pasa a 0.6193 y cita el solucionario. Una
 * abstención correcta convertida en respuesta inventada CON PÁGINA es peor que
 * no haber contestado: la página le da autoridad a algo que el libro no dice.
 *
 * Por eso `esListaDeTerminos` es una guarda de seguridad, no de prolijidad, y
 * `null` significa "seguí abstiniéndote".
 *
 * NO llama al modelo: prueba las guardas puras sobre salidas reales y sobre las
 * formas en que un modelo se desvía. La parte que sí necesita el modelo se mide
 * aparte, contra el reranker.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { esListaDeTerminos, aConsulta } from "../src/query-normalize.ts";

test("⚠️ acepta las salidas que GANARON la medición, textuales", () => {
  // Estos tres strings son los que el modelo devolvió de verdad en el
  // experimento, copiados tal cual. La primera versión de la guarda los
  // rechazaba a los tres —por traer saltos de línea y frases de más de seis
  // palabras— y el puente devolvía `null` siempre. El caso no mejoró nada hasta
  // que probé contra esto en vez de contra mi idea de cómo se vería.
  const S1 = "Factorización de trinomios\nDescomposición factorial de trinomios\nFactorización de expresiones cuadráticas\nFactorización de polinomios de segundo grado\nDescomposición en factores de trinomios";
  const S3 = "Factorización de trinomios de la forma x² + bx + c\nDescomposición factorial de polinomios cuadráticos\nMétodos de factorización: Trinomios cuadrados perfectos y diferencia de cuadrados\nFactorización de expresiones algebraicas de segundo grado\nTécnicas de factorización en polinomios";
  const SIN = "Expresión algebraica de tres términos\nFactorización de expresiones cuadráticas\nDescomposición factorial de polinomios de segundo grado\nMétodos de factorización de expresiones algebraicas\nProductos notables y sus inversos";
  for (const [nombre, s] of [["S1", S1], ["S3", S3], ["sin_prohibido", SIN]]) {
    assert.ok(esListaDeTerminos(s), `rechazó ${nombre}, que puntuó por encima del gate`);
  }
  assert.ok(esListaDeTerminos("el mol, masa molar, cantidad de sustancia, magnitudes químicas"),
    "también acepta separado por comas");
});

test("los saltos de línea no llegan a la búsqueda", () => {
  assert.equal(
    aConsulta("Factorización\nProductos notables\nCuadrado de binomio"),
    "Factorización, Productos notables, Cuadrado de binomio",
  );
  assert.equal(aConsulta("1. Factorización\n2. Productos notables"), "Factorización, Productos notables");
});

test("⚠️ RECHAZA PROSA: un párrafo satura el cross-encoder", () => {
  // HyDE medido: 0.9996 de topScore —el más alto del experimento— y la página
  // de oro en el puesto #99, porque TODO el corpus puntúa ~0.999. Un score alto
  // con margen bajo no es acierto, es saturación. La lista de términos es lo
  // único que mantiene el orden.
  assert.equal(esListaDeTerminos(
    "La factorización de un trinomio consiste en encontrar dos números que multiplicados den el término independiente y sumados den el coeficiente del término medio, lo que permite escribirlo como producto de dos binomios.",
  ), false);
  assert.equal(esListaDeTerminos("¿Cómo se factoriza un trinomio?"), false, "una pregunta no es una lista");
  // ⚠️ Los dos puntos NO delatan prosa: un título del índice los usa —
  // "Métodos de factorización: Trinomios cuadrados perfectos y diferencia de
  // cuadrados" es una de las salidas que ganó. Rechazar por `:` la tiraba.
  assert.ok(esListaDeTerminos("Métodos de factorización: Trinomios cuadrados perfectos, Diferencia de cuadrados"));
  // El rótulo de arranque es un tic de formato: se saca y se usa lo de atrás.
  assert.equal(
    aConsulta("Respuesta: la factorización, los productos notables"),
    "la factorización, los productos notables",
  );
});

test("rechaza las formas en que un modelo se desvía", () => {
  assert.equal(esListaDeTerminos(""), false);
  assert.equal(esListaDeTerminos("   "), false);
  assert.equal(esListaDeTerminos("factorización"), false, "un solo término no es una lista");
  assert.equal(esListaDeTerminos("a, b, c, d, e, f, g, h, i, j"), false, "demasiados: está tirando ruido");
  assert.equal(
    esListaDeTerminos("factorización, " + "x".repeat(220)),
    false,
    "largo desproporcionado",
  );
});

test("un término del índice es corto; una explicación disfrazada de término, no", () => {
  assert.equal(esListaDeTerminos(
    "factorización, para resolver esto tenés que buscar dos números que sumados den el coeficiente",
  ), false);
});

test("la señal de rendirse existe y es explícita", () => {
  // El prompt le pide devolver NADA cuando no sabe. Eso NO puede pasar por
  // lista: tiene que llegar a `puenteDeVocabulario` y volverse `null`, o sea
  // "seguí abstiniéndote".
  assert.equal(esListaDeTerminos("NADA"), false);
});
