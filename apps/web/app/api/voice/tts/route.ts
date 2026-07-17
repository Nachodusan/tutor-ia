import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const maxDuration = 60;

// TTS local con la voz del sistema (macOS `say`). 100% en la máquina.
const TTS_VOICE = process.env.TTS_VOICE ?? "Mónica";

/** POST /api/voice/tts — body: { text } → audio/wav. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  const clean = (text ?? "").slice(0, 4000).trim();
  if (!clean) return new Response("Falta 'text'.", { status: 400 });

  const dir = await mkdtemp(join(tmpdir(), "tts-"));
  const wav = join(dir, "out.wav");
  try {
    await execFileAsync(
      "say",
      ["-v", TTS_VOICE, "-o", wav, "--data-format=LEI16@22050", clean],
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
