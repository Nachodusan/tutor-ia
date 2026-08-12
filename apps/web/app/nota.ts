/**
 * ¿Le fue bien? DOS TERCIOS.
 *
 * Vivía en `camino.tsx` ("use client"), y desde que la prueba puede tomar varias
 * preguntas del mismo punto también la necesita el SERVIDOR, al decidir si un
 * tema sigue para reforzar. Importarla desde el componente arrastraría React a
 * una ruta de API; acá es una función y nada más.
 *
 * `ceil(total * 2 / 3)` y no `total * 0.67`: con 3 preguntas, `ceil(3 * 0.67)`
 * da 3, o sea que 2 de 3 —que es lo que se quiso pedir— quedaba reprobado. El
 * redondeo de un decimal escrito a mano se comió la regla entera.
 */
export function aprobado(score: number, total: number): boolean {
  return total > 0 && score >= Math.ceil((total * 2) / 3);
}
