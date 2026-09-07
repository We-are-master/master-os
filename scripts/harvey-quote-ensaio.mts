/**
 * ENSAIO do fluxo de quote: lê o ticket, cota, e diz QUEM convidaria.
 * Não posta nota, não cria quote, não convida ninguém.
 *
 *   npx tsx scripts/harvey-quote-ensaio.mts 50156 50001 49869
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
for (const a of [".env.local", ".env"]) {
  try { for (const l of readFileSync(join(process.cwd(), a), "utf8").split("\n")) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!; } } catch {}
}
const { createClient } = await import("@supabase/supabase-js");
const { lerTicketCompleto, consolidarPedido } = await import("../src/lib/zendesk-quoter/quoter");
const { executarPriceCheck } = await import("../src/lib/orcamentista/price-check");
const { organizacaoDoTicket } = await import("../src/lib/organizacoes/do-ticket");
const { matchPartnerIdsForWork } = await import("../src/lib/partner-work-matching");
const { extractUkPostcode } = await import("../src/lib/uk-postcode");
const { normalizeTypeOfWork } = await import("../src/lib/type-of-work");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!);
const apiKey = process.env.OPENAI_API_KEY!.trim();

for (const id of process.argv.slice(2)) {
  const t = await lerTicketCompleto(Number(id));
  const org = await organizacaoDoTicket(t);
  const p = await consolidarPedido(t, apiKey);
  const r = await executarPriceCheck(p.quoteRequest, p.scopeOfWork);
  const endereco = p.propertyAddress ?? p.postcode;
  const porTrade = new Map<string, number>();
  for (const sv of r.quote.services as any[]) {
    const t = (sv.trade ?? "").trim();
    if (t) porTrade.set(t, (porTrade.get(t) ?? 0) + (Number(sv.lineTotal) || 0));
  }
  const tradesDaQuote = [...porTrade.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const trade = normalizeTypeOfWork(r.quote.services[0]?.trade ?? "").trim() || "General Maintenance";

  const pc = extractUkPostcode(endereco) ?? endereco;
  let ids: string[] = []; let usado = trade;
  for (const cand of [trade, ...tradesDaQuote, "General Maintenance"].filter((x, i, a) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)) {
    ids = await matchPartnerIdsForWork(sb as never, { serviceType: cand, catalogServiceId: null, postcode: pc, kind: "lead" });
    if (ids.length > 0) { usado = cand; break; }
  }
  if (ids.length === 0) { console.log("  convites:    nenhum parceiro casa em nenhum trade"); continue; }
  const { data: ps } = await sb.from("partners").select("company_name, contact_name").in("id", ids);
  console.log(`  convites:    ${ids.length} parceiro(s) via ${usado}${usado !== trade ? "  ← fallback" : ""} → ${(ps ?? []).map((x: any) => x.company_name || x.contact_name).join(", ")}`);
}
