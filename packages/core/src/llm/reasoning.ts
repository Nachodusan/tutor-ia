/**
 * Filtrado del RAZONAMIENTO ("thinking") — defensa en profundidad.
 *
 * Independiente de LLM_REASONING: aunque mandemos el switch de apagado, el
 * razonamiento no debe llegar NUNCA al call site. Verificado contra DeepInfra:
 *
 *   - Qwen3.6-35B-A3B  -> el razonamiento viene en `reasoning_content` (campo
 *                         aparte) y `content` queda limpio.
 *   - Qwen3-30B-A3B    -> viene INLINE como <think>…</think> dentro de `content`.
 *   - Qwen3-30B con reasoning.enabled=true -> vienen LAS DOS a la vez.
 *
 * Además vLLM renombró `reasoning_content` a `reasoning` (RFC #27755), así que
 * hay que leer ambos nombres o el filtro se rompe según el motor del proveedor.
 *
 * Y un detalle que muerde: un typo en la clave del switch NO da error 400 —
 * da un modelo que piensa (verificado: `enable_thinkingg` -> HTTP 200, 237
 * tokens de razonamiento). Por eso esto se mide, no se asume.
 */

const OPEN = "<think>";
const CLOSE = "</think>";

/** ~4 chars por token: alcanza para dimensionar el gasto invisible. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export interface StripResult {
  /** El texto limpio, sin razonamiento. */
  content: string;
  /** El razonamiento que se descartó (solo para contarlo, nunca se emite). */
  reasoning: string;
  /** true → hubo que filtrar algo (el switch de apagado no alcanzó). */
  leaked: boolean;
  /** true → se abrió <think> y nunca cerró (se agotaron los tokens pensando). */
  truncated: boolean;
}

/**
 * Quita los bloques <think>…</think> de un texto COMPLETO (no streaming).
 *
 * Casos cubiertos:
 *  - bloque normal <think>…</think>
 *  - cierre HUÉRFANO (</think> sin apertura): pasa cuando la plantilla Jinja ya
 *    emitió el <think> como parte del prompt; todo lo previo es razonamiento.
 *  - apertura sin cierre: se agotó max_tokens pensando → truncated.
 */
export function stripThinkBlocks(raw: string): StripResult {
  let content = "";
  let reasoning = "";
  let leaked = false;
  let truncated = false;
  let rest = raw;

  // Cierre huérfano al principio: todo lo anterior fue razonamiento.
  const firstClose = rest.indexOf(CLOSE);
  const firstOpen = rest.indexOf(OPEN);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    reasoning += rest.slice(0, firstClose);
    rest = rest.slice(firstClose + CLOSE.length);
    leaked = true;
  }

  while (true) {
    const open = rest.indexOf(OPEN);
    if (open === -1) {
      content += rest;
      break;
    }
    content += rest.slice(0, open);
    const after = rest.slice(open + OPEN.length);
    const close = after.indexOf(CLOSE);
    leaked = true;
    if (close === -1) {
      // Nunca cerró: el resto entero es razonamiento.
      reasoning += after;
      truncated = true;
      break;
    }
    reasoning += after.slice(0, close);
    rest = after.slice(close + CLOSE.length);
  }

  return { content: content.trim(), reasoning, leaked, truncated };
}

/**
 * Filtro incremental para STREAMING.
 *
 * Garantías:
 *  - nunca emite un tag parcial (`<thi`) al consumidor;
 *  - nunca emite contenido de dentro de un bloque de razonamiento;
 *  - si el bloque no cierra, `finish()` lo reporta como truncado.
 *
 * Latencia: solo retiene los últimos caracteres que PODRÍAN ser el comienzo de
 * un tag (máx. 7), así que el texto normal fluye sin demora perceptible.
 */
export class ThinkStreamFilter {
  private pending = "";
  private inThink = false;
  private emittedAny = false;
  reasoning = "";
  leaked = false;

  /** ¿`s` termina con un prefijo (parcial) de alguno de los tags? */
  private partialTagTail(s: string): number {
    const max = Math.max(OPEN.length, CLOSE.length) - 1;
    for (let n = Math.min(max, s.length); n > 0; n--) {
      const tail = s.slice(s.length - n);
      if (OPEN.startsWith(tail) || CLOSE.startsWith(tail)) return n;
    }
    return 0;
  }

  /** Procesa un trozo del stream y devuelve lo que SÍ se puede emitir. */
  push(chunk: string): string {
    this.pending += chunk;
    let out = "";

    for (;;) {
      if (this.inThink) {
        const close = this.pending.indexOf(CLOSE);
        if (close === -1) {
          // Todo lo que hay es razonamiento, salvo un posible cierre parcial.
          const keep = this.partialTagTail(this.pending);
          this.reasoning += this.pending.slice(0, this.pending.length - keep);
          this.pending = this.pending.slice(this.pending.length - keep);
          break;
        }
        this.reasoning += this.pending.slice(0, close);
        this.pending = this.pending.slice(close + CLOSE.length);
        this.inThink = false;
        continue;
      }

      const open = this.pending.indexOf(OPEN);
      const close = this.pending.indexOf(CLOSE);

      // Cierre HUÉRFANO antes de cualquier apertura: la plantilla ya había
      // abierto el bloque. Si todavía no emitimos nada, lo previo era
      // razonamiento y se descarta sin que el consumidor lo haya visto.
      if (close !== -1 && (open === -1 || close < open) && !this.emittedAny) {
        this.reasoning += this.pending.slice(0, close);
        this.pending = this.pending.slice(close + CLOSE.length);
        this.leaked = true;
        continue;
      }

      if (open === -1) {
        const keep = this.partialTagTail(this.pending);
        const emit = this.pending.slice(0, this.pending.length - keep);
        this.pending = this.pending.slice(this.pending.length - keep);
        if (emit) {
          out += emit;
          this.emittedAny = true;
        }
        break;
      }

      const emit = this.pending.slice(0, open);
      if (emit) {
        out += emit;
        this.emittedAny = true;
      }
      this.pending = this.pending.slice(open + OPEN.length);
      this.inThink = true;
      this.leaked = true;
    }

    return out;
  }

  /** Cierra el stream. Devuelve lo último emitible + si quedó truncado. */
  finish(): { out: string; truncated: boolean } {
    if (this.inThink) {
      // Se acabó el stream dentro del bloque de razonamiento.
      this.reasoning += this.pending;
      this.pending = "";
      return { out: "", truncated: true };
    }
    const out = this.pending;
    this.pending = "";
    return { out, truncated: false };
  }
}

/**
 * Extrae el razonamiento de un `message`/`delta` de la API.
 * Acepta los DOS nombres: `reasoning_content` (DeepSeek/SGLang/DeepInfra) y
 * `reasoning` (vLLM moderno). Nunca se concatena al contenido.
 */
export function extractReasoningField(obj: unknown): string {
  if (typeof obj !== "object" || obj === null) return "";
  const o = obj as Record<string, unknown>;
  const rc = o.reasoning_content;
  if (typeof rc === "string" && rc) return rc;
  const r = o.reasoning;
  if (typeof r === "string" && r) return r;
  // Algunos proveedores lo mandan como objeto { text } / { content }.
  if (typeof r === "object" && r !== null) {
    const ro = r as Record<string, unknown>;
    for (const k of ["text", "content"]) {
      const v = ro[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}
