"use client";

import { useEffect, useRef, useState } from "react";

interface Citation { index: number; chunkId: string; page: number | null; source?: "content" | "pedagogy" }
interface Verification { grounded: boolean; contradicted: string[]; unsupported: string[]; checked?: number; unavailable?: boolean }
interface Msg { role: "user" | "assistant"; content: string; citations?: Citation[]; verification?: Verification | null; grounded?: boolean; streaming?: boolean }
interface Subject { id: string; name: string; grade: string | null; subject_area: string | null; content_chunks: string; pedagogy_chunks: string }

const C = {
  bg: "#0b0f14", panel: "#111826", panel2: "#0e141d", border: "#1e2a3a",
  text: "#e6edf3", dim: "#9fb0c0", accent: "#2f81f7", userBubble: "#1b2735",
};

const gradeLabel = (g: string) => `${g.slice(0, -1)}° ${g.endsWith("M") ? "Medio" : "Básico"}`;
const gradeSort = (g: string) => (g.endsWith("M") ? 100 : 0) + Number(g.slice(0, -1) || 0);
const subjectLabel = (s: Subject) => s.name.replace(/\s+\d+º.*$/, "").trim();

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/subjects").then((r) => r.json()).then((j) => setSubjects(j.subjects ?? [])).catch(() => {});
  }, []);

  // --- VOZ (100% local: whisper.cpp STT + macOS say TTS vía /api/voice) ---
  async function speak(text: string) {
    if (!text.trim()) return;
    try {
      audioRef.current?.pause();
      const res = await fetch("/api/voice/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch { /* audio no disponible */ }
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
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          const res = await fetch("/api/voice/stt", { method: "POST", body: blob });
          const j = await res.json();
          if (j.text?.trim()) send(j.text.trim());
        } catch { /* */ }
        setTranscribing(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("No pude acceder al micrófono. Revisá los permisos.");
    }
  }
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const subject = subjects.find((s) => s.id === subjectId);
  const grades = [...new Set(subjects.map((s) => s.grade).filter(Boolean) as string[])].sort((a, b) => gradeSort(a) - gradeSort(b));
  const gradeSubjects = subjects.filter((s) => s.grade === grade).sort((a, b) => subjectLabel(a).localeCompare(subjectLabel(b)));

  function reset() { setGrade(""); setSubjectId(""); setMessages([]); }

  async function send(text?: string) {
    const q = (text ?? question).trim();
    if (!q || loading) return;
    setLoading(true); setQuestion("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", grounded: true, streaming: true }]);
    const patch = (p: Partial<Msg>) => setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], ...p } as Msg; return c; });
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, subjectId: subjectId || null, history }),
      });
      if (!res.body) { patch({ content: "Error: sin respuesta.", streaming: false }); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; let citationsParsed = false; let displayed = "";
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
            displayed = buffer.slice(0, rs).trimEnd();
            patch({ content: displayed });
            const nl = buffer.indexOf("\n", rs);
            const frame = nl === -1 ? buffer.slice(rs + 1) : buffer.slice(rs + 1, nl);
            try { const meta = JSON.parse(frame); if (meta.verification) patch({ verification: meta.verification }); } catch { /* */ }
          }
        }
      }
      if (ttsOn && displayed) speak(displayed);
    } catch { patch({ content: "Error de red." }); }
    finally { patch({ streaming: false }); setLoading(false); }
  }

  // --- Onboarding: paso 1 (grado) ---
  if (!grade) {
    return (
      <Centered>
        <div style={{ fontSize: 44, marginBottom: 12 }}>📚</div>
        <h1 style={{ margin: "0 0 6px", fontSize: 26 }}>Hola 👋</h1>
        <p style={{ color: C.dim, margin: "0 0 26px", fontSize: 16 }}>¿En qué curso vas?</p>
        <Group label="Básica">
          {grades.filter((g) => g.endsWith("B")).map((g) => (
            <Pill key={g} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>
          ))}
        </Group>
        {grades.some((g) => g.endsWith("M")) && (
          <Group label="Media">
            {grades.filter((g) => g.endsWith("M")).map((g) => (
              <Pill key={g} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>
            ))}
          </Group>
        )}
      </Centered>
    );
  }

  // --- Onboarding: paso 2 (materia) ---
  if (!subjectId) {
    return (
      <Centered>
        <button onClick={() => setGrade("")} style={backLink}>← {gradeLabel(grade)}</button>
        <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>¿Qué querés estudiar?</h1>
        <p style={{ color: C.dim, margin: "0 0 24px", fontSize: 15 }}>{gradeLabel(grade)}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 560 }}>
          {gradeSubjects.map((s) => (
            <Pill key={s.id} onClick={() => { setSubjectId(s.id); setMessages([]); }}>{subjectLabel(s)}</Pill>
          ))}
          {gradeSubjects.length === 0 && <span style={{ color: C.dim }}>No hay materias para este curso.</span>}
        </div>
      </Centered>
    );
  }

  // --- Chat ---
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
        <span style={{ fontSize: 20 }}>📚</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subject ? subjectLabel(subject) : "Tutor"}</div>
          <div style={{ color: C.dim, fontSize: 12 }}>{grade && gradeLabel(grade)}</div>
        </div>
        <button onClick={() => { setTtsOn((v) => !v); if (ttsOn) audioRef.current?.pause(); }} title={ttsOn ? "Lectura en voz alta: activada" : "Leer respuestas en voz alta"}
          style={{ background: ttsOn ? C.accent : C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>
          {ttsOn ? "🔊" : "🔈"}
        </button>
        <button onClick={reset} style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>Cambiar</button>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 8px" }}>
          {messages.length === 0 ? (
            <EmptyState subject={subject} onPick={send} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>{messages.map((m, i) => <Bubble key={i} m={m} onSpeak={() => speak(m.content)} />)}</div>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, background: C.panel2 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <button onClick={toggleMic} disabled={transcribing || loading} title={recording ? "Detener" : "Hablar"}
            style={{ background: recording ? "#c0392b" : C.panel, color: C.text, border: `1px solid ${recording ? "#c0392b" : C.border}`, borderRadius: 10, padding: "11px 14px", cursor: transcribing || loading ? "default" : "pointer", fontSize: 17, flexShrink: 0 }}>
            {transcribing ? "…" : recording ? "⏹" : "🎙️"}
          </button>
          <textarea
            value={question} rows={1}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={recording ? "Escuchando… hablá y tocá ⏹" : transcribing ? "Transcribiendo…" : messages.length ? "¿No entendiste? Pedí otra explicación…" : "¿Qué querés que te explique?"}
            style={{ flex: 1, resize: "none", maxHeight: 160, background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, lineHeight: 1.4, fontFamily: "inherit" }}
          />
          <button onClick={() => send()} disabled={loading || !question.trim()}
            style={{ background: loading || !question.trim() ? C.border : C.accent, color: "white", border: "none", borderRadius: 10, padding: "11px 18px", cursor: loading ? "default" : "pointer", fontWeight: 600, fontSize: 15, whiteSpace: "nowrap" }}>
            {loading ? "…" : "Enviar"}
          </button>
        </div>
        <p style={{ textAlign: "center", color: C.dim, fontSize: 11, margin: "0 0 8px" }}>El tutor solo usa tu material · cita la fuente o se abstiene</p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: C.bg, color: C.text, padding: 20 }}>
      {children}
    </div>
  );
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18, width: "100%", maxWidth: 560 }}>
      <div style={{ color: C.dim, fontSize: 13, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>{children}</div>
    </div>
  );
}
function Pill({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "10px 18px", cursor: "pointer", fontSize: 15 }}>
      {children}
    </button>
  );
}
const backLink: React.CSSProperties = { background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14, marginBottom: 16 };

function EmptyState({ subject, onPick }: { subject?: Subject; onPick: (t: string) => void }) {
  const area = subject ? subjectLabel(subject) : "tu material";
  const examples = [`Explicame un tema de ${area}`, "Dame un ejemplo concreto", "¿Por qué es importante esto?"];
  return (
    <div style={{ textAlign: "center", padding: "28px 8px", color: C.dim }}>
      <h2 style={{ color: C.text, margin: "0 0 6px", fontSize: 20 }}>{area}</h2>
      <p style={{ margin: "0 0 20px", fontSize: 14.5, lineHeight: 1.5 }}>Te explico los temas con ejemplos, cito la fuente y me adapto si no entendés.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520, margin: "0 auto" }}>
        {examples.map((ex, i) => (
          <button key={i} onClick={() => onPick(ex)} style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "8px 14px", cursor: "pointer", fontSize: 14 }}>{ex}</button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m, onSpeak }: { m: Msg; onSpeak?: () => void }) {
  if (m.role === "user")
    return <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.userBubble, borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 15, lineHeight: 1.5 }}>{m.content}</div>;
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
      {m.streaming && !m.content ? (
        <div style={{ color: C.dim, fontSize: 15 }}>Pensando…</div>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.6, flex: 1 }}>{m.content}</div>
          {m.content && !m.streaming && onSpeak && (
            <button onClick={onSpeak} title="Leer en voz alta"
              style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 15, flexShrink: 0, padding: 2 }}>🔊</button>
          )}
        </div>
      )}
      {m.content && m.grounded === false && <Note color="#f0c674" bg="#3a2a12">⚠️ Fuera de tu material — me abstuve para no inventar.</Note>}
      <VerificationBadge v={m.verification} grounded={m.grounded} />
      {m.citations && m.citations.length > 0 && (
        <div style={{ color: C.dim, marginTop: 10, fontSize: 12.5, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {m.citations.map((c) => (
            <span key={c.index} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 8px" }}>
              {c.page != null ? `pág. ${c.page}` : `#${c.index}`}{c.source === "pedagogy" ? " · guía" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function Note({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: bg, color, fontSize: 13 }}>{children}</div>;
}
function VerificationBadge({ v, grounded }: { v?: Verification | null; grounded?: boolean }) {
  if (!v || grounded === false) return null;
  if (v.unavailable) return <div style={{ marginTop: 8, color: C.dim, fontSize: 12.5 }}>⚪ No pude verificar esta respuesta contra tu material.</div>;
  if (v.grounded)
    return (v.checked ?? 0) > 0 ? (
      <div style={{ marginTop: 8, color: "#7ee787", fontSize: 12.5 }}>✓ Verificado contra tu material ({v.checked} {v.checked === 1 ? "afirmación" : "afirmaciones"}).</div>
    ) : null;
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
      {v.contradicted?.length > 0 && (
        <Note color="#f0a0a0" bg="#3a1518">🚩 Tu material dice lo <strong>contrario</strong> de esto:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.contradicted.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Note>
      )}
      {v.unsupported?.length > 0 && (
        <Note color="#f0c674" bg="#3a2a12">⚠️ No encontré respaldo en tu material para:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.unsupported.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Note>
      )}
    </div>
  );
}
