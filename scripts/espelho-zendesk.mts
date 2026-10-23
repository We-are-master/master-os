/**
 * O Zendesk espelha o OS (dono, 23/10/2026): passa em todo job e quote ligado a um
 * ticket e põe no ticket o status, o dono por papel e o Action Required de cobrança
 * que o OS diz (regras em src/lib/zendesk-espelho.ts).
 *
 *   npx tsx scripts/espelho-zendesk.mts             ensaio: lista o que mudaria
 *   npx tsx scripts/espelho-zendesk.mts --aplicar   escreve no Zendesk
 *   --dias=N   jobs e quotes encerrados mexidos nos últimos N dias (padrão 14)
 *   --detalhe  uma linha por ticket
 *   --so=JOB-1,JOB-2  só esses jobs (para testar)
 *
 * Também desfaz o que mudaram à mão no Zendesk: ticket fechado com o job aberto volta
 * para a etapa do job. Ticket closed não aceita mais nada e só aparece na lista.
 * O fixfy-workers roda com --aplicar a cada 10 min (scripts/workers/rotinas.mts).
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
const { alvoDoJob, aplicarEspelho, lerTicketsCrus, abrirFollowUpDoJob, CAMPOS_DO_JOB_NO_ESPELHO } = await import("../src/lib/zendesk-status-sync");
const { espelhoDaQuote } = await import("../src/lib/zendesk-espelho");
const { papeisDaEquipe } = await import("../src/lib/responsavel-operacao");

const aplicar = process.argv.includes("--aplicar");
const detalhe = process.argv.includes("--detalhe");
const dias = Number(process.argv.find((a) => a.startsWith("--dias="))?.split("=")[1] ?? 14);
const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });

const numero = (r: unknown) => /^\d+$/.test(String(r ?? "").trim());

// Jobs: os abertos todos, e os encerrados mexidos na janela.
const [abertos, encerrados] = await Promise.all([
  sb.from("jobs").select(CAMPOS_DO_JOB_NO_ESPELHO).eq("external_source", "zendesk").is("deleted_at", null).not("status", "in", "(completed,cancelled,deleted)").limit(3000),
  sb.from("jobs").select(CAMPOS_DO_JOB_NO_ESPELHO).eq("external_source", "zendesk").is("deleted_at", null).in("status", ["completed", "cancelled"]).gte("updated_at", desde).limit(3000),
]);
if (abertos.error || encerrados.error) throw new Error((abertos.error ?? encerrados.error)!.message);
type JobLido = { id: string; status: string; quote_id: string | null; external_ref: string | null; [k: string]: unknown };
const jobs = [...(abertos.data ?? []), ...(encerrados.data ?? [])] as unknown as JobLido[];
const refInvalida = jobs.filter((j) => !numero(j.external_ref));
const so = process.argv.find((a) => a.startsWith("--so="))?.split("=")[1]?.split(",").filter(Boolean) ?? null;
const jobsValidos = jobs.filter((j) => numero(j.external_ref) && (!so || so.includes(String((j as { reference?: string }).reference))));

// Quotes: as que ainda falam com o ticket, e as perdidas na janela.
const { data: quotesLidas, error: qErr } = await sb
  .from("quotes")
  .select("id, reference, status, external_ref, updated_at")
  .eq("external_source", "zendesk")
  .or(`status.in.(in_survey,bidding,quote_ready,awaiting_customer,awaiting_payment),and(status.eq.rejected,updated_at.gte.${desde})`)
  .limit(3000);
if (qErr) throw new Error(qErr.message);

const { data: motivosAbertos } = await sb.from("job_attention_reasons").select("job_id, reason").is("resolved_at", null);
const motivosDoJob = new Map<string, string[]>();
for (const r of motivosAbertos ?? []) motivosDoJob.set(r.job_id, [...(motivosDoJob.get(r.job_id) ?? []), r.reason]);

const idsDeQuote = [...new Set(jobsValidos.map((j) => j.quote_id).filter(Boolean))] as string[];
const statusDaQuote = new Map<string, string>();
for (let i = 0; i < idsDeQuote.length; i += 200) {
  const { data } = await sb.from("quotes").select("id, status").in("id", idsDeQuote.slice(i, i + 200));
  for (const q of data ?? []) statusDaQuote.set(q.id, q.status);
}

const ticketsComJob = new Set(jobsValidos.map((j) => String(j.external_ref)));
const tickets = await lerTicketsCrus([...ticketsComJob, ...(quotesLidas ?? []).map((q) => String(q.external_ref ?? ""))]);
const papeis = await papeisDaEquipe();
const dono = (p: "vendas" | "operacao" | "financeiro") => papeis[p].zendesk_user_id;

const conta: Record<string, number> = {};
const somar = (k: string) => (conta[k] = (conta[k] ?? 0) + 1);
const linhas: string[] = [];

const ATIVO = new Set(["unassigned", "auto_assigning", "scheduled", "late", "need_attention", "in_progress", "final_check", "awaiting_payment", "on_hold"]);

async function passar(rotulo: string, ticketId: string, alvo: Parameters<typeof aplicarEspelho>[1] | null, job?: JobLido) {
  if (!alvo) return somar("sem espelho");
  const cru = tickets.get(ticketId);
  if (!cru) { somar("ticket não existe"); linhas.push(`${rotulo} #${ticketId}: ticket não existe`); return; }
  try {
    const r = await aplicarEspelho(ticketId, alvo, { aplicar, ticket: cru, dono });
    if (r.skip === "already_mirrored") return somar("já igual");
    if (r.skip === "ticket_closed") {
      if (cru.custom_status_id === alvo.customStatusId) return somar("já igual");
      if (job && ATIVO.has(job.status)) {
        if (!aplicar) { somar("job aberto com ticket closed: abriria follow-up"); linhas.push(`${rotulo} ${(job as { reference?: string }).reference} #${ticketId}: abriria follow-up`); return; }
        const f = await abrirFollowUpDoJob(sb, job as never, ticketId, alvo);
        somar(f.ok ? "follow-up aberto" : "follow-up falhou");
        linhas.push(`${rotulo} ${(job as { reference?: string }).reference} #${ticketId}: ${f.ok ? `follow-up #${f.novoTicketId}` : `ERRO ${f.error}`}`);
        return;
      }
      somar("closed, não dá para mudar");
      linhas.push(`${rotulo} #${ticketId}: ticket closed (OS diz ${alvo.customStatusId})`);
      return;
    }
    const m = r.changes ?? {};
    somar(aplicar ? "corrigido" : "corrigiria");
    if (m.customStatusId != null) somar("· status");
    if (m.assigneeId != null) somar("· dono");
    if (m.actionRequired != null) somar(m.actionRequired ? "· Action Required liga" : "· Action Required desliga");
    if (detalhe) linhas.push(`${rotulo} #${ticketId}: ${JSON.stringify(m)} (era status ${cru.custom_status_id}, dono ${cru.assignee_id})`);
  } catch (e) {
    somar("erro");
    linhas.push(`${rotulo} #${ticketId}: ERRO ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
  }
}

for (const j of jobsValidos) {
  const alvo = alvoDoJob(j as never, motivosDoJob.get(j.id) ?? [], j.quote_id ? statusDaQuote.get(j.quote_id) ?? null : null);
  await passar(`job ${j.status}`, String(j.external_ref), alvo, j);
}
for (const q of so ? [] : quotesLidas ?? []) {
  const ref = String(q.external_ref ?? "");
  if (!numero(ref) || ticketsComJob.has(ref)) continue; // o job manda no ticket
  await passar(`${q.reference} ${q.status}`, ref, espelhoDaQuote(q.status));
}

console.log(`${aplicar ? "Aplicado" : "Ensaio"}: ${jobsValidos.length} jobs, ${(quotesLidas ?? []).length} quotes, janela de ${dias} dias.`);
console.log(Object.entries(conta).sort().map(([k, v]) => `  ${k}: ${v}`).join("\n"));
if (refInvalida.length) console.log(`Jobs com external_ref que não é número de ticket: ${refInvalida.map((j) => `${(j as { reference?: string }).reference ?? j.id}`).join(", ")}`);
if (linhas.length) console.log(linhas.join("\n"));
