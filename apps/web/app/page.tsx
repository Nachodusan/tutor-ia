"use client";

import { useEffect, useRef, useState } from "react";

interface Citation { index: number; chunkId: string; page: number | null; source?: "content" | "pedagogy" }
interface Verification { grounded: boolean; contradicted: string[]; unsupported: string[]; checked?: number; unavailable?: boolean }
interface Msg { role: "user" | "assistant"; content: string; citations?: Citation[]; verification?: Verification | null; grounded?: boolean; streaming?: boolean }
interface Subject { id: string; name: string; grade: string | null; subject_area: string | null; content_chunks: string; pedagogy_chunks: string }

const C = {
  bg: "#0a0e14", panel: "#141b26", panel2: "#0d131c", border: "#232f40",
  text: "#e8eef5", dim: "#93a3b5", accent: "#4b8bf5", accent2: "#7c5cff", userBubble: "#1c2836", ok: "#5fd18b",
};

const SPEECH_THRESH = 6;
const SILENCE_MS = 1200;

const gradeLabel = (g: string) => `${g.slice(0, -1)}° ${g.endsWith("M") ? "Medio" : "Básico"}`;
const gradeSort = (g: string) => (g.endsWith("M") ? 100 : 0) + Number(g.slice(0, -1) || 0);
const subjectLabel = (s: Subject) => s.name.replace(/\s+\d+º.*$/, "").trim();

type CallState = "idle" | "listening" | "thinking" | "speaking";

// --- Iconos (SVG inline, estilo línea; sin dependencias) ---
type IconProps = { size?: number; color?: string; stroke?: number };
const svg = (size = 22, color = "currentColor", stroke = 1.8) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});
const IconCap = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" /></svg>);
const IconWave = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M2 12h2" /><path d="M6 8v8" /><path d="M10 5v14" /><path d="M14 8v8" /><path d="M18 10v4" /><path d="M22 12h0" /></svg>);
const IconVolume = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>);
const IconVolumeOff = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>);
const IconMic = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /></svg>);
const IconStop = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>);
const IconSend = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></svg>);
const IconBack = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>);
const IconSwap = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="m17 2 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>);
const IconX = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>);
const IconCheck = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M20 6 9 17l-5-5" /></svg>);
const IconAlert = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M12 9v4" /><path d="M12 17h0" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>);

export default function Home() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [grade, setGrade] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const callRef = useRef(false);
  const levelRef = useRef(0); // amplitud 0..1 para la animación de voz
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => { fetch("/api/subjects").then((r) => r.json()).then((j) => setSubjects(j.subjects ?? [])).catch(() => {}); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const subject = subjects.find((s) => s.id === subjectId);
  const grades = [...new Set(subjects.map((s) => s.grade).filter(Boolean) as string[])].sort((a, b) => gradeSort(a) - gradeSort(b));
  const gradeSubjects = subjects.filter((s) => s.grade === grade).sort((a, b) => subjectLabel(a).localeCompare(subjectLabel(b)));

  function reset() { if (callRef.current) endCall(); setGrade(""); setSubjectId(""); setMessages([]); }

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

  async function send(text?: string): Promise<string> {
    const q = (text ?? question).trim();
    if (!q || loading) return "";
    setLoading(true); setQuestion("");
    const history = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", grounded: true, streaming: true }]);
    const patch = (p: Partial<Msg>) => setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], ...p } as Msg; return c; });
    let displayed = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, subjectId: subjectId || null, subjectName: subject ? subjectLabel(subject) : null, history }) });
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
            try { const meta = JSON.parse(buffer.slice(1, nl)); patch({ citations: meta.citations ?? [], grounded: meta.grounded !== false }); } catch { /* */ }
            buffer = buffer.slice(nl + 1); citationsParsed = true;
          }
        }
        if (citationsParsed) {
          const rs = buffer.indexOf("\x1e");
          if (rs === -1) { displayed = buffer; patch({ content: buffer }); }
          else {
            displayed = buffer.slice(0, rs).trimEnd(); patch({ content: displayed });
            const nl = buffer.indexOf("\n", rs);
            const frame = nl === -1 ? buffer.slice(rs + 1) : buffer.slice(rs + 1, nl);
            try { const meta = JSON.parse(frame); if (meta.verification) patch({ verification: meta.verification }); } catch { /* */ }
          }
        }
      }
      if (ttsOn && !callRef.current && displayed) speak(displayed);
    } catch { patch({ content: "Error de red." }); }
    finally { patch({ streaming: false }); setLoading(false); }
    return displayed;
  }

  async function toggleMic() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false); setTranscribing(true);
        try { const res = await fetch("/api/voice/stt", { method: "POST", body: new Blob(chunks, { type: rec.mimeType || "audio/webm" }) }); const j = await res.json(); if (j.text?.trim()) send(j.text.trim()); } catch { /* */ }
        setTranscribing(false);
      };
      recRef.current = rec; rec.start(); setRecording(true);
    } catch { alert("No pude acceder al micrófono. Revisá los permisos."); }
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

  function endCall() {
    callRef.current = false; cancelAnimationFrame(rafRef.current); levelRef.current = 0;
    try { if (recRef.current?.state === "recording") recRef.current.stop(); } catch { /* */ }
    audioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null; analyserRef.current = null; audioCtxRef.current = null;
    setCallState("idle");
  }

  if (!grade) {
    return (
      <Centered>
        <div style={{ marginBottom: 14, color: C.accent }}><IconCap size={52} stroke={1.5} /></div>
        <h1 style={{ margin: "0 0 6px", fontSize: 26 }}>Hola 👋</h1>
        <p style={{ color: C.dim, margin: "0 0 26px", fontSize: 16 }}>¿En qué curso vas?</p>
        <Group label="Básica">{grades.filter((g) => g.endsWith("B")).map((g) => <Pill key={g} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>)}</Group>
        {grades.some((g) => g.endsWith("M")) && <Group label="Media">{grades.filter((g) => g.endsWith("M")).map((g) => <Pill key={g} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>)}</Group>}
      </Centered>
    );
  }
  if (!subjectId) {
    return (
      <Centered>
        <button onClick={() => setGrade("")} style={backLink}><IconBack size={15} /> {gradeLabel(grade)}</button>
        <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>¿Qué querés estudiar?</h1>
        <p style={{ color: C.dim, margin: "0 0 24px", fontSize: 15 }}>{gradeLabel(grade)}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 560 }}>
          {gradeSubjects.map((s) => <Pill key={s.id} onClick={() => { setSubjectId(s.id); setMessages([]); }}>{subjectLabel(s)}</Pill>)}
          {gradeSubjects.length === 0 && <span style={{ color: C.dim }}>No hay materias para este curso.</span>}
        </div>
      </Centered>
    );
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
        <span style={{ color: C.accent, display: "flex" }}><IconCap size={24} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subject ? subjectLabel(subject) : "Tutor"}</div>
          <div style={{ color: C.dim, fontSize: 12 }}>{grade && gradeLabel(grade)}</div>
        </div>
        <button onClick={startCall} title="Conversar por voz (manos libres)"
          style={{ display: "flex", alignItems: "center", gap: 6, background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`, color: "white", border: "none", borderRadius: 9, padding: "8px 13px", cursor: "pointer", fontSize: 13.5, fontWeight: 600, flexShrink: 0 }}>
          <IconWave size={17} /> Conversar
        </button>
        <IconBtn onClick={() => { setTtsOn((v) => !v); if (ttsOn) audioRef.current?.pause(); }} active={ttsOn} title={ttsOn ? "Lectura en voz alta activada" : "Leer respuestas en voz alta"}>
          {ttsOn ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}
        </IconBtn>
        <IconBtn onClick={reset} title="Cambiar de materia"><IconSwap size={17} /></IconBtn>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 8px" }}>
          {messages.length === 0 ? <EmptyState subject={subject} onPick={send} />
            : <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>{messages.map((m, i) => <Bubble key={i} m={m} onSpeak={() => speak(m.content)} />)}</div>}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, background: C.panel2 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <button onClick={toggleMic} disabled={transcribing || loading} title={recording ? "Detener" : "Hablar (una vez)"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, background: recording ? "#c0392b" : C.panel, color: recording ? "white" : C.text, border: `1px solid ${recording ? "#c0392b" : C.border}`, borderRadius: 12, cursor: transcribing || loading ? "default" : "pointer", flexShrink: 0 }}>
            {transcribing ? <Dots /> : recording ? <IconStop size={18} /> : <IconMic size={19} />}
          </button>
          <textarea value={question} rows={1}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={recording ? "Escuchando…" : transcribing ? "Transcribiendo…" : messages.length ? "¿No entendiste? Pedí otra explicación…" : "¿Qué querés que te explique?"}
            style={{ flex: 1, resize: "none", maxHeight: 160, background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", fontSize: 15, lineHeight: 1.4, fontFamily: "inherit" }} />
          <button onClick={() => send()} disabled={loading || !question.trim()} title="Enviar"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, background: loading || !question.trim() ? C.border : `linear-gradient(135deg, ${C.accent}, ${C.accent2})`, color: "white", border: "none", borderRadius: 12, cursor: loading ? "default" : "pointer", flexShrink: 0 }}>
            {loading ? <Dots /> : <IconSend size={19} />}
          </button>
        </div>
        <p style={{ textAlign: "center", color: C.dim, fontSize: 11, margin: "0 0 8px" }}>El tutor solo usa tu material · cita la fuente o se abstiene</p>
      </div>

      {callState !== "idle" && <CallOverlay state={callState} levelRef={levelRef} subject={subject ? subjectLabel(subject) : ""} lastMsg={messages[messages.length - 1]} onEnd={endCall} />}
    </div>
  );
}

// --- Orbe de voz animado (reacciona a la amplitud real) ---
function VoiceOrb({ levelRef, state }: { levelRef: React.RefObject<number>; state: CallState }) {
  const orb = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const lvl = state === "thinking" ? 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(Date.now() / 260)) : (levelRef.current ?? 0);
      const s = 1 + lvl * 0.55;
      if (orb.current) {
        orb.current.style.transform = `scale(${s.toFixed(3)})`;
        orb.current.style.boxShadow = `0 0 ${(30 + lvl * 90).toFixed(0)}px ${(6 + lvl * 26).toFixed(0)}px rgba(90,140,255,${(0.25 + lvl * 0.5).toFixed(2)})`;
      }
      if (ring.current) ring.current.style.transform = `scale(${(1.15 + lvl * 0.7).toFixed(3)})`, ring.current.style.opacity = `${(0.35 + lvl * 0.4).toFixed(2)}`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state, levelRef]);
  const g = state === "speaking"
    ? `radial-gradient(circle at 35% 30%, #a9c6ff, ${C.accent} 45%, ${C.accent2} 100%)`
    : state === "thinking"
      ? `radial-gradient(circle at 35% 30%, #c3ccdd, #7f8bad 55%, #5b6488 100%)`
      : `radial-gradient(circle at 35% 30%, #bfe0ff, #4b8bf5 45%, #6f5cff 100%)`;
  return (
    <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div ref={ring} style={{ position: "absolute", width: 150, height: 150, borderRadius: "50%", border: `2px solid ${C.accent}`, filter: "blur(1px)" }} />
      <div ref={orb} style={{ width: 128, height: 128, borderRadius: "50%", background: g, willChange: "transform, box-shadow", transition: state === "thinking" ? "background .4s" : undefined }} />
    </div>
  );
}

function CallOverlay({ state, levelRef, subject, lastMsg, onEnd }: { state: CallState; levelRef: React.RefObject<number>; subject: string; lastMsg?: Msg; onEnd: () => void }) {
  const label = state === "listening" ? "Escuchando…" : state === "thinking" ? "Pensando…" : "Hablando…";
  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(circle at 50% 35%, #121a28, #070a10)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, zIndex: 50, padding: 24 }}>
      <div style={{ color: C.dim, fontSize: 14, letterSpacing: 0.3 }}>{subject}</div>
      <VoiceOrb levelRef={levelRef} state={state} />
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{label}</div>
      <div style={{ color: C.dim, fontSize: 14, maxWidth: 360, textAlign: "center", minHeight: 40, lineHeight: 1.5 }}>
        {state === "listening" ? "Hablá cuando quieras. Cuando pares, te respondo."
          : state === "speaking" && lastMsg?.role === "assistant" ? clip(lastMsg.content)
            : "Un momento…"}
      </div>
      <button onClick={onEnd} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, background: "#c0392b", color: "white", border: "none", borderRadius: 999, padding: "14px 26px", cursor: "pointer", fontSize: 15, fontWeight: 600 }}>
        <IconX size={18} /> Terminar
      </button>
    </div>
  );
}
const clip = (t: string) => { const s = t.replace(/\s+/g, " ").trim(); return s.length > 130 ? s.slice(0, 130) + "…" : s; };

function IconBtn({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, background: active ? C.accent : C.panel, color: C.text, border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 9, cursor: "pointer", flexShrink: 0 }}>
      {children}
    </button>
  );
}
function Dots() {
  return (<span style={{ display: "inline-flex", gap: 3 }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", animation: `tdot 1s ${i * 0.15}s infinite ease-in-out` }} />)}
    <style>{`@keyframes tdot { 0%,80%,100% { opacity:.3; transform:translateY(0) } 40% { opacity:1; transform:translateY(-3px) } }`}</style>
  </span>);
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: `radial-gradient(circle at 50% 30%, #0f1622, ${C.bg})`, color: C.text, padding: 20 }}>{children}</div>;
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18, width: "100%", maxWidth: 560 }}>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>{children}</div>
    </div>
  );
}
function Pill({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, padding: "11px 18px", cursor: "pointer", fontSize: 15, transition: "border-color .15s" }}
    onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.accent)} onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}>{children}</button>;
}
const backLink: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14, marginBottom: 16 };

function EmptyState({ subject, onPick }: { subject?: Subject; onPick: (t: string) => void }) {
  const area = subject ? subjectLabel(subject) : "tu material";
  const examples = [`Explicame un tema de ${area}`, "Dame un ejemplo concreto", "¿Por qué es importante esto?"];
  return (
    <div style={{ textAlign: "center", padding: "36px 8px", color: C.dim }}>
      <div style={{ color: C.accent, display: "flex", justifyContent: "center", marginBottom: 12 }}><IconCap size={40} stroke={1.5} /></div>
      <h2 style={{ color: C.text, margin: "0 0 6px", fontSize: 21 }}>{area}</h2>
      <p style={{ margin: "0 0 22px", fontSize: 14.5, lineHeight: 1.5 }}>Te explico los temas con ejemplos, cito la fuente y me adapto si no entendés.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520, margin: "0 auto" }}>
        {examples.map((ex, i) => <button key={i} onClick={() => onPick(ex)} style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 14 }}>{ex}</button>)}
      </div>
    </div>
  );
}

function Bubble({ m, onSpeak }: { m: Msg; onSpeak?: () => void }) {
  if (m.role === "user")
    return <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.userBubble, borderRadius: "16px 16px 5px 16px", padding: "10px 14px", fontSize: 15, lineHeight: 1.5 }}>{m.content}</div>;
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
      {m.streaming && !m.content ? <div style={{ color: C.dim, fontSize: 15 }}><Dots /></div>
        : (
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.65, flex: 1 }}>{m.content}</div>
            {m.content && !m.streaming && onSpeak && <button onClick={onSpeak} title="Leer en voz alta" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", flexShrink: 0, padding: 2, display: "flex" }}><IconVolume size={16} /></button>}
          </div>
        )}
      {m.content && m.grounded === false && <Note color="#f0c674" bg="#3a2a12"><IconAlert size={15} /> Fuera de tu material — me abstuve para no inventar.</Note>}
      <VerificationBadge v={m.verification} grounded={m.grounded} />
      {m.citations && m.citations.length > 0 && (
        <div style={{ color: C.dim, marginTop: 10, fontSize: 12.5, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {m.citations.map((c) => <span key={c.index} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 9px" }}>{c.page != null ? `pág. ${c.page}` : `#${c.index}`}{c.source === "pedagogy" ? " · guía" : ""}</span>)}
        </div>
      )}
    </div>
  );
}
function Note({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <div style={{ marginTop: 8, padding: "8px 11px", borderRadius: 9, background: bg, color, fontSize: 13, display: "flex", gap: 7, alignItems: "flex-start" }}>{children}</div>;
}
function VerificationBadge({ v, grounded }: { v?: Verification | null; grounded?: boolean }) {
  if (!v || grounded === false) return null;
  if (v.unavailable) return <div style={{ marginTop: 8, color: C.dim, fontSize: 12.5 }}>No pude verificar esta respuesta contra tu material.</div>;
  if (v.grounded) return (v.checked ?? 0) > 0 ? <div style={{ marginTop: 8, color: C.ok, fontSize: 12.5, display: "flex", gap: 5, alignItems: "center" }}><IconCheck size={14} /> Verificado contra tu material ({v.checked} {v.checked === 1 ? "afirmación" : "afirmaciones"}).</div> : null;
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
      {v.contradicted?.length > 0 && <Note color="#f0a0a0" bg="#3a1518"><IconAlert size={15} /><span>Tu material dice lo <strong>contrario</strong> de esto:<ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.contradicted.map((s, i) => <li key={i}>{s}</li>)}</ul></span></Note>}
      {v.unsupported?.length > 0 && <Note color="#f0c674" bg="#3a2a12"><IconAlert size={15} /><span>No encontré respaldo en tu material para:<ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.unsupported.map((s, i) => <li key={i}>{s}</li>)}</ul></span></Note>}
    </div>
  );
}
