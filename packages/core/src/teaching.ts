/**
 * Orquestación de la ENSEÑANZA (Plan v3): retrieval tipado (contenido + pedagogía)
 * → arma el prompt del facilitador → genera. El "qué" (material citable) y el
 * "cómo" (guía didáctica por tipo) van separados al modelo.
 */
import {
  retrieveForTeaching,
  rerankHealthy,
  citationLabel,
  TEACHING_TYPES,
  type TeachingContext,
  type CitableChunk,
  type PedagogyChunk,
} from "@tutor-ia/rag";
import { chatStream, type ChatMsg } from "./client";
import { config } from "./config";
import { limpiarMuletillas, normalizeStudentQuery } from "./query-normalize";
import { TEACHING_SYSTEM, buildTeachingTurn } from "./prompts";
import { validarPreguntaFinal } from "./closing-question";
import type { ChatMessage } from "./types";

export interface TeachRequest {
  userId: string;
  subjectId?: string | null;
  question: string;
  history?: ChatMessage[];
  /** true → el estudiante no entendió; el tutor debe cambiar de estrategia. */
  struggling?: boolean;
  /** Estudio dirigido por el plan: unidad/lección del tema elegido. */
  unit?: number | null;
  lesson?: number | null;
  /** Curso del alumno ("7B", "1M"). Lo lee la ruta DESDE LA BASE, nunca del
   *  cliente: define el nivel de lenguaje con que se le habla a un menor, y eso
   *  no puede depender de lo que mande el navegador. */
  studentGrade?: string | null;
  /** Materias de la MISMA asignatura en todos los cursos (etapa 1 de la
   *  cascada de alcance). Las resuelve la ruta con `subjects.family`. */
  familyIds?: string[] | null;
  /** Primer tema PENDIENTE del plan de la materia. Es lo que se le ofrece al
   *  alumno que no trae tema propio, en vez de dejar que el modelo elija uno. */
  primerTema?: string | null;
}

/** Etiquetas legibles de los tipos de pedagogía para el prompt. */
const TYPE_LABEL: Record<string, string> = {
  proposito: "Propósito / objetivo de aprendizaje",
  ideas_previas: "Activación de ideas previas",
  ambiente_aprendizaje: "Ambiente/actividad de aprendizaje",
  habilidad: "Habilidad a desarrollar",
  errores_frecuentes: "Errores frecuentes del alumno (anticipalos)",
  evaluacion: "Qué se evalúa en la prueba (foco de evaluación)",
  // "Respuesta esperada" hacía que el modelo lo leyera como un anexo de
  // respuestas —algo que mirar, no algo que usar— y el prompt encima le decía
  // que la guía "no es contenido para afirmar". Con ese par, el solucionario
  // llegaba a la ventana y no servía para nada: en una corrida el tutor tenía
  // seis fragmentos del solucionario delante y contestó que el ejercicio no
  // estaba en el material. Lo que el chico necesita de acá no es la respuesta:
  // es el PROCEDIMIENTO con el que su libro la obtiene.
  solucionario: "Ejercicio resuelto del libro (el MÉTODO que se usa acá — imitalo)",
};

/** Formatea el material citable (el "qué") como fragmentos numerados. */
export function formatMaterial(citable: CitableChunk[]): string {
  return citable
    .map((c, i) => {
      const page = c.pageStart != null ? `pág. ${c.pageStart}` : "";
      const src = c.source === "pedagogy" ? " · guía" : "";
      return `[Fragmento ${i + 1} — ${page}${src}]\n${c.content}`;
    })
    .join("\n\n");
}

/** Formatea la guía didáctica (el "cómo") agrupada por tipo, en orden de flujo.
 *  El rótulo `[Sección · Unidad X Lección Y]` del chunk se CONSERVA: es la única
 *  ancla que le dice al modelo de qué lección viene cada bloque — sin ella, una
 *  "idea previa" de otra unidad se lee igual que una de la lección correcta. */
export function formatGuide(pedagogy: Record<string, PedagogyChunk[]>): string {
  const parts: string[] = [];
  for (const t of TEACHING_TYPES) {
    const chunks = pedagogy[t] ?? [];
    if (chunks.length === 0) continue;
    const body = chunks.map((c) => c.content.trim()).join("\n");
    parts.push(`### ${TYPE_LABEL[t] ?? t}\n${body}`);
  }
  return parts.join("\n\n");
}

export interface TeachingResult {
  ctx: TeachingContext;
  /** false → ni el TE ni la GDD cubren el tema: abstención. */
  grounded: boolean;
  rerankerDown?: boolean;
  /** La consulta de búsqueda fue reescrita por el puente de vocabulario. */
  qNorm?: boolean;
  qNormMs?: number;
}

/**
 * Query de retrieval que ARRASTRA EL TEMA de la conversación. Un follow-up como
 * "no entendí" no tiene palabras de contenido; sin el tema previo el retrieval
 * falla y el tutor se abstiene de más. Prepende los últimos turnos del ESTUDIANTE
 * (donde vive el tema) a la pregunta actual.
 */
function retrievalQuery(req: TeachRequest): {
  query: string; vague: boolean; prevUser: string; temaCharla: string;
} {
  // ⚠️ Los últimos DOS turnos CON TEMA, no los últimos dos a secas.
  //
  // Medido en el eval multiturno (charla x004, 4 turnos sobre el narrador): el
  // turno 4 se quedó SIN MATERIAL —topScore 0.901 → 0.051, sello `general` a
  // mitad de una conversación que venía bien— porque los dos turnos previos del
  // alumno eran "dame un ejemplo concreto" y "no entendí, explicámelo más
  // fácil". La ventana de dos se había llenado de muletillas y el tema
  // ("narrador") ya había salido de ella, así que la consulta de búsqueda no
  // tenía ni una palabra de contenido.
  //
  // Es un chico pidiendo ayuda dos veces seguidas, que es exactamente cuando más
  // la necesita. Filtrar los pedidos vagos hace que la ventana conserve el
  // último turno que SÍ traía tema, sin importar cuántas veces haya pedido
  // ayuda desde entonces.
  const conTema = (req.history ?? [])
    .filter((m) => m.role === "user")
    .filter((m) => !sinTema(m.content));
  // EL TEMA PUEDE HABERLO PUESTO EL TUTOR.
  //
  // Si el alumno nunca dijo un tema, la ventana queda vacía… y eso pasa
  // justamente cuando el tutor ACABA DE PROPONER UNO y el chico aceptó. Visto en
  // pantalla: "¡Hola! ¿Arrancamos por «Relaciones filogenéticas y coevolución»?"
  // → "Perfecto, si quieren empezar con eso." → la consulta era "Hola Hola
  // Perfecto, si quieren empezar con eso", sin una sola palabra de contenido, no
  // había material, y el tutor volvía a preguntar de qué tema quería hablar.
  // Después de que el chico ya le dijo que sí.
  const ventana = conTema.slice(-2).map((m) => m.content).join(" ");
  /**
   * EL TEMA DE LA CHARLA, venga de donde venga: de lo que el alumno dijo antes
   * o de lo que el tutor propuso. Siempre disponible, aunque el turno de ahora
   * SÍ parezca traer tema — es la red de seguridad de `getTeachingContext`
   * cuando la búsqueda con las palabras del alumno no encuentra nada.
   */
  const temaCharla = ventana || temaPropuesto(req.history ?? []);
  // La propuesta del tutor se usa SOLO si el turno de ahora tampoco trae tema.
  // Si el chico ignora lo que le ofrecieron y pregunta otra cosa ("¿qué es la
  // célula?"), meter el tema propuesto le ensucia SU pregunta con un tema que
  // decidió no estudiar.
  const actualSinTema = sinTema(req.question);
  const prevUser = ventana || (actualSinTema ? temaPropuesto(req.history ?? []) : "");
  // Un pedido vago ("dame otro ejemplo", "no entendí") NO aporta tema y diluye el
  // retrieval; si ya hay tema en la charla, dejá que ése mande.
  const vague = Boolean(prevUser) && actualSinTema;
  // A la BÚSQUEDA va la pregunta sin muletillas de arranque; al modelo y a los
  // regex (social/vago/trabado) va la original, donde el registro es señal.
  const q = vague ? "" : limpiarMuletillas(req.question);
  return { query: `${prevUser} ${q}`.trim(), vague, prevUser, temaCharla };
}

/**
 * Turnos que NO aportan tema: pedidos vagos, saludos, agradecimientos y
 * aceptaciones. Antes solo se filtraban los vagos, así que un "Hola Hola" se
 * quedaba en la ventana y se usaba como consulta de búsqueda.
 */
function sinTema(texto: string): boolean {
  const t = texto.trim();
  return VAGUE_RE.test(t) || GREETING_RE.test(t) || GRACIAS_RE.test(t) ||
    AFIRMACION_RE.test(t) || ACEPTA_RE.test(t);
}

/**
 * El tema que propuso el tutor en su último turno. Prefiere lo que está ENTRE
 * COMILLAS —así se ofrece el tema del plan— y si no, el arranque del mensaje.
 */
function temaPropuesto(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== "assistant") continue;
    const entrecomillado = m.content.match(/[“"«]([^”"»]{4,80})[”"»]/);
    if (entrecomillado) return entrecomillado[1]!.trim();
    return m.content.replace(/\s+/g, " ").trim().slice(0, 160);
  }
  return "";
}

/**
 * Recupera el contexto de enseñanza (contenido + pedagogía) con gate.
 *
 * PUENTE DE VOCABULARIO (política CRUDA-PRIMERO, medida 2026-08-02): primero se
 * busca con la formulación del alumno tal cual; SOLO si el gate corta, se
 * reescribe la pregunta a registro de libro (LLM local chico) y se reintenta.
 * Por qué en este orden y no al revés:
 *  - el golden queda intacto por construcción (cruda-primero = 81,6% idéntico;
 *    normalizar siempre lo bajaba 1,9 pts reordenando el top-5),
 *  - las regresiones del normalizador ("singlar"→"singular") no pueden morder:
 *    si la cruda ya pasó, la reescritura ni se usa,
 *  - la latencia extra solo se paga en el camino de abstención (~20% de turnos).
 * Medido en el set de alumno: 17→9 abstenciones, recall@5 47,3%→62,4%.
 */
export async function getTeachingContext(req: TeachRequest): Promise<TeachingResult> {
  const { query, vague, prevUser, temaCharla } = retrievalQuery(req);
  try {
    const opts = {
      userId: req.userId,
      subjectId: req.subjectId,
      minRerankScore: config.rerankMinScore,
      unit: req.unit ?? null,
      lesson: req.lesson ?? null,
      familyIds: req.familyIds ?? null,
      studentGrade: req.studentGrade ?? null,
      // Turno sin tema propio ("no entendí") o alumno trabado: el discriminador
      // de answerability se apaga. La consulta es el turno previo pegado al
      // actual y su entailment se hunde por la FORMA de la frase, no por el
      // material — ver `vagueTurn` en TeachingOptions.
      vagueTurn: vague || Boolean(req.struggling),
    };
    const ctx = await retrieveForTeaching(query, opts);
    if (ctx.grounded) return { ctx, grounded: true, qNorm: false, qNormMs: 0 };

    // ⚠️ ACÁ HUBO UN "RESCATE CON EL TEMA DE LA CHARLA" Y SE SACÓ, MEDIDO.
    //
    // La idea era: si la búsqueda con las palabras del alumno no encuentra
    // nada y la conversación tiene un tema, buscar ese tema. Cubría cualquier
    // forma de decir que sí sin perseguirlas con expresiones regulares.
    //
    // Lo que hace de verdad es pegarle material VIEJO a una pregunta NUEVA.
    // Medido: charla sobre relaciones filogenéticas, el chico pregunta "¿qué es
    // una metáfora?" —que el libro de Biología no cubre—, la búsqueda propia
    // falla como corresponde… y el rescate devolvía la pág. 48, "¿Cómo
    // clasificar a los seres vivos?", con el sello `libro`. Una pregunta sobre
    // metáforas respaldada por una página de taxonomía.
    //
    // Es la misma falla que ya se corrigió una vez desde el otro lado (contestar
    // Biología con el libro de Lengua), y el sello equivocado es peor que no
    // encontrar nada: `general` es honesto, `libro` mintiendo no.
    //
    // Lo que SÍ resuelve el caso que motivó todo esto —"Vale, si me interesa"
    // después de una propuesta— es reconocer la aceptación (ACEPTA_RE, que
    // decide si el turno aporta tema) más la regla del prompt. Sin adivinar.

    if (vague || !config.queryNormalize) {
      return { ctx, grounded: ctx.grounded, qNorm: false, qNormMs: 0 };
    }
    // El gate cortó con la cruda: reintento con la pregunta normalizada.
    const n = await normalizeStudentQuery(req.question);
    if (!n.changed) {
      return { ctx, grounded: ctx.grounded, qNorm: false, qNormMs: n.ms };
    }
    const ctx2 = await retrieveForTeaching(`${prevUser} ${n.query}`.trim(), opts);
    return ctx2.grounded
      ? { ctx: ctx2, grounded: true, qNorm: true, qNormMs: n.ms }
      : { ctx, grounded: false, qNorm: false, qNormMs: n.ms };
  } catch (err) {
    if (!(await rerankHealthy())) {
      return { ctx: null as unknown as TeachingContext, grounded: false, rerankerDown: true };
    }
    throw err;
  }
}

/**
 * El estudiante señala que NO entendió → el tutor cambia de estrategia en vez de
 * repetir (activa el bloque de adaptatividad en `buildTeachingTurn`).
 *
 * Vive acá, no en la route, para que el golden set pueda ejercer EXACTAMENTE el
 * mismo prompt que producción. Mientras estuvo duplicado en la route, el eval
 * nunca activaba esta rama —la que el propio prompt declara "lo más importante"—
 * y medía un turno que el alumno no recibe.
 */
export const STRUGGLE_RE =
  /no (lo |la )?entend|sin entender|no s[ée]\b|m[áa]s f[áa]cil|otra vez|otra forma|de nuevo|no me qued[óo] claro|no capt|no entiendo|no (lo |la )?(pillo|cacho)|otro ejemplo|repet[íi]|explic[áa].*(otra|de nuevo)/i;

/** ¿El alumno está trabado? Único criterio, compartido por la route y el eval. */
export function isStruggling(question: string): boolean {
  return STRUGGLE_RE.test(question);
}

export function teachingAbstention(): string {
  return "Mmm, eso puntual no lo encuentro en tu material y no quiero tirarte un dato inventado. ¿Lo reformulás, o querés que veamos otro tema? También podés armar un plan de estudio o hacer una simulación de prueba.";
}

// Mensajes SOCIALES (saludo, agradecimiento, despedida, afirmación). No son
// preguntas sobre el material → NO deben pasar por el gate de abstención; el
// tutor responde conversacionalmente. Anclados a FIN de mensaje para no tragarse
// preguntas reales ("hola, explicame la célula" → sí va a enseñanza).
/**
 * Un saludo puede venir REPETIDO o encadenado: "hola hola", "hola buenas",
 * "hola, ¿cómo estás?". Anclado a un solo token, "Hola Hola" NO era un saludo:
 * se iba al flujo de enseñanza, no había material de qué agarrarse y el modelo
 * TERMINABA INVENTANDO UN TEMA — en Biología contestó con una pregunta sobre
 * conjugar verbos en pasado. Un saludo mal reconocido no es un detalle: es la
 * primera pantalla de la conversación.
 */
const SALUDO =
  "(?:hola+|buenas|buen[oa]s?\\s*(?:d[ií]as|tardes|noches)?|buen\\s*d[ií]a|hey|hi|hello|qu[ée]\\s*tal|c[óo]mo\\s*(?:est[áa]s|and[áa]s|va|te\\s*va)|saludos|holis)";
const GREETING_RE = new RegExp(
  `^\\s*${SALUDO}(?:[\\s,.!¡¿?]+${SALUDO})*[\\s,.!¡¿?]*$`,
  "i",
);
const BYE_RE = /^\s*(chau+|chao|adi[óo]s|nos\s*vemos|hasta\s*(luego|pronto|ma[ñn]ana)|bye|me\s*voy)[\s,.!]*$/i;

/**
 * Respuesta conversacional a un mensaje SOCIAL, o null si es una consulta real
 * (que debe ir al flujo de enseñanza). Mantiene el tono de facilitador e invita
 * a un tema.
 */
/**
 * AFIRMACIONES que también son RESPUESTA. "dale", "listo", "entendí", "ok" son
 * cierre social si llegan solos, pero si el tutor acaba de preguntar "¿se
 * entiende?" son la respuesta del alumno al chequeo de comprensión.
 *
 * Interceptarlas siempre mataba la rama adaptativa del prompt —la que
 * TEACHING_SYSTEM declara "lo más importante"—: el chico contestaba "dale" y en
 * vez de avanzar al siguiente aspecto del tema recibía una frase fija que ni
 * siquiera pasaba por el modelo. Por eso solo cuentan como sociales cuando NO
 * hay conversación en curso.
 */
const AFIRMACION_RE =
  /^\s*(genial|perfecto|buen[íi]simo|excelente|ok|okey|okay|dale|listo|entend[íi]|clar[íi]?simo|de\s*acuerdo)[\s,.!]*$/i;
const GRACIAS_RE = /^\s*(much[ao]s?\s*)?gracias[\s,.!]*$/i;

/**
 * ACEPTAR LO QUE EL TUTOR PROPUSO: "dale", "perfecto, empecemos con eso", "sí,
 * vamos con eso". No es un tema —no tiene una sola palabra de contenido— pero
 * tampoco es un mensaje social: es un SÍ, y lo que sigue tiene que ser la clase
 * del tema propuesto, no otra pregunta.
 */
const ACEPTA_RE = new RegExp(
  "^\\s*(?:(?:s[íi]|ok(?:ey|ay)?|dale|vale|bueno|listo|perfecto|genial|buen[íi]simo|excelente|clar[oi]|de\\s*acuerdo|obvio|por\\s*supuesto)[\\s,.!]*)*" +
    "(?:(?:s[íi]|si)\\s+)?(?:(?:quer[ée]s|quieren|quieres|podemos|pod[ée]s|puedes)\\s+)?" +
    "(?:empez(?:ar|amos|á)|empec(?:emos|é)|arranc(?:ar|amos|á)|arranqu(?:emos|é)|comenz(?:ar|amos|á)|" +
    "comenc(?:emos|é)|seguimos|sigamos|vamos|veamos|hagamos|dale|me\\s+interesa|quiero)\\b" +
    // La cola SOLO puede señalar hacia atrás. Con un comodín acá, "empecemos con
    // la fotosíntesis" —que sí trae tema— quedaba marcado como aceptación y su
    // tema no llegaba a la búsqueda.
    "(?:\\s*(?:con|por|desde)?\\s*(?:eso|esto|ese|esa|aquello|ah[íi]|entonces|ya|nom[áa]s|" +
    "de\\s+una|primero|el\\s+primero|ese\\s+tema|ese\\s+punto))*[\\s,.!¡¿?]*$",
  "i",
);

/**
 * LAS FRASES FIJAS SON SOLO PARA LA PUERTA DE ENTRADA.
 *
 * Antes un "gracias" o un "hola" devolvían SIEMPRE el mismo texto, aunque
 * llegaran en medio de una charla: el chico terminaba de entender algo, decía
 * "gracias" y recibía un "¡Buenísimo! ¿Seguimos con otro tema de Biología?"
 * idéntico al de la vez anterior y al de la próxima. Eso no es conversar, es un
 * menú de teléfono — y era una de las cosas que hacían sentir al tutor rígido.
 *
 * Con conversación en curso, estos mensajes van al modelo, que ve de qué venían
 * hablando y cierra como cerraría una persona. Cuesta un turno de generación; es
 * exactamente lo que se estaba ahorrando de más.
 *
 * La despedida SÍ queda fija siempre: un "chau" no gana nada pasando por el
 * modelo, y responderlo al instante es mejor que hacerlo esperar para irse.
 */
/**
 * LA PROPUESTA CONCRETA. Un alumno que abre el chat y saluda no tiene por qué
 * saber qué pedir: preguntarle "¿qué tema querés?" le devuelve el problema.
 * Si su plan tiene un primer tema pendiente, se lo ofrecemos por su nombre.
 */
function proponer(primerTema?: string | null, tema = ""): string {
  return primerTema
    ? `¿Arrancamos por “${primerTema}”? Es lo primero que tenés pendiente en tu plan. Si preferís otra cosa, decime.`
    : `¿Qué tema${tema} querés que te explique?`;
}

export function socialReply(
  question: string,
  subjectName?: string,
  hasContext = false,
  /** Primer tema pendiente del plan de la materia, si lo hay. */
  primerTema?: string | null,
): string | null {
  const q = question.trim();
  if (!q) return null;
  const tema = subjectName ? ` de ${subjectName}` : "";
  if (BYE_RE.test(q)) return "¡Chau! Volvé cuando quieras seguir estudiando.";
  if (hasContext) return null;
  if (GREETING_RE.test(q)) return `¡Hola! Soy tu tutor${tema}. ${proponer(primerTema, tema)}`;
  if (GRACIAS_RE.test(q) || AFIRMACION_RE.test(q)) {
    return primerTema
      ? `¡Buenísimo! ${proponer(primerTema)}`
      : `¡Buenísimo! ¿Seguimos con otro tema${tema}, o querés que profundice en algo?`;
  }
  return null;
}

// Pedido VAGO sin tema: "dame un ejemplo", "¿por qué es importante?", "explicá
// mejor", "más", "no entendí"… Si llega como PRIMER mensaje (sin un tema en la
// charla), el retrieval no tiene de qué agarrarse y el tutor se abstenía. En vez
// de eso, pedimos amablemente el tema (nunca el cartel de abstención).
//
// Un alumno real ENCADENA y DECORA: "sigo sin entender, dame otro ejemplo porfa"
// (medido en eval-multiturn c003: anclado a UNA frase pelada no matcheaba, la
// frase entera iba al retrieval, lo diluía y el gate abstenía con el tema previo
// a mano). Por eso esto no es una alternancia de frases sueltas sino una
// SECUENCIA de cláusulas vagas + muletillas de cortesía, anclada de punta a
// punta: si cualquier pedazo trae tema ("dame otro ejemplo de fracciones"), el
// ancla final falla y el mensaje NO es vago.
/**
 * PEDIDOS SOBRE LA FORMA. No traen tema y diluyen la búsqueda igual que un "no
 * entendí": medido, "explicámelo en dos frases nomás, corto" después de "¿qué es
 * una célula?" hacía que la consulta fuera la pregunta MÁS esa muletilla, el
 * material de la propia materia no pasaba el gate y el turno se quedaba sin
 * libro — habiendo tenido material excelente un turno antes.
 *
 * Van como grupo propio porque aparecen de dos formas: solos ("más corto") y
 * pegados al verbo ("explicámelo en dos frases").
 */
const FORMA =
  "(?:en\\s+(?:una|dos|tres|pocas)\\s+(?:frases?|l[íi]neas?|palabras)|m[áa]s\\s+cort[oa]|cort[oa]|m[áa]s\\s+breve|breve(?:mente)?|resum[íi](?:d[oa]|melo)?|en\\s+resumen|m[áa]s\\s+despacio|sin\\s+ejemplos?|nom[áa]s)";

const VAGUE_CLAUSE = [
  "¿?\\s*(?:por|para)\\s*qu[ée]\\s+(?:es\\s+)?importante(?:\\s+esto)?\\??",
  "(?:dame|da|quiero|pon[ée]me|tir[áa]me)\\s+(?:un|otro)?\\s*ejemplos?(?:\\s+concretos?)?",
  "otro\\s+ejemplo",
  "m[áa]s\\s+ejemplos?",
  // "explicá mejor" · "explicámelo de otra forma" · "me lo explicas más fácil"
  // · "explicámelo en dos frases"
  `(?:me\\s+l[oa]\\s+)?explic[áa]s?(?:me(?:l[oa])?)?\\s+(?:mejor|m[áa]s\\s+f[áa]cil|de\\s+nuevo|otra\\s+vez|eso|m[áa]s|(?:de\\s+)?otra\\s+forma|${FORMA})`,
  "(?:sigo|seguimos)\\s+sin\\s+entender(?:l[oa])?",
  "no\\s+entend[íi](?:\\s+nada)?",
  "no\\s+(?:lo\\s+|la\\s+)?(?:entiendo|pillo|cacho|capto)(?:\\s+nada)?",
  "no\\s+s[ée]",
  // "repetí" · "repetímelo" · "me lo repetís"
  "(?:me\\s+l[oa]\\s+)?repet[íi]s?(?:me(?:l[oa])?)?",
  "otra\\s+vez",
  "de\\s+nuevo",
  "m[áa]s\\s+f[áa]cil",
  "m[áa]s",
  "ampli[áa](?:me)?",
  "profundiz[áa]",
  FORMA,
].join("|");
/** Muletillas de cortesía: decoran el pedido sin aportar tema. */
const MULETILLA = "(?:por\\s*favor|porfa+|porfis|porfi|plis)";
const VAGUE_RE = new RegExp(
  `^\\s*[¡¿]*\\s*(?:${MULETILLA}[\\s,]+)*(?:${VAGUE_CLAUSE})(?:[\\s,;.!¡¿?]+(?:(?:${VAGUE_CLAUSE})|${MULETILLA}))*[\\s,;.!¡¿?]*$`,
  "i",
);

/** Si es un pedido vago SIN tema previo, devuelve un empujón conversacional para
 *  que el alumno elija tema; null si hay contexto o la pregunta trae tema. */
export function needsTopicReply(
  question: string,
  hasContext: boolean,
  subjectName?: string,
  primerTema?: string | null,
): string | null {
  if (hasContext) return null;
  const q = question.trim();
  if (q.length > 90 || !VAGUE_RE.test(q)) return null;
  const tema = subjectName ? ` de ${subjectName}` : "";
  return primerTema
    ? `¡Dale! ${proponer(primerTema)}`
    : `¡Dale! ¿Sobre qué tema${tema} querés que te ayude? Decime uno —o tocá un tema de tu plan— y te lo explico con un ejemplo.`;
}

/** Cita legible del primer fragmento citable (para la UI). */
export function teachingCitations(ctx: TeachingContext) {
  return ctx.citable.map((c, i) => ({
    index: i + 1,
    chunkId: c.chunkId,
    page: c.pageStart,
    source: c.source,
    oa: c.oa,
    grade: c.grade,
    label: citationLabel({
      pageStart: c.pageStart, pageEnd: c.pageEnd, headingPath: c.headingPath,
      documentTitle: c.documentTitle, grade: c.grade,
    } as never),
  }));
}

/**
 * Las mismas citas, pero CON EL TEXTO del chunk adentro — para PERSISTIR, no
 * para mandarle al cliente.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 * `citations.chunkId` es un uuid, y cada re-ingesta recrea los chunks con uuid
 * nuevo. Las citas viejas quedan apuntando al vacío: medido, 6 de 200 vínculos
 * ya están rotos, y son justo los de las únicas 2 respuestas de fuera de 1º
 * Medio. Un chunk_id roto significa "esta respuesta citó algo y ya no puedo
 * mostrarte qué era".
 *
 * Con el texto adentro, la cita queda auditable para siempre sin depender de que
 * la fila exista. Es la misma clase de problema que mató a `a3-set.jsonl` (0 de
 * 18 chunk_id vivos) y que en el golden se resolvió anclando por contenido.
 *
 * Va SEPARADO de `teachingCitations` a propósito: el texto pesa ~1,6 KB por
 * chunk y son ~6 por respuesta, así que mandárselo al navegador serían ~10 KB
 * por turno que el alumno no usa (él ve la etiqueta legible). La base sí lo
 * necesita, porque es la que después hay que poder auditar.
 */
export function teachingCitationsConTexto(ctx: TeachingContext) {
  return ctx.citable.map((c, i) => ({
    index: i + 1,
    chunkId: c.chunkId,
    page: c.pageStart,
    source: c.source,
    oa: c.oa,
    grade: c.grade,
    label: citationLabel({
      pageStart: c.pageStart, pageEnd: c.pageEnd, headingPath: c.headingPath,
      documentTitle: c.documentTitle, grade: c.grade,
    } as never),
    /** El material citado, tal como se lo pasó al modelo. Es lo que blinda la
     *  trazabilidad contra la próxima re-ingesta. */
    text: c.content,
  }));
}

/**
 * Genera la respuesta del tutor facilitador en streaming.
 *
 * Se llama SIEMPRE, haya material o no. Antes el llamador tenía que chequear
 * `grounded` y devolver una frase fija sin llegar al modelo; eso era la app
 * diciéndole que no a un chico sentado a estudiar. Ahora, cuando no hay
 * material, el turno lleva un bloque que le pide enseñar igual con conocimiento
 * general y reconocerlo en una frase — y la UI lo marca.
 *
 * Las únicas negativas que quedan son de INFRAESTRUCTURA (reranker caído, error
 * de retrieval), y las maneja la ruta: responder con conocimiento general
 * mientras el motor está roto convertiría el producto en un chatbot genérico
 * sin que nadie se entere.
 */
export async function* streamTeaching(
  req: TeachRequest,
  ctx: TeachingContext,
): AsyncGenerator<string> {
  const material = formatMaterial(ctx.citable);
  const guide = formatGuide(ctx.pedagogy);
  const history: ChatMsg[] = (req.history ?? []).map((m) => ({ role: m.role, content: m.content }));
  const messages: ChatMsg[] = [
    { role: "system", content: TEACHING_SYSTEM },
    ...history,
    {
      role: "user",
      content: buildTeachingTurn({
        question: req.question,
        material,
        guide,
        struggling: req.struggling,
        sinMaterial: ctx.citable.length === 0,
        // El material es del tema pero no contesta: se sirve con el límite a la
        // vista (sello `apoyado`) en vez de descartarse.
        parcial: ctx.parcial === true,
        studentGrade: req.studentGrade ?? null,
        primerTema: req.primerTema ?? null,
        // De qué cursos salió el material que va en el prompt. Si no es el del
        // alumno, el modelo tiene que saberlo para poder decirlo.
        sourceGrades: [...new Set(ctx.citable.map((c) => c.grade).filter(Boolean))] as string[],
        scope: ctx.scope,
      }),
    },
  ];
  yield* chatStream(messages);
}

/** Resultado de un turno con la pregunta de cierre validada. */
export interface ClosingCheck {
  /** El juez llegó a opinar (false = apagado, sin pregunta final, o juez caído). */
  checked: boolean;
  /** La pregunta original se responde copiando y se cambió por otra. */
  replaced: boolean;
}

/**
 * `streamTeaching` + validación de la PREGUNTA DE CIERRE.
 *
 * Emite el cuerpo token a token como siempre y RETIENE la última oración; al
 * cerrar el stream la valida y emite la original o su reemplazo. El alumno no ve
 * dos preguntas ni una corrección a mitad de lectura: solo espera lo que tarda
 * juzgar una oración (~1 llamada corta), y únicamente cuando el turno cierra
 * con pregunta.
 *
 * `onCheck` reporta el veredicto para el log de decisiones — sin él no habría
 * forma de saber cuánto dispara en producción.
 */
export async function* streamTeachingChecked(
  req: TeachRequest,
  ctx: TeachingContext,
  onCheck?: (c: ClosingCheck) => void,
): AsyncGenerator<string> {
  if (!config.closingQuestionCheck) {
    yield* streamTeaching(req, ctx);
    return;
  }
  // Buffer de cola: se emite todo menos lo que podría ser la última oración.
  // 260 chars cubre con holgura una pregunta de cierre (las medidas rondan 60-120)
  // sin retener explicación.
  const COLA = 260;
  let full = "";
  let emitido = 0;
  for await (const chunk of streamTeaching(req, ctx)) {
    full += chunk;
    const hasta = full.length - COLA;
    if (hasta > emitido) {
      yield full.slice(emitido, hasta);
      emitido = hasta;
    }
  }
  const { replaced, checked, nueva, inicio } = await validarPreguntaFinal(full);
  onCheck?.({ checked, replaced });
  // El empalme se hace SOBRE `full` y con el índice donde empezaba la pregunta
  // vieja — nunca reconstruyendo desde el texto validado.
  //
  // Antes se cortaba con `body.length`, que es el largo del cuerpo YA RECORTADO
  // (`trim()`), no una posición dentro de `full`. Con un solo espacio de más al
  // principio de la respuesta, ese largo caía unos caracteres antes del corte
  // real y el alumno veía una frase partida al medio colgando arriba de la
  // pregunta nueva: "Si estuvieras descansando después de correr," y nada más.
  // Salió en la primera corrida que miré de cerca.
  if (!replaced || nueva == null || inicio == null || inicio < emitido) {
    // Nada que cambiar (o la pregunta ya salió a pantalla y cambiarla sería
    // peor): sale la cola tal cual.
    if (full.length > emitido) yield full.slice(emitido);
    return;
  }
  if (inicio > emitido) yield full.slice(emitido, inicio).trimEnd();
  yield `\n\n${nueva}`;
}
