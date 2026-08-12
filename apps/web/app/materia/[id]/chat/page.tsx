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
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Bubble, CallOverlay } from "../../../chat-ui";
import { C, CTA, FONT, FLOAT, SOFT, Dots, IconSend, IconWave, IconVolume, IconVolumeOff, subjectLabel } from "../../../ui";
import { traerMateria } from "../../../datos";
import type { CallState, Msg, Subject } from "../../../tipos";

function cleanTutorText(t: string): string {
  return t
    .replace(/\s*\((?:p[áa]gs?\.?|p\.)\s*\d+(?:\s*[-–—]\s*\d+)?\)/gi, "") // (pág. 8) (págs. 8-9)
    .replace(/\bseg[úu]n\s+(el|tu|los|la|las)\s+(material|fragmento|apunte|texto|gu[íi]a)s?\b[,:]?\s*/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?…])/g, "$1")
    // re-capitaliza inicio de oración (por si quedó minúscula al sacar "Según…,")
    .replace(/(^|[.!?¡¿]\s+)([a-záéíóúüñ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

const SPEECH_THRESH = 6;
const SILENCE_MS = 1200;

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [foco, setFoco] = useState(false);   // el compositor se ilumina al escribir
  const sessionRef = useRef<string | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const arrancado = useRef(false);

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
  const levelRef = useRef(0);   // amplitud 0..1 para la animación del orbe

  // Salir de la página con el micrófono abierto deja la luz del micro prendida
  // y el AudioContext vivo. Se corta al desmontar, pase lo que pase.
  useEffect(() => () => { if (callRef.current) endCall(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    void traerMateria(id).then(setSubject);
  }, [id]);

  // La pregunta que llega por URL se manda UNA vez. El guard es un ref y no un
  // estado a propósito: en dev StrictMode el efecto corre dos veces y con
  // estado el chico veía su pregunta duplicada.
  useEffect(() => {
    if (arrancado.current || !subject) return;
    const q = params.get("q");
    if (!q) return;
    arrancado.current = true;
    const u = params.get("unit"), l = params.get("lesson");
    void send(q, { unit: u ? Number(u) : null, lesson: l ? Number(l) : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

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
              if (meta.sessionId) sessionRef.current = meta.sessionId;
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
              patch({ ...(meta.verification ? { verification: meta.verification } : {}), ...(meta.mode ? { mode: meta.mode } : {}), ...(meta.scope ? { scope: meta.scope } : {}) });
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
        const res = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
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
        const done = () => { cancelAnimationFrame(raf); levelRef.current = 0; URL.revokeObjectURL(url); resolve(); };
        a.onended = done; a.onerror = done;
        await a.play();
      } catch { resolve(); }
    });
  }

  async function startCall() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext(); audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      src.connect(analyser); analyserRef.current = analyser;
      callRef.current = true; listen();
    } catch { alert("No pude acceder al micrófono. Revisá los permisos."); }
  }

  function listen() {
    if (!callRef.current || !streamRef.current || !analyserRef.current) return;
    setCallState("listening");
    const rec = new MediaRecorder(streamRef.current);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => handleUtterance(chunks, rec.mimeType);
    recRef.current = rec; rec.start();
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.fftSize);
    let speechDetected = false; let lastLoud = performance.now();
    const tick = () => {
      if (!callRef.current || recRef.current !== rec || rec.state !== "recording") return;
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]! - 128);
      const level = sum / data.length;
      levelRef.current = Math.min(1, level / 26);
      const now = performance.now();
      if (level > SPEECH_THRESH) { speechDetected = true; lastLoud = now; }
      if (speechDetected && now - lastLoud > SILENCE_MS) { levelRef.current = 0; rec.stop(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function endCall() {
    callRef.current = false; cancelAnimationFrame(rafRef.current); levelRef.current = 0;
    try { if (recRef.current?.state === "recording") recRef.current.stop(); } catch { /* */ }
    audioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null; analyserRef.current = null; audioCtxRef.current = null;
    setCallState("idle");
  }

  async function handleUtterance(chunks: Blob[], mime: string) {
    if (!callRef.current) return;
    setCallState("thinking"); levelRef.current = 0;
    let text = "";
    try { const res = await fetch("/api/voice/stt", { method: "POST", body: new Blob(chunks, { type: mime || "audio/webm" }) }); text = (await res.json()).text?.trim() ?? ""; } catch { /* */ }
    if (!callRef.current) return;
    if (!text) { listen(); return; }
    const answer = await send(text);
    if (!callRef.current) return;
    setCallState("speaking");
    await speak(answer);
    if (callRef.current) listen();
  }

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Leer en voz alta lo que el tutor responde, sin entrar en conversación:
          sirve para el que quiere escuchar mientras lee. También flota: es un
          control de la pantalla, no parte de la conversación. */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px 0" }}>
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
              Preguntale lo que quieras sobre {subject ? subjectLabel(subject) : "la materia"}.<br />
              Si algo no está en tu libro, te lo avisa.
            </div>
          )}
          {messages.map((m, i) => <Bubble key={i} m={m} />)}
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", background: C.panel, border: `1px solid ${foco ? C.accentSoft : C.border}`, borderRadius: 27, padding: 7, boxShadow: foco ? `${FLOAT}, 0 0 0 3px rgba(108,92,231,.14)` : FLOAT, transition: "border-color .15s, box-shadow .15s" }}>
            <input
              value={question} onChange={(e) => setQuestion(e.target.value)}
              onFocus={() => setFoco(true)} onBlur={() => setFoco(false)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="¿Qué querés que te explique?"
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", borderRadius: 20, padding: "11px 8px 11px 16px", fontSize: 15.5, fontFamily: FONT.sans, color: C.text, outline: "none" }} />
            <button onClick={() => void send()} disabled={loading || !question.trim()} title="Enviar"
              style={{ flexShrink: 0, width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: "50%", border: "none", background: loading || !question.trim() ? C.panel2 : CTA, color: loading || !question.trim() ? C.dim : "#fff", cursor: loading || !question.trim() ? "default" : "pointer", boxShadow: loading || !question.trim() ? "none" : "0 8px 18px -7px rgba(108,92,231,.75)", transition: "background .15s, box-shadow .15s" }}>
              {loading ? <Dots /> : <IconSend size={18} />}
            </button>
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
      {callState !== "idle" && (
        <CallOverlay
          state={callState} levelRef={levelRef}
          subject={subject ? subjectLabel(subject) : "tu materia"}
          lastMsg={messages[messages.length - 1]}
          onEnd={endCall}
        />
      )}
    </div>
  );
}
