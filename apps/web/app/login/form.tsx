"use client";
import { useState } from "react";
import { C, FONT } from "../ui";

/**
 * El formulario de ingreso, compartido por las DOS puertas: la del alumno
 * (`/login`) y la del docente (`/login/docente`).
 *
 * Por qué compartido y no copiado: lo que cambia entre las dos pantallas es el
 * color, el texto y a dónde va cada uno después. Lo que NO cambia es el manejo
 * de credenciales — y ese es justamente el código que no puede divergir sin que
 * nadie se entere. Un bug de auth arreglado en una copia y no en la otra es el
 * peor final posible para una duplicación "inofensiva".
 */

export interface UsuarioIngresado {
  username: string;
  role: string;
  /** true = todavía no eligió curso (solo aplica al alumno). */
  needsSetup: boolean;
}

export function FormularioLogin({
  acento,
  ctaLabel = "Entrar",
  autoFocus = true,
  onEntro,
}: {
  /** Color del botón. Distingue de un vistazo la puerta del alumno de la del profe. */
  acento: string;
  ctaLabel?: string;
  autoFocus?: boolean;
  /**
   * Qué hacer con la sesión ya creada. Si devuelve un string, ese texto se
   * muestra como error y la sesión se cierra — así la puerta equivocada avisa
   * en vez de dejar entrar y rebotar después.
   */
  onEntro: (u: UsuarioIngresado) => Promise<string | void> | string | void;
}) {
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
      const j = (await r.json()) as { user?: { username?: string; role?: string }; needsSetup?: boolean };
      const rechazo = await onEntro({
        username: j.user?.username ?? "",
        role: j.user?.role ?? "student",
        needsSetup: !!j.needsSetup,
      });
      if (typeof rechazo === "string") {
        // Puerta equivocada: la sesión recién creada se cierra. Dejarla abierta
        // sería peor que no dejar entrar — quedaría logueado sin saberlo.
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        setError(rechazo);
        setPassword("");
        setEnviando(false);
      }
      // Si no hubo rechazo, `onEntro` ya navegó: no se apaga `enviando` a
      // propósito, para que no se pueda mandar dos veces mientras carga.
    } catch {
      setError("No hay conexión con el servidor.");
      setEnviando(false);
    }
  }

  const listo = !!username.trim() && !!password;

  return (
    <form onSubmit={entrar} style={{ display: "grid", gap: 14 }}>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.dim }}>Usuario</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={autoFocus}
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
          borderRadius: 12, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={enviando || !listo}
        style={{
          marginTop: 4, padding: "14px 18px", borderRadius: 16, border: "none",
          background: acento, color: "#fff", fontFamily: FONT.round, fontSize: 16.5,
          fontWeight: 800, cursor: enviando ? "default" : "pointer",
          opacity: enviando || !listo ? 0.55 : 1,
        }}
      >
        {enviando ? "Entrando…" : ctaLabel}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "13px 14px", borderRadius: 14, border: `1px solid ${C.border}`,
  background: C.panel2, fontSize: 16, fontFamily: FONT.sans, color: C.text, outline: "none",
};
