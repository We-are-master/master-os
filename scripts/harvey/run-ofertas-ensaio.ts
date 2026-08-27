// Roda o vigia de ofertas uma vez, em modo ensaio (nunca arma). Uso manual.
import { readFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}
delete process.env.HARVEY_OFERTAS_ARMADO;
import("../../src/lib/auto-assign-sweep").then(async ({ varrerOfertas }) => {
  const r = await varrerOfertas();
  console.log("resultado:", JSON.stringify(r));
});
