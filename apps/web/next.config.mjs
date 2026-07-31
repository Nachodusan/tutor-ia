import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Next solo lee archivos .env de apps/web/. El entorno de este monorepo vive en
// UN solo .env en la raíz (para que la web y los scripts de eval midan con los
// mismos valores y no se desincronicen). Lo cargamos explícitamente.
//
// Ojo: process.loadEnvFile NO pisa variables ya presentes en el entorno, así que
// lo que venga de .claude/launch.json manda sobre el .env. Por eso LLM_MODEL se
// sacó de launch.json: si quedara ahí, con LLM_PROVIDER=deepinfra el provider
// remoto recibiría el tag de Ollama ("qwen2.5:7b") y respondería 404.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Los paquetes del workspace son TS sin transpilar; que Next los compile.
  transpilePackages: ["@tutor-ia/core", "@tutor-ia/rag", "@tutor-ia/db"],
  serverExternalPackages: ["pdf-parse", "postgres"],
};

export default nextConfig;
