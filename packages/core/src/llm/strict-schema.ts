/**
 * Validador de JSON Schema para el modo ESTRICTO de Structured Outputs
 * (OpenAI-compatible). La API remota es estricta con estas reglas.
 *
 * Existe para que un schema incompatible falle con un mensaje que dice QUÉ
 * regla se rompió y DÓNDE, en vez del error genérico del proveedor. No modifica
 * el schema: solo diagnostica.
 *
 * Reglas verificadas (documentadas por OpenAI para strict: true):
 *  a) todo objeto lleva "additionalProperties": false
 *  b) TODAS las propiedades de un objeto están en "required"
 *  c) keywords no soportadas: minItems, maxItems, minimum, maximum,
 *     minLength, maxLength, pattern, format, default, multipleOf, …
 *  d) la raíz es type: "object"
 */

/** Keywords que el modo estricto rechaza. */
const UNSUPPORTED = [
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "default",
  "multipleOf",
  "minProperties",
  "maxProperties",
  "uniqueItems",
  "contains",
  "patternProperties",
] as const;

export interface StrictViolation {
  /** Ruta JSON-pointer-ish dentro del schema, ej: "items.items.properties.correct". */
  path: string;
  rule: "additionalProperties" | "required" | "unsupported_keyword" | "root_type";
  detail: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Devuelve todas las violaciones del modo estricto (vacío = compatible). */
export function findStrictViolations(schema: unknown): StrictViolation[] {
  const out: StrictViolation[] = [];

  if (!isObj(schema) || schema.type !== "object") {
    out.push({
      path: "(raíz)",
      rule: "root_type",
      detail: 'la raíz del schema debe ser type: "object"',
    });
    if (!isObj(schema)) return out;
  }

  walk(schema, "(raíz)", out);
  return out;
}

function walk(node: Obj, path: string, out: StrictViolation[]): void {
  for (const kw of UNSUPPORTED) {
    if (kw in node) {
      out.push({
        path,
        rule: "unsupported_keyword",
        detail: `"${kw}" no está soportado en strict mode (valor: ${JSON.stringify(node[kw])})`,
      });
    }
  }

  if (node.type === "object") {
    if (node.additionalProperties !== false) {
      out.push({
        path,
        rule: "additionalProperties",
        detail: 'falta "additionalProperties": false',
      });
    }

    const props = isObj(node.properties) ? node.properties : {};
    const names = Object.keys(props);
    const required = Array.isArray(node.required) ? (node.required as string[]) : [];
    const missing = names.filter((n) => !required.includes(n));
    if (missing.length > 0) {
      out.push({
        path,
        rule: "required",
        detail:
          `estas propiedades no están en "required": ${missing.join(", ")}. ` +
          `En strict mode no existen los campos opcionales: se agregan a "required" ` +
          `y se marcan nullables con type: ["<tipo>", "null"]`,
      });
    }

    for (const [name, sub] of Object.entries(props)) {
      if (isObj(sub)) walk(sub, `${path}.properties.${name}`, out);
    }
  }

  if (node.type === "array" && isObj(node.items)) {
    walk(node.items, `${path}.items`, out);
  }
}

/** Mensaje legible para el LLMError. */
export function formatViolations(v: StrictViolation[]): string {
  return v.map((x) => `  · ${x.path}: [${x.rule}] ${x.detail}`).join("\n");
}
