/**
 * Hash de contraseñas con `scrypt` de la biblioteca estándar de Node.
 *
 * Por qué scrypt y no bcrypt/argon2: `apps/web` depende hoy de 3 paquetes
 * externos y todo tiene que funcionar sin internet en la máquina del colegio.
 * argon2 y bcrypt traen binario nativo (node-gyp, prebuilds por plataforma).
 * scrypt es memory-hard, está en `node:crypto` y no agrega nada.
 *
 * Vive en `core` y no en `apps/web` porque lo usan DOS consumidores: la ruta de
 * login y el CLI que crea las cuentas. Dos implementaciones podrían divergir en
 * los parámetros y producir hashes que no se verifican entre sí.
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * N=2^16 pide 128·N·r = 64 MiB y tarda ~150 ms en un Apple M4: invisible para el
 * alumno (una vez cada dos semanas) y caro para quien robe el dump.
 *
 * OJO con `maxmem`: su default es 32 MB y `scrypt` TIRA EXCEPCIÓN
 * (ERR_CRYPTO_INVALID_SCRYPT_PARAMS) con N≥2^15 si no se sube. Es el primer
 * error que aparece si alguien toca estos números sin mirar acá.
 */
const N = Number(process.env.SCRYPT_N ?? 65536);
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 160 * 1024 * 1024;

/**
 * Formato autodescriptivo, estilo PHC:
 *   scrypt$N=65536,r=8,p=1$<salt_base64url>$<hash_base64url>
 * Guardar los parámetros DENTRO del hash permite subir el costo mañana sin
 * invalidar las contraseñas viejas: `verify` usa los del propio string. El
 * prefijo `scrypt$` deja lugar a `argon2id$` sin migración destructiva.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Verifica en tiempo constante. Devuelve false ante cualquier formato raro. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const [algo, params, saltB64, hashB64] = stored.split("$");
    if (algo !== "scrypt" || !params || !saltB64 || !hashB64) return false;
    const p = Object.fromEntries(
      params.split(",").map((kv) => {
        const [k, v] = kv.split("=");
        return [k, Number(v)];
      }),
    ) as { N: number; r: number; p: number };
    if (!p.N || !p.r || !p.p) return false;
    const salt = Buffer.from(saltB64, "base64url");
    const esperado = Buffer.from(hashB64, "base64url");
    const key = await scrypt(plain.normalize("NFKC"), salt, esperado.length, {
      N: p.N, r: p.r, p: p.p, maxmem: MAXMEM,
    });
    // timingSafeEqual TIRA si las longitudes difieren: hay que chequear antes.
    return key.length === esperado.length && timingSafeEqual(key, esperado);
  } catch {
    return false;
  }
}

/**
 * Hash de un valor imposible, para gastar el mismo tiempo cuando el usuario NO
 * existe. Sin esto, el login responde más rápido ante un username inexistente y
 * eso delata qué cuentas existen.
 */
export const DUMMY_HASH =
  "scrypt$N=65536,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Contraseña legible para repartir en PAPEL. Cuatro palabras de una lista corta
 * de sustantivos concretos, sin tildes ni pares confundibles.
 *
 * Por qué no `Xk3$mQ9p`: un chico de 12 años tiene que transcribirla de un papel
 * a un teléfono. "tigre-nube-verde-plaza" se copia sin errores; la otra no. Son
 * ~36 bits de entropía, seguros SOLO con límite de intentos en el login — es un
 * compromiso de usabilidad explícito para el piloto, no un descuido.
 */
const PALABRAS = (
  "tigre lobo zorro gato perro pato pez rana mono oso ciervo burro caballo vaca oveja gallo " +
  "nube lluvia viento sol luna estrella mar rio lago monte valle bosque campo playa isla " +
  "verde azul rojo negro blanco gris dorado plata violeta naranja " +
  "casa plaza puente torre puerta reloj libro lapiz mesa silla barco tren globo " +
  "pan queso miel uva pera manzana limon melon trigo maiz papa tomate"
).split(" ");

export function generarPassword(palabras = 4): string {
  // randomInt del CSPRNG, NUNCA Math.random.
  return Array.from({ length: palabras }, () => PALABRAS[randomInt(PALABRAS.length)]!).join("-");
}
