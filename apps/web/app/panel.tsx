"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { C, FONT, HARD, CTA, AURORA, AuroraDot, Dots, Pill, BigBtn, SectionTitle, IconUser, IconUsers, IconSettings, IconBook, IconSwap, IconArrow, IconStar, IconResumen, IconLock, gradeLabel, gradeSort, subjectLabel, subjectColor, isLight, backLink, IconBack, IconBtn, IconAlert, IconReforzar, scoreTone, IconCamino, IconPrueba, IconVolume, IconCheck, IconSpark, IconPuerta } from "./ui";
import { VOCES, VOZ_POR_DEFECTO, CLAVE_VOZ, type Voz } from "./voces";
import { buscarAvatar } from "./avatares";
import { CLASE_HUECO_RELOJ } from "./pomodoro";
import { cursoBloqueado, MOTIVO_CURSO_BLOQUEADO } from "@/lib/cursos";
import type { Profile, Subject, SubjectStats, WeakTopic } from "./tipos";

/**
 * EL AVATAR: el bicho que eligió, o el orbe de Aurora si todavía no eligió.
 *
 * Es lo único que un alumno puede cambiarle a su cuenta —no hay nombre ni foto,
 * son anónimas— así que también es lo único que hace que la cuenta se sienta
 * suya. Se dibuja igual en el nav, en el perfil y donde haga falta.
 */
export function Avatar({ id, size = 38, ink = true }: { id?: string | null; size?: number; ink?: boolean }) {
  const a = buscarAvatar(id);
  if (!a) return <AuroraDot size={size} square ink={ink} />;
  return (
    // DECORATIVO: sin `title` ni `aria-label` propios. Va siempre adentro de
    // algo que ya se nombra solo —el botón "Tu perfil" del nav, el encabezado
    // del perfil con el usuario al lado— y un `title` anidado le gana al del
    // botón: al pasar el mouse por la esquina salía "Pulpo" en vez de decir a
    // dónde lleva. El nombre del bicho vive en el selector del perfil, que es
    // donde hace falta.
    <span aria-hidden
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: size * 0.28,
        background: a.color, border: ink ? `2px solid ${C.ink}` : undefined,
        display: "grid", placeItems: "center",
        // El emoji se escala con la chapa: a 38 px de caja, 21 de letra deja el
        // aire que necesita el borde para no verse apretado.
        fontSize: Math.round(size * 0.55), lineHeight: 1, userSelect: "none",
      }}>
      {a.emoji}
    </span>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: C.bg, color: C.text, fontFamily: FONT.sans, padding: 20 }}>{children}</div>;
}

export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18, width: "100%", maxWidth: 560 }}>
      <div style={{ color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>{children}</div>
    </div>
  );
}

/**
 * Onboarding: UN solo paso, el curso.
 *
 * Antes había un segundo paso —"¿qué te interesa priorizar?"— que partía el
 * panel en "tus materias" y "otras materias". Se sacó porque la premisa era
 * falsa: el alumno cursa TODAS y ninguna es opcional. Lo único que producía era
 * que las no elegidas quedaran en una fila de pastillas chicas al pie, con su
 * avance escondido, y que un chico que se apuraba en el onboarding terminara
 * con una sola materia visible sin entender por qué.
 *
 * El paso del NOMBRE ya se había eliminado antes: las cuentas son anónimas y el
 * alumno se identifica con su usuario en el login.
 *
 * DE 1º A 5º BÁSICO EL CURSO SE MUESTRA CON CANDADO, no se esconde. Esconderlo
 * sería peor de lo que parece: un chico de 3º que no encuentra su curso elige el
 * que más se le parece —6º— y se pone a estudiar del libro equivocado. Con el
 * candado a la vista sabe que su curso existe, que no se rompió nada y que
 * todavía no le toca.
 */
export function Onboarding({ subjects, initial, onCancel, onDone }: { subjects: Subject[]; initial?: Profile; onCancel?: () => void; onDone: (p: Profile) => void }) {
  // Si el curso que traía está cerrado, se entra SIN elección hecha: dejarlo
  // preseleccionado habilitaría "Guardar" sobre un curso que el server rechaza.
  const [grade, setGrade] = useState(cursoBloqueado(initial?.grade) ? "" : initial?.grade ?? "");
  const [avisado, setAvisado] = useState<string | null>(null);
  const grades = [...new Set(subjects.map((s) => s.grade).filter(Boolean) as string[])].sort((a, b) => gradeSort(a) - gradeSort(b));
  const cuantas = grade ? subjects.filter((s) => s.grade === grade).length : 0;
  const hayBloqueados = grades.some(cursoBloqueado);

  /** Una pastilla de curso: elegible, o con candado si el curso está cerrado. */
  const curso = (g: string) =>
    cursoBloqueado(g)
      ? (
        <button key={g} onClick={() => setAvisado(g)} aria-disabled title={MOTIVO_CURSO_BLOQUEADO}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel2, color: C.dim, border: `1.5px dashed ${C.border}`, borderRadius: 999, padding: "9px 16px", cursor: "default", fontFamily: FONT.round, fontWeight: 600, fontSize: 14.5 }}>
          <IconLock size={13} /> {gradeLabel(g)}
        </button>
      )
      : <Pill key={g} active={g === grade} onClick={() => { setGrade(g); setAvisado(null); }}>{gradeLabel(g)}</Pill>;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", textAlign: "center", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <div style={{ padding: "48px 24px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "left" }}>
          {onCancel && <button onClick={onCancel} style={{ ...backLink, marginBottom: 0 }}><IconBack size={15} /> Cancelar</button>}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 20px 80px" }}>
        <div style={{ width: "100%", maxWidth: 600 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><AuroraDot size={54} /></div>
          <h1 style={{ margin: "0 0 6px", fontFamily: FONT.round, fontWeight: 800, fontSize: 26 }}>¿En qué curso vas?</h1>
          <p style={{ color: C.dim, margin: "0 0 26px", fontSize: 15 }}>
            Elegí tu grado y vas a tener todas tus materias en el panel.
          </p>
          <Group label="Básica">{grades.filter((g) => g.endsWith("B")).map(curso)}</Group>
          {grades.some((g) => g.endsWith("M")) && <Group label="Media">{grades.filter((g) => g.endsWith("M")).map(curso)}</Group>}

          {hayBloqueados && (
            <p style={{
              display: "flex", gap: 8, alignItems: "flex-start", textAlign: "left",
              maxWidth: 560, margin: "0 auto", padding: "11px 14px", borderRadius: 13,
              background: avisado ? C.warnBg : C.panel2, color: avisado ? C.warnTx : C.dim,
              border: `1.5px solid ${avisado ? C.warnTx : C.border}`,
              fontSize: 13, lineHeight: 1.5,
            }}>
              <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconLock size={14} /></span>
              <span>
                <strong>{avisado ? `${gradeLabel(avisado)} todavía no está abierto. ` : "Los cursos con candado todavía no están abiertos. "}</strong>
                {MOTIVO_CURSO_BLOQUEADO}
              </span>
            </p>
          )}

          <div style={{ marginTop: 26 }}>
            <BigBtn disabled={!grade} onClick={() => onDone({ username: initial?.username ?? "", grade })}>
              {initial ? "Guardar" : "Crear mi panel"} <IconArrow size={17} />
            </BigBtn>
            {grade && (
              <p style={{ color: C.dim, fontSize: 12.5, marginTop: 10 }}>
                {cuantas} {cuantas === 1 ? "materia" : "materias"} de {gradeLabel(grade)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * CURSO CERRADO — lo que ve quien YA tenía 1º a 5º en su perfil.
 *
 * Existe porque el bloqueo llegó después que las cuentas: el curso pudo quedar
 * elegido de antes o haberlo puesto el CLI del colegio. Sin esta pantalla, ese
 * alumno entraría a un panel sin materias y con "no hay material cargado" — que
 * dice algo falso (el material está) y lo deja creyendo que se rompió.
 *
 * Se le ofrecen las dos salidas honestas: cambiar de curso, si se equivocó al
 * elegir, y salir de la cuenta. No hay una tercera: entrar igual no es una
 * opción que el panel pueda dar.
 */
export function CursoCerrado({ grade, onEdit, onLogout }: { grade: string; onEdit: () => void; onLogout: () => void }) {
  return (
    <Centered>
      <div style={{ width: "min(500px, 100%)", background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 20, boxShadow: HARD(C.sun), padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, background: C.warnBg, color: C.warnTx, display: "grid", placeItems: "center" }}>
            <IconLock size={22} />
          </span>
        </div>
        <h1 style={{ margin: "0 0 8px", fontFamily: FONT.round, fontWeight: 800, fontSize: 22 }}>
          {gradeLabel(grade)} todavía no está abierto
        </h1>
        <p style={{ color: C.dim, fontSize: 14.5, lineHeight: 1.55, margin: "0 0 22px" }}>
          {MOTIVO_CURSO_BLOQUEADO} Cuando abra, tu cuenta te espera tal cual.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <BigBtn onClick={onEdit}>Me equivoqué de curso <IconSwap size={16} /></BigBtn>
          <button onClick={onLogout}
            style={{ background: C.panel, color: C.dim, border: `2px solid ${C.border}`, borderRadius: 14, padding: "13px 18px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5 }}>
            Salir
          </button>
        </div>
      </div>
    </Centered>
  );
}

// --- Panel del alumno (mundo Bloques) ---

/**
 * LA CÁSCARA: nav a la izquierda, contenido a la derecha.
 *
 * La comparten el panel y "Reforzar" —y la va a compartir lo que venga— porque
 * si cada pantalla armara su propio marco, la barra terminaría con anchos y
 * márgenes distintos según en cuál estés, que es la forma más rápida de que un
 * nav deje de sentirse como el mismo nav.
 */
export function PanelShell({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <style>{NAV_CSS}</style>
      <div className="pnl">
        {nav}
        <div className="pnl-main">{children}</div>
      </div>
    </div>
  );
}

/**
 * LA BARRA — dos formas de estudiar y una de reforzar, no un índice.
 *
 * Antes listaba las materias una por una y era redundante: las mismas cinco
 * estaban tres centímetros a la derecha, en tarjetas que además muestran el
 * avance y las tres actividades. Una lista que repite lo que se ve al lado no
 * navega, decora.
 *
 * Sabe SOLA dónde está parada (`usePathname`) en vez de recibirlo: es la única
 * forma de que agregar una pantalla nueva no obligue a acordarse de pasarle un
 * `activo` desde cada una.
 */
export function PanelNav({ profile, pendientes, teacher, onEdit, onLogout }: {
  profile: Profile; pendientes: number; teacher?: boolean; onEdit: () => void; onLogout: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [configAbierta, setConfigAbierta] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const enPanel = pathname === "/";
  const enReforzar = pathname === "/reforzar";
  const enApuntes = pathname === "/apuntes";
  const enPerfil = pathname === "/perfil";
  const enResumen = pathname === "/resumen";

  return (
    <aside className="pnl-aside">
      {/* LA IDENTIDAD ES UN BOTÓN: lleva al perfil, que es donde viven los
          logros y la elección del avatar. Y es el ÚNICO lugar donde se dicen el
          usuario y el curso — el saludo del panel ya no los repite. */}
      <button onClick={() => router.push("/perfil")} title="Tu perfil"
        className="pnl-yo pnl-yo-ancho" aria-current={enPerfil ? "page" : undefined}
        style={{
          background: enPerfil ? C.panel : "none",
          border: `1.5px solid ${enPerfil ? C.border : "transparent"}`,
          borderRadius: 12, cursor: "pointer", font: "inherit", color: C.text, textAlign: "left",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.panel; e.currentTarget.style.borderColor = C.border; }}
        onMouseLeave={(e) => { if (enPerfil) return; e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent"; }}>
        <Avatar id={profile.avatar} size={38} />
        <span className="pnl-solo-ancho" style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: FONT.round, fontSize: 15.5, fontWeight: 800, letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile.username || "Hola"}
          </span>
          <span style={{ display: "block", color: C.dim, fontSize: 12.5 }}>{gradeLabel(profile.grade)}</span>
        </span>
      </button>

      <div className="pnl-grupo pnl-grupo-principal">
        {/* PRIMERO, arriba de las materias: al entrar, lo que el alumno quiere
            saber es cómo viene —qué lleva hecho y qué le sale— y recién después
            elegir dónde ponerse. Antes iba en el medio, como paso entre "dónde
            estudio" y "qué me falta". */}
        <NavItem activo={enResumen} icono={<IconResumen size={15} />} corto="Resumen"
          onClick={() => router.push("/resumen")}>
          Tu resumen
        </NavItem>
        <NavItem activo={enPanel} icono={<IconBook size={15} />} corto="Materias"
          // Estando en el panel, baja a las tarjetas; desde otra pantalla, vuelve.
          onClick={() => (enPanel
            ? document.getElementById("mis-materias")?.scrollIntoView({ behavior: "smooth", block: "start" })
            : router.push("/"))}>
          Tus materias
        </NavItem>
        {/* El número al costado y no adentro de la pantalla: si hay nueve temas
            fallados, que se vean desde acá es la mitad del motivo para entrar.
            Sin nada pendiente no se dibuja: un "0" es ruido. */}
        <NavItem activo={enReforzar} icono={<IconReforzar size={15} />}
          chip={pendientes > 0 ? (
            <span style={{ background: C.badBg, color: C.badTx, borderRadius: 999, minWidth: 21, padding: "1px 7px", textAlign: "center", fontFamily: FONT.round, fontSize: 11.5, fontWeight: 800 }}>
              {pendientes}
            </span>
          ) : undefined}
          onClick={() => router.push("/reforzar")}>
          Reforzar
        </NavItem>
        {/* Va ÚLTIMA de las tres: las dos de arriba trabajan sobre el libro del
            curso, que es lo que el alumno tiene siempre; esta arranca cuando él
            trae algo suyo. Es una maqueta y lo dice adentro, no acá: un renglón
            del nav que se disculpa no se puede ni tocar para ver qué era. */}
        <NavItem activo={enApuntes} icono={<IconSpark size={15} />} corto="Apuntes"
          onClick={() => router.push("/apuntes")}>
          Repasá con tus apuntes
        </NavItem>
      </div>

      {/* El empujón: en columna manda las acciones al pie, en fila las manda al
          final de la tira. Es la misma regla leída en los dos sentidos. */}
      <div className="pnl-espacio" style={{ flex: 1 }} />

      <div className="pnl-grupo pnl-pie">
        {teacher && (
          <NavItem onClick={() => router.push("/docente")} icono={<IconUsers size={15} />}>
            Panel del curso
          </NavItem>
        )}
        {/* UNA sola entrada de ajustes. Antes eran dos renglones —"Voz del
            tutor" y "Mi curso"— que son la misma cosa: preferencias de la
            cuenta. El pie del nav es lo último que uno quiere leer, y tres
            renglones ahí compiten con las tres pantallas de arriba, que son a lo
            que el chico viene. */}
        <NavItem onClick={() => setConfigAbierta(true)} icono={<IconSettings size={15} />}>
          Configuración
        </NavItem>
        <NavItem onClick={onLogout} icono={<IconPuerta size={15} />}>Salir</NavItem>
      </div>

      {/* EL QUINTO DESTINO DE LA BARRA DE ABAJO.
          Es OTRO botón y no el mismo con un `if`: decidir por ancho en JS obliga
          a medir la ventana, y medir en JS pinta primero el layout equivocado.
          Acá los dos se renderizan siempre y el CSS muestra uno.
          Y hace otra cosa: en columna el avatar LLEVA al perfil, pero en la barra
          tiene que abrir el menú, porque Configuración y Salir no tienen dónde
          más vivir cuando el pie se esconde. */}
      <button onClick={() => setMenuAbierto(true)} title="Vos"
        className="pnl-item pnl-yo-angosto"
        style={{
          background: "none", border: "1.5px solid transparent", borderRadius: 11,
          cursor: "pointer", font: "inherit", color: C.text,
          fontFamily: FONT.round, fontWeight: 600, alignItems: "center",
        }}>
        <span className="pnl-icono" style={{ display: "flex" }}><Avatar id={profile.avatar} size={20} /></span>
        <span className="pnl-corto">Vos</span>
      </button>

      {menuAbierto && (
        <MenuAlumno profile={profile} teacher={teacher}
          onPerfil={() => { setMenuAbierto(false); router.push("/perfil"); }}
          onConfig={() => { setMenuAbierto(false); setConfigAbierta(true); }}
          onDocente={() => { setMenuAbierto(false); router.push("/docente"); }}
          onLogout={onLogout}
          onCerrar={() => setMenuAbierto(false)} />
      )}

      {configAbierta && (
        <Configuracion grade={profile.grade}
          onEditarCurso={() => { setConfigAbierta(false); onEdit(); }}
          onCerrar={() => setConfigAbierta(false)} />
      )}
    </aside>
  );
}

/**
 * LOS TEMAS PARA REFORZAR, AGRUPADOS POR MATERIA.
 *
 * De TODAS las materias —el alumno pudo rendir una prueba en cualquiera— y sin
 * las apagadas, porque mandarlo a repasar algo que no puede abrir es un
 * callejón sin salida.
 *
 * Las materias van ordenadas por cuánto pesa lo que falló (la suma de fallos),
 * no alfabéticamente: la primera tiene que ser la que más lo necesita. Adentro
 * de cada una manda el más fallado, que es el orden en que ya vienen de
 * `/api/progress`.
 */
export function agruparReforzar(subjects: Subject[], stats: Record<string, SubjectStats>) {
  return subjects
    .filter((s) => !s.disabled && (stats[s.id]?.weak.length ?? 0) > 0)
    .map((s) => ({ s, temas: stats[s.id]!.weak }))
    .sort((a, b) =>
      b.temas.reduce((n, w) => n + w.misses, 0) - a.temas.reduce((n, w) => n + w.misses, 0) ||
      subjectLabel(a.s).localeCompare(subjectLabel(b.s)));
}

/** Cuántos temas hay para reforzar en total. Va en la chapita del nav. */
export const contarReforzar = (subjects: Subject[], stats: Record<string, SubjectStats>) =>
  agruparReforzar(subjects, stats).reduce((n, m) => n + m.temas.length, 0);

export function Dashboard({ profile, subjects, stats, teacher, onAbrir, onEdit, onLogout }: { profile: Profile; subjects: Subject[]; stats: Record<string, SubjectStats>; teacher?: boolean; onAbrir: (id: string, a: Actividad) => void; onEdit: () => void; onLogout: () => void }) {
  // TODAS las materias del curso, con el mismo peso. Antes se partían en
  // "prioritarias" (tarjetas grandes) y "otras" (pastillas chicas al pie, sin
  // avance a la vista), según lo que el alumno hubiera tildado en el onboarding.
  // La premisa era falsa: cursa todas y ninguna es opcional.
  // Las desactivadas van al final pero SIGUEN a la vista: una materia que
  // desaparece y una que no existe se ven igual, y así hay que acordarse de
  // memoria de cuáles se apagaron.
  const misSubjects = subjects
    .filter((s) => s.grade === profile.grade)
    .sort((a, b) =>
      Number(!!a.disabled) - Number(!!b.disabled) ||
      subjectLabel(a).localeCompare(subjectLabel(b)));
  const apagadas = misSubjects.filter((s) => s.disabled).length;

  return (
    <PanelShell nav={<PanelNav profile={profile} pendientes={contarReforzar(subjects, stats)} teacher={teacher} onEdit={onEdit} onLogout={onLogout} />}>
      {/* CADA COSA SE DICE UNA VEZ. Acá decía "Hola, 7b-01 👋" y abajo "2° Medio
          · 6 materias · 1 en pausa", con el nav mostrando "7b-01 / 2° Medio" a
          tres centímetros: el usuario y el curso repetidos, uno al lado del
          otro. La identidad vive en el nav (que además es el botón al perfil);
          este encabezado saluda y cuenta lo que hay EN ESTA pantalla.
          El `hueco` es para el reloj flotante de la esquina. */}
      <header className={CLASE_HUECO_RELOJ} style={{ marginBottom: 26 }}>
        <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>¡Hola! 👋</div>
        {/* ⚠️ Las EN PAUSA se nombran en las dos ramas. Con la rama vacía muda,
            un curso con todas las materias pausadas decía "Todavía no tenés
            materias para estudiar" con las cuatro tarjetas dibujadas justo
            abajo: el encabezado contradiciendo a la pantalla. */}
        <div style={{ color: C.dim, fontSize: 14 }}>
          {misSubjects.length - apagadas === 0
            ? <>Todavía no tenés materias para estudiar{apagadas > 0 && ` · ${apagadas} en pausa`}</>
            : <>Tenés {misSubjects.length - apagadas} {misSubjects.length - apagadas === 1 ? "materia" : "materias"} para estudiar
                {apagadas > 0 && ` · ${apagadas} en pausa`}</>}
        </div>
      </header>

      {/* Esta pantalla es SOLO las materias. El reloj se mudó a la esquina
          superior (flota sobre todas), y "Para reforzar" se mudó a
          `/reforzar`: mezclado acá abajo, el alumno que venía a reforzar tenía
          que pasar por arriba de todo lo demás para llegar. */}

      <div id="mis-materias" style={{ scrollMarginTop: 14 }}>
        <SectionTitle icon={<IconStar size={15} />}>Tus materias</SectionTitle>
      </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16, marginBottom: 36 }}>
          {misSubjects.map((s) => <SubjectCard key={s.id} s={s} st={stats[s.id]} onAbrir={(a) => onAbrir(s.id, a)} />)}

          {misSubjects.length === 0 && (
            <p style={{ color: C.dim, fontSize: 14 }}>
              Todavía no hay material cargado para {gradeLabel(profile.grade)}. Tocá el engranaje si te equivocaste de curso.
            </p>
          )}
        </div>

    </PanelShell>
  );
}


/**
 * EL NAV LATERAL — y por qué necesita CSS de verdad y no estilos en línea.
 *
 * Todo el resto del panel se pinta con `style={{}}`, que alcanza mientras el
 * diseño no dependa del ANCHO. Este sí: la misma barra es una columna a la
 * izquierda en el computador y una tira horizontal arriba en el teléfono, y eso
 * es una media query — algo que un objeto de estilos no puede expresar. La
 * alternativa (medir la ventana en JS y re-renderizar) pinta primero el layout
 * equivocado y después salta.
 *
 * En angosto NO se esconde detrás de un botón de hamburguesa: son cuatro o
 * cinco materias, entran en una tira que se desliza, y un menú que hay que
 * abrir para ver qué hay adentro es un toque de más en la pantalla donde el
 * chico ya sabe a qué vino.
 */
const NAV_CSS = `
/* 248 y no 232: "Repasá con tus apuntes" entraba justo por fuera y se cortaba
   en "Repasá con tus apunt…". Un nav con puntos suspensivos obliga a adivinar
   qué hay del otro lado. */
.pnl { display: grid; grid-template-columns: 248px minmax(0, 1fr); align-items: start; }
.pnl-aside {
  position: sticky; top: 0; align-self: start;
  display: flex; flex-direction: column; gap: 16px;
  /* border-box explícito: la app no tiene reset de CSS, así que por defecto el
     padding SE SUMA al alto y "100dvh + 40" dejaba "Salir" 40px abajo del
     borde inferior de la pantalla, dentro de un scroll que nadie iba a buscar. */
  box-sizing: border-box;
  height: 100dvh; overflow-y: auto; padding: 20px 14px;
  background: ${C.panel2}; border-right: 1.5px solid ${C.border};
}
.pnl-yo { display: flex; align-items: center; gap: 10px; padding: 6px 8px; flex-shrink: 0; width: 100%; }
@media (max-width: 880px) { .pnl-yo { width: auto; } }
.pnl-grupo { display: flex; flex-direction: column; gap: 3px; }
.pnl-rotulo {
  color: ${C.dim}; font-family: ${FONT.round}; font-weight: 700; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.9px; padding: 4px 10px 4px;
}
/* CENTRADO y con más aire que 900px.
   El tope existe para que una línea de texto no cruce media pantalla, y eso
   sigue valiendo. Lo que estaba mal era que el sobrante caía TODO del lado
   derecho: medido a 1366px, el contenido terminaba a los 1192 y quedaban 174px
   de vacío pegados a un costado, que se lee como un layout roto y no como un
   margen.
   1040 y no 900: a 1180-1366 (una tablet en horizontal) 900 deja el hueco
   grande y encima corta la grilla en 3 columnas cuando entrarían 4. Con 1040
   entran las cuatro y el sobrante se reparte a los dos lados. */
.pnl-main { padding: 26px 22px 60px; max-width: 1040px; margin: 0 auto; width: 100%; box-sizing: border-box; }

/* En columna, la etiqueta larga; la corta no existe. */
.pnl-corto { display: none; }
/* En columna el avatar es el de arriba; el de la barra no existe. */
.pnl-yo-angosto { display: none; }

/* ── ANGOSTO: LA BARRA SE VA ABAJO ──────────────────────────────────────────
   Antes acá la barra se acostaba arriba con overflow-x: auto, y ése era el
   problema: MEDIDO a 375px se veían 1,5 opciones de 6, el resto vivía en un
   scroll horizontal sin ninguna señal de que existiera, y el reloj flotante
   —que vive arriba a la derecha— tapaba lo poco que asomaba. Un nav cuyas
   opciones hay que descubrir deslizando no es un nav.

   Abajo y fija se resuelven las tres cosas de una: entran las cinco sin
   deslizar, el pulgar llega, y deja de pelear con el reloj por el borde
   superior. Es además el patrón que el alumno ya conoce de cualquier app del
   teléfono, así que no hay nada que aprender. */
@media (max-width: 880px) {
  .pnl { grid-template-columns: minmax(0, 1fr); }
  .pnl-aside {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 40;
    height: auto; overflow: visible;
    flex-direction: row; align-items: stretch; gap: 0;
    /* Centrada: con el tope de ancho por celda, en una tablet las cinco no
       llenan los 820px y pegadas a la izquierda dejaban un vacío raro a la
       derecha. Centradas se leen como un grupo, no como una fila truncada. */
    justify-content: center;
    padding: 6px 4px;
    /* La franja de gestos del iPhone se come el último renglón de cualquier
       barra pegada al borde. env() vale 0 donde no hay muesca. */
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
    background: ${C.panel2};
    border-right: none; border-top: 1.5px solid ${C.border};
  }
  /* Los dos grupos se funden en UNA sola fila repartida: en columna el hueco
     elástico manda las acciones al pie, y acá ese mismo hueco no tiene sentido
     porque no hay "pie". */
  .pnl-espacio { display: none; }
  /* flex: 4 y no 1. El grupo lleva CUATRO destinos y el avatar es UNO; con
     ambos en flex:1 se repartían mitad y mitad, así que las cuatro primeras
     celdas medían un octavo cada una y "Vos" flotaba solo en media pantalla.
     Con 4 contra 1, las cinco celdas miden lo mismo. */
  .pnl-grupo { flex-direction: row; gap: 0; flex: 4 1 0; min-width: 0; }
  /* Cada destino se lleva su parte del ancho: cinco iguales, sin que el texto
     más largo empuje a los demás. */
  .pnl-grupo > * { flex: 1 1 0; min-width: 0; }
  .pnl-item {
    flex-direction: column; gap: 3px; padding: 7px 2px 5px; justify-content: center;
  }
  /* Etiqueta CORTA: "Repasá con tus apuntes" no entra en un quinto de 375px, y
     recortada con ellipsis obliga a adivinar. */
  .pnl-largo { display: none; }
  .pnl-corto { display: block; font-size: 10.5px; line-height: 1.15; text-align: center; }
  .pnl-icono { flex-shrink: 0; }
  /* EL CONTADOR PASA A SER UNA INSIGNIA EN LA ESQUINA DEL ICONO.
     Al costado del texto rompía el ancho de la celda; centrado encima lo TAPABA
     — medido: el chip iba de x=13 a x=56 y el icono de 29 a 44, o sea lo cubría
     entero. Tiene que verse el número Y verse de qué es.
     Va arriba a la derecha, apenas montado sobre el icono, que es donde el ojo
     ya busca un contador. */
  .pnl-chip { position: absolute; top: 1px; left: 50%; margin-left: 3px; padding: 0; }
  /* Los estilos EN LÍNEA del chip (minWidth 21, padding 1px 7px, 11.5px) le
     ganan a la hoja, así que acá hace falta !important. Es la misma trampa que
     el hueco del reloj: en línea vs hoja gana el de línea, y no es negociable
     desde el CSS sin esto. */
  .pnl-chip > * {
    min-width: 15px !important; padding: 0 4px !important;
    font-size: 9.5px !important; line-height: 15px !important;
    /* El aro del color de la barra despega la insignia del icono: sin él, los
       dos trazos oscuros se tocan y se leen como una sola mancha. */
    box-shadow: 0 0 0 2px ${C.panel2};
  }
  .pnl-solo-ancho, .pnl-rotulo { display: none; }
  .pnl-yo { width: auto; padding: 0; justify-content: center; }
  /* El avatar es el QUINTO destino, así que va último. Con la propiedad order y
     no reordenando el DOM: en columna el nombre y el curso son lo primero que se
     lee, y moverlos en el HTML se lo cambiaría al lector de pantalla también. */
  .pnl-yo-ancho { display: none; }
  .pnl-yo-angosto { display: flex; order: 2; flex: 1 1 0; min-width: 0; }
  /* La barra no se estira sin límite en tablet: pasados los 560px, cinco celdas
     repartidas en todo el ancho dejan los iconos tan separados que dejan de
     leerse como un grupo. */
  .pnl-aside > * { max-width: 132px; }
  .pnl-grupo { max-width: 528px; }
  .pnl-grupo-principal { order: 1; }
  /* Configuración, Salir y el panel del docente no caben como celdas propias:
     serían 8 destinos en 375px. Viven adentro del menú del avatar. */
  .pnl-pie { display: none; }
  /* El contenido termina ARRIBA de la barra. Sin esto, la última tarjeta queda
     debajo y no hay forma de tocarla. */
  .pnl-main { padding: 20px 14px calc(86px + env(safe-area-inset-bottom, 0px)); }
}
`;

/** Un renglón del nav. Mismo componente en columna y en fila: lo único que
 *  cambia con el ancho es el contenedor, no el ítem. */
function NavItem({ children, corto, icono, chip, onClick, disabled, title, activo }: {
  children: React.ReactNode;
  /** La etiqueta de la barra INFERIOR (angosto). Sin ella se usa la larga —
   *  válido solo para las que ya son de una palabra, como "Reforzar". */
  corto?: string;
  icono: React.ReactNode; chip?: React.ReactNode;
  onClick?: () => void; disabled?: boolean; title?: string; activo?: boolean;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title}
      aria-current={activo ? "page" : undefined}
      className="pnl-item"
      style={{
        display: "flex", alignItems: "center", gap: 9, flexShrink: 0, position: "relative",
        background: activo ? C.panel : "none",
        border: `1.5px solid ${activo ? C.border : "transparent"}`, borderRadius: 11,
        // Apagado = MEDIA TINTA, no el gris del borde: con `C.border` el
        // renglón desaparecía del fondo y "todavía no está" se leía igual que
        // "no existe".
        color: C.text, opacity: disabled ? 0.42 : 1, padding: "8px 10px",
        cursor: disabled ? "default" : "pointer", textAlign: "left",
        fontFamily: FONT.round, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = C.panel; e.currentTarget.style.borderColor = C.border; } }}
      // El que YA está activo no vuelve a "apagarse" al sacar el mouse: si el
      // hover se lo borra, el renglón de la pantalla en la que estás parpadea.
      onMouseLeave={(e) => { if (activo) return; e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent"; }}>
      <span className="pnl-icono" style={{ display: "flex", flexShrink: 0, color: activo ? C.accent : C.dim }}>{icono}</span>
      <span className="pnl-largo" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {/* La corta solo existe en la barra de abajo (ver NAV_CSS). Se renderiza
          SIEMPRE y la esconde el CSS, en vez de decidir con JS: medir la ventana
          en JavaScript pinta primero el layout equivocado y después salta. */}
      <span className="pnl-corto">{corto ?? children}</span>
      {/* El contador va como HERMANO de la etiqueta, no adentro. Metido adentro
          del mismo `span` —que no es flex— su `margin-left: auto` no hacía nada
          y el número quedaba pegado a la palabra: "Reforzar(9)". Acá sí empuja
          hasta el borde. */}
      {chip != null && <span className="pnl-chip" style={{ marginLeft: "auto", paddingLeft: 8, display: "flex", flexShrink: 0 }}>{chip}</span>}
    </button>
  );
}

/**
 * Tarjeta de materia = bloque con borde de tinta + sombra dura de su color.
 *
 * Si la materia está EN PAUSA se dibuja igual pero apagada: sin sombra dura,
 * en gris y sin reaccionar al mouse. Se muestra —en vez de esconderla— porque
 * una materia ausente y una inexistente se ven idénticas, y el alumno (o el
 * profe probando) no tiene forma de saber que Matemática existe y va a volver.
 * El candado dice que es temporal; el 404 de /api/plan y /api/test es lo que
 * realmente impide usarla.
 */
/** Las tres actividades de una materia. Siguen siendo tres rutas: lo que cambió
 *  es por dónde se entra a cada una desde el panel. */
export type Actividad = "camino" | "chat" | "prueba";

/**
 * LOS DOS BOTONES DEL PIE. "Preguntar" ya no está acá: ES LA TARJETA.
 *
 * Eran tres botones abajo y el cuerpo de la tarjeta llevaba al camino, o sea que
 * el camino tenía dos entradas y preguntar una. Ahora hay tres accesos y cada
 * uno abre una cosa distinta: la tarjeta abre el chat, y los dos botones del pie
 * abren el camino y la prueba. Menos botones y ninguna repetida.
 */
const ACCIONES = [
  { clave: "camino", label: "Camino", icono: (n: number) => <IconCamino size={n} /> },
  { clave: "prueba", label: "Prueba", icono: (n: number) => <IconPrueba size={n} /> },
] as const;

/**
 * La tarjeta de una materia: TRES ACCESOS, uno por actividad.
 *
 *   el cuerpo  → preguntarle al tutor        (lo más frecuente: una duda)
 *   Camino     → el recorrido de la materia
 *   Prueba     → la simulación de prueba
 *
 * Antes eran tres botones abajo Y el cuerpo llevaba al camino: el camino tenía
 * dos puertas y preguntar una, escondida entre las tres chiquitas del pie. Que
 * la tarjeta misma abra el chat es lo que hace que la fila de abajo tenga solo
 * lo que no es obvio.
 *
 * ⚠️ Por eso la tarjeta es un `div` y no un `button`: un botón adentro de otro
 * botón es HTML inválido, y el navegador lo "arregla" sacando el de adentro —
 * las acciones dejarían de existir sin que nada avise. El cuerpo es su propio
 * botón, hermano de los otros dos.
 */
export function SubjectCard({ s, st, onAbrir }: { s: Subject; st?: SubjectStats; onAbrir: (a: Actividad) => void }) {
  const off = !!s.disabled;
  const col = off ? C.border : subjectColor(s);
  const onCol = isLight(col) ? C.ink : "#fff";
  // `total` ya NO se dibuja —la barra de avance se fue de la tarjeta— pero
  // sigue decidiendo si hay camino que abrir.
  const total = st?.planTotal ?? 0;
  const weak = st?.weak.length ?? 0;
  // Sin lecciones no hay camino que recorrer: el libro de esa materia no dio un
  // índice legible. Se apaga la acción en vez de llevar a una pantalla vacía.
  const sinCamino = total === 0;

  return (
    <div
      style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", background: off ? C.panel2 : C.panel, color: off ? C.dim : C.text, border: `2px solid ${off ? C.border : C.ink}`, borderRadius: 16, boxShadow: off ? "none" : HARD(col), transition: "transform .13s, box-shadow .13s" }}
      onMouseEnter={(e) => { if (off) return; e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = `6px 6px 0 0 ${col}`; }}
      onMouseLeave={(e) => { if (off) return; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = HARD(col); }}>
      {!off && <div style={{ position: "absolute", top: -14, right: -14, width: 34, height: 34, borderRadius: "50%", background: col }} />}

      {/* EL CUERPO ABRE EL CHAT, y hoy no lo dice NADA a la vista: la línea con
          el orbe que lo anunciaba se sacó a pedido, junto con la barra de
          avance. Queda como deuda conocida — en el teléfono, que es donde no
          hay `title` que valga, el gesto se descubre tocando.

          El `aria-label` NO es decoración: sin él el botón se anuncia
          "Biología" a secas —el nombre accesible sale del contenido— y quien
          navega con lector de pantalla o con teclado escucha tres botones por
          tarjeta, el primero sin propósito. Es la mitad del problema que se
          puede arreglar sin volver a poner nada en pantalla. */}
      <button onClick={off ? undefined : () => onAbrir("chat")} disabled={off}
        aria-label={off ? `${subjectLabel(s)}: en pausa` : `${subjectLabel(s)}: preguntarle al tutor`}
        title={off ? "Esta materia está en pausa" : `Preguntale al tutor sobre ${subjectLabel(s)}`}
        // `flex: 1` para que el cuerpo se coma el alto sobrante y EMPUJE las
        // acciones al fondo. Las tarjetas se estiran a la altura de la más alta
        // (grid), pero sin esto el bloque de acciones queda pegado al contenido:
        // "Lengua Y Literatura" —título de una línea y sin chapa de refuerzo—
        // dejaba un hueco de ~100 px debajo de sus botones, y las tres filas de
        // acciones quedaban a alturas distintas.
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, textAlign: "left", background: "none", border: "none", color: "inherit", padding: "16px 16px 12px", cursor: off ? "default" : "pointer", font: "inherit" }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: col, color: onCol, display: "grid", placeItems: "center", position: "relative" }}>
          {off ? <IconLock size={18} /> : <IconBook size={20} />}
        </span>
        <span style={{ fontFamily: FONT.round, fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{subjectLabel(s)}</span>

        {off && (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: C.panel, color: C.dim, border: `1.5px solid ${C.border}`, borderRadius: 999, padding: "3px 10px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
              <IconLock size={11} /> En pausa
            </span>
            <span style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.45 }}>
              Todavía no está disponible. Tu avance se guarda para cuando vuelva.
            </span>
          </>
        )}

        {/* Acá vivían la BARRA DE AVANCE ("3 de 6 temas · 50% · ¡Completo!") y la
            línea con el orbe que decía "Preguntale lo que quieras". Las dos se
            fueron: la tarjeta es un ACCESO, no un tablero. El avance sigue vivo
            donde se puede hacer algo con él —adentro del camino, que lo muestra
            grande y arriba de todo— y en el panel del docente.

            `margin-top: auto` en lo que sigue, para que las chapas queden al pie
            del cuerpo y todas las tarjetas de la fila las alineen a la misma
            altura aunque el título ocupe una o dos líneas. */}
        {!off && (weak > 0 || st?.lastScore) && (
          <span style={{ marginTop: "auto", paddingTop: 4, display: "flex", flexWrap: "wrap", gap: 6, position: "relative" }}>
            {weak > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.badBg, color: C.badTx, border: `1.5px solid ${C.badTx}`, borderRadius: 999, padding: "2px 8px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
                <IconReforzar size={11} /> {weak} para reforzar
              </span>
            )}
            {st?.lastScore && (() => {
              // El color sigue a la nota: un 0/6 en verde leía como logro.
              const t = scoreTone(st.lastScore.total > 0 ? st.lastScore.score / st.lastScore.total : 0);
              return (
                <span style={{ background: t.bg, color: t.tx, border: `1.5px solid ${t.tx}`, borderRadius: 999, padding: "2px 8px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
                  Prueba: {st.lastScore.score}/{st.lastScore.total}
                </span>
              );
            })()}
          </span>
        )}
      </button>

      {/* LOS DOS ACCESOS RESTANTES. Con etiqueta y no solo el ícono: un chico de
          13 no tiene por qué saber que un portapapeles significa "prueba". */}
      {!off && (
        <div style={{ display: "flex", flexShrink: 0, borderTop: `1.5px solid ${C.border}`, position: "relative" }}>
          {ACCIONES.map((a, i) => {
            const apagada = a.clave === "camino" && sinCamino;
            return (
              <button key={a.clave} onClick={() => !apagada && onAbrir(a.clave)} disabled={apagada}
                title={apagada ? "Esta materia todavía no tiene camino" : a.label}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 3,
                  padding: "9px 4px 10px", background: "none", border: "none",
                  borderLeft: i === 0 ? "none" : `1.5px solid ${C.border}`,
                  color: apagada ? C.border : C.dim, cursor: apagada ? "default" : "pointer",
                }}
                onMouseEnter={(e) => { if (!apagada) e.currentTarget.style.color = col; }}
                onMouseLeave={(e) => { if (!apagada) e.currentTarget.style.color = C.dim; }}>
                {a.icono(18)}
                <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11 }}>{a.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Acá vivía WeakCard, el renglón de un tema fallado. Murió con el rediseño de
// /reforzar: los temas ahora viven ADENTRO de la tarjeta de su materia, y el
// renglón entero es el botón — una chapa "Reforzar" adentro de otro botón
// invitaba a apuntarle a la chapa.

// --- Simulación de prueba (mundo Panel · bloques) ---

/**
 * CONFIGURACIÓN — lo único que el alumno puede ajustar de su cuenta.
 *
 * Junta lo que antes eran dos renglones sueltos al pie del nav ("Voz del tutor"
 * y "Mi curso"): las dos son preferencias, y el pie del nav tiene que competir
 * lo menos posible con las pantallas de arriba, que son a lo que el chico viene.
 *
 * El AVATAR no está acá: vive en el perfil, con los logros, porque no es un
 * ajuste — es su cara. Y no hay nada más para configurar a propósito: las
 * cuentas son anónimas y no hay datos que editar.
 */
/**
 * EL MENÚ DEL AVATAR — solo existe en la barra de abajo (pantallas angostas).
 *
 * Recoge lo que en columna vive en el pie del nav: el perfil, la configuración,
 * el panel del docente y salir. En 375px esos cuatro no pueden ser celdas
 * propias —serían ocho destinos en una barra— y tampoco pueden desaparecer:
 * "Salir" tiene que estar siempre a un toque.
 *
 * Sube desde abajo y no aparece en el centro: nace del botón que lo abrió, que
 * está en el borde inferior, y así el pulgar queda sobre las opciones en vez de
 * tener que subir a la mitad de la pantalla.
 *
 * ⚠️ VA EN UN PORTAL AL BODY, como el modal de Configuración y por lo mismo: la
 * barra es `position: fixed` con z-index, o sea que CREA UN CONTEXTO DE
 * APILAMIENTO. Un menú dibujado adentro solo puede competir contra sus
 * hermanos, y subirle el z-index no sirve porque el techo lo pone el ancestro.
 */
function MenuAlumno({ profile, teacher, onPerfil, onConfig, onDocente, onLogout, onCerrar }: {
  profile: Profile; teacher?: boolean;
  onPerfil: () => void; onConfig: () => void; onDocente: () => void;
  onLogout: () => void; onCerrar: () => void;
}) {
  const fila = (icono: React.ReactNode, texto: string, onClick: () => void) => (
    <button onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 11, width: "100%",
        background: "none", border: "none", borderRadius: 12, padding: "13px 12px",
        cursor: "pointer", font: "inherit", color: C.text, textAlign: "left",
        fontFamily: FONT.round, fontWeight: 600, fontSize: 15,
      }}>
      <span style={{ display: "flex", color: C.dim }}>{icono}</span>
      {texto}
    </button>
  );

  const hoja = (
    <div onClick={onCerrar}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(25,22,33,.34)",
        display: "flex", alignItems: "flex-end",
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", background: C.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          borderTop: `2px solid ${C.ink}`, padding: "10px 12px",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
        }}>
        {/* El tirador: dice "esto se arrastra o se toca afuera para cerrar" sin
            gastar un renglón en un botón de cerrar. */}
        <div aria-hidden style={{ width: 38, height: 4, borderRadius: 999, background: C.border, margin: "2px auto 10px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "4px 12px 12px" }}>
          <Avatar id={profile.avatar} size={40} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: FONT.round, fontSize: 16, fontWeight: 800 }}>
              {profile.username || "Hola"}
            </span>
            <span style={{ display: "block", color: C.dim, fontSize: 13 }}>{gradeLabel(profile.grade)}</span>
          </span>
        </div>
        <div style={{ height: 1, background: C.border, margin: "0 0 6px" }} />
        {fila(<IconUser size={17} />, "Tu perfil", onPerfil)}
        {teacher && fila(<IconUsers size={17} />, "Panel del curso", onDocente)}
        {fila(<IconSettings size={17} />, "Configuración", onConfig)}
        {fila(<IconPuerta size={17} />, "Salir", onLogout)}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(hoja, document.body);
}

function Configuracion({ grade, onEditarCurso, onCerrar }: {
  grade: string; onEditarCurso: () => void; onCerrar: () => void;
}) {
  const [elegida, setElegida] = useState<string>(VOZ_POR_DEFECTO);
  const [probando, setProbando] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Del PERFIL, no del navegador: en una sala de computación todos comparten
    // el navegador, y la preferencia es del alumno.
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setElegida(j?.profile?.ttsVoice ?? VOZ_POR_DEFECTO))
      .catch(() => { /* se queda con la de defecto */ });
    // Al salir, que no quede una prueba sonando sobre el panel.
    return () => { audio.current?.pause(); };
  }, []);

  function elegir(id: string) {
    setElegida(id);   // la pantalla responde ya; el guardado va detrás
    void fetch("/api/me/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttsVoice: id }),
    }).catch(() => { /* si falla, sigue la voz anterior en el próximo turno */ });
  }

  async function probar(v: Voz) {
    audio.current?.pause();
    setProbando(v.id);
    try {
      // `probar` y no `voz`: el servidor usa la voz del PERFIL salvo que le
      // pidan explícitamente una prueba. El campo se llamaba `voz` y la ruta lo
      // ignoraba en silencio desde que la voz se mudó al perfil — los cinco
      // botones sonaban con la misma, que es lo contrario de un probador.
      const r = await fetch("/api/voice/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: MUESTRA, probar: v.id }),
      });
      if (!r.ok) return;
      const a = new Audio(URL.createObjectURL(await r.blob()));
      audio.current = a;
      a.onended = () => setProbando(null);
      await a.play();
    } catch { /* si no suena, el botón vuelve solo */ }
    finally { setProbando((p) => (p === v.id ? null : p)); }
  }

  /**
   * ⚠️ VA EN UN PORTAL AL `body`, y no donde está escrito.
   *
   * Este modal lo abre el nav, que vive adentro de `.pnl-aside` — y ese aside es
   * `position: sticky`. Sticky CREA UN CONTEXTO DE APILAMIENTO aunque su
   * `z-index` sea `auto`, así que el `z-index: 60` de acá abajo solo competía
   * DENTRO del aside: las tarjetas de materia, que vienen después en el DOM y
   * son `position: relative`, le pintaban encima. Se veía el modal con Biología
   * y Matemática flotando arriba, ilegible.
   *
   * Subir el z-index no arregla nada —el techo lo pone el ancestro— y sacarle el
   * sticky al nav costaría la barra fija. El portal lo saca del contexto: un
   * modal no tiene por qué depender de en qué rincón del árbol lo montaron.
   */
  const modal = (
    <div onClick={onCerrar}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(25,22,33,.45)", display: "grid", placeItems: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: HARD(C.ink), padding: 20, width: "min(520px, 100%)", maxHeight: "86dvh", overflowY: "auto" }}>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 19, marginBottom: 18 }}>Configuración</div>

        {/* TU CURSO. Es lo que decide qué material se le sirve, así que va
            primero y dice en qué curso está — cambiarlo a ciegas desde un
            renglón que solo decía "Mi curso" era fácil de hacer sin querer. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 13, padding: "12px 14px", marginBottom: 20 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5 }}>Tu curso</span>
            <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 1 }}>
              Estás en {gradeLabel(grade)}
            </span>
          </span>
          <button onClick={onEditarCurso}
            style={{ flexShrink: 0, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5 }}>
            Cambiar
          </button>
        </div>

        {/* LA VOZ, con su botón de PROBAR: elegir una voz sin escucharla es
            elegir a ciegas, y entrar a una materia solo para oír una frase hace
            que nadie las compare nunca. Acá se prueban las cinco seguidas. */}
        <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5 }}>La voz del tutor</div>
        <div style={{ color: C.dim, fontSize: 12.5, marginTop: 2, marginBottom: 12, lineHeight: 1.45 }}>
          Probá y elegí. El tiempo es lo que tarda en empezar a hablar.
        </div>

        <div style={{ display: "grid", gap: 9 }}>
          {VOCES.map((v) => {
            const sel = v.id === elegida;
            return (
              <div key={v.id}
                style={{ display: "flex", alignItems: "center", gap: 11, background: sel ? "rgba(43,68,255,.06)" : C.panel, border: `2px solid ${sel ? C.accent : C.border}`, borderRadius: 13, padding: "11px 13px" }}>
                <button onClick={() => elegir(v.id)} aria-pressed={sel} title={`Usar ${v.nombre}`}
                  style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}>
                  <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: "50%", border: `2px solid ${sel ? C.accent : C.border}`, background: sel ? C.accent : "transparent", color: "#fff", display: "grid", placeItems: "center" }}>
                    {sel && <IconCheck size={13} />}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5 }}>{v.nombre}</span>
                    <span style={{ display: "block", color: C.dim, fontSize: 12.5, lineHeight: 1.35 }}>{v.detalle}</span>
                  </span>
                </button>
                <button onClick={() => void probar(v)} disabled={probando === v.id} title={`Escuchar ${v.nombre}`}
                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: C.panel2, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: probando === v.id ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5 }}>
                  {probando === v.id ? <Dots /> : <><IconVolume size={13} /> Probar</>}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 18, textAlign: "center" }}>
          <BigBtn onClick={onCerrar}>Listo</BigBtn>
        </div>
      </div>
    </div>
  );

  // El guard es por el prerender: `document` no existe del lado del servidor.
  // En la práctica este componente solo se monta tras un clic, pero un `null`
  // barato vale más que confiar en que eso no cambie nunca.
  return typeof document === "undefined" ? null : createPortal(modal, document.body);
}

/** Frase de prueba: la que diría el tutor de verdad, con pregunta al final. */
const MUESTRA =
  "Mirá, la célula es la unidad más pequeña que puede vivir sola. ¿Se te ocurre algo tan chico que solo se vea con microscopio?";
