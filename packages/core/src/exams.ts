/**
 * Generación y corrección de exámenes en MODO LOCAL con salida estructurada
 * (Ollama `format` + JSON Schema). Estricto: solo desde el material.
 */
import { retrieve, formatContext } from "@tutor-ia/rag";
import { chatJSON } from "./client";
import { config } from "./config";
import {
  buildExamGenerationPrompt,
  buildGradingPrompt,
} from "./prompts";
import { EXAM_SCHEMA, GRADING_SCHEMA } from "./schemas";
import type {
  Exam,
  ExamQuestion,
  GradingResult,
  StudentAnswer,
} from "./types";

export interface GenerateExamRequest {
  userId: string;
  subjectId?: string | null;
  topic?: string;
  numQuestions?: number;
  difficulty?: "easy" | "medium" | "hard";
  types?: ExamQuestion["type"][];
}

export async function generateExam(req: GenerateExamRequest): Promise<Exam> {
  const numQuestions = req.numQuestions ?? 8;
  const difficulty = req.difficulty ?? "medium";
  const types = req.types ?? ["mcq", "true_false", "open"];

  const all = await retrieve(req.topic ?? "resumen general del material", {
    userId: req.userId,
    subjectId: req.subjectId,
    matchCount: 16,
  });
  // Anti-alucinación: solo material suficientemente relevante.
  const chunks = all.filter((c) => c.similarity >= config.minSimilarity);
  if (chunks.length === 0) {
    throw new Error(
      "No hay material indexado suficiente para generar el examen. Sube apuntes primero.",
    );
  }
  const context = formatContext(chunks);

  return chatJSON<Exam>(
    [
      {
        role: "user",
        content: buildExamGenerationPrompt({
          context,
          numQuestions,
          difficulty,
          types,
        }),
      },
    ],
    EXAM_SCHEMA,
    { temperature: 0 },
  );
}

export async function gradeExam(
  exam: Exam,
  answers: StudentAnswer[],
): Promise<GradingResult> {
  return chatJSON<GradingResult>(
    [
      {
        role: "user",
        content: buildGradingPrompt({
          examJson: JSON.stringify(exam),
          answersJson: JSON.stringify(answers),
        }),
      },
    ],
    GRADING_SCHEMA,
    { temperature: 0 },
  );
}
