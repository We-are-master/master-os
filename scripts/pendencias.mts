/**
 * Pendências dos jobs abertos (Action Required com motivo, migration 344).
 *
 *   npx tsx scripts/pendencias.mts            ensaio: só lista, não grava
 *   npx tsx scripts/pendencias.mts --aplicar  grava em job_attention_reasons
 *
 * Precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente
 * (ou no .env.local). Não manda mensagem nem mexe em job: só a tabela de motivos.
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
const { motivosDoJob, sincronizarPendencias, ROTULO_DO_MOTIVO } = await import("../src/lib/pendencias/motivos");
const { regrasDoProcesso, tipoDaConta } = await import("../src/lib/processo/conta");

const aplicar = process.argv.includes("--aplicar");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });

const { data: contas } = await sb.from("accounts").select("id, process_type, process_rules");
const regraDaConta = new Map((contas ?? []).map((c) => [c.id as string, tipoDaConta(c) ? regrasDoProcesso(tipoDaConta(c)!, c.process_rules) : null]));

const { data: jobs, error } = await sb
  .from("jobs")
  .select("id, reference, status, account_id, scheduled_date, scheduled_start_at, partner_id, client_price, partner_cost, customer_deposit, customer_deposit_paid, finance_status, payment_status, card_charge_status, final_report_submitted, final_report_skipped, report_1_uploaded, report_submitted")
  .is("deleted_at", null)
  .not("status", "in", "(completed,cancelled,deleted)")
  .limit(2000);
if (error) throw new Error(error.message);

// Desde quando o cartão está recusado: a primeira tentativa recusada depois da última que passou.
const recusados = (jobs ?? []).filter((j) => j.card_charge_status === "refused" || j.card_charge_status === "requires_action").map((j) => j.id);
const desde = new Map<string, number>();
if (recusados.length) {
  const { data: tentativas } = await sb.from("stripe_charge_attempts").select("job_id, status, created_at").in("job_id", recusados).order("created_at");
  for (const id of recusados) {
    const doJob = (tentativas ?? []).filter((t) => t.job_id === id);
    const ultimaBoa = doJob.filter((t) => t.status === "succeeded").pop()?.created_at ?? "";
    const primeira = doJob.find((t) => t.status !== "succeeded" && t.created_at > ultimaBoa)?.created_at;
    if (primeira) desde.set(id, Math.floor((Date.now() - Date.parse(primeira)) / 86_400_000));
  }
}

const contagem: Record<string, number> = {};
let mudancas = 0;
for (const j of jobs ?? []) {
  const motivos = motivosDoJob(j, regraDaConta.get(j.account_id) ?? null, { diasDesdeARecusa: desde.get(j.id) ?? null });
  for (const m of motivos) contagem[ROTULO_DO_MOTIVO[m]] = (contagem[ROTULO_DO_MOTIVO[m]] ?? 0) + 1;
  const r = await sincronizarPendencias(sb, j.id, motivos, { aplicar });
  mudancas += r.abrir.length + r.resolver.length;
  if (motivos.length && process.argv.includes("--detalhe")) console.log(j.reference, j.status, motivos.join(", "));
}
console.log(`${aplicar ? "Gravado" : "Ensaio"}: ${(jobs ?? []).length} jobs abertos, ${mudancas} mudanças de motivo.`);
console.table(contagem);
