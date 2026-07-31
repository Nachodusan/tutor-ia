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
  /**
   * El modelo SE ABSTUVO SOLO pese a tener material. Es la señal que separa
   * "el gate cortó" de "el prompt ahorcó al modelo": sin esto no se puede saber
   * si la culpa es del umbral o de las instrucciones.
   */
  selfAbstain?: boolean;
  /** Deriva sistemática detectada por el NLI (verify.ts). */
  drift?: boolean;
  /** El sidecar de NLI no pudo verificar. */
  nliUnavailable?: boolean;
  /** Oraciones que el NLI llegó a chequear. */
  nliChecked?: number | null;
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

export function looksLikeSelfAbstention(text: string): boolean {
  return SELF_ABSTAIN_RE.test(text.slice(0, 240));
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
    `selfAbstain=${fmt(d.selfAbstain)}`,
    `drift=${fmt(d.drift)}`,
    `nli=${d.nliUnavailable ? "unavailable" : fmt(d.nliChecked)}`,
    `chars=${fmt(d.chars)}`,
    `ms=${fmt(d.ms)}`,
  ];
  console.log(`[decision] ${parts.join(" ")}`);
}
