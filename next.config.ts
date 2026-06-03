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
  /** Gzip/brotli is handled by Next at the edge — non-default. */
  compress: true,
  /** Per-symbol imports for libraries that don't ship ESM-only barrels — saves ~15-30% bundle on
   *  pages that touch date-fns / radix / lucide / recharts (we touch all of them on the dashboard). */
  modularizeImports: {
    "date-fns": {
      transform: "date-fns/{{member}}",
      preventFullImport: true,
    },
  },
  /** Fewer modules to trace on first compile (many dashboard pages import lucide icons / radix / recharts). */
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
  },
  /**
   * Public link aliases. The same /quote/respond page handles three token
   * kinds (customer accept/reject, partner bid, partner report) — these
   * rewrites let each kind ship a URL whose path actually describes what
   * the page is doing, without duplicating the page itself.
   *
   *   /job/report?token=…   → partner work-report submission
   *   /quote/bid?token=…    → partner bid submission
   *   /quote/respond?token=… → legacy / customer accept/reject (kept as-is)
   */
  async rewrites() {
    return [
      { source: "/partners", destination: "/partners/index.html" },
      { source: "/job/report",  destination: "/quote/respond" },
      { source: "/quote/bid",   destination: "/quote/respond" },
    ];
  },
};

export default nextConfig;
