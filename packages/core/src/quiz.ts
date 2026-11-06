/**
 * GENERACIÓN DE PREGUNTAS DE OPCIÓN MÚLTIPLE — la fuente única.
 *
 * Vivía dentro de `apps/web/app/api/test/route.ts`, que estaba bien mientras el
 * único que armaba preguntas era la simulación de prueba. Ahora también las arma
 * el CAMINO (3 por lección), y dos copias de esto divergirían en lo que menos
 * conviene que diverja: la VERIFICACIÓN DE LA CLAVE.
 *
 * ── POR QUÉ LA CLAVE SE VERIFICA A CIEGAS ──────────────────────────────────
 * El modelo declara cuál opción es la correcta, y a veces se corre en uno (el
 * clásico que numera 1-based). Cuando eso pasa, el alumno responde BIEN y el
 * sistema le dice que se equivocó, le anota el tema como débil y se lo muestra
 * al profesor en su panel. Es el peor error posible de este producto: castiga
 * al que estudió.
 *
 * Por eso, después de generar, una SEGUNDA llamada responde la prueba sin ver
 * la clave declarada, y toda pregunta donde las dos no coinciden se DESCARTA.
 * Una pregunta menos es barata; una clave dada vuelta no.
 *
 * Nada de esto sale al cliente: quien llama decide qué persistir y qué mandar,
 * pero `correct` y `explain` no deben viajar nunca al navegador.
 */
import { chatJSON } from "./client";

/** Un tema del que se pide una pregunta. Es el mínimo que necesita el prompt. */
export interface QuizTopic {
  /** Identidad estable de la lección (sobrevive al rebuild de secciones). */
  key: string;
  title: string;
  /** Fragmento del libro que respalda la pregunta. */
  sample: string;
}

/**
 * LOS TRES TIPOS DE PREGUNTA.
 *
 *   multiple — cuatro opciones. Se corrige sola, sin modelo.
 *   vf       — una AFIRMACIÓN que el alumno marca verdadera o falsa Y JUSTIFICA
 *              por escrito. La mitad V/F se corrige sola; la justificación se
 *              lee contra una referencia.
 *   abierta  — el alumno escribe la respuesta y se corrige contra los PUNTOS
 *              CLAVE de una respuesta modelo.
 *
 * La diferencia que importa para el diseño: `multiple` no necesita al modelo
 * para corregirse y las otras dos sí. Por eso `referencia` existe — sin una
 * respuesta modelo contra la cual medir, corregir texto libre sería preguntarle
 * al modelo "¿esto está bien?" a secas, y está MEDIDO (exp2) que esa corrección
 * holística es demasiado severa: marca como incorrectas respuestas correctas.
 */
export type TipoPregunta = "multiple" | "vf" | "abierta";

/** Pregunta ya validada, verificada y con las opciones mezcladas. */
export interface QuizItem {
  n: number;
  /** `key` del tema del que salió: permite enlazar "estudiar esto". */
  topicKey: string;
  topic: string;
  tipo: TipoPregunta;
  question: string;
  /** multiple: las 4 opciones. vf: vacío (la pantalla pone Verdadero/Falso). abierta: vacío. */
  options: string[];
  /** multiple: 0-3. vf: 0 = Verdadero, 1 = Falso. abierta: -1 (no hay clave de opción). */
  correct: number;
  /**
   * LA RESPUESTA MODELO — de acá salen los puntos clave contra los que se corrige
   * lo que el alumno escribe. NUNCA viaja al navegador: es la clave.
   * vf: por qué la afirmación es verdadera o falsa. abierta: la respuesta completa.
   */
  referencia?: string | null;
  explain: string;
}

/**
 * Cómo se reparten los tipos en una prueba.
 *
 * Con menos de tres preguntas no hay reparto que valga: se toma la que se
 * corrige sola. De ahí en adelante, la mitad de opción múltiple y el resto
 * partido entre las dos que se escriben.
 *
 * Por qué la múltiple sigue siendo la mitad: es la que el alumno va a enfrentar
 * en la prueba de validación de estudios, y la única que se corrige sin modelo
 * —o sea, la única que no puede fallar por un juicio equivocado.
 */
export function repartoTipos(total: number): Record<TipoPregunta, number> {
  if (total <= 2) return { multiple: total, vf: 0, abierta: 0 };
  const multiple = Math.max(1, Math.round(total * 0.5));
  const resto = total - multiple;
  const vf = Math.ceil(resto / 2);
  return { multiple, vf, abierta: resto - vf };
}

export interface QuizOptions {
  /** Nombre de la materia, para el prompt. */
  subjectName?: string | null;
  /** Qué evalúa el profesor (de la GDD). Prioriza el foco de las preguntas. */
  evalFocus?: string | null;
  /** Cuántas preguntas por tema. 1 = la prueba de materia; 3 = una lección. */
  porTema?: number;
  /** Techo de tokens de la generación. */
  maxTokens?: number;
  /**
   * Qué tipos entran. Por omisión SOLO opción múltiple, y eso es a propósito:
   * el chequeo de una parada del camino tiene que corregirse en el acto y sin
   * llamar al modelo. La prueba de materia sí pide los tres.
   */
  tipos?: TipoPregunta[];
}

/** El modelo no cumplió con lo pedido y no hay pregunta confiable que servir. */
/**
 * ⚠️ `proveedor` EXISTE PORQUE UN MENSAJE QUE MIENTE CUESTA HORAS.
 *
 * El 2026-08-31 la simulación de prueba falló en las 6 materias de 1º Medio, y
 * la pantalla decía *"No pude armar una prueba confiable con este material.
 * Probá de nuevo"*. Las dos mitades eran falsas: el material estaba perfecto
 * (6/6 temas con muestra usable) y reintentar no podía funcionar nunca, porque
 * la causa real era un **402 de la API: la cuenta sin método de pago**.
 *
 * El error del proveedor se logueaba en el servidor y se tiraba a la basura al
 * envolverlo, así que desde el navegador el fallo era indistinguible de un
 * problema de contenido. Ahora la causa viaja y la pantalla puede decir la
 * verdad. Es la misma disciplina que el 503 del reranker, que distingue
 * "saturado" de "no está corriendo": dos cosas que se arreglan al revés.
 */
export class SinPreguntas extends Error {
  constructor(
    public razon: "generacion" | "vacio" | "proveedor",
    /** El mensaje crudo del proveedor. Para el log y para el panel del dueño;
     *  NUNCA se le muestra al alumno tal cual. */
    public causa?: string,
  ) {
    super(
      razon === "generacion"
        ? "La generación de preguntas falló."
        : razon === "proveedor"
          ? `El proveedor del modelo rechazó la llamada: ${causa ?? "sin detalle"}`
          : "No quedó ninguna pregunta con la clave verificada.",
    );
    this.name = "SinPreguntas";
  }
}

/**
 * ¿El error viene del PROVEEDOR y no de nuestro material?
 *
 * 402 = sin crédito o sin método de pago · 401/403 = clave mala o revocada ·
 * 429 = cuota agotada. Los cuatro tienen en común lo único que importa acá:
 * **reintentar no sirve** y no hay nada que arreglar en el libro ni en el
 * prompt. Se detecta por el código en el texto porque el provider los envuelve
 * en un Error genérico ("api.deepinfra.com 402: …").
 */
export function esFalloDeProveedor(e: unknown): string | null {
  const m = e instanceof Error ? e.message : String(e);
  return /\b(401|402|403|429)\b/.test(m) || /payment|billing|quota|credit|insufficient/i.test(m)
    ? m.slice(0, 200)
    : null;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["tipo", "topicIndex", "topic", "question", "options", "correct", "referencia", "explain"],
        properties: {
          // Con varias preguntas por tema el orden posicional deja de alcanzar:
          // el modelo puede devolver 5 donde se pidieron 6 y a partir de ahí
          // TODAS quedarían atribuidas al tema equivocado — y el alumno vería
          // "estudiá la lección 7" por algo que falló de la 6.
          tipo: { type: "string", enum: ["multiple", "vf", "abierta"] },
          topicIndex: { type: "integer" },
          topic: { type: "string" },
          question: { type: "string" },
          // Nullable y no opcional: el modo estricto no tiene campos opcionales.
          // Va null en las de opción múltiple, que no necesitan respuesta modelo.
          referencia: { type: ["string", "null"] },
          // Sin minItems/maxItems/minimum/maximum: el modo estricto de
          // Structured Outputs no los soporta. No se pierde garantía — abajo se
          // DESCARTA la pregunta si no trae 4 opciones o si `correct` se sale
          // del rango 0-3 (clampear a 0 dejaba pasar una clave corrida).
          options: { type: "array", items: { type: "string" } },
          correct: { type: "integer" },
          explain: { type: "string" },
        },
      },
    },
  },
};

const V_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: { answers: { type: "array", items: { type: "integer" } } },
};

const SISTEMA =
  "Sos un profesor que arma preguntas de opción múltiple para ver cuánto aprendió " +
  "un alumno de secundaria en Chile, a partir de SU material. Para cada pregunta escribí: " +
  "`topicIndex` (el número del tema del que sale, tal como aparece en la lista), un título " +
  "corto del tema (2-4 palabras), UNA pregunta clara y concreta, EXACTAMENTE 4 opciones " +
  "(una correcta y tres incorrectas pero plausibles según el material), el índice 0-3 de la " +
  "correcta, y una explicación de 1 línea de por qué es esa (sirve para el feedback).\n" +
  "REGLAS: la pregunta debe ser sobre el CONTENIDO del material (hechos, conceptos, " +
  "procesos), NUNCA sobre la opinión, experiencia o sensaciones del alumno (prohibido " +
  "'¿qué te resultó difícil?'). Las opciones son solo el texto, SIN letras ni números al " +
  "inicio (nada de 'A)', '1.'). Basate SOLO en el fragmento; no inventes datos que no " +
  "aparezcan. Lenguaje simple para la edad. Español de Chile.\n" +
  // Medido: en Matemática, 7 de 10 y 10 de 10 preguntas salían con LaTeX crudo, y
  // en un caso las CUATRO opciones eran `\sqrt{16 \cdot 4}` — el chico tenía que
  // elegir entre cuatro strings ilegibles. La pantalla pinta texto plano y encima
  // el quiz se CACHEA (`on conflict do nothing`), así que una tanda mala queda
  // congelada para todos. El material no trae LaTeX: lo inventa el modelo.
  "MATEMÁTICA EN TEXTO PLANO, como se escribe a mano: x² - 5x + 6 = 0, √(16 · 4), " +
  "(x - 3)(x + 2) = 0, 1/2, 10²³. PROHIBIDO LaTeX y todo signo $ (nada de \\sqrt, " +
  "\\frac, \\cdot, x^2, $…$) y prohibido markdown (nada de **negrita**, backticks ni " +
  "###): la app muestra el texto TAL CUAL y el alumno lee esos símbolos en la pantalla.\n" +
  "Que las preguntas NO se contesten reconociendo la frase textual del libro: pedí aplicar, " +
  "comparar, ordenar o elegir el caso que corresponde. Si solo se puede preguntar por una " +
  "definición literal, hacelo con las palabras cambiadas.\n\n" +
  "HAY TRES TIPOS DE PREGUNTA y cada una llena campos distintos:\n" +
  "· tipo `multiple`: como siempre. `options` con EXACTAMENTE 4, `correct` de 0 a 3, " +
  "`referencia` en null.\n" +
  "· tipo `vf`: `question` es una AFIRMACIÓN para marcar verdadera o falsa (no una pregunta). " +
  "`options` vacío, `correct` 0 si es verdadera y 1 si es falsa, y `referencia` con POR QUÉ lo " +
  "es, en 25-45 palabras. Que la afirmación NO se resuelva por el tono: nada de 'siempre', " +
  "'nunca' ni 'todos' puestos para delatar la falsa. Alterná verdaderas y falsas.\n" +
  "· tipo `abierta`: el alumno ESCRIBE la respuesta. `options` vacío, `correct` -1, y " +
  "`referencia` con la RESPUESTA MODELO completa, 40-80 palabras, que diga TODOS los puntos " +
  "que una buena respuesta tiene que tocar. Pedí algo que se conteste en 2-4 renglones: " +
  "explicá, compará, justificá. Nada de 'escribí un ensayo'.\n\n" +
  "LA REFERENCIA SE CORRIGE CONTRA EL MATERIAL, así que solo puede contener lo que el " +
  "fragmento dice. Si el material no alcanza para una respuesta modelo completa, hacé esa " +
  "pregunta de opción múltiple.";

/**
 * RECORTA UNA MUESTRA SIN PERDER SUS VENTANAS.
 *
 * ⚠️ Las muestras NO son texto corrido: las arman `muestraRepresentativa` (rag,
 * separador " … ") y `muestraRepartida` (la ruta de la lección, separador salto
 * doble) tomando VARIAS ventanas repartidas a lo largo del tema, justamente para
 * que las preguntas no salgan todas del primer párrafo.
 *
 * Un `slice(0, n)` sobre eso se queda con la primera ventana y tira el resto —
 * que es exactamente el bug que este archivo tenía con el corte fijo de 340. Si
 * se recorta desde el frente, el recorte vuelve a introducirlo con otro número.
 *
 * Así que el presupuesto se REPARTE entre las ventanas: cada una entrega su
 * parte y el tema sigue recorriéndose de punta a punta.
 */
export function recortarMuestra(muestra: string, max: number): string {
  if (muestra.length <= max) return muestra;
  const sep = muestra.includes("\n\n") ? "\n\n" : " … ";
  const partes = muestra.split(sep).filter((p) => p.trim());
  if (partes.length <= 1) return muestra.slice(0, max);
  const porParte = Math.max(80, Math.floor((max - sep.length * (partes.length - 1)) / partes.length));
  return partes.map((p) => p.slice(0, porParte)).join(sep);
}

/** Mezcla las opciones y reubica el índice de la correcta. */
function mezclar(options: string[], correct: number): { options: string[]; correct: number } {
  const idx = options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return { options: idx.map((i) => options[i]!), correct: idx.indexOf(correct) };
}

/**
 * Genera, valida, VERIFICA LA CLAVE A CIEGAS y mezcla. Tira `SinPreguntas` si no
 * queda nada confiable: devolver una lista vacía con 200 hacía que la UI
 * mostrara "no hay preguntas" cuando lo que pasó fue un fallo.
 */
export async function generarPreguntas(
  temas: QuizTopic[],
  opts: QuizOptions = {},
): Promise<QuizItem[]> {
  if (temas.length === 0) throw new SinPreguntas("vacio");
  const porTema = Math.max(1, opts.porTema ?? 1);
  const total = temas.length * porTema;

  // PRESUPUESTO REPARTIDO, no un corte fijo.
  //
  // ⚠️ ACÁ HABÍA UN `slice(0, 340)` Y ERA EL PEOR BUG DEL CAMINO. La ruta de la
  // lección arma la muestra con `muestraRepartida(fragmentos, n, largo)` — cuatro
  // ventanas que RECORREN la lección justamente para que las preguntas no salgan
  // todas del primer párrafo — y este corte se quedaba con la primera y tiraba las
  // otras tres. Las diez preguntas de cada parada se generaban mirando 340
  // caracteres de libro, que en varias lecciones son las instrucciones de una
  // actividad ("Golpeen con fuerza la tapa de la olla"). Los intentos reales
  // (0/10, 1/10) se explican por acá.
  //
  // El corte existía por una razón buena: con muchos temas, mandarlos enteros
  // desborda el contexto. La respuesta correcta no es un número fijo sino un
  // presupuesto que se REPARTE: un tema solo se lleva todo, diez temas se llevan
  // un pedazo cada uno. El piso de 340 garantiza que nunca sea peor que antes.
  const porMuestra = Math.max(340, Math.min(3000, Math.floor(9000 / temas.length)));

  // QUÉ TIPOS Y CUÁNTOS. El reparto lo calcula el CÓDIGO y el prompt lo pide
  // explícito: decir "mezclá tipos" y esperar que salga parejo no funciona —
  // el modelo se va a lo más barato, que es la opción múltiple.
  const tipos = opts.tipos?.length ? opts.tipos : (["multiple"] as TipoPregunta[]);
  const soloMultiple = tipos.length === 1 && tipos[0] === "multiple";
  const reparto = soloMultiple ? null : repartoTipos(total);
  const ETIQUETA: Record<TipoPregunta, string> = {
    multiple: "de opción múltiple", vf: "de verdadero o falso (con su referencia)", abierta: "abiertas",
  };
  const pedido = reparto
    ? (Object.entries(reparto) as [TipoPregunta, number][])
        .filter(([t, n]) => n > 0 && tipos.includes(t))
        .map(([t, n]) => `${n} ${ETIQUETA[t]}`)
        .join(", ")
    : null;

  const toc = temas
    .map((t, i) => `Tema ${i} (${t.title}): ${recortarMuestra(t.sample, porMuestra)}`)
    .join("\n\n");

  let gen: {
    tipo?: string; topicIndex: number; topic: string; question: string;
    options: string[]; correct: number; referencia?: string | null; explain: string;
  }[] = [];
  try {
    const out = await chatJSON<{ items: typeof gen }>(
      [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content:
            `Materia: ${opts.subjectName ?? ""}\n\nTemas (con un fragmento de muestra de cada uno):\n${toc}` +
            (opts.evalFocus
              ? `\n\nQUÉ EVALÚA EL PROFESOR (del libro del docente; priorizá preguntas alineadas a este foco):\n${opts.evalFocus}`
              : "") +
            `\n\nDevolvé JSON { items: [...] } con ${porTema} pregunta(s) por CADA tema (${total} en total). ` +
            `El campo topicIndex va de 0 a ${temas.length - 1}.` +
            (pedido ? `\n\nDE ESAS ${total}: ${pedido}. Repartilas entre los temas, no las amontones en uno.` : ""),
        },
      ],
      SCHEMA,
      // EL PRESUPUESTO DEPENDE DE LOS TIPOS, no solo de la cantidad. Una `vf` y
      // una `abierta` llevan `referencia` —25-80 palabras de respuesta modelo—
      // que una múltiple no tiene. Con la fórmula vieja (500 + 190·n, techo
      // 2400) la salida se cortaba o pasaba los 120 s de la llamada, y la prueba
      // entera se perdía: medido, cuatro tandas seguidas caídas por deadline.
      {
        maxTokens: opts.maxTokens ?? Math.min(
          3800,
          500 + total * 190 + (reparto ? (reparto.vf + reparto.abierta) * 170 : 0),
        ),
      },
    );
    gen = out.items ?? [];
  } catch (e) {
    console.error(`[quiz] generación falló: ${e instanceof Error ? e.message : e}`);
    const delProveedor = esFalloDeProveedor(e);
    if (delProveedor) throw new SinPreguntas("proveedor", delProveedor);
    throw new SinPreguntas("generacion");
  }

  // FORMA: se descarta lo inválido, no se "arregla" en silencio. Cada tipo tiene
  // su propio contrato, y una pregunta que no lo cumple no se puede ni mostrar ni
  // corregir — una `vf` sin referencia no tiene contra qué medir la justificación,
  // y una `abierta` sin respuesta modelo obligaría a corregir preguntándole al
  // modelo "¿esto está bien?", que es justo la corrección severa que se descartó.
  const candidatos = gen
    .map((q) => {
      const t = temas[q.topicIndex];
      if (!t) return null;
      if (!q.question?.trim()) return null;
      const tipo: TipoPregunta =
        q.tipo === "vf" || q.tipo === "abierta" || q.tipo === "multiple" ? q.tipo : "multiple";
      if (!tipos.includes(tipo)) return null;
      if (tipo === "multiple") {
        if (!Array.isArray(q.options) || q.options.length !== 4) return null;
        if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) return null;
      } else if (tipo === "vf") {
        if (!Number.isInteger(q.correct) || (q.correct !== 0 && q.correct !== 1)) return null;
        if (!q.referencia?.trim()) return null;
      } else {
        // Una referencia de una línea no tiene puntos clave que extraer, y sin
        // puntos clave `gradeDecomposed` devuelve 0 y reprueba a cualquiera.
        if ((q.referencia?.trim().length ?? 0) < 40) return null;
      }
      return { q, t, tipo };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (candidatos.length === 0) throw new SinPreguntas("vacio");

  // CLAVE A CIEGAS. Si el verificador se cae (red, 429), las preguntas salen
  // igual: sin verificar es el comportamiento que había antes, y dejar al alumno
  // sin nada por un 429 es peor que una clave sin doble chequeo.
  let verificados = candidatos;
  try {
    // EL MATERIAL VA UNA SOLA VEZ. Antes se repetía dentro de CADA pregunta, así
    // que con `porTema: 10` sobre un tema único el mismo fragmento viajaba diez
    // veces: el presupuesto se lo comía la repetición y por eso el corte tenía
    // que ser tan chico. Con los fragmentos arriba y una referencia por pregunta,
    // el verificador ve el MISMO texto que vio el generador.
    // Solo lo que tiene clave de OPCIÓN se puede verificar así: se le pide al
    // modelo que conteste sin ver la clave y se descarta lo que no coincide. Una
    // `abierta` no tiene opción que elegir, así que no entra — su control de
    // calidad es otro: que la referencia salga del material, que es lo que le
    // exige el prompt.
    const conClave = candidatos.filter((c) => c.tipo !== "abierta");
    if (conClave.length === 0) throw new Error("nada que verificar");
    const usados = [...new Set(conClave.map(({ t }) => temas.indexOf(t)))];
    const material = usados
      .map((i) => `--- Material ${i} (${temas[i]!.title}) ---\n${recortarMuestra(temas[i]!.sample, porMuestra)}`)
      .join("\n\n");
    const enunciado = conClave
      .map(
        ({ q, t, tipo }, k) =>
          `Pregunta ${k + 1} (usá el Material ${temas.indexOf(t)})\n${q.question}\n` +
          (tipo === "vf"
            ? "0: Verdadero\n1: Falso"
            : q.options.map((o, j) => `${j}: ${o}`).join("\n")),
      )
      .join("\n\n");
    const v = await chatJSON<{ answers: number[] }>(
      [
        {
          role: "system",
          content:
            "Respondé esta prueba de opción múltiple usando SOLO el material que se te da. " +
            "Cada pregunta indica de qué Material sale. " +
            "Devolvé JSON { answers: [...] } con el índice 0-3 de la opción correcta de cada pregunta, en orden. " +
            "Si ninguna opción es correcta según el material, devolvé -1 para esa pregunta.",
        },
        { role: "user", content: `${material}\n\n=== PREGUNTAS ===\n\n${enunciado}` },
      ],
      V_SCHEMA,
      { maxTokens: 60 + conClave.length * 8 },
    );
    const respuestas = v.answers ?? [];
    const ok = new Set(conClave.filter(({ q }, k) => respuestas[k] === q.correct));
    verificados = candidatos.filter((c) => c.tipo === "abierta" || ok.has(c));
    if (verificados.length < candidatos.length) {
      console.warn(
        `[quiz] clave no verificada en ${candidatos.length - verificados.length}/${conClave.length} con clave: descartadas`,
      );
    }
  } catch (e) {
    console.warn(`[quiz] verificador no disponible (${e instanceof Error ? e.message : e}); sale sin verificar`);
  }

  if (verificados.length === 0) throw new SinPreguntas("vacio");

  return verificados.map(({ q, t, tipo }, k) => {
    // Mezclar SOLO la opción múltiple. En `vf` el orden es fijo (0 = Verdadero,
    // 1 = Falso) y mezclarlo daría vuelta la clave contra un rótulo que la
    // pantalla escribe por su cuenta.
    const m = tipo === "multiple"
      ? mezclar(q.options.map((o) => String(o)), q.correct)
      : { options: [] as string[], correct: tipo === "vf" ? q.correct : -1 };
    return {
      n: k + 1,
      topicKey: t.key,
      // El título del índice es mejor fallback que "Unidad 1 · Lección 2".
      topic: q.topic?.trim() || t.title,
      tipo,
      question: q.question.trim(),
      options: m.options,
      correct: m.correct,
      referencia: tipo === "multiple" ? null : (q.referencia?.trim() ?? null),
      explain: q.explain?.trim() || "",
    };
  });
}
