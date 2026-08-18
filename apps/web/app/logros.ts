/**
 * LOS LOGROS DEL ALUMNO.
 *
 * ⚠️ TODOS SALEN DE DATOS QUE YA EXISTEN (`/api/progress` + el perfil). Ninguno
 * es de mentira y ninguno espera una tabla nueva: si mañana hiciera falta una
 * racha de días, habría que EMPEZAR a guardar los días, y hasta que eso exista
 * el logro no va. Un trofeo que se desbloquea solo, o que nunca se desbloquea
 * porque nadie mide lo que promete, enseña que los trofeos no significan nada.
 *
 * Los que faltan se muestran igual, apagados y con la condición escrita: el que
 * no se ve no motiva a nadie, y el chico tiene derecho a saber qué le falta.
 *
 * Módulo plano y PURO (sin React, sin fetch): así la regla de cada logro se
 * puede leer —y probar— sin montar la pantalla.
 */
import type { Subject, SubjectStats } from "./tipos";

export interface Logro {
  id: string;
  /** Id del ícono en `iconos-logros.tsx`. Antes era un icono: se veía distinto en
   *  cada sistema, y un logro pendiente solo se podía apagar con `grayscale` +
   *  opacidad, que ensucia el dibujo en vez de atenuarlo. */
  icono: string;
  nombre: string;
  /** Qué hay que hacer. Se muestra siempre, ganado o no. */
  detalle: string;
  logrado: boolean;
}

export interface DatosLogros {
  subjects: Subject[];
  stats: Record<string, SubjectStats>;
  /** Del perfil: cuándo arrancó su último bloque de estudio. */
  pomodoroLastAt?: string | null;
}

export function calcularLogros({ subjects, stats, pomodoroLastAt }: DatosLogros): Logro[] {
  const propias = subjects.filter((s) => !s.disabled);
  const st = (s: Subject) => stats[s.id];

  const lecciones = propias.reduce((n, s) => n + (st(s)?.planDone ?? 0), 0);
  const pruebas = propias.filter((s) => st(s)?.lastScore).length;
  const perfecta = propias.some((s) => {
    const sc = st(s)?.lastScore;
    return !!sc && sc.total > 0 && sc.score === sc.total;
  });
  const pct = (s: Subject) => {
    const d = st(s);
    return d && d.planTotal > 0 ? d.planDone / d.planTotal : 0;
  };
  const debiles = propias.reduce((n, s) => n + (st(s)?.weak.length ?? 0), 0);

  const L = (id: string, icono: string, nombre: string, detalle: string, logrado: boolean): Logro =>
    ({ id, icono, nombre, detalle, logrado });

  return [
    L("primer-paso", "plant", "Primer paso", "Terminá tu primera lección", lecciones >= 1),
    L("diez", "books", "Diez lecciones", "Terminá 10 lecciones en total", lecciones >= 10),
    L("mitad", "mountains", "A mitad de camino", "Llegá al 50% de una materia", propias.some((s) => pct(s) >= 0.5)),
    L("cima", "trophy", "Materia completa", "Terminá el camino entero de una materia", propias.some((s) => pct(s) >= 1)),
    L("primera-prueba", "exam", "Primera prueba", "Rendí una prueba", pruebas >= 1),
    L("perfecta", "target", "Prueba perfecta", "Sacá todas buenas en una prueba", perfecta),
    // Pide una prueba rendida a propósito: sin eso, "no tengo nada para
    // reforzar" es cierto para todos los que nunca rindieron, y sería un trofeo
    // por no hacer nada.
    L("al-dia", "check-fat", "Sin pendientes", "Reforzá todo lo que fallaste en las pruebas", pruebas >= 1 && debiles === 0),
    L("bloque", "timer", "Primer bloque", "Estudiá un bloque completo con el reloj", !!pomodoroLastAt),
  ];
}
