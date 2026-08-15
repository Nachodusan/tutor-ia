"use client";
/**
 * EL RELOJ DE ESTUDIO (pomodoro) — un bloque, un descanso, y otra vez.
 *
 * Por qué vive en el LAYOUT RAÍZ y no en el panel: el alumno arranca el bloque
 * en el panel y a los diez segundos está en el chat de Biología. Si el reloj
 * fuera un componente del panel, se desmontaría al navegar y el descanso no
 * llegaría nunca — justo el descanso, que es la mitad del punto. Montado arriba
 * de todo, sobrevive a cualquier navegación del cliente.
 *
 * Y por qué el estado vive en `localStorage` y no en la base: el segundero. Un
 * tick por segundo contra Postgres son 3.600 escrituras por hora por alumno
 * para un dato que no le importa a nadie más que a esta pestaña. Lo que SÍ va a
 * la base es la CONFIGURACIÓN (`/api/me/profile`) — eso es del chico, no del
 * aparato — y el sello de "arrancó un bloque hoy", que es lo que apaga el
 * recordatorio.
 *
 * ⚠️ El tiempo se calcula con MARCAS DE FIN (`finEn`, epoch ms), no restando
 * un contador en cada tick. El navegador ralentiza los `setInterval` de las
 * pestañas en segundo plano —que es exactamente donde está esta pestaña cuando
 * el chico se fue a buscar agua—, así que un contador propio atrasaría minutos.
 * Con una marca de fin, el reloj vuelve exacto aunque no haya corrido ni un tick.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  C, FONT, FLOAT, HARD, BigBtn, IconClock, IconX, IconCheck, IconArrow,
} from "./ui";
import {
  DIAS_LABEL, HORA_RE, OPCIONES_DESCANSO, OPCIONES_ESTUDIO, POMODORO_DEFAULT,
  limpiarDias, minutosLegibles, reloj, tocaEstudiar, yaArrancoHoy,
  type PomodoroConfig,
} from "@/lib/pomodoro";

type Fase = "estudio" | "descanso";

interface Sesion {
  fase: Fase;
  /** Epoch ms en que termina la fase. */
  finEn: number;
  /** Ms que faltaban cuando se pausó. null = corriendo. */
  pausaRestante: number | null;
  /** Bloques de ESTUDIO completos en esta sentada. Es lo que se le muestra. */
  bloques: number;
}

const CLAVE = "tutor_pomodoro";

interface PomodoroApi {
  cfg: PomodoroConfig;
  guardar: (cambio: Partial<PomodoroConfig>) => void;
  /** ¿Es su hora de estudiar y todavía no arrancó hoy? */
  recordatorio: boolean;
  yaEstudioHoy: boolean;
  fase: Fase | null;
  restanteMs: number;
  pausado: boolean;
  bloques: number;
  empezar: () => void;
  pausar: () => void;
  terminar: () => void;
  /** Saltar lo que falta de la fase actual y pasar a la siguiente. */
  saltar: () => void;
}

const Ctx = createContext<PomodoroApi | null>(null);

/** El reloj, para cualquier pantalla. `null` si no hay provider (no debería). */
export function usePomodoro(): PomodoroApi | null {
  return useContext(Ctx);
}

export function PomodoroProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [cfg, setCfg] = useState<PomodoroConfig>(POMODORO_DEFAULT);
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [aviso, setAviso] = useState<null | "descanso" | "vuelta">(null);
  const audio = useRef<AudioContext | null>(null);
  const tituloOriginal = useRef<string>("");

  // El login no tiene alumno: pedir el perfil ahí es un 401 garantizado.
  const enLogin = pathname?.startsWith("/login") ?? false;

  useEffect(() => {
    if (enLogin) return;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.profile) return;
        setCfg({ ...POMODORO_DEFAULT, ...j.profile.pomodoro });
        setLastAt(j.profile.pomodoroLastAt ? new Date(j.profile.pomodoroLastAt) : null);
      })
      .catch(() => { /* sin red, el reloj anda igual con los valores clásicos */ });
  }, [enLogin]);

  // Rescate del bloque en curso tras un F5. En un efecto y no en el `useState`
  // inicial: leer localStorage durante el render rompe la hidratación (el
  // servidor no tiene localStorage y pinta otra cosa).
  useEffect(() => {
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return;
      const s = JSON.parse(crudo) as Sesion;
      // Una sesión vencida hace rato (la pestaña estuvo cerrada toda la noche)
      // no se resucita: el chico ya no está estudiando.
      if (s.pausaRestante == null && Date.now() > s.finEn + 60 * 60_000) {
        localStorage.removeItem(CLAVE);
        return;
      }
      setSesion(s);
    } catch { /* Safari en privado tira al tocar localStorage */ }
  }, []);

  useEffect(() => {
    try {
      if (sesion) localStorage.setItem(CLAVE, JSON.stringify(sesion));
      else localStorage.removeItem(CLAVE);
    } catch { /* idem */ }
  }, [sesion]);

  // El segundero solo corre si hay algo que contar.
  useEffect(() => {
    if (!sesion || sesion.pausaRestante != null) return;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sesion]);

  // El recordatorio ("es tu hora") depende del reloj de pared, no de la sesión:
  // sin este tick lento, el panel abierto desde las 16:50 nunca se entera de que
  // dieron las 17:00.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const sonar = useCallback((subiendo: boolean) => {
    const ctx = audio.current;
    if (!ctx) return;
    // Dos tonos cortos, no una alarma: el chico puede estar en la sala de
    // computación con treinta más. Sube al volver, baja al ir al descanso.
    const notas = subiendo ? [587.33, 880] : [880, 587.33];
    notas.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.26;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.3);
    });
  }, []);

  // FIN DE FASE. El estudio pasa SOLO al descanso (si no, el chico sigue de
  // largo y el reloj no sirvió de nada); el descanso NO pasa solo al estudio,
  // porque el que vuelve del baño se encontraría con cinco minutos ya gastados.
  useEffect(() => {
    if (!sesion || sesion.pausaRestante != null || ahora < sesion.finEn) return;
    if (sesion.fase === "estudio") {
      setSesion({
        fase: "descanso",
        finEn: Date.now() + cfg.descansoMin * 60_000,
        pausaRestante: null,
        bloques: sesion.bloques + 1,
      });
      setAviso("descanso");
      sonar(false);
    } else {
      setSesion(null);
      setAviso("vuelta");
      sonar(true);
    }
  }, [ahora, sesion, cfg.descansoMin, sonar]);

  // La cuenta regresiva en la PESTAÑA. El chico se va a otra pestaña —o a otra
  // app— y el título es lo único suyo que sigue a la vista.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!tituloOriginal.current) tituloOriginal.current = document.title;
    if (!sesion) { document.title = tituloOriginal.current; return; }
    const falta = sesion.pausaRestante ?? sesion.finEn - ahora;
    document.title = `${reloj(falta)} · ${sesion.fase === "estudio" ? "Estudio" : "Descanso"}`;
  }, [sesion, ahora]);

  const arrancarFase = useCallback((fase: Fase) => {
    // El AudioContext se crea acá y no antes: el navegador solo deja crearlo
    // (y sonar) a partir de un gesto del usuario, y este es el gesto.
    if (!audio.current) {
      try {
        audio.current = new AudioContext();
      } catch { /* sin audio el reloj sigue andando, mudo */ }
    }
    void audio.current?.resume?.();
    const min = fase === "estudio" ? cfg.estudioMin : cfg.descansoMin;
    setSesion((s) => ({
      fase, finEn: Date.now() + min * 60_000, pausaRestante: null, bloques: s?.bloques ?? 0,
    }));
    setAhora(Date.now());
  }, [cfg.estudioMin, cfg.descansoMin]);

  const empezar = useCallback(() => {
    arrancarFase("estudio");
    setAviso(null);
    // Se sella en el perfil para que el recordatorio de hoy se calle. Si falla,
    // lo peor que pasa es que el panel insista una vez más.
    const t = new Date();
    setLastAt(t);
    void fetch("/api/me/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pomodoroIniciado: true }),
    }).catch(() => { /* el bloque ya arrancó igual */ });
  }, [arrancarFase]);

  const pausar = useCallback(() => {
    setSesion((s) => {
      if (!s) return s;
      return s.pausaRestante != null
        ? { ...s, finEn: Date.now() + s.pausaRestante, pausaRestante: null }
        : { ...s, pausaRestante: Math.max(0, s.finEn - Date.now()) };
    });
    setAhora(Date.now());
  }, []);

  const terminar = useCallback(() => { setSesion(null); setAviso(null); }, []);

  const saltar = useCallback(() => {
    setAviso(null);
    setSesion((s) => {
      if (!s) return s;
      if (s.fase === "estudio") {
        return { fase: "descanso", finEn: Date.now() + cfg.descansoMin * 60_000, pausaRestante: null, bloques: s.bloques + 1 };
      }
      return { fase: "estudio", finEn: Date.now() + cfg.estudioMin * 60_000, pausaRestante: null, bloques: s.bloques };
    });
    setAhora(Date.now());
  }, [cfg.descansoMin, cfg.estudioMin]);

  const guardar = useCallback((cambio: Partial<PomodoroConfig>) => {
    const nuevo = { ...cfg, ...cambio };
    if (typeof nuevo.dias === "string") nuevo.dias = limpiarDias(nuevo.dias);
    setCfg(nuevo);   // la pantalla responde ya; el guardado va detrás
    void fetch("/api/me/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pomodoro: nuevo }),
    }).catch(() => { /* queda en memoria; se reintenta al próximo cambio */ });
  }, [cfg]);

  const restanteMs = sesion ? (sesion.pausaRestante ?? Math.max(0, sesion.finEn - ahora)) : 0;
  const api: PomodoroApi = {
    cfg, guardar,
    recordatorio: !sesion && tocaEstudiar(cfg, lastAt, new Date(ahora)),
    yaEstudioHoy: yaArrancoHoy(lastAt, new Date(ahora)),
    fase: sesion?.fase ?? null,
    restanteMs,
    pausado: !!sesion && sesion.pausaRestante != null,
    bloques: sesion?.bloques ?? 0,
    empezar, pausar, terminar, saltar,
  };

  return (
    <Ctx.Provider value={api}>
      {/* Va siempre, aunque el reloj no se dibuje: la clase del hueco la usan
          encabezados que se montan antes de que este árbol decida si hay reloj. */}
      <style>{RELOJ_CSS}</style>
      {children}
      {/* EL RELOJ VIVE ACÁ, no en cada pantalla: el alumno tiene que poder ver
          cuánto le queda mientras lee el camino, mientras le pregunta al tutor y
          mientras rinde la prueba. En el login no —no hay alumno todavía— y en
          el panel del docente tampoco: ahí no se estudia, se revisa. */}
      {!enLogin && !(pathname?.startsWith("/docente") ?? false) && <RelojFlotante />}
      {aviso && <AvisoDeFase que={aviso} cfg={cfg} bloques={sesion?.bloques ?? 0}
        onCerrar={() => setAviso(null)} onSeguir={() => { arrancarFase("estudio"); setAviso(null); }}
        onSaltar={saltar} onTerminar={terminar} />}
    </Ctx.Provider>
  );
}

/**
 * EL AVISO DE CAMBIO DE FASE — modal, y a propósito.
 *
 * Un cartelito en la esquina no interrumpe nada, y interrumpir es justamente lo
 * que se le pidió al reloj: el chico que no para en dos horas es el que después
 * no rinde. Tapa la pantalla hasta que dice "listo".
 */
function AvisoDeFase({ que, cfg, bloques, onCerrar, onSeguir, onSaltar, onTerminar }: {
  que: "descanso" | "vuelta"; cfg: PomodoroConfig; bloques: number;
  onCerrar: () => void; onSeguir: () => void; onSaltar: () => void; onTerminar: () => void;
}) {
  const descanso = que === "descanso";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(25,22,33,.5)", display: "grid", placeItems: "center", padding: 18 }}>
      <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 20, boxShadow: HARD(descanso ? C.ok : C.accent), padding: 24, width: "min(440px, 100%)", textAlign: "center" }}>
        <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>{descanso ? "🌿" : "💪"}</div>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>
          {descanso ? "Terminaste un bloque" : "Se acabó el descanso"}
        </div>
        <p style={{ color: C.dim, fontSize: 14.5, lineHeight: 1.55, margin: "8px 0 20px" }}>
          {descanso
            ? <>Van {bloques} {bloques === 1 ? "bloque" : "bloques"} de hoy. Ahora {minutosLegibles(cfg.descansoMin)} de descanso: parate, tomá agua, mirá algo lejos. Yo te aviso.</>
            : <>¿Vamos con otro bloque de {minutosLegibles(cfg.estudioMin)}?</>}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {descanso ? (
            <>
              <BigBtn onClick={onCerrar}>Dale <IconCheck size={16} /></BigBtn>
              <button onClick={onSaltar} style={secundario}>Saltar el descanso</button>
            </>
          ) : (
            <>
              <BigBtn onClick={onSeguir}>Otro bloque <IconArrow size={16} /></BigBtn>
              <button onClick={onTerminar} style={secundario}>Terminé por hoy</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const secundario: React.CSSProperties = {
  background: C.panel, color: C.dim, border: `2px solid ${C.border}`, borderRadius: 14,
  padding: "13px 18px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5,
};

/**
 * EL HUECO DEL RELOJ — pónganle esta clase a lo que tenga cosas propias arriba
 * a la derecha (el encabezado de la materia con sus dos actividades, el saludo
 * del panel).
 *
 * Un elemento `fixed` no empuja a nadie: si el encabezado no le reserva el
 * lugar, el reloj se le sienta encima. Es el precio de flotar, y se paga acá
 * —en un lugar, con el mismo número que usa el reloj— en vez de con un choque
 * que aparece recién en el teléfono de alguien.
 */
export const CLASE_HUECO_RELOJ = "reloj-hueco";

/**
 * En pantalla angosta el reloj se queda SOLO CON EL ANILLO.
 *
 * El encabezado de la materia ya se reparte entre la flecha de volver, el
 * nombre del libro y dos actividades; sumarle "24:36" dejaba el título en
 * "Ciencia…". Y no se pierde lo que importa: lo que se pidió fue que el chico
 * "vaya viendo más o menos qué tiempo le queda", y eso es exactamente lo que
 * dice un anillo que se vacía. El número exacto está a un toque, adentro.
 */
const RELOJ_CSS = `
.reloj-hueco { padding-right: 128px; }
.reloj-txt { font-family: ${FONT.mono}; font-size: 13.5px; font-weight: 600; letter-spacing: -0.2px; }
@media (max-width: 560px) {
  .reloj-hueco { padding-right: 68px; }
  .reloj-txt { display: none; }
}
`;

/**
 * EL RELOJ, ARRIBA A LA DERECHA, EN TODAS LAS PANTALLAS DEL ALUMNO.
 *
 * Antes era un chip incrustado en dos encabezados y una tarjeta en el panel:
 * tres piezas para una sola idea, y el reloj desaparecía justo donde más falta
 * hace —adentro de la prueba— porque esa pantalla no tenía ni chip ni tarjeta.
 *
 * Cerrado es un anillo que se vacía: el tiempo se LEE de un vistazo, sin
 * leer números. Abierto es el tablero entero (arrancar, pausar, saltar,
 * terminar, ajustar la rutina), que es lo que reemplaza a la tarjeta.
 */
function RelojFlotante() {
  const p = usePomodoro();
  const [abierto, setAbierto] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  if (!p) return null;

  const activo = !!p.fase;
  const estudio = p.fase === "estudio";
  const col = p.recordatorio ? C.sun : !activo ? C.dim : estudio ? C.accent : C.ok;
  // Cuánto queda del tramo, de 0 a 1. El total sale de la CONFIG, así que si el
  // alumno acorta el bloque en el medio el anillo se recalcula solo.
  const totalMs = (estudio ? p.cfg.estudioMin : p.cfg.descansoMin) * 60_000;
  const queda = activo ? Math.min(1, Math.max(0, p.restanteMs / totalMs)) : 1;

  return (
    <>
      {/* Manto para cerrar tocando afuera. Transparente y sin bloquear el
          scroll: es una cortina de clics, no un modal. */}
      {abierto && <div onClick={() => setAbierto(false)} style={{ position: "fixed", inset: 0, zIndex: 69 }} />}

      <div style={{ position: "fixed", top: 10, right: 12, zIndex: 70, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        <button onClick={() => setAbierto((v) => !v)}
          title={activo ? `${estudio ? "Estudio" : "Descanso"} · ${reloj(p.restanteMs)}` : "Tu tiempo de estudio"}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: C.panel, border: `1.5px solid ${activo || p.recordatorio ? col : C.border}`,
            borderRadius: 999, padding: "5px 12px 5px 6px", cursor: "pointer",
            boxShadow: FLOAT, color: C.text,
          }}>
          <Anillo queda={queda} color={p.pausado ? C.dim : col} size={26}>
            {!activo && <IconClock size={12} color={C.dim} />}
          </Anillo>
          <span className="reloj-txt" style={{ color: p.pausado ? C.dim : C.text }}>
            {activo ? reloj(p.restanteMs) : minutosLegibles(p.cfg.estudioMin)}
          </span>
        </button>

        {abierto && (
          <div style={{ width: 236, background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: FLOAT, padding: 16, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
              <Anillo queda={queda} color={p.pausado ? C.dim : col} size={104} grosor={7}>
                <span style={{ fontFamily: FONT.mono, fontSize: 23, fontWeight: 600, letterSpacing: -0.6, color: p.pausado ? C.dim : C.text }}>
                  {activo ? reloj(p.restanteMs) : `${p.cfg.estudioMin}:00`}
                </span>
              </Anillo>
            </div>

            <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 15.5 }}>
              {activo ? (p.pausado ? "En pausa" : estudio ? "Estudiando" : "Descanso") : "Tu tiempo de estudio"}
            </div>
            <div style={{ color: p.recordatorio ? C.warnTx : C.dim, fontSize: 12.5, lineHeight: 1.45, margin: "3px 0 13px", fontWeight: p.recordatorio ? 700 : 400 }}>
              {activo
                ? <>{p.bloques > 0 && <>{p.bloques} {p.bloques === 1 ? "bloque hecho" : "bloques hechos"} · </>}{estudio ? `después, ${minutosLegibles(p.cfg.descansoMin)}` : "parate y mirá lejos"}</>
                : p.recordatorio
                  ? "¡Es tu hora de estudiar!"
                  : p.cfg.hora
                    ? <>{p.yaEstudioHoy ? "Hoy ya arrancaste. " : ""}Tu hora: {p.cfg.hora}</>
                    : <>{minutosLegibles(p.cfg.estudioMin)} y {minutosLegibles(p.cfg.descansoMin)} de descanso</>}
            </div>

            {activo ? (
              <div style={{ display: "grid", gap: 6 }}>
                <button onClick={p.pausar} style={botonReloj(true)}>{p.pausado ? "Seguir" : "Pausar"}</button>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={p.saltar} style={{ ...botonReloj(false), flex: 1 }}>
                    {estudio ? "Al descanso" : "A estudiar"}
                  </button>
                  <button onClick={() => { p.terminar(); setAbierto(false); }} title="Terminar la sesión"
                    style={{ ...botonReloj(false), flexShrink: 0 }}>
                    <IconX size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => { p.empezar(); setAbierto(false); }} style={{ ...botonReloj(true), width: "100%" }}>
                Empezar <IconArrow size={15} />
              </button>
            )}

            <button onClick={() => { setAjustes(true); setAbierto(false); }}
              style={{ display: "block", margin: "10px auto 0", background: "none", border: "none", color: C.dim, cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, textDecoration: "underline" }}>
              Ajustar mi rutina
            </button>
          </div>
        )}
      </div>

      {ajustes && <AjustesPomodoro cfg={p.cfg} onGuardar={p.guardar} onCerrar={() => setAjustes(false)} />}
    </>
  );
}

/**
 * EL ANILLO — el tiempo como forma, no como número.
 *
 * SVG y no un `conic-gradient`: el degradado cónico no se puede animar suave ni
 * redondear las puntas, y acá el trazo se acorta un segundo por vez. Empieza
 * arriba (de ahí el giro de -90°) porque un reloj que arranca a las 3 en punto
 * no se lee como un reloj.
 */
function Anillo({ queda, color, size, grosor = 3, children }: {
  queda: number; color: string; size: number; grosor?: number; children?: React.ReactNode;
}) {
  const r = (size - grosor) / 2;
  const vuelta = 2 * Math.PI * r;
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "grid", placeItems: "center" }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={grosor} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={grosor} strokeLinecap="round"
          strokeDasharray={vuelta} strokeDashoffset={vuelta * (1 - queda)}
          style={{ transition: "stroke-dashoffset .95s linear, stroke .2s" }} />
      </svg>
      <span style={{ position: "relative", display: "flex" }}>{children}</span>
    </span>
  );
}

const botonReloj = (primario: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: primario ? C.accent : C.panel2, color: primario ? "#fff" : C.dim,
  border: `1.5px solid ${primario ? C.ink : C.border}`, borderRadius: 11,
  padding: "9px 14px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5,
});

/** "L a V" cuando son corridos; si no, las iniciales. "" = ningún día. */
export function diasLegibles(dias: string): string {
  if (!dias) return "sin días fijos";
  if (dias === "12345") return "de lunes a viernes";
  if (dias === "1234567") return "todos los días";
  return dias.split("").map((d) => DIAS_LABEL[d]).join(" ");
}

function AjustesPomodoro({ cfg, onGuardar, onCerrar }: {
  cfg: PomodoroConfig; onGuardar: (c: Partial<PomodoroConfig>) => void; onCerrar: () => void;
}) {
  const [estudioMin, setEstudio] = useState(cfg.estudioMin);
  const [descansoMin, setDescanso] = useState(cfg.descansoMin);
  const [hora, setHora] = useState(cfg.hora ?? "");
  const [dias, setDias] = useState(cfg.dias);

  const horaValida = hora === "" || HORA_RE.test(hora);

  function guardar() {
    if (!horaValida) return;
    onGuardar({ estudioMin, descansoMin, hora: hora === "" ? null : hora, dias });
    onCerrar();
  }

  return (
    <div onClick={onCerrar}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(25,22,33,.45)", display: "grid", placeItems: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: HARD(C.ink), padding: 20, width: "min(520px, 100%)", maxHeight: "86dvh", overflowY: "auto" }}>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 19 }}>Tu rutina de estudio</div>
        <div style={{ color: C.dim, fontSize: 13.5, marginTop: 3, marginBottom: 16, lineHeight: 1.45 }}>
          Estudiás un rato, parás un rato, y volvés. Elegí cuánto dura cada uno.
        </div>

        <Campo label="Cuánto estudio de corrido">
          {OPCIONES_ESTUDIO.map((m) => (
            <Opcion key={m} activa={m === estudioMin} onClick={() => setEstudio(m)}>{m} min</Opcion>
          ))}
        </Campo>

        <Campo label="Cuánto descanso">
          {OPCIONES_DESCANSO.map((m) => (
            <Opcion key={m} activa={m === descansoMin} onClick={() => setDescanso(m)}>{m} min</Opcion>
          ))}
        </Campo>

        <Campo label="A qué hora me siento a estudiar">
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
            style={{ background: C.panel, color: C.text, border: `1.5px solid ${horaValida ? C.ink : C.bad}`, borderRadius: 999, padding: "8px 14px", fontFamily: FONT.round, fontWeight: 600, fontSize: 14.5 }} />
          {hora !== "" && (
            <button onClick={() => setHora("")} style={{ ...botonReloj(false), borderRadius: 999, padding: "8px 14px" }}>Sin horario</button>
          )}
        </Campo>

        <Campo label="Qué días">
          {["1", "2", "3", "4", "5", "6", "7"].map((d) => (
            <Opcion key={d} activa={dias.includes(d)}
              onClick={() => setDias(limpiarDias(dias.includes(d) ? dias.replace(d, "") : dias + d))}>
              {DIAS_LABEL[d]}
            </Opcion>
          ))}
        </Campo>

        <p style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.5, margin: "4px 0 16px" }}>
          {hora
            ? <>Te voy a recordar a las {hora}, {diasLegibles(dias)}. El recordatorio aparece en el panel: no te van a llegar notificaciones.</>
            : <>Sin hora no hay recordatorio, pero podés arrancar el reloj cuando quieras.</>}
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <BigBtn onClick={guardar} disabled={!horaValida}>Guardar</BigBtn>
          <button onClick={onCerrar} style={secundario}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>{children}</div>
    </div>
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={activa}
      style={{ minWidth: 44, background: activa ? "rgba(43,68,255,.10)" : C.panel, color: activa ? C.accent : C.text, border: `1.5px solid ${activa ? C.accent : C.ink}`, borderRadius: 999, padding: "8px 14px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14 }}>
      {children}
    </button>
  );
}
