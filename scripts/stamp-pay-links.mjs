/**
 * Carimba o link de pagamento estável (/pay/<ref>) nas invoices abertas que
 * ainda não têm nenhum link do Stripe.
 *
 * Invoices novas já nascem com o link (createInvoice); este script cobre o
 * estoque antigo. Não toca em quem já tem stripe_payment_link_url (os links
 * legados de Payment Link continuam valendo) nem em paga/cancelada.
 *
 *   node scripts/stamp-pay-links.mjs           # modo seco: só lista
 *   node scripts/stamp-pay-links.mjs --gravar
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRAVAR = process.argv.includes("--gravar");

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) {
  console.error("Faltou NEXT_PUBLIC_SUPABASE_URL / SERVICE_ROLE_KEY no .env(.local)");
  process.exit(1);
}
const SH = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

const BASE = (env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.getfixfy.com");

const res = await fetch(
  `${SB}/rest/v1/invoices?select=id,reference,status,stripe_payment_link_url&stripe_payment_link_url=is.null&status=not.in.(paid,cancelled)&order=created_at.desc&limit=2000`,
  { headers: SH },
);
if (!res.ok) {
  console.error("Falha lendo invoices:", res.status, await res.text());
  process.exit(1);
}
const rows = await res.json();
console.log(`${rows.length} invoices abertas sem link.`);

let ok = 0, erro = 0;
for (const inv of rows) {
  const ref = String(inv.reference ?? "").trim();
  if (!ref) continue;
  const url = `${BASE}/pay/${encodeURIComponent(ref)}`;
  if (!GRAVAR) {
    console.log(`  ${ref}  →  ${url}`);
    continue;
  }
  const up = await fetch(`${SB}/rest/v1/invoices?id=eq.${inv.id}`, {
    method: "PATCH",
    headers: SH,
    body: JSON.stringify({ stripe_payment_link_url: url }),
  });
  if (up.ok) ok++;
  else {
    erro++;
    console.error(`  falhou ${ref}:`, up.status, await up.text());
  }
}
if (GRAVAR) console.log(`Gravado: ${ok} · falhas: ${erro}`);
else console.log("Modo seco. Rode com --gravar para carimbar.");
