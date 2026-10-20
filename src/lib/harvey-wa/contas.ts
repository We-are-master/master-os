/**
 * O que o Harvey conta no WhatsApp sobre o que já existe no OS:
 *  - cliente: as reservas dele (dia, janela, situação, quanto falta pagar e o link)
 *  - parceiro: situação do cadastro, documentos que faltam e os próximos jobs
 *
 * Só dado do próprio dono do telefone. Parceiro nunca vê telefone nem e-mail do cliente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoreComplianceBreakdown, type PartnerDocLike } from "@/lib/partner-required-docs";
import { chaveDoTelefone, type Parceiro } from "./identidade";

const TZ = "Europe/London";
const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) : null);
const hora = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(":00", "") : null);

/** A situação do job em palavras de cliente. */
function situacaoParaCliente(status: string, temParceiro: boolean): string {
  switch (status) {
    case "unassigned":
    case "auto_assigning":
      return "booked, we are confirming the professional";
    case "scheduled":
    case "late":
      return temParceiro ? "confirmed, professional assigned" : "confirmed";
    case "in_progress":
      return "in progress today";
    case "final_check":
      return "done, our team is checking the report";
    case "awaiting_payment":
      return "done, balance to pay";
    case "completed":
      return "completed";
    case "on_hold":
    case "need_attention":
      return "on hold, the team is looking at it";
    case "cancelled":
      return "cancelled";
    default:
      return status.replace(/_/g, " ");
  }
}

const CAMPOS_JOB =
  "id, reference, title, status, partner_id, partner_name, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, client_price, total_client_price, payment_status, invoice_id, client_id";

type LinhaJob = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  partner_id: string | null;
  partner_name: string | null;
  property_address: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  client_price: number | null;
  total_client_price: number | null;
  payment_status: string | null;
  invoice_id: string | null;
};

/** As reservas de quem escreve: pelos clientes com esse telefone e, se ele disser, pelo e-mail. */
export async function reservasDoCliente(sb: SupabaseClient, a: { telefone: string | null; email?: string | null; clienteId?: string | null }) {
  const ids = new Set<string>();
  if (a.clienteId) ids.add(a.clienteId);
  const chave = chaveDoTelefone(a.telefone);
  if (chave) {
    const fim = chave.slice(-4);
    const { data } = await sb.from("clients").select("id, phone").ilike("phone", `%${fim.slice(0, 2)}%${fim.slice(2)}`).limit(200);
    for (const c of data ?? []) if (chaveDoTelefone(c.phone as string) === chave) ids.add(c.id as string);
  }
  if (a.email?.includes("@")) {
    const { data } = await sb.from("clients").select("id").ilike("email", a.email.trim()).limit(5);
    for (const c of data ?? []) ids.add(c.id as string);
  }
  if (!ids.size) return { encontrado: false, reservas: [] as unknown[], note: "No bookings found for this number. Ask for the email they booked with, or the booking reference." };

  const desde = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const { data: jobs } = await sb
    .from("jobs")
    .select(CAMPOS_JOB)
    .in("client_id", [...ids])
    .is("deleted_at", null)
    .neq("status", "deleted")
    .or(`scheduled_date.gte.${desde},scheduled_date.is.null`)
    .order("scheduled_date", { ascending: true })
    .limit(10);
  const lista = (jobs ?? []) as LinhaJob[];
  const faturas = new Map<string, { reference: string; amount: number; amount_paid: number | null; status: string; stripe_payment_link_url: string | null }>();
  const invIds = lista.map((j) => j.invoice_id).filter(Boolean) as string[];
  if (invIds.length) {
    const { data } = await sb.from("invoices").select("id, reference, amount, amount_paid, status, stripe_payment_link_url").in("id", invIds);
    for (const f of data ?? []) faturas.set(f.id as string, f as never);
  }
  return {
    encontrado: true,
    reservas: lista.map((j) => {
      const f = j.invoice_id ? faturas.get(j.invoice_id) : undefined;
      const falta = f && f.status !== "paid" && f.status !== "cancelled" ? Math.max(0, Number(f.amount) - Number(f.amount_paid ?? 0)) : 0;
      return {
        ref: j.reference,
        service: j.title,
        address: j.property_address,
        day: dia(j.scheduled_start_at) ?? j.scheduled_date,
        arrival: j.scheduled_start_at ? `${hora(j.scheduled_start_at)}${j.scheduled_end_at ? ` to ${hora(j.scheduled_end_at)}` : ""}` : null,
        status: situacaoParaCliente(j.status, !!j.partner_id),
        professional: j.partner_id && j.partner_name ? j.partner_name.split(" ")[0] : null,
        price: j.total_client_price ?? j.client_price,
        balanceDue: falta || null,
        payLink: falta && f?.stripe_payment_link_url ? f.stripe_payment_link_url : null,
      };
    }),
    note: "Only tell them about their own bookings. To move or cancel a booking, hand off to the team.",
  };
}

/** Situação do parceiro: status, documentos que faltam para ativar e os próximos jobs. */
export async function situacaoDoParceiro(sb: SupabaseClient, p: Parceiro) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [{ data: docs }, { data: jobs }] = await Promise.all([
    sb.from("partner_documents").select("id, name, doc_type, status, expires_at, counts_toward_compliance, created_at").eq("partner_id", p.id),
    sb
      .from("jobs")
      .select("reference, title, status, property_address, scheduled_date, scheduled_start_at, scheduled_end_at")
      .eq("partner_id", p.id)
      .is("deleted_at", null)
      .gte("scheduled_date", hoje)
      .not("status", "in", "(cancelled,deleted,completed)")
      .order("scheduled_date", { ascending: true })
      .limit(8),
  ]);
  const lista = (docs ?? []) as PartnerDocLike[];
  const quebra = getCoreComplianceBreakdown(lista);
  const pendentes = lista.filter((d) => d.status === "pending").map((d) => d.name);
  const agora = new Date();
  const vencidos = lista.filter((d) => d.status === "approved" && d.expires_at && new Date(d.expires_at) < agora).map((d) => d.name);
  return {
    name: p.contact_name || p.company_name,
    accountStatus: p.status,
    canReceiveJobs: p.status === "active",
    documents: quebra.items.map((i) => ({ doc: i.label, ok: i.ok })),
    missingToActivate: quebra.items.filter((i) => !i.ok).map((i) => i.label),
    waitingReview: pendentes,
    expired: vencidos,
    upcomingJobs: ((jobs ?? []) as Array<Record<string, string | null>>).map((j) => ({
      ref: j.reference,
      service: j.title,
      address: j.property_address,
      day: dia(j.scheduled_start_at) ?? j.scheduled_date,
      arrival: j.scheduled_start_at ? `${hora(j.scheduled_start_at)}${j.scheduled_end_at ? ` to ${hora(j.scheduled_end_at)}` : ""}` : null,
    })),
    portal: "https://partners.getfixfy.com",
  };
}

/* ======================= cotação em andamento (Fase 1) ======================= */

type QuoteDoCliente = { id: string; reference: string; status: string; title: string | null; service_type: string | null; total_value: number | null; external_ref: string | null; created_at: string };

/** As cotações abertas de quem escreve: pela conversa do WhatsApp (ticket) e pelo cliente do OS. */
export async function cotacoesDoCliente(sb: SupabaseClient, a: { telefone: string | null; clienteId?: string | null }): Promise<{ ticket: number | null; quotes: QuoteDoCliente[] }> {
  const { ticketPeloTelefone } = await import("./zendesk-wa");
  const ticket = await ticketPeloTelefone(a.telefone).catch(() => null);
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const campos = "id, reference, status, title, service_type, total_value, external_ref, created_at";
  const [doTicket, doCliente] = await Promise.all([
    ticket ? sb.from("quotes").select(campos).eq("external_source", "zendesk").eq("external_ref", String(ticket)).is("deleted_at", null) : Promise.resolve({ data: [] }),
    a.clienteId ? sb.from("quotes").select(campos).eq("client_id", a.clienteId).is("deleted_at", null).gte("created_at", desde) : Promise.resolve({ data: [] }),
  ]);
  const todas = new Map<string, QuoteDoCliente>();
  for (const q of [...((doTicket.data ?? []) as QuoteDoCliente[]), ...((doCliente.data ?? []) as QuoteDoCliente[])]) todas.set(q.id, q);
  return { ticket, quotes: [...todas.values()].sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, 5) };
}

/**
 * get_quote_status: em que pé está a cotação do cliente. Enviada leva o total e
 * o link para aceitar. Resposta do profissional a uma pergunta do cliente
 * (ask_partner) vem junto, para o Harvey contar.
 */
export async function statusDasCotacoes(sb: SupabaseClient, a: { telefone: string | null; clienteId?: string | null }) {
  const { situacaoDaCotacao, textoDaSituacao } = await import("./pedido-de-cotacao");
  const { quotes } = await cotacoesDoCliente(sb, a);
  if (!quotes.length) return { found: false, quotes: [], note: "No quote found for this customer. If they asked for one, check with request_quote; never hand off just for this." };
  const lista = await Promise.all(
    quotes.map(async (q) => {
      const [{ count: convidados }, { count: lances }, respostas] = await Promise.all([
        sb.from("quote_partner_invitations").select("id", { count: "exact", head: true }).eq("quote_id", q.id),
        sb.from("quote_bids").select("id", { count: "exact", head: true }).eq("quote_id", q.id).eq("status", "submitted"),
        // Sem a tabela (migration 329) só não traz as respostas.
        sb.from("quote_partner_messages").select("kind, body, created_at").eq("quote_id", q.id).in("kind", ["question", "answer"]).order("created_at", { ascending: false }).limit(4),
      ]);
      const s = situacaoDaCotacao({ status: q.status, convidados: convidados ?? 0, lances: lances ?? 0 });
      const ultimas = ((respostas.data ?? []) as Array<{ kind: string; body: string | null }>);
      const ultimaPergunta = ultimas.findIndex((m) => m.kind === "question");
      // Só as respostas que vieram depois da última pergunta (a lista está do mais novo ao mais velho).
      const novas = ultimas.slice(0, ultimaPergunta === -1 ? ultimas.length : ultimaPergunta).filter((m) => m.kind === "answer").map((m) => m.body).filter(Boolean);
      let link: string | null = null;
      if (s === "sent") {
        try {
          const { createQuoteResponseToken } = await import("@/lib/quote-response-token");
          const { appBaseUrl } = await import("@/lib/app-base-url");
          link = `${appBaseUrl()}/quote/respond?token=${encodeURIComponent(createQuoteResponseToken(q.id))}&action=accept`;
        } catch {
          link = null;
        }
      }
      return {
        ref: q.reference,
        service: q.service_type ?? q.title,
        status: s,
        inWords: textoDaSituacao(s, { convidados: convidados ?? 0, lances: lances ?? 0 }),
        ...(s === "sent" ? { total: Number(q.total_value) || null, acceptLink: link } : {}),
        ...(ultimaPergunta !== -1 ? { professionalAnswer: novas.length ? novas.join(" ") : "not answered yet" } : {}),
      };
    }),
  );
  return {
    found: true,
    quotes: lista,
    note: "Tell them simply where it is, in one or two lines. Never promise a time or a price that is not here. If it was sent, give the total and the accept link. If the professional answered their question, pass it on in your own words.",
  };
}

/**
 * ask_partner: a pergunta do cliente vai ao profissional que cotou (ou aos
 * convidados, se ninguém cotou ainda), na side conversation dele no ticket.
 * Assinada "Fixfy Team". Nota interna para a equipe ver. A resposta volta pelo
 * leitor de e-mail (lances-por-email.ts).
 */
export async function perguntarAoParceiro(sb: SupabaseClient, a: { telefone: string | null; clienteId?: string | null; pergunta: string }) {
  const pergunta = a.pergunta.replace(/\s*[—–]\s*/g, ", ").trim().slice(0, 1000);
  if (pergunta.length < 5) return { error: "Write the customer's question first." };
  const { ticket, quotes } = await cotacoesDoCliente(sb, a);
  const q = quotes.find((x) => ["bidding", "quote_ready", "awaiting_customer", "draft"].includes(x.status));
  if (!q || !q.external_ref) return { error: "There is no open quote for this customer to ask about. Answer from what you know or hand off to the team." };
  const ticketId = Number(q.external_ref);
  const { data: lances } = await sb.from("quote_bids").select("partner_id, bid_amount").eq("quote_id", q.id).eq("status", "submitted").order("bid_amount", { ascending: true });
  let ids = [...new Set(((lances ?? []) as Array<{ partner_id: string }>).map((l) => l.partner_id).filter(Boolean))];
  if (!ids.length) {
    const { data: convites } = await sb.from("quote_partner_invitations").select("partner_id").eq("quote_id", q.id);
    ids = [...new Set(((convites ?? []) as Array<{ partner_id: string }>).map((c) => c.partner_id).filter(Boolean))];
  }
  if (!ids.length) return { error: "No professional is on this quote yet. Tell them we'll include the question when we ask for prices.", quote: q.reference };
  const { data: ps } = await sb.from("partners").select("id, email, job_cc_emails, company_name, contact_name, zendesk_user_id").in("id", ids.slice(0, 3));
  const { zendeskApi, replyToSideConversation, createSideConversation } = await import("@/lib/zendesk");
  const scs = (await zendeskApi<{ side_conversations: Array<{ id: string; participants?: Array<{ email?: string | null }> }> }>(`tickets/${ticketId}/side_conversations.json`).catch(() => ({ side_conversations: [] }))).side_conversations ?? [];
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<p>Hi,</p><p>The customer on ${esc(q.reference)} has a question about the job:</p><p>"${esc(pergunta)}"</p><p>Could you let us know? Just reply to this email.</p><p>Thanks,<br>Fixfy Team</p>`;
  const perguntados: string[] = [];
  for (const p of (ps ?? []) as Array<{ id: string; email: string | null; job_cc_emails?: string[] | null; company_name: string | null; contact_name: string | null; zendesk_user_id: string | number | null }>) {
    const email = p.email?.trim().toLowerCase();
    if (!email) continue;
    const nome = p.contact_name || p.company_name || undefined;
    const sc = scs.find((s) => s.participants?.some((x) => String(x.email ?? "").toLowerCase() === email));
    const r = sc
      ? await replyToSideConversation({ ticketId, sideConversationId: sc.id, htmlBody: html, toEmail: email, toName: nome, toUserId: p.zendesk_user_id, extraEmails: p.job_cc_emails ?? [] })
      : await createSideConversation({ ticketId, subject: `Question about ${q.reference}`, htmlBody: html, toEmail: email, toName: nome, toUserId: p.zendesk_user_id != null ? String(p.zendesk_user_id) : null, extraEmails: p.job_cc_emails ?? [] });
    if (r.ok) perguntados.push(p.company_name?.trim() || p.contact_name?.trim() || "partner");
  }
  if (!perguntados.length) return { error: "Could not reach the professional right now. Hand off to the team with the question.", quote: q.reference };
  await sb.from("quote_partner_messages").insert({ message_id: `pergunta:${q.id}:${Date.now()}`, quote_id: q.id, ticket_id: ticketId, kind: "question", body: pergunta }).then(({ error }) => {
    if (error) console.error("[harvey-wa] pergunta ao parceiro (registro):", error.message);
  });
  const { notaComReserva } = await import("./zendesk-wa");
  const postar = notaComReserva(async (id, corpo) => {
    await zendeskApi(`tickets/${id}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: corpo } } } });
  });
  await postar(ticketId, `🤖 HARVEY — the customer asked about ${q.reference} on WhatsApp. I asked ${perguntados.join(", ")} in their side conversation:\n\n"${pergunta}"\n\nTheir reply is read automatically and noted here.`).catch((e) => console.error("[harvey-wa] nota da pergunta:", e));
  return { asked: perguntados.length, quote: q.reference, ticket, note: "Tell them in one line you're checking with the professional and will come back to them here. Do not guess the answer." };
}
