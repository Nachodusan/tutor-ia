/**
 * LAS VOCES DEL TUTOR — catálogo único.
 *
 * Lo comparten la pantalla (para ofrecerlas) y la ruta de audio (para servirlas).
 * Que sea uno solo no es prolijidad: es la LISTA BLANCA. Al servidor nunca le
 * llega un nombre de voz ni un modelo escritos por el navegador, solo un `id` de
 * esta tabla. Sin eso, el `id` iría a parar a un argumento de `say` o a una URL
 * de inferencia, que es exactamente donde no se quiere texto de nadie.
 *
 * Los tiempos son MEDIDOS (2026-08-12, misma frase corta, llamadas en serie).
 * Importa el de punta a punta, no el de cómputo: al chico lo hace esperar la
 * suma, y ahí es donde Kokoro se cae aunque calcule en 114 ms.
 */
export type Motor = "sistema" | "deepinfra";

export interface Voz {
  id: string;
  nombre: string;
  /** Qué esperar al elegirla, en una línea. Se muestra tal cual. */
  detalle: string;
  motor: Motor;
  /** `deepinfra`: modelo de inferencia. */
  modelo?: string;
  /** `deepinfra`: parámetros extra del modelo (voz preseleccionada, etc.). */
  extra?: Record<string, unknown>;
  /** `sistema`: nombre para `say -v`. Vacío = la mejor instalada. */
  vozSistema?: string;
  /** Latencia medida de punta a punta, en segundos. */
  segundos: number;
}

export const VOCES: Voz[] = [
  {
    id: "inworld",
    nombre: "Inworld",
    detalle: "Natural y la más rápida de las buenas. 2,5 s.",
    motor: "deepinfra",
    modelo: "inworld-ai/realtime-tts-2",
    segundos: 2.5,
  },
  {
    id: "mimo",
    nombre: "MiMo",
    detalle: "Natural, un poco más lenta. 5,6 s.",
    motor: "deepinfra",
    modelo: "XiaomiMiMo/MiMo-V2.5-tts",
    segundos: 5.6,
  },
  {
    id: "kokoro-dora",
    nombre: "Kokoro · Dora",
    detalle: "Voz de mujer. Calcula en 114 ms pero DeepInfra la tiene en cola: 27 s reales.",
    motor: "deepinfra",
    modelo: "hexgrad/Kokoro-82M",
    extra: { preset_voice: ["ef_dora"] },
    segundos: 27,
  },
  {
    id: "kokoro-alex",
    nombre: "Kokoro · Alex",
    detalle: "Voz de hombre. Misma cola que Dora: 27 s reales.",
    motor: "deepinfra",
    modelo: "hexgrad/Kokoro-82M",
    extra: { preset_voice: ["em_alex"] },
    segundos: 27,
  },
  {
    id: "sistema",
    nombre: "Del sistema",
    detalle: "Instantánea y sin internet, pero suena a robot. Es la de hasta ahora.",
    motor: "sistema",
    segundos: 0.3,
  },
];

/** La que se usa si nadie eligió: la mejor relación voz/espera de las medidas. */
export const VOZ_POR_DEFECTO = "inworld";

/** Resuelve un id a su voz. Cualquier cosa desconocida cae en la de defecto. */
export function buscarVoz(id?: string | null): Voz {
  return VOCES.find((v) => v.id === id) ?? VOCES.find((v) => v.id === VOZ_POR_DEFECTO)!;
}

/** Dónde guarda el navegador la elección. */
export const CLAVE_VOZ = "tutor.voz";
