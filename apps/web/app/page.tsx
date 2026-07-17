"use client";

import { useEffect, useRef, useState } from "react";

interface Citation {
  index: number;
  chunkId: string;
  page: number | null;
  source?: "content" | "pedagogy";
}

/** Veredicto del verificador NLI (frame final del stream de /api/chat). */
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
}

interface Subject {
  id: string;
  name: string;
  content_chunks: number;
  pedagogy_chunks: number;
}

const card: React.CSSProperties = {
  background: "#111826",
  border: "1px solid #1e2a3a",
  borderRadius: 12,
  padding: 20,
  marginTop: 24,
};
const button: React.CSSProperties = {
  background: "#2f81f7",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 600,
};
const input: React.CSSProperties = {
  flex: 1,
  background: "#0b0f14",
  border: "1px solid #1e2a3a",
  borderRadius: 8,
  color: "#e6edf3",
  padding: "8px 10px",
};

export default function Home() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((j) => {
        setSubjects(j.subjects ?? []);
        if (j.subjects?.[0]) setSubjectId(j.subjects[0].id);
      })
      .catch(() => {});
  }, []);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ marginBottom: 4 }}>📚 Tutor IA</h1>
      <p style={{ color: "#9fb0c0", marginTop: 0 }}>
        Un tutor que te ayuda a <strong>entender</strong> tu material: te explica,
        cita la fuente y se adapta si no entendés. No inventa: si algo no está, te
        lo dice.
      </p>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Materia</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            style={{ ...input, flex: 1 }}
            value={subjectId ?? ""}
            onChange={(e) => setSubjectId(e.target.value || null)}
          >
            <option value="">Todo mi material</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.content_chunks}+{s.pedagogy_chunks} chunks)
              </option>
            ))}
          </select>
        </div>
      </section>

      <UploadPanel />
      <ChatPanel subjectId={subjectId} />
    </main>
  );
}

function UploadPanel() {
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setStatus("Subiendo e indexando…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", file.name);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      setStatus(res.ok ? `✅ Listo: ${file.name}` : `❌ ${json.error ?? "Error al procesar"}`);
    } catch {
      setStatus("❌ Error de red al subir.");
    }
  }

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Subir material</h2>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md" />
      <button style={{ ...button, marginLeft: 8 }} onClick={upload}>
        Subir e indexar
      </button>
      <div style={{ color: "#9fb0c0", marginTop: 8 }}>{status}</div>
    </section>
  );
}

function ChatPanel({ subjectId }: { subjectId: string | null }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setQuestion("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg: Msg = { role: "user", content: q };
    const botMsg: Msg = { role: "assistant", content: "", grounded: true };
    setMessages((m) => [...m, userMsg, botMsg]);

    const patchBot = (patch: Partial<Msg>) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch } as Msg;
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, subjectId, history }),
      });
      if (!res.body) {
        patchBot({ content: "Error: sin respuesta." });
        return;
      }
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
              patchBot({ citations: meta.citations ?? [], grounded: meta.grounded !== false });
            } catch { /* ignore */ }
            buffer = buffer.slice(nl + 1);
            citationsParsed = true;
          }
        }
        if (citationsParsed) {
          const rs = buffer.indexOf("\x1e");
          if (rs === -1) {
            patchBot({ content: buffer });
          } else {
            patchBot({ content: buffer.slice(0, rs).trimEnd() });
            const nl = buffer.indexOf("\n", rs);
            const frame = nl === -1 ? buffer.slice(rs + 1) : buffer.slice(rs + 1, nl);
            try {
              const meta = JSON.parse(frame);
              if (meta.verification) patchBot({ verification: meta.verification });
            } catch { /* frame incompleto */ }
          }
        }
      }
    } catch {
      patchBot({ content: "Error de red." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Estudiá con el tutor</h2>

      <div style={{ display: "grid", gap: 14, marginBottom: 14 }}>
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === "user" ? (
              <div style={{ color: "#9fb0c0" }}>
                <strong>Vos:</strong> {m.content}
              </div>
            ) : (
              <div>
                {m.content && (
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                )}
                {m.content && m.grounded === false && (
                  <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "#3a2a12", color: "#f0c674", fontSize: 13 }}>
                    ⚠️ Fuera de tu material — el tutor se abstuvo para no inventar.
                  </div>
                )}
                <VerificationBadge v={m.verification} grounded={m.grounded} />
                {m.citations && m.citations.length > 0 && (
                  <div style={{ color: "#9fb0c0", marginTop: 8, fontSize: 13 }}>
                    Fuentes:{" "}
                    {m.citations
                      .map((c) => `#${c.index}${c.page != null ? ` (pág. ${c.page})` : ""}${c.source === "pedagogy" ? " · guía" : ""}`)
                      .join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={input}
          value={question}
          placeholder={messages.length ? "¿No entendiste? Pedí otra explicación…" : "¿Qué querés que te explique?"}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button style={button} onClick={ask} disabled={loading}>
          {loading ? "…" : "Enviar"}
        </button>
      </div>
    </section>
  );
}

function VerificationBadge({ v, grounded }: { v?: Verification | null; grounded?: boolean }) {
  if (!v || grounded === false) return null;
  if (v.unavailable)
    return <div style={{ marginTop: 8, color: "#9fb0c0", fontSize: 13 }}>⚪ No pude verificar esta respuesta contra tu material.</div>;
  if (v.grounded)
    return (v.checked ?? 0) > 0 ? (
      <div style={{ marginTop: 8, color: "#7ee787", fontSize: 13 }}>
        ✓ Verificado: {v.checked} {v.checked === 1 ? "afirmación" : "afirmaciones"} con respaldo en tu material.
      </div>
    ) : null;
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
      {v.contradicted?.length > 0 && (
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "#3a1518", color: "#f0a0a0" }}>
          🚩 Tu material dice lo <strong>contrario</strong> de esto:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {v.contradicted.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {v.unsupported?.length > 0 && (
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "#3a2a12", color: "#f0c674" }}>
          ⚠️ No encontré respaldo en tu material para:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {v.unsupported.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
