/**
 * JSON Schemas para structured outputs de Claude (output_config.format).
 * Garantizan que el examen y la corrección lleguen con formato parseable.
 */

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
