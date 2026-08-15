import type { ReactNode } from "react";
import { PomodoroProvider } from "./pomodoro";

export const metadata = {
  title: "Tutor IA",
  description: "Estudia con tus propios apuntes y libros",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif",
          background: "#FFFFFF",
          color: "#201C2B",
        }}
      >
        {/* El reloj de estudio se monta ACÁ ARRIBA DE TODO a propósito: el
            alumno arranca su bloque en el panel y sigue estudiando adentro de
            una materia. Colgado de cualquier página, el descanso se perdería en
            la primera navegación. No dibuja nada por su cuenta — el chip lo
            ponen los encabezados y el aviso de descanso aparece solo cuando
            toca. */}
        <PomodoroProvider>{children}</PomodoroProvider>
      </body>
    </html>
  );
}
