import { getSql } from "@tutor-ia/db";
import { requireTeacher } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/teacher/overview[?grade=7B] — cómo va un curso.
 *
 * LO QUE ESTA RUTA NO DEVUELVE, Y ES DELIBERADO: nada de `messages`. El docente
 * ve el avance y los temas que le cuestan a cada alumno, no lo que el alumno le
 * escribió al tutor. Un chico que sabe que su profe lee sus preguntas deja de
 * preguntar con honestidad, y ahí el tutor deja de servir. La privacidad no la
 * sostiene el rol: la sostiene que este archivo no consulte esa tabla.
 *
 * Y los alumnos son ANÓNIMOS incluso acá: lo único que identifica una fila es el
 * username ("7b-01"). Quién es esa persona vive en papel en el colegio.
 */

export interface CursoDisponible { grade: string; students: number }
export interface MateriaCurso {
  id: string; name: string; subjectArea: string | null;
  /** Temas del plan. Ver `planTotal` abajo: puede ser 0 y significa algo. */
  planTotal: number;
}
export interface TemaDificil {
  topicKey: string; topic: string; subjectId: string;
  /** Cuántos alumnos DISTINTOS lo fallaron. Es el orden que importa. */
  students: number;
  /** Veces que se falló en total (un alumno puede fallarlo en varias pruebas). */
  misses: number;
}
export interface AlumnoFila {
  username: string;
  /** Granularidad de HORA: `last_seen_at` se refresca como mucho una vez por
   *  hora (ver session.ts). No es "está conectado ahora". */
  lastSeen: string | null;
  done: number;
  weak: number;
  lastScore: { score: number; total: number; at: string; subjectId: string } | null;
  bySubject: { subjectId: string; done: number; weak: number }[];
}
export interface TeacherOverview {
  grades: CursoDisponible[];
  grade: string | null;
  subjects: MateriaCurso[];
  summary: { students: number; activos: number; conPrueba: number };
  weak: TemaDificil[];
  students: AlumnoFila[];
}

/** Igual que `getPlanTopics`: el plan toma como mucho 14 lecciones del índice. */
const PLAN_LIMIT = 14;
/** Ventana de "entró últimamente". Una semana cubre el ciclo escolar normal. */
const ACTIVO_DIAS = 7;

export async function GET(req: Request) {
  const auth = await requireTeacher(req);
  if (auth instanceof Response) return auth;

  const sql = getSql();
  const uid = auth.userId;
  const pedido = new URL(req.url).searchParams.get("grade");

  // El grado NO está en `subjects` sino en `documents` (una materia lo hereda de
  // sus libros), igual que en /api/subjects.
  const materias = await sql<{
    id: string; name: string; grade: string | null; subject_area: string | null; plan_total: number;
  }[]>`
    select s.id, s.name,
           max(d.grade)        as grade,
           max(d.subject_area) as subject_area,
           -- Denominador del avance. NO sale de subject_plans: esa cache se
           -- escribe recién cuando un alumno aprieta "armar plan", así que hoy
           -- está vacía y el panel mostraría "0 de 0" en todas las materias.
           -- Se calcula igual que getPlanTopics: las lecciones del índice del
           -- libro, topeadas en 14, y 0 si hay menos de 3 (ahí el plan cae al
           -- fallback legacy y su tamaño no se puede saber sin generarlo).
           coalesce((
             select case when count(*) >= 3 then least(count(*), ${PLAN_LIMIT}) else 0 end
             from book_sections bs where bs.subject_id = s.id and bs.level = 2
           ), 0)::int as plan_total
    from subjects s
    join documents d on d.subject_id = s.id
    where s.user_id is null or s.user_id = ${uid}::uuid
    group by s.id, s.name
    order by s.name`;

  // Cursos del selector: los que tienen material Y los que tienen alumnos. Un
  // curso con material y sin alumnos tiene que poder elegirse — que aparezca
  // vacío es información, y esconderlo lo haría ver como si no existiera.
  const alumnosPorGrado = await sql<{ grade: string; n: number }[]>`
    select p.grade, count(*)::int as n
    from student_profiles p
    join users u on u.id = p.user_id
    where p.grade is not null and u.role = 'student' and u.disabled_at is null
    group by p.grade`;

  const conteo = new Map(alumnosPorGrado.map((r) => [r.grade, r.n]));
  const grades: CursoDisponible[] = [
    ...new Set([
      ...(materias.map((m) => m.grade).filter(Boolean) as string[]),
      ...conteo.keys(),
    ]),
  ]
    .map((g) => ({ grade: g, students: conteo.get(g) ?? 0 }))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade));

  // Curso por defecto: el primero que tenga alumnos. Abrir el panel en un curso
  // vacío haría parecer que la herramienta no tiene datos.
  const grade = pedido ?? grades.find((g) => g.students > 0)?.grade ?? grades[0]?.grade ?? null;

  if (!grade) {
    const vacio: TeacherOverview = {
      grades, grade: null, subjects: [],
      summary: { students: 0, activos: 0, conPrueba: 0 },
      weak: [], students: [],
    };
    return Response.json(vacio);
  }

  const [alumnos, hechos, debiles, notas, temas] = await Promise.all([
    // Un alumno = una cuenta con este curso elegido. `last_seen_at` sale de la
    // sesión más reciente; null = nunca entró (cuenta repartida y sin estrenar).
    sql<{ user_id: string; username: string; last_seen: Date | null }[]>`
      select u.id as user_id, u.username, max(s.last_seen_at) as last_seen
      from users u
      join student_profiles p on p.user_id = u.id
      left join auth_sessions s on s.user_id = u.id
      where p.grade = ${grade} and u.role = 'student' and u.disabled_at is null
      group by u.id, u.username
      order by u.username`,

    sql<{ user_id: string; subject_id: string; n: number }[]>`
      select pp.user_id, pp.subject_id, count(*)::int as n
      from student_plan_progress pp
      join student_profiles p on p.user_id = pp.user_id
      where p.grade = ${grade}
      group by pp.user_id, pp.subject_id`,

    sql<{ user_id: string; subject_id: string; n: number }[]>`
      select w.user_id, w.subject_id, count(*)::int as n
      from student_weak_topics w
      join student_profiles p on p.user_id = w.user_id
      where p.grade = ${grade}
      group by w.user_id, w.subject_id`,

    // Última prueba de cada alumno, sin importar la materia.
    // `score` es numeric(5,2) y postgres.js lo devuelve como STRING ("3.00"):
    // sin el Number() de más abajo la pantalla dice "3.00/5" en vez de "3/5".
    sql<{ user_id: string; subject_id: string; score: string; total: number; at: Date }[]>`
      select distinct on (a.user_id)
             a.user_id, e.subject_id, a.score,
             jsonb_array_length(e.questions) as total, a.submitted_at as at
      from exam_attempts a
      join exams e on e.id = a.exam_id
      join student_profiles p on p.user_id = a.user_id
      where p.grade = ${grade}
      order by a.user_id, a.submitted_at desc`,

    // EL BLOQUE QUE JUSTIFICA LA PÁGINA: qué le cuesta a la clase entera.
    // Ordenado por alumnos afectados y no por total de fallos, porque un tema
    // que un solo chico falló seis veces es un problema de ese chico; uno que
    // fallaron diez es un problema de cómo se enseñó.
    sql<{ topic_key: string; topic: string; subject_id: string; students: number; misses: number }[]>`
      select w.topic_key, max(w.topic) as topic, w.subject_id,
             count(distinct w.user_id)::int as students,
             sum(w.misses)::int             as misses
      from student_weak_topics w
      join student_profiles p on p.user_id = w.user_id
      join users u on u.id = w.user_id
      where p.grade = ${grade} and u.role = 'student' and u.disabled_at is null
      group by w.topic_key, w.subject_id
      order by count(distinct w.user_id) desc, sum(w.misses) desc
      limit 20`,
  ]);

  const porAlumno = new Map<string, AlumnoFila>();
  const filas: AlumnoFila[] = alumnos.map((a) => {
    const fila: AlumnoFila = {
      username: a.username,
      lastSeen: a.last_seen ? new Date(a.last_seen).toISOString() : null,
      done: 0, weak: 0, lastScore: null, bySubject: [],
    };
    porAlumno.set(a.user_id, fila);
    return fila;
  });

  const celda = (uidAlumno: string, subjectId: string) => {
    const fila = porAlumno.get(uidAlumno);
    if (!fila) return null;   // avance de un alumno que cambió de curso
    let c = fila.bySubject.find((x) => x.subjectId === subjectId);
    if (!c) { c = { subjectId, done: 0, weak: 0 }; fila.bySubject.push(c); }
    return c;
  };

  for (const r of hechos) {
    const c = celda(r.user_id, r.subject_id);
    if (c) { c.done = r.n; porAlumno.get(r.user_id)!.done += r.n; }
  }
  for (const r of debiles) {
    const c = celda(r.user_id, r.subject_id);
    if (c) { c.weak = r.n; porAlumno.get(r.user_id)!.weak += r.n; }
  }
  for (const r of notas) {
    const fila = porAlumno.get(r.user_id);
    if (fila) {
      fila.lastScore = {
        score: Number(r.score), total: r.total,
        at: new Date(r.at).toISOString(), subjectId: r.subject_id,
      };
    }
  }

  const corte = Date.now() - ACTIVO_DIAS * 86400_000;
  const body: TeacherOverview = {
    grades,
    grade,
    subjects: materias
      .filter((m) => m.grade === grade)
      .map((m) => ({ id: m.id, name: m.name, subjectArea: m.subject_area, planTotal: m.plan_total })),
    summary: {
      students: filas.length,
      activos: filas.filter((f) => f.lastSeen && new Date(f.lastSeen).getTime() >= corte).length,
      conPrueba: filas.filter((f) => f.lastScore).length,
    },
    weak: temas.map((t) => ({
      topicKey: t.topic_key, topic: t.topic, subjectId: t.subject_id,
      students: t.students, misses: t.misses,
    })),
    students: filas,
  };
  return Response.json(body);
}

/** "7B" < "8B" < "1M". Duplicado chico de app/ui.tsx: el servidor no importa UI. */
const gradeSort = (g: string) => (g.endsWith("M") ? 100 : 0) + Number(g.slice(0, -1) || 0);
