/**
 * LOG DE DECISIÓN — una línea por turno, para poder atribuir cada abstención a
 * su causa. Antes de esto era imposible: el único logger del sistema (`logCall`)
 * solo emite cuando SE LLAMA al modelo, y una abstención es justamente el caso
 * en que NO se llama. Una abstención se manifestaba como la AUSENCIA de una
 * línea de log: nada que contar, y ningún denominador contra el cual dividir.
 *
 * NO REGISTRA CONTENIDO. Igual que `logging.ts`: es material escolar de menores.
 * Solo salen causas, scores, umbrales y conteos. Nunca la pregunta, el material
 * ni la respuesta. Lo único derivado del texto es un booleano (`selfAbstain`) y
 * la longitud en caracteres.
 *
 * Se apaga con DECISION_LOG=0.
 */

/** Por qué terminó así el turno. Mutuamente excluyentes: una causa por turno. */
export type DecisionCause =
  /** Corto el regex social (saludo/gracias/chau) antes del retrieval. */
  | "social"
  /** Corto needsTopicReply: pedido vago sin tema previo. */
  | "vague"
  /** El gate del reranker no encontró material citable (ni TE ni GDD). */
  | "gate"
  /** El sidecar del reranker no responde: abstención degradada. */
  | "reranker_down"
  /** Falló el retrieval (DB/embeddings/rerank con /health vivo). */
  | "retrieval_error"
  /** Se llamó al modelo y respondió. */
  | "answered"
  /** Se llamó al modelo y falló/cortó a mitad. */
  | "model_error"
  /** El LLM que titula el plan falló y se cayó a títulos genéricos. */
  | "plan_llm_failed"
  /** No hay estructura curricular (unit/lesson) para armar plan o prueba. */
  | "no_structure";

export interface Decision {
  /** "eval" = golden set. Ejerce el MISMO camino que "chat" (mismas funciones). */
  route: "chat" | "plan" | "test" | "eval";
  /** true si el alumno terminó sin explicación real del tutor. */
  abstained: boolean;
  cause: DecisionCause;
  /** Score del reranker del mejor candidato (el que se compara contra el umbral). */
  topScore?: number | null;
  threshold?: number | null;
  /** "content" (texto del estudiante) | "pedagogy" (GDD, fallback) | "none". */
  citableSource?: string | null;
  nCitable?: number | null;
  nPedagogy?: number | null;
  /** true si el turno vino por estudio dirigido (unit/lesson) y salteó el gate. */
  directed?: boolean;
  /** El dirigido entregó material POR DEBAJO del umbral (último recurso visible). */
  gateBypassed?: boolean;
  /** Filas que devolvió cada brazo del retrieval híbrido (contenido). */
  nDense?: number | null;
  nLexical?: number | null;
  /** El brazo léxico devolvió 0 filas: el RRF degeneró a denso puro.
   *  `grep -c "lexEmpty=true"` sobre una corrida responde "¿el léxico está muerto?". */
  lexEmpty?: boolean;
  /** Candidatos únicos que vio el reranker y pool configurado. */
  nCand?: number | null;
  pool?: number | null;
  /** Estrategia de ordenamiento activa ("ce", "rrf_then_ce:10", …). */
  ranker?: string | null;
  /** Rango del chunk ganador en el brazo denso ("venía del puesto N"). */
  winnerDenseRank?: number | null;
  /** La consulta de búsqueda fue reescrita por el puente de vocabulario. */
  qNorm?: boolean;
  qNormMs?: number | null;
  /** Por qué vía pasó el gate híbrido: "abs" | "margin" | "none". */
  gateVia?: string | null;
  /** Entailment del discriminador de answerability en la etapa cross-scope que
   *  lo ejerció (null = no corrió). Sin esto, un bloqueo no deja rastro del
   *  número con que se decidió y no se puede auditar en producción. */
  answEntail?: number | null;
  /** El material era del tema pero no contestaba: se sirvió como `apoyado`
   *  (material parcial) en vez de descartarse. */
  parcial?: boolean;
  /** Margen del top-1 sobre la mediana del pool (logits). */
  gapMed?: number | null;
  /**
   * El modelo SE ABSTUVO SOLO pese a tener material. Es la señal que separa
   * "el gate cortó" de "el prompt ahorcó al modelo": sin esto no se puede saber
   * si la culpa es del umbral o de las instrucciones.
   */
  selfAbstain?: boolean;
  /** El validador de la pregunta de cierre llegó a opinar (closing-question.ts). */
  cierreChecked?: boolean;
  /** La pregunta de cierre venía auto-contestada y se reemplazó. Es la tasa que
   *  dice si el problema del 40% sigue vivo con el prompt actual. */
  cierreReplaced?: boolean;
  /** Deriva sistemática detectada por el NLI (verify.ts). */
  drift?: boolean;
  /** El sidecar de NLI no pudo verificar. */
  nliUnavailable?: boolean;
  /** Oraciones que el NLI llegó a chequear. */
  nliChecked?: number | null;
  /**
   * Cuánto de la respuesta salió del libro: "libro" | "apoyado" | "general".
   *
   * Se registra ANTES de que cambie el comportamiento, a propósito: da la línea
   * base de cómo se vería el sello en el tráfico real de hoy. Sin esta medición
   * previa, cuando el sello aparezca no habría forma de saber si "la mitad de
   * las respuestas quedan en apoyado" es un efecto del cambio o algo que ya
   * pasaba y nadie veía.
   */
  mode?: string | null;
  /** El turno pisó un conocimiento esencial LOCAL (la respuesta depende de
   *  Chile). Con itemLocal se contesta DESPUÉS: cuántos turnos cayeron en modo
   *  general sobre contenido local y sobre qué conocimiento — ese número decide
   *  qué material del Mineduc o la BCN ir a buscar, con demanda real en vez de
   *  adivinando. */
  temaLocal?: boolean;
  itemLocal?: string | null;
  /** Fracción de oraciones respaldadas por el material (0-1). */
  supportedFrac?: number | null;
  /**
   * Hasta dónde hubo que ir a buscar: "curso" | "otro_curso" | "otra_materia".
   * Es la métrica de la cascada de alcance: dice qué fracción de las respuestas
   * necesitó salir del curso del alumno, que es lo único que justifica el costo
   * de las etapas extra.
   */
  scope?: string | null;
  /** Chunks que trajo el ranking, ANTES del gate. Con `nCitable` al lado, separa
   *  "el retrieval no encontró nada" de "encontró pero el gate lo cortó". */
  nRetrieved?: number | null;
  chars?: number | null;
  ms?: number | null;
}

/**
 * Detector de AUTO-ABSTENCIÓN: ¿el texto que devolvió el modelo es, en realidad,
 * un "no puedo responder"? El prompt le pide abstenerse en lenguaje libre
 * (prompts.ts: "Si el material no cubre el tema, usá la frase de abstención"),
 * pero NUNCA se le da la frase, así que improvisa una distinta cada vez y no hay
 * cadena fija que matchear.
 *
 * Deliberadamente CONSERVADOR y anclado al ARRANQUE del texto (primeros 240
 * caracteres): una explicación legítima puede decir "el material no da un número
 * exacto" en el medio, y eso NO es una abstención. Solo cuenta si el turno
 * ARRANCA negando. Es una señal de telemetría: no cambia el comportamiento.
 */
const SELF_ABSTAIN_RE =
  /\b(no\s+(?:lo\s+)?(?:encuentro|encontr[ée]|veo|aparece|figura|est[áa]|tengo)\b[^.!?]{0,60}\b(?:material|apunte|libro|texto|informaci[óo]n|contenido|fragmento)|(?:tu|el)\s+material\s+no\s+(?:cubre|incluye|trae|menciona|habla|dice|tiene)|no\s+puedo\s+(?:responder|contestar|ayudarte\s+con\s+eso)|no\s+quiero\s+(?:inventar|tirarte)|eso\s+no\s+lo\s+veo\s+en\s+tu\s+material)/i;

/**
 * "…pero te lo explico igual". DECIR que algo no está en el libro y ENSEÑARLO
 * igual es lo contrario de abstenerse: es el modo general funcionando como debe.
 *
 * Sin esto, la señal se envenenó sola: desde que el prompt pide reconocer el
 * hueco con naturalidad, TODA respuesta sin material arranca con una negación y
 * quedaba contada como auto-abstención — justo la métrica que sirve para
 * distinguir "el umbral está mal" de "el prompt es demasiado miedoso".
 */
const RESPONDE_IGUAL_RE =
  /\b(te\s+(?:l[oa]\s+)?(?:explico|cuento|respondo|digo|aclaro)\s+(?:igual|lo\s+mismo|de\s+todos\s+modos)|igual\s+te\s+(?:l[oa]\s+)?(?:explico|cuento|respondo)|con\s+lo\s+que\s+s[ée]|por\s+lo\s+que\s+(?:yo\s+)?s[ée])\b/i;

/** Lo que dice una abstención DE VERDAD después del "pero": te devuelve la
 *  pelota en vez de enseñar. */
const INVITA_RE =
  /\b(reformul|otro\s+tema|otra\s+pregunta|sub[íi]s?\b|subir|plan\s+de\s+estudio|simulaci[óo]n\s+de\s+prueba)/i;

/**
 * ¿El turno es una NEGATIVA, o un "no está en tu libro… PERO igual te enseño"?
 *
 * La diferencia no está en la negación —las dos arrancan igual— sino en lo que
 * viene después. Medido sobre las respuestas reales del subconjunto: las tres
 * marcadas como abstención decían "no tengo el material específico… pero te
 * puedo explicar la lógica general", "…pero por lo general se enseña que…",
 * "…pero en la historia clásica…", y seguían con la clase entera. Contarlas como
 * negativas invierte el signo de la única métrica que distingue "el umbral está
 * mal calibrado" de "el prompt es demasiado miedoso".
 */
export function looksLikeSelfAbstention(text: string): boolean {
  const inicio = text.slice(0, 240);
  if (!SELF_ABSTAIN_RE.test(inicio)) return false;
  if (RESPONDE_IGUAL_RE.test(inicio)) return false;
  const pero = text.search(/\b(pero|aunque|igual(?:mente)?|de\s+todos\s+modos)\b/i);
  const sigueEnsenando =
    pero >= 0 && pero < 240 &&
    text.length - pero > 120 &&
    !INVITA_RE.test(text.slice(pero, pero + 240));
  return !sigueEnsenando;
}

function on(): boolean {
  return process.env.DECISION_LOG !== "0";
}

const fmt = (v: unknown): string =>
  v == null ? "-" : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v);

/**
 * Emite la línea. Formato pensado para `grep | sort | uniq -c` sin parsers:
 *
 *   [decision] route=chat outcome=abstain cause=gate topScore=0.161 threshold=0.18
 *              citableSource=none nCitable=0 nPeda=7 directed=false selfAbstain=- ms=412
 */
export function logDecision(d: Decision): void {
  if (!on()) return;
  const parts = [
    `route=${d.route}`,
    `outcome=${d.abstained ? "abstain" : "answer"}`,
    `cause=${d.cause}`,
    `topScore=${fmt(d.topScore)}`,
    `threshold=${fmt(d.threshold)}`,
    `citableSource=${fmt(d.citableSource)}`,
    `nCitable=${fmt(d.nCitable)}`,
    `nPeda=${fmt(d.nPedagogy)}`,
    `directed=${fmt(d.directed)}`,
    `gateBypassed=${fmt(d.gateBypassed)}`,
    `nDense=${fmt(d.nDense)}`,
    `nLex=${fmt(d.nLexical)}`,
    `lexEmpty=${fmt(d.lexEmpty)}`,
    `nCand=${fmt(d.nCand)}`,
    `pool=${fmt(d.pool)}`,
    `ranker=${fmt(d.ranker)}`,
    `winD=${fmt(d.winnerDenseRank)}`,
    `qNorm=${fmt(d.qNorm)}`,
    `qNormMs=${fmt(d.qNormMs)}`,
    `gateVia=${fmt(d.gateVia)}`,
    `gapMed=${fmt(d.gapMed)}`,
    `answEntail=${fmt(d.answEntail)}`,
    `parcial=${fmt(d.parcial)}`,
    `selfAbstain=${fmt(d.selfAbstain)}`,
    `cierre=${d.cierreChecked ? (d.cierreReplaced ? "replaced" : "ok") : "-"}`,
    `drift=${fmt(d.drift)}`,
    `nli=${d.nliUnavailable ? "unavailable" : fmt(d.nliChecked)}`,
    // mode y scope estaban en la interfaz pero NO se imprimían: la pregunta
    // "cuántos turnos cayeron en modo general sobre contenido local, y sobre
    // qué conocimiento" necesita los tres en la misma línea. itemLocal decide
    // qué material del Mineduc o la BCN ir a buscar, con demanda real.
    `mode=${fmt(d.mode)}`,
    `scope=${fmt(d.scope)}`,
    `temaLocal=${fmt(d.temaLocal)}`,
    `itemLocal=${d.itemLocal ? JSON.stringify(d.itemLocal.slice(0, 60)) : "-"}`,
    `chars=${fmt(d.chars)}`,
    `ms=${fmt(d.ms)}`,
  ];
  console.log(`[decision] ${parts.join(" ")}`);
}
