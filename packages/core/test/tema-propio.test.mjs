/**
 * ¿El turno del alumno se sostiene solo, o cuelga del anterior?
 *
 *   tsx packages/core/test/tema-propio.test.mjs
 *
 * Existe por un caso que llegó desde la pantalla: un chico venía viendo funciones
 * inversas, escribió "ayudame a derivar este problema" con la expresión ya en la
 * conversación, y el tutor le contestó:
 *
 *   "Me parece que hubo una confusión con el término. En el material que estamos
 *    viendo, el tema es funciones inversas, no derivadas."
 *
 * …y no derivó nada. El chico no se había confundido. La causa: a la consulta de
 * búsqueda se le pegaban SIEMPRE adelante los dos últimos turnos del alumno, así
 * que seguía preguntando por inversas y el material que llegaba era el de
 * inversas. El arrastre existe por una buena razón —"no entendí" no tiene de qué
 * agarrarse sin él— pero no puede tapar un turno que trae su propio tema.
 *
 * ⚠️ NO SE MIDE POR CANTIDAD DE PALABRAS. Lo probé y es el criterio equivocado:
 * "¿qué es la fotosíntesis?" tiene UNA palabra con contenido y se sostiene
 * perfecto; "dame otro ejemplo" tiene dos y no se sostiene nada. Lo que separa es
 * cómo ARRANCA el turno.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { seSostieneSolo } from "../src/teaching.ts";

test("⚠️ el caso de la pantalla: el pedido trae su propio tema", () => {
  assert.equal(seSostieneSolo("ayudame a derivar este porblema"), true,
    "con el tema arrastrado, el tutor le corrigió el tema al alumno y no derivó");
  assert.equal(seSostieneSolo("ayudame a derivar este problema"), true);
});

test("una expresión matemática sola alcanza como consulta", () => {
  // No tiene una sola palabra larga y es perfectamente autosuficiente.
  assert.equal(seSostieneSolo("f(x) = 5x⁴ − 3x + 2"), true);
  assert.equal(seSostieneSolo("resolvé x² - 5x + 6 = 0"), true);
  assert.equal(seSostieneSolo("(2x + 1)(x - 3) = 0"), true);
});

test("una pregunta de contenido se sostiene sola aunque sea corta", () => {
  assert.equal(seSostieneSolo("¿qué es la fotosíntesis?"), true);
  assert.equal(seSostieneSolo("¿Cómo se factoriza un trinomio?"), true);
});

test("los turnos que CUELGAN del anterior siguen arrastrando el tema", () => {
  // Es para lo que se construyó el arrastre y no se puede perder: sin el tema
  // previo estos no tienen de qué agarrarse y el tutor se queda sin material.
  assert.equal(seSostieneSolo("no entendí"), false);
  assert.equal(seSostieneSolo("dame otro ejemplo"), false);
  assert.equal(seSostieneSolo("explicámelo más fácil"), false);
  assert.equal(seSostieneSolo("dale"), false);
});

test("arrancar con un conector es declararse continuación", () => {
  assert.equal(seSostieneSolo("¿y en las plantas?"), false);
  assert.equal(seSostieneSolo("¿y eso por qué?"), false);
  assert.equal(seSostieneSolo("pero entonces cómo se hace"), false);
  assert.equal(seSostieneSolo("además qué pasa si es negativo"), false);
});
