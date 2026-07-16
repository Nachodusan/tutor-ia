"use client";

import { useRef, useState } from "react";

interface Citation {
  index: number;
  documentId: string;
  chunkId: string;
  page: number | null;
}

/** Veredicto del verificador A3 (frame final del stream de /api/chat). */
interface Verification {
  grounded: boolean;
  unsupported: string[];
  checked?: number;
  unavailable?: boolean;
}

export default function Home() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ marginBottom: 4 }}>📚 Tutor IA</h1>
      <p style={{ color: "#9fb0c0", marginTop: 0 }}>
        Sube tus apuntes o libros y estudia con una IA que se apoya en tu propio
        material.
      </p>
      <UploadPanel />
      <ChatPanel />
      <ExamPanel />
    </main>
  );
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

function UploadPanel() {
  const [status, setStatus] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setStatus("Subiendo e indexando…");
    const form = new FormData();
    form.append("file", file);
    form.append("title", file.name);
    const res = await fetch("/api/documents", { method: "POST", body: form });
    const json = await res.json();
    setStatus(
      res.ok
        ? `✅ Listo: ${file.name}`
        : `❌ ${json.error ?? "Error al procesar"}`,
    );
  }

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>1 · Sube material</h2>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md" />
      <button style={{ ...button, marginLeft: 8 }} onClick={upload}>
        Subir e indexar
      </button>
      <div style={{ color: "#9fb0c0", marginTop: 8 }}>{status}</div>
    </section>
  );
}

function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [grounded, setGrounded] = useState(true);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    setCitations([]);
    setGrounded(true);
    setVerification(null);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.body) {
      setAnswer("Error: sin respuesta.");
      setLoading(false);
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

      // La primera línea (prefijada con \x1e) trae las citas.
      if (!citationsParsed && buffer.startsWith("\x1e")) {
        const nl = buffer.indexOf("\n");
        if (nl !== -1) {
          try {
            const meta = JSON.parse(buffer.slice(1, nl));
            setCitations(meta.citations ?? []);
            setGrounded(meta.grounded !== false);
          } catch {
            /* ignore */
          }
          buffer = buffer.slice(nl + 1);
          citationsParsed = true;
        }
      }
      if (citationsParsed) {
        // Un \x1e posterior abre el frame FINAL: la verificación A3. Todo lo
        // anterior es la respuesta; el frame no se muestra como texto.
        const rs = buffer.indexOf("\x1e");
        if (rs === -1) {
          setAnswer(buffer);
        } else {
          setAnswer(buffer.slice(0, rs).trimEnd());
          const nl = buffer.indexOf("\n", rs);
          const frame = nl === -1 ? buffer.slice(rs + 1) : buffer.slice(rs + 1, nl);
          try {
            const meta = JSON.parse(frame);
            if (meta.verification) setVerification(meta.verification);
          } catch {
            /* frame incompleto: llega en el próximo read */
          }
        }
      }
    }
    setLoading(false);
  }

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>2 · Pregúntale a tu material</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{
            flex: 1,
            background: "#0b0f14",
            border: "1px solid #1e2a3a",
            borderRadius: 8,
            color: "#e6edf3",
            padding: "8px 10px",
          }}
          value={question}
          placeholder="Ej: ¿Qué es la fotosíntesis según mis apuntes?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button style={button} onClick={ask} disabled={loading}>
          {loading ? "…" : "Preguntar"}
        </button>
      </div>
      {answer && !grounded && (
        <div
          style={{
            marginTop: 12,
            padding: "6px 10px",
            borderRadius: 6,
            background: "#3a2a12",
            color: "#f0c674",
            fontSize: 13,
          }}
        >
          ⚠️ Fuera de tu material — la IA se abstuvo para no inventar.
        </div>
      )}
      {answer && (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{answer}</div>
      )}
      {answer && grounded && verification && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          {verification.unavailable ? (
            <span style={{ color: "#9fb0c0" }}>
              ⚪ No pude verificar esta respuesta contra tu material (verificador
              no disponible).
            </span>
          ) : verification.grounded ? (
            (verification.checked ?? 0) > 0 && (
              <span style={{ color: "#7ee787" }}>
                ✓ Verificado: {verification.checked}{" "}
                {verification.checked === 1 ? "afirmación" : "afirmaciones"} con
                respaldo en tu material.
              </span>
            )
          ) : (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: "#3a2a12",
                color: "#f0c674",
              }}
            >
              ⚠️ No encontré respaldo en tu material para:
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {verification.unsupported.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              Verificalo con las fuentes antes de estudiarlo como cierto.
            </div>
          )}
        </div>
      )}
      {citations.length > 0 && (
        <div style={{ color: "#9fb0c0", marginTop: 12, fontSize: 13 }}>
          Fuentes:{" "}
          {citations
            .map((c) => `#${c.index}${c.page != null ? ` (pág. ${c.page})` : ""}`)
            .join(", ")}
        </div>
      )}
    </section>
  );
}

function ExamPanel() {
  const [status, setStatus] = useState("");
  const [exam, setExam] = useState<{ examId: string; exam: any } | null>(null);

  async function generate() {
    setStatus("Generando examen…");
    setExam(null);
    const res = await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", numQuestions: 5 }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(`❌ ${typeof json === "string" ? json : json.error ?? "Error"}`);
      return;
    }
    setExam(json);
    setStatus(`✅ ${json.exam.title} — ${json.exam.questions.length} preguntas`);
  }

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>3 · Genera un examen</h2>
      <button style={button} onClick={generate}>
        Generar examen (5 preguntas)
      </button>
      <div style={{ color: "#9fb0c0", marginTop: 8 }}>{status}</div>
      {exam && (
        <ol style={{ marginTop: 12 }}>
          {exam.exam.questions.map((q: any) => (
            <li key={q.id} style={{ marginBottom: 10 }}>
              <div>{q.prompt}</div>
              {q.type === "mcq" && (
                <ul>
                  {q.options?.map((o: string, i: number) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
