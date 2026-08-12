/**
 * CUÁNTAS PREGUNTAS ENTRAN EN LA PRUEBA, según cuántos puntos eligió el alumno.
 *
 * Vive acá y no en la ruta ni en la pantalla porque las DOS lo necesitan y tienen
 * que dar el mismo número: la pantalla lo escribe en el botón ("Rendir · 8
 * preguntas") antes de generar nada, y la ruta lo usa para pedírselas al modelo.
 * Si divergen, el alumno aprieta esperando 8 y le llegan 5 — y no hay forma de
 * que se entere de por qué.
 *
 * La regla apunta a ~8 preguntas SIEMPRE, repartidas entre lo elegido:
 *  · 1 punto  → 8 preguntas de ese punto (un repaso a fondo de una sola lección)
 *  · 4 puntos → 2 de cada uno
 *  · 8 o más  → 1 de cada uno
 *
 * Una prueba de 1 pregunta (elegir un solo punto y que caiga una) no mide nada;
 * una de 40 (elegir todo el libro a 3 por lección) no la termina nadie.
 */

/**
 * Tope de puntos que entran en una misma prueba.
 *
 * No es estético: la generación es UNA llamada al modelo con un techo de tokens,
 * y pasadas ~10-12 preguntas el JSON se corta a la mitad y se pierde la prueba
 * entera, no la última pregunta.
 */
export const TOPE_TEMAS = 10;

/** A cuántas preguntas apunta la prueba, cuando se puede. */
const OBJETIVO = 8;

export interface Reparto {
  /** Puntos que se van a tomar (≤ TOPE_TEMAS). */
  temas: number;
  /** Preguntas por punto. */
  porTema: number;
  /** Total de preguntas de la prueba. */
  total: number;
  /** Puntos elegidos que NO entran por el tope. Se avisan, no se esconden. */
  recortados: number;
}

export function repartoPrueba(elegidos: number): Reparto {
  const temas = Math.min(Math.max(elegidos, 0), TOPE_TEMAS);
  if (temas === 0) return { temas: 0, porTema: 0, total: 0, recortados: 0 };
  const porTema = Math.min(OBJETIVO, Math.max(1, Math.round(OBJETIVO / temas)));
  return {
    temas,
    porTema,
    total: temas * porTema,
    recortados: Math.max(0, elegidos - TOPE_TEMAS),
  };
}
