/** Tipos compartidos entre backend, web y (futuro) móvil. */

export type QuestionType = "mcq" | "true_false" | "open";

export interface SourceRef {
  documentId?: string;
  chunkId?: string;
  page?: number | null;
}

export interface ExamQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  /** Solo para 'mcq': opciones a elegir. */
  options?: string[];
  /**
   * Respuesta correcta:
   *  - mcq: índice de la opción correcta (como string, p. ej. "2")
   *  - true_false: "true" | "false"
   *  - open: respuesta modelo / puntos clave esperados
   */
  answer: string;
  /** Solo 'open': criterios de corrección. */
  rubric?: string;
  /** Fragmento del material en que se basa la pregunta. */
  source?: SourceRef;
}

export interface Exam {
  title: string;
  difficulty: "easy" | "medium" | "hard";
  questions: ExamQuestion[];
}

export interface StudentAnswer {
  questionId: string;
  response: string;
}

export interface GradedAnswer {
  questionId: string;
  correct: boolean;
  /** 0..1 */
  score: number;
  feedback: string;
}

export interface GradingResult {
  perQuestion: GradedAnswer[];
  /** 0..100 */
  totalScore: number;
  summary: string;
}

export interface Citation {
  index: number;
  documentId: string;
  chunkId: string;
  page: number | null;
  /** Ruta de encabezados ("Unidad 1 › Lección 1 › ...") para citas legibles. */
  headingPath?: string | null;
  /** Score del reranker (0-1) del fragmento citado. */
  score?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
