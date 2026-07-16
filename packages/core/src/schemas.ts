/**
 * JSON Schemas para structured outputs del LLM local (Ollama `format`).
 * Garantizan que el examen, la corrección y la extracción de presuposiciones
 * lleguen con formato parseable.
 */

/**
 * Presuposiciones de una pregunta: las afirmaciones que la pregunta da por
 * ciertas (para chequearlas contra el material y detectar premisas falsas).
 * Ej: "¿Por qué la mediana de las notas es 7,0?" presupone "La mediana es 7,0".
 */
export const PRESUPPOSITION_SCHEMA = {
  type: "object",
  properties: {
    presupposes: { type: "array", items: { type: "string" } },
  },
  required: ["presupposes"],
  additionalProperties: false,
} as const;

export const EXAM_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["mcq", "true_false", "open"] },
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "string" },
          rubric: { type: "string" },
          source: {
            type: "object",
            properties: {
              documentId: { type: "string" },
              chunkId: { type: "string" },
              page: { type: "integer" },
            },
            additionalProperties: false,
          },
        },
        required: ["id", "type", "prompt", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "difficulty", "questions"],
  additionalProperties: false,
} as const;

export const VERIFIER_SCHEMA = {
  type: "object",
  properties: {
    grounded: { type: "boolean" },
    unsupported: { type: "array", items: { type: "string" } },
  },
  required: ["grounded", "unsupported"],
  additionalProperties: false,
} as const;

/** Puntos clave extraídos de una respuesta de referencia (grading descompuesto). */
export const KEYPOINTS_SCHEMA = {
  type: "object",
  properties: {
    points: { type: "array", items: { type: "string" } },
  },
  required: ["points"],
  additionalProperties: false,
} as const;

/** Checks binarios por punto clave contra la respuesta del estudiante. */
export const POINTCHECKS_SCHEMA = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          covered: { type: "boolean" },
        },
        required: ["point", "covered"],
        additionalProperties: false,
      },
    },
  },
  required: ["checks"],
  additionalProperties: false,
} as const;

export const GRADING_SCHEMA = {
  type: "object",
  properties: {
    perQuestion: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionId: { type: "string" },
          correct: { type: "boolean" },
          score: { type: "number" },
          feedback: { type: "string" },
        },
        required: ["questionId", "correct", "score", "feedback"],
        additionalProperties: false,
      },
    },
    totalScore: { type: "number" },
    summary: { type: "string" },
  },
  required: ["perQuestion", "totalScore", "summary"],
  additionalProperties: false,
} as const;
