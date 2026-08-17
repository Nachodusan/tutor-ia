import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toSpeech } from "@/lib/speech";
import { getSql } from "@tutor-ia/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { buscarVoz, type Voz } from "../../../voces";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const maxDuration = 60;

// TTS local con la voz del sistema (macOS `say`). 100% en la máquina.
//
// Voz: el corpus es CHILENO, así que la voz por defecto es latinoamericana
// (Paulina, es_MX) y no Mónica (es_ES) — a un chico de acá una voz de España le
// suena ajena antes de decir nada. Si el usuario baja las voces "Mejorada/Premium"
// desde Ajustes del Sistema › Accesibilidad › Contenido hablado, se prefieren
// solas: son las que de verdad dejan de sonar a robot.
const PREFERIDAS = [
  "Paulina (Premium)", "Mónica (Premium)",
  "Paulina (Enhanced)", "Mónica (Enhanced)",
  "Paulina (Mejorada)", "Mónica (Mejorada)",
  "Paulina", "Mónica",
];
// Ritmo: por defecto NO se pasa `-r`. Medido: el rate natural de Paulina ya es
// ~24% más lento que el de Mónica (4,15s contra 3,3s la misma frase), que es el
// ritmo que uno quiere con un chico. Además `say` cuantiza: 160, 172 y 180 dan
// EXACTAMENTE el mismo audio, así que afinar de a poco no hace nada.
const TTS_RATE = process.env.TTS_RATE ? ["-r", String(Number(process.env.TTS_RATE))] : [];

/** Se resuelve UNA vez por proceso: `say -v '?'` tarda ~150ms. */
let voicePromise: Promise<string> | null = null;
function pickVoice(): Promise<string> {
  if (process.env.TTS_VOICE) return Promise.resolve(process.env.TTS_VOICE);
  voicePromise ??= execFileAsync("say", ["-v", "?"], { timeout: 5000 })
    .then(({ stdout }) => {
      // Cada línea: "Paulina             es_MX    # ¡Hola! Me llamo Paulina."
      // El nombre se corta por el CÓDIGO DE IDIOMA, no por espacios: los nombres
      // compuestos van pegados al código ("Eddy (Español (España)) es_ES"), así
      // que partir por espacios se los come.
      const instaladas = new Set(
        stdout
          .split("\n")
          .map((l) => /^(.+?)\s+[a-z]{2}(?:_[A-Z]{2})?\s+#/.exec(l)?.[1])
          .filter(Boolean) as string[],
      );
      return PREFERIDAS.find((v) => instaladas.has(v)) ?? "Paulina";
    })
    .catch(() => "Paulina");
  return voicePromise;
}

/**
 * Voz REMOTA (DeepInfra). Devuelve el audio o `null` si no se pudo — el llamador
 * cae al sistema. Nunca se le pasa texto del navegador como modelo: `voz` sale
 * del catálogo, que es la lista blanca.
 */
async function hablarRemoto(
  voz: Voz,
  texto: string,
): Promise<{ audio: Buffer; tipo: string } | null> {
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key || !voz.modelo) return null;
  try {
    const r = await fetch(`https://api.deepinfra.com/v1/inference/${voz.modelo}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto, ...(voz.extra ?? {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) {
      console.error(`[tts] ${voz.id}: HTTP ${r.status}`);
      return null;
    }
    const j = (await r.json()) as { audio?: string; output_format?: string };
    // Llega como data URI: "data:audio/mp3;base64,…".
    const b64 = j.audio?.split(",")[1];
    if (!b64) return null;
    const fmt = j.output_format === "mp3" ? "mpeg" : (j.output_format ?? "wav");
    return { audio: Buffer.from(b64, "base64"), tipo: `audio/${fmt}` };
  } catch (e) {
    console.error(`[tts] ${voz.id} falló: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * POST /api/voice/tts — body: { text, probar? } → audio.
 *
 * LA VOZ SALE DEL PERFIL, no del cuerpo del pedido. Es lo que hace que ninguna
 * cadena escrita por el navegador termine en un argumento de `say` ni en una URL
 * de inferencia. Y como es del alumno y no del aparato, lo sigue al teléfono.
 *
 * `probar` ES LA ÚNICA EXCEPCIÓN, y existe porque sin ella el probador de voces
 * era mentira: los cinco botones "Probar" del panel sonaban todos con la voz YA
 * guardada, así que elegir a ciegas —justo lo que ese botón vino a evitar—.
 *
 * No rompe la propiedad de arriba: `probar` es una CLAVE en la lista blanca, no
 * un valor. `buscarVoz` la resuelve contra el catálogo y lo desconocido cae en
 * la voz por defecto; lo que llega a `say` o a la URL sale siempre de
 * `voces.ts`, nunca del pedido. Y no toca el perfil: probar no es elegir.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return unauthorized();
  const { text, probar } = (await req.json()) as { text?: string; probar?: string };

  const sql = getSql();
  const [perfil] = await sql<{ tts_voice: string | null }[]>`
    select tts_voice from student_profiles where user_id = ${auth.userId}::uuid`;
  const voz = buscarVoz(typeof probar === "string" ? probar : perfil?.tts_voice);

  // Se corta el texto CRUDO y se normaliza después: al revés, el corte podría
  // caer dentro de un `[[slnc …]]` nuestro y `say` leería el comando a medias.
  // La prosodia solo va para `say`: los otros motores leen los comandos en voz alta.
  const clean = toSpeech((text ?? "").slice(0, 4000), { prosodia: voz.motor === "sistema" });
  if (!clean) return new Response("Nada que leer.", { status: 400 });

  if (voz.motor === "deepinfra") {
    const remoto = await hablarRemoto(voz, clean);
    if (remoto) {
      return new Response(new Uint8Array(remoto.audio), {
        headers: { "Content-Type": remoto.tipo, "Cache-Control": "no-cache" },
      });
    }
    // CAE AL SISTEMA en vez de devolver error: el chico está esperando una
    // respuesta hablada, y una voz fea es infinitamente mejor que el silencio.
    console.warn(`[tts] ${voz.id} no respondió; se usa la voz del sistema`);
  }

  const voice = voz.vozSistema || (await pickVoice());
  const clean2 = voz.motor === "sistema" ? clean : toSpeech((text ?? "").slice(0, 4000));
  const dir = await mkdtemp(join(tmpdir(), "tts-"));
  const wav = join(dir, "out.wav");
  try {
    await execFileAsync(
      "say",
      ["-v", voice, ...TTS_RATE, "-o", wav, "--data-format=LEI16@22050", clean2],
      { timeout: 45000 },
    );
    const audio = await readFile(wav);
    return new Response(audio, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
