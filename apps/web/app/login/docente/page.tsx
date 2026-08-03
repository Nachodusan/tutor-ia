"use client";
import { C, FONT, HARD, IconUsers } from "../../ui";
import { FormularioLogin } from "../form";

/**
 * Puerta del DOCENTE.
 *
 * Existe separada de `/login` porque las dos personas que entran no se parecen
 * en nada: el chico busca su tutor, el profe busca el estado de su curso. Una
 * sola pantalla obligaba a que el texto sirviera para los dos y no le hablara
 * bien a ninguno ("pedile una contraseña nueva a tu profe" es absurdo si vos SOS
 * el profe).
 *
 * Va en el mundo BLOQUES —cobalto, borde de tinta, sombra dura— y no en Aurora:
 * el docente tiene que reconocer al entrar que está del lado del panel, no del
 * lado de la conversación.
 *
 * La ruta cuelga de `/login` a propósito: el matcher del middleware deja pasar
 * todo lo que empieza con `login`, así que la pantalla es pública sin ninguna
 * regla nueva que se pueda olvidar de mantener.
 */
export default function LoginDocentePage() {
  return (
    <main style={{
      minHeight: "100dvh", background: C.bg, fontFamily: FONT.sans, color: C.text,
      display: "grid", placeItems: "center", padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", placeItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{
            width: 62, height: 62, borderRadius: 17, background: C.accent, color: "#fff",
            display: "grid", placeItems: "center",
            border: `2px solid ${C.ink}`, boxShadow: HARD(C.coral),
          }}>
            <IconUsers size={28} />
          </span>
          <h1 style={{
            fontFamily: FONT.round, fontSize: 26, fontWeight: 800, margin: 0,
            color: C.ink, letterSpacing: -0.4, textAlign: "center",
          }}>
            Panel del curso
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: C.dim, textAlign: "center", lineHeight: 1.55 }}>
            Ingreso para docentes. Vas a ver el avance de tu curso y los temas que
            le están costando.
          </p>
        </div>

        <FormularioLogin
          acento={C.accent}
          ctaLabel="Entrar al panel"
          onEntro={(u) => {
            // Una cuenta de alumno se rechaza ACÁ, con el nombre de la cuenta a la
            // vista. Dejarla pasar la mandaba a /docente a chocar contra un 403 y
            // volver, que es el recorrido que hacía parecer la app rota.
            if (u.role !== "teacher" && u.role !== "admin") {
              return `"${u.username}" es una cuenta de alumno. Entrá por la pantalla de alumnos, o pedí tu cuenta de docente en el colegio.`;
            }
            window.location.href = "/docente";
          }}
        />

        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: C.dim, textAlign: "center", lineHeight: 1.55 }}>
          ¿Perdiste tu contraseña? Pedí que te la reseteen: no guardamos ningún
          dato con el que podamos recuperarla.
        </p>

        <p style={{ margin: 0, textAlign: "center" }}>
          <a href="/login" style={{ fontSize: 12.5, color: C.dim, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
            Soy alumno
          </a>
        </p>
      </div>
    </main>
  );
}
