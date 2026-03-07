import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// Raiz do projeto = pasta onde está este next.config (não process.cwd()).
// Garante que tailwindcss e outros módulos sejam resolvidos corretamente
// mesmo quando o terminal está na pasta pai (ex.: workspace com múltiplas raizes).
const projectRoot =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(projectRoot),
  },
};

export default nextConfig;
