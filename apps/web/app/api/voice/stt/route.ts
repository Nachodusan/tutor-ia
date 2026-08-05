import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const maxDuration = 60;

// Todo local: ffmpeg (audio del navegador → wav 16k) + whisper.cpp (→ texto).
const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ??
  "/Users/dusan/Documents/ia/packages/ingest-py/whisper-models/ggml-base.bin";

/**
 * Sobre AUDIO SIN VOZ, whisper no devuelve vacío: devuelve una ETIQUETA de
 * sonido —`[Música]`, `[BLANK_AUDIO]`, `(risas)`— y encima con confianza alta
 * (medido: 0,918 sobre 3s de ruido rosa puro). Si eso se manda al tutor, el
 * tutor le contesta a un silencio.
 *
 * ⚠️ NO se filtra por confianza, aunque `-ojf` la exponga por token: no separa.
 * Medido sobre la misma frase degradada — limpio 0,924 · ruido leve con un error
 * plausible ("células sexuales" por "vegetales") 0,808 · ruido fuerte con la
 * transcripción COMPLETAMENTE inventada 0,829. El caso peor puntúa más alto que
 * uno bueno-con-un-error: un umbral ahí es una moneda al aire. La basura que
 * igual pasa se ataja en el prompt del tutor (regla "si no entendés, no
 * adivines"), no acá.
 */
const NO_VOZ_RE =
  /^[\s]*(?:[[(][^\])]*[\])]|[*_~]+)[\s]*$/;

function limpiarTranscripcion(stdout: string): string {
  const t = stdout.replace(/\s+/g, " ").trim();
  if (!t || NO_VOZ_RE.test(t)) return "";
  // Quita las etiquetas que vengan PEGADAS a habla real ("[Música] hola").
  const sinEtiquetas = t.replace(/[[(](?:música|musica|risas|aplausos|blank_audio|silence|inaudible|ruido)[^\])]*[\])]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(sinEtiquetas) ? sinEtiquetas : "";
}

/** POST /api/voice/stt — body: audio (webm/wav/…) → { text }. */
export async function POST(req: Request) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return Response.json({ text: "" });

  const dir = await mkdtemp(join(tmpdir(), "stt-"));
  const inPath = join(dir, "in");
  const wavPath = join(dir, "audio.wav");
  try {
    await writeFile(inPath, buf);
    // Normalizar a WAV 16kHz mono (lo que espera whisper.cpp).
    await execFileAsync("ffmpeg", ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", wavPath], {
      timeout: 30000,
    });
    // Transcribir. -nt: sin timestamps; imprime el texto a stdout.
    const { stdout } = await execFileAsync(
      WHISPER_BIN,
      ["-m", WHISPER_MODEL, "-l", "es", "-nt", "-np", wavPath],
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
    );
    return Response.json({ text: limpiarTranscripcion(stdout) });
  } catch (err) {
    return Response.json(
      { text: "", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
