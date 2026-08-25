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

/** Pregunta ya validada, verificada y con las opciones mezcladas. */
export interface QuizItem {
  n: number;
  /** `key` del tema del que salió: permite enlazar "estudiar esto". */
  topicKey: string;
  topic: string;
  question: string;
  options: string[];
  correct: number;
  explain: string;
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
}

/** El modelo no cumplió con lo pedido y no hay pregunta confiable que servir. */
export class SinPreguntas extends Error {
  constructor(public razon: "generacion" | "vacio") {
    super(
      razon === "generacion"
        ? "La generación de preguntas falló."
        : "No quedó ninguna pregunta con la clave verificada.",
    );
    this.name = "SinPreguntas";
  }
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["topicIndex", "topic", "question", "options", "correct", "explain"],
        properties: {
          // Con varias preguntas por tema el orden posicional deja de alcanzar:
          // el modelo puede devolver 5 donde se pidieron 6 y a partir de ahí
          // TODAS quedarían atribuidas al tema equivocado — y el alumno vería
          // "estudiá la lección 7" por algo que falló de la 6.
          topicIndex: { type: "integer" },
          topic: { type: "string" },
          question: { type: "string" },
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
  "definición literal, hacelo con las palabras cambiadas.";

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

  const toc = temas
    .map((t, i) => `Tema ${i} (${t.title}): ${t.sample.slice(0, porMuestra)}`)
    .join("\n\n");

  let gen: {
    topicIndex: number; topic: string; question: string;
    options: string[]; correct: number; explain: string;
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
            `El campo topicIndex va de 0 a ${temas.length - 1}.`,
        },
      ],
      SCHEMA,
      { maxTokens: opts.maxTokens ?? Math.min(2400, 500 + total * 190) },
    );
    gen = out.items ?? [];
  } catch (e) {
    console.error(`[quiz] generación falló: ${e instanceof Error ? e.message : e}`);
    throw new SinPreguntas("generacion");
  }

  // FORMA: se descarta lo inválido, no se "arregla" en silencio.
  const candidatos = gen
    .map((q) => {
      const t = temas[q.topicIndex];
      if (!t) return null;
      if (!q.question?.trim() || !Array.isArray(q.options) || q.options.length !== 4) return null;
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) return null;
      return { q, t };
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
    const usados = [...new Set(candidatos.map(({ t }) => temas.indexOf(t)))];
    const material = usados
      .map((i) => `--- Material ${i} (${temas[i]!.title}) ---\n${temas[i]!.sample.slice(0, porMuestra)}`)
      .join("\n\n");
    const enunciado = candidatos
      .map(
        ({ q, t }, k) =>
          `Pregunta ${k + 1} (usá el Material ${temas.indexOf(t)})\n${q.question}\n` +
          q.options.map((o, j) => `${j}: ${o}`).join("\n"),
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
      { maxTokens: 60 + candidatos.length * 8 },
    );
    const respuestas = v.answers ?? [];
    verificados = candidatos.filter(({ q }, k) => respuestas[k] === q.correct);
    if (verificados.length < candidatos.length) {
      console.warn(
        `[quiz] clave no verificada en ${candidatos.length - verificados.length}/${candidatos.length}: descartadas`,
      );
    }
  } catch (e) {
    console.warn(`[quiz] verificador no disponible (${e instanceof Error ? e.message : e}); sale sin verificar`);
  }

  if (verificados.length === 0) throw new SinPreguntas("vacio");

  return verificados.map(({ q, t }, k) => {
    const m = mezclar(q.options.map((o) => String(o)), q.correct);
    return {
      n: k + 1,
      topicKey: t.key,
      // El título del índice es mejor fallback que "Unidad 1 · Lección 2".
      topic: q.topic?.trim() || t.title,
      question: q.question.trim(),
      options: m.options,
      correct: m.correct,
      explain: q.explain?.trim() || "",
    };
  });
}
