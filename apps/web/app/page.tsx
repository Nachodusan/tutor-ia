"use client";

import { useEffect, useRef, useState } from "react";

interface Citation {
  index: number;
  chunkId: string;
  page: number | null;
  source?: "content" | "pedagogy";
}
interface Verification {
  grounded: boolean;
  contradicted: string[];
  unsupported: string[];
  checked?: number;
  unavailable?: boolean;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  verification?: Verification | null;
  grounded?: boolean;
  streaming?: boolean;
}
interface Subject {
  id: string;
  name: string;
  content_chunks: string;
  pedagogy_chunks: string;
}

const C = {
  bg: "#0b0f14",
  panel: "#111826",
  panel2: "#0e141d",
  border: "#1e2a3a",
  text: "#e6edf3",
  dim: "#9fb0c0",
  accent: "#2f81f7",
  userBubble: "#1b2735",
};

export default function Home() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((j) => {
        setSubjects(j.subjects ?? []);
        if (j.subjects?.[0]) setSubjectId(j.subjects[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const subject = subjects.find((s) => s.id === subjectId);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploadMsg(`Subiendo ${file.name}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", file.name);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      setUploadMsg(res.ok ? `✅ ${file.name}` : `❌ ${j.error ?? "Error"}`);
    } catch {
      setUploadMsg("❌ Error de red");
    }
    setTimeout(() => setUploadMsg(""), 4000);
  }

  async function send(text?: string) {
    const q = (text ?? question).trim();
    if (!q || loading) return;
    setLoading(true);
    setQuestion("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [
      ...m,
      { role: "user", content: q },
      { role: "assistant", content: "", grounded: true, streaming: true },
    ]);

    const patch = (p: Partial<Msg>) =>
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { ...c[c.length - 1], ...p } as Msg;
        return c;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, subjectId: subjectId || null, history }),
      });
      if (!res.body) { patch({ content: "Error: sin respuesta.", streaming: false }); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let citationsParsed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (!citationsParsed && buffer.startsWith("\x1e")) {
          const nl = buffer.indexOf("\n");
          if (nl !== -1) {
            try {
              const meta = JSON.parse(buffer.slice(1, nl));
              patch({ citations: meta.citations ?? [], grounded: meta.grounded !== false });
            } catch { /* */ }
            buffer = buffer.slice(nl + 1);
            citationsParsed = true;
          }
        }
        if (citationsParsed) {
          const rs = buffer.indexOf("\x1e");
          if (rs === -1) patch({ content: buffer });
          else {
            patch({ content: buffer.slice(0, rs).trimEnd() });
            const nl = buffer.indexOf("\n", rs);
            const frame = nl === -1 ? buffer.slice(rs + 1) : buffer.slice(rs + 1, nl);
            try {
              const meta = JSON.parse(frame);
              if (meta.verification) patch({ verification: meta.verification });
            } catch { /* */ }
          }
        }
      }
    } catch {
      patch({ content: "Error de red." });
    } finally {
      patch({ streaming: false });
      setLoading(false);
    }
  }

  const examples = [
    subject ? `Explicame un tema de ${subject.name.replace(/\s+\d+º.*$/, "")}` : "Explicame un tema",
    "Dame un ejemplo concreto",
    "¿Por qué es importante esto?",
  ];

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      {/* Header — una fila compacta */}
      <header
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          borderBottom: `1px solid ${C.border}`, background: C.panel2,
        }}
      >
        <span style={{ fontSize: 20, flexShrink: 0 }} title="Tutor IA">📚</span>
        <select
          value={subjectId}
          onChange={(e) => { setSubjectId(e.target.value); setMessages([]); }}
          style={{
            flex: 1, minWidth: 0, background: C.panel, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontSize: 14,
          }}
        >
          <option value="">Todo mi material</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={{ display: "none" }} onChange={upload} />
        <button
          onClick={() => fileRef.current?.click()}
          title="Subir material"
          style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 11px", cursor: "pointer", fontSize: 15, flexShrink: 0 }}
        >
          ＋
        </button>
      </header>
      {uploadMsg && (
        <div style={{ textAlign: "center", color: C.dim, fontSize: 12.5, padding: "4px 0", background: C.panel2, borderBottom: `1px solid ${C.border}` }}>{uploadMsg}</div>
      )}

      {/* Conversación */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 8px" }}>
          {messages.length === 0 ? (
            <EmptyState subject={subject} examples={examples} onPick={send} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {messages.map((m, i) => <Bubble key={i} m={m} />)}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${C.border}`, background: C.panel2 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            value={question}
            rows={1}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={messages.length ? "¿No entendiste? Pedí otra explicación…" : "¿Qué querés que te explique?"}
            style={{
              flex: 1, resize: "none", maxHeight: 160, background: C.panel, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 12px",
              fontSize: 15, lineHeight: 1.4, fontFamily: "inherit",
            }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !question.trim()}
            style={{
              background: loading || !question.trim() ? C.border : C.accent, color: "white",
              border: "none", borderRadius: 10, padding: "11px 18px", cursor: loading ? "default" : "pointer",
              fontWeight: 600, fontSize: 15, whiteSpace: "nowrap",
            }}
          >
            {loading ? "…" : "Enviar"}
          </button>
        </div>
        <p style={{ textAlign: "center", color: C.dim, fontSize: 11, margin: "0 0 8px" }}>
          El tutor solo usa tu material · cita la fuente o se abstiene
        </p>
      </div>
    </div>
  );
}

function EmptyState({ subject, examples, onPick }: { subject?: Subject; examples: string[]; onPick: (t: string) => void }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 8px", color: C.dim }}>
      <h2 style={{ color: C.text, margin: "0 0 6px", fontSize: 20 }}>
        {subject ? subject.name : "Tu tutor de estudio"}
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 14.5, lineHeight: 1.5 }}>
        Te explico los temas de tu material con ejemplos, cito la fuente y me adapto si no entendés.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520, margin: "0 auto" }}>
        {examples.map((ex, i) => (
          <button
            key={i}
            onClick={() => onPick(ex)}
            style={{
              background: C.panel, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 999, padding: "8px 14px", cursor: "pointer", fontSize: 14,
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.userBubble, borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 15, lineHeight: 1.5 }}>
        {m.content}
      </div>
    );
  }
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
      {m.streaming && !m.content ? (
        <div style={{ color: C.dim, fontSize: 15 }}>Pensando…</div>
      ) : (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.6 }}>{m.content}</div>
      )}
      {m.content && m.grounded === false && (
        <Note color="#f0c674" bg="#3a2a12">⚠️ Fuera de tu material — me abstuve para no inventar.</Note>
      )}
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
      <div style={{ marginTop: 8, color: "#7ee787", fontSize: 12.5 }}>
        ✓ Verificado contra tu material ({v.checked} {v.checked === 1 ? "afirmación" : "afirmaciones"}).
      </div>
    ) : null;
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
      {v.contradicted?.length > 0 && (
        <Note color="#f0a0a0" bg="#3a1518">
          🚩 Tu material dice lo <strong>contrario</strong> de esto:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.contradicted.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Note>
      )}
      {v.unsupported?.length > 0 && (
        <Note color="#f0c674" bg="#3a2a12">
          ⚠️ No encontré respaldo en tu material para:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.unsupported.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Note>
      )}
    </div>
  );
}
