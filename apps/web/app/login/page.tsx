"use client";
import { useState } from "react";

/**
 * Pantalla de ingreso. NO hay registro: las cuentas las crea el equipo con el
 * CLI y el colegio reparte usuario y contraseña en papel.
 *
 * Los tokens de estilo están duplicados de page.tsx a propósito, por ahora: son
 * dos pantallas y extraerlos a un módulo compartido tocaría las 1200 líneas de
 * page.tsx sin necesidad. Si aparece una tercera pantalla, extraerlos.
 */
const C = {
  bg: "#FFFFFF", panel2: "#F4F2EC", ink: "#191621", border: "#EAE4D8",
  text: "#201C2B", dim: "#5E5769", accentSoft: "#6C5CE7",
  bad: "#D42419", badBg: "#FCE6E4", badTx: "#B01A12",
};
const AURORA = "radial-gradient(circle at 38% 30%, #9DA8FF, #B6A8F5 32%, #FF9E7B 82%, #FFC7A6)";
const CTA = `linear-gradient(135deg, ${C.accentSoft}, #8A78F0)`;
const FONT = {
  round: "'ui-rounded', 'SF Pro Rounded', -apple-system, system-ui, sans-serif",
  sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif",
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError("");
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "No pudimos entrar. Probá de nuevo.");
        setEnviando(false);
        return;
      }
      // Recarga completa y no router.push: así el middleware ve la cookie nueva
      // y el estado del cliente arranca limpio.
      window.location.href = "/";
    } catch {
      setError("No hay conexión con el servidor.");
      setEnviando(false);
    }
  }

  return (
    <main style={{
      minHeight: "100dvh", background: C.bg, fontFamily: FONT.sans, color: C.text,
      display: "grid", placeItems: "center", padding: 20,
    }}>
      <form onSubmit={entrar} style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", placeItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ width: 76, height: 76, borderRadius: "50%", background: AURORA }} />
          <h1 style={{
            fontFamily: FONT.round, fontSize: 26, fontWeight: 800, margin: 0,
            color: C.ink, letterSpacing: -0.4,
          }}>
            Entrá a estudiar
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: C.dim, textAlign: "center" }}>
            Usá el usuario y la contraseña que te dieron en el colegio.
          </p>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.dim }}>Usuario</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
            style={inputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.dim }}>Contraseña</span>
          <input
            type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            style={inputStyle}
          />
        </label>

        {error && (
          <div role="alert" style={{
            background: C.badBg, color: C.badTx, border: `1px solid ${C.bad}33`,
            borderRadius: 12, padding: "10px 12px", fontSize: 13.5,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={enviando || !username.trim() || !password}
          style={{
            marginTop: 4, padding: "14px 18px", borderRadius: 16, border: "none",
            background: CTA, color: "#fff", fontFamily: FONT.round, fontSize: 16.5,
            fontWeight: 800, cursor: enviando ? "default" : "pointer",
            opacity: enviando || !username.trim() || !password ? 0.55 : 1,
          }}
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>

        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: C.dim, textAlign: "center", lineHeight: 1.5 }}>
          ¿Perdiste tu contraseña? Pedile una nueva a tu profe: por seguridad no
          guardamos ningún dato tuyo, así que no podemos recuperarla.
        </p>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "13px 14px", borderRadius: 14, border: `1px solid ${C.border}`,
  background: C.panel2, fontSize: 16, fontFamily: FONT.sans, color: C.text, outline: "none",
};
