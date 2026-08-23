/**
 * DISCRIMINADOR DE ANSWERABILITY — ¿el material CONTESTA la pregunta, o solo
 * habla del tema?
 *
 * El cross-encoder del gate mide RELEVANCIA, y eso no es lo mismo. Una ficha
 * catalográfica que nombra "Cien años de soledad" es máximamente relevante a una
 * pregunta sobre esa novela y no responde nada. Medido sobre las 13 preguntas que
 * la cascada respondió con material de fuera del libro del curso, con veredicto
 * humano de si el material GENUINAMENTE contesta:
 *
 *   cubiertas de verdad: 0.99  0.99  0.81  0.80  0.69  0.63
 *   ruido on-topic:      0.89  0.85  0.83  0.75  0.57  0.51
 *
 * Se solapan por completo: NINGÚN umbral de rerankScore las separa. Por eso
 * mover el umbral nunca pudo arreglar `correct_mode` (62,5%).
 *
 * ── Qué usa esto y por qué ──────────────────────────────────────────────────
 * El ganador medido por `answerability-sweep` sobre 91 preguntas: el NLI con la
 * PREGUNTA CONVERTIDA EN AFIRMACIÓN, umbral 0,91 — frena 7 de 8 ruidos y pierde
 * 0 de 6 materiales buenos, contra un juez LLM que frena 7/8 pero pierde 1/6 y
 * cuesta una llamada al modelo. Determinista y de decenas de ms en el sidecar.
 *
 * ⚠️ DÓNDE APLICA, que es la mitad del hallazgo: SOLO en las etapas cross-scope
 * de la cascada (`otro_curso` / `otra_materia`). Medirlo sobre las 91 daba "el
 * NLI destroza el 52% del material bueno" — cierto e IRRELEVANTE: 77 de esas 91
 * son del libro del propio curso y nunca pasarían por este filtro. Aplicarlo al
 * libro del alumno sería romper la promesa del producto para arreglar el
 * problema de al lado.
 *
 * ⚠️ Y el umbral 0,91 se eligió sobre 13 puntos y después se derrumbó al ampliar
 * (sobreajuste: se eligió el corte con los mismos datos con que se medía). Por
 * eso esto va detrás de `RAG_ANSWERABILITY` y lo juzga la corrida de 101, no la
 * intuición. Con el flag apagado el comportamiento es EXACTAMENTE el de antes.
 */
import { nliVerify } from "./nli";

/**
 * Default del umbral de entailment: **0.85, no el 0.91 que ganó el sweep.**
 *
 * El 0.91 del sweep es IN-SAMPLE en el sentido fuerte: se barrió de a 0,01 sobre
 * las mismas 14 preguntas cross-scope del golden que después se usan para
 * puntuarlo (`answerability-sweep.ts` lee el volcado de esa misma corrida). El
 * test set ES el training set.
 *
 * Curva medida de `correct_mode` sobre las 24 con `expect_mode`, con los
 * entailments de RUNTIME:
 *
 *   0,50 → 83,3% · 0,70-0,80 → 87,5% · 0,85-0,90 → 91,7%
 *   0,902-0,9314 → 95,8%  ← el pico
 *   0,932 → 91,7% · 0,95 → 83,3%
 *
 * El pico del 95,8% vive en una rendija de **0,030** entre q120 = 0,9017 (ruido
 * que hay que frenar) y q126 = 0,9314 (material bueno que hay que dejar pasar).
 * Compra UNA pregunta y la paga enhebrando una ventana ajustada a los mismos
 * puntos con los que se mide: es la forma exacta de los tres bugs de instrumento
 * del HANDOFF §7.
 *
 * 0,85 da 91,7% —sigue arriba del objetivo del 90%— con **0,081 de aire** hasta
 * el positivo más bajo en vez de 0,021. Y eso importa porque toda la deriva del
 * uso real empuja el entailment PARA ABAJO (registro coloquial, hipótesis
 * compuesta en multiturno), o sea contra el material bueno: a 0,91 el primer
 * falso bloqueo aparece con 0,022 de deriva; a 0,85, con 0,081.
 *
 * Subir a 0,91 es defendible SOLO cuando exista un set held-out que no haya
 * participado de la calibración. Se hace con `RAG_ANSWERABILITY_MIN`.
 */
export const DEFAULT_ANSWERABILITY_MIN = 0.85;

export function answerabilityEnabled(): boolean {
  const v = process.env.RAG_ANSWERABILITY;
  return v === "1" || v === "true";
}

export function answerabilityMinFromEnv(): number {
  const n = Number(process.env.RAG_ANSWERABILITY_MIN ?? "");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_ANSWERABILITY_MIN;
}

/**
 * La pregunta como HIPÓTESIS declarativa. El NLI espera una afirmación: pasarle
 * "¿qué es la fotosíntesis?" es preguntarle si el fragmento implica una
 * pregunta, que no significa nada. Convertida en "el texto explica qué es la
 * fotosíntesis" sí es evaluable.
 *
 * Idéntica a la de `answerability-sweep.ts` a propósito: si divergen, lo que se
 * midió deja de ser lo que corre.
 */
/**
 * ⚠️ EL DISCRIMINADOR APRUEBA MATERIAL VECINO, Y CUATRO INTENTOS DE ARREGLO
 * FALLARON (medido el 2026-08-23). Leer esto antes de intentar el quinto.
 *
 * El síntoma: a «¿de qué trata Cien años de soledad?» preguntada en Lengua 8º,
 * el NLI le da 0,996 de entailment a un texto sobre mitos que menciona a Tolkien
 * y Narnia. Y no es un caso aislado: sobre las 7 preguntas de la guarda con
 * entailment registrado, q120 FALLA con 0,996 y q122 ACIERTA con 0,998 — el
 * número no separa lo correcto de lo incorrecto, están todos amontonados arriba.
 *
 * Lo que se probó, con fragmentos COMPLETOS y sobre los casos reales:
 *
 *  1. REFORMULAR LA HIPÓTESIS. "Este texto responde la pregunta: X" y "En este
 *     texto está escrita la respuesta a: X" dan separación NEGATIVA (-0,18 y
 *     -0,35) contra el +0,25 de la formulación actual. La que está es la mejor
 *     de las tres.
 *
 *  2. RESTAR UNA HIPÓTESIS DE CONTROL ("El texto explica un tema escolar") para
 *     descontar el sesgo del marco meta. Desenmascara a algunos fragmentos —uno
 *     pasó de 0,885 a un neto de -0,003— pero NO al peor: el de Kamshout da 0,996
 *     contra 0,230 de control, o sea neto 0,765. El NLI está convencido.
 *
 *  3. EXIGIR QUE EL FRAGMENTO NOMBRE LO QUE LA PREGUNTA NOMBRA. La señal
 *     ANTI-CORRELACIONA: q120 (que NO debe responderse) tiene cobertura léxica
 *     1,00 y los positivos q122/q125/q128 tienen 0,67/0,75/0,60. Pasa porque
 *     entre el material de q120 hay un fragmento que sí habla de García Márquez
 *     —de "Noticia de un secuestro"—, así que nombra al autor sin traer la novela.
 *
 *  4. JUEZ LLM ("¿este fragmento RESPONDE la pregunta? SI/NO"). SE IMPLEMENTÓ,
 *     SE MIDIÓ CONTRA EL BANCO Y SE REVIRTIÓ. Parecía la salida —13/15 contra
 *     11/15 del NLI en los casos cross-scope— y ERA UN ARTEFACTO DEL BANCO: le
 *     pasaba 3 fragmentos truncados a 600 caracteres cuando el código le pasa
 *     hasta 6 COMPLETOS (mediana real: 9.818 caracteres, cinco veces más). Con la
 *     entrada verdadera:
 *
 *         NLI solo     11/15
 *         juez solo    11/15
 *         NLI Y juez   12/15
 *
 *     La ventaja se evaporó. La conjunción gana UN caso a cambio de una llamada
 *     al proveedor por turno cruzado, y los tres fallan los mismos duros: b17
 *     (pH), b24 (Napoleón), c09 (realismo mágico).
 *
 *     ⚠️ La lección de método vale más que el resultado: UN BANCO QUE NO
 *     REPRODUCE LA ENTRADA DEL CÓDIGO MIDE OTRA COSA. Por eso la captura ahora
 *     guarda todos los fragmentos sin truncar, y por eso hay que medir solo los
 *     casos cross-scope: con scope=curso este código NI SE INVOCA, y 24 de los
 *     primeros 42 casos del banco eran de esos.
 *
 * EL BANCO YA EXISTE: `golden/answerability-banco.jsonl`, 22 tríos etiquetados
 * LEYENDO el material servido, con una línea de justificación cada uno. Se mide
 * con `pnpm --filter @tutor-ia/eval eval-answerability`.
 *
 * Su veredicto cierra la discusión sobre el umbral (42 casos, 29 evaluables —
 * los otros 13 no tienen material servido y ahí el gate ya abstuvo antes):
 *
 *   acierto con el umbral actual (0,85)          19/29   (65,5%)
 *   entailment cuando SÍ responde          0,953 – 0,999
 *   entailment cuando NO responde          0,010 – 0,999
 *   SEPARACIÓN (mín sí − máx no)                 -0,045
 *
 * ⚠️ El banco chico (22 casos) daba 13/16 = 81%. Al agregarle 20 VECINOS el
 * acierto cayó 16 puntos. O sea que la calidad aparente del discriminador
 * dependía de cuántos casos difíciles tuviera el banco — razón de más para no
 * haber decidido nada con los 6 originales.
 *
 * La separación es NEGATIVA: las dos poblaciones se solapan, así que NINGÚN
 * umbral las separa. Mover `RAG_ANSWERABILITY_MIN` no puede arreglar esto —
 * bajarlo aprueba más ruido y subirlo empieza a rechazar material que sí
 * responde. Está probado, no supuesto.
 *
 * LOS DIEZ FALLOS SON TODOS DEL MISMO TIPO: falsos positivos sobre material
 * VECINO. No hay un solo falso negativo. El discriminador no es estricto de más
 * en ningún caso: es permisivo en todos.
 *
 *   b24  0,999  "¿quién fue Napoleón?"        vs la independencia hispanoamericana
 *   b15  0,997  "¿ecuación de segundo grado?" vs ecuaciones simples de 6º
 *   b37  0,997  "¿velocidad de la luz?"       vs sombras y longitudes de onda
 *   b30  0,993  "¿qué es la fotosíntesis?"    vs "¿cómo son las plantas?"
 *   b36  0,983  "¿qué es la tabla periódica?" vs el índice y el glosario del libro
 *   b40  0,982  "¿qué fue el Modernismo?"     vs la biografía de José Martí
 *   b26  0,978  "¿Revolución Industrial?"     vs la definición de "revolución"
 *   b17  0,964  "¿qué es el pH?"              vs ácidos, bases y neutralización
 *   b06  0,949  "¿cómo se amplió el voto?"    vs un gráfico de participación
 *   b42  0,922  "¿cuento vs novela?"          vs cómo interpretar una lectura
 *
 * El patrón: el NLI aprueba cuando el fragmento MENCIONA lo preguntado o su
 * campo, aunque no lo explique. "José Martí fue escritor" implica, para el
 * modelo, que el texto explica qué fue el Modernismo.
 *
 * El banco es chico (22, de los que 16 miden al discriminador: los otros 6 no
 * tienen material y ahí el gate ya abstuvo antes). Para crecerlo se agregan
 * casos a `banco-answerability.ts` y se etiqueta leyendo — no automatizar esa
 * parte es lo que lo hace servir.
 */
export function comoAfirmacion(pregunta: string): string {
  const limpia = pregunta
    .replace(/^[¿¡\s]+/, "")
    .replace(/[?¿!¡\s]+$/, "")
    .trim();
  return `El texto explica ${limpia.charAt(0).toLowerCase()}${limpia.slice(1)}.`;
}

/**
 * ¿Este material CONTESTA la pregunta? `null` = no se pudo decidir (sidecar
 * caído): el llamador debe seguir como si el filtro no existiera — un
 * discriminador que no puede opinar no debe negarle material a un alumno.
 */
export async function contesta(
  pregunta: string,
  chunkTexts: string[],
  min = answerabilityMinFromEnv(),
): Promise<{ ok: boolean; entailment: number } | null> {
  if (chunkTexts.length === 0 || pregunta.trim() === "") return null;
  try {
    const v = await nliVerify(comoAfirmacion(pregunta), chunkTexts);
    return { ok: v.entailment >= min, entailment: v.entailment };
  } catch {
    return null;
  }
}

/**
 * MATERIAL PARCIAL — el casillero que le faltaba al sistema.
 *
 * El encuadre era binario (hay material citable / no hay) y eso obliga a elegir
 * entre dos respuestas malas cuando el material es DEL TEMA pero no contesta la
 * pregunta. Medido, q035 ("¿resultado de las últimas elecciones presidenciales
 * en Chile?"): el material de Educación Ciudadana habla de PARTICIPACIÓN
 * electoral. Servirlo como `libro` le dice al chico "esto está en tu material"
 * sobre algo que no responde; descartarlo lo manda a `general`, donde el modelo
 * contesta de memoria y desactualizado. Las dos son peores que la tercera:
 * servirlo DICIENDO que cubre una parte.
 *
 * Se decide con las dos señales que ya se calculan, que solas no alcanzan y
 * juntas sí: `rerankScore` dice si el material es DEL TEMA, el entailment dice si
 * CONTESTA.
 *
 *   contesta                          → libro
 *   no contesta pero es del tema      → apoyado   (se sirve, con el límite a la vista)
 *   no contesta y tampoco es del tema → general   (se descarta: es ruido)
 *
 * El corte de relevancia sale de `pnpm --filter @tutor-ia/eval apoyado-sweep`,
 * que vuelca el par de cada etapa cross-scope con el veredicto del golden al
 * lado. NO se elige a ojo: es exactamente así como se llegó al 0,91 in-sample
 * que hubo que bajar después.
 */
/**
 * CALIBRADO con `apoyado-sweep` (2026-08-05) sobre las 17 etapas cross-scope con
 * material de las 101. Lo que NO contesta, con sus dos señales:
 *
 *   q120 Cien años de soledad   rerank 0,894   entail 0,902   → pasa el discriminador (libro)
 *   q035 elecciones en Chile    rerank 0,833   entail 0,808   → APOYADO
 *   q129 Pitágoras              rerank 0,847   entail 0,147   → general
 *   q122 Sancho Panza           rerank 0,570   entail 0,254   → general
 *   q029 huesos del cuerpo      rerank 0,152   entail 0,662   → general
 *
 * La relevancia SOLA no alcanza, y ese fue el hallazgo: q129 puntúa 0,847 —más
 * alto que q035— con un entailment de 0,147. Es el mismo fenómeno que motivó todo
 * el discriminador, un nivel más abajo: el cross-encoder ve "geometría" en un
 * texto sobre el teorema de Euclides y lo considera del tema, pero del teorema de
 * PITÁGORAS no dice nada. Servirlo como material parcial sería exactamente el
 * ruido con cara de respuesta que se estaba tratando de sacar.
 *
 * Por eso `apoyado` pide LAS DOS: relevancia alta (es del tema) Y un piso de
 * entailment (algo tiene que decir al respecto). La banda es
 * `[0,5 , umbral del discriminador)` en entailment y `>= 0,8` en relevancia.
 *
 * ⚠️ Sobre el golden esto afecta UNA pregunta, y es la que lo motivó. No es un
 * número que valga por sí mismo: el golden son 101 preguntas de UNA materia y
 * sus cross-scope son 17 filas. El caso "el libro toca el tema pero no contesta"
 * va a ser mucho más frecuente en producción con 73 materias, y ahí es donde hay
 * que medirlo — con `content_gaps`, que ya lo registra.
 */
export const DEFAULT_APOYADO_MIN_RELEVANCIA = 0.8;
export const DEFAULT_APOYADO_MIN_ENTAIL = 0.5;

export function apoyadoMinRelevanciaFromEnv(): number {
  const n = Number(process.env.RAG_APOYADO_MIN_RELEVANCIA ?? "");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_APOYADO_MIN_RELEVANCIA;
}

export function apoyadoMinEntailFromEnv(): number {
  // ⚠️ La cadena VACÍA se descarta ANTES de convertir. `Number("")` es 0, y como
  // acá 0 es un valor legítimo del rango, sin esta guarda una env var vacía
  // —o simplemente ausente— daba piso 0, o sea NINGÚN piso: q129 entraba como
  // material parcial con 0,147 de entailment. Es la misma trampa que ya está
  // documentada para RERANK_MIN_SCORE en core/config.ts, y se cayó igual.
  const v = process.env.RAG_APOYADO_MIN_ENTAIL;
  if (v == null || v.trim() === "") return DEFAULT_APOYADO_MIN_ENTAIL;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_APOYADO_MIN_ENTAIL;
}

/** ¿El modo `apoyado` por material parcial está activo? Va con el discriminador:
 *  sin él no hay entailment con que decidir. `RAG_APOYADO=0` lo apaga aparte. */
export function apoyadoEnabled(): boolean {
  return answerabilityEnabled() && process.env.RAG_APOYADO !== "0";
}
