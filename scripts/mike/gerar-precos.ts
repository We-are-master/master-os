/**
 * Gera a seção de preços do Mike a partir do pricebook do OS (dono, 19/08:
 * "pegando nossos preços e colocando tudo isso na memória dele").
 *
 * A fonte é a MESMA do Harvey e do quote_ready: service_pricebook, só linha
 * `approved`, override do dono ganhando da fórmula. A seção é reescrita
 * entre os marcadores PRICEBOOK:INICIO/FIM em MIKE-2-KNOWLEDGE-precos.md —
 * o resto do documento (as perguntas de qualificação, as escadas, o tom)
 * fica intocado. Depois de rodar, o Victor recola o doc na knowledge base
 * do respond.io.
 *
 *   cd ~/master-os && npx tsx scripts/mike/gerar-precos.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(join(process.cwd(), arquivo), "utf8").split("\n")) {
      const m = linha.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
    }
  } catch { /* ok */ }
}

const DOC = join(process.cwd(), "docs/fixfy-mike/MIKE-2-KNOWLEDGE-precos.md");
const INICIO = "<!-- PRICEBOOK:INICIO (gerado por scripts/mike/gerar-precos.ts — NÃO editar à mão) -->";
const FIM = "<!-- PRICEBOOK:FIM -->";

type Linha = {
  trade: string; service: string; unit: string;
  price_gbp: number; min_charge_gbp: number | null; override_gbp: number | null;
};

const UNIDADE: Record<string, string> = {
  per_job: "fixed price", per_item: "each", per_room: "per room",
  per_door: "per door", per_m2: "per m²", per_hour: "per hour",
};

async function main(): Promise<void> {
  const r = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/service_pricebook?select=trade,service,unit,price_gbp,min_charge_gbp,override_gbp&status=eq.approved&order=trade.asc,service.asc`,
    { headers: { apikey: process.env.SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SERVICE_ROLE_KEY!}` } },
  );
  if (!r.ok) throw new Error(`pricebook HTTP ${r.status}`);
  const linhas = (await r.json()) as Linha[];

  const porTrade = new Map<string, Linha[]>();
  for (const l of linhas) {
    if (!porTrade.has(l.trade)) porTrade.set(l.trade, []);
    porTrade.get(l.trade)!.push(l);
  }

  const partes: string[] = [
    INICIO,
    "",
    "## The fixed price list (from our system)",
    "",
    "These are the exact prices, straight from our pricing system — the same",
    "one that fills `quote_ready`. Rules:",
    "",
    "- **If `quote_ready` is filled, that number wins over this list** — it",
    "  already includes materials for that exact enquiry.",
    "- From this list you quote the labour price and say materials come on",
    "  top: \"that covers the labour — materials are added at cost from our",
    "  supplier, I'll confirm the exact figure when we book\".",
    "- A job that is NOT on this list and not covered by the ladders is a",
    "  handoff. **Never invent a line, never average two lines.**",
    "- Per-m² lines: ask the size first. No size, no number.",
    "- Electrical INSTALLATION (sockets, lights, rewiring) is never offered",
    "  — certificates only. Hand off any install ask.",
    "",
  ];

  for (const [trade, ls] of [...porTrade.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    partes.push(`### ${trade.replace(/_/g, " ")}`, "");
    for (const l of ls) {
      const preco = l.override_gbp ?? l.price_gbp;
      const unidade = UNIDADE[l.unit] ?? l.unit;
      const minimo = l.min_charge_gbp ? ` (minimum £${Number(l.min_charge_gbp).toFixed(0)})` : "";
      partes.push(`- ${l.service} — **£${Number(preco).toFixed(2)}** ${unidade}${minimo}`);
    }
    partes.push("");
  }
  partes.push(FIM);
  const secao = partes.join("\n");

  let doc = readFileSync(DOC, "utf8");
  if (doc.includes(INICIO)) {
    doc = doc.replace(new RegExp(`${INICIO}[\\s\\S]*?${FIM}`), secao);
  } else {
    doc = `${doc.trimEnd()}\n\n---\n\n${secao}\n`;
  }
  writeFileSync(DOC, doc);
  console.log(`${linhas.length} linhas aprovadas em ${porTrade.size} trades → ${DOC}`);
  console.log(`tamanho final do doc: ${doc.length} chars`);
}

main().catch((err) => { console.error(err); process.exit(1); });
