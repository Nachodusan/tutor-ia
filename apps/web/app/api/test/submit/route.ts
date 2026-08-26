import {
  corregirAbierta, corregirJustificacion,
  type CorreccionEscrita, type TipoPregunta,
} from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { aprobado } from "../../../nota";

export const runtime = "nodejs";
// Corregir lo escrito son dos llamadas al modelo POR RESPUESTA (puntos clave +
// chequeo de cada punto). Con varias abiertas y varias justificaciones eso pasa
// holgado los 10 s por omisión de una ruta serverless.
export const maxDuration = 180;

/** La forma persistida en exams.questions (ver /api/test). */
interface ItemPersistido {
  n: number;
  topic: string;
  tipo?: TipoPregunta;
  question: string;
  options: string[];
  correct: number;
  /** Respuesta modelo de `vf`/`abierta`. La clave de lo escrito. */
  referencia?: string | null;
  explain: string;
  key: string;
  unit: number | null;
  lesson: number | null;
}

/**
 * POST /api/test/submit — body: { testId, answers: (number|null)[] }
 *
 * Corrige la prueba CONTRA LO PERSISTIDO en `exams` y actualiza los temas para
 * reforzar. Antes el cliente mandaba los items con su propio `correct`: la
 * clave viajaba al navegador y el servidor le creía al índice que viniera —
 * cualquiera con la pestaña Red abierta la leía, y un cliente adulterado
 * "acertaba" todo. Ahora la clave nunca sale del servidor hasta después de
 * rendir: la respuesta incluye `key` (correct + explain por pregunta) para que
 * la UI pinte los resultados.
 *
 * La identidad del tema es `topicKey` (acá `q.key`), no su TEXTO: el título de
 * cada pregunta lo redacta el modelo en cada generación, así que dos pruebas
 * producían strings distintos para la misma lección y el tema no salía nunca de
 * la lista de refuerzo aunque el alumno lo acertara después.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    testId?: string;
    answers?: (number | null)[];
    /** Lo que el alumno ESCRIBIÓ: justificación de un v/f o respuesta abierta. */
    textos?: (string | null)[];
  };
  if (!body.testId || !Array.isArray(body.answers)) {
    return Response.json({ error: "Faltan testId o answers" }, { status: 400 });
  }

  const sql = getSql();
  const uid = auth.userId;

  // user_id en el WHERE: un alumno solo puede rendir SU prueba.
  const [exam] = await sql<{ id: string; subject_id: string | null; questions: ItemPersistido[] }[]>`
    select id, subject_id, questions from exams
    where id = ${body.testId}::uuid and user_id = ${uid}::uuid`;
  if (!exam) return Response.json({ error: "Prueba no encontrada" }, { status: 404 });

  const questions = exam.questions;
  const sid = exam.subject_id;
  const answers = questions.map((_, i) => {
    const a = body.answers![i];
    return Number.isInteger(a) ? (a as number) : null;
  });

  // Se recorta acá y no en la corrección: sin tope, un cliente cualquiera manda
  // 200 KB de texto por pregunta y eso se convierte en tokens pagados.
  const textos = questions.map((_, i) => (body.textos?.[i] ?? "").toString().slice(0, 1200));

  /**
   * CORRECCIÓN POR TIPO.
   *
   *   multiple — la opción elegida contra la clave. Sin modelo.
   *   vf       — la mitad V/F se corrige sola; la JUSTIFICACIÓN se lee contra la
   *              referencia. Cuenta como correcta solo si acertó las dos: un
   *              verdadero/falso justificado que se aprueba adivinando la moneda
   *              no mide nada, que es justamente por lo que se pide justificar.
   *   abierta  — todo se decide sobre lo escrito.
   *
   * Las escritas se corrigen EN PARALELO: son dos llamadas al modelo cada una y
   * en serie la corrección de una prueba con cuatro escritas tardaría un minuto.
   */
  const escritas = new Map<number, CorreccionEscrita>();
  await Promise.all(questions.map(async (q, i) => {
    const tipo = q.tipo ?? "multiple";
    if (tipo === "multiple" || !q.referencia) return;
    try {
      escritas.set(i, tipo === "vf"
        ? await corregirJustificacion({ afirmacion: q.question, referencia: q.referencia, escrito: textos[i]! })
        : await corregirAbierta({ pregunta: q.question, referencia: q.referencia, escrito: textos[i]! }));
    } catch (e) {
      // ⚠️ EL MODELO CAÍDO NO PUEDE REPROBAR AL ALUMNO. Sin corrección no hay
      // juicio posible sobre lo que escribió, y el error por omisión tiene que
      // ser a favor: se cuenta como correcta y se dice que no se pudo revisar.
      // Lo contrario —reprobar por un 429— es exactamente el fallo que hace que
      // un adulto que volvió a estudiar no vuelva a abrir la app.
      console.error(`[test/submit] no pude corregir la ${i + 1}: ${e instanceof Error ? e.message : e}`);
      escritas.set(i, { ok: true, cubiertos: [], faltantes: [], score: 1, vacia: false });
    }
  }));

  const acerto = (q: ItemPersistido, i: number): boolean => {
    const tipo = q.tipo ?? "multiple";
    if (tipo === "multiple") return answers[i] === q.correct;
    if (tipo === "vf") return answers[i] === q.correct && (escritas.get(i)?.ok ?? false);
    return escritas.get(i)?.ok ?? false;
  };

  const total = questions.length;
  const score = questions.filter(acerto).length;

  // EL TEMA SE JUZGA COMPLETO, NO PREGUNTA POR PREGUNTA.
  //
  // Desde que el alumno elige qué entra, una prueba puede tomar 8 preguntas del
  // MISMO punto. Escribiendo de a una, cada acierto borraba la fila y cada error
  // la volvía a insertar: mandaba la ÚLTIMA pregunta del tema. Con 4 de 8 bien y
  // la última acertada, el punto quedaba como dominado — y ese es el número que
  // alimenta "Para reforzar" y el panel del docente.
  //
  // La regla es la misma que pinta los nodos del camino (dos tercios): que el
  // chico vea el mismo criterio en las dos pantallas.
  const porTema = new Map<
    string,
    { topic: string; unit: number | null; lesson: number | null; bien: number; total: number }
  >();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const key = q.key || q.topic || "";
    if (!key) continue;
    const t = porTema.get(key) ?? {
      topic: q.topic ?? key, unit: q.unit ?? null, lesson: q.lesson ?? null, bien: 0, total: 0,
    };
    t.total++;
    if (acerto(q, i)) t.bien++;
    porTema.set(key, t);
  }

  await sql.begin(async (tx) => {
    if (sid) {
      for (const [key, t] of porTema) {
        if (aprobado(t.bien, t.total)) {
          // Le fue bien: el tema deja de estar para reforzar.
          await tx`
            delete from student_weak_topics
            where user_id = ${uid}::uuid and subject_id = ${sid}::uuid and topic_key = ${key}`;
        } else {
          // `misses + 1` por PRUEBA y no por pregunta fallada: la columna cuenta
          // "veces que le fue mal en este tema", y sumar de a una por pregunta
          // haría incomparables las filas viejas con las nuevas justo en la
          // columna que ordena la lista de refuerzo.
          await tx`
            insert into student_weak_topics (user_id, subject_id, topic_key, topic, unit, lesson, misses, last_at)
            values (${uid}::uuid, ${sid}::uuid, ${key}, ${t.topic}, ${t.unit}, ${t.lesson}, 1, now())
            on conflict (user_id, subject_id, topic_key) do update set
              misses  = student_weak_topics.misses + 1,
              topic   = excluded.topic,   -- la etiqueta legible se refresca
              unit    = excluded.unit,
              lesson  = excluded.lesson,
              last_at = now()`;
        }
      }
    }

    // `score` guarda la cantidad de aciertos, no un porcentaje: la UI muestra
    // "X de Y" y el total sale de jsonb_array_length(questions).
    // `toJson(...)` y NO `JSON.stringify(...)::jsonb`: ver la TRAMPA de jsonb.
    await tx`
      insert into exam_attempts (exam_id, user_id, answers, score)
      values (${exam.id}::uuid, ${uid}::uuid,
              ${toJson(tx, { answers, textos })}::jsonb, ${score})`;
  });

  const weak = sid
    ? await sql<{ topic_key: string; topic: string; unit: number | null; lesson: number | null; misses: number }[]>`
        select topic_key, topic, unit, lesson, misses from student_weak_topics
        where user_id = ${uid}::uuid and subject_id = ${sid}::uuid
        order by misses desc, last_at desc`
    : [];

  return Response.json({
    score,
    total,
    // La clave, recién ahora: la UI pinta aciertos/errores y muestra el "por qué".
    key: questions.map((q, i) => {
      const c = escritas.get(i);
      return {
        n: q.n,
        correct: q.correct,
        explain: q.explain,
        ok: acerto(q, i),
        // La respuesta modelo recién ahora: antes de rendir era el solucionario.
        referencia: q.referencia ?? null,
        // El "podrías completarlo con esto": los puntos de la respuesta modelo
        // que lo escrito NO cubrió. No los redacta nadie — salen de la
        // referencia, que salió del material.
        faltantes: c?.faltantes ?? [],
        cubiertos: c?.cubiertos ?? [],
        sinEscribir: c?.vacia ?? false,
      };
    }),
    weak: weak.map((w) => ({
      topicKey: w.topic_key, topic: w.topic, unit: w.unit, lesson: w.lesson, misses: w.misses,
    })),
  });
}
