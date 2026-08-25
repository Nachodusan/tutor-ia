/**
 * TIPOS COMPARTIDOS entre las páginas del alumno.
 *
 * Vivían dentro de `page.tsx` cuando había UNA sola pantalla que hacía todo. Al
 * partir el alumno en rutas (`/materia/[id]`, `/chat`, `/prueba`), cada una
 * necesita los mismos, y tres copias de `PlanItem` se separan en cuanto alguien
 * agrega un campo en una sola.
 */
export interface Citation { index: number; chunkId: string; page: number | null; source?: "content" | "pedagogy"; label?: string; grade?: string | null }
export interface Verification { grounded: boolean; contradicted: string[]; unsupported: string[]; checked?: number; unavailable?: boolean }

export type AnswerMode = "libro" | "apoyado" | "general";
export type AnswerScope = "curso" | "otro_curso" | "area" | "otra_materia" | "ninguno";
/** `tarjeta` = el turno se resolvió por el MODO EJERCICIO y se pinta como ficha
 *  (enunciado, resultado verificado, pasos y plano) en vez de burbuja de chat. */
export interface Msg { role: "user" | "assistant"; content: string; citations?: Citation[]; verification?: Verification | null; grounded?: boolean; mode?: AnswerMode; scope?: AnswerScope; temaLocal?: string | null; streaming?: boolean; tarjeta?: import("./tarjeta-ejercicio").Tarjeta | null }
/** `disabled` = materia sacada de circulación. Se sigue mostrando (si no,
 *  no hay forma de saber que existe) pero no se puede abrir. */
export interface Subject { id: string; name: string; grade: string | null; subject_area: string | null; content_chunks: string; pedagogy_chunks: string; disabled?: boolean }
/** El perfil NO tiene nombre: las cuentas son anónimas (los usuarios son
 *  menores). El username lo devuelve /api/me y solo sirve para saludar.
 *  `avatar` es un id del catálogo (`avatares.ts`), nunca una imagen: es lo
 *  único que el alumno puede cambiar, y no dice quién es. */
export interface Profile { username: string; grade: string; avatar?: string | null }
/** `points` puede faltar: los planes cacheados antes de que existieran los
 *  puntos clave siguen siendo válidos y se muestran sin ellos. */
/** Un conocimiento esencial del currículum que cae en este tramo del libro.
 *  Lo calcula /api/plan al leer, cruzando las páginas contra `curriculum_map`. */
export interface Pilar { item: string; asignatura: string; cobertura: string }
/** Un conocimiento que el Estado exige y este libro no enseña. Ver `pendientesDe`. */
export interface Pendiente {
  item: string;
  asignatura: string;
  /** 'no_esta' = no está en ningún lado del tomo · 'otro_año' = está, en la mitad del otro curso. */
  motivo: string;
  enHermana: {
    materia: string;
    /** El tomo concreto (título del documento), cuando se conoce. */
    tomo: string | null;
    paginaDesde: number | null;
    donde: "materia" | "curso_vecino" | "otro_nivel";
    /** true = esa ubicación no desarrolla el ítem completo: "está a medias en…". */
    aMedias: boolean;
  } | null;
  /** Los componentes faltantes viven en varios tomos: sin puntero único. */
  repartido: boolean;
}
export interface PlanItem { n: number; key: string; title: string; focus: string; points?: string[]; unit: number | null; lesson: number | null; p0: number | null; p1: number | null;
  /** Lo que el Estado exige en este tramo. Vacío = el libro lo trae igual, pero
   *  el currículum no lo pide acá. NO significa "salteable". */
  pilares?: Pilar[];
  /** Los puntos de control de la unidad. Vacío cuando el libro no tiene índice
   *  y la unidad no se desglosa, o cuando el ítem ya es una lección. */
  lecciones?: { key: string; title: string; p0: number; p1: number; unit: number | null; lesson: number | null; pilares?: Pilar[] }[] }
/** `correct`/`explain` NO llegan con la prueba: la clave vive en el servidor y
 *  se revela recién en la respuesta del submit (antes viajaba en el payload y
 *  cualquiera la veía en la pestaña Red). */
export interface TestItem { n: number; key?: string; topic: string; question: string; options: string[]; correct?: number; explain?: string; unit: number | null; lesson: number | null; p0: number | null; p1: number | null }
/** Pregunta de chequeo de UNA lección del camino. Igual que TestItem, la clave
 *  no viaja: llega recién en la corrección. */
export interface QuizQ { n: number; topicKey: string; topic: string; question: string; options: string[] }
export interface QuizResult {
  score: number; total: number;
  items: { n: number; question: string; options: string[]; chosen: number; correct: number; ok: boolean; explain: string }[];
}

// Un tema que el alumno falló en la prueba. Se guarda con unit/lesson para que
// "Reforzar" pueda disparar ESTUDIO DIRIGIDO (sin eso el retrieval se abstiene).
export interface WeakTopic { topicKey: string; topic: string; unit: number | null; lesson: number | null; misses: number }
export interface SubjectProgress { weak: WeakTopic[]; lastScore?: { score: number; total: number; at: string } | null }
/** Lo que el panel muestra de cada materia. Se arma leyendo las dos claves. */
export interface SubjectStats { planDone: number; planTotal: number; weak: WeakTopic[]; lastScore?: { score: number; total: number; at: string } | null }

// Acá vivía REVIEW_MAX = 6, el tope de temas a reforzar en el panel. Se fue
// cuando "Para reforzar" pasó a ser una sección propia agrupada por materia: el
// tope existía porque la lista era plana y le comía la pantalla al resto del
// panel, y en una sección a la que el alumno ENTRA a propósito, esconderle la
// mitad de lo que falló es esconderle justo lo que vino a ver.

/** Estado de la llamada de voz. */
export type CallState = "idle" | "listening" | "thinking" | "speaking";
