"use client";
/**
 * LOS ÍCONOS DE LOS LOGROS — Phosphor Duotone, inline.
 *
 * Duotone y no Regular a propósito: un logro tiene que LUCIR cuando se gana. La
 * silueta clara con el detalle en tinta da profundidad sin usar color, así el
 * color queda libre para marcar el estado (ganado / pendiente).
 *
 * ⚠️ Y RESUELVE ALGO QUE CON EMOJI NO SE PODÍA: el pendiente se atenúa cambiando
 * el COLOR del ícono, no con `grayscale(1)` + `opacity: .45`. Ese filtro sobre un
 * emoji lo deja sucio y borroso; acá el dibujo queda nítido, solo más callado.
 */
import { ICONOS_LOGRO } from "./iconos-logros-datos";

export function IconoLogro({ id, size = 26, color = "currentColor" }: { id: string; size?: number; color?: string }) {
  const d = ICONOS_LOGRO[id];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill={color}
      dangerouslySetInnerHTML={{ __html: d }} />
  );
}
