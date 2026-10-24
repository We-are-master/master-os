/**
 * Cobrança de quote enviada: ticket em 🟠 Awaiting approval esperando o cliente.
 *
 * Régua do dono (24/10/2026, troca a de três lembretes de 14/10 e a B2B de 17/10):
 *
 *   conta (B2B ou plataforma)   1 lembrete 24h depois da quote, só e-mail,
 *                               e fecha 72h depois dele sem resposta (dia 4)
 *   cliente da Fixfy            2 lembretes, 24h e 72h depois da quote, por UM
 *                               canal (o da conversa: WhatsApp ou e-mail), e fecha
 *                               48h depois do 2º sem resposta (dia 5)
 *
 * Conta é a tag `b2b` no ticket OU a conta da quote com process_type b2b/platform.
 * O último lembrete já avisa o dia em que fecha.
 *
 * Fecha como solved com o formulário preenchido: Resolution, What Happened e
 * Closing Summary (o que aconteceu, em uma frase, com a referência da quote).
 *
 * Se o cliente responde que não precisa mais ("no longer needed", "found someone",
 * "too expensive"...), o ticket fecha na hora com o motivo e uma resposta curta.
 * Qualquer outra resposta fica com a equipe: o Reply Status vira 🔴 e o ticket
 * sobe para a Action Required, como sempre.
 *
 * Estado nas tags do ticket: `quote_chase_1..2` (`quote_chase_3` de antes conta
 * como régua cumprida), `quote_closed_no_reply`, `quote_closed_by_customer`.
 * Só 8h às 20h de Londres.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { autorDosEmails, comentarioDoEmail, montarEmail, REMETENTE_DA_EQUIPE, type EmailDeAcompanhamento } from "./email-do-leo";
import { dataLonga, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { imovelCurto, servicoCurto } from "@/lib/zendesk-quote-sent";
import { zendeskApi, addTicketTags } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { historico, scApi, scNotificacao } from "./sunshine";
import { idDaIntegracaoWhatsApp } from "./primeiro-contato";
import { processosV2Ligado } from "@/lib/processo/conta";
import { processoDaQuoteV2 } from "@/lib/processo/quote";
import { canalAtivo, canaisParaEnviar, registrarCanalAtivo, type CanalAtivo } from "@/lib/processo/canal-ativo";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

const STATUS_APPROVAL = Number(process.env.ZENDESK_STATUS_APPROVAL?.trim() || "5688280626847");
const VIEW_QUOTING = Number(process.env.ZENDESK_VIEW_QUOTING?.trim() || "5685293799071");
/** Campos do formulário Job usados no fechamento. */
const WHAT_HAPPENED = Number(process.env.ZENDESK_WHAT_HAPPENED_FIELD_ID?.trim() || "5687150349343");
const RESOLUCAO = 5872761703199;
const CLOSING_SUMMARY = Number(process.env.ZENDESK_CLOSING_SUMMARY_FIELD_ID?.trim() || "6417950403231");
const H = 3_600_000;

export type ResultadoQuotes = { ensaio: boolean; olhados: number; enviados: string[]; fechados: string[]; pulados: string[] };

type Ticket = { id: number; subject: string; tags: string[]; custom_status_id?: number; requester_id: number; via?: { channel?: string } };
type Comentario = { public: boolean; author_id: number; created_at: string; body?: string; via?: { channel?: string } };
type Passo = 1 | 2 | "fechar";

/** Conta (B2B ou plataforma) tem um lembrete; cliente da Fixfy, dois. */
export type TipoDaCobranca = "conta" | "fixfy";

function horaDeLondres(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(d));
}

/** A régua em horas desde a quote: os lembretes e o fechamento. */
export type ReguaDaCobranca = { lembretes: number[]; fecha: number };
export const REGUAS: Record<TipoDaCobranca, ReguaDaCobranca> = {
  conta: { lembretes: [24], fecha: 24 + 72 },
  fixfy: { lembretes: [24, 72], fecha: 72 + 48 },
};

/** Horas entre o último lembrete e o fechamento (o "se não responder até..."). */
export const horasAteFechar = (tipo: TipoDaCobranca) => REGUAS[tipo].fecha - REGUAS[tipo].lembretes.at(-1)!;

/** Quantos lembretes já saíram, pelas tags e pelos envios confirmados (o maior dos dois). */
export function lembretesFeitos(tags: readonly string[], enviados: readonly number[] = []): number {
  const pelasTags = tags.includes("quote_chase_3") ? 3 : tags.includes("quote_chase_2") ? 2 : tags.includes("quote_chase_1") ? 1 : 0;
  return Math.max(pelasTags, ...enviados, 0);
}

/**
 * O próximo passo, contado da última mensagem nossa (depois do 1º lembrete, o
 * lembrete anterior). Quem já tem mais lembretes que a régua (régua antiga) só fecha.
 */
export function proximoPassoDaRegua(tags: readonly string[], feitos: number, horasDesdeNossa: number, regua: ReguaDaCobranca): Passo | null {
  if (tags.includes("quote_closed_no_reply") || tags.includes("quote_closed_by_customer")) return null;
  const marcos = [0, ...regua.lembretes, regua.fecha];
  if (feitos >= regua.lembretes.length) return horasDesdeNossa >= regua.fecha - regua.lembretes.at(-1)! ? "fechar" : null;
  if (horasDesdeNossa < marcos[feitos + 1]! - marcos[feitos]!) return null;
  return (feitos + 1) as 1 | 2;
}

/** A régua pelas tags (ticket fora da v2). */
export function proximoPasso(tags: string[], horasDesdeNossa: number, tipo: TipoDaCobranca = "fixfy"): Passo | null {
  return proximoPassoDaRegua(tags, lembretesFeitos(tags), horasDesdeNossa, REGUAS[tipo]);
}

export type QuoteDaCobranca = {
  id: string;
  status: string | null;
  customer_accepted?: boolean | null;
  customer_deposit_paid?: boolean | null;
  conversation_channel?: string | null;
};

/** Antes de cada lembrete (e do fechamento): a quote ainda espera o cliente? Devolve o motivo para parar. */
export function motivoParaPararCobranca(q: QuoteDaCobranca | null): string | null {
  if (!q) return "quote not found";
  const st = String(q.status ?? "");
  if (st === "converted_to_job") return "quote already converted to a job";
  if (st === "awaiting_payment") return "quote accepted, waiting for payment";
  if (st === "rejected") return "quote rejected";
  if (q.customer_accepted) return "customer already accepted";
  if (q.customer_deposit_paid) return "deposit already paid";
  return null;
}

/** Canais de conversa por mensagem (o lembrete do WhatsApp aparece no ticket por aqui). */
const CANAIS_DE_MENSAGEM = new Set(["whatsapp", "native_messaging", "sunshine_conversations_api", "sunshine_conversations_facebook_messenger", "chat"]);

/**
 * A equipe entrou depois do último lembrete: um comentário público de quem não
 * é o cliente, criado depois do lembrete (com 2 min de folga para o próprio
 * lembrete). Os comentários de conversa (WhatsApp) ficam de fora: lá a marca
 * é a conversa ter passado para a equipe.
 */
export function intervencaoManual(comentarios: readonly Comentario[], desde: string | null | undefined, requesterId: number): boolean {
  const t0 = Date.parse(String(desde ?? ""));
  if (!Number.isFinite(t0)) return false;
  return comentarios.some((c) => c.public && c.author_id !== requesterId && Date.parse(c.created_at) > t0 + 120_000 && !CANAIS_DE_MENSAGEM.has(String(c.via?.channel ?? "")));
}

/** A resposta do cliente veio por e-mail (para gravar o canal ativo). */
export function respostaPorEmail(c: Pick<Comentario, "public" | "author_id" | "via"> | undefined, requesterId: number): boolean {
  return !!c && c.public && c.author_id === requesterId && c.via?.channel === "email";
}

export const chaveDaCobranca = (quoteId: string, n: 1 | 2 | 3) => chaveDeEnvio("quote-chase", quoteId, n);

/** Conta (B2B ou plataforma) ou cliente da Fixfy: a tag b2b, senão o process_type da conta da quote. */
async function tipoDaCobranca(sb: SupabaseClient, t: Pick<Ticket, "id" | "tags">): Promise<TipoDaCobranca> {
  if (ehB2B(t)) return "conta";
  const { data } = await sb.from("quotes").select("source_account_id").eq("external_source", "zendesk").eq("external_ref", String(t.id)).is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
  const conta = (data?.[0] as { source_account_id?: string | null } | undefined)?.source_account_id;
  if (!conta) return "fixfy";
  const { data: a } = await sb.from("accounts").select("process_type").eq("id", conta).maybeSingle();
  const tipo = (a as { process_type?: string | null } | null)?.process_type;
  return tipo === "b2b" || tipo === "platform" ? "conta" : "fixfy";
}

type ContextoV2 = { quote: QuoteDaCobranca; enviados: number[]; ultimoEnvioEm: string | null };

/** A quote do ticket na v2 (conta direta com regras.v2). Fora disso: null, e a régua é a de sempre. */
async function contextoV2(sb: SupabaseClient, ticketId: number): Promise<ContextoV2 | null> {
  if (!processosV2Ligado()) return null;
  const { data } = await sb
    .from("quotes")
    .select("id, status, customer_accepted, customer_deposit_paid, conversation_channel, source_account_id, client_id")
    .eq("external_source", "zendesk")
    .eq("external_ref", String(ticketId))
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const q = (data?.[0] ?? null) as (QuoteDaCobranca & { source_account_id: string | null; client_id: string | null }) | null;
  if (!q) return null;
  const regras = await processoDaQuoteV2(sb, q);
  if (!regras || regras.tipo !== "direct") return null;
  const chaves = ([1, 2, 3] as const).map((n) => chaveDaCobranca(q.id, n));
  const { data: env } = await sb.from("outbound_messages").select("dedupe_key, sent_at").in("dedupe_key", chaves).eq("status", "sent");
  const linhas = (env ?? []) as Array<{ dedupe_key: string; sent_at: string | null }>;
  const enviados = linhas.map((l) => Number(l.dedupe_key.split(":").at(-1))).filter((n) => n >= 1 && n <= 3);
  const ultimoEnvioEm = linhas.map((l) => l.sent_at).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { quote: q, enviados, ultimoEnvioEm };
}

/** A quote fresca, logo antes de mandar. */
async function quoteFresca(sb: SupabaseClient, id: string): Promise<QuoteDaCobranca | null> {
  const { data } = await sb.from("quotes").select("id, status, customer_accepted, customer_deposit_paid, conversation_channel").eq("id", id).maybeSingle();
  return (data as QuoteDaCobranca | null) ?? null;
}

export function ehB2B(t: Pick<Ticket, "tags">): boolean {
  return t.tags.includes("b2b");
}

/** O que a copy precisa da quote do ticket. Tudo opcional: o texto se ajusta ao que existe. */
export type DadosDaCobranca = {
  publico: Publico;
  servico?: string | null;
  referencia?: string | null;
  endereco?: string | null;
  /** Link tokenizado da quote (o mesmo do e-mail da cotação). */
  link?: string | null;
  /** Só no último lembrete: o dia em que a régua fecha, já escrito ("Wednesday 21 October 2026"). */
  fechaEm?: string | null;
};

const juntaPonto = (partes: Array<string | null | undefined>) => partes.map((p) => String(p ?? "").trim()).filter(Boolean).join(" · ");

/**
 * O e-mail de cada lembrete. Conta: um só, que já avisa o fechamento. Cliente da
 * Fixfy: dois, o 2º é o aviso de fechamento. O assunto só vale fora de thread
 * (Resend): no comentário do Zendesk o ticket mantém o assunto dele.
 */
export function emailDaCobranca(passo: 1 | 2, b2b: boolean, d: DadosDaCobranca): EmailDeAcompanhamento {
  const s = servicoCurto(d.servico);
  const ref = d.referencia?.trim() || "";
  const prop = imovelCurto(d.endereco);
  const endereco = d.endereco?.replace(/\s+/g, " ").trim() || "";
  // Sem botão nos lembretes (dono, 23/10/2026): a cotação, com o link para aceitar, já foi
  // no e-mail da quote. O lembrete só pergunta e pede resposta.
  const cta = null;
  const saud = saudacao(d.publico);
  if (b2b) {
    return {
      assunto: juntaPonto(["Quote follow-up", prop, ref]),
      preheader: "Please let us know whether you would like to proceed.",
      saudacao: saud,
      paragrafos: [
        `We’re following up on ${ref ? `quote ${ref}` : "our quote"}${s ? ` for ${s}` : ""}${endereco ? ` at ${endereco}` : ""}.`,
        "If you’d like to proceed, please confirm your approval and preferred dates through the usual quote process. If you’re waiting for the property owner’s approval or need any changes to the scope, just let us know.",
        `${d.fechaEm ? `If we don’t hear from you by ${d.fechaEm}, we’ll close the enquiry for now. ` : ""}Should the work be needed later, reply here and we’ll check the quote and availability again.`,
      ],
      cta,
    };
  }
  if (passo === 1) {
    return {
      assunto: `Your ${s || "Fixfy"} quote · Ready to proceed?`,
      preheader: "Let us know if you’d like to go ahead or need anything changed.",
      saudacao: saud,
      paragrafos: [
        `Have you had a chance to look through your quote${s ? ` for ${s}` : ""}?`,
        "If you’d like to go ahead, just reply and let us know. If you have a preferred date, tell us and we’ll check availability.",
        "Any questions before you decide? Just reply. We’re happy to help.",
      ],
      cta,
    };
  }
  return {
    assunto: juntaPonto(["A final follow-up on your quote", ref]),
    preheader: "Please let us know if you would still like to go ahead.",
    saudacao: saud,
    paragrafos: [
      `One last follow-up on your quote${s ? ` for ${s}` : ""}. If you’d still like to go ahead, please reply and let us know, or ask us any questions.`,
      `${d.fechaEm ? `If we don’t hear from you by ${d.fechaEm}, we’ll close this enquiry for now. ` : ""}You’re welcome to get back in touch whenever you need us.`,
      "Thank you for considering Fixfy.",
    ],
    cta,
  };
}

/**
 * O lembrete no WhatsApp com a janela de 24h aberta. Só cliente da Fixfy: conta
 * não recebe WhatsApp desta régua. Com a janela fechada continua o template
 * aprovado `quote_request_checkin`. O 2º é o último e avisa o fechamento.
 */
export function whatsappDaCobranca(passo: 1 | 2, d: DadosDaCobranca): string {
  const s = servicoCurto(d.servico);
  const sua = `your ${s ? `${s} ` : ""}quote`;
  const g = saudacao(d.publico);
  if (passo === 1) {
    return d.link
      ? `${g} Have you had a chance to look through ${sua}? You can review it here: ${d.link}\n\nIf you have a question or a preferred date, just reply and we’ll help.`
      : `${g} Have you had a chance to look through ${sua}? If you have a question or a preferred date, just reply and we’ll help.`;
  }
  const fim = `${d.fechaEm ? `Otherwise, we’ll close the enquiry on ${d.fechaEm}. ` : ""}You’re welcome to contact us again whenever you need us.`;
  return d.link
    ? `${g} A final follow-up on ${sua}. If you’re still interested, just reply or review it here: ${d.link}\n\n${fim}`
    : `${g} A final follow-up on ${sua}. If you’re still interested, just reply. ${fim}`;
}

/**
 * O dia em que a régua fecha depois do último lembrete: 48h, dentro do horário
 * da varredura (8h às 20h de Londres; depois das 20h vira a manhã seguinte).
 */
export function diaDoFechamento(agora: Date, horas = 48): string | null {
  const d = new Date(agora.getTime() + horas * H);
  return dataLonga(horaDeLondres(d) >= 20 ? new Date(d.getTime() + 12 * H) : d);
}

/**
 * Resposta que encerra: o cliente desistiu. Conservador de propósito: na dúvida
 * a resposta fica com a equipe. Devolve o valor do "What Happened".
 */
export function motivoDeDesistencia(texto: string | null | undefined): "booked_elsewhere" | "too_expensive" | "customer_cancelled" | null {
  const t = ` ${String(texto ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")} `;
  if (/(found|got|booked|went with|going with|chose|hired) (someone|somebody|another|a different|other)|booked elsewhere|someone else (is doing|will do|did)|already (booked|sorted|found)/.test(t)) return "booked_elsewhere";
  if (/too (expensive|much|pricey|high)|out of (my|our) budget|can't afford|cannot afford|over (my|our) budget/.test(t)) return "too_expensive";
  if (/no longer (need|needed|required)|don't need (it|this|the|anymore|any more)|do not need|not needed (anymore|any more)?|not (going|gonna) ahead|won't be going ahead|decided not to|changed (my|our) mind|cancel (it|this|the)|please cancel|no thanks|not interested|not required (anymore|any more)?|we're (all )?sorted|it's (been )?sorted|all sorted now/.test(t)) return "customer_cancelled";
  return null;
}

/** Copy 29: o cliente disse que não precisa mais. No mesmo canal em que respondeu. */
export function respostaDeFechamento(d: DadosDaCobranca): { whatsapp: string; email: EmailDeAcompanhamento } {
  const s = servicoCurto(d.servico);
  const sua = `your quote${s ? ` for ${s}` : ""}`;
  return {
    whatsapp: `${saudacao(d.publico)} Thank you for letting us know. We’ve closed ${sua} as requested. If your plans change or you need help with another job, we’ll be happy to hear from you.`,
    email: {
      assunto: juntaPonto(["Your quote has been closed", d.referencia]),
      preheader: "Thank you for the update.",
      saudacao: saudacao(d.publico),
      paragrafos: [
        `Thank you for letting us know. We’ve closed ${sua} as requested.`,
        "Thank you for considering Fixfy. If your plans change or you need help with another job, we’ll be happy to hear from you.",
      ],
    },
  };
}

/**
 * A quote do ticket, para a copy dizer o serviço, a referência, o imóvel e o link.
 * Só leitura; sem achar, o texto sai sem esses pedaços.
 */
async function dadosDaQuoteDoTicket(sb: SupabaseClient, ticketId: number, b2b: boolean): Promise<Omit<DadosDaCobranca, "publico" | "fechaEm"> & { empresa: string | null }> {
  const { data } = await sb
    .from("quotes")
    .select("id, reference, title, service_type, property_address, source_account_id")
    .eq("external_source", "zendesk")
    .eq("external_ref", String(ticketId))
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const q = (data?.[0] ?? null) as { id: string; reference: string | null; title: string | null; service_type: string | null; property_address: string | null; source_account_id: string | null } | null;
  if (!q) return { empresa: null };
  let empresa: string | null = null;
  if (b2b && q.source_account_id) {
    const { data: a } = await sb.from("accounts").select("company_name").eq("id", q.source_account_id).maybeSingle();
    empresa = ((a as { company_name?: string | null } | null)?.company_name ?? "").trim() || null;
  }
  const { createQuoteResponseToken } = await import("@/lib/quote-response-token");
  const { appBaseUrl } = await import("@/lib/app-base-url");
  return {
    empresa,
    servico: q.service_type?.trim() || q.title?.trim() || null,
    referencia: q.reference,
    endereco: q.property_address,
    link: `${appBaseUrl()}/quote/respond?token=${encodeURIComponent(createQuoteResponseToken(q.id))}&action=accept`,
  };
}

/** O resumo do fechamento (Closing Summary): o que aconteceu, em uma frase. */
export function resumoDoFechamento(motivo: string, tipo: TipoDaCobranca, referencia?: string | null): string {
  const q = referencia?.trim() ? `Quote ${referencia.trim()}` : "Quote";
  if (motivo === "no_reply") {
    return tipo === "conta"
      ? `${q} closed: one follow-up sent, no reply in ${horasAteFechar("conta")} hours.`
      : `${q} closed: two follow-ups sent, no reply in ${horasAteFechar("fixfy")} hours after the last one.`;
  }
  const porque: Record<string, string> = {
    booked_elsewhere: "the customer booked someone else",
    too_expensive: "the customer said the price was too high",
    customer_cancelled: "the customer said they no longer need the work",
  };
  return `${q} closed: ${porque[motivo] ?? "the customer replied that they will not go ahead"}.`;
}

async function fechar(t: Ticket, motivo: string, tag: string, nota: string, resumo: string) {
  await zendeskApi(`tickets/${t.id}.json`, {
    method: "PUT",
    body: {
      ticket: {
        status: "solved",
        custom_fields: [
          { id: RESOLUCAO, value: motivo === "no_reply" ? "res_no_response" : "res_cancelled" },
          { id: WHAT_HAPPENED, value: motivo },
          { id: CLOSING_SUMMARY, value: resumo },
        ],
        comment: { public: false, body: nota },
      },
    },
  });
  await addTicketTags(t.id, [tag]);
}

async function emailDoResend(para: string, e: EmailDeAcompanhamento) {
  const { html, text } = montarEmail(e);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: REMETENTE_DA_EQUIPE, reply_to: "hello@getfixfy.com", to: [para], subject: e.assunto, text, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

async function emailDoCliente(sb: SupabaseClient, telefone: string | null | undefined): Promise<string | null> {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 9) return null;
  const { data } = await sb.from("clients").select("email").is("deleted_at", null).ilike("phone", `%${digitos.slice(-9)}%`).not("email", "is", null).limit(1);
  const e = (data?.[0] as { email?: string } | undefined)?.email?.trim();
  return e && e.includes("@") ? e : null;
}

export async function varrerCobrancaDeQuotes(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoQuotes> {
  const out: ResultadoQuotes = { ensaio: !aplicar, olhados: 0, enviados: [], fechados: [], pulados: [] };
  const hora = horaDeLondres(agora);
  if (hora < 8 || hora >= 20) return out;

  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`views/${VIEW_QUOTING}/tickets.json?per_page=100`);
  for (const t of tickets ?? []) {
    if (t.custom_status_id !== STATUS_APPROVAL) continue;
    out.olhados++;
    const quem = `#${t.id} ${t.subject.slice(0, 50)}`;
    const tipo = await tipoDaCobranca(sb, t).catch((): TipoDaCobranca => (ehB2B(t) ? "conta" : "fixfy"));
    const b2b = tipo === "conta";
    const ehWhatsApp = !b2b && (t.tags.includes("harvey_wa") || t.via?.channel === "whatsapp");

    const { comments } = await zendeskApi<{ comments: Comentario[] }>(`tickets/${t.id}/comments.json?sort_order=desc&per_page=20`);
    const ultimaPublica = (comments ?? []).filter((c) => c.public)[0];
    if (!ultimaPublica) continue;
    // Etapa 3: conta direta com regras.v2 (sem PROCESSOS_V2=on nem lê o banco; B2B fica na régua de sempre).
    const v2 = b2b ? null : await contextoV2(sb, t.id).catch(() => null);
    // O cliente respondeu o ticket por e-mail: o canal ativo vira e-mail (gated por v2 lá dentro).
    if (aplicar && respostaPorEmail(ultimaPublica, t.requester_id)) await registrarCanalAtivo(sb, { ticketId: t.id }, "email").catch(() => null);
    const { user } = await zendeskApi<{ user: { name?: string; phone?: string | null; email?: string | null } }>(`users/${t.requester_id}.json`);
    const nome = firstName(user?.name ?? null) ?? "there";
    // A copy precisa da quote do ticket; só busca quando há algo a mandar.
    let dadosDaQuote: Awaited<ReturnType<typeof dadosDaQuoteDoTicket>> | null = null;
    const dados = async (fechaEm: string | null = null): Promise<DadosDaCobranca> => {
      dadosDaQuote ??= await dadosDaQuoteDoTicket(sb, t.id, b2b).catch(() => ({ empresa: null }));
      const { empresa, ...resto } = dadosDaQuote;
      // Conta: a empresa, nunca o nome de quem abriu o ticket (handoff 20/10/2026).
      const publico: Publico = b2b ? { tipo: "b2b", empresa } : { tipo: "b2c", primeiroNome: nome === "there" ? "" : nome };
      return { ...resto, publico, fechaEm };
    };

    // Quem falou por último, e há quanto tempo foi a nossa última mensagem.
    let horasDesdeNossa: number;
    let respostaDoCliente: string | null = null;
    let conversa: string | null = null;
    let janelaAberta = false;
    let voz: string | null = null;
    let equipeNaConversa = false;
    if (ehWhatsApp) {
      const tel = user?.phone ?? null;
      const { data: c } = tel ? await sb.from("harvey_wa_conversas").select("conversation_id, estado").eq("phone", tel).maybeSingle() : { data: null };
      conversa = (c as { conversation_id?: string } | null)?.conversation_id ?? null;
      equipeNaConversa = (c as { estado?: string } | null)?.estado === "equipe";
      if (!conversa) { out.pulados.push(`${quem}: no conversation`); continue; }
      const msgs = await historico(conversa, 30);
      const ultimaMsg = msgs.at(-1);
      if (!ultimaMsg) continue;
      const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
      janelaAberta = !!ultimaDoCliente && agora.getTime() - new Date(ultimaDoCliente.received).getTime() < 23 * H;
      if (ultimaMsg.author.type === "user") {
        respostaDoCliente = ultimaMsg.content.text ?? ultimaMsg.content.payload ?? "";
        horasDesdeNossa = 0;
      } else {
        horasDesdeNossa = (agora.getTime() - new Date(ultimaMsg.received).getTime()) / H;
        voz = ultimaMsg.author.displayName ?? null;
      }
    } else if (ultimaPublica.author_id === t.requester_id) {
      respostaDoCliente = ultimaPublica.body ?? "";
      horasDesdeNossa = 0;
    } else {
      horasDesdeNossa = (agora.getTime() - new Date(ultimaPublica.created_at).getTime()) / H;
    }

    // O cliente respondeu. Se desistiu, fecha agora; se não, é com a equipe.
    if (respostaDoCliente !== null) {
      const motivo = motivoDeDesistencia(respostaDoCliente);
      if (!motivo) continue;
      if (!aplicar) { out.fechados.push(`${quem}: would close (${motivo})`); continue; }
      // v2: a resposta de fechamento também sai uma vez só.
      const chaveFim = v2 ? chaveDeEnvio("quote-closed-reply", v2.quote.id) : null;
      if (chaveFim) {
        const rf = await reservarEnvio(sb, { chave: chaveFim, finalidade: "quote-closed-reply", canal: ehWhatsApp ? "whatsapp" : "email", quoteId: v2!.quote.id, ticketId: t.id, motivo });
        if (!rf.reservado) {
          // A resposta já saiu numa rodada anterior e o fechamento é que falhou: só fecha.
          if (rf.motivo === "already sent") {
            await fechar(t, motivo, "quote_closed_by_customer", `Quote closed automatically: the customer said they no longer need it (${motivo}).`, resumoDoFechamento(motivo, tipo, (await dados()).referencia)).catch(() => null);
            out.fechados.push(`${quem}: closed (${motivo}, reply already sent)`);
          } else out.pulados.push(`${quem}: closing reply ${rf.motivo ?? "already reserved"}`);
          continue;
        }
      }
      try {
        const resposta = respostaDeFechamento(await dados());
        if (ehWhatsApp && conversa) {
          await scApi(`/conversations/${conversa}/messages`, { method: "POST", body: { author: { type: "business", displayName: "Fixfy" }, content: { type: "text", text: resposta.whatsapp }, metadata: { origem: "quote_closed" } } });
        } else {
          await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: comentarioDoEmail(resposta.email, (await autorDosEmails()).zendesk_user_id) } } });
        }
        if (chaveFim) await confirmarEnvio(sb, chaveFim);
        await fechar(t, motivo, "quote_closed_by_customer", `Quote closed automatically: the customer said they no longer need it (${motivo}).`, resumoDoFechamento(motivo, tipo, (await dados()).referencia));
        out.fechados.push(`${quem}: closed (${motivo})`);
      } catch (e) {
        if (chaveFim) await falhouEnvio(sb, chaveFim, e).catch(() => null);
        out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
      }
      continue;
    }

    // v2: a equipe entrou depois do último lembrete (comentário público ou conversa com a equipe): para e deixa com ela.
    if (v2 && (equipeNaConversa || intervencaoManual(comments ?? [], v2.ultimoEnvioEm, t.requester_id))) {
      out.pulados.push(`${quem}: the team stepped in after the last chase, left with them`);
      continue;
    }

    const regua = REGUAS[tipo];
    const passo = proximoPassoDaRegua(t.tags, lembretesFeitos(t.tags, v2?.enviados ?? []), horasDesdeNossa, regua);
    if (!passo) continue;

    // v2: antes de mandar ou fechar, a quote ainda espera o cliente? (aceita, paga, virou job: para)
    let fresca: QuoteDaCobranca | null = null;
    if (v2) {
      fresca = await quoteFresca(sb, v2.quote.id).catch(() => null);
      const parar = motivoParaPararCobranca(fresca);
      if (parar) { out.pulados.push(`${quem}: chase stopped (${parar})`); continue; }
    }

    if (passo === "fechar") {
      const dia = Math.round(regua.fecha / 24);
      if (!aplicar) { out.fechados.push(`${quem}: would close (no_reply, day ${dia})`); continue; }
      try {
        const resumo = resumoDoFechamento("no_reply", tipo, (await dados()).referencia);
        await fechar(t, "no_reply", "quote_closed_no_reply", `Quote closed automatically on day ${dia}: ${resumo}`, resumo);
        out.fechados.push(`${quem}: closed (no_reply)`);
      } catch (e) {
        out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
      }
      continue;
    }

    const emailDoWhatsApp = b2b ? null : ehWhatsApp ? await emailDoCliente(sb, user?.phone) : null;
    // Um canal por lembrete (dono, 24/10/2026): o da conversa. Ticket de WhatsApp vai por WhatsApp
    // (e-mail só se o canal ativo da v2 virou e-mail); ticket de e-mail, por e-mail.
    const disponiveis: CanalAtivo[] = ehWhatsApp ? ["whatsapp", ...(emailDoWhatsApp ? (["email"] as const) : [])] : ["email"];
    const usar = (v2 ? canaisParaEnviar(canalAtivo(fresca), disponiveis) : disponiveis).slice(0, 1);
    const mandaWhats = usar.includes("whatsapp");
    const mandaEmail = usar.includes("email");
    if (!mandaWhats && !mandaEmail) { out.pulados.push(`${quem}: no way to reach the customer on the active channel (${canalAtivo(fresca)})`); continue; }
    const canais = mandaWhats ? `WhatsApp${janelaAberta ? "" : " template"}` : "email";
    if (!aplicar) { out.enviados.push(`${quem}: would send chase ${passo} (${canais})`); continue; }

    // v2: reserva ANTES de mandar (a tag depois do envio repetia o lembrete quando falhava).
    const chave = v2 ? chaveDaCobranca(v2.quote.id, passo) : null;
    if (chave) {
      const rv = await reservarEnvio(sb, { chave, finalidade: `quote-chase-${passo}`, canal: mandaWhats ? "whatsapp" : "email", quoteId: v2!.quote.id, ticketId: t.id, destinatario: mandaWhats ? user?.phone ?? null : user?.email ?? emailDoWhatsApp });
      if (!rv.reservado) {
        // Já saiu (a tag é que faltou): só põe a tag, sem mandar de novo.
        if (rv.motivo === "already sent") await addTicketTags(t.id, [`quote_chase_${passo}`]).catch(() => null);
        out.pulados.push(`${quem}: chase ${passo} ${rv.motivo ?? "not reserved"}`);
        continue;
      }
    }

    try {
      const total = regua.lembretes.length;
      const ultimo = passo === total;
      const d = await dados(ultimo ? diaDoFechamento(agora, horasAteFechar(tipo)) : null);
      const email = emailDaCobranca(passo, b2b, d);
      if (mandaWhats && ehWhatsApp && janelaAberta && conversa) {
        await scApi(`/conversations/${conversa}/messages`, { method: "POST", body: { author: { type: "business", displayName: voz || "Fixfy" }, content: { type: "text", text: whatsappDaCobranca(passo, d) }, metadata: { origem: "quote_chase" } } });
      } else if (mandaWhats && (ehWhatsApp || (!b2b && user?.phone))) {
        await scNotificacao({
          destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: user?.phone },
          author: { role: "appMaker" },
          messageSchema: "whatsapp",
          message: {
            type: "template",
            template: {
              namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
              name: process.env.HARVEY_WA_LEAD_CHECKIN_TEMPLATE?.trim() || "quote_request_checkin",
              language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
              components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: "the quote we sent you" }] }],
            },
          },
          metadata: { origem: "quote_chase", ticket: String(t.id) },
        });
      }
      if (mandaEmail && !ehWhatsApp) {
        // Ticket de e-mail (B2B ou B2C): o lembrete vai no próprio ticket, e a resposta cai nele.
        await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: comentarioDoEmail(email, (await autorDosEmails()).zendesk_user_id) } } });
      } else if (mandaEmail && emailDoWhatsApp) {
        await emailDoResend(emailDoWhatsApp, email);
      }
      if (chave) await confirmarEnvio(sb, chave);
      await zendeskApi(`tickets/${t.id}.json`, {
        method: "PUT",
        body: { ticket: { comment: { public: false, body: `Quote chase ${passo} of ${total} sent automatically (${canais}).${ultimo ? ` If there is no reply in ${horasAteFechar(tipo)}h the ticket closes as no reply.` : ""}` } } },
      });
      await addTicketTags(t.id, [`quote_chase_${passo}`]);
      out.enviados.push(`${quem}: chase ${passo} (${canais})`);
    } catch (e) {
      // Falhou antes de confirmar: libera a chave para a próxima rodada. Depois de confirmar, a chave fica (já saiu).
      if (chave) {
        const { data: st } = await sb.from("outbound_messages").select("status").eq("dedupe_key", chave).maybeSingle();
        if ((st as { status?: string } | null)?.status !== "sent") await falhouEnvio(sb, chave, e).catch(() => null);
      }
      out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
    }
  }
  return out;
}
