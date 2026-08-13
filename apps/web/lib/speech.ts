/**
 * Normalización de texto para TTS.
 *
 * El tutor escribe para la PANTALLA: a veces se le escapa un emoji, un `**` o un
 * guion de lista aunque el prompt se lo prohíba. Acá se convierte ese texto de
 * pantalla en texto HABLADO.
 *
 * Qué es de verdad un problema, medido con `say -v Mónica` sobre la misma frase:
 *   "La célula tiene núcleo."            → 1,23s
 *   "La célula 🔬 tiene núcleo."          → 1,85s   (nombra el emoji)
 *   "La célula 😀🌱✅⚠️ tiene núcleo."      → 5,27s   (+4s: los nombra TODOS)
 *   "La **célula** tiene núcleo."        → 1,23s   (los asteriscos NO se leen)
 * O sea: el emoji es el que arruina la frase. El markdown se saca igual porque
 * las viñetas y los `#` sí se cuelan, y porque el texto queda auditable.
 *
 * Además mete prosodia: `say` sin pausas suena a lector de listas. Los comandos
 * `[[slnc ms]]` son de `say` y separan oraciones y párrafos.
 *
 * ⚠️ SEGURIDAD: `say` interpreta CUALQUIER `[[...]]` del texto como comando
 * (incluso `[ [slnc 2000] ]` con espacios — medido). Por eso se borran TODOS los
 * corchetes del texto del modelo ANTES de insertar los nuestros: en la prosa del
 * tutor no significan nada, y así el modelo no puede inyectar comandos de voz.
 */

/** Pausas en ms. Cortas: separan sin que se sienta lento. */
const PAUSA_ORACION = 260;
const PAUSA_PARRAFO = 520;
const PAUSA_COMA_FUERTE = 180; // dos puntos y punto y coma

/** Emoji y pictogramas. NO se usa \p{Emoji}: eso también matchea dígitos y `#`. */
const EMOJI =
  /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍️⃣]/gu;

/** Abreviaturas y símbolos que `say` deletrea mal o lee como sigla. */
const REEMPLAZOS: [RegExp, string][] = [
  [/\bp\.\s*ej\./gi, "por ejemplo"],
  [/\bej\.:?/gi, "por ejemplo"],
  // El punto de "etc." puede ser TAMBIÉN el punto de la oración: si se lo come,
  // se pierde la pausa y `say` encadena con la frase siguiente.
  [/\betc\.(?=\s+[¿¡"'(\p{Lu}]|\s*$)/gu, "etcétera."],
  [/\betc\./gi, "etcétera"],
  [/\bp[áa]gs?\./gi, "página"],
  [/\bapr[óo]x\./gi, "aproximadamente"],
  [/(\d)\s*%/g, "$1 por ciento"],
  [/(\d)\s*°\s*C\b/g, "$1 grados"],
  [/(\d)\s*km\/h\b/g, "$1 kilómetros por hora"],
  [/\s*[→⇒]\s*/g, ", y entonces "],
  [/\s+&\s+/g, " y "],
  [/\s*[—–]\s*/g, ", "], // raya y semirraya: `say` las lee como pausa nula
];

/**
 * Convierte el texto que se muestra en pantalla en texto para hablar.
 * Devuelve "" si no queda nada que decir (p. ej. un mensaje que era solo un emoji).
 */
/**
 * `prosodia: false` devuelve el texto SIN los `[[slnc …]]`.
 *
 * Esos comandos son de `say` y solo `say` los entiende: cualquier otro motor los
 * lee en voz alta ("corchete corchete slnc doscientos sesenta"). Todo lo demás
 * —markdown, emoji, abreviaturas, la guardia anti-inyección— sirve igual para
 * cualquier voz, así que se comparte.
 */
export function toSpeech(input: string, opts: { prosodia?: boolean } = {}): string {
  let t = (input ?? "").replace(/\r\n?/g, "\n");

  // 1) Markdown que el modelo mete de vez en cuando pese al prompt.
  t = t.replace(/```[\s\S]*?```/g, " ");           // bloques de código
  t = t.replace(/`([^`]*)`/g, "$1");               // código inline
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // links e imágenes → solo el texto
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, "");        // títulos
  t = t.replace(/^\s{0,3}>\s?/gm, "");             // citas
  t = t.replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, ""); // --- *** ___
  t = t.replace(/^\s*[-*+•·]\s+/gm, "");           // viñetas
  t = t.replace(/^\s*\d+[.)]\s+/gm, "");           // listas numeradas
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");        // negrita
  t = t.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1"); // itálica

  // 2) Emoji y pictogramas.
  t = t.replace(EMOJI, " ");

  // 3) Corchetes: guardia anti-inyección de comandos de `say` (ver cabecera).
  t = t.replace(/[[\]]/g, " ");

  // 4) Abreviaturas y símbolos.
  for (const [re, to] of REEMPLAZOS) t = t.replace(re, to);

  // 5) Limpieza de espacios y de la puntuación que quedó huérfana.
  t = t
    .replace(/[ \t]+/g, " ")
    .replace(/ ([.,;:!?…)])/g, "$1")
    .replace(/\( /g, "(")
    .replace(/\(\s*\)/g, "")
    .replace(/^[ \t]*[.,;:]+[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!/[\p{L}\p{N}]/u.test(t)) return "";

  // 6) Prosodia. Se inserta DESPUÉS de limpiar, para que nada de arriba lo toque.
  //    Solo para `say`: los otros motores leerían los comandos en voz alta.
  if (opts.prosodia === false) return t.replace(/\n+/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  t = t
    .replace(/\n{2,}/g, ` [[slnc ${PAUSA_PARRAFO}]] `)
    .replace(/\n/g, ` [[slnc ${PAUSA_ORACION}]] `)
    .replace(/([.!?…])\s+(?=[¿¡"'(\p{Lu}\p{N}])/gu, `$1 [[slnc ${PAUSA_ORACION}]] `)
    .replace(/([:;])\s+/g, `$1 [[slnc ${PAUSA_COMA_FUERTE}]] `)
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return t;
}
