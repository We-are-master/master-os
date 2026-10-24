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
const { alvoDoJob, alvoDoJobApagado, aplicarEspelho, lerTicketsCrus, abrirFollowUpDoJob, CAMPOS_DO_JOB_NO_ESPELHO } = await import("../src/lib/zendesk-status-sync");
const { espelhoDaQuote, donoDeTicketSemPedido, formularioDoJobFaltando, tituloDoTicket, TITLE_FIELD_ID } = await import("../src/lib/zendesk-espelho");
const { normalizeTypeOfWork } = await import("../src/lib/type-of-work");
const { extractUkPostcode } = await import("../src/lib/uk-postcode");
const { zendeskApi, ZENDESK_JOB_ID_FIELD_ID } = await import("../src/lib/zendesk");
const { syncJobZendeskFormFields } = await import("../src/lib/zendesk-ticket-form-sync");
const { papeisDaEquipe } = await import("../src/lib/responsavel-operacao");
const { faturasVencidas } = await import("../src/lib/faturas-vencidas");

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
  .select("id, reference, status, automation_status, external_ref, updated_at, service_type, title, client_name, postcode, property_address")
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

// Fatura vencida = 🔴 Overdue (24/10/2026). Só os em Awaiting payment.
const vencidas = await faturasVencidas(sb, jobsValidos.filter((j) => j.status === "awaiting_payment").map((j) => j.invoice_id as string | null));

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
  const alvo = alvoDoJob(j as never, motivosDoJob.get(j.id) ?? [], j.quote_id ? statusDaQuote.get(j.quote_id) ?? null : null, Boolean(j.invoice_id && vencidas.has(j.invoice_id as string)));
  await passar(`job ${j.status}`, String(j.external_ref), alvo, j);
}

// Formulário do job vazio no ticket (Job ID, cliente, endereço): preenche (JOB-9790, 23/10/2026).
// Teto por passada: a primeira rodada pode achar muitos, e cada um são algumas chamadas ao Zendesk.
const MAX_FORMULARIOS = 20;
let formularios = 0;
for (const j of jobsValidos) {
  const ticketId = String(j.external_ref);
  const cru = tickets.get(ticketId);
  if (!cru) continue;
  const faltando = formularioDoJobFaltando({
    status: cru.status,
    supportType: cru.support_type,
    jobIdNoTicket: cru.custom_fields?.find((f) => Number(f.id) === ZENDESK_JOB_ID_FIELD_ID)?.value,
    referencia: (j as { reference?: string }).reference,
  });
  if (!faltando) continue;
  if (formularios >= MAX_FORMULARIOS) { somar("formulário: fica para a próxima passada"); continue; }
  formularios++;
  if (!aplicar) {
    somar("formulário vazio: preencheria");
    if (detalhe) linhas.push(`${(j as { reference?: string }).reference} #${ticketId}: preencheria o formulário do job`);
    continue;
  }
  const r = await syncJobZendeskFormFields(j.id, sb as never).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  somar(r.ok ? "formulário preenchido" : "formulário: erro");
  if (detalhe || !r.ok) linhas.push(`${(j as { reference?: string }).reference} #${ticketId}: formulário ${r.ok ? "preenchido" : `ERRO ${"error" in r ? r.error : ""}`}`);
}
// Job apagado no OS na janela (24/10/2026): fecha o ticket, se nada vivo usa o mesmo ticket.
if (!so) {
  const { data: apagados } = await sb.from("jobs").select("id, reference, external_ref").eq("external_source", "zendesk").eq("status", "deleted").gte("deleted_at", desde).limit(500);
  const vivos = new Set([
    ...jobsValidos.filter((j) => j.status !== "completed" && j.status !== "cancelled").map((j) => String(j.external_ref)),
    ...(quotesLidas ?? []).filter((q) => q.status !== "rejected").map((q) => String(q.external_ref ?? "")),
  ]);
  for (const j of apagados ?? []) {
    const ref = String(j.external_ref ?? "");
    if (!numero(ref) || vivos.has(ref) || ticketsComJob.has(ref)) continue;
    if (!tickets.has(ref)) for (const [k, v] of await lerTicketsCrus([ref])) tickets.set(k, v);
    await passar(`job deleted ${j.reference}`, ref, alvoDoJobApagado(j));
  }
}

for (const q of so ? [] : quotesLidas ?? []) {
  const ref = String(q.external_ref ?? "");
  if (!numero(ref) || ticketsComJob.has(ref)) continue; // o job manda no ticket
  await passar(`${q.reference} ${q.status}`, ref, espelhoDaQuote(q.status, q.automation_status));
}

// Ticket aberto sem dono e sem job nem quote: dono pela regra (só preenche o vazio).
if (!so) {
  const ticketsComPedido = new Set([...ticketsComJob, ...(quotesLidas ?? []).map((q) => String(q.external_ref ?? ""))]);
  type Achado = { id: number; subject: string | null; custom_status_id: number | null; organization_id: number | null; assignee_id: number | null };
  const { results } = await zendeskApi<{ results?: Achado[] }>(`search.json?query=${encodeURIComponent("type:ticket status<solved assignee:none")}&per_page=100`);
  const semDono = (results ?? []).filter((t) => t.assignee_id == null && !ticketsComPedido.has(String(t.id)));
  const orgIds = [...new Set(semDono.map((t) => t.organization_id).filter(Boolean))] as number[];
  const nomeDaOrg = new Map<number, string>();
  if (orgIds.length) {
    const { organizations } = await zendeskApi<{ organizations?: Array<{ id: number; name: string }> }>(`organizations/show_many.json?ids=${orgIds.join(",")}`);
    for (const o of organizations ?? []) nomeDaOrg.set(o.id, o.name);
  }
  for (const t of semDono) {
    const papel = donoDeTicketSemPedido({ organizacao: t.organization_id ? nomeDaOrg.get(t.organization_id) ?? null : null, assunto: t.subject, customStatusId: t.custom_status_id });
    somar(aplicar ? `sem pedido: dono ${papel}` : `sem pedido: daria dono ${papel}`);
    if (detalhe) linhas.push(`#${t.id} ${t.subject?.slice(0, 60)} → ${papel}`);
    if (!aplicar) continue;
    try {
      await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { assignee_id: dono(papel) } } });
    } catch (e) {
      somar("erro");
      linhas.push(`#${t.id}: ERRO dono ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  }
}

// Title (24/10/2026): nome interno do ticket nas views, no lugar do Subject. Cliente Fixfy no
// padrão "Etapa · Serviço · Nome · Postcode"; conta B2B fica com o assunto, se não for simples demais.
if (!so) {
  const ORG_FIXFY = Number(process.env.ZENDESK_ORG_CUSTOMERS?.trim() || "6354308808991");
  const TAGS_DE_LEAD = ["lead_gen", "harvey_wa_lead", "lead_checkatrade", "lead_meta", "lead_promo"];
  const STATUS_DE_LEAD = [6417913706527, 6417870637599];
  type TicketDoTitulo = { id: number; subject: string | null; status: string; organization_id: number | null; requester_id: number | null; custom_status_id: number | null; tags?: string[]; custom_fields?: Array<{ id: number; value: unknown }> };
  const doTitulo = new Map<string, TicketDoTitulo>();
  let pagina: string | null = `search.json?query=${encodeURIComponent("type:ticket status<solved")}&per_page=100`;
  while (pagina) {
    const r: { results?: TicketDoTitulo[]; next_page?: string | null } = await zendeskApi(pagina);
    for (const t of r.results ?? []) doTitulo.set(String(t.id), t);
    pagina = r.next_page ? r.next_page.replace(/^.*\/api\/v2\//, "") : null;
  }
  for (const [id, t] of tickets) if (!doTitulo.has(id) && t.status !== "closed") doTitulo.set(id, t as unknown as TicketDoTitulo);

  const idsDosJobs = jobsValidos.map((j) => j.id);
  const dadosDoJob = new Map<string, { title: string | null; client_name: string | null; property_address: string | null }>();
  for (let i = 0; i < idsDosJobs.length; i += 200) {
    const { data } = await sb.from("jobs").select("id, title, client_name, property_address").in("id", idsDosJobs.slice(i, i + 200));
    for (const d of data ?? []) dadosDoJob.set(d.id, d);
  }
  const jobDoTicket = new Map(jobsValidos.map((j) => [String(j.external_ref), dadosDoJob.get(j.id)]));
  const quoteDoTicket = new Map((quotesLidas ?? []).map((q) => [String(q.external_ref ?? ""), q]));

  const idsDeRequester = [...new Set([...doTitulo.values()].map((t) => t.requester_id).filter(Boolean))] as number[];
  const nomeDoUsuario = new Map<number, string>();
  for (let i = 0; i < idsDeRequester.length; i += 100) {
    const { users } = await zendeskApi<{ users?: Array<{ id: number; name: string }> }>(`users/show_many.json?ids=${idsDeRequester.slice(i, i + 100).join(",")}`);
    for (const u of users ?? []) nomeDoUsuario.set(u.id, u.name);
  }

  // Em lote (update_many, 100 por chamada): um PUT por ticket estoura o limite de atualização
  // do Zendesk (429 "Ticket update API threshold exceeded"), que é da conta inteira.
  const pendentes: Array<{ id: number; titulo: string }> = [];
  for (const [id, t] of doTitulo) {
    const job = jobDoTicket.get(id);
    const quote = quoteDoTicket.get(id);
    const tags = t.tags ?? [];
    const titulo = tituloDoTicket({
      assunto: t.subject,
      fixfy: !t.organization_id || t.organization_id === ORG_FIXFY,
      etapa: job ? "Job" : quote ? "Quote" : null,
      servico: job ? normalizeTypeOfWork(job.title) || job.title : quote ? normalizeTypeOfWork(quote.service_type ?? quote.title) || quote.service_type || quote.title : null,
      nome: job?.client_name ?? quote?.client_name ?? null,
      postcode: job ? extractUkPostcode(job.property_address ?? "") : quote ? extractUkPostcode(`${quote.postcode ?? ""} ${quote.property_address ?? ""}`) : null,
      ehLead: STATUS_DE_LEAD.includes(Number(t.custom_status_id)) || tags.some((x) => TAGS_DE_LEAD.includes(x)),
      nomeDoRequester: t.requester_id ? nomeDoUsuario.get(t.requester_id) ?? null : null,
    });
    const atual = t.custom_fields?.find((f) => Number(f.id) === TITLE_FIELD_ID)?.value ?? null;
    if (!titulo || atual === titulo) continue;
    pendentes.push({ id: Number(id), titulo });
    if (detalhe) linhas.push(`#${id} title: ${titulo}`);
  }
  for (let i = 0; i < pendentes.length; i += 100) {
    const lote = pendentes.slice(i, i + 100);
    somar(aplicar ? "title gravado" : "title: gravaria");
    conta[aplicar ? "title gravado" : "title: gravaria"] += lote.length - 1;
    if (!aplicar) continue;
    try {
      await zendeskApi("tickets/update_many.json", { method: "PUT", body: { tickets: lote.map((p) => ({ id: p.id, custom_fields: [{ id: TITLE_FIELD_ID, value: p.titulo }] })) } });
    } catch (e) {
      somar("erro");
      linhas.push(`title em lote: ERRO ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  }
}

console.log(`${aplicar ? "Aplicado" : "Ensaio"}: ${jobsValidos.length} jobs, ${(quotesLidas ?? []).length} quotes, janela de ${dias} dias.`);
console.log(Object.entries(conta).sort().map(([k, v]) => `  ${k}: ${v}`).join("\n"));
if (refInvalida.length) console.log(`Jobs com external_ref que não é número de ticket: ${refInvalida.map((j) => `${(j as { reference?: string }).reference ?? j.id}`).join(", ")}`);
if (linhas.length) console.log(linhas.join("\n"));
