"use client";

import { useEffect, useRef, useState } from "react";
import {
  C, AURORA, CTA, FONT, HARD, SOFT, backLink,
  gradeLabel, gradeSort, subjectLabel, subjectColor, isLight, scoreTone,
  AuroraDot, IconBtn, Dots, Pill, BigBtn, SectionTitle,
  IconWave, IconVolume, IconVolumeOff, IconMic, IconStop, IconSend, IconBack,
  IconSwap, IconX, IconCheck, IconAlert, IconUser, IconUsers, IconSettings, IconBook,
  IconStar, IconArrow, IconList, IconSpark, IconClipboard, IconChevron, IconLock,
} from "./ui";

/** `label` ya viene armado del servidor con libro + curso + página. Se usa ese
 *  y no se re-arma acá: cuando el tutor trae material de otro curso, "pág. 87"
 *  a secas no le dice nada al alumno. */
interface Citation { index: number; chunkId: string; page: number | null; source?: "content" | "pedagogy"; label?: string; grade?: string | null }
interface Verification { grounded: boolean; contradicted: string[]; unsupported: string[]; checked?: number; unavailable?: boolean }
/** De dónde salió la respuesta: "libro" hubo material del libro · "apoyado" lo
 *  hubo pero el verificador detectó deriva · "general" no había material y el
 *  tutor enseñó con conocimiento general. */
type AnswerMode = "libro" | "apoyado" | "general";
interface Msg { role: "user" | "assistant"; content: string; citations?: Citation[]; verification?: Verification | null; grounded?: boolean; mode?: AnswerMode; streaming?: boolean }
/** `disabled` = materia sacada de circulación. Se sigue mostrando (si no,
 *  no hay forma de saber que existe) pero no se puede abrir. */
interface Subject { id: string; name: string; grade: string | null; subject_area: string | null; content_chunks: string; pedagogy_chunks: string; disabled?: boolean }
/** El perfil NO tiene nombre: las cuentas son anónimas (los usuarios son
 *  menores). El username lo devuelve /api/me y solo sirve para saludar. */
interface Profile { username: string; grade: string }
/** `points` puede faltar: los planes cacheados antes de que existieran los
 *  puntos clave siguen siendo válidos y se muestran sin ellos. */
interface PlanItem { n: number; key: string; title: string; focus: string; points?: string[]; unit: number | null; lesson: number | null; p0: number | null; p1: number | null }
interface TestItem { n: number; key?: string; topic: string; question: string; options: string[]; correct: number; explain: string; unit: number | null; lesson: number | null; p0: number | null; p1: number | null }

// Un tema que el alumno falló en la prueba. Se guarda con unit/lesson para que
// "Reforzar" pueda disparar ESTUDIO DIRIGIDO (sin eso el retrieval se abstiene).
interface WeakTopic { topicKey: string; topic: string; unit: number | null; lesson: number | null; misses: number }
interface SubjectProgress { weak: WeakTopic[]; lastScore?: { score: number; total: number; at: string } | null }
/** Lo que el panel muestra de cada materia. Se arma leyendo las dos claves. */
interface SubjectStats { planDone: number; planTotal: number; weak: WeakTopic[]; lastScore?: { score: number; total: number; at: string } | null }

/** Claves del esquema VIEJO. Se borran al entrar: el perfil guardaba el NOMBRE
 *  del alumno —justo lo que se elimina por privacidad— y el plan/progreso
 *  pertenecían a "quien haya usado este navegador", que es el bug que el login
 *  arregla. Migrarlos le regalaría a un chico el progreso de otro. */
const CLAVES_VIEJAS = ["tutor_profile"];
function limpiarLocalStorageViejo() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (CLAVES_VIEJAS.includes(k) || k.startsWith("tutor_plan_") || k.startsWith("tutor_progress_")) {
        localStorage.removeItem(k);
      }
    }
  } catch { /* modo privado */ }
}
/** Tope de temas a reforzar en el panel: una lista larga desmotiva y empuja el
 *  resto del panel fuera de pantalla. Los que sobran se cuentan abajo. */
const REVIEW_MAX = 6;

const stripOptLetter = (o: string) => o.replace(/^\s*[A-Da-d1-4]\s*[)\.\-:]\s+/, "").trim();

const SPEECH_THRESH = 6;
const SILENCE_MS = 1200;

// Limpia la prosa del tutor para MOSTRARLA: saca citas de página y muletillas de
// fuente que el 7B a veces mete en el texto. Las referencias van aparte (chips).
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

type CallState = "idle" | "listening" | "thinking" | "speaking";

export default function Home() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subjectId, setSubjectId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [callState, setCallState] = useState<CallState>("idle");
  const [plan, setPlan] = useState<PlanItem[] | null>(null); // null=no generado, []=sin plan, [...]=plan
  // Claves ESTABLES de los temas hechos, no índices posicionales: al
  // regenerar el plan un índice viejo apuntaría a otra lección.
  const [username, setUsername] = useState("");
  /** Solo para decidir si se ofrece el atajo al panel del curso. El permiso REAL
   *  lo chequea /api/teacher, que devuelve 403 sin importar lo que diga esto. */
  const [role, setRole] = useState("student");
  /** Conversación en curso. La ruta la crea en el primer turno y la devuelve en
   *  el frame de citas; a partir de ahí viaja en cada POST para que los turnos
   *  queden encadenados en la misma sesión. */
  const sessionRef = useRef<string | null>(null);
  const [planDone, setPlanDone] = useState<string[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [test, setTest] = useState<TestItem[] | null>(null); // null=no generada, []=sin material
  const [testAns, setTestAns] = useState<Record<number, number>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, SubjectStats>>({});
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
  // Quién soy y mi perfil, desde la base. Sin sesión el middleware ya redirigió
  // al login; el 401 acá es la red de seguridad si la sesión venció a mitad.
  useEffect(() => {
    limpiarLocalStorageViejo();
    fetch("/api/me")
      .then((r) => (r.status === 401 ? (window.location.href = "/login", null) : r.json()))
      .then((j) => {
        if (!j) return;
        // Un docente que entra cae acá, y sin esto el onboarding le preguntaría
        // "¿en qué curso vas?" — la pregunta equivocada para él. Al admin no se
        // lo redirige: usa esta pantalla para probar la app como alumno.
        if (j.user?.role === "teacher") { window.location.href = "/docente"; return; }
        setRole(j.user?.role ?? "student");
        setUsername(j.user?.username ?? "");
        if (j.profile?.grade) {
          setProfile({ username: j.user?.username ?? "", grade: j.profile.grade });
        }
      })
      .catch(() => { /* sin red: se queda en el onboarding */ })
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    setPlanOpen(false);
    setTest(null); setTestAns({}); setTestSubmitted(false); setTestOpen(false);
    if (!subjectId) { setPlan(null); setPlanDone([]); return; }
    // El plan está cacheado por materia (es el mismo libro para todo el curso);
    // lo que es de este alumno son las claves marcadas como hechas.
    fetch(`/api/plan?subjectId=${subjectId}`)
      .then((r) => r.json())
      .then((j) => {
        setPlan(j.items?.length ? j.items : null);
        setPlanDone(j.doneKeys ?? []);
      })
      .catch(() => { setPlan(null); setPlanDone([]); });
  }, [subjectId]);

  const subject = subjects.find((s) => s.id === subjectId);
  const grade = profile?.grade ?? "";

  // Estadísticas del panel. Se releen al volver al panel (subjectId="") porque
  // el alumno pudo marcar lecciones o rendir una prueba mientras estaba adentro.
  useEffect(() => {
    if (subjectId || !subjects.length) return;
    fetch("/api/progress")
      .then((r) => r.json())
      .then((j) => setStats(j.progress ?? {}))
      .catch(() => { /* el panel muestra ceros */ });
  }, [subjectId, subjects]);

  /**
   * "Reforzar" desde el panel: abre la materia Y arranca el estudio dirigido.
   * El id va EXPLÍCITO a send() porque `setSubjectId` no se ve en este tick.
   * (Se probó con un efecto disparado por estado: en dev StrictMode lo ejecuta
   * dos veces y mandaba la pregunta duplicada.)
   */
  function reinforce(id: string, w: WeakTopic) {
    setSubjectId(id);
    setMessages([]);
    sessionRef.current = null;   // repasar arranca una conversación nueva
    send(`Quiero repasar: ${w.topic}. Explicámelo simple, desde el principio y con un ejemplo.`,
      { unit: w.unit, lesson: w.lesson }, id);
  }


  async function generatePlan() {
    if (planLoading || !subjectId) return;
    setPlanLoading(true);
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectId, subjectName: subject ? subjectLabel(subject) : null }) });
      const j = await res.json();
      const items: PlanItem[] = j.items ?? [];
      setPlan(items); setPlanDone(j.doneKeys ?? []);
      if (items.length) setPlanOpen(true);
    } catch { setPlan([]); }
    finally { setPlanLoading(false); }
  }
  function startTopic(item: PlanItem) {
    setPlanOpen(false);
    const focus = item.focus ? ` (${item.focus})` : "";
    send(`Quiero estudiar: ${item.title}${focus}. Enseñámelo desde el principio, paso a paso y con ejemplos.`, { unit: item.unit, lesson: item.lesson });
  }
  /** Marca/desmarca un tema. Optimista en la UI y persistido en la base: el
   *  alumno ve el tilde al instante y no espera al round-trip. */
  function toggleDone(key: string) {
    if (!subjectId) return;
    const done = !planDone.includes(key);
    setPlanDone((d) => (done ? [...d, key] : d.filter((x) => x !== key)));
    fetch("/api/plan/progress", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId, topicKey: key, done }),
    }).catch(() => { /* al recargar se relee de la base */ });
  }

  // ── Simulación de prueba ──
  async function generateTest() {
    if (testLoading || !subjectId) return;
    setTestLoading(true); setTestOpen(true); setTest(null); setTestAns({}); setTestSubmitted(false);
    try {
      const res = await fetch("/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectId, subjectName: subject ? subjectLabel(subject) : null }) });
      const j = await res.json();
      setTest(j.items ?? []);
    } catch { setTest([]); }
    finally { setTestLoading(false); }
  }
  function openTest() { if (test && test.length > 0) setTestOpen(true); else generateTest(); }
  function answerTest(n: number, idx: number) { if (testSubmitted) return; setTestAns((a) => ({ ...a, [n]: idx })); }
  function studyWeak(it: TestItem) {
    setTestOpen(false);
    send(`Quiero repasar: ${it.topic}. Explicámelo simple, desde el principio y con un ejemplo.`, { unit: it.unit, lesson: it.lesson });
  }
  /**
   * Corrige y GUARDA en qué falló. Un tema acertado sale de la lista: así el
   * "para reforzar" del panel se vacía solo cuando el alumno lo domina, en vez
   * de acumular errores viejos para siempre.
   */
  /**
   * Corrige la prueba en el SERVIDOR y refresca el panel. Antes se calculaba en
   * el cliente y se guardaba en localStorage; ahora los temas para reforzar
   * viven en la base y siguen al alumno entre dispositivos.
   */
  async function submitTest() {
    setTestSubmitted(true);
    if (!test || !subjectId) return;
    try {
      const r = await fetch("/api/test/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId,
          items: test.map((it) => ({
            topicKey: it.key ?? it.topic, topic: it.topic,
            unit: it.unit, lesson: it.lesson,
            correct: it.correct, answer: testAns[it.n] ?? null,
          })),
        }),
      });
      const j = await r.json();
      setStats((st) => ({
        ...st,
        [subjectId]: {
          ...(st[subjectId] ?? { planDone: 0, planTotal: 0, weak: [] }),
          weak: j.weak ?? [],
          lastScore: { score: j.score, total: j.total, at: new Date().toISOString() },
        },
      }));
    } catch { /* el panel se refresca al volver */ }
  }


  function saveProfile(p: Profile) {
    setProfile(p);   // optimista: la UI no espera al round-trip
    fetch("/api/me/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: p.grade }),
    }).catch(() => { /* se reintenta al volver a guardar */ });
  }
  /** Cierra sesión DE VERDAD: revoca en la base y recarga. Antes solo borraba el
   *  perfil local, así que el alumno siguiente heredaba el plan y los temas
   *  fallados del anterior. */
  async function logout() {
    if (callRef.current) endCall();
    limpiarLocalStorageViejo();
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* igual salimos */ }
    window.location.href = "/login";
  }
  function toDashboard() { if (callRef.current) endCall(); setSubjectId(""); setMessages([]); sessionRef.current = null; }

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

  /**
   * `forSubjectId` sirve para arrancar en una materia que se acaba de elegir en
   * el mismo tick (Reforzar desde el panel): el estado todavía no se actualizó.
   * Cuando viene, la conversación arranca limpia — el historial es de otra materia.
   */
  async function send(
    text?: string,
    topic?: { unit: number | null; lesson: number | null },
    forSubjectId?: string,
  ): Promise<string> {
    const q = (text ?? question).trim();
    if (!q || loading) return "";
    setLoading(true); setQuestion("");
    const sid = forSubjectId ?? subjectId;
    const subj = forSubjectId ? subjects.find((s) => s.id === forSubjectId) : subject;
    const history = forSubjectId ? [] : messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
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
              patch({ citations: meta.citations ?? [], grounded: meta.grounded !== false, mode: meta.mode });
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
              patch({ ...(meta.verification ? { verification: meta.verification } : {}), ...(meta.mode ? { mode: meta.mode } : {}) });
            } catch { /* */ }
          }
        }
      }
      displayed = cleanTutorText(displayed);
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

  if (!loaded) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;
  if (!profile || editing) {
    return (
      <Onboarding
        subjects={subjects}
        initial={editing ? profile ?? undefined : undefined}
        onCancel={editing ? () => setEditing(false) : undefined}
        onDone={(p) => { saveProfile(p); setEditing(false); if (subjectId && subject?.grade !== p.grade) toDashboard(); }}
      />
    );
  }
  if (!subjectId) {
    return (
      <Dashboard
        profile={profile}
        subjects={subjects}
        stats={stats}
        teacher={role === "teacher" || role === "admin"}
        onStudy={(id) => { setSubjectId(id); setMessages([]); }}
        onReinforce={reinforce}
        onEdit={() => setEditing(true)}
        onLogout={logout}
      />
    );
  }

  // ── Conversación (mundo Aurora) ──
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, background: C.bg }}>
        <button onClick={toDashboard} title="Volver al panel"
          style={{ display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", color: C.text, cursor: "pointer", padding: "5px 7px", borderRadius: 12, minWidth: 0, flex: 1 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
          <span style={{ color: C.dim, display: "flex", flexShrink: 0 }}><IconBack size={20} /></span>
          <AuroraDot size={26} />
          <span style={{ minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subject ? subjectLabel(subject) : "Tutor"}</span>
            <span style={{ display: "block", color: C.dim, fontSize: 12 }}>{grade && gradeLabel(grade)} · Volver al panel</span>
          </span>
        </button>
        {plan && plan.length > 0 && (
          <IconBtn soft active={planOpen} onClick={() => setPlanOpen((o) => !o)} title="Plan de estudio"><IconList size={18} /></IconBtn>
        )}
        <IconBtn soft active={testOpen} onClick={openTest} title="Simulación de prueba"><IconClipboard size={18} /></IconBtn>
        <button onClick={startCall} title="Conversar por voz (manos libres)"
          style={{ display: "flex", alignItems: "center", gap: 6, background: CTA, color: "#fff", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontFamily: FONT.round, fontSize: 13.5, fontWeight: 700, flexShrink: 0, boxShadow: "0 6px 16px -6px rgba(108,92,231,.5)" }}>
          <IconWave size={17} /> Conversar
        </button>
        <IconBtn soft onClick={() => { setTtsOn((v) => !v); if (ttsOn) audioRef.current?.pause(); }} active={ttsOn} title={ttsOn ? "Lectura en voz alta activada" : "Leer respuestas en voz alta"}>
          {ttsOn ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}
        </IconBtn>
        <IconBtn soft onClick={toDashboard} title="Volver al panel"><IconSwap size={17} /></IconBtn>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 8px" }}>
          {testOpen
            ? <TestView items={test} loading={testLoading} answers={testAns} submitted={testSubmitted} subject={subject} onAnswer={answerTest} onSubmit={submitTest} onRetake={generateTest} onStudy={studyWeak} onClose={() => setTestOpen(false)} />
            : planOpen && plan && plan.length > 0
              ? <PlanView items={plan} done={planDone} subject={subject} loading={planLoading} onStart={startTopic} onToggle={toggleDone} onRegen={generatePlan} />
              : messages.length === 0
                ? <StartScreen subject={subject} plan={plan} loading={planLoading} onPick={send} onGenerate={generatePlan} onOpenPlan={() => setPlanOpen(true)} onTest={openTest} testLoading={testLoading} />
                : <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>{messages.map((m, i) => <Bubble key={i} m={m} onSpeak={() => speak(m.content)} />)}</div>}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <button onClick={toggleMic} disabled={transcribing || loading} title={recording ? "Detener" : "Hablar (una vez)"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, background: recording ? C.coral : C.panel2, color: recording ? "#fff" : C.text, border: `1px solid ${recording ? C.coral : C.border}`, borderRadius: 14, cursor: transcribing || loading ? "default" : "pointer", flexShrink: 0 }}>
            {transcribing ? <Dots /> : recording ? <IconStop size={18} /> : <IconMic size={19} />}
          </button>
          <textarea value={question} rows={1}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = C.accentSoft)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={recording ? "Escuchando…" : transcribing ? "Transcribiendo…" : messages.length ? "¿No entendiste? Pedí otra explicación…" : "¿Qué querés que te explique?"}
            style={{ flex: 1, resize: "none", maxHeight: 160, background: C.panel2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", fontSize: 15, lineHeight: 1.4, fontFamily: FONT.sans, outline: "none", transition: "border-color .15s" }} />
          <button onClick={() => send()} disabled={loading || !question.trim()} title="Enviar"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, background: loading || !question.trim() ? C.border : CTA, color: "#fff", border: "none", borderRadius: 14, cursor: loading ? "default" : "pointer", flexShrink: 0 }}>
            {loading ? <Dots /> : <IconSend size={19} />}
          </button>
        </div>
        <p style={{ textAlign: "center", color: C.dim, fontSize: 11, margin: "0 0 8px" }}>El tutor enseña con tu material · si algo no está en tu libro, te avisa</p>
      </div>

      {callState !== "idle" && <CallOverlay state={callState} levelRef={levelRef} subject={subject ? subjectLabel(subject) : ""} lastMsg={messages[messages.length - 1]} onEnd={endCall} />}
    </div>
  );
}

// --- Orbe aurora animado (reacciona a la amplitud real) ---
function VoiceOrb({ levelRef, state }: { levelRef: React.RefObject<number>; state: CallState }) {
  const orb = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const lvl = state === "thinking" ? 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(Date.now() / 260)) : (levelRef.current ?? 0);
      const s = 1 + lvl * 0.45;
      if (orb.current) {
        orb.current.style.transform = `scale(${s.toFixed(3)})`;
        orb.current.style.boxShadow = `0 0 ${(28 + lvl * 80).toFixed(0)}px ${(8 + lvl * 24).toFixed(0)}px rgba(255,158,123,${(0.28 + lvl * 0.4).toFixed(2)})`;
      }
      if (ring.current) ring.current.style.transform = `scale(${(1.15 + lvl * 0.7).toFixed(3)})`, ring.current.style.opacity = `${(0.3 + lvl * 0.4).toFixed(2)}`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state, levelRef]);
  return (
    <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div ref={ring} style={{ position: "absolute", width: 150, height: 150, borderRadius: "50%", border: `2px solid ${C.accentSoft}`, filter: "blur(1px)" }} />
      <div ref={orb} style={{ width: 128, height: 128, borderRadius: "50%", background: AURORA, willChange: "transform, box-shadow", opacity: state === "thinking" ? 0.85 : 1, transition: "opacity .4s" }} />
    </div>
  );
}

function CallOverlay({ state, levelRef, subject, lastMsg, onEnd }: { state: CallState; levelRef: React.RefObject<number>; subject: string; lastMsg?: Msg; onEnd: () => void }) {
  const label = state === "listening" ? "Escuchando…" : state === "thinking" ? "Pensando…" : "Hablando…";
  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(circle at 50% 32%, #F7F5FF, #FFFFFF)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, zIndex: 50, padding: 24, color: C.text }}>
      <div style={{ color: C.dim, fontFamily: FONT.round, fontWeight: 600, fontSize: 14, letterSpacing: 0.3 }}>{subject}</div>
      <VoiceOrb levelRef={levelRef} state={state} />
      <div style={{ fontFamily: FONT.round, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{label}</div>
      <div style={{ color: C.dim, fontSize: 14, maxWidth: 360, textAlign: "center", minHeight: 40, lineHeight: 1.5 }}>
        {state === "listening" ? "Hablá cuando quieras. Cuando pares, te respondo."
          : state === "speaking" && lastMsg?.role === "assistant" ? clip(lastMsg.content)
            : "Un momento…"}
      </div>
      <button onClick={onEnd} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, background: C.coral, color: "#fff", border: "none", borderRadius: 999, padding: "13px 26px", cursor: "pointer", fontFamily: FONT.round, fontSize: 15, fontWeight: 700, boxShadow: "0 8px 18px -6px rgba(255,92,58,.5)" }}>
        <IconX size={18} /> Terminar
      </button>
    </div>
  );
}
const clip = (t: string) => { const s = t.replace(/\s+/g, " ").trim(); return s.length > 130 ? s.slice(0, 130) + "…" : s; };

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: C.bg, color: C.text, fontFamily: FONT.sans, padding: 20 }}>{children}</div>;
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
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
 */
function Onboarding({ subjects, initial, onCancel, onDone }: { subjects: Subject[]; initial?: Profile; onCancel?: () => void; onDone: (p: Profile) => void }) {
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const grades = [...new Set(subjects.map((s) => s.grade).filter(Boolean) as string[])].sort((a, b) => gradeSort(a) - gradeSort(b));
  const cuantas = grade ? subjects.filter((s) => s.grade === grade).length : 0;

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
          <Group label="Básica">{grades.filter((g) => g.endsWith("B")).map((g) => <Pill key={g} active={g === grade} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>)}</Group>
          {grades.some((g) => g.endsWith("M")) && <Group label="Media">{grades.filter((g) => g.endsWith("M")).map((g) => <Pill key={g} active={g === grade} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>)}</Group>}

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

// --- Panel del alumno (mundo Bloques) ---
function Dashboard({ profile, subjects, stats, teacher, onStudy, onReinforce, onEdit, onLogout }: { profile: Profile; subjects: Subject[]; stats: Record<string, SubjectStats>; teacher?: boolean; onStudy: (id: string) => void; onReinforce: (id: string, w: WeakTopic) => void; onEdit: () => void; onLogout: () => void }) {
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
  // Para reforzar: de TODAS las materias — el alumno pudo rendir una prueba en
  // cualquiera. Se excluyen las apagadas: mandarlo a repasar algo que no puede
  // abrir es un callejón sin salida.
  const toReview = subjects
    .filter((s) => !s.disabled)
    .flatMap((s) => (stats[s.id]?.weak ?? []).map((w) => ({ s, w })))
    .sort((a, b) => b.w.misses - a.w.misses);
  return (
    <div style={{ minHeight: "100dvh", overflowY: "auto", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "26px 18px 60px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
          <AuroraDot size={52} square ink />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Hola, {profile.username || "que bueno verte"} 👋</div>
            <div style={{ color: C.dim, fontSize: 14 }}>
              {gradeLabel(profile.grade)} · {misSubjects.length - apagadas} {misSubjects.length - apagadas === 1 ? "materia" : "materias"}
              {apagadas > 0 && ` · ${apagadas} en pausa`}
            </div>
          </div>
          {teacher && <IconBtn onClick={() => (window.location.href = "/docente")} title="Panel del curso"><IconUsers size={17} /></IconBtn>}
          <IconBtn onClick={onEdit} title="Editar perfil"><IconSettings size={17} /></IconBtn>
          <IconBtn onClick={onLogout} title="Cambiar de alumno"><IconSwap size={17} /></IconBtn>
        </header>

        <SectionTitle icon={<IconStar size={15} />}>Tus materias</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16, marginBottom: 36 }}>
          {misSubjects.map((s) => <SubjectCard key={s.id} s={s} st={stats[s.id]} onClick={() => onStudy(s.id)} />)}

          {misSubjects.length === 0 && (
            <p style={{ color: C.dim, fontSize: 14 }}>
              Todavía no hay material cargado para {gradeLabel(profile.grade)}. Tocá el engranaje si te equivocaste de curso.
            </p>
          )}
        </div>

        {toReview.length > 0 && (
          <>
            <SectionTitle icon={<IconAlert size={15} />}>Para reforzar</SectionTitle>
            <p style={{ color: C.dim, fontSize: 13.5, marginTop: -6, marginBottom: 14, lineHeight: 1.5 }}>
              Temas que fallaste en las pruebas. Tocá uno y te lo explico de nuevo desde el principio.
            </p>
            <div style={{ display: "grid", gap: 10, marginBottom: toReview.length > REVIEW_MAX ? 12 : 36 }}>
              {toReview.slice(0, REVIEW_MAX).map(({ s, w }) => <WeakCard key={`${s.id}-${w.topic}`} s={s} w={w} onClick={() => onReinforce(s.id, w)} />)}
            </div>
            {toReview.length > REVIEW_MAX && (
              <p style={{ color: C.dim, fontSize: 13, marginBottom: 36 }}>
                Y {toReview.length - REVIEW_MAX} tema{toReview.length - REVIEW_MAX === 1 ? "" : "s"} más. Reforzá estos primero.
              </p>
            )}
          </>
        )}

      </div>
    </div>
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
function SubjectCard({ s, st, onClick }: { s: Subject; st?: SubjectStats; onClick: () => void }) {
  const hasGuide = Number(s.pedagogy_chunks) > 0;
  const off = !!s.disabled;
  const col = off ? C.border : subjectColor(s);
  const onCol = isLight(col) ? C.ink : "#fff";
  const total = st?.planTotal ?? 0;
  const done = st?.planDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const weak = st?.weak.length ?? 0;
  return (
    <button onClick={off ? undefined : onClick} disabled={off}
      title={off ? "Esta materia está en pausa" : undefined}
      style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", gap: 10, textAlign: "left", background: off ? C.panel2 : C.panel, color: off ? C.dim : C.text, border: `2px solid ${off ? C.border : C.ink}`, borderRadius: 16, padding: "16px", cursor: off ? "default" : "pointer", boxShadow: off ? "none" : HARD(col), transition: "transform .13s, box-shadow .13s" }}
      onMouseEnter={(e) => { if (off) return; e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = `6px 6px 0 0 ${col}`; }}
      onMouseLeave={(e) => { if (off) return; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = HARD(col); }}>
      {!off && <div style={{ position: "absolute", top: -14, right: -14, width: 34, height: 34, borderRadius: "50%", background: col }} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: col, color: onCol, display: "grid", placeItems: "center" }}>
          {off ? <IconLock size={18} /> : <IconBook size={20} />}
        </span>
      </div>
      <div style={{ fontFamily: FONT.round, fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{subjectLabel(s)}</div>

      {off && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: C.panel, color: C.dim, border: `1.5px solid ${C.border}`, borderRadius: 999, padding: "3px 10px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
          <IconLock size={11} /> En pausa
        </div>
      )}
      {off && (
        <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.45 }}>
          Todavía no está disponible. Tu avance se guarda para cuando vuelva.
        </div>
      )}

      {/* Nada de avance ni notas en una materia en pausa: no se puede
          actuar sobre eso, y compite con lo que el alumno sí puede abrir. */}
      {!off && (total > 0 ? (
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, color: C.text }}>
              {done} de {total} {total === 1 ? "lección" : "lecciones"}
            </span>
            <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 12.5, color: done === total ? C.okTx : C.dim }}>
              {done === total ? "¡Completo!" : `${pct}%`}
            </span>
          </div>
          {/* Barra: riel con borde de tinta (Bloques), relleno del color de la materia. */}
          <div style={{ height: 9, borderRadius: 999, background: C.panel2, border: `1.5px solid ${C.ink}`, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: done === total ? C.ok : col, transition: "width .25s" }} />
          </div>
        </div>
      ) : (
        <div style={{ color: C.dim, fontSize: 12.5 }}>{hasGuide ? "Con guía docente" : "Material disponible"}</div>
      ))}

      {!off && (weak > 0 || st?.lastScore) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, position: "relative" }}>
          {weak > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.badBg, color: C.badTx, border: `1.5px solid ${C.badTx}`, borderRadius: 999, padding: "2px 8px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
              <IconAlert size={11} /> {weak} para reforzar
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
        </div>
      )}
    </button>
  );
}

// Tema fallado en una prueba → toca y arranca ESTUDIO DIRIGIDO de esa lección.
function WeakCard({ s, w, onClick }: { s: Subject; w: WeakTopic; onClick: () => void }) {
  const col = subjectColor(s);
  return (
    <button onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", width: "100%", background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "12px 14px", cursor: "pointer", transition: "transform .13s, box-shadow .13s" }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = HARD(col); }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
      <span style={{ width: 10, height: 34, flexShrink: 0, borderRadius: 4, background: col }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{w.topic}</span>
        <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 2 }}>
          {subjectLabel(s)}
          {w.misses > 1 && <> · fallado {w.misses} veces</>}
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, background: CTA, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 999, padding: "6px 12px", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5 }}>
        Reforzar <IconArrow size={13} />
      </span>
    </button>
  );
}

// --- Simulación de prueba (mundo Panel · bloques) ---
function TestView({ items, loading, answers, submitted, subject, onAnswer, onSubmit, onRetake, onStudy, onClose }: { items: TestItem[] | null; loading: boolean; answers: Record<number, number>; submitted: boolean; subject?: Subject; onAnswer: (n: number, i: number) => void; onSubmit: () => void; onRetake: () => void; onStudy: (it: TestItem) => void; onClose: () => void }) {
  const area = subject ? subjectLabel(subject) : "";
  if (loading || items === null) {
    return (
      <div style={{ textAlign: "center", padding: "58px 8px", color: C.dim }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><AuroraDot size={56} /></div>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 18, color: C.text }}>Armando tu prueba…</div>
        <div style={{ marginTop: 6, fontSize: 13.5 }}>Leo tu material y preparo las preguntas.</div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}><Dots /></div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "50px 8px", color: C.dim }}>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>No pude armar una prueba para esta materia todavía.</p>
        <div style={{ marginTop: 14 }}><BigBtn onClick={onClose}>Volver</BigBtn></div>
      </div>
    );
  }
  const answered = items.filter((it) => answers[it.n] != null).length;
  const results = items.map((it) => ({ it, ok: answers[it.n] === it.correct }));
  const score = results.filter((r) => r.ok).length;
  const weak = results.filter((r) => !r.ok).map((r) => r.it);
  const strong = results.filter((r) => r.ok).map((r) => r.it);
  return (
    <div style={{ padding: "4px 2px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Simulación de prueba</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {submitted ? `${score} de ${items.length} correctas` : `${answered} de ${items.length} respondidas`}</div>
        </div>
        <button onClick={onClose} title="Cerrar" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          <IconBack size={14} /> Salir
        </button>
      </div>

      {submitted && <ResultBanner score={score} total={items.length} weak={weak} strong={strong} onStudy={onStudy} onRetake={onRetake} />}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {items.map((it) => <QuestionCard key={it.n} item={it} chosen={answers[it.n]} submitted={submitted} onAnswer={onAnswer} />)}
      </div>

      {!submitted && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <BigBtn disabled={answered < items.length} onClick={onSubmit}>Corregir la prueba <IconCheck size={17} /></BigBtn>
          {answered < items.length && <p style={{ color: C.dim, fontSize: 12.5, marginTop: 10 }}>Respondé las {items.length} preguntas para corregir.</p>}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ item, chosen, submitted, onAnswer }: { item: TestItem; chosen: number | undefined; submitted: boolean; onAnswer: (n: number, i: number) => void }) {
  const shadow = submitted ? (chosen === item.correct ? HARD(C.ok) : HARD(C.bad)) : "none";
  return (
    <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "14px 16px", boxShadow: shadow }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, display: "grid", placeItems: "center", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, fontFamily: FONT.round, fontWeight: 800, fontSize: 13 }}>{item.n}</span>
        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, color: C.text, lineHeight: 1.35 }}>{item.question}</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {item.options.map((o, idx) => {
          const isChosen = chosen === idx;
          const isCorrect = idx === item.correct;
          let bg = C.panel, bd = C.border, col = C.text, dot = C.border, mark: React.ReactNode = null;
          if (submitted) {
            if (isCorrect) { bg = "rgba(31,157,87,.10)"; bd = C.ok; col = C.okTx; dot = C.ok; mark = <IconCheck size={15} color={C.ok} />; }
            else if (isChosen) { bg = "rgba(212,36,25,.08)"; bd = C.bad; col = C.badTx; dot = C.bad; mark = <IconX size={14} color={C.bad} />; }
          } else if (isChosen) { bg = "rgba(43,68,255,.10)"; bd = C.accent; col = C.accent; dot = C.accent; }
          return (
            <button key={idx} onClick={() => onAnswer(item.n, idx)} disabled={submitted}
              style={{ display: "flex", alignItems: "center", gap: 11, textAlign: "left", background: bg, border: `1.5px solid ${bd}`, borderRadius: 11, padding: "10px 12px", cursor: submitted ? "default" : "pointer", fontFamily: FONT.sans, fontSize: 14.5, color: col }}>
              <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", border: `2px solid ${dot}`, background: (isChosen || (submitted && isCorrect)) ? dot : "transparent" }} />
              <span style={{ flex: 1, minWidth: 0 }}>{stripOptLetter(o)}</span>
              {mark}
            </button>
          );
        })}
      </div>
      {submitted && item.explain && (
        <div style={{ marginTop: 11, fontSize: 13, color: C.dim, lineHeight: 1.5, background: C.panel2, borderRadius: 10, padding: "9px 12px" }}>
          <b style={{ color: C.text, fontFamily: FONT.round }}>Por qué:</b> {item.explain}
        </div>
      )}
    </div>
  );
}

function ResultBanner({ score, total, weak, strong, onStudy, onRetake }: { score: number; total: number; weak: TestItem[]; strong: TestItem[]; onStudy: (it: TestItem) => void; onRetake: () => void }) {
  const pct = Math.round((score / total) * 100);
  const tone = pct >= 80 ? C.ok : pct >= 50 ? C.warn : C.bad;
  const msg = pct >= 80 ? "¡Muy bien! Dominás casi todo." : pct >= 50 ? "¡Buen trabajo! Reforcemos algunas cosas." : "Tranqui, repasemos juntos lo que cuesta.";
  const lbl = { fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase" as const, letterSpacing: 0.4, color: C.dim, marginBottom: 9, display: "flex", alignItems: "center", gap: 7 };
  return (
    <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 16, padding: 18, boxShadow: HARD(tone), marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 62, height: 62, borderRadius: 14, background: `${tone}22`, color: tone, display: "grid", placeItems: "center", fontFamily: FONT.round, fontWeight: 800, fontSize: 19, flexShrink: 0, border: `2px solid ${tone}` }}>{score}/{total}</div>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 19, color: C.text }}>{pct}% correcto</div>
          <div style={{ fontSize: 13.5, color: C.dim }}>{msg}</div>
        </div>
      </div>

      {weak.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={lbl}>📌 Para reforzar</div>
          <div style={{ display: "grid", gap: 8 }}>
            {weak.map((it) => (
              <div key={it.n} style={{ display: "flex", alignItems: "center", gap: 10, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5, color: C.text }}>{it.topic}</span>
                  {it.p0 != null && <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 11.5, color: C.dim }}>pág. {it.p0}{it.p1 && it.p1 !== it.p0 ? `–${it.p1}` : ""}</span>}
                </span>
                <button onClick={() => onStudy(it)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 10, padding: "7px 13px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, flexShrink: 0, boxShadow: HARD(C.coral) }}>
                  Estudiar <IconArrow size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {strong.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={lbl}>💪 Lo que dominás</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {strong.map((it) => <span key={it.n} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.okBg, color: C.okTx, border: `1px solid ${C.ok}`, borderRadius: 999, padding: "5px 12px", fontFamily: FONT.round, fontWeight: 600, fontSize: 13 }}><IconCheck size={13} /> {it.topic}</span>)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, textAlign: "center" }}>
        <button onClick={onRetake} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "9px 18px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14 }}>
          <IconSpark size={15} /> Otra prueba nueva
        </button>
      </div>
    </div>
  );
}

// Primera conversación: elegir tema puntual o que el tutor arme un plan.
function StartScreen({ subject, plan, loading, onPick, onGenerate, onOpenPlan, onTest, testLoading }: { subject?: Subject; plan: PlanItem[] | null; loading: boolean; onPick: (t: string) => void; onGenerate: () => void; onOpenPlan: () => void; onTest: () => void; testLoading: boolean }) {
  const area = subject ? subjectLabel(subject) : "tu material";
  const examples = [`Explicame un tema de ${area}`, `Dame un ejemplo de ${area}`, `¿Qué es lo más importante de ${area}?`];
  const hasPlan = !!plan && plan.length > 0;
  const noPlan = !!plan && plan.length === 0;
  return (
    <div style={{ textAlign: "center", padding: "28px 8px", color: C.dim }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><AuroraDot size={64} /></div>
      <h2 style={{ color: C.text, margin: "0 0 6px", fontFamily: FONT.round, fontWeight: 800, fontSize: 23 }}>{area}</h2>
      <p style={{ margin: "0 0 22px", fontSize: 14.5, lineHeight: 1.5 }}>¿Ya sabés qué querés estudiar, o te armo un plan?</p>

      <div style={{ maxWidth: 460, margin: "0 auto 12px" }}>
        {hasPlan ? (
          <PlanCta onClick={onOpenPlan} icon={<IconList size={20} />} title="Seguir tu plan de estudio" sub={`${plan!.length} temas · tocá para ver`} />
        ) : noPlan ? (
          <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>
            El índice de este libro no me quedó claro, así que prefiero no armarte un plan con temas equivocados. Decime abajo qué querés estudiar —o pegame el título de una lección— y arrancamos igual.
          </div>
        ) : (
          <PlanCta onClick={onGenerate} loading={loading} icon={<IconSpark size={20} />} title={loading ? "Armando tu plan…" : "No sé por dónde empezar"} sub={loading ? "Leyendo tu material" : "Armame un plan de estudio con mi material"} />
        )}
      </div>

      <div style={{ maxWidth: 460, margin: "0 auto 24px" }}>
        <button onClick={onTest} disabled={testLoading}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, textAlign: "left", background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 16, padding: "13px 16px", cursor: testLoading ? "default" : "pointer", boxShadow: HARD(C.sun), transition: "transform .12s, box-shadow .12s" }}
          onMouseEnter={(e) => { if (!testLoading) { e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = `6px 6px 0 0 ${C.sun}`; } }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = HARD(C.sun); }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,198,61,.2)", color: "#8A5A00", display: "grid", placeItems: "center", flexShrink: 0 }}>{testLoading ? <Dots /> : <IconClipboard size={19} />}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 15.5 }}>{testLoading ? "Armando tu prueba…" : "Simulación de prueba"}</span>
            <span style={{ display: "block", fontSize: 12.5, color: C.dim }}>Ponete a prueba y mirá qué reforzar</span>
          </span>
        </button>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.dim }}>{hasPlan ? "O preguntá algo puntual 👇" : "¿Tenés un tema en mente? Escribilo abajo 👇"}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520, margin: "0 auto" }}>
        {examples.map((ex, i) => <button key={i} onClick={() => onPick(ex)}
          style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 14, boxShadow: SOFT, transition: "border-color .15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.accentSoft)} onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}>{ex}</button>)}
      </div>
    </div>
  );
}
// CTA del plan = bloque cobalto con sombra dura (mundo Panel dentro del chat)
function PlanCta({ onClick, icon, title, sub, loading }: { onClick: () => void; icon: React.ReactNode; title: string; sub: string; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, textAlign: "left", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 16, padding: "15px 18px", cursor: loading ? "default" : "pointer", boxShadow: HARD(C.coral), transition: "transform .12s, box-shadow .12s" }}
      onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = `6px 6px 0 0 ${C.coral}`; } }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = HARD(C.coral); }}>
      <span style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(255,255,255,.18)", display: "grid", placeItems: "center", flexShrink: 0 }}>{loading ? <Dots /> : icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 16 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, opacity: 0.9 }}>{sub}</span>
      </span>
    </button>
  );
}

// Vista del plan de estudio (mundo Panel · bloques)
function PlanView({ items, done, subject, loading, onStart, onToggle, onRegen }: { items: PlanItem[]; done: string[]; subject?: Subject; loading: boolean; onStart: (it: PlanItem) => void; onToggle: (key: string) => void; onRegen: () => void }) {
  const area = subject ? subjectLabel(subject) : "";
  const siguiente = items.find((it) => !done.includes(it.key))?.key ?? "";
  return (
    <div style={{ padding: "4px 2px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Tu plan de estudio</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {done.length} de {items.length} listos</div>
        </div>
        <button onClick={onRegen} disabled={loading} title="Armar otro plan"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: loading ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          {loading ? <Dots /> : <><IconSpark size={15} /> Rehacer</>}
        </button>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
        {items.map((it) => <span key={it.key} style={{ flex: 1, height: 6, borderRadius: 3, background: done.includes(it.key) ? C.ok : C.panel2, border: `1px solid ${done.includes(it.key) ? C.ok : C.border}` }} />)}
      </div>
      <div style={{ display: "grid", gap: 11 }}>
        {items.map((it) => <PlanItemCard key={it.key} item={it} done={done.includes(it.key)} next={it.key === siguiente} onStart={() => onStart(it)} onToggle={() => onToggle(it.key)} />)}
      </div>
      <p style={{ textAlign: "center", color: C.dim, fontSize: 12, marginTop: 16 }}>Tocá un tema para que el tutor te lo explique. Se guarda tu avance.</p>
    </div>
  );
}
function PlanItemCard({ item, done, next, onStart, onToggle }: { item: PlanItem; done: boolean; next: boolean; onStart: () => void; onToggle: () => void }) {
  const pages = item.p0 != null ? (item.p1 && item.p1 !== item.p0 ? `pág. ${item.p0}–${item.p1}` : `pág. ${item.p0}`) : "";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "stretch", gap: 0, background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: next ? HARD(C.accent) : "none", opacity: done && !next ? 0.62 : 1, transition: "box-shadow .12s, transform .12s" }}>
      <button onClick={onStart} title="Estudiar este tema"
        style={{ flex: 1, minWidth: 0, display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "13px 6px 13px 14px" }}>
        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: "grid", placeItems: "center", background: done ? C.ok : C.accent, color: "#fff", border: `2px solid ${C.ink}`, fontFamily: FONT.round, fontWeight: 800, fontSize: 14 }}>
          {done ? <IconCheck size={15} /> : item.n}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, color: C.text }}>{item.title}</span>
          {item.focus && <span style={{ display: "block", color: C.dim, fontSize: 13, lineHeight: 1.45, marginTop: 2 }}>{item.focus}</span>}

          {/* Los PUNTOS CLAVE de la lección: qué tenés que poder explicar cuando
              termines. Van siempre a la vista y no detrás de un desplegable —
              son la razón de mirar el plan, no un detalle secundario. */}
          {item.points && item.points.length > 0 && (
            <span style={{ display: "block", marginTop: 8 }}>
              {item.points.map((p, i) => (
                <span key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: i === 0 ? 0 : 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: done ? C.ok : C.accent, flexShrink: 0, marginTop: 6.5 }} />
                  <span style={{ fontSize: 12.5, lineHeight: 1.45, color: C.text }}>{p}</span>
                </span>
              ))}
            </span>
          )}

          <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            {pages && <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.dim }}>{pages}</span>}
            {next && <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 10.5, letterSpacing: 0.3, textTransform: "uppercase", color: "#fff", background: C.accent, borderRadius: 999, padding: "2px 8px" }}>Empezá por acá</span>}
          </span>
        </span>
      </button>
      <button onClick={onToggle} title={done ? "Marcar como pendiente" : "Marcar como visto"}
        style={{ flexShrink: 0, width: 46, display: "grid", placeItems: "center", background: "none", border: "none", borderLeft: `1px solid ${C.border}`, color: done ? C.ok : C.dim, cursor: "pointer" }}>
        <IconCheck size={18} />
      </button>
    </div>
  );
}

// Chip de cita (Aurora) — pastilla mono con esquina doblada
function CiteChip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "5px 11px", fontFamily: FONT.mono, fontSize: 12.5, color: C.dim, overflow: "hidden" }}>
      {children}
      <span style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 9px 9px 0", borderColor: `transparent ${C.bg} transparent transparent` }} />
    </span>
  );
}

// Burbuja de mensaje (mundo Aurora)
function Bubble({ m, onSpeak }: { m: Msg; onSpeak?: () => void }) {
  const [refsOpen, setRefsOpen] = useState(false);
  if (m.role === "user")
    return <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.userBubble, color: "#2B2740", borderRadius: "18px 18px 6px 18px", padding: "11px 15px", fontSize: 15, lineHeight: 1.5 }}>{m.content}</div>;
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "94%" }}>
      {m.streaming && !m.content ? <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "18px 18px 18px 6px", padding: "12px 16px", boxShadow: SOFT, color: C.dim, fontSize: 15, display: "inline-block" }}><Dots /></div>
        : (
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "18px 18px 18px 6px", padding: "13px 16px", boxShadow: SOFT, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 16, lineHeight: 1.6, flex: 1 }}>{m.content}</div>
            {m.content && !m.streaming && onSpeak && <button onClick={onSpeak} title="Leer en voz alta" style={{ background: "none", border: "none", color: C.accentSoft, cursor: "pointer", flexShrink: 0, padding: 2, display: "flex" }}><IconVolume size={16} /></button>}
          </div>
        )}
      <VerificationBadge v={m.verification} mode={m.mode} />
      {m.citations && m.citations.length > 0 && (() => {
        const seen = new Set<string>();
        // Dedupe por ROTULO: con material de varios cursos, dos "pág. 12" de
        // libros distintos son fuentes distintas y no se pueden colapsar.
        const refs = m.citations.filter((c) => { const k = c.label ?? `${c.page}·${c.source ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
        return (
          <div style={{ marginTop: 11 }}>
            <button onClick={() => setRefsOpen((o) => !o)} title={refsOpen ? "Ocultar fuentes" : "Ver de dónde salió esto"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: refsOpen ? "rgba(108,92,231,.10)" : C.panel2, border: `1px solid ${refsOpen ? C.accentSoft : C.border}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: refsOpen ? C.accentSoft : C.dim, transition: "border-color .15s, background .15s" }}
              onMouseEnter={(e) => { if (!refsOpen) e.currentTarget.style.borderColor = C.accentSoft; }} onMouseLeave={(e) => { if (!refsOpen) e.currentTarget.style.borderColor = C.border; }}>
              <span style={{ display: "flex", transform: refsOpen ? "rotate(90deg)" : "none", transition: "transform .18s" }}><IconChevron size={13} /></span>
              Fuentes en tu material ({refs.length})
            </button>
            {refsOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
                {refs.map((c) => <CiteChip key={c.index}>{c.label || (c.page != null ? `pág. ${c.page}` : `#${c.index}`)}{c.source === "pedagogy" ? " · guía" : ""}</CiteChip>)}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
function Note({ children, tone }: { children: React.ReactNode; tone: "warn" | "bad" }) {
  const t = tone === "bad" ? { c: C.badTx, bg: C.badBg } : { c: C.warnTx, bg: C.warnBg };
  return <div style={{ marginTop: 8, padding: "9px 12px", borderRadius: 12, background: t.bg, color: t.c, fontSize: 13, display: "flex", gap: 7, alignItems: "flex-start", lineHeight: 1.5 }}>{children}</div>;
}
/**
 * De dónde salió la respuesta. Tres estados, no uno.
 *
 * Antes esto arrancaba con `if (!v || grounded === false) return null` — o sea,
 * cuando NO había material no se mostraba nada. Tenía sentido mientras esa rama
 * devolvía una negativa fija (no había respuesta que sellar). Ahora que el tutor
 * responde igual, ese es justamente el caso que MÁS necesita marcador: es la
 * única señal de que lo que el chico está leyendo no salió de su libro.
 */
function VerificationBadge({ v, mode }: { v?: Verification | null; mode?: AnswerMode }) {
  // Sin material: el aviso va sí o sí, aunque no haya nada que verificar.
  if (mode === "general") {
    return (
      <div style={{ marginTop: 9, display: "inline-flex", gap: 7, alignItems: "flex-start", background: C.warnBg, color: C.warnTx, fontSize: 12.5, padding: "8px 12px", borderRadius: 12, lineHeight: 1.5, maxWidth: 460 }}>
        <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconAlert size={14} /></span>
        <span>Esto <strong>no está en tu libro</strong>. Te lo expliqué con lo que sé, así que conviene que lo chequees con tu profe.</span>
      </div>
    );
  }
  if (!v) return null;
  if (v.unavailable) return <div style={{ marginTop: 8, color: C.dim, fontSize: 12.5 }}>No pude verificar esta respuesta contra tu material.</div>;
  // Deriva: el material habla de otra cosa. Es la única alerta del verificador
  // que está calibrada contra datos, y por eso es la única que se muestra.
  if (mode === "apoyado" || v.grounded === false) {
    return (
      <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
        {v.contradicted?.length > 0 && <Note tone="bad"><IconAlert size={15} /><span>Tu material dice lo <strong>contrario</strong> de esto:<ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.contradicted.map((s, i) => <li key={i}>{s}</li>)}</ul></span></Note>}
      </div>
    );
  }
  return (v.checked ?? 0) > 0 ? (
    <div style={{ marginTop: 9, display: "inline-flex", gap: 6, alignItems: "center", background: C.okBg, color: C.okTx, fontFamily: FONT.round, fontWeight: 700, fontSize: 12, padding: "6px 11px", borderRadius: 12 }}>
      <IconCheck size={14} /> De tu libro
    </div>
  ) : null;
}
