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

/**
 * TODAS EN ESPAÑOL, Y ESO HAY QUE PEDIRLO.
 *
 * La primera versión usaba el modelo con sus parámetros por defecto, y el
 * defecto de Inworld es la voz «Ashley» — una locutora en INGLÉS leyendo
 * español. Sonaba con acento gringo, y no era del modelo: era de no haber
 * elegido. El modelo trae más de cien voces y un parámetro de idioma.
 *
 * `language: "ES_ES"` es una PISTA de en qué idioma está el texto; el acento lo
 * pone la voz. Por eso las cuatro son latinas.
 */
const INWORLD = "inworld-ai/realtime-tts-2";
const voz = (id: string, nombre: string, detalle: string, segundos: number): Voz => ({
  id, nombre, detalle, segundos,
  motor: "deepinfra",
  modelo: INWORLD,
  extra: { voice: nombre.split(" ")[0], language: "ES_ES" },
});

export const VOCES: Voz[] = [
  voz("diego", "Diego", "Hombre. 3,0 s.", 3.0),
  voz("miguel", "Miguel", "Hombre. 2,7 s.", 2.7),
  voz("lupita", "Lupita", "Mujer. 3,1 s.", 3.1),
  voz("elena", "Elena", "Mujer, la más rápida. 2,5 s.", 2.5),
  {
    id: "sistema",
    nombre: "Del sistema",
    detalle: "Instantánea y sin internet, pero suena a robot. Es a la que se cae si falla la de arriba.",
    motor: "sistema",
    segundos: 0.3,
  },
];

/**
 * Elección arbitraria entre las cuatro: no hay dato que prefiera una. Se cambia
 * desde el panel y queda guardada por aparato.
 */
export const VOZ_POR_DEFECTO = "diego";

/** Resuelve un id a su voz. Cualquier cosa desconocida cae en la de defecto. */
export function buscarVoz(id?: string | null): Voz {
  return VOCES.find((v) => v.id === id) ?? VOCES.find((v) => v.id === VOZ_POR_DEFECTO)!;
}

/** Dónde guarda el navegador la elección. */
export const CLAVE_VOZ = "tutor.voz";
