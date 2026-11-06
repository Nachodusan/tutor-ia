"use client";
/**
 * EL CHAT — página propia.
 *
 * Antes era la pantalla por defecto de la materia y el camino se dibujaba
 * encima. Ahora es una de las tres actividades, al mismo nivel que las otras.
 *
 * Se llega de dos formas y las dos importan:
 *  · Desde la pestaña "Preguntar", con el chat en blanco.
 *  · Desde una lección ("No entiendo esto") o desde un resultado de la prueba
 *    ("Estudiar esto"), con la pregunta ya armada en la URL. En ese caso se
 *    manda sola al abrir: el alumno ya dijo lo que quería al tocar el botón, y
 *    hacerlo escribirlo de nuevo sería cobrarle dos veces.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Bubble, VozLuces, estadoVoz } from "../../../chat-ui";
import { C, CTA, FONT, FLOAT, SOFT, Dots, IconSend, IconWave, IconVolume, IconVolumeOff, IconCalculadora, subjectLabel, HARD, IconArrow, ANCHO, IconHistorial } from "../../../ui";
import { HistorialChats, useHistorial, HISTORIAL_CSS } from "../../../historial-chats";
import { TecladoMate, esMatematica } from "../../../teclado-mate";
import { esEjercicio } from "@tutor-ia/core/mate";
import { TarjetaEjercicioView, type Tarjeta } from "../../../tarjeta-ejercicio";
import { traerMateria } from "../../../datos";
import { turnoNuevo, turnoPaso, turnoTermino, interrupcionPaso, hayInterrupcion } from "../../../voz-turno";
import { cleanTutorText } from "../../../limpiar-texto";
import type { CallState, Msg, Subject } from "../../../tipos";

/**
 * Cuándo termina un turno y cuándo te están interrumpiendo: en `voz-turno.ts`,
 * como funciones puras. Vivía acá adentro del bucle de animación, donde no hay
 * forma de probarlo — el bucle ni siquiera corre con la pestaña en segundo
 * plano. Ahora las reglas se prueban con trazas de audio sintéticas
 * (`test/voz-turno.test.mjs`), incluida la que motivó todo esto: la pausa para
 * pensar que se leía como final de la idea.
 */

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [foco, setFoco] = useState(false);   // el compositor se ilumina al escribir
  /** El teclado de símbolos. Solo existe en Matemática (ver `esMatematica`). */
  const [teclado, setTeclado] = useState(false);
  /** Dónde está el cursor dentro del campo. Lo necesita el visor del teclado
   *  para dibujar la barrita y para insertar EN EL MEDIO, que es lo que permite
   *  corregir un exponente sin borrar todo lo de atrás. */
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Dónde dejar el cursor DESPUÉS de que React pinte el valor nuevo.
   *
   * ⚠️ No alcanza con `requestAnimationFrame` desde el handler: el rAF puede
   * correr ANTES de que React confirme el value, así que el `setSelectionRange`
   * se aplicaba sobre el texto viejo y después el navegador mandaba el cursor
   * al final. Resultado: tocabas √ y el cursor quedaba FUERA del paréntesis,
   * justo lo que la tecla quería evitar.
   *
   * Es una marca y no un efecto sobre `cursor` a secas para no pisar al chico
   * cuando selecciona texto con el mouse: solo se aplica lo que pidió el teclado. */
  const cursorPendiente = useRef<number | null>(null);
  const mate = esMatematica(subject?.name);

  useEffect(() => {
    const pos = cursorPendiente.current;
    if (pos == null) return;
    cursorPendiente.current = null;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
  }, [question]);
  const sessionRef = useRef<string | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const arrancado = useRef(false);

  // ── EL HISTORIAL ─────────────────────────────────────────────────────────
  /**
   * `sessionRef` es un ref porque lo lee `send()` en medio del stream, donde un
   * estado llegaría viejo. Pero la lista necesita SABER cuál está abierta para
   * marcarla, y eso sí es estado. Los dos se mueven juntos por `fijarSesion`:
   * separarlos fue lo primero que se rompió (la fila marcada se quedaba en la
   * charla anterior mientras el chat ya estaba en otra).
   */
  const [sesionActiva, setSesionActiva] = useState<string | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [cargandoCharla, setCargandoCharla] = useState(false);
  const historial = useHistorial(subject?.id ?? (typeof id === "string" ? id : undefined));

  const fijarSesion = useCallback((sid: string | null) => {
    sessionRef.current = sid;
    setSesionActiva(sid);
  }, []);

  /** Abre una charla guardada. Los mensajes vienen de la base, no de memoria:
   *  el alumno puede volver semanas después y desde otro aparato. */
  const abrirCharla = useCallback(async (cid: string) => {
    if (cid === sessionRef.current) return;
    setCargandoCharla(true);
    try {
      const r = await fetch(`/api/conversations?id=${cid}`);
      if (!r.ok) return;
      const j = (await r.json()) as { messages: { role: string; content: string; citations: unknown; grounded: boolean | null; verification: unknown }[] };
      setMessages(j.messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
        citations: (m.citations as Msg["citations"]) ?? [],
        grounded: m.grounded ?? undefined,
        verification: (m.verification as Msg["verification"]) ?? null,
      })));
      fijarSesion(cid);
      // La cola de repaso pertenece a la charla que la abrió: arrastrarla a otra
      // haría aparecer "Seguir con el siguiente" en una conversación ajena.
      setRepaso([]); setPaso(0);
    } catch { /* si falla, el chat se queda donde estaba */ }
    finally { setCargandoCharla(false); }
  }, [fijarSesion]);

  /** Empezar de cero. Es lo que faltaba para que no se amontone todo en una. */
  const nuevaCharla = useCallback(() => {
    setMessages([]);
    fijarSesion(null);
    setRepaso([]); setPaso(0);
    setQuestion("");
    inputRef.current?.focus();
  }, [fijarSesion]);

  // ── VOZ ──────────────────────────────────────────────────────────────────
  // Se quedó afuera cuando el chat pasó a ser una ruta propia: son ~150 líneas
  // de MediaRecorder y AudioContext y moverlas de arrastre en un refactor de
  // navegación era la forma más rápida de romperlas sin darse cuenta. Vuelve
  // ahora, con su código tal cual estaba.
  const [ttsOn, setTtsOn] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const callRef = useRef(false);
  const levelRef = useRef(0);   // amplitud 0..1 para las luces de la barra
  /** Cómo callar al tutor mientras habla (interrupción y corte de llamada). */
  const cortarVozRef = useRef<(() => void) | null>(null);
  /** Lo que el chico va diciendo, mientras lo dice. Se limpia al mandarlo. */
  const [parcial, setParcial] = useState("");
  /**
   * EL REPASO EN FILA — los temas que el alumno falló en la prueba.
   *
   * Llegan por URL desde el resultado y el chat los recorre acá, sin que tenga
   * que volver a la prueba entre uno y otro. `paso` es cuál se está viendo.
   */
  const [repaso, setRepaso] = useState<{ t: string; u: number | null; l: number | null }[]>([]);
  const [paso, setPaso] = useState(0);
  const parcialEnVueloRef = useRef(false);

  // Salir de la página con el micrófono abierto deja la luz del micro prendida
  // y el AudioContext vivo. Se corta al desmontar, pase lo que pase.
  useEffect(() => () => { if (callRef.current) endCall(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Dos formas de cortar además del botón.
  //
  // Escape, porque terminar es UN botón —el mismo que arrancó— y sin salida de
  // teclado queda encerrado quien no puede tocarlo.
  //
  // Y IRSE DE LA PESTAÑA. Esto no es prolijidad: el detector de silencio corre
  // con requestAnimationFrame, que el navegador CONGELA en segundo plano. Sin
  // esto, cambiar de pestaña (o de app, en el teléfono) deja el micrófono
  // grabando sin fin y el turno no termina nunca — el chico se fue y la luz del
  // micro sigue prendida. Volver a hablar es un toque.
  useEffect(() => {
    if (callState === "idle") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") endCall(); };
    const onVis = () => { if (document.hidden) endCall(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [callState]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  /**
   * La lista se recarga cuando el tutor TERMINÓ de responder, no cuando empieza.
   * El contador de mensajes y la fecha salen de filas que `/api/chat` escribe
   * al cerrar el stream: pedirla antes devuelve la charla con un mensaje menos,
   * y la fila queda mintiendo hasta la próxima recarga.
   */
  const recargarHistorial = historial.recargar;
  useEffect(() => {
    if (loading || !sesionActiva) return;
    void recargarHistorial();
  }, [loading, sesionActiva, recargarHistorial]);
  // También con `parcial`: si no, lo que el chico está diciendo aparece debajo
  // del borde y hay que arrastrar para verlo.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, parcial]);

  useEffect(() => {
    void traerMateria(id).then(setSubject);
  }, [id]);

  // La pregunta que llega por URL se manda UNA vez. El guard es un ref y no un
  // estado a propósito: en dev StrictMode el efecto corre dos veces y con
  // estado el chico veía su pregunta duplicada.
  useEffect(() => {
    if (arrancado.current || !subject) return;

    // REPASO EN FILA: viene del resultado de la prueba con todos los temas que
    // falló. Se arranca por el primero; los demás esperan su turno acá mismo.
    const cola = params.get("repaso");
    if (cola) {
      try {
        const lista = JSON.parse(cola) as { t: string; u: number | null; l: number | null }[];
        const limpia = lista.filter((x) => x?.t).slice(0, 12);
        if (limpia.length > 0) {
          arrancado.current = true;
          setRepaso(limpia); setPaso(0);
          void send(preguntaDeRepaso(limpia[0]!.t, limpia.length), { unit: limpia[0]!.u, lesson: limpia[0]!.l });
          return;
        }
      } catch { /* si viene roto, sigue el camino normal de abajo */ }
    }

    const q = params.get("q");
    if (!q) return;
    arrancado.current = true;
    const u = params.get("unit"), l = params.get("lesson");
    void send(q, { unit: u ? Number(u) : null, lesson: l ? Number(l) : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  /**
   * Lo que se le pide al tutor por cada tema de la fila.
   *
   * Dice EXPLÍCITAMENTE que es un repaso de algo que falló en una prueba, y no
   * un "explicame X" a secas: el tutor tiene que empezar por lo que se
   * confunde, no por la introducción del capítulo. Y en el primero avisa cuántos
   * son, para que el alumno sepa en qué se está metiendo antes de arrancar.
   */
  function preguntaDeRepaso(tema: string, total: number): string {
    return (
      `Me fue mal en "${tema}" en una prueba y lo quiero repasar` +
      (total > 1 ? ` (es el primero de ${total} temas que voy a repasar)` : "") +
      `. Explicámelo desde el principio, simple y con un ejemplo, ` +
      `y al final preguntame algo para ver si me quedó claro.`
    );
  }

  /** El siguiente de la fila, sin salir del chat. */
  function siguienteRepaso() {
    const i = paso + 1;
    const t = repaso[i];
    if (!t || loading) return;
    setPaso(i);
    void send(
      `Listo con el anterior. Ahora repasemos "${t.t}", que también me fue mal. ` +
      `Igual que antes: desde el principio, simple y con un ejemplo.`,
      { unit: t.u, lesson: t.l },
    );
  }

  async function send(
    text?: string,
    topic?: { unit: number | null; lesson: number | null },
  ): Promise<string> {
    const q = (text ?? question).trim();
    if (!q || loading) return "";
    setLoading(true); setQuestion("");
    const sid = id;
    const subj = subject;
    const history = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", grounded: true, streaming: true }]);
    const patch = (p: Partial<Msg>) => setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], ...p } as Msg; return c; });
    let displayed = "";

    // MODO EJERCICIO PRIMERO, y solo si el turno tiene forma de ejercicio: la
    // detección es local y determinista (`esEjercicio`, sin llamadas), así que
    // una duda de materia no paga ni un milisegundo de más. El endpoint devuelve
    // 204 cuando no puede armar la tarjeta —un problema con enunciado, una
    // expresión que el CAS no parsea— y ahí seguimos por el chat de siempre.
    if (esMatematica(subj?.name) && esEjercicio(q)) {
      try {
        const re = await fetch("/api/ejercicio", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
        });
        if (re.ok && re.status !== 204) {
          const t = (await re.json()) as Tarjeta;
          patch({ tarjeta: t, content: "", streaming: false });
          setLoading(false);
          return "";
        }
      } catch { /* el chat de abajo se encarga */ }
    }

    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, subjectId: sid || null, subjectName: subj ? subjectLabel(subj) : null, history, ...(topic ? { unit: topic.unit, lesson: topic.lesson } : {}),
        sessionId: sessionRef.current }) });
      if (!res.body) { patch({ content: "Error: sin respuesta.", streaming: false }); return ""; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; let citationsParsed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (!citationsParsed && buffer.startsWith("\x1e")) {
          const nl = buffer.indexOf("\n");
          if (nl !== -1) {
            try {
              const meta = JSON.parse(buffer.slice(1, nl));
              // El servidor devuelve el id de la sesión que abrió. Se fija por
              // `fijarSesion` para que la fila del historial se marque sola en
              // el primer mensaje de una charla nueva.
              if (meta.sessionId) fijarSesion(meta.sessionId);
              patch({ citations: meta.citations ?? [], grounded: meta.grounded !== false, mode: meta.mode, scope: meta.scope });
            } catch { /* */ }
            buffer = buffer.slice(nl + 1); citationsParsed = true;
          }
        }
        if (citationsParsed) {
          const rs = buffer.indexOf("\x1e");
          if (rs === -1) { displayed = buffer; patch({ content: cleanTutorText(buffer) }); }
          else {
            displayed = buffer.slice(0, rs).trimEnd(); patch({ content: cleanTutorText(displayed) });
            const nl = buffer.indexOf("\n", rs);
            const frame = nl === -1 ? buffer.slice(rs + 1) : buffer.slice(rs + 1, nl);
            try {
              const meta = JSON.parse(frame);
              // El modo DEFINITIVO llega acá: el del primer frame es provisorio
              // (ahí solo se sabe si hubo material, todavía no si hubo deriva).
              patch({ ...(meta.verification ? { verification: meta.verification } : {}), ...(meta.mode ? { mode: meta.mode } : {}), ...(meta.scope ? { scope: meta.scope } : {}), ...(meta.temaLocal !== undefined ? { temaLocal: meta.temaLocal } : {}) });
            } catch { /* */ }
          }
        }
      }
      displayed = cleanTutorText(displayed);
      if (ttsOn && !callRef.current && displayed) void speak(displayed);
    } catch { patch({ content: "Error de red." }); }
    finally { patch({ streaming: false }); setLoading(false); }
    return displayed;
  }

  function speak(text: string): Promise<void> {
    return new Promise(async (resolve) => {
      if (!text.trim()) return resolve();
      try {
        audioRef.current?.pause();
        // La voz sale del PERFIL del alumno, del lado del servidor.
        const res = await fetch("/api/voice/tts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return resolve();
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url);
        audioRef.current = a;
        let raf = 0;
        const ctx = audioCtxRef.current;
        if (ctx) {
          try {
            await ctx.resume();
            const node = ctx.createMediaElementSource(a);
            const an = ctx.createAnalyser(); an.fftSize = 512;
            node.connect(an); an.connect(ctx.destination);
            const buf = new Uint8Array(an.fftSize);
            const loop = () => {
              an.getByteTimeDomainData(buf);
              let s = 0; for (let i = 0; i < buf.length; i++) s += Math.abs(buf[i]! - 128);
              levelRef.current = Math.min(1, s / buf.length / 26);
              raf = requestAnimationFrame(loop);
            };
            loop();
          } catch { /* */ }
        }
        let cerrado = false;
        const done = () => {
          if (cerrado) return;          // `pause()` + un `error` tardío llamarían dos veces
          cerrado = true;
          cancelAnimationFrame(raf); levelRef.current = 0;
          cortarVozRef.current = null;
          URL.revokeObjectURL(url); resolve();
        };
        a.onended = done; a.onerror = done;
        // CALLARLO DESDE AFUERA. `pause()` no dispara `ended`, así que sin esto
        // la promesa quedaba colgada para siempre y el turno no seguía nunca:
        // ni al interrumpir hablando, ni al cortar la llamada.
        cortarVozRef.current = () => { try { a.pause(); } catch { /* */ } done(); };
        await a.play();
      } catch { resolve(); }
    });
  }

  async function startCall() {
    try {
      // `echoCancellation` explícito y no `audio: true` a secas: el navegador
      // suele ponerlo por defecto, pero de esto depende que el tutor no se
      // interrumpa a sí mismo al escucharse por el parlante.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext(); audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      src.connect(analyser); analyserRef.current = analyser;
      callRef.current = true; listen();
    } catch { alert("No pude acceder al micrófono. Revisá los permisos."); }
  }

  /**
   * TRANSCRIPCIÓN EN VIVO, mientras el chico habla.
   *
   * Cada trozo que suelta el MediaRecorder se manda con TODOS los anteriores —
   * el primero lleva la cabecera del contenedor, así que solo la pila completa
   * es decodificable— y lo transcripto se muestra al pie de la conversación.
   *
   * Se hace con el whisper LOCAL, que tarda ~300 ms por cada 3 s de audio
   * (medido). La alternativa era el reconocedor del navegador, que es
   * instantáneo y gratis pero manda la voz de un menor a los servidores de
   * Google. No vale la pena: acá el audio no sale de la máquina.
   *
   * UNA sola transcripción en vuelo a la vez: si la anterior no volvió, este
   * trozo se saltea. Perder un parcial no se nota; encolarlos hace que el texto
   * llegue cada vez más tarde y termine contradiciendo lo que el chico ya dijo.
   */
  async function transcribirParcial(chunks: Blob[], mime: string, rec: MediaRecorder) {
    if (parcialEnVueloRef.current || chunks.length === 0) return;
    parcialEnVueloRef.current = true;
    try {
      const res = await fetch("/api/voice/stt", {
        method: "POST",
        body: new Blob(chunks, { type: mime || "audio/webm" }),
      });
      const t = (await res.json()).text?.trim() ?? "";
      // Entre que salió el pedido y volvió, el turno pudo haber terminado (o el
      // chico cortado la llamada). Un parcial que llega tarde reescribiría
      // texto viejo encima de "Pensando…", así que se descarta: solo vale si
      // sigue siendo EL MISMO grabador el que está escuchando.
      if (t && callRef.current && recRef.current === rec) setParcial(t);
    } catch { /* un parcial perdido no rompe nada */ }
    finally { parcialEnVueloRef.current = false; }
  }

  function listen() {
    if (!callRef.current || !streamRef.current || !analyserRef.current) return;
    setCallState("listening");
    setParcial("");
    const rec = new MediaRecorder(streamRef.current);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      // Con `rec.stop()` llega el último trozo: ahí NO se pide un parcial, que
      // la transcripción final ya viene en camino.
      if (rec.state === "recording") void transcribirParcial([...chunks], rec.mimeType, rec);
    };
    rec.onstop = () => handleUtterance(chunks, rec.mimeType);
    // 1,2 s de trozo: más corto y whisper transcribe pedazos de palabra; más
    // largo y el texto aparece tarde y deja de sentirse en vivo.
    recRef.current = rec; rec.start(1200);
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.fftSize);
    let turno = turnoNuevo();
    let ultimo = performance.now();
    const tick = () => {
      if (!callRef.current || recRef.current !== rec || rec.state !== "recording") return;
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]! - 128);
      const level = sum / data.length;
      levelRef.current = Math.min(1, level / 26);
      const now = performance.now();
      turno = turnoPaso(turno, level, now - ultimo);
      ultimo = now;
      if (turnoTermino(turno)) { levelRef.current = 0; rec.stop(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  /**
   * INTERRUMPIR AL TUTOR HABLÁNDOLE.
   *
   * Corre mientras el tutor habla: mira el MICRÓFONO (el analizador de la
   * llamada, que sigue conectado) y si hay voz sostenida, calla el audio. El
   * `await speak(...)` de arriba se destraba solo y el turno vuelve a escuchar.
   *
   * Por qué importa: cuando el detector de silencio corta una idea por la mitad,
   * el tutor contesta muy bien la pregunta equivocada. Sin esto había que
   * bancarse la explicación entera antes de poder aclarar.
   *
   * Se pierden los ~300 ms que tarda en confirmarse la interrupción (la primera
   * sílaba). Es el precio de no cortarse a sí mismo con el eco del parlante: con
   * confirmación inmediata, cualquier pico del propio audio lo callaba.
   */
  function vigilarInterrupcion(): () => void {
    const analyser = analyserRef.current;
    if (!analyser) return () => { /* sin micrófono no hay nada que vigilar */ };
    const data = new Uint8Array(analyser.fftSize);
    let sostenido = 0; let raf = 0; let vivo = true;
    let ultimo = performance.now();
    const tick = () => {
      if (!vivo || !callRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]! - 128);
      const level = sum / data.length;
      const now = performance.now();
      sostenido = interrupcionPaso(sostenido, level, now - ultimo);
      ultimo = now;
      if (hayInterrupcion(sostenido)) { cortarVozRef.current?.(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { vivo = false; cancelAnimationFrame(raf); };
  }

  function endCall() {
    callRef.current = false; cancelAnimationFrame(rafRef.current); levelRef.current = 0;
    try { if (recRef.current?.state === "recording") recRef.current.stop(); } catch { /* */ }
    // Callarlo por la misma puerta que la interrupción: `pause()` a secas dejaba
    // el `await speak(...)` colgado para siempre.
    if (cortarVozRef.current) cortarVozRef.current(); else audioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null; analyserRef.current = null; audioCtxRef.current = null;
    setParcial("");
    setCallState("idle");
  }

  async function handleUtterance(chunks: Blob[], mime: string) {
    if (!callRef.current) return;
    setCallState("thinking"); levelRef.current = 0; setParcial("");
    let text = "";
    try { const res = await fetch("/api/voice/stt", { method: "POST", body: new Blob(chunks, { type: mime || "audio/webm" }) }); text = (await res.json()).text?.trim() ?? ""; } catch { /* */ }
    if (!callRef.current) return;
    if (!text) { listen(); return; }
    const answer = await send(text);
    if (!callRef.current) return;
    setCallState("speaking");
    // El tutor habla y el micrófono sigue abierto escuchando por si lo cortás.
    const dejarDeVigilar = vigilarInterrupcion();
    await speak(answer);
    dejarDeVigilar();
    if (callRef.current) listen();
  }

  return (
    /* LA FILA: el historial al costado y la conversación al lado.
       Arriba de 1024 la columna se ve siempre; abajo la esconde la hoja y queda
       el cajón, que se abre con el botón de la barra de arriba. */
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <style>{HISTORIAL_CSS}</style>

      <HistorialChats
        charlas={historial.charlas}
        cargando={historial.cargando}
        activa={sesionActiva}
        abierto={historialAbierto}
        onCerrar={() => setHistorialAbierto(false)}
        onAbrir={(cid) => void abrirCharla(cid)}
        onNueva={nuevaCharla}
        onRenombrar={historial.renombrar}
        onBorrar={(cid) => {
          // Si borrás la que estás leyendo, la pantalla tiene que quedar en un
          // estado válido: sin esto el chat seguía mostrando los mensajes de una
          // charla que ya no existe y el próximo turno abría una sesión huérfana.
          if (cid === sessionRef.current) nuevaCharla();
          void historial.borrar(cid);
        }}
      />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", flex: 1, minWidth: 0 }}>
      {/* Leer en voz alta lo que el tutor responde, sin entrar en conversación:
          sirve para el que quiere escuchar mientras lee. También flota: es un
          control de la pantalla, no parte de la conversación. */}
      {/* LA FILA DEL REPASO. Sin esto el alumno no sabe que hay más temas
          esperando, y "reforzar todo" se sentiría igual que reforzar uno. */}
      {repaso.length > 1 && (
        <div style={{ background: C.panel2, borderBottom: `1px solid ${C.border}`, padding: "9px 16px" }}>
          <div style={{ maxWidth: ANCHO.lectura, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 13, color: C.text, minWidth: 0 }}>
                Repaso de la prueba · {paso + 1} de {repaso.length}
              </span>
              <span style={{ fontSize: 12, color: C.dim, flexShrink: 0 }}>
                {repaso.length - paso - 1 > 0 ? `faltan ${repaso.length - paso - 1}` : "último"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
              {repaso.map((_, i) => (
                <span key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i === paso ? C.accent : i < paso ? C.accentSoft : C.border }} />
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 16px 0" }}>
        {/* La puerta al historial en pantalla angosta. Arriba de 1024 la
            esconde la hoja, porque ahí la columna ya está a la vista y un botón
            que abre lo que ya se ve es ruido. */}
        <button className="hc-abrir" onClick={() => setHistorialAbierto(true)}
          aria-label="Ver tus conversaciones" title="Tus conversaciones"
          style={{ alignItems: "center", gap: 6, background: C.panel, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 999, padding: "7px 13px", fontSize: 12, fontFamily: FONT.round, fontWeight: 600, cursor: "pointer", boxShadow: SOFT, flexShrink: 0 }}>
          <IconHistorial size={14} /> Conversaciones
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setTtsOn((v) => !v)} title={ttsOn ? "Dejar de leer en voz alta" : "Leer las respuestas en voz alta"}
          aria-label={ttsOn ? "Dejar de leer en voz alta" : "Leer las respuestas en voz alta"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: ttsOn ? C.userBubble : C.panel, color: ttsOn ? C.accentSoft : C.dim, border: `1px solid ${ttsOn ? C.accentSoft : C.border}`, borderRadius: 999, padding: "7px 13px", fontSize: 12, fontFamily: FONT.round, fontWeight: 600, cursor: "pointer", boxShadow: SOFT }}>
          {ttsOn ? <IconVolume size={14} /> : <IconVolumeOff size={14} />}
          {ttsOn ? "Leyendo" : "Leer en voz alta"}
        </button>
      </div>
      {/* El padding de abajo es el alto del compositor flotante: sin eso, el
          último mensaje queda debajo y no hay scroll que lo saque. */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 16px 104px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", color: C.dim, padding: "36px 12px", fontSize: 14.5, lineHeight: 1.6 }}>
              {cargandoCharla ? (
                "Abriendo la conversación…"
              ) : (
                <>
                  Preguntale lo que quieras sobre {subject ? subjectLabel(subject) : "la materia"}.<br />
                  Si algo no está en tu libro, te lo avisa.
                </>
              )}
            </div>
          )}
          {messages.map((m, i) =>
            m.tarjeta
              ? <TarjetaEjercicioView key={i} t={m.tarjeta} />
              : <Bubble key={i} m={m} />)}

          {/* SEGUIR CON EL SIGUIENTE, acá mismo. Este botón es el punto entero
              del cambio: sin él el alumno tendría que volver a la prueba, buscar
              el próximo tema y entrar de nuevo, una vez por tema.

              Aparece cuando el tutor terminó de responder, no antes: ofrecer el
              siguiente mientras todavía está escribiendo el actual invita a
              saltearse justo lo que se vino a estudiar. */}
          {repaso.length > 0 && paso < repaso.length - 1 && !loading && messages.length > 0 && (
            <button onClick={siguienteRepaso}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(C.ink), padding: "13px 15px", cursor: "pointer" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 14.5 }}>Seguir con el siguiente</span>
                <span style={{ display: "block", fontSize: 12.5, opacity: .85, marginTop: 1, lineHeight: 1.3 }}>{repaso[paso + 1]!.t}</span>
              </span>
              <IconArrow size={19} />
            </button>
          )}

          {/* El final de la fila. Sin este cartel, el repaso simplemente deja de
              ofrecer botón y no se entiende si terminó o si se rompió algo. */}
          {repaso.length > 1 && paso === repaso.length - 1 && !loading && (
            <div style={{ textAlign: "center", color: C.okTx, background: C.okBg, border: `1px solid ${C.ok}`, borderRadius: 12, padding: "11px 13px", fontSize: 13.5, lineHeight: 1.5 }}>
              Repasaste los {repaso.length} temas que te habían costado. Si quedó alguno flojo, preguntá acá mismo.
            </div>
          )}
          {/* LO QUE EL CHICO ESTÁ DICIENDO, mientras lo dice. Va del lado del
              alumno y con el mismo color de sus burbujas, pero a media tinta y
              con borde punteado: todavía no es un mensaje, es lo que se oyó
              hasta acá y puede cambiar en la próxima palabra. */}
          {parcial && (
            <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.userBubble, color: "#2B2740", opacity: .62, border: `1.5px dashed ${C.accentSoft}`, borderRadius: "18px 18px 6px 18px", padding: "10px 14px", fontSize: 15, lineHeight: 1.5 }}>
              {parcial}
            </div>
          )}
        </div>
      </div>
      {/* EL COMPOSITOR, EN EL AIRE.
          Antes era una barra pegada al borde de abajo, con su línea divisoria y
          su fondo: partía la pantalla en dos y el chat terminaba en un zócalo.
          Ahora flota sobre la conversación — que sigue corriendo por debajo — y
          la única separación es la sombra.

          Que flote trae dos problemas y los dos se resuelven acá:
           · El último mensaje quedaría tapado. Por eso el scroll lleva
             `paddingBottom` del alto de esta zona (ALTO_COMPOSITOR).
           · El texto pasaría POR DETRÁS y se leería cortado a la mitad. Por eso
             el velo: un degradado al color del fondo que lo disuelve antes de
             llegar. `pointerEvents: "none"` para no comerse los clics de las
             burbujas que quedan debajo. */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 16px 20px", pointerEvents: "none" }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: -48, background: `linear-gradient(to top, ${C.bg} 58%, rgba(255,255,255,0))` }} />
        <div style={{ position: "relative", maxWidth: 720, margin: "0 auto", pointerEvents: "auto" }}>
          {/* EL TECLADO DE MATEMÁTICA, arriba del compositor. Se abre desde el
              botón de la calculadora y solo existe en esa materia: en Lengua un
              teclado de símbolos es ruido. */}
          {teclado && callState === "idle" && (
            <TecladoMate
              valor={question} cursor={cursor}
              onCambiar={(texto, pos) => {
                setCursor(pos);
                cursorPendiente.current = pos;
                if (texto === question) {
                  // Mover el cursor sin tocar el texto (las flechas): no hay
                  // re-render por `question`, así que el efecto no corre y hay
                  // que aplicarlo acá.
                  cursorPendiente.current = null;
                  inputRef.current?.focus();
                  inputRef.current?.setSelectionRange(pos, pos);
                }
                setQuestion(texto);
              }}
              onCerrar={() => setTeclado(false)}
            />
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", background: C.panel, border: `1px solid ${foco ? C.accentSoft : C.border}`, borderRadius: 27, padding: 7, boxShadow: foco ? `${FLOAT}, 0 0 0 3px rgba(108,92,231,.14)` : FLOAT, transition: "border-color .15s, box-shadow .15s" }}>
            {/* Durante la llamada el compositor no escribe: dice cómo salir. Si
                se dejara el campo, se podría mandar una pregunta escrita en el
                medio del turno de voz y las dos respuestas se pisarían. */}
            {callState === "idle" ? (
              <>
                {/* LA CALCULADORA, a la IZQUIERDA del campo y solo en
                    Matemática: es parte de escribir, no de mandar. Del lado de
                    la flecha se leía como una acción de envío más, y quedaba
                    peleando con los dos botones que sí terminan el mensaje. */}
                {mate && (
                  <button onClick={() => setTeclado((v) => !v)}
                    title={teclado ? "Cerrar el teclado" : "Teclado de matemática"}
                    aria-pressed={teclado}
                    style={{ flexShrink: 0, marginLeft: 3, width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "50%", border: teclado ? "none" : `1.5px solid ${C.border}`, background: teclado ? "rgba(43,68,255,.12)" : C.panel, color: teclado ? C.accent : C.dim, cursor: "pointer", transition: "background .15s, color .15s" }}>
                    <IconCalculadora size={19} />
                  </button>
                )}
                <input
                  ref={inputRef}
                  value={question}
                  onChange={(e) => { setQuestion(e.target.value); setCursor(e.target.selectionStart ?? e.target.value.length); }}
                  // El visor del teclado dibuja el cursor donde está de verdad,
                  // así que hay que seguirlo también cuando lo mueve el chico
                  // (flechas, clic, selección) y no solo cuando escribe.
                  onSelect={(e) => setCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
                  onFocus={() => setFoco(true)} onBlur={() => setFoco(false)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={mate ? "Escribí el ejercicio o preguntá" : "¿Qué querés que te explique?"}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", borderRadius: 20, padding: mate ? "11px 8px" : "11px 8px 11px 16px", fontSize: 15.5, fontFamily: FONT.sans, color: C.text, outline: "none" }} />
                <button onClick={() => void send()} disabled={loading || !question.trim()} title="Enviar"
                  style={{ flexShrink: 0, width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: "50%", border: "none", background: loading || !question.trim() ? C.panel2 : CTA, color: loading || !question.trim() ? C.dim : "#fff", cursor: loading || !question.trim() ? "default" : "pointer", boxShadow: loading || !question.trim() ? "none" : "0 8px 18px -7px rgba(108,92,231,.75)", transition: "background .15s, box-shadow .15s" }}>
                  {loading ? <Dots /> : <IconSend size={18} />}
                </button>
              </>
            ) : (
              /* EN LLAMADA: las luces y el estado, donde antes se escribía. No
                 hay pantalla aparte — la conversación queda entera a la vista,
                 que es lo único que el chico va a releer después. */
              <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 13, padding: "0 4px 0 14px" }}>
                <VozLuces levelRef={levelRef} state={callState} />
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5, color: C.text, lineHeight: 1.2 }}>
                    {estadoVoz(callState)}
                  </span>
                  <span style={{ fontSize: 11.5, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {/* Mientras habla se avisa que se lo puede interrumpir: si
                        no, nadie lo intenta y se banca la explicación entera. */}
                    {callState === "listening" ? "Hablá cuando quieras"
                      : callState === "speaking" ? "Hablá y te dejo seguir a vos"
                        : "Tocá el botón rojo para cortar"}
                  </span>
                </span>
              </span>
            )}
            {/* HABLAR — modo conversación, al lado de enviar. Es manos libres: el
                micrófono escucha, corta solo cuando dejás de hablar y el tutor
                contesta en voz alta. Va acá y no escondido en el encabezado
                porque es una forma de MANDAR el mensaje, igual que la flecha.
                Queda en blanco y no relleno: dos círculos llenos uno al lado del
                otro pelean, y el que manda es la flecha. */}
            <button onClick={() => (callState === "idle" ? void startCall() : endCall())}
              title={callState === "idle" ? "Hablar con el tutor" : "Cortar"}
              aria-label={callState === "idle" ? "Hablar con el tutor" : "Cortar"}
              style={{ flexShrink: 0, width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: "50%", border: callState === "idle" ? `1.5px solid ${C.border}` : "none", background: callState === "idle" ? C.panel : C.bad, color: callState === "idle" ? C.accentSoft : "#fff", cursor: "pointer", boxShadow: callState === "idle" ? SOFT : "0 8px 18px -7px rgba(212,36,25,.7)" }}>
              <IconWave size={19} />
            </button>
          </div>
          {/* Acá abajo iba "El tutor enseña con tu material · si algo no está en
              tu libro, te avisa". Se fue, y no se perdió nada: con el chat en
              blanco lo dice la pantalla vacía con esas mismas palabras (estaban
              duplicadas en la misma vista), y con la conversación empezada lo
              dice mucho mejor el sello de CADA respuesta. Lo único que aportaba
              era apretar la barra contra el borde — en pantalla angosta se
              partía en dos líneas. */}
        </div>
      </div>
      </div>
    </div>
  );
}
