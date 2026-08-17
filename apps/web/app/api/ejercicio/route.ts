import { armarTarjeta, puntos, type TarjetaEjercicio, type Punto } from "@tutor-ia/core";
import { requireCursoAbierto } from "@/lib/auth";

export const runtime = "nodejs";
// El CAS + la redacción de los pasos + la verificación de cada renglón.
export const maxDuration = 120;

export interface RespuestaEjercicio extends TarjetaEjercicio {
  curva?: { puntos: Punto[]; desde: number; hasta: number };
}

/**
 * POST /api/ejercicio — el desglose paso a paso de un ejercicio, verificado.
 * body: { question }
 *
 * DEVUELVE 204 CUANDO NO ES UN EJERCICIO, y eso es parte del contrato: el cliente
 * pregunta acá primero y, si no hay tarjeta, sigue por /api/chat como siempre.
 * Un problema con enunciado ("un tren sale de…") cae por acá y lo contesta el
 * chat, que razona mejor sobre las palabras — pero nunca con un "no sé
 * resolverlo": para el alumno tiene que ser un camino, no un rechazo.
 */
export async function POST(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const q = (body.question ?? "").trim();
  if (!q) return new Response(null, { status: 204 });

  let tarjeta: TarjetaEjercicio | null = null;
  try {
    tarjeta = await armarTarjeta(q);
  } catch {
    // Cualquier falla del CAS o del modelo cae al chat. El modo ejercicio es una
    // mejora sobre el camino normal, nunca un requisito para recibir respuesta.
    return new Response(null, { status: 204 });
  }
  if (!tarjeta) return new Response(null, { status: 204 });

  const salida: RespuestaEjercicio = { ...tarjeta };
  if (tarjeta.grafico) {
    const c = await puntos(tarjeta.grafico.expr, tarjeta.grafico.variable, tarjeta.raices).catch(() => null);
    if (c) salida.curva = c;
  }
  return Response.json(salida);
}
