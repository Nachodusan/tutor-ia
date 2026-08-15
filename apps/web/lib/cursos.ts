/**
 * QUÉ CURSOS ESTÁN ABIERTOS — política de producto, en un solo lugar.
 *
 * De 1º a 5º básico el tutor está CERRADO. No es un problema de material (los
 * libros de esos cursos están ingestados y se buscan igual: un chico de 8º que
 * necesita repasar fracciones puede recibir la explicación del libro de 5º).
 * Es que la herramienta —escribirle a una IA, leer su respuesta, evaluarla— pide
 * una autonomía de lectura y de juicio que a los 6-10 años no se puede dar por
 * supuesta. Se abre cuando lo revise alguien que sepa de desarrollo infantil,
 * no cuando el código esté listo.
 *
 * Este módulo es DELIBERADAMENTE plano: sin "use client", sin imports. Lo leen
 * las pantallas del alumno (para dibujar el candado) y las rutas de API (para
 * que el candado no sea solo un dibujo). Si la lista viviera en el cliente, un
 * `fetch` a mano la saltaría; si viviera solo en el server, el alumno se
 * enteraría del bloqueo recién al chocarse con un 403.
 *
 * PARA ABRIR UN CURSO: sacarlo de esta lista y nada más. Los alumnos que ya
 * tengan ese grado en su perfil vuelven a entrar solos.
 */
export const CURSOS_BLOQUEADOS: readonly string[] = ["1B", "2B", "3B", "4B", "5B"];

/** ¿Este curso está cerrado por ahora? `null` (sin curso elegido) no lo está. */
export function cursoBloqueado(grade: string | null | undefined): boolean {
  return !!grade && CURSOS_BLOQUEADOS.includes(grade);
}

/**
 * EL PORQUÉ, en una frase y en un solo lugar: aparece bajo el candado del
 * onboarding, en el panel de quien ya tenía ese curso y en el cuerpo del 403.
 * Que las tres digan lo mismo es lo que evita que un chico piense que se rompió
 * algo o que es culpa suya.
 *
 * Sin encabezado adentro ("tu curso no está abierto") porque cada pantalla pone
 * el suyo, con el nombre del curso cuando lo tiene.
 */
export const MOTIVO_CURSO_BLOQUEADO =
  "Estamos viendo con especialistas cómo acompañar bien a los más chicos antes de abrirlo.";

/** El mismo motivo, con encabezado, para cuando contesta una ruta de API. */
export const MENSAJE_CURSO_BLOQUEADO = `Tu curso todavía no está abierto. ${MOTIVO_CURSO_BLOQUEADO}`;
