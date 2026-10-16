/**
 * Express aceito fora do horário do WhatsApp (8h-20h): o template de boas-vindas
 * não saiu na hora e a nota do ticket diz "sai às 8h". Este script manda.
 *
 *   NODE_OPTIONS=--dns-result-order=ipv4first npx tsx scripts/harvey-wa/express-pendentes.mts            ensaio
 *   ... --enviar                                                                                       manda
 *
 * Pega jobs da conta Checkatrade criados nas últimas 36 h, não cancelados, com
 * ticket, que ainda não têm linha em harvey_wa_leads. Seguro de rodar de novo.
 */
import { readFileSync } from "node:fs";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const { createServiceClient } = await import("../../src/lib/supabase/service");
const { CONTA_DO_EXPRESS, expressLigado, mandarTemplateDoExpress } = await import("../../src/lib/harvey-wa/express");
const { dentroDaJanela } = await import("../../src/lib/agent/sales/dispatch-one");

const ENVIAR = process.argv.includes("--enviar");
if (ENVIAR && !expressLigado()) {
  console.log("HARVEY_WA_EXPRESS_ON não está ligado no .env.local: nada sai.");
  process.exit(0);
}
if (ENVIAR && !dentroDaJanela()) {
  console.log("Fora das 8h-20h de Londres: nada sai agora.");
  process.exit(0);
}

const sb = createServiceClient();
const desde = new Date(Date.now() - 36 * 3600_000).toISOString();
const { data: jobs, error } = await sb
  .from("jobs")
  // A conta mora no cliente (jobs não tem coluna de conta).
  .select("id, reference, title, scheduled_date, external_ref, client_name, status, clients!inner(phone, source_account_id)")
  .eq("clients.source_account_id", CONTA_DO_EXPRESS())
  .gte("created_at", desde)
  .not("external_ref", "is", null)
  .order("created_at");
if (error) throw new Error(error.message);
const { data: feitos } = await sb.from("harvey_wa_leads").select("job_id").not("job_id", "is", null);
const ja = new Set((feitos ?? []).map((f) => f.job_id));

let n = 0;
for (const j of jobs ?? []) {
  if (ja.has(j.id) || /cancel/i.test(String(j.status))) continue;
  const c = (Array.isArray(j.clients) ? j.clients[0] : j.clients) as { phone?: string | null } | null;
  const linha = `${j.reference} · ${j.client_name} · ${c?.phone ?? "sem telefone"} · ${j.title} · ${j.scheduled_date ?? "?"}`;
  if (!ENVIAR) {
    console.log(`  → ${linha}`);
    n++;
    continue;
  }
  const r = await mandarTemplateDoExpress(sb, {
    jobId: j.id,
    referencia: j.reference,
    ticketId: Number(j.external_ref),
    nome: j.client_name ?? "",
    telefone: c?.phone ?? null,
    titulo: j.title ?? "",
    dataIso: j.scheduled_date ? String(j.scheduled_date).slice(0, 10) : null,
  });
  console.log(`  ${r.kind === "enviado" ? "✅" : "·"} ${linha} (${r.kind}${r.kind === "falhou" ? `: ${r.motivo}` : ""})`);
  if (r.kind === "enviado") n++;
}
console.log(`\n${n} Express ${ENVIAR ? "com template enviado" : "esperando o template"}.`);
