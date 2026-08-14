/**
 * EL SANEADO DE UNIDADES — la fuente del camino.
 *
 *   pnpm -C packages/rag test
 *
 * Los casos no son inventados: salen de medir el corpus. En crudo, solo 59 de
 * 228 rangos (documento, unidad) no se solapan con otro. Lo que estas pruebas
 * cuidan es que el saneador limpie la basura conocida SIN inventar un camino
 * donde el dato no da — un camino con las unidades al revés manda al chico a
 * estudiar en el orden equivocado, y eso es peor que no tener camino.
 */
import assert from "node:assert/strict";
import { agruparEnUnidades, rangosDeUnidades, tituloDeUnidad } from "../src/unidades.ts";

/** Atajo: una corrida de páginas de una unidad, un chunk por página. */
const corrida = (unit, desde, hasta, chunks = 1) =>
  Array.from({ length: hasta - desde + 1 }, (_, i) => ({ page: desde + i, unit, chunks }));

let ok = 0;
const prueba = (nombre, fn) => {
  fn();
  console.log(`  ok  ${nombre}`);
  ok++;
};

// ─── rangosDeUnidades ────────────────────────────────────────────────────────

prueba("un libro limpio devuelve sus unidades en orden", () => {
  const r = rangosDeUnidades([...corrida(1, 7, 47), ...corrida(2, 49, 93), ...corrida(3, 96, 137)]);
  assert.deepEqual(
    r.map((x) => [x.unit, x.pageStart, x.pageEnd]),
    [[1, 7, 47], [2, 49, 93], [3, 96, 137]],
  );
});

prueba("la página del índice no se roba la unidad (Cs. Naturales 4º, pág. 6)", () => {
  // 5 chunks de la "unidad 2" en la página del índice, lejos de su corrida real.
  const r = rangosDeUnidades([
    ...corrida(1, 7, 47),
    { page: 6, unit: 2, chunks: 5 },
    ...corrida(2, 49, 93),
  ]);
  assert.deepEqual(r.map((x) => [x.unit, x.pageStart, x.pageEnd]), [[1, 7, 47], [2, 49, 93]]);
});

prueba("el cierre del libro tampoco (mismo libro, pág. 197)", () => {
  const r = rangosDeUnidades([
    ...corrida(1, 7, 47),
    ...corrida(2, 49, 93),
    { page: 197, unit: 1, chunks: 2 },
  ]);
  assert.deepEqual(r.map((x) => [x.unit, x.pageStart, x.pageEnd]), [[1, 7, 47], [2, 49, 93]]);
});

prueba("una página disputada se la queda quien tiene más chunks ahí", () => {
  const r = rangosDeUnidades([
    ...corrida(1, 10, 30),
    { page: 31, unit: 1, chunks: 1 },
    { page: 31, unit: 2, chunks: 4 },
    ...corrida(2, 32, 60),
  ]);
  assert.equal(r[0].pageEnd, 30, "la 31 es de la unidad 2");
  assert.equal(r[1].pageStart, 31);
});

prueba("un hueco corto no parte la unidad", () => {
  // páginas 20-24 sin chunk: una lámina a doble página, no otra unidad.
  const r = rangosDeUnidades([...corrida(1, 10, 19), ...corrida(1, 25, 40), ...corrida(2, 45, 60)]);
  assert.deepEqual(r[0], { unit: 1, pageStart: 10, pageEnd: 40, paginas: 26 });
});

prueba("la numeración al revés se rechaza entera", () => {
  // 14 documentos del corpus caen acá: el extractor se confundió de unidad.
  assert.deepEqual(rangosDeUnidades([...corrida(2, 35, 55), ...corrida(1, 109, 135)]), []);
});

prueba("dos unidades que se solapan de verdad se rechazan", () => {
  const r = rangosDeUnidades([...corrida(1, 10, 60), ...corrida(2, 40, 90, 3)]);
  // La 40-60 se la lleva la unidad 2 por mayoría, así que NO queda solape:
  // el saneador arregla lo que puede en vez de tirar el libro.
  assert.deepEqual(r.map((x) => [x.unit, x.pageStart, x.pageEnd]), [[1, 10, 39], [2, 40, 90]]);
});

prueba("una sola unidad no es un camino", () => {
  assert.deepEqual(rangosDeUnidades(corrida(1, 10, 80)), []);
});

prueba("una unidad de una página es un artefacto y se descarta", () => {
  const r = rangosDeUnidades([...corrida(1, 10, 40), { page: 56, unit: 6, chunks: 1 }, ...corrida(4, 80, 106)]);
  assert.deepEqual(r.map((x) => x.unit), [1, 4], "la unidad 6 fantasma no entra");
});

prueba("sin datos no se inventa nada", () => {
  assert.deepEqual(rangosDeUnidades([]), []);
});

// ─── agruparEnUnidades ───────────────────────────────────────────────────────

/** Atajo: una lección del índice. */
const lec = (ord, unit, p0, p1) => ({ ord, unit, pageStart: p0, pageEnd: p1 });

prueba("agrupa lecciones consecutivas de la misma unidad", () => {
  const g = agruparEnUnidades([lec(0, 1, 14, 23), lec(1, 1, 26, 35), lec(2, 2, 58, 67)]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { unit: 1, pageStart: 14, pageEnd: 35, lecciones: [0, 1] });
  assert.deepEqual(g[1], { unit: 2, pageStart: 58, pageEnd: 67, lecciones: [2] });
});

prueba("la unidad que se repite más adelante es OTRO nodo (Biología 1º y 2º medio)", () => {
  // Numeración real del libro: 1,1 · 2 · 1,1 · 2 — reinicia a mitad de tomo.
  const g = agruparEnUnidades([
    lec(0, 1, 14, 23), lec(1, 1, 26, 35),
    lec(2, 2, 58, 67),
    lec(3, 1, 130, 141), lec(4, 1, 144, 151),
    lec(5, 2, 165, 171),
  ]);
  assert.equal(g.length, 4, "cuatro corridas, no dos unidades");
  assert.deepEqual(g.map((x) => [x.unit, x.pageStart, x.pageEnd]),
    [[1, 14, 35], [2, 58, 67], [1, 130, 151], [2, 165, 171]]);
});

prueba("no quedan huecos: la unidad llega hasta su última lección", () => {
  const g = agruparEnUnidades([lec(0, 1, 14, 23), lec(1, 1, 26, 56), lec(2, 2, 165, 199)]);
  assert.equal(g[0].pageEnd, 56);
  assert.equal(g[1].pageStart, 165, "el hueco 57-164 no lo inventa nadie: lo cubren las lecciones que haya");
});

prueba("una lección sin unidad sigue en la corrida abierta", () => {
  const g = agruparEnUnidades([lec(0, 1, 10, 20), lec(1, null, 21, 30), lec(2, 1, 31, 40)]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].lecciones, [0, 1, 2]);
  assert.equal(g[0].pageEnd, 40);
});

prueba("una lección sin unidad ANTES de la primera no se cuelga de la nada", () => {
  const g = agruparEnUnidades([lec(0, null, 5, 8), lec(1, 1, 10, 20)]);
  assert.deepEqual(g.map((x) => x.lecciones), [[1]]);
});

prueba("el orden del índice manda, aunque venga desordenado", () => {
  const g = agruparEnUnidades([lec(2, 2, 58, 67), lec(0, 1, 14, 23), lec(1, 1, 26, 35)]);
  assert.deepEqual(g.map((x) => x.unit), [1, 2]);
});

prueba("sin lecciones no hay unidades", () => {
  assert.deepEqual(agruparEnUnidades([]), []);
});

// ─── tituloDeUnidad ──────────────────────────────────────────────────────────

prueba("el título sale del encabezado corriente", () => {
  const t = tituloDeUnidad(1, [
    "Unidad 1 • La Tierra en movimiento ¿Qué aprenderás en esta unidad?",
    "Observo y comento Unidad 1 • La Tierra en movimiento Conozcamos las placas",
  ]);
  assert.equal(t, "La Tierra en movimiento");
});

prueba("la cola de cuerpo no entra en el título", () => {
  const t = tituloDeUnidad(2, [
    "Unidad 2 · ¿Cómo uso los números?",
    "Unidad 2 · ¿Cómo uso los números? Acciones en los problemas a. b. c.",
    "Unidad 2 · ¿Cómo uso los números? ¿En qué mes está de cumpleaños?",
  ]);
  assert.equal(t, "¿Cómo uso los números?");
});

prueba("dos encabezados sin principio en común no dan título", () => {
  // Lenguaje 1º: la regex agarra la bibliografía y cada línea empieza distinto.
  const t = tituloDeUnidad(1, [
    "Unidad 1 • Pág. 84 Long, J. (2007). Vida de",
    "Unidad 1 • Marc, F. (1911). El sueño",
  ]);
  assert.equal(t, null);
});

prueba("no confunde el encabezado de OTRA unidad", () => {
  const t = tituloDeUnidad(3, [
    "Unidad 1 • El sistema solar",
    "Unidad 3 • Nuestro cuerpo en movimiento",
    "Unidad 3 • Nuestro cuerpo en movimiento",
  ]);
  assert.equal(t, "Nuestro cuerpo en movimiento");
});

prueba("una sola mención no alcanza: sería la captura entera con su cola", () => {
  assert.equal(tituloDeUnidad(1, ["Unidad 1 • Pág. 84 Long, J. (2007). Vida de"]), null);
});

prueba("sin encabezado devuelve null y quien llama pone 'Unidad N'", () => {
  assert.equal(tituloDeUnidad(1, ["texto cualquiera sin encabezado corriente"]), null);
});

console.log(`\n${ok}/${ok} casos`);
