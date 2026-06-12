import { existsSync, readFileSync } from "node:fs";

function loadEnvFile(name: string) {
  if (!existsSync(name)) return;
  for (const raw of readFileSync(name, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const { publishClientCatalogSnapshot } = await import("../src/services/client-catalog-storage.ts");
  const r = await publishClientCatalogSnapshot();
  console.log(
    JSON.stringify(
      {
        ok: true,
        liveUrl: r.liveUrl,
        htmlUrl: r.htmlUrl,
        pdfUrl: r.pdfUrl,
        totalActive: r.totalActive,
        publishedAt: r.publishedAt,
        warnings: r.warnings,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
