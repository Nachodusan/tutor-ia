import { requireCursoAbierto } from "@/lib/auth";
import { repasoDeHoy } from "@/lib/repaso";

export const runtime = "nodejs";

/**
 * GET /api/reforzar/hoy → los tres temas del día, con su estado.
 *
 * Arma la sesión si todavía no existe. Es un GET que escribe, y está bien: la
 * sesión del día es una consecuencia de abrir la pantalla, no una acción del
 * alumno — no hay nada que confirmar ni deshacer. El `on conflict do nothing`
 * de adentro hace que dos pestañas abriendo a la vez terminen con la misma.
 */
export async function GET(req: Request) {
  const auth = await requireCursoAbierto(req);
  if (auth instanceof Response) return auth;
  return Response.json(await repasoDeHoy(auth.userId));
}
