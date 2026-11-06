import { generarPreguntas, SinPreguntas, type QuizItem, type TipoPregunta } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { getPlanTopics, type PlanTopic } from "@tutor-ia/rag";
import { requireCursoAbierto } from "@/lib/auth";
import { repartoPrueba, TOPE_TEMAS } from "../../reparto-prueba";

export const runtime = "nodejs";
// Generar + verificar la clave son dos llamadas al modelo remoto.
export const maxDuration = 180;

/**
 * POST /api/test — arma una SIMULACIÓN DE PRUEBA (opción múltiple) desde el
 * material real. body: { subjectId, subjectName?, topicKeys? }
 *
 * DOS FORMAS DE ELEGIR QUÉ ENTRA:
 *  · `topicKeys` — los puntos que marcó el alumno en la pantalla previa. Es el
 *    caso normal desde que la prueba se arma a pedido: sabe en qué está flojo y
 *    quiere que le tomen eso.
 *  · sin `topicKeys` — temas REPARTIDOS por todo el libro (con jitter, así dos
 *    intentos no traen la misma prueba). Sigue existiendo para las materias sin
 *    plan legible y para "tomame de todo".
 *
 * Cada pregunta sabe de qué TEMA salió (`key`), y por eso el feedback puede
 * señalar los puntos débiles y enlazar a estudiarlos (estudio dirigido por
 * unit/lesson).
 *
 * LA CLAVE NUNCA VIAJA AL CLIENTE. La prueba completa (con `correct` y
 * `explain`) se persiste en `exams` al generarla; el cliente recibe `testId` +
 * preguntas sin clave, y la corrección la hace /api/test/submit contra lo
 * persistido. Antes la clave iba en el payload: cualquier chico con la pestaña
 * Red abierta la veía, y el submit confiaba en el `correct` que mandara el
 * navegador.
 *
 * GENERAR ES DE `@tutor-ia/core`. Esta ruta tenía su propia copia del prompt, de
 * la validación y de la verificación a ciegas de la clave, y ya había divergido
 * de la del camino: le faltaba `topicIndex` (sin eso, pedir VARIAS preguntas por
 * tema atribuye mal las que sobran o faltan) y la regla de no preguntar por la
 * frase textual del libro.
 */

/** Lo que se persiste por pregunta (la clave incluida). */
interface ItemPersistido {
  n: number;
  topic: string;
  question: string;
  tipo: TipoPregunta;
  options: string[];
  correct: number;
  /** Respuesta modelo de `vf` y `abierta`. ES CLAVE: nunca sale al cliente. */
  referencia: string | null;
  explain: string;
  key: string;
  documentId: string;
  pageStart: number | null;
  pageEnd: number | null;
  unit: number | null;
  lesson: number | null;
  p0: number | null;
  p1: number | null;
}

export async function POST(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const body = (await req.json()) as {
    subjectId?: string;
    subjectName?: string;
    topicKeys?: unknown;
  };
  const subjectId = body.subjectId;
  if (!subjectId) return Response.json({ error: "Falta subjectId" }, { status: 400 });

  // Las claves llegan del navegador: se limpian antes de tocar la base. El tope
  // de 60 no es cosmético — sin él, un cliente cualquiera manda 5.000 claves y
  // la consulta las arrastra todas.
  const pedidas = Array.isArray(body.topicKeys)
    ? [...new Set(body.topicKeys.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 80))].slice(0, 60)
    : [];

  const sql = getSql();
  // El material del currículo es global (user_id null), pero la guarda importa:
  // el día que un colegio suba libros propios, esto impide que cualquier alumno
  // autenticado lea material de otro pasando un uuid.
  const [visible] = await sql`
    select 1 from subjects where id = ${subjectId}::uuid
      and (user_id is null or user_id = ${auth.userId}::uuid)
      -- disabled_at acá y no solo en /api/subjects: esconder la materia de la
      -- lista no alcanza, porque el cliente puede tener el id de antes (pestaña
      -- vieja, historial). Desactivar tiene que impedir el uso, no solo la vista.
      and disabled_at is null`;
  if (!visible) return Response.json({ error: "Materia no disponible" }, { status: 404 });

  // Los temas SIEMPRE salen del índice del libro de ESTA materia: `topicKeys` no
  // es una llave para leer material ajeno, es un filtro sobre lo que el alumno ya
  // podía ver. Una clave de otra materia simplemente no coincide con nada.
  const temas: PlanTopic[] = pedidas.length
    ? await getPlanTopics(subjectId, { keys: pedidas, limit: TOPE_TEMAS })
    : await getPlanTopics(subjectId, { limit: 6, spread: true });

  if (pedidas.length && temas.length === 0) {
    return Response.json(
      { error: "No encontré esos puntos en el libro de esta materia. Volvé a elegirlos." },
      { status: 422 },
    );
  }
  // Sin elección, una prueba de 1 tema no es una prueba. CON elección, sí: elegir
  // un solo punto es justamente el caso de "tomame esto que me cuesta".
  if (!pedidas.length && temas.length < 2) return Response.json({ items: [] });

  const reparto = repartoPrueba(temas.length);

  // LIBRO DEL PROFESOR: qué se evalúa + propósito, para alinear las preguntas a
  // lo que realmente se toma en la prueba (si la materia tiene guía docente).
  const evalRows = (await sql`
    select left(string_agg(ch.content, ' ' order by ch.chunk_index), 1000) as sample
    from chunks ch join documents d on d.id = ch.document_id
    where d.subject_id = ${subjectId} and ch.corpus_role = 'pedagogy'
      and ch.pedagogy_type in ('evaluacion', 'proposito')
  `) as unknown as { sample: string | null }[];
  const evalFocus = (evalRows[0]?.sample ?? "").replace(/\s+/g, " ").slice(0, 750);

  // EN TANDAS CHICAS Y EN PARALELO, no todo en una llamada.
  //
  // Medido con 10 puntos en una sola llamada: el modelo devolvió las 10
  // preguntas pero REPARTIDAS MAL — dos temas se llevaron dos preguntas cada uno
  // y otros dos se quedaron sin ninguna. Con esta pantalla eso es justo lo que no
  // puede pasar: el alumno eligió esos puntos, y "elegí este" tiene que
  // significar "me lo van a tomar". Con 5 temas por tanda el reparto le sale, y
  // de paso la prueba tarda lo que la tanda más lenta y no la suma de todas (76s
  // → ~35s en la prueba de 10).
  // CUATRO Y NO CINCO desde que entran los tres tipos: cada `vf` y cada
  // `abierta` agrega su respuesta modelo a la salida, así que la misma tanda
  // tarda bastante más y se acercaba al límite de 120 s de la llamada.
  const GRUPO = 4;
  const grupos: PlanTopic[][] = [];
  for (let i = 0; i < temas.length; i += GRUPO) grupos.push(temas.slice(i, i + GRUPO));

  const tandas = await Promise.allSettled(
    grupos.map((g) =>
      generarPreguntas(
        g.map((t) => ({ key: t.key, title: t.title, sample: t.sample })),
        {
          subjectName: body.subjectName ?? null, evalFocus, porTema: reparto.porTema,
          // LOS TRES TIPOS. La prueba de materia es el ensayo de la prueba de
          // verdad, y esa no es toda de opción múltiple: pide justificar y pide
          // desarrollar. El chequeo de una parada del camino sigue siendo solo
          // múltiple, porque tiene que corregirse en el acto y sin modelo.
          tipos: ["multiple", "vf", "abierta"],
        },
      ),
    ),
  );
  // Una tanda caída no se lleva la prueba entera: con las otras alcanza para
  // rendir. Solo si fallan TODAS se devuelve el error.
  const generadas: QuizItem[] = tandas.flatMap((t) => (t.status === "fulfilled" ? t.value : []));
  if (generadas.length === 0) {
    const primera = tandas.find((t) => t.status === "rejected") as PromiseRejectedResult | undefined;
    const razon = primera?.reason;
    // ── RESCATE: servir una prueba YA ARMADA de esta materia ────────────────
    //
    // Si el modelo no puede generar, una prueba real que ya existe es
    // infinitamente mejor que un 503. El material es el mismo libro y las
    // preguntas ya pasaron el verificador de clave el día que se armaron.
    //
    // SE CLONA, no se reusa la fila: `/api/test/submit` corrige con
    // `where user_id = …`, así que servir la prueba de otro alumno daría 404 al
    // entregar. La copia queda a nombre de quien la rinde y todo lo demás
    // funciona igual.
    //
    // ⚠️ Se avisa que es reutilizada (`reutilizada: true`). Una prueba vieja
    // servida como nueva es una mentira chica que se paga cara: el alumno que
    // reconoce las preguntas deja de creerle a la nota.
    // ⚠️ SE ELIGE LA MÁS COMPLETA Y, A IGUALDAD, LA MÁS VIEJA — no la más
    // reciente, que era lo primero que escribí y estaba mal.
    //
    // Cada rescate INSERTA una fila (hace falta: `submit` corrige con
    // `where user_id`, así que cada alumno necesita la suya). Con `order by
    // created_at desc`, a partir del segundo rescate la "previa" que encontraba
    // era su propio clon del rato anterior: medido, 6 clones encadenados en una
    // tarde. Las preguntas son las mismas —clonar un clon no las cambia— pero
    // el origen se iba desplazando y la fecha que se mostraba dejaba de
    // significar algo.
    //
    // Con este orden la fuente es SIEMPRE la misma fila mientras exista, y de
    // paso se sirve la prueba más larga que haya en vez de una de cuatro
    // preguntas que casualmente sea la última.
    const [previa] = await sql<{ questions: ItemPersistido[]; title: string; created_at: Date }[]>`
      select questions, title, created_at from exams
      where subject_id = ${subjectId}::uuid
        and jsonb_array_length(questions) >= 4
      order by jsonb_array_length(questions) desc, created_at asc
      limit 1`;

    if (previa) {
      const [copia] = await sql<{ id: string }[]>`
        insert into exams (user_id, subject_id, title, questions)
        values (${auth.userId}::uuid, ${subjectId}::uuid, ${previa.title},
                ${toJson(sql, previa.questions)}::jsonb)
        returning id`;
      console.warn(
        `[test] generación caída — se sirve una prueba previa de ${subjectId} ` +
        `(${previa.questions.length} preguntas, del ${new Date(previa.created_at).toISOString().slice(0, 10)})`,
      );
      return Response.json({
        testId: copia!.id,
        title: previa.title,
        reutilizada: true,
        armadaEl: new Date(previa.created_at).toISOString(),
        // EXACTAMENTE el mismo destructuring que el return normal, no una lista
        // de campos a mano: con una lista, el día que se agregue un campo al
        // item esta rama lo pierde en silencio y solo falla la prueba
        // reutilizada, que es el caso que nadie prueba.
        items: previa.questions.map(({ correct: _c, explain: _e, referencia: _r, ...rest }) => rest),
      });
    }

    if (razon instanceof SinPreguntas) {
      // Antes esto devolvía `items: []` con 200: una prueba vacía sin error, que
      // la UI mostraba como "no hay preguntas". Un fallo del modelo es un fallo.
      //
      // ⚠️ Y las tres razones dicen cosas DISTINTAS, porque se arreglan distinto:
      //  · proveedor  → no hay nada que reintentar; el que tiene que hacer algo
      //                 es el dueño, no el alumno. Decirle "probá de nuevo" lo
      //                 manda a golpear una puerta cerrada. Pasó el 2026-08-31:
      //                 un 402 por cuenta sin crédito se mostró como "no pude
      //                 armar una prueba confiable con este material", que
      //                 además acusaba al libro.
      //  · vacio      → el material o el verificador; reintentar puede servir.
      //  · generacion → el modelo se cayó; reintentar suele servir.
      if (razon.razon === "proveedor") {
        console.error(`[test] proveedor rechazó la generación: ${razon.causa}`);
        return Response.json(
          {
            error:
              "El servicio que arma las pruebas no está disponible en este momento. " +
              "No es tu material ni tu conexión: avisale a tu profe.",
          },
          { status: 503 },
        );
      }
      return Response.json(
        {
          error:
            razon.razon === "vacio"
              ? "No pude armar una prueba confiable con este material. Probá de nuevo."
              : "No pude armar la prueba ahora. Probá de nuevo en un momento.",
        },
        { status: 503 },
      );
    }
    throw razon ?? new Error("generación de prueba sin resultado");
  }

  // Si el verificador de clave tachó casi todo, algo anda mal con el material o
  // con el modelo: mejor avisar que servir una prueba de una sola pregunta.
  if (generadas.length < 2 && reparto.total >= 2) {
    return Response.json(
      { error: "No pude armar una prueba confiable con este material. Probá de nuevo." },
      { status: 503 },
    );
  }

  // Cada pregunta vuelve a su lección por `topicKey` — nunca por posición: con
  // varias preguntas por tema, una que el verificador descarta corre todas las
  // demás y el alumno termina viendo "estudiá la lección 7" por algo de la 6.
  const porClave = new Map(temas.map((t) => [t.key, t]));
  // NINGÚN TEMA SE QUEDA CON EL LUGAR DE OTRO: si el modelo devolvió tres
  // preguntas de una lección donde correspondían dos, la de más se descarta. Es
  // preferible una prueba de nueve que una donde un punto elegido no aparece
  // porque otro se comió su cupo.
  const cupo = new Map<string, number>();
  const generadasPodadas = generadas.filter((q) => {
    const usado = cupo.get(q.topicKey) ?? 0;
    if (usado >= reparto.porTema) return false;
    cupo.set(q.topicKey, usado + 1);
    return true;
  });
  const items: ItemPersistido[] = generadasPodadas.flatMap((q, k) => {
    const g = porClave.get(q.topicKey);
    if (!g) return [];
    return [{
      n: k + 1,
      topic: q.topic,
      tipo: q.tipo,
      question: q.question,
      options: q.options,
      correct: q.correct,
      referencia: q.referencia ?? null,
      explain: q.explain,
      key: g.key,
      documentId: g.documentId,
      pageStart: g.pageStart,
      pageEnd: g.pageEnd,
      // Retrocompatibles con el estudio dirigido actual.
      unit: g.unitNo,
      lesson: g.lessonNo,
      p0: g.pageStart,
      p1: g.pageEnd,
    }];
  }).map((it, k) => ({ ...it, n: k + 1 }));

  // El título deja registro de QUÉ se eligió: sin esto, dos intentos de la misma
  // materia se ven idénticos en el historial aunque uno haya sido de un punto y
  // el otro de todo el libro.
  const titulo = !pedidas.length
    ? "Simulación de prueba"
    : temas.length === 1
      ? `Prueba de: ${temas[0]!.title}`
      : `Prueba de ${temas.length} puntos elegidos`;

  // La prueba completa (clave incluida) queda en `exams`; el intento del alumno
  // la referenciará. Un examen generado y nunca rendido no aparece en ningún
  // panel (todo consulta vía exam_attempts).
  const [ex] = await sql<{ id: string }[]>`
    insert into exams (user_id, subject_id, title, questions)
    values (${auth.userId}::uuid, ${subjectId}::uuid, ${titulo},
            ${toJson(sql, items)}::jsonb)
    returning id`;

  // Al cliente: SIN `correct`, SIN `explain` y SIN `referencia`.
  //
  // `referencia` es la más peligrosa de las tres: en una pregunta abierta ES la
  // respuesta escrita, así que mandarla sería servir la prueba con el
  // solucionario adjunto. Se revela todo en el submit, después de rendir.
  return Response.json({
    testId: ex!.id,
    title: titulo,
    items: items.map(({ correct: _c, explain: _e, referencia: _r, ...rest }) => rest),
  });
}
