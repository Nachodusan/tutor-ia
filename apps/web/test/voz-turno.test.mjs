/**
 * El detector de turnos, contra trazas de audio sintéticas.
 *
 *   node --experimental-strip-types apps/web/test/voz-turno.test.mjs
 *
 * Existe por un reclamo concreto: "a veces me corta la mitad de lo que quiero
 * decir y no entiende". Eso es una PAUSA PARA PENSAR que el detector leyó como
 * final de la idea. Acá esa pausa es una traza, y el caso queda clavado: si
 * alguien vuelve a bajar `SILENCE_MS`, esto falla.
 *
 * Las trazas son listas de tramos [nivel, ms]. El nivel es el mismo número que
 * mide el micrófono: promedio de |muestra − 128|, 0-128. ~20 es hablar normal,
 * 0-2 es una habitación en silencio.
 */
import assert from "node:assert/strict";
import {
  turnoNuevo, turnoPaso, turnoTermino,
  interrupcionPaso, hayInterrupcion,
  SILENCE_MS, MIN_HABLA_MS, MAX_TURNO_MS,
} from "../app/voz-turno.ts";

const CUADRO = 16;   // ~60 fps, como el requestAnimationFrame real

/** Corre una traza y devuelve en qué milisegundo se habría cortado el turno. */
function correr(tramos) {
  let t = turnoNuevo();
  let ms = 0;
  for (const [nivel, dur] of tramos) {
    for (let i = 0; i < dur; i += CUADRO) {
      t = turnoPaso(t, nivel, CUADRO);
      ms += CUADRO;
      if (turnoTermino(t)) return ms;
    }
  }
  return null;   // no cortó
}

const casos = [];
const test = (nombre, fn) => casos.push([nombre, fn]);

test("la pausa para pensar NO corta la idea por la mitad", () => {
  // "Profe, lo que no entiendo es…" (pausa de 1,5 s) "…por qué la célula"
  const corte = correr([
    [20, 1200],   // habla
    [1, 1500],    // piensa — con el 1200 ms de antes, acá se cortaba
    [20, 1200],   // sigue la MISMA idea
    [1, 3000],    // ahora sí terminó
  ]);
  assert.ok(corte !== null, "tenía que cortar al final");
  // Corta recién en el silencio final: después de los 3900 ms de la frase.
  assert.ok(corte > 3900, `cortó a los ${corte} ms, en el medio de la frase`);
  assert.ok(corte < 3900 + SILENCE_MS + 200, `tardó de más: ${corte} ms`);
});

test("un ruido suelto no abre un turno", () => {
  // Un portazo de 100 ms y después silencio: no llega a MIN_HABLA_MS.
  const corte = correr([[40, 100], [0, 5000]]);
  assert.equal(corte, null, "un ruido corto no puede mandarse a transcribir");
});

test("un 'hola' suelto SÍ cierra el turno", () => {
  // EL CASO QUE MOTIVÓ BAJAR EL UMBRAL. Una palabra corta da ~250 ms de voz
  // contada (las consonantes no cruzan el umbral). Con los 400 ms de antes el
  // turno no cerraba NUNCA y había que decir "hola, hola, hola" para acumular.
  const corte = correr([[18, 250], [1, 3000]]);
  assert.ok(corte !== null, "decir 'hola' una vez tiene que alcanzar");
  assert.ok(corte < 250 + SILENCE_MS + 200, `tardó de más: ${corte} ms`);
});

test("dos palabras separadas por una respiración siguen siendo un turno", () => {
  // "hola… ¿estás?" — la pausa corta no cierra nada.
  const corte = correr([[18, 250], [1, 500], [18, 300], [1, 3000]]);
  assert.ok(corte !== null && corte > 1050, `cortó a los ${corte} ms, en la respiración`);
});

test("una frase corta pero real sí cierra", () => {
  const corte = correr([[20, 600], [0, 2500]]);
  assert.ok(corte !== null && corte > 600 + SILENCE_MS - 100 && corte < 600 + SILENCE_MS + 200,
    `cortó a los ${corte} ms`);
});

test("el turno tiene techo aunque nadie hable", () => {
  const corte = correr([[0, MAX_TURNO_MS + 2000]]);
  assert.ok(corte !== null && corte > MAX_TURNO_MS, `no cortó nunca (${corte})`);
});

test("hablar sin parar tampoco graba para siempre", () => {
  const corte = correr([[25, MAX_TURNO_MS + 2000]]);
  assert.ok(corte !== null && corte > MAX_TURNO_MS, `no cortó nunca (${corte})`);
});

test("interrumpir pide voz sostenida, no un pico", () => {
  let s = 0;
  // Pico corto del propio parlante: 200 ms.
  for (let i = 0; i < 200; i += CUADRO) s = interrupcionPaso(s, 25, CUADRO);
  assert.equal(hayInterrupcion(s), false, "un pico no puede callar al tutor");
  // El alumno hablando encima: sigue subiendo hasta pasar los 320 ms.
  for (let i = 0; i < 200; i += CUADRO) s = interrupcionPaso(s, 25, CUADRO);
  assert.equal(hayInterrupcion(s), true, "voz sostenida sí interrumpe");
});

test("el eco del tutor por debajo del umbral no interrumpe", () => {
  let s = 0;
  // Nivel 10: por encima de "hay voz" (6) pero por debajo de interrumpir (15).
  for (let i = 0; i < 3000; i += CUADRO) s = interrupcionPaso(s, 10, CUADRO);
  assert.equal(hayInterrupcion(s), false, "el tutor no puede interrumpirse a sí mismo");
});

let fallos = 0;
for (const [nombre, fn] of casos) {
  try { fn(); console.log(`  ok  ${nombre}`); }
  catch (e) { fallos++; console.error(`FALLA  ${nombre}\n       ${e.message}`); }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos`);
process.exit(fallos ? 1 : 0);
