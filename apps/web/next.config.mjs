/** @type {import('next').NextConfig} */
const nextConfig = {
  // Los paquetes del workspace son TS sin transpilar; que Next los compile.
  transpilePackages: ["@tutor-ia/core", "@tutor-ia/rag", "@tutor-ia/db"],
  serverExternalPackages: ["pdf-parse", "postgres"],
};

export default nextConfig;
