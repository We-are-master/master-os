// Confere o fetcher do painel Auto-flow contra o banco real (leitura pura).
import { readFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}
Promise.all([
  import("../../src/lib/supabase/service"),
  import("../../src/lib/pulse-auto-flow"),
]).then(async ([{ createServiceClient }, { fetchPulseAutoFlow }]) => {
  const supabase = createServiceClient();
  const fromIso = new Date(Date.now() - 30 * 864e5).toISOString();
  const toIso = new Date().toISOString();
  const r = await fetchPulseAutoFlow(supabase, { fromIso, toIso } as never);
  console.log(JSON.stringify(r, null, 1));
});
