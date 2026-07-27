import type { ReactNode } from "react";

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
        {children}
      </body>
    </html>
  );
}
