/**
 * CUÁNDO TERMINA UN TURNO Y CUÁNDO TE ESTÁN INTERRUMPIENDO.
 *
 * Esto vivía suelto adentro del bucle de `requestAnimationFrame` del chat, y ahí
 * no hay forma de probarlo: el bucle no corre con la pestaña en segundo plano,
 * y para ver si "corta en el medio de una idea" hay que hablarle al micrófono y
 * confiar en la memoria. Acá son funciones puras que reciben el nivel de audio y
 * cuánto pasó desde el cuadro anterior, así una traza sintética puede reproducir
 * exactamente el caso que se quiere arreglar (ver `test/voz-turno.test.mjs`).
 *
 * El "nivel" es siempre el mismo número: el promedio de |muestra − 128| del
 * micrófono, entre 0 y 128.
 */

/** Acá hay voz. */
export const SPEECH_THRESH = 6;
/**
 * Cuánto silencio da por terminada la idea.
 *
 * Era 1200 ms y cortaba EN EL MEDIO: cualquiera que piensa mientras habla hace
 * pausas más largas que eso ("entonces… lo que no entiendo es…"), y el turno se
 * cerraba con media pregunta. El tutor después contestaba muy bien otra cosa.
 */
export const SILENCE_MS = 1800;
/**
 * Voz acumulada mínima para que un turno cuente. Antes alcanzaba UN cuadro por
 * encima del umbral —un portazo, una silla— para abrir un turno que 1,2 s
 * después se mandaba a transcribir: ruido convertido en pregunta.
 */
export const MIN_HABLA_MS = 400;
/** Techo del turno. Sin esto, una sala en silencio graba para siempre. */
export const MAX_TURNO_MS = 45_000;
/**
 * Interrumpir al tutor pide MÁS que hablar normalmente, y sostenido. El parlante
 * entra por el micrófono: aunque el navegador cancele el eco, no lo cancela
 * entero, y con el umbral de voz normal el tutor se interrumpía a sí mismo.
 */
export const BARGE_THRESH = 15;
export const BARGE_MS = 320;

export interface Turno {
  /** Voz acumulada en el turno. */
  msHablando: number;
  /** Cuánto hace que no se oye voz. */
  msSilencio: number;
  /** Largo total del turno. */
  msTotal: number;
}

export const turnoNuevo = (): Turno => ({ msHablando: 0, msSilencio: 0, msTotal: 0 });

/** Un cuadro de audio: `level` del micrófono, `dt` ms desde el cuadro anterior. */
export function turnoPaso(t: Turno, level: number, dt: number): Turno {
  const hay = level > SPEECH_THRESH;
  return {
    msHablando: t.msHablando + (hay ? dt : 0),
    msSilencio: hay ? 0 : t.msSilencio + dt,
    msTotal: t.msTotal + dt,
  };
}

/**
 * ¿Se terminó de hablar?
 *
 * Las dos condiciones importan y por motivos distintos: `msHablando` evita que
 * un ruido suelto abra y cierre un turno vacío, y `msSilencio` es el que decide
 * que la idea terminó. La segunda se reinicia con cada cuadro con voz, así que
 * una pausa para pensar en el medio de una frase no cierra nada.
 */
export function turnoTermino(t: Turno): boolean {
  if (t.msTotal > MAX_TURNO_MS) return true;
  return t.msHablando >= MIN_HABLA_MS && t.msSilencio > SILENCE_MS;
}

/** Ms de voz sostenida encima del umbral de interrupción; 0 corta la racha. */
export function interrupcionPaso(sostenidoMs: number, level: number, dt: number): number {
  return level > BARGE_THRESH ? sostenidoMs + dt : 0;
}

export const hayInterrupcion = (sostenidoMs: number): boolean => sostenidoMs >= BARGE_MS;
