/**
 * Ensaio do "um ticket por pedido" (dono, 14/10/2026) contra os dados de agora.
 * SÓ LEITURA: Supabase e Zendesk por GET. Diz, para os últimos N dias, quantos
 * tickets duplicados cada chave teria evitado.
 *
 *   ENV_DIR=~/master-os NODE_OPTIONS=--dns-result-order=ipv4first npx tsx scripts/um-ticket-ensaio.mts [--dias 14]
 *
 * 1 (view Leads) e 5 (ligações) têm script próprio com ensaio:
 *   scripts/zendesk-view-leads-uma-linha.mts e scripts/zendesk-ligacoes-no-pedido.mts
 *
 * Aproximação: "aberto" é o status de AGORA, e o candidato tem que ter nascido
 * antes do ticket medido. Ticket que estava aberto na hora e já foi resolvido não
 * conta, então os números são o piso.
 */
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal(process.env.ENV_DIR || process.cwd());
const { zendeskApi } = await import("../src/lib/zendesk");
const { createServiceClient } = await import("../src/lib/supabase/service");
const { acharTicketDoPedido } = await import("../src/lib/um-ticket/achar");
const { lerFichaDoLead } = await import("../src/lib/um-ticket/resumo-do-lead");

const iDias = process.argv.indexOf("--dias");
const DIAS = iDias >= 0 ? Number(process.argv[iDias + 1]) : 14;
const sb = createServiceClient();

type T = { id: number; status: string; subject: string | null; requester_id: number; created_at: string; tags: string[]; via?: { channel?: string; source?: { from?: { address?: string } } } };
const desde = new Date(Date.now() - DIAS * 86400_000).toISOString().slice(0, 10);
const todos: T[] = [];
let url: string | null = `search/export.json?query=${encodeURIComponent(`type:ticket created>=${desde}`)}&filter[type]=ticket&page[size]=100`;
while (url) {
  const r: { results: T[]; meta?: { has_more?: boolean }; links?: { next?: string } } = await zendeskApi(url);
  todos.push(...(r.results ?? []));
  url = r.meta?.has_more && r.links?.next ? r.links.next.replace(/^.*\/api\/v2\//, "") : null;
}
console.log(`Tickets criados desde ${desde}: ${todos.length} (${new Set(todos.map((t) => t.requester_id)).size} solicitantes)\n`);

// ─── 2. Nota do merge com o pedido ─────────────────────────────────────
const leads = todos.filter((t) => t.via?.channel === "api" && t.tags.includes("harvey_wa_lead") && /^Lead ·/.test(t.subject ?? ""));
const juntados = leads.filter((t) => t.status === "closed");
let lidas = 0;
let exemplo: string | null = null;
for (const t of juntados) {
  const r = await zendeskApi<{ comments: Array<{ body?: string }> }>(`tickets/${t.id}/comments.json?sort_order=asc&per_page=1`);
  const f = lerFichaDoLead(r.comments?.[0]?.body);
  if (f?.pedido || f?.servico) lidas++;
  if (!exemplo && f) exemplo = `#${t.id}: ${f.servico} · ${f.postcode} · "${(f.pedido ?? "").slice(0, 60)}" · ${f.urgencia ?? "-"}`;
}
console.log(`2. Merge do lead com o pedido na nota (ONE_TICKET_MERGE_NOTE_ON)`);
console.log(`   leads do Checkatrade: ${leads.length}, já juntados na conversa: ${juntados.length}, ficha lida: ${lidas}/${juntados.length}`);
if (exemplo) console.log(`   exemplo: ${exemplo}`);

// ─── 3. E-mail do OS ao cliente ─────────────────────────────────────────
const assuntoDeEmail = /^(Your (invoice|quote)|Payment receipt|Almost there|JOB-\d+ Your billing)|: next steps$|final update$|^Quote QT-/i;
const emailsDoOs = todos.filter((t) => assuntoDeEmail.test(t.subject ?? "") && (t.via?.channel === "api" || /noreply@getfixfy\.com/i.test(t.via?.source?.from?.address ?? "")));
let evitados3 = 0;
const linhas3: string[] = [];
for (const t of emailsDoOs) {
  const copia = t.via?.channel === "email";
  let pedido: Parameters<typeof acharTicketDoPedido>[1] = { excluir: [t.id], criadoAntesDe: t.created_at };
  const inv = (t.subject ?? "").match(/INV-\d{4}-\d+/)?.[0];
  const job = (t.subject ?? "").match(/JOB-\d+/)?.[0];
  if (inv) {
    // O assunto mostra INV-, o banco guarda o prefixo do documento (RCP-2026-904).
    const { data } = await sb.from("invoices").select("job_reference").ilike("reference", `%-${inv.slice(4)}`).limit(1).maybeSingle();
    const ref = (data as { job_reference?: string | null } | null)?.job_reference ?? null;
    const { data: j } = ref ? await sb.from("jobs").select("id, client_id").eq("reference", ref).maybeSingle() : { data: null };
    if (j) pedido = { ...pedido, jobId: (j as { id: string }).id, clientId: (j as { client_id: string | null }).client_id };
  } else if (job) {
    const { data: j } = await sb.from("jobs").select("id, client_id").eq("reference", job).maybeSingle();
    if (j) pedido = { ...pedido, jobId: (j as { id: string }).id, clientId: (j as { client_id: string | null }).client_id };
  }
  if (!copia) {
    const { user } = await zendeskApi<{ user: { email: string | null } }>(`users/${t.requester_id}.json`);
    pedido = { ...pedido, email: user?.email ?? null };
  }
  const a = await acharTicketDoPedido(sb, pedido);
  if (a.tipo === "ticket") evitados3++;
  linhas3.push(`   #${t.id} ${copia ? "cópia da Resend" : "API"} "${(t.subject ?? "").slice(0, 50)}" → ${a.tipo === "ticket" ? `#${a.id} (${a.origem}, ${a.canal})` : a.tipo === "ambiguo" ? `ambíguo ${a.ids.join("/")}` : "nenhum aberto"}`);
}
console.log(`\n3. E-mail do OS no ticket que já existe (ONE_TICKET_EMAIL_ON)`);
console.log(`   tickets abertos por e-mail do OS ao cliente: ${emailsDoOs.length}, com ticket do pedido para usar: ${evitados3}`);
for (const l of linhas3) console.log(l);

// ─── 4. Job reusa o ticket do pedido ────────────────────────────────────
const deJob = todos.filter((t) => t.via?.channel === "api" && (/^Job Scheduled:/.test(t.subject ?? "") || /^JOB-\d+ · /.test(t.subject ?? "") || t.tags.includes("os-job")) && !/^TEST/.test(t.subject ?? ""));
let evitados4 = 0;
let ambiguos4 = 0;
let teto4 = 0;
const linhas4: string[] = [];
for (const t of deJob) {
  const { data: j } = await sb.from("jobs").select("id, reference, client_id").eq("external_source", "zendesk").eq("external_ref", String(t.id)).maybeSingle();
  if (!j) { linhas4.push(`   #${t.id} "${(t.subject ?? "").slice(0, 50)}" → sem job no OS`); continue; }
  const job = j as { id: string; reference: string; client_id: string | null };
  const a = await acharTicketDoPedido(sb, { jobId: job.id, semVinculo: true, clientId: job.client_id, exigirUnico: true, excluir: [t.id], criadoAntesDe: t.created_at });
  if (a.tipo === "ticket") evitados4++;
  // Teto: o cliente tinha QUALQUER ticket (fora ligação e ticket de outro job) nos 30 dias antes, aberto ou não hoje.
  const inicio = new Date(new Date(t.created_at).getTime() - 30 * 86400_000).toISOString();
  const algum = a.candidatos.filter((c) => c.origem === "cliente" && c.id !== t.id && c.canal !== "voice" && !c.ligadoAOutroJob && (c.criadoEm ?? "") < t.created_at && (c.criadoEm ?? "") >= inicio);
  if (algum.length) teto4++;
  if (a.tipo === "ambiguo") ambiguos4++;
  linhas4.push(`   #${t.id} ${job.reference} "${(t.subject ?? "").slice(0, 45)}" → ${a.tipo === "ticket" ? `#${a.id} (${a.canal})` : a.tipo === "ambiguo" ? `ambíguo ${a.ids.join("/")} (abre novo)` : "nenhum aberto (abre novo)"}`);
}
console.log(`\n4. Job no ticket do pedido (ONE_TICKET_JOB_REUSE_ON)`);
console.log(`   tickets de job abertos pelo OS: ${deJob.length}, teriam usado o ticket do pedido: ${evitados4}, ambíguos: ${ambiguos4}`);
console.log(`   teto (cliente B2C com algum ticket nos 30 dias antes, aberto ou já resolvido hoje): ${teto4}`);
for (const l of linhas4) console.log(l);

// ─── 6. WhatsApp ligado com a janela fechada ────────────────────────────
// PDF (proposta, fatura, relatório) que o OS mandou como comentário público num
// ticket de WhatsApp. Lido das auditorias do Zendesk: o OS não guarda a hora do
// envio (quotes.customer_pdf_sent_at vazio, jobs.review_sent_at nem existe).
// Mede com a última mensagem do cliente de AGORA: se ela é de mais de 24 h antes
// do envio, a janela estava fechada com certeza; quem escreveu depois conta como
// aberta. É o piso.
const { janelaDoWhatsAppAberta } = await import("../src/lib/um-ticket/escolha");
const { ultimaDoClienteNoWhatsApp } = await import("../src/lib/um-ticket/entregar");
const conversas: T[] = [];
let urlW: string | null = `search/export.json?query=${encodeURIComponent(`type:ticket updated>=${desde}`)}&filter[type]=ticket&page[size]=100`;
while (urlW) {
  const r: { results: T[]; meta?: { has_more?: boolean }; links?: { next?: string } } = await zendeskApi(urlW);
  conversas.push(...(r.results ?? []).filter((t) => t.via?.channel === "whatsapp"));
  urlW = r.meta?.has_more && r.links?.next ? r.links.next.replace(/^.*\/api\/v2\//, "") : null;
}
type Audit = { created_at: string; via?: { channel?: string }; events: Array<{ type: string; public?: boolean; attachments?: Array<{ file_name: string }> }> };
const envios: Array<{ ticket: number; em: string; arquivo: string }> = [];
for (const t of conversas) {
  const { audits } = await zendeskApi<{ audits: Audit[] }>(`tickets/${t.id}/audits.json`);
  for (const a of audits ?? []) {
    if (a.via?.channel !== "api" || a.created_at < desde) continue;
    const c = a.events.find((e) => e.type === "Comment" && e.public && (e.attachments ?? []).some((x) => /\.pdf$/i.test(x.file_name)));
    if (c) envios.push({ ticket: t.id, em: a.created_at, arquivo: (c.attachments ?? []).map((x) => x.file_name).join(", ") });
  }
}
let fechada6 = 0;
let semRegistro6 = 0;
const linhas6: string[] = [];
for (const e of envios) {
  const ultima = await ultimaDoClienteNoWhatsApp(e.ticket).catch(() => null);
  const aberta = ultima && new Date(ultima) > new Date(e.em) ? true : janelaDoWhatsAppAberta(ultima, new Date(e.em));
  if (!ultima) semRegistro6++;
  else if (aberta === false) fechada6++;
  linhas6.push(`   #${e.ticket} ${e.em.slice(0, 16)} ${e.arquivo.slice(0, 40)}, última do cliente ${ultima?.slice(0, 16) ?? "sem registro"} → ${aberta ? "WhatsApp (janela aberta)" : "conversa lateral por e-mail"}`);
}
console.log(`\n6. Ticket de WhatsApp ligado, janela fechada (ONE_TICKET_WA_LINKED_ON)`);
console.log(`   tickets de WhatsApp mexidos: ${conversas.length}, PDFs mandados como comentário público: ${envios.length}, janela fechada com certeza: ${fechada6}, sem registro da conversa: ${semRegistro6}`);
for (const l of linhas6) console.log(l);
