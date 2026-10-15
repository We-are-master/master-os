/**
 * Follow-up de quem recebeu o primeiro contato e NUNCA respondeu. Régua do dono
 * em 14/10/2026: agressiva, sem ligação, e o lead fica na view 🎯 Leads o tempo
 * todo. Nada aqui põe 🔴 nem manda para a Action Required: o ticket só sobe
 * quando o cliente responde.
 *
 *   Dia 1  na chegada  WhatsApp de primeiro contato (primeiro-contato.ts, não aqui)
 *   Passo 1  dia 1, 18h   WhatsApp: template quote_request_checkin
 *   Passo 2  dia 2, 10h   e-mail 1 (pedido de fotos, para quem prefere e-mail)
 *   Passo 3  dia 2, 16h   e-mail 2 (como a gente trabalha, vaga esta semana)
 *   Passo 4  dia 3, 10h   e-mail 3 (última nota, os serviços, estamos aqui)
 *   Passo 5  dia 3, 18h   WhatsApp final e solved como no response; dali vai
 *                         para a nutrição.
 *
 * Os e-mails saem como comentário público do ticket do lead, então a resposta
 * cai no mesmo ticket. Lead sem e-mail (o requester é a equipe) só leva os
 * WhatsApps; lead que veio só com e-mail (tag lead_email_sent, o primeiro
 * contato já foi um e-mail) só leva os e-mails. Os dois fecham no dia 3.
 *
 * O WhatsApp final usa HARVEY_WA_LEAD_FINAL_TEMPLATE quando existir um template
 * aprovado para ele; sem isso, repete o quote_request_checkin.
 *
 * Os passos andam em sequência, cada um no seu horário e com 4h de folga do
 * anterior: lead que chega às 19h não leva o check-in às 19h10, leva no dia
 * seguinte às 18h, e o resto anda junto.
 *
 * Lead que já existia quando a régua entrou (14/10/2026) e não tem nenhuma tag
 * lead_fu_*: conta como dia 2 naquele dia (dono). Leva os e-mails 1 e 2 no dia,
 * e o e-mail 3 e o WhatsApp final no dia seguinte.
 *
 * O estado mora no ticket do lead (tags lead_fu_1..lead_fu_5; lead_checkin_sent
 * vale como passo 1 feito). Respondeu em qualquer momento: no WhatsApp o ticket
 * do lead é juntado no da conversa (fecha); por e-mail o comentário dele aparece
 * no ticket e a varredura para. Só de 8h às 21h de Londres, dentro da janela de
 * envio da tela do Harvey.
 *
 * Trava (dono, 15/10/2026): antes de qualquer passo, o lead que já tem job ou quote
 * aberta no OS (mesmo cliente, telefone, e-mail ou ticket) sai da régua sem mensagem
 * ao cliente. Quote: o ticket vai para o status dela (Bidding, Quote Ready, Approval).
 * Job: o ticket do lead fecha como duplicado (What Happened duplicate_ticket) com nota
 * apontando o job. Ticket que já é o do pedido só para a régua. Tag lead_has_order.
 *
 * Roda na rota /api/cron/harvey-wa (n8n a cada 10 min); ?dry-run=1 só lista.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { autorDosEmails, comentarioDoEmail } from "./email-do-leo";
import { zendeskApi, addTicketTags, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { ajustesDoHarvey, janelaAberta } from "./ajustes";
import { externalIdDoLead, idDaIntegracaoWhatsApp } from "./primeiro-contato";
import { scNotificacao } from "./sunshine";
import { registrarDecisao } from "./diario";
import { clientesPeloTelefone } from "./identidade";
import { ZD_STATUS_AWAITING_APPROVAL, ZD_STATUS_BIDDING, ZD_STATUS_QUOTE_READY } from "@/lib/zendesk-statuses";

const H = 3_600_000;
const TEMPLATE_CHECKIN = process.env.HARVEY_WA_LEAD_CHECKIN_TEMPLATE?.trim() || "quote_request_checkin";
const TEMPLATE_FINAL = process.env.HARVEY_WA_LEAD_FINAL_TEMPLATE?.trim() || TEMPLATE_CHECKIN;
/** Passos que são WhatsApp; os outros são e-mail. */
const PASSOS_DE_WHATSAPP = new Set([1, 5]);
const RESOLUCAO = 5872761703199; // campo Resolution
/** Estágio 🎯 Lead (categoria pending). Só `status: pending` cairia no On Hold padrão, que é a Needs Attention. */
const ESTAGIO_LEAD = 6417913706527;
const WHATSAPP_DA_FIXFY = "020 4538 4668";
const WHAT_HAPPENED = 5687150349343;
/** Lead que já tem pedido no OS: a régua não volta a olhar. */
const TAG_TEM_PEDIDO = "lead_has_order";

export type ResultadoFollowup = { ensaio: boolean; olhados: number; enviados: string[]; fechados: string[]; pulados: string[]; jaComPedido: string[] };

type Ticket = { id: number; status: string; tags: string[]; created_at?: string; requester_id?: number; subject?: string };
type Comentario = { created_at: string; author_id: number; public: boolean };

// ─── A régua (pura, sem rede) ───────────────────────────────────────────────

type Relogio = { dia: string; hora: number };

function emLondres(d: Date): Relogio {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hour12: false }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { dia: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")) % 24 };
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / (24 * H));
}

/** Quantos passos já foram feitos, pelas tags do ticket. */
export function passosFeitos(tags: Iterable<string>, soPorEmail: boolean): number {
  const s = new Set(tags);
  let n = soPorEmail ? 1 : 0;
  if (s.has("lead_checkin_sent")) n = Math.max(n, 1);
  for (let i = 1; i <= 5; i++) if (s.has(`lead_fu_${i}`)) n = Math.max(n, i);
  return n;
}

/**
 * O próximo passo que já pode sair agora, ou null. `primeiro` é o primeiro
 * contato; `ultimo`, quando saiu o passo anterior (o comentário mais novo do ticket).
 */
export function proximoPasso(feitos: number, primeiro: Date, ultimo: Date, agora: Date): number | null {
  const passo = feitos + 1;
  if (passo > 5) return null;
  const a = emLondres(agora);
  const folga = agora.getTime() - ultimo.getTime() >= 4 * H;
  const outroDia = diasEntre(emLondres(ultimo).dia, a.dia) >= 1;
  switch (passo) {
    case 1:
      return a.hora >= 18 && folga ? 1 : null;
    case 2:
      return a.hora >= 10 && outroDia ? 2 : null;
    case 3:
      return a.hora >= 16 && folga ? 3 : null;
    case 4:
      return a.hora >= 10 && outroDia ? 4 : null;
    default:
      return a.hora >= 18 && folga ? 5 : null;
  }
}

/** O dia em que esta régua entrou, e a véspera, que vira o "dia 1" dos leads de antes dela. */
const INICIO_DA_REGUA = "2026-10-14";
const VESPERA_DA_REGUA = "2026-10-13";

/** Lead de antes da régua que ainda não recebeu nenhum passo dela. */
export function ehDaReguaAntiga(primeiro: Date, tags: Iterable<string>): boolean {
  const s = [...tags];
  return emLondres(primeiro).dia < INICIO_DA_REGUA && !s.some((t) => /^lead_fu_\d$/.test(t));
}

// ─── A trava: lead que já tem pedido no OS (pura) ───────────────────────────

/** Quanto antes do primeiro contato um job ou quote ainda conta como o mesmo pedido. */
const JANELA_DO_PEDIDO_DIAS = 14;
const QUOTE_ABERTA: Record<string, number> = {
  draft: ZD_STATUS_BIDDING,
  in_survey: ZD_STATUS_BIDDING,
  bidding: ZD_STATUS_BIDDING,
  quote_ready: ZD_STATUS_QUOTE_READY,
  awaiting_customer: ZD_STATUS_AWAITING_APPROVAL,
  awaiting_payment: ZD_STATUS_AWAITING_APPROVAL,
};
const JOB_MORTO = new Set(["cancelled", "deleted"]);

export type PedidoDoOs = { reference: string; status: string; ticketId: string | null; criadoEm: string };
export type DestinoDoLead =
  | { acao: "seguir" }
  | { acao: "job"; pedido: PedidoDoOs; mesmoTicket: boolean }
  | { acao: "quote"; pedido: PedidoDoOs; statusId: number; mesmoTicket: boolean };

/**
 * O lead segue a régua, ou já existe pedido no OS? Job vivo vence quote aberta; entre
 * iguais, o mais novo. Só conta o que nasceu até 14 dias antes do primeiro contato:
 * cliente antigo que volta com pedido novo continua na régua.
 */
export function destinoDoLead(a: { jobs: PedidoDoOs[]; quotes: PedidoDoOs[]; primeiro: Date; ticketDoLead: number }): DestinoDoLead {
  const desde = a.primeiro.getTime() - JANELA_DO_PEDIDO_DIAS * 24 * H;
  const recente = (p: PedidoDoOs) => Date.parse(p.criadoEm) >= desde;
  const maisNovo = (x: PedidoDoOs[]) => [...x].sort((p, q) => Date.parse(q.criadoEm) - Date.parse(p.criadoEm))[0];
  const mesmo = (p: PedidoDoOs) => p.ticketId !== null && String(p.ticketId) === String(a.ticketDoLead);
  const job = maisNovo(a.jobs.filter((j) => !JOB_MORTO.has(j.status) && recente(j)));
  if (job) return { acao: "job", pedido: job, mesmoTicket: mesmo(job) };
  const quote = maisNovo(a.quotes.filter((q) => q.status in QUOTE_ABERTA && recente(q)));
  if (quote) return { acao: "quote", pedido: quote, statusId: QUOTE_ABERTA[quote.status], mesmoTicket: mesmo(quote) };
  return { acao: "seguir" };
}

/** A nota interna da trava. Nunca vai para o cliente. */
export function notaDoPedidoExistente(d: Exclude<DestinoDoLead, { acao: "seguir" }>, linkDoTicket: (id: string) => string): string {
  const onde = d.pedido.ticketId && !d.mesmoTicket ? ` (ticket #${d.pedido.ticketId}: ${linkDoTicket(d.pedido.ticketId)})` : "";
  const oQue = d.acao === "job" ? `job ${d.pedido.reference}` : `quote ${d.pedido.reference} (${d.pedido.status.replace(/_/g, " ")})`;
  const depois =
    d.acao === "job"
      ? d.mesmoTicket ? "Follow-up stopped on this ticket." : "Solved as a duplicate of that ticket."
      : "Follow-up stopped; ticket moved to match the quote.";
  return `Lead follow-up skipped: the customer already has ${oQue} in the OS${onde}. ${depois} Nothing was sent to the customer.`;
}

// ─── Os textos ──────────────────────────────────────────────────────────────

export function emailDoPasso(passo: number, nome: string, servico: string): string {
  const fim = ["", "Thank you,"];
  const corpos: Record<number, string[]> = {
    2: [
      `We sent you a WhatsApp about your Checkatrade request for ${servico}, and thought email might be easier.`,
      "",
      "Could you reply with a few photos of the job? We'll come back with a clear price, usually the same day.",
      "",
      `Prefer to chat? Message us on WhatsApp on ${WHATSAPP_DA_FIXFY}.`,
    ],
    3: [
      `A quick note on how we work, in case it helps with your ${servico} job:`,
      "",
      "· A clear price agreed before any work starts",
      "· No call-out fee",
      "· Vetted, insured professionals",
      "· Every job backed by our workmanship guarantee",
      "",
      "We still have availability this week. Reply with a photo and your postcode and we'll get you booked in.",
    ],
    4: [
      `A last note from us about your request for ${servico}. If you'd still like it done, just reply and we'll price it today. If you've already sorted it, no problem.`,
      "",
      "Whenever you need anything else, we're here. Across London we cover:",
      "",
      "· Handyman jobs, carpentry and furniture assembly",
      "· Plumbing and electrical work",
      "· Painting and decorating",
      "· End of tenancy and deep cleaning",
      "",
      `Just reply to this email or message us on WhatsApp on ${WHATSAPP_DA_FIXFY}.`,
    ],
  };
  return [`Hi ${nome},`, "", ...(corpos[passo] ?? []), ...fim].join("\n");
}

// ─── Zendesk ────────────────────────────────────────────────────────────────

async function ticketDoLead(leadExterno: string): Promise<Ticket | null> {
  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`tickets.json?external_id=${encodeURIComponent(externalIdDoLead(leadExterno))}`);
  return tickets?.find((t) => !["solved", "closed"].includes(t.status)) ?? null;
}

async function comentarios(ticket: number): Promise<Comentario[]> {
  const { comments } = await zendeskApi<{ comments?: Comentario[] }>(`tickets/${ticket}/comments.json?sort_order=desc&per_page=30`);
  return comments ?? [];
}

/** O e-mail do requester, se for o cliente (e não o e-mail da equipe que o ticket usa quando o lead veio sem e-mail). */
async function emailDoCliente(t: Ticket): Promise<{ email: string; nome: string | null } | null> {
  if (!t.requester_id) return null;
  const { user } = await zendeskApi<{ user?: { email?: string | null; name?: string | null } }>(`users/${t.requester_id}.json`);
  const email = String(user?.email ?? "").trim().toLowerCase();
  return email && !/@getfixfy\.com$/.test(email) ? { email, nome: user?.name ?? null } : null;
}

async function mandarTemplateNoWhatsApp(template: string, telefone: string, nome: string, servico: string, leadExterno: string) {
  await scNotificacao({
    destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: telefone },
    author: { role: "appMaker" },
    messageSchema: "whatsapp",
    message: {
      type: "template",
      template: {
        namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
        name: template,
        language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
        components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: `your ${servico} request` }] }],
      },
    },
    metadata: { origem: "lead_checkin", leadExterno },
  });
}

function linkDoTicket(id: string): string {
  const sub = process.env.ZENDESK_SUBDOMAIN?.trim();
  return sub ? `https://${sub}.zendesk.com/agent/tickets/${id}` : `#${id}`;
}

/** Jobs e quotes do OS que podem ser o pedido deste lead: cliente, telefone, e-mail ou o próprio ticket. */
async function pedidosDoLead(sb: SupabaseClient, l: { clienteId: string | null; telefone: string | null; email: string | null; ticketId: number; desde: string }): Promise<{ jobs: PedidoDoOs[]; quotes: PedidoDoOs[] }> {
  // ilike sem curinga: "_" é comum em e-mail.
  const email = l.email ? l.email.replace(/[%_\\]/g, "\\$&") : null;
  const clientes = new Set<string>();
  if (l.clienteId) clientes.add(l.clienteId);
  for (const id of await clientesPeloTelefone(sb, l.telefone).catch(() => [] as string[])) clientes.add(id);
  if (email) {
    const { data } = await sb.from("clients").select("id").ilike("email", email).is("deleted_at", null).limit(10);
    for (const c of (data ?? []) as Array<{ id: string }>) clientes.add(c.id);
  }
  const ids = [...clientes];
  type Linha = { reference: string; status: string; external_source: string | null; external_ref: string | null; created_at: string };
  const campos = "reference, status, external_source, external_ref, created_at";
  const ler = async (tabela: "jobs" | "quotes"): Promise<PedidoDoOs[]> => {
    const linhas: Linha[] = [];
    if (ids.length) {
      const { data } = await sb.from(tabela).select(campos).in("client_id", ids).is("deleted_at", null).gte("created_at", l.desde).limit(20);
      linhas.push(...((data ?? []) as Linha[]));
    }
    const { data: doTicket } = await sb.from(tabela).select(campos).eq("external_source", "zendesk").eq("external_ref", String(l.ticketId)).is("deleted_at", null).limit(5);
    linhas.push(...((doTicket ?? []) as Linha[]));
    if (tabela === "quotes" && email) {
      const { data } = await sb.from("quotes").select(campos).ilike("client_email", email).is("deleted_at", null).gte("created_at", l.desde).limit(10);
      linhas.push(...((data ?? []) as Linha[]));
    }
    const vistos = new Set<string>();
    return linhas
      .filter((x) => !vistos.has(x.reference) && vistos.add(x.reference))
      .map((x) => ({ reference: x.reference, status: x.status, ticketId: x.external_source === "zendesk" && x.external_ref ? String(x.external_ref) : null, criadoEm: x.created_at }));
  };
  return { jobs: await ler("jobs"), quotes: await ler("quotes") };
}

/** Tira o lead da régua: status da quote ou solved como duplicado. Nunca fala com o cliente. */
async function tirarDaRegua(t: Ticket, d: Exclude<DestinoDoLead, { acao: "seguir" }>): Promise<void> {
  const corpo: Record<string, unknown> = { comment: { public: false, body: notaDoPedidoExistente(d, linkDoTicket) } };
  if (d.acao === "quote") corpo.custom_status_id = d.statusId;
  else if (!d.mesmoTicket) {
    corpo.status = "solved";
    corpo.custom_fields = [{ id: WHAT_HAPPENED, value: "duplicate_ticket" }];
  }
  await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: corpo } });
  await addTicketTags(t.id, [TAG_TEM_PEDIDO]);
}

const PROXIMO: Record<number, string> = {
  1: "Next: email tomorrow at 10am.",
  2: "Next: email at 4pm.",
  3: "Next: last email tomorrow at 10am.",
  4: "Next: last WhatsApp at 6pm, then solved as no response.",
};

type Lead = { ticket: Ticket; telefone: string | null; nome: string; servico: string; leadExterno: string | null; primeiro: Date; soPorEmail: boolean; clienteId: string | null };

/** Um lead: decide o passo e, com `aplicar`, executa. O ticket nunca sai da view Leads. */
async function seguirLead(sb: SupabaseClient, l: Lead, out: ResultadoFollowup, aplicar: boolean, agora: Date) {
  const t = l.ticket;
  const tags = new Set(t.tags);
  if (tags.has("lead_no_response") || tags.has(TAG_TEM_PEDIDO)) return;
  const cs = await comentarios(t.id).catch(() => [] as Comentario[]);
  // Respondeu por e-mail: o comentário dele está no ticket. A Action Required cuida dali.
  if (cs.some((c) => c.public && t.requester_id && c.author_id === t.requester_id)) return;
  out.olhados++;
  let feitos = passosFeitos(tags, l.soPorEmail);
  let primeiro = l.primeiro;
  let ultimo = cs[0] ? new Date(cs[0].created_at) : l.primeiro;
  if (ehDaReguaAntiga(l.primeiro, tags)) {
    // Dono, 14/10/2026: o lead antigo entra hoje como dia 2.
    feitos = Math.max(feitos, 1);
    primeiro = ultimo = new Date(`${VESPERA_DA_REGUA}T12:00:00Z`);
  }
  const passo = proximoPasso(feitos, primeiro, ultimo, agora);
  if (!passo) return;
  const quem = `#${t.id} passo ${passo}${l.telefone ? ` ${l.telefone}` : " e-mail"}`;

  // Trava: já existe job ou quote no OS para esta pessoa. Só olha quando há passo a dar.
  try {
    const cliente = await emailDoCliente(t).catch(() => null);
    const desde = new Date(l.primeiro.getTime() - JANELA_DO_PEDIDO_DIAS * 24 * H).toISOString();
    const pedidos = await pedidosDoLead(sb, { clienteId: l.clienteId, telefone: l.telefone, email: cliente?.email ?? null, ticketId: t.id, desde });
    const destino = destinoDoLead({ ...pedidos, primeiro: l.primeiro, ticketDoLead: t.id });
    if (destino.acao !== "seguir") {
      out.jaComPedido.push(`#${t.id}: ${destino.acao} ${destino.pedido.reference}${destino.pedido.ticketId ? ` (#${destino.pedido.ticketId})` : ""}`);
      if (!aplicar) return;
      await tirarDaRegua(t, destino);
      await registrarDecisao({ origem: "followup", ticketId: t.id, decisao: `Lead follow-up stopped: the customer already has ${destino.acao} ${destino.pedido.reference} in the OS`, regra: "lead with a job or open quote leaves the cadence (owner, 15/10/2026)", pendente: null });
      return;
    }
  } catch (e) {
    // Sem saber, não manda: tenta de novo no próximo ciclo.
    out.pulados.push(`${quem}: checagem de pedido no OS falhou (${e instanceof Error ? e.message.slice(0, 100) : "erro"})`);
    return;
  }
  if (passo === 5) out.fechados.push(quem);
  else out.enviados.push(quem);
  if (!aplicar) return;

  try {
    const cliente = await emailDoCliente(t).catch(() => null);
    const feito: string[] = [];
    const corpoDoTicket: Record<string, unknown> = {};
    if (PASSOS_DE_WHATSAPP.has(passo)) {
      if (l.telefone && l.leadExterno) {
        const tpl = passo === 1 ? TEMPLATE_CHECKIN : TEMPLATE_FINAL;
        await mandarTemplateNoWhatsApp(tpl, l.telefone, l.nome, l.servico, l.leadExterno);
        feito.push(`WhatsApp ${passo === 1 ? "check-in" : "last message"} (${tpl})`);
      }
    } else if (cliente) {
      // Sai de quem assina os e-mails (papel autor_emails), com a assinatura que o Zendesk acrescenta (dono, 15/10/2026).
      corpoDoTicket.comment = { ...comentarioDoEmail(emailDoPasso(passo, l.nome, l.servico).replace(/\n\nThank you,$/, ""), (await autorDosEmails()).zendesk_user_id, "Thank you,") };
      feito.push(`email to ${cliente.email}`);
    }
    if (!corpoDoTicket.comment) {
      corpoDoTicket.comment = {
        body: `Lead follow-up step ${passo}: ${feito.length ? feito.join(", ") : `nothing to send (no ${PASSOS_DE_WHATSAPP.has(passo) ? "phone" : "email"} on this lead)`}. ${passo === 5 ? "Solved as no response." : PROXIMO[passo] ?? ""}`.trim(),
        public: false,
      };
    }
    if (passo === 5) {
      corpoDoTicket.status = "solved";
      // "What Happened" também: é o campo que o relatório de perda lê (dono, 14/10/2026).
      corpoDoTicket.custom_fields = [{ id: RESOLUCAO, value: "res_no_response" }, { id: 5687150349343, value: "no_reply" }];
    } else {
      // A bola está com o cliente: fica no estágio Lead, na view Leads, longe da Action Required.
      corpoDoTicket.custom_status_id = ESTAGIO_LEAD;
      corpoDoTicket.custom_fields = [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_replied" }];
    }
    await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: corpoDoTicket } });
    await addTicketTags(t.id, passo === 5 ? [`lead_fu_${passo}`, "lead_no_response"] : [`lead_fu_${passo}`, "lead_gen"]);
    // Ticket da régua antiga: tira a marca de "ligar" para nenhum gatilho mandar de volta ao To Call.
    if (tags.has("lead_call") || tags.has("lead_replied")) {
      await zendeskApi(`tickets/${t.id}/tags.json`, { method: "DELETE", body: { tags: ["lead_call", "lead_replied"] } });
    }
    // A bola está com o cliente: nada fica pendente com a equipe (não entra no brief).
    await registrarDecisao({ origem: "followup", ticketId: t.id, decisao: `Lead follow-up step ${passo}: ${feito.length ? feito.join(", ") : "nothing to send"}${passo === 5 ? ", solved as no response" : ""}`, regra: "lead follow-up cadence (owner, 14/10/2026)", pendente: null });
  } catch (e) {
    out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 120) : "falhou"}`);
  }
}

export async function varrerFollowupDeLeads(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoFollowup> {
  const out: ResultadoFollowup = { ensaio: !aplicar, olhados: 0, enviados: [], fechados: [], pulados: [], jaComPedido: [] };
  if (!janelaAberta(await ajustesDoHarvey(), agora)) return out;
  const hora = emLondres(agora).hora;
  if (hora < 8 || hora >= 21) return out;

  // Leads do WhatsApp (primeiro contato pelo template).
  const { data: leads } = await sb
    .from("harvey_wa_leads")
    .select("telefone, cliente_id, lead_externo, servico, enviado_em, origem")
    .not("lead_externo", "is", null)
    .gte("enviado_em", new Date(agora.getTime() - 8 * 24 * H).toISOString())
    .limit(200);

  for (const l of leads ?? []) {
    if (l.origem === "site") continue;
    // Respondeu? A conversa do WhatsApp tem mensagem dele depois do template.
    const { data: conv } = await sb.from("harvey_wa_conversas").select("cliente_em").eq("phone", l.telefone).maybeSingle();
    if (conv?.cliente_em && new Date(conv.cliente_em as string) > new Date(l.enviado_em as string)) continue;
    const t = await ticketDoLead(l.lead_externo as string).catch(() => null);
    if (!t) continue; // juntado (respondeu) ou já resolvido
    const { data: c } = await sb.from("clients").select("full_name").eq("id", l.cliente_id).maybeSingle();
    await seguirLead(
      sb,
      {
        ticket: t,
        clienteId: (l.cliente_id as string | null) ?? null,
        telefone: l.telefone as string,
        nome: firstName((c?.full_name as string | null) ?? null) ?? "there",
        servico: String(l.servico ?? "your job").trim(),
        leadExterno: l.lead_externo as string,
        primeiro: new Date(l.enviado_em as string),
        soPorEmail: false,
      },
      out,
      aplicar,
      agora,
    );
  }

  // Leads que vieram sem telefone: o primeiro contato já foi um e-mail, na criação do ticket.
  const desde = new Date(agora.getTime() - 8 * 24 * H).toISOString().slice(0, 10);
  const q = `type:ticket tags:lead_email_sent status<solved created>${desde}`;
  const { results } = await zendeskApi<{ results?: Ticket[] }>(`search.json?query=${encodeURIComponent(q)}`).catch(() => ({ results: [] as Ticket[] }));
  for (const t of results ?? []) {
    if (!t.created_at) continue;
    const cliente = await emailDoCliente(t).catch(() => null);
    await seguirLead(
      sb,
      {
        ticket: t,
        clienteId: null,
        telefone: null,
        nome: firstName(cliente?.nome ?? null) ?? "there",
        servico: String(t.subject ?? "").split("·")[1]?.trim().toLowerCase() || "your job",
        leadExterno: null,
        primeiro: new Date(t.created_at),
        soPorEmail: true,
      },
      out,
      aplicar,
      agora,
    );
  }
  return out;
}
