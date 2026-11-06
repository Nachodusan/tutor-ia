import { getSql } from "@tutor-ia/db";

/**
 * REPASO DE HOY — armar la sesión del día y llevarle la cuenta.
 *
 * Del lado del SERVIDOR a propósito: elegir los tres temas escribe una fila por
 * hueco, y dos pestañas del mismo chico abriendo la pantalla a la vez tienen que
 * terminar con la misma sesión, no con dos.
 */

/** Cuántos temas por día. Tres es lo que entra en una pantalla sin scroll y en
 *  un bloque de estudio del reloj. */
export const TEMAS_POR_DIA = 3;

export interface TemaDelDia {
  slot: number;
  subjectId: string;
  subjectName: string;
  topicKey: string;
  topic: string;
  misses: number;
  /** Lo intentó (rindió el chequeo), haya aprobado o no. Mueve el medidor. */
  hecho: boolean;
  /** Lo aprobó. Tilde lleno. */
  aprobado: boolean;
}

interface Candidato {
  subject_id: string;
  subject_name: string;
  topic_key: string;
  topic: string;
  misses: number;
  last_at: Date;
}

/** El día en la zona del alumno. En UTC la sesión rotaría a las 21:00 de Chile,
 *  en el medio del horario de estudio. */
export const ZONA = "America/Santiago";

/**
 * LOS CANDIDATOS: temas fallados que SE PUEDEN CERRAR.
 *
 * El filtro contra el plan no es un detalle de prolijidad. Al regenerar el
 * camino ("Rehacer") las claves de las lecciones cambian, y quedan temas
 * fallados apuntando a lecciones que ya no existen: sin chequeo que rendir, son
 * temas que el chico no puede sacar de la lista ni haciendo todo bien. Medido en
 * esta base: 2 de 9 temas de un alumno, y uno de ellos era el MÁS fallado —
 * justo el que la pantalla vieja ponía primero.
 */
async function candidatos(userId: string): Promise<Candidato[]> {
  const sql = getSql();
  return sql<Candidato[]>`
    select w.subject_id, s.name as subject_name, w.topic_key, w.topic, w.misses, w.last_at
    from student_weak_topics w
    join subjects s on s.id = w.subject_id and s.disabled_at is null
    where w.user_id = ${userId}::uuid
      -- SOLO DE SU CURSO. Un alumno cursa UN año, y mandarlo a reforzar temas
      -- de otro es mandarlo a estudiar de un libro que no es suyo. Medido el
      -- 2026-08-29 sobre el usuario de demo: 229 temas fallados, los 229 de 1º
      -- Medio, con el alumno en 4º — o sea que la pantalla de Reforzar estaba
      -- hecha ENTERA de material ajeno. El curso de una materia sale de sus
      -- documentos, igual que en /api/resumen: la tabla subjects no lo guarda.
      and exists (
        select 1
        from documents d, student_profiles sp
        where d.subject_id = w.subject_id
          and sp.user_id = w.user_id
          and d.grade = sp.grade
      )
      and exists (
        select 1
        from subject_plans p,
             jsonb_array_elements(p.items) it
        where p.subject_id = w.subject_id
          and (
            it->>'key' = w.topic_key
            or exists (
              select 1
              from jsonb_array_elements(coalesce(it->'lecciones', '[]'::jsonb)) l
              where l->>'key' = w.topic_key
            )
          )
      )`;
}

/**
 * LOS TRES HUECOS. Cada uno con un criterio distinto, y en este orden:
 *
 *   1. CERRABLE — el de menos fallos (desempate: el más viejo). Es el que se
 *      puede cerrar hoy; el medidor marca "1 de 3" a los cinco minutos y el
 *      chico ya está adentro.
 *   2. TRABADO  — el de más fallos. Es el que importa; sin él la sesión es
 *      cosmética.
 *   3. FRESCO   — el más reciente. Es el que acaba de fallar y viene a buscar.
 *
 * ⚠️ POR QUÉ NO "LOS TRES MÁS FALLADOS", que era lo obvio: medido sobre esta
 * base, 25 de 38 temas tienen exactamente UN fallo y todos los temas de cada
 * alumno nacieron la misma tarde (de una sola prueba). Ordenar por fallos y
 * desempatar por fecha es azar disfrazado de prioridad — y encima entrega los
 * tres más difíciles juntos, o sea que la sesión "que se termina" arrancaría por
 * lo más duro.
 *
 * Tope de DOS por materia cuando hay con qué: tres de la misma materia se leen
 * como "sos malo en Biología", que es el inventario de fracasos que esto vino a
 * reemplazar. Tope y no obligación de variar: hay alumnos con todos sus temas en
 * una sola materia, y ahí la regla tendría que inventar.
 */
export function elegirTres(pool: Candidato[]): Candidato[] {
  const elegidos: Candidato[] = [];
  const porMateria = new Map<string, number>();

  const disponible = (c: Candidato) =>
    !elegidos.includes(c) &&
    ((porMateria.get(c.subject_id) ?? 0) < 2 ||
      // Si TODO lo que queda es de esa materia, el tope no aplica: es preferible
      // un tercer tema de Biología que una sesión de dos.
      pool.every((o) => elegidos.includes(o) || o.subject_id === c.subject_id));

  const tomar = (orden: (a: Candidato, b: Candidato) => number) => {
    const c = pool.filter(disponible).sort(orden)[0];
    if (!c) return;
    elegidos.push(c);
    porMateria.set(c.subject_id, (porMateria.get(c.subject_id) ?? 0) + 1);
  };

  const viejo = (a: Candidato, b: Candidato) => +new Date(a.last_at) - +new Date(b.last_at);
  tomar((a, b) => a.misses - b.misses || viejo(a, b));   // cerrable
  tomar((a, b) => b.misses - a.misses || viejo(a, b));   // trabado
  tomar((a, b) => -viejo(a, b));                         // fresco
  return elegidos;
}

/**
 * La sesión de hoy: la lee, y si no existe la arma. Devuelve también cuántos
 * temas le quedan en total, que es lo que hace que "listo por hoy" signifique
 * algo — sin ese número, tres días seguidos de "listo" no achican nada visible.
 */
export async function repasoDeHoy(userId: string): Promise<{ temas: TemaDelDia[]; pendientes: number }> {
  const sql = getSql();
  const [{ hoy }] = await sql<{ hoy: string }[]>`
    select (now() at time zone ${ZONA})::date::text as hoy`;

  const leer = () => sql<{
    slot: number; subject_id: string; topic_key: string; topic: string;
    misses_at_pick: number | null; done_at: Date | null; passed: boolean | null; name: string;
  }[]>`
    select r.slot, r.subject_id, r.topic_key, r.topic, r.misses_at_pick, r.done_at, r.passed, s.name
    from student_review_day r
    join subjects s on s.id = r.subject_id
    where r.user_id = ${userId}::uuid and r.day = ${hoy}::date
    order by r.slot`;

  let filas = await leer();

  if (filas.length === 0) {
    const pool = await candidatos(userId);
    // Un tema ofrecido en los últimos días y todavía sin cerrar no se repite
    // enseguida: si se traba con uno, la pantalla se convierte en una deuda con
    // nombre y apellido.
    const recientes = await sql<{ topic_key: string }[]>`
      select distinct topic_key from student_review_day
      where user_id = ${userId}::uuid and day >= ${hoy}::date - 2 and (passed is null or passed = false)`;
    const evitar = new Set(recientes.map((r) => r.topic_key));
    const frescos = pool.filter((c) => !evitar.has(c.topic_key));
    // Si evitando los repetidos no queda nada, se vuelve al pool completo: es
    // mejor repetir un tema que mostrar una sesión vacía teniendo pendientes.
    const elegidos = elegirTres(frescos.length > 0 ? frescos : pool);

    for (const [i, c] of elegidos.entries()) {
      // `do nothing` y re-lectura: dos pestañas del mismo chico abriendo a la
      // vez tienen que terminar con LA MISMA sesión. Mismo patrón que usa
      // /api/lesson/quiz para dos alumnos generando el mismo quiz.
      await sql`
        insert into student_review_day (user_id, day, slot, subject_id, topic_key, topic, misses_at_pick)
        values (${userId}::uuid, ${hoy}::date, ${i}, ${c.subject_id}::uuid, ${c.topic_key}, ${c.topic}, ${c.misses})
        on conflict (user_id, day, slot) do nothing`;
    }
    filas = await leer();
  }

  // El total que se muestra en la chapita: MISMO recorte que los candidatos.
  // Sin el filtro de curso decía 229 mientras la lista de abajo mostraba 3, y
  // los 229 eran de otro año.
  const [{ n }] = await sql<{ n: string }[]>`
    select count(*)::text as n
    from student_weak_topics w
    where w.user_id = ${userId}::uuid
      and exists (
        select 1
        from documents d, student_profiles sp
        where d.subject_id = w.subject_id
          and sp.user_id = w.user_id
          and d.grade = sp.grade
      )`;

  return {
    temas: filas.map((f) => ({
      slot: f.slot,
      subjectId: f.subject_id,
      subjectName: f.name,
      topicKey: f.topic_key,
      topic: f.topic,
      misses: f.misses_at_pick ?? 0,
      hecho: !!f.done_at,
      aprobado: f.passed === true,
    })),
    pendientes: Number(n),
  };
}

/**
 * Marca en la sesión de hoy que el chico rindió un tema. Lo llama el submit del
 * chequeo, en el mismo momento en que decide si el tema sigue para reforzar.
 *
 * No falla el submit si esto falla: corregir la lección es lo importante, y que
 * el medidor no se mueva es molesto pero no rompe nada.
 */
export async function marcarRepaso(userId: string, topicKey: string, paso: boolean): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      update student_review_day
         set done_at = coalesce(done_at, now()), passed = ${paso}
       where user_id = ${userId}::uuid
         and day = (now() at time zone ${ZONA})::date
         and topic_key = ${topicKey}`;
  } catch (e) {
    console.error(`[repaso] no se pudo marcar ${topicKey}: ${e instanceof Error ? e.message : e}`);
  }
}
