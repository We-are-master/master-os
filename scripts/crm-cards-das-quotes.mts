/**
 * Quotes abertas sem card no CRM ganham o card (06/11/2026, dono). Faz para
 * cada uma o mesmo que a sincronização de quote faz hoje (sincronizarLeadDaQuote):
 * liga ao lead do ticket, senão ao card aberto do cliente, senão cria em Quoting
 * e alinha a etapa pela quote. Só quotes abertas: recusada e convertida ficam.
 *
 *   npx tsx scripts/crm-cards-das-quotes.mts             ensaio: só conta e lista
 *   npx tsx scripts/crm-cards-das-quotes.mts --aplicar   grava
 *   --dias=N   só quotes criadas nos últimos N dias (padrão: todas)
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(new URL(`../${arq}`, import.meta.url), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const { sincronizarLeadDaQuote } = await import("../src/lib/crm/lead-servidor");

const aplicar = process.argv.includes("--aplicar");
const diasArg = process.argv.find((a) => a.startsWith("--dias="));
const dias = diasArg ? Number(diasArg.split("=")[1]) : null;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });

const ABERTAS = ["draft", "in_survey", "bidding", "quote_ready", "awaiting_customer", "awaiting_payment"];
type Q = { id: string; reference: string; status: string; client_id: string | null; client_name: string | null; external_source: string | null; external_ref: string | null; created_at: string };

const quotes: Q[] = [];
for (let de = 0; ; de += 1000) {
  let q = sb
    .from("quotes")
    .select("id, reference, status, client_id, client_name, external_source, external_ref, created_at")
    .is("lead_id", null)
    .is("deleted_at", null)
    .in("status", ABERTAS)
    .order("created_at", { ascending: false })
    .range(de, de + 999);
  if (dias) q = q.gte("created_at", new Date(Date.now() - dias * 86_400_000).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  quotes.push(...((data ?? []) as Q[]));
  if ((data ?? []).length < 1000) break;
}

const conta: Record<string, number> = {};
const somar = (k: string) => (conta[k] = (conta[k] ?? 0) + 1);
const linhas: string[] = [];
const porStatus: Record<string, number> = {};
const porIdade: Record<string, number> = {};

for (const q of quotes) {
  porStatus[q.status] = (porStatus[q.status] ?? 0) + 1;
  const d = (Date.now() - Date.parse(q.created_at)) / 86_400_000;
  porIdade[d <= 14 ? "até 14 dias" : d <= 60 ? "15 a 60 dias" : "mais de 60 dias"] = (porIdade[d <= 14 ? "até 14 dias" : d <= 60 ? "15 a 60 dias" : "mais de 60 dias"] ?? 0) + 1;

  // O que a sincronização faria (sem gravar).
  let destino = "cria card novo";
  if (q.external_source === "zendesk" && q.external_ref) {
    const { data } = await sb.from("leads").select("reference, stage").eq("external_source", "zendesk").eq("external_ref", q.external_ref).is("deleted_at", null).maybeSingle();
    if (data && data.stage !== "won") destino = `liga ao ${data.reference} (ticket)`;
  }
  if (destino === "cria card novo" && q.client_id) {
    const { data } = await sb.from("leads").select("id, reference").eq("client_id", q.client_id).in("stage", ["new", "qualified"]).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) {
      const { count } = await sb.from("quotes").select("id", { count: "exact", head: true }).eq("lead_id", data.id).is("deleted_at", null);
      if (!count) destino = `liga ao ${data.reference} (cliente)`;
    }
  }
  somar(destino.startsWith("liga") ? destino.replace(/LD-\S+ /, "") : destino);
  linhas.push(`${q.reference.padEnd(14)} ${q.status.padEnd(18)} ${q.created_at.slice(0, 10)}  ${(q.client_name ?? "").slice(0, 26).padEnd(26)} → ${destino}`);
  if (aplicar) await sincronizarLeadDaQuote(sb, q.id);
}

console.log(`${aplicar ? "Aplicado" : "Ensaio"}: ${quotes.length} quotes abertas sem card${dias ? ` (últimos ${dias} dias)` : ""}.`);
console.log("Por status:", porStatus);
console.log("Por idade:", porIdade);
console.log("Destino:", conta);
for (const l of linhas) console.log("  " + l);
