/**
 * O motor da reserva abandonada: manda o toque que venceu para cada lead.
 *
 * Roda a cada 10 minutos pelo n8n (a Vercel do OS é Hobby e não aguenta cron
 * frequente). A sequência, com os horários de agenda.ts:
 *
 *   1  e-mail, 30 min depois de parar (de noite, 8h30)    abre o ticket do lead
 *   2  e-mail, 9h30 do dia seguinte ao envio do 1
 *   3  e-mail com 10%, 9h30 do dia seguinte ao envio do 2
 *   4  WhatsApp com o mesmo código, 15h do dia do 3 (só com telefone)
 *
 * Antes de CADA toque confere de novo, porque o horário foi calculado horas
 * antes e muita coisa pode ter mudado:
 *   - o lead ainda está aberto e com a sequência agendada (pagou, perdeu,
 *     "em contato" ou descadastrou para tudo);
 *   - não marcou "Don't email me offers", não está na lista de bloqueio (no
 *     passo 4, nem na do WhatsApp), e o cliente não tem a etiqueta no-marketing;
 *   - não existe job novo para esse cliente desde que o lead nasceu (rede de
 *     segurança se o aviso de pagamento do site se perder);
 *   - o cliente não respondeu: no ticket dele, em ticket novo do mesmo e-mail
 *     ou no WhatsApp do mesmo número. Respondeu, a sequência para e o lead vira
 *     "em contato" (zendesk-lead.ts);
 *   - é entre 8h e 21h de Londres, e a folga desde o toque anterior foi
 *     cumprida (12 horas entre e-mails, 5 horas até o WhatsApp).
 *
 * Um toque por lead por volta, na ordem 1 → 2 → 3 → 4. O envio é "reservado"
 * gravando o horário antes de mandar; se o Resend ou a Meta falhar, a reserva
 * é desfeita e a próxima volta tenta de novo. Depois de cada toque o próximo é
 * recalculado a partir da hora REAL do envio: atraso empurra a sequência
 * inteira, nunca junta dois toques (o que aconteceria em 25/09/2026, com o
 * envio parado e três leads com os três e-mails vencidos).
 *
 * Toda volta começa varrendo o Zendesk atrás de resposta nova (tickets de
 * lead e conversas de WhatsApp da última hora), para quem já acabou a
 * sequência também virar "em contato" quando responde.
 *
 * Desligado por padrão: só manda com RESERVA_ABANDONADA=on. `dryRun` calcula
 * tudo (lendo o Zendesk, sem escrever nele) e não manda nem grava nada.
 */

import { Resend } from "resend";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { estaBloqueado } from "@/lib/marketing/suppressions";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { NO_MARKETING_TAG } from "@/lib/contacts-ingest";
import { isZendeskConfigured } from "@/lib/zendesk";
import { sendTemplate, toWhatsAppNumber, WhatsAppError } from "@/lib/whatsapp/cloud";
import { email1, email2, email3, type ReservaAbandonada, type EmailPronto } from "@/lib/emails/reserva-abandonada";
import { dentroDaJanelaDeEnvio, folgaCumprida, NOME_DO_PASSO, type Passo } from "@/lib/site-leads/agenda";
import {
  COLUNA_ENVIO,
  COLUNA_VENCE,
  enviadosDoLead,
  horariosDoQueFalta,
  modoRapido,
  registrarAtividade,
  registrarResposta,
} from "@/lib/site-leads/core";
import {
  CAMPANHA_WHATSAPP,
  leadTemWhatsApp,
  parametrosDoCorpo,
  sufixoDoBotao,
  templateDaRetomada,
  tipoDoErro,
  VALIDADE_DO_WHATSAPP_HORAS,
  verificadorDoWhatsApp,
  whatsappDaRetomadaLigado,
} from "@/lib/site-leads/whatsapp-lead";
import {
  acharResposta,
  anotarNoTicket,
  conversasDeWhatsAppMexidas,
  garantirTicketDoLead,
  respostaNoTicket,
  responderPara,
  telefoneDoUsuario,
  ticketsDeLeadMexidos,
  type LeadParaZendesk,
  type Resposta,
  type TicketDoLead,
} from "@/lib/site-leads/zendesk-lead";

const WHATSAPP_NUMERO = "442045384668";
const DESCONTO = 10;
const VALIDADE_HORAS = 48;
const CAMPANHA = "reserva-abandonada";
const HORA = 3_600_000;

/**
 * Cupom FIXO do e-mail 3 quando não há STRIPE_PROMO_SECRET_KEY: criado à mão
 * na Stripe live (Coupons → 10% → Promotion code COMEBACK10, sem restrição de
 * cliente nem de primeira compra). Com a chave, cada lead ganha um código
 * único de 48 h e este fica de reserva.
 */
const CODIGO_FIXO = "COMEBACK10";
const REMETENTE_PADRAO = "Fixfy Team <no-reply@getfixfy.com>";

export function motorLigado(): boolean {
  return process.env.RESERVA_ABANDONADA?.trim().toLowerCase() === "on";
}

// A linha de site_leads como vem do PostgREST (294, 302). Tipos soltos de
// propósito: o motor só lê e confere, e cada campo é validado antes de usar.
type Lead = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ResultadoDoMotor = {
  ensaio: boolean;
  vistos: number;
  enviados: Array<{ lead: string; passo: Passo }>;
  /** Sequência parada ou encerrada por uma regra (pagou, bloqueio, sem WhatsApp…). */
  pulados: Array<{ lead: string; passo: Passo; motivo: string }>;
  /** Fica para uma volta seguinte (janela, folga, template, Zendesk fora). */
  esperando: Array<{ lead: string; passo: Passo; motivo: string }>;
  respostas: Array<{ lead: string; tipo: Resposta["tipo"]; ticket: number }>;
  /** Uma linha por assunto por volta, nada de repetir por lead. */
  avisos: string[];
  erros: string[];
};

export type MensagemDeEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo: string;
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
};

export type OpcoesDoMotor = {
  dryRun?: boolean;
  agora?: Date;
  limite?: number;
  /** Para de pegar lead novo depois disto (a rota tem 120 s). */
  prazoMs?: number;
  /** Para teste: o banco e o envio de e-mail. */
  sb?: SupabaseClient;
  enviarEmail?: (m: MensagemDeEmail) => Promise<{ id: string | null }>;
  /** A lista de bloqueio de e-mail (padrão: suppressions.ts, que abre o próprio cliente do banco). */
  estaBloqueado?: (email: string) => Promise<boolean>;
};

const data = (v: unknown): Date | null => (typeof v === "string" && v ? new Date(v) : v instanceof Date ? v : null);
const mensagem = (err: unknown) => (err instanceof Error ? err.message : String(err));
const parouEm = (l: Lead, agora: Date) => data(l.last_activity_at) ?? data(l.created_at) ?? agora;

function avisarUmaVez(res: ResultadoDoMotor, texto: string) {
  if (!res.avisos.includes(texto)) res.avisos.push(texto);
}

/** O próximo toque que falta, com o horário gravado. Null: não falta nada. */
export function proximoPasso(l: Lead): { passo: Passo; vence: Date | null } | null {
  const enviados = enviadosDoLead(l);
  for (const passo of [1, 2, 3] as const) {
    if (!enviados[passo]) return { passo, vence: data(l[COLUNA_VENCE[passo]]) };
  }
  // O passo 4 só existe se o e-mail 3 saiu com ele marcado (telefone e WhatsApp ligados).
  if (!enviados[4] && l.whatsapp_due_at) return { passo: 4, vence: data(l.whatsapp_due_at) };
  return null;
}

/** Resposta conta a partir do e-mail 1 (ou de quando parou, antes dele), e depois da última resposta já vista. */
function desdeDaResposta(l: Lead, passo: Passo): Date {
  const base = passo === 1 ? data(l.last_activity_at) : data(l.email1_sent_at) ?? data(l.last_activity_at);
  const marcos = [base, data(l.replied_at)].filter((d): d is Date => d != null).map((d) => d.getTime());
  return new Date(marcos.length ? Math.max(...marcos) : 0);
}

/** "a 2 bed deep clean", "an end of tenancy clean". */
function comArtigo(nome: string): string {
  return `${/^[aeiou]/i.test(nome.trim()) ? "an" : "a"} ${nome.trim()}`;
}

/** Botão de continuar: o link do site, com a origem do e-mail e (no 3) o código. */
function linkDeRetomada(l: Lead, passo: Passo, promo?: string): string {
  const base = l.resume_url || "https://www.getfixfy.com/";
  const u = new URL(base);
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_medium", "lifecycle");
  u.searchParams.set("utm_campaign", CAMPANHA);
  u.searchParams.set("utm_content", `email${passo}`);
  if (promo) u.searchParams.set("promo", promo);
  return u.toString();
}

/** Só limpeza no carrinho. Misturou conserto ou certificado, o e-mail não promete foto de cômodo. */
function soLimpeza(sel: Lead["selection"]): boolean {
  const s = Array.isArray(sel?.services) ? (sel.services as unknown[]).map(String) : [];
  return s.length > 0 && s.every((x) => x === "clean");
}

function dadosDoEmail(l: Lead, passo: Passo, promo: ReservaAbandonada["promo"], ticketRef: string | null): ReservaAbandonada {
  const nome = String(l.service_label || "booking").trim();
  const detalhes = Array.isArray(l.selection?.details) ? (l.selection.details as unknown[]).map(String).slice(0, 3) : [];
  const texto = encodeURIComponent(`Hi, I have a question about my ${nome} booking`);
  return {
    firstName: l.full_name,
    service: { name: nome, withArticle: comArtigo(nome) },
    kind: soLimpeza(l.selection) ? "cleaning" : "trade",
    details: detalhes,
    postcode: l.postcode,
    price: Number(l.price ?? 0),
    resumeUrl: linkDeRetomada(l, passo, promo?.code),
    whatsappUrl: `https://wa.me/${WHATSAPP_NUMERO}?text=${texto}`,
    unsubscribeUrl: unsubscribeUrl(l.email),
    promo,
    ticketRef,
  };
}

/**
 * O código de 10% do e-mail 3, um por pessoa, na Stripe do SITE (live).
 *
 * A chave do OS na Vercel é de teste, e código criado em teste não funciona no
 * checkout do site. Por isso a chave aqui é outra: STRIPE_PROMO_SECRET_KEY,
 * uma restrita live com escrita só em Coupons e Promotion codes.
 */
async function criarCodigo(l: Lead, agora: Date): Promise<{ code: string; id: string; expiresAt: Date }> {
  const chave = process.env.STRIPE_PROMO_SECRET_KEY?.trim();
  if (!chave) throw new Error("STRIPE_PROMO_SECRET_KEY ausente");
  const stripe = new Stripe(chave, { typescript: true });
  const expiresAt = new Date(agora.getTime() + VALIDADE_HORAS * HORA);
  const expiraEm = Math.floor(expiresAt.getTime() / 1000);
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const sufixo = Array.from({ length: 5 }, () => letras[Math.floor(Math.random() * letras.length)]).join("");
  const code = `BACK-${sufixo}`;
  const coupon = await stripe.coupons.create({
    percent_off: DESCONTO,
    duration: "once",
    max_redemptions: 1,
    redeem_by: expiraEm,
    name: `Welcome back ${DESCONTO}%`,
    metadata: { site_lead_id: String(l.id), origem: CAMPANHA },
  });
  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    max_redemptions: 1,
    expires_at: expiraEm,
    metadata: { site_lead_id: String(l.id), origem: CAMPANHA },
  });
  return { code, id: promo.id, expiresAt };
}

/**
 * O código do e-mail 3. Se uma volta anterior já criou um (e o envio falhou
 * depois), reaproveita enquanto ele tiver 24 horas pela frente, em vez de abrir
 * outro na Stripe a cada tentativa.
 */
async function codigoDoEmail3(sb: SupabaseClient, l: Lead, agora: Date): Promise<NonNullable<ReservaAbandonada["promo"]>> {
  const preco = Number(l.price);
  const comDesconto = Math.round(preco * (100 - DESCONTO)) / 100;
  const expira = data(l.promo_expires_at);
  if (l.promo_code && (!expira || expira.getTime() - agora.getTime() > 24 * HORA)) {
    return { code: String(l.promo_code), percentOff: DESCONTO, discountedPrice: comDesconto, expiresAt: expira };
  }
  if (process.env.STRIPE_PROMO_SECRET_KEY?.trim()) {
    const c = await criarCodigo(l, agora);
    await sb.from("site_leads").update({ promo_code: c.code, promo_id: c.id, promo_expires_at: c.expiresAt.toISOString() }).eq("id", l.id);
    l.promo_code = c.code;
    l.promo_expires_at = c.expiresAt.toISOString();
    return { code: c.code, percentOff: DESCONTO, discountedPrice: comDesconto, expiresAt: c.expiresAt };
  }
  await sb.from("site_leads").update({ promo_code: CODIGO_FIXO }).eq("id", l.id);
  l.promo_code = CODIGO_FIXO;
  return { code: CODIGO_FIXO, percentOff: DESCONTO, discountedPrice: comDesconto, expiresAt: null };
}

async function motivoParaNaoMandar(sb: SupabaseClient, l: Lead, bloqueado: (email: string) => Promise<boolean>): Promise<string | null> {
  if (!["new", "hot"].includes(l.status)) return `status ${l.status}`;
  if (l.sequence_state !== "scheduled") return `sequence ${l.sequence_state}`;
  if (!l.email) return "no email";
  if (l.marketing_opt_out) return "asked for no offers";
  if (!(Number(l.price) > 0)) return "no price";
  if (await bloqueado(l.email)) return "on the suppression list";
  if (l.client_id) {
    const { data: c } = await sb.from("clients").select("tags").eq("id", l.client_id).maybeSingle();
    if (Array.isArray(c?.tags) && c.tags.includes(NO_MARKETING_TAG)) return "tagged no-marketing";
    const { data: job } = await sb
      .from("jobs")
      .select("id, reference")
      .eq("client_id", l.client_id)
      .gte("created_at", l.created_at)
      .is("deleted_at", null)
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();
    if (job) return `job ${job.reference ?? job.id} created after the lead`;
  }
  return null;
}

/** Motivos para o passo 4 não sair e a sequência FECHAR (não parar): o lead não fez nada de errado. */
async function motivoParaFecharSemWhatsApp(sb: SupabaseClient, l: Lead, agora: Date): Promise<string | null> {
  if (!whatsappDaRetomadaLigado()) return "WhatsApp is off or not configured";
  const fone = toWhatsAppNumber(l.phone);
  if (!fone) return "no valid phone";
  if (!l.promo_code) return "no discount code on the lead";
  const expira = data(l.promo_expires_at);
  if (expira && expira.getTime() - agora.getTime() < 2 * HORA) return `code ${l.promo_code} has expired`;
  const vence = data(l.whatsapp_due_at);
  if (vence && agora.getTime() - vence.getTime() > VALIDADE_DO_WHATSAPP_HORAS * HORA) return `more than ${VALIDADE_DO_WHATSAPP_HORAS} hours late`;
  const { data: barrado } = await sb.from("whatsapp_suppressions").select("phone").eq("phone", fone).maybeSingle();
  if (barrado) return "number opted out of WhatsApp promotions";
  return null;
}

/** Resposta achada: registra no lead e, se veio de OUTRO ticket, avisa o ticket do lead. */
async function aplicarResposta(sb: SupabaseClient, l: Lead, r: Resposta, agora: Date) {
  await registrarResposta(sb, l, r, agora);
  // No próprio ticket do lead não se escreve nada: nota nossa em cima da
  // resposta do cliente poderia tirar o ticket da fila de quem atende.
  const doLead = Number(l.zendesk_ticket_id) || null;
  if (doLead && r.ticketId !== doLead) {
    await anotarNoTicket(
      doLead,
      r.pedidoDeSaida
        ? `The customer asked to stop promotions in ticket #${r.ticketId}. Automatic touches stopped.`
        : `The customer wrote in ticket #${r.ticketId}. Automatic touches stopped: follow up there.`,
    );
  }
}

/**
 * Respostas que chegaram na última hora, antes de olhar quem vence: tickets de
 * lead que se mexeram e conversas de WhatsApp de números de lead.
 */
async function varrerRespostas(sb: SupabaseClient, { ensaio, agora }: { ensaio: boolean; agora: Date }) {
  const achadas: ResultadoDoMotor["respostas"] = [];
  const janela = new Date(agora.getTime() - HORA);

  const tickets = await ticketsDeLeadMexidos(janela);
  if (tickets.length) {
    const { data: leads } = await sb
      .from("site_leads")
      .select("*")
      .in("zendesk_ticket_id", tickets.map((t) => t.id))
      .in("status", ["new", "hot"]);
    for (const l of (leads ?? []) as Lead[]) {
      const r = await respostaNoTicket(Number(l.zendesk_ticket_id), desdeDaResposta(l, 2));
      if (!r) continue;
      achadas.push({ lead: l.id, tipo: r.tipo, ticket: r.ticketId });
      if (!ensaio) await aplicarResposta(sb, l, r, agora);
    }
  }

  const conversas = await conversasDeWhatsAppMexidas(janela);
  if (!conversas.length) return achadas;
  const { data: ativos } = await sb
    .from("site_leads")
    .select("*")
    .eq("channel", "website")
    .in("status", ["new", "hot"])
    .not("phone", "is", null)
    .not("email1_sent_at", "is", null)
    .gte("email1_sent_at", new Date(agora.getTime() - 21 * 24 * HORA).toISOString())
    .limit(500);
  const porFone = new Map<string, Lead>();
  for (const l of (ativos ?? []) as Lead[]) {
    const fone = toWhatsAppNumber(l.phone);
    if (fone && !porFone.has(fone) && !achadas.some((a) => a.lead === l.id)) porFone.set(fone, l);
  }
  if (!porFone.size) return achadas;

  const telefones = new Map<number, string | null>();
  for (const t of conversas) {
    if (!telefones.has(t.requester_id)) telefones.set(t.requester_id, await telefoneDoUsuario(t.requester_id).catch(() => null));
    const fone = telefones.get(t.requester_id);
    const l = fone ? porFone.get(fone) : undefined;
    if (!fone || !l) continue;
    const r = await respostaNoTicket(t.id, desdeDaResposta(l, 2), { soDoSolicitante: t.requester_id });
    if (!r) continue;
    porFone.delete(fone);
    achadas.push({ lead: l.id, tipo: r.tipo, ticket: r.ticketId });
    if (!ensaio) await aplicarResposta(sb, l, r, agora);
  }
  return achadas;
}

function enviarPorResend(): (m: MensagemDeEmail) => Promise<{ id: string | null }> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return async (m) => {
    const { data: enviado, error } = await resend.emails.send({
      from: m.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
      headers: m.headers,
      tags: m.tags,
    });
    if (error) throw new Error(error.message);
    return { id: enviado?.id ?? null };
  };
}

type Contexto = {
  sb: SupabaseClient;
  agora: Date;
  remetente: string;
  enviarEmail: (m: MensagemDeEmail) => Promise<{ id: string | null }>;
  zendesk: boolean;
  res: ResultadoDoMotor;
};

/** Um e-mail (passos 1 a 3): reserva, ticket, envio, registro e o próximo horário. */
async function mandarEmail(ctx: Contexto, l: Lead, passo: 1 | 2 | 3) {
  const { sb, agora, res } = ctx;
  const agoraIso = agora.toISOString();
  const coluna = COLUNA_ENVIO[passo];

  // Reserva o envio: só uma volta ganha.
  const { data: reservado } = await sb
    .from("site_leads")
    .update({ [coluna]: agoraIso, updated_at: agoraIso })
    .eq("id", l.id)
    .is(coluna, null)
    .select("id")
    .maybeSingle();
  if (!reservado) return;

  let ticket: TicketDoLead | null = null;
  let promo: ReservaAbandonada["promo"];
  let e: EmailPronto;
  let providerId: string | null;
  try {
    // O ticket do lead nasce no e-mail 1; se faltou (Zendesk fora), tenta de novo agora.
    if (ctx.zendesk) {
      try {
        ticket = await garantirTicketDoLead(l as LeadParaZendesk);
        if (ticket && Number(l.zendesk_ticket_id) !== ticket.id) {
          await sb.from("site_leads").update({ zendesk_ticket_id: ticket.id }).eq("id", l.id);
          l.zendesk_ticket_id = ticket.id;
        }
        if (ticket?.criado && ticket.observacoes.length) await anotarNoTicket(ticket.id, ticket.observacoes.join("\n"));
      } catch (err) {
        avisarUmaVez(res, `Zendesk ticket not opened for lead ${l.id} (${mensagem(err)}): email goes without it, next touch tries again`);
      }
    }

    if (passo === 3) promo = await codigoDoEmail3(sb, l, agora);
    const dados = dadosDoEmail(l, passo, promo, ticket?.encodedId ?? null);
    e = passo === 1 ? email1(dados) : passo === 2 ? email2(dados) : email3(dados);
    ({ id: providerId } = await ctx.enviarEmail({
      from: ctx.remetente,
      to: [l.email],
      subject: e.subject,
      html: e.html,
      text: e.text,
      replyTo: responderPara(ticket?.encodedId),
      headers: { "List-Unsubscribe": `<${dados.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campaign", value: CAMPANHA }, { name: "step", value: `email${passo}` }],
    }));
  } catch (err) {
    await sb.from("site_leads").update({ [coluna]: null }).eq("id", l.id);
    res.erros.push(`${l.id} email ${passo}: ${mensagem(err)}`);
    return;
  }

  // Saiu. Daqui para baixo nada desfaz a reserva: um erro de registro não pode virar e-mail repetido.
  res.enviados.push({ lead: l.id, passo });
  try {
    await sb.from("marketing_touches").insert({
      email: l.email,
      client_id: l.client_id ?? null,
      campaign: `${CAMPANHA}:email${passo}`,
      channel: "email",
      segment: "b2c",
      subject: e.subject,
      provider_id: providerId,
      sent_at: agoraIso,
    });
    await registrarAtividade(sb, l.id, "email_sent", `Email ${passo} sent: "${e.subject}"`, {
      providerId,
      meta: { step: passo, promo: promo?.code ?? null, ticket: ticket?.id ?? null },
    });
    if (ticket) await anotarNoTicket(ticket.id, `Email ${passo} sent: "${e.subject}"${promo ? ` with code ${promo.code}` : ""}.`);

    // O próximo toque conta a partir de AGORA, a hora real deste envio.
    const enviados = { ...enviadosDoLead(l), [passo]: agora };
    const campos = horariosDoQueFalta(l, parouEm(l, agora), { enviados, comWhatsApp: leadTemWhatsApp(l.phone) });
    const fim = passo === 3 && !campos.whatsapp_due_at;
    await sb.from("site_leads").update({ ...campos, ...(fim ? { sequence_state: "done" } : {}), updated_at: agoraIso }).eq("id", l.id);
  } catch (err) {
    res.erros.push(`${l.id} email ${passo} sent, but recording it failed: ${mensagem(err)}`);
  }
}

/**
 * O WhatsApp (passo 4). Devolve um motivo quando os outros leads desta volta
 * também não devem tentar (template fora, Meta segurando, erro de config).
 */
async function tocarWhatsApp(ctx: Contexto, l: Lead, botaoUrl: number): Promise<string | null> {
  const { sb, agora, res } = ctx;
  const agoraIso = agora.toISOString();
  const fone = toWhatsAppNumber(l.phone) as string;
  const codigo = String(l.promo_code);
  const { nome: template, idioma } = templateDaRetomada();

  const { data: reservado } = await sb
    .from("site_leads")
    .update({ whatsapp_sent_at: agoraIso, updated_at: agoraIso })
    .eq("id", l.id)
    .is("whatsapp_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!reservado) return null;

  // Segunda trava, a das campanhas: uma mensagem por número nesta campanha (índice único da 291).
  const { data: toque, error: erroToque } = await sb
    .from("marketing_touches")
    .insert({
      phone: fone,
      email: l.email ?? null,
      client_id: l.client_id ?? null,
      campaign: CAMPANHA_WHATSAPP,
      channel: "whatsapp",
      segment: "b2c",
      subject: template,
      sent_at: agoraIso,
    })
    .select("id")
    .single();
  if (erroToque || !toque) {
    if (erroToque?.code === "23505") {
      await sb.from("site_leads").update({ whatsapp_sent_at: null, sequence_state: "done", updated_at: agoraIso }).eq("id", l.id);
      await registrarAtividade(sb, l.id, "whatsapp_skipped", "WhatsApp not sent: this number already got the recovery message. Sequence finished.");
      res.pulados.push({ lead: l.id, passo: 4, motivo: "number already got the recovery WhatsApp" });
      return null;
    }
    await sb.from("site_leads").update({ whatsapp_sent_at: null }).eq("id", l.id);
    res.erros.push(`${l.id} WhatsApp: touch not recorded (${erroToque?.message ?? "no row"})`);
    return null;
  }

  let wamid: string;
  try {
    ({ messageId: wamid } = await sendTemplate({
      to: fone,
      name: template,
      language: idioma,
      bodyParams: parametrosDoCorpo(l, codigo),
      urlButtons: [{ index: botaoUrl, suffix: sufixoDoBotao(l, codigo) }],
    }));
  } catch (err) {
    const tipo = tipoDoErro(err);
    const texto = err instanceof WhatsAppError ? `${err.code ?? ""} ${err.message}`.trim() : mensagem(err);
    if (tipo === "numero") {
      await sb.from("marketing_touches").update({ bounced_at: agoraIso }).eq("id", toque.id);
      await sb.from("site_leads").update({ whatsapp_sent_at: null, sequence_state: "done", updated_at: agoraIso }).eq("id", l.id);
      await registrarAtividade(sb, l.id, "whatsapp_skipped", `WhatsApp not delivered (${texto}). Sequence finished.`);
      res.pulados.push({ lead: l.id, passo: 4, motivo: `number refused: ${texto}` });
      return null;
    }
    // Devolve o lugar: a próxima volta tenta de novo.
    await sb.from("marketing_touches").delete().eq("id", toque.id);
    await sb.from("site_leads").update({ whatsapp_sent_at: null }).eq("id", l.id);
    if (tipo === "template" || tipo === "ritmo") {
      res.esperando.push({ lead: l.id, passo: 4, motivo: texto });
      avisarUmaVez(res, `WhatsApp waiting (${tipo === "template" ? "template not usable yet" : "Meta is holding sends"}): ${texto}`);
    } else {
      res.erros.push(`${l.id} WhatsApp: ${texto}`);
    }
    return `WhatsApp paused for this run: ${texto}`;
  }

  res.enviados.push({ lead: l.id, passo: 4 });
  try {
    await sb.from("marketing_touches").update({ provider_id: wamid }).eq("id", toque.id);
    await registrarAtividade(sb, l.id, "whatsapp", `WhatsApp sent with code ${codigo}`, { providerId: wamid, meta: { step: 4, template, promo: codigo } });
    await sb.from("site_leads").update({ sequence_state: "done", updated_at: agoraIso }).eq("id", l.id);
    if (l.zendesk_ticket_id) await anotarNoTicket(l.zendesk_ticket_id, `WhatsApp sent (template ${template}, code ${codigo}).`);
  } catch (err) {
    res.erros.push(`${l.id} WhatsApp sent, but recording it failed: ${mensagem(err)}`);
  }
  return null;
}

export async function rodarMotor(opcoes: OpcoesDoMotor = {}): Promise<ResultadoDoMotor> {
  const { dryRun = true, agora = new Date(), limite = 50, prazoMs = 80_000 } = opcoes;
  const inicio = Date.now();
  const ensaio = dryRun || !motorLigado();
  // Desligado, o n8n continua chamando a cada 10 minutos: aí nem o Zendesk nem a
  // Meta são consultados. Ensaio pedido (?dry-run=1) ou motor ligado, sim.
  const olharFora = dryRun || motorLigado();
  const res: ResultadoDoMotor = { ensaio, vistos: 0, enviados: [], pulados: [], esperando: [], respostas: [], avisos: [], erros: [] };
  const sb = opcoes.sb ?? createServiceClient();
  const agoraIso = agora.toISOString();
  const zendesk = olharFora && isZendeskConfigured();

  // 1. Quem respondeu desde a última volta para aqui, antes de qualquer envio.
  const jaRespondeu = new Set<string>();
  if (zendesk) {
    try {
      for (const r of await varrerRespostas(sb, { ensaio, agora })) {
        res.respostas.push(r);
        jaRespondeu.add(r.lead);
      }
    } catch (err) {
      res.avisos.push(`Zendesk sweep failed (${mensagem(err)}): each touch still checks its lead before sending`);
    }
  }

  // 2. Quem tem toque vencido.
  const { data: leads, error } = await sb
    .from("site_leads")
    .select("*")
    .eq("sequence_state", "scheduled")
    .eq("channel", "website")
    .in("status", ["new", "hot"])
    .or(
      `and(email1_sent_at.is.null,email1_due_at.lte.${agoraIso}),` +
      `and(email2_sent_at.is.null,email2_due_at.lte.${agoraIso}),` +
      `and(email3_sent_at.is.null,email3_due_at.lte.${agoraIso}),` +
      `and(whatsapp_sent_at.is.null,whatsapp_due_at.lte.${agoraIso})`,
    )
    .order("last_activity_at", { ascending: true })
    .limit(limite);
  if (error) {
    res.erros.push(error.message);
    return res;
  }

  // O cliente do Resend só nasce no primeiro envio de verdade (ensaio nunca chega lá).
  let resend: ((m: MensagemDeEmail) => Promise<{ id: string | null }>) | null = null;
  const ctx: Contexto = {
    sb,
    agora,
    // Sai do getfixfy.com, já validado no Resend: não depende de variável (a env só troca, se um dia quiser).
    remetente: process.env.RESEND_MARKETING_FROM?.trim() || REMETENTE_PADRAO,
    enviarEmail: opcoes.enviarEmail ?? ((m) => (resend ??= enviarPorResend())(m)),
    zendesk,
    res,
  };
  const prontoParaWhatsApp = verificadorDoWhatsApp();
  let whatsappParado: string | null = null;

  for (const l of (leads ?? []) as Lead[]) {
    if (Date.now() - inicio > prazoMs) {
      res.avisos.push("time budget reached: the other leads wait for the next run");
      break;
    }
    if (jaRespondeu.has(l.id)) continue;
    res.vistos++;

    const proximo = proximoPasso(l);
    if (!proximo) {
      if (!ensaio) await sb.from("site_leads").update({ sequence_state: "done", updated_at: agoraIso }).eq("id", l.id).eq("sequence_state", "scheduled");
      continue;
    }
    const { passo } = proximo;
    if (!proximo.vence) {
      // Horário que falta (dado antigo ou mexido à mão): grava o da agenda e espera por ele.
      if (!ensaio) await sb.from("site_leads").update({ ...horariosDoQueFalta(l, parouEm(l, agora)), updated_at: agoraIso }).eq("id", l.id);
      continue;
    }
    if (proximo.vence.getTime() > agora.getTime()) continue;

    // Trava da folga, independente do horário gravado (lead antigo, mão no banco).
    const rapido = modoRapido(l);
    const enviados = enviadosDoLead(l);
    if (!folgaCumprida(passo, enviados, agora, rapido)) {
      const campos = horariosDoQueFalta(l, parouEm(l, agora), { enviados });
      res.esperando.push({ lead: l.id, passo, motivo: `too soon after the previous touch, moved to ${campos[COLUNA_VENCE[passo]] ?? "the end"}` });
      if (!ensaio) await sb.from("site_leads").update({ ...campos, updated_at: agoraIso }).eq("id", l.id);
      continue;
    }
    if (!rapido && !dentroDaJanelaDeEnvio(agora)) {
      res.esperando.push({ lead: l.id, passo, motivo: "outside 08:00 to 21:00 London" });
      continue;
    }

    const motivo = await motivoParaNaoMandar(sb, l, opcoes.estaBloqueado ?? estaBloqueado);
    if (motivo) {
      res.pulados.push({ lead: l.id, passo, motivo });
      if (!ensaio) {
        // Job novo ou pedido de não receber: a sequência acaba aqui.
        await sb.from("site_leads").update({ sequence_state: "stopped", updated_at: agoraIso }).eq("id", l.id);
        await registrarAtividade(sb, l.id, passo === 4 ? "whatsapp_skipped" : "email_skipped", `${NOME_DO_PASSO[passo]} not sent: ${motivo}. Sequence stopped.`);
        if (l.zendesk_ticket_id) await anotarNoTicket(l.zendesk_ticket_id, `${NOME_DO_PASSO[passo]} not sent: ${motivo}. Automatic touches stopped.`);
      }
      continue;
    }

    if (passo === 4) {
      const fim = await motivoParaFecharSemWhatsApp(sb, l, agora);
      if (fim) {
        res.pulados.push({ lead: l.id, passo, motivo: fim });
        if (!ensaio) {
          await sb.from("site_leads").update({ sequence_state: "done", updated_at: agoraIso }).eq("id", l.id);
          await registrarAtividade(sb, l.id, "whatsapp_skipped", `WhatsApp not sent: ${fim}. Sequence finished.`);
        }
        continue;
      }
    }

    // O cliente respondeu? Sem saber (Zendesk fora), não manda: tenta na próxima volta.
    if (zendesk) {
      let resposta: Resposta | null;
      try {
        resposta = await acharResposta(l as LeadParaZendesk, desdeDaResposta(l, passo));
      } catch (err) {
        res.esperando.push({ lead: l.id, passo, motivo: `Zendesk check failed (${mensagem(err)}), trying next run` });
        continue;
      }
      if (resposta) {
        res.respostas.push({ lead: l.id, tipo: resposta.tipo, ticket: resposta.ticketId });
        if (!ensaio) await aplicarResposta(sb, l, resposta, agora);
        continue;
      }
    }

    if (passo === 4) {
      if (whatsappParado) {
        res.esperando.push({ lead: l.id, passo, motivo: whatsappParado });
        continue;
      }
      if (!olharFora) {
        res.enviados.push({ lead: l.id, passo });
        continue;
      }
      const pronto = await prontoParaWhatsApp();
      if (!pronto.ok) {
        res.esperando.push({ lead: l.id, passo, motivo: pronto.motivo });
        avisarUmaVez(res, `WhatsApp waiting: ${pronto.motivo}`);
        continue;
      }
      if (ensaio) {
        res.enviados.push({ lead: l.id, passo });
        continue;
      }
      whatsappParado = await tocarWhatsApp(ctx, l, pronto.botaoUrl);
      continue;
    }

    if (ensaio) {
      res.enviados.push({ lead: l.id, passo });
      continue;
    }
    await mandarEmail(ctx, l, passo);
  }
  return res;
}
