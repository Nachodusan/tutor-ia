/**
 * POMODORO — las reglas del reloj de estudio, compartidas.
 *
 * Módulo plano a propósito (sin "use client", sin imports): lo usan la pantalla
 * del alumno —que dibuja el reloj— y la ruta que guarda el perfil —que recorta
 * lo que llega—. Si los topes vivieran solo en la pantalla, un cliente viejo
 * podría escribir un bloque de 8 horas; si vivieran solo en el server, la
 * pantalla ofrecería opciones que el server rechaza.
 *
 * Qué NO hay acá: el estado del reloj corriendo. Eso vive en el navegador
 * (`app/pomodoro.tsx`), porque es lo único que necesita el segundero, y
 * mandarlo a la base costaría un round-trip por tick para nada.
 */

/** Lo que el alumno configura. `hora`/`dias` son el recordatorio; los minutos, el ciclo. */
export interface PomodoroConfig {
  estudioMin: number;
  descansoMin: number;
  /** "HH:MM" en el reloj del alumno. null = sin recordatorio. */
  hora: string | null;
  /** Dígitos ISO pegados: "1" lunes … "7" domingo. "" = ningún día. */
  dias: string;
}

/** El pomodoro clásico. Es el que el alumno ya trae de oídas. */
export const POMODORO_DEFAULT: PomodoroConfig = {
  estudioMin: 25,
  descansoMin: 5,
  hora: null,
  dias: "12345",
};

/**
 * Topes. El mínimo de estudio es 10 y no 5: en menos de diez minutos no se
 * estudia nada y el reloj pasa a ser el juguete. El máximo es 60 porque la
 * evidencia de atención sostenida en adolescentes no da para más de una hora
 * sin pausa — y quien quiera dos horas hace dos bloques, que es el punto.
 */
export const POMO_TOPES = {
  estudioMin: 10, estudioMax: 60,
  descansoMin: 3, descansoMax: 30,
} as const;

/** Opciones que ofrece la pantalla. Botones y no un campo numérico: es más
 *  rápido de tocar en el teléfono y no deja escribir "0". */
export const OPCIONES_ESTUDIO = [15, 20, 25, 30, 45, 60] as const;
export const OPCIONES_DESCANSO = [3, 5, 10, 15] as const;

export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Nombres de los días, indexados por dígito ISO (1 = lunes). */
export const DIAS_LABEL: Record<string, string> = {
  "1": "L", "2": "M", "3": "M", "4": "J", "5": "V", "6": "S", "7": "D",
};

/** Deja solo dígitos 1-7, sin repetidos y en orden. "" es válido: ningún día. */
export function limpiarDias(s: string): string {
  return [...new Set(s.split("").filter((c) => c >= "1" && c <= "7"))].sort().join("");
}

/** Día de hoy en dígito ISO. `getDay()` da 0 para domingo; acá domingo es 7. */
export function diaHoy(d = new Date()): string {
  return String(d.getDay() === 0 ? 7 : d.getDay());
}

/** "17:00" → minutos desde medianoche. -1 si no es una hora. */
export function horaEnMinutos(hhmm: string): number {
  if (!HORA_RE.test(hhmm)) return -1;
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * ¿Le toca estudiar AHORA y todavía no arrancó?
 *
 * Se pregunta con el reloj del navegador —no con el del servidor— porque la
 * hora que el alumno eligió es la de su casa. `ultimoInicio` es lo que hace
 * honesto el aviso: sin eso, el panel le insiste "es tu hora de estudiar" a
 * alguien que ya lleva veinte minutos estudiando.
 *
 * La ventana es de 3 horas: pasada la tarde entera, insistir con un
 * recordatorio de las 17:00 a las 23:00 solo enseña a ignorarlo.
 */
export const VENTANA_RECORDATORIO_MIN = 180;

export function tocaEstudiar(cfg: PomodoroConfig, ultimoInicio: Date | null, ahora = new Date()): boolean {
  if (!cfg.hora || !cfg.dias.includes(diaHoy(ahora))) return false;
  const objetivo = horaEnMinutos(cfg.hora);
  if (objetivo < 0) return false;
  const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
  if (ahoraMin < objetivo || ahoraMin > objetivo + VENTANA_RECORDATORIO_MIN) return false;
  return !yaArrancoHoy(ultimoInicio, ahora);
}

/** ¿El último bloque arrancó HOY? (mismo día en el reloj del alumno). */
export function yaArrancoHoy(ultimoInicio: Date | null, ahora = new Date()): boolean {
  if (!ultimoInicio) return false;
  return ultimoInicio.getFullYear() === ahora.getFullYear()
    && ultimoInicio.getMonth() === ahora.getMonth()
    && ultimoInicio.getDate() === ahora.getDate();
}

/** "25 min" / "1 h" / "1 h 15" — para las etiquetas del panel. */
export function minutosLegibles(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

/** mm:ss a partir de milisegundos restantes (nunca negativo). */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
