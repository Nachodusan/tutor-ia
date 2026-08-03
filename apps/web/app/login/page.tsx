"use client";
import { C, AURORA, CTA, FONT } from "../ui";
import { FormularioLogin } from "./form";

/**
 * Puerta del ALUMNO. NO hay registro: las cuentas las crea el equipo con el CLI
 * y el colegio reparte usuario y contraseña en papel.
 *
 * La del docente es otra pantalla (`/login/docente`), y la diferencia es
 * deliberada: acá el mundo es Aurora (orbe, lavanda, tuteo de chico); allá es
 * Bloques (cobalto, borde de tinta, tono adulto). Que se vean distintas es lo
 * que hace que nadie se equivoque de puerta sin darse cuenta.
 */
export default function LoginPage() {
  return (
    <main style={{
      minHeight: "100dvh", background: C.bg, fontFamily: FONT.sans, color: C.text,
      display: "grid", placeItems: "center", padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14 }}>
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

        <FormularioLogin
          acento={CTA}
          onEntro={(u) => {
            // Un docente que entra por acá NO se rechaza: se lo lleva a su panel.
            // Rebotarlo sería castigarlo por un error de navegación inofensivo.
            window.location.href = u.role === "teacher" || u.role === "admin" ? "/docente" : "/";
          }}
        />

        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: C.dim, textAlign: "center", lineHeight: 1.5 }}>
          ¿Perdiste tu contraseña? Pedile una nueva a tu profe: por seguridad no
          guardamos ningún dato tuyo, así que no podemos recuperarla.
        </p>

        {/* Discreto a propósito: el chico no tiene que verlo, el profe sí. */}
        <p style={{ margin: 0, textAlign: "center" }}>
          <a href="/login/docente" style={{ fontSize: 12.5, color: C.dim, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
            Soy docente
          </a>
        </p>
      </div>
    </main>
  );
}
