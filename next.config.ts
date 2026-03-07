import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Use project directory as root so build is consistent in CI/deploy (no workspace root warning)
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
