/**
 * DÓNDE ESTÁN LOS LIBROS — y por qué no hay un default.
 *
 * Los textos escolares son del Mineduc y no se distribuyen con el repo (ver
 * NOTICE.md), así que viven fuera de git, en una carpeta que cambia según la
 * máquina. Acá había tres rutas absolutas del escritorio de quien escribió los
 * scripts: en cualquier otra máquina eran carpetas que no existen, y el script
 * no avisaba, buscaba ahí y no encontraba nada.
 *
 * Devuelve `never` en el camino de error a propósito: así el tipo de retorno es
 * `string` y no `string | undefined`, y quien la llama no necesita volver a
 * chequear. Con un `if` suelto en cada script, TypeScript pierde el
 * estrechamiento en cuanto la variable se usa dentro de una función.
 *
 * Estructura esperada: <LIBROS_DIR>/{basica,media}/<grado>/<materia>/*.pdf
 */
export function librosDir(desdeArgumento?: string): string {
  const d = desdeArgumento ?? process.env.LIBROS_DIR;
  if (d) return d.replace(/\/+$/, "");
  console.error("");
  console.error("  Falta saber dónde están los libros.");
  console.error("");
  console.error("    LIBROS_DIR=/ruta/a/tus/libros   en .env");
  console.error("");
  console.error("  No hay un valor por omisión: el material no viene con el repo.");
  console.error("  Ver NOTICE.md.");
  process.exit(1);
}
