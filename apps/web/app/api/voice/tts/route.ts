import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toSpeech } from "@/lib/speech";

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

/** POST /api/voice/tts — body: { text } → audio/wav. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  // Se corta el texto CRUDO y se normaliza después: al revés, el corte podría
  // caer dentro de un `[[slnc …]]` nuestro y `say` leería el comando a medias.
  const clean = toSpeech((text ?? "").slice(0, 4000));
  if (!clean) return new Response("Nada que leer.", { status: 400 });

  const voice = await pickVoice();
  const dir = await mkdtemp(join(tmpdir(), "tts-"));
  const wav = join(dir, "out.wav");
  try {
    await execFileAsync(
      "say",
      ["-v", voice, ...TTS_RATE, "-o", wav, "--data-format=LEI16@22050", clean],
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
