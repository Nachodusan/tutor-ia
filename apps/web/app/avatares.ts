/**
 * LOS AVATARES — catálogo único, y la lista blanca.
 *
 * Es lo único que un alumno puede cambiar de su cuenta, y es a propósito: las
 * cuentas son anónimas (son menores), así que no hay nombre, no hay foto y no
 * hay nada que diga quién es. Pero una cuenta que no se puede tocar en nada
 * tampoco se siente propia. Un bicho elegido a mano alcanza para eso.
 *
 * Lo comparten la pantalla (para ofrecerlos) y el perfil (para guardarlo). Que
 * sea uno solo es lo mismo que en `voces.ts`: al servidor le llega un ID de esta
 * tabla, no un emoji escrito por el navegador. Sin eso, cualquiera podría dejar
 * cualquier cosa pintada en su fila del panel del docente.
 *
 * Sin caras humanas ni banderas: nada que se parezca a decir quién sos ni de
 * dónde. Bichos, cosas y planetas.
 */
export interface Avatar {
  id: string;
  emoji: string;
  /** Se usa como `aria-label` y en el `title`: un emoji sin nombre no se lee. */
  nombre: string;
  /** Fondo de la chapita. Del sistema Bloques, para que no desentonen. */
  color: string;
}

export const AVATARES: Avatar[] = [
  { id: "zorro",    emoji: "🦊", nombre: "Zorro",    color: "#FF9E7B" },
  { id: "pulpo",    emoji: "🐙", nombre: "Pulpo",    color: "#F5389B" },
  { id: "rana",     emoji: "🐸", nombre: "Rana",     color: "#10A37F" },
  { id: "buho",     emoji: "🦉", nombre: "Búho",     color: "#FFC63D" },
  { id: "ballena",  emoji: "🐳", nombre: "Ballena",  color: "#2B44FF" },
  { id: "dragon",   emoji: "🐲", nombre: "Dragón",   color: "#7A3CF0" },
  { id: "gato",     emoji: "🐱", nombre: "Gato",     color: "#FFC63D" },
  { id: "cactus",   emoji: "🌵", nombre: "Cactus",   color: "#1F9D57" },
  { id: "cohete",   emoji: "🚀", nombre: "Cohete",   color: "#FF5C3A" },
  { id: "planeta",  emoji: "🪐", nombre: "Planeta",  color: "#6C5CE7" },
  { id: "volcan",   emoji: "🌋", nombre: "Volcán",   color: "#D42419" },
  { id: "rayo",     emoji: "⚡️", nombre: "Rayo",     color: "#FFC63D" },
  { id: "libro",    emoji: "📚", nombre: "Libros",   color: "#FF9E7B" },
  { id: "lupa",     emoji: "🔍", nombre: "Lupa",     color: "#2B44FF" },
  { id: "estrella", emoji: "⭐️", nombre: "Estrella", color: "#FFC63D" },
  { id: "trebol",   emoji: "🍀", nombre: "Trébol",   color: "#10A37F" },
];

/** `null` = todavía no eligió: se dibuja el orbe de Aurora, que es la marca. */
export function buscarAvatar(id?: string | null): Avatar | null {
  return AVATARES.find((a) => a.id === id) ?? null;
}

/** ¿Es un id del catálogo? Lo usa la ruta que guarda: lo que no está, no entra. */
export const avatarValido = (id: unknown): id is string =>
  typeof id === "string" && AVATARES.some((a) => a.id === id);
