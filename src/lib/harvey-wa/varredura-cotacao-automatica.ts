/**
 * Varredura da cotação automática por parceiro (dono, 14/10/2026). As regras
 * e os textos estão em cotacao-automatica.ts; aqui é só leitura, envio e carimbo.
 *
 * Duas filas, a cada ciclo do /api/cron/harvey-wa (n8n, 10 min):
 *
 *   entrada   tickets em 📝 Needs Quote. Com contexto completo, cria (ou reaproveita)
 *             a quote do ticket no OS, convida os 3 a 5 melhores parceiros pelo
 *             caminho de sempre (dispatchQuoteBidInvites) e põe o ticket em 🟤 Bidding.
 *             Faltando algo, pede ao cliente uma vez e espera.
 *   leilão    tickets com harvey_aq_invited: lembra parceiros com 6h, avisa o
 *             cliente com 24h, e precifica quando o lance chega.
 *
 * Três travas, nenhuma opcional:
 *   1. HARVEY_AUTO_QUOTE=1 (default desligado). Sem ela, e com ?dry-run=1, só lista.
 *   2. Gente da equipe falando com o cliente depois que o ticket entrou em Needs
 *      Quote: a régua não se mete. Quem está conversando decide.
 *   3. Só 8h às 20h de Londres para qualquer coisa que fala com alguém.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, addTicketTags, removeTicketTags, updateTicket, replyToSideConversation } from "@/lib/zendesk";
import { ZD_STATUS_AWAITING_APPROVAL, ZD_STATUS_BIDDING, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_QUOTE_READY } from "@/lib/zendesk-statuses";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { escolherMelhorLance, type Lance } from "@/lib/quote-melhor-lance";
import { AUTOR_DO_AVISO } from "@/lib/zendesk-quoter/aviso-de-cotacao";
import { guardarFotosDoTicket } from "@/lib/zendesk-quoter/guardar-fotos";
import { baixarMidia, ehDoHarvey, enviarTexto, historico, scNotificacao, vozDaConversa, type MensagemSc } from "./sunshine";
import { idDaIntegracaoWhatsApp, telefoneE164 } from "./primeiro-contato";
import { melhoresParceirosParaCotacao, nomeDoParceiro, MIN_CONVIDADOS } from "./melhores-parceiros";
import {
  TAG_CONVIDOU, TAG_FIM, TAG_LEMBROU_PARCEIROS, TAG_PARA_REVISAR, TAG_PEDIU_CONTEXTO, TAG_QUOTE_ENVIADA, TAG_SEM_LANCE,
  decidirEnvio, enderecoCompleto, enderecoNasMensagens, faltandoNoContexto, horaDeLondres, margemDe, precoDoLance,
  proximoPassoDoLeilao, servicoDoAssunto, textoAindaCotando, textoDaQuote, textoPedeContexto,
  type ContextoDaCotacao, type Falta,
} from "./cotacao-automatica";

const H = 3_600_000;
const CAMPO_TIPO = 5687087915551;
const CAMPO_ESCOPO = 5687121072927;
const CAMPO_ENDERECO = 5693026186527;
const CAMPO_TELEFONE = 5811689527071;
/** Teto de ações por ciclo: a primeira rodada não pode despejar o backlog. */
const MAX_ACOES = 5;
/** Marca na quote que cala o aviso de 26h do quote-lances-sweep (já avisamos). */
const AVISEI_SEM_LANCE = "no_bids_reported";

export type ResultadoCotacaoAutomatica = { ensaio: boolean; foraDoHorario: boolean; olhados: number; acoes: string[]; pulados: string[] };

type Ticket = { id: number; subject: string; tags: string[]; custom_status_id?: number; requester_id: number; via?: { channel?: string }; custom_fields?: Array<{ id: number; value: unknown }> };
type Usuario = { id: number; name?: string | null; phone?: string | null; email?: string | null; role?: string };
type Comentario = { id: number; public: boolean; author_id: number; created_at: string; body?: string; attachments?: Array<{ content_type?: string; content_url?: string; file_name?: string }> };
type QuoteRow = {
  id: string; reference: string; status: string; title: string | null; service_type: string | null; catalog_service_id: string | null;
  postcode: string | null; property_address: string | null; scope: string | null; images: unknown; total_value: number | null;
  partner_cost: number | null; partner_id: string | null; bidding_started_at: string | null; client_email: string | null;
};

function campo(t: Ticket, id: number): string | null {
  const v = t.custom_fields?.find((f) => f.id === id)?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function ehWhatsApp(t: Ticket): boolean {
  return t.tags.includes("harvey_wa") || t.via?.channel === "whatsapp";
}

async function buscar(query: string): Promise<Ticket[]> {
  const r = await zendeskApi<{ results: Ticket[] }>(`search.json?query=${encodeURIComponent(query)}&per_page=100`);
  return r.results ?? [];
}

async function nota(ticketId: number, texto: string) {
  await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: texto } } } });
}

/** Quando o ticket entrou em Needs Quote pela última vez (auditoria do Zendesk). */
async function entrouEmNeedsQuote(ticketId: number): Promise<Date | null> {
  const { audits } = await zendeskApi<{ audits: Array<{ created_at: string; events: Array<{ field_name?: string; value?: unknown }> }> }>(`tickets/${ticketId}/audits.json?sort_order=desc&per_page=100`);
  for (const a of audits ?? []) {
    if (a.events.some((e) => e.field_name === "custom_status_id" && String(e.value) === String(ZD_STATUS_NEEDS_QUOTE))) return new Date(a.created_at);
  }
  return null;
}

async function quoteDoTicket(sb: SupabaseClient, ticketId: number): Promise<QuoteRow | null> {
  const { data } = await sb
    .from("quotes")
    .select("id, reference, status, title, service_type, catalog_service_id, postcode, property_address, scope, images, total_value, partner_cost, partner_id, bidding_started_at, client_email")
    .eq("external_source", "zendesk")
    .eq("external_ref", String(ticketId))
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as QuoteRow | undefined) ?? null;
}

function imagensDaQuote(q: QuoteRow | null): string[] {
  return Array.isArray(q?.images) ? (q!.images as unknown[]).filter((u): u is string => typeof u === "string") : [];
}

/** O que a conversa diz: fotos, textos do cliente, janela de 24h e se a equipe já está falando. */
type Conversa = {
  canal: "whatsapp" | "email";
  conversa: string | null;
  fotos: Array<{ url: string; auth?: boolean }>;
  textosDoCliente: string[];
  janelaAberta: boolean;
  equipeFalando: string | null;
  voz: string | null;
  telefone: string | null;
};

async function lerConversa(sb: SupabaseClient, t: Ticket, user: Usuario, desde: Date | null, agora: Date): Promise<Conversa> {
  if (ehWhatsApp(t)) {
    const telefone = telefoneE164(user.phone ?? campo(t, CAMPO_TELEFONE));
    const { data: c } = telefone ? await sb.from("harvey_wa_conversas").select("conversation_id").eq("phone", telefone).maybeSingle() : { data: null };
    const conversa = (c as { conversation_id?: string } | null)?.conversation_id ?? null;
    const msgs: MensagemSc[] = conversa ? await historico(conversa, 100) : [];
    const doCliente = msgs.filter((m) => m.author.type === "user");
    const ultima = doCliente.at(-1);
    const equipe = msgs.find((m) => m.author.type === "business" && !ehDoHarvey(m) && m.author.displayName && (!desde || new Date(m.received) > desde));
    return {
      canal: "whatsapp",
      conversa,
      fotos: doCliente.filter((m) => m.content.type === "image" && m.content.mediaUrl).map((m) => ({ url: m.content.mediaUrl! })),
      textosDoCliente: doCliente.map((m) => m.content.text ?? "").filter(Boolean),
      janelaAberta: !!ultima && agora.getTime() - new Date(ultima.received).getTime() < 23 * H,
      equipeFalando: equipe ? `${equipe.author.displayName} on WhatsApp at ${equipe.received.slice(0, 16)}` : null,
      voz: vozDaConversa(msgs),
      telefone,
    };
  }
  const { comments, users } = await zendeskApi<{ comments: Comentario[]; users?: Usuario[] }>(`tickets/${t.id}/comments.json?include=users&per_page=100`);
  const papel = new Map((users ?? []).map((u) => [u.id, u.role]));
  const doCliente = (comments ?? []).filter((c) => c.public && papel.get(c.author_id) === "end-user");
  const equipe = (comments ?? []).find((c) => c.public && c.author_id > 0 && papel.get(c.author_id) !== "end-user" && (!desde || new Date(c.created_at) > desde));
  return {
    canal: "email",
    conversa: null,
    fotos: doCliente.flatMap((c) => (c.attachments ?? []).filter((a) => a.content_type?.startsWith("image/") && a.content_url).map((a) => ({ url: a.content_url!, auth: true }))),
    textosDoCliente: doCliente.map((c) => c.body ?? ""),
    janelaAberta: true,
    equipeFalando: equipe ? `agent ${equipe.author_id} by email at ${equipe.created_at.slice(0, 16)}` : null,
    voz: null,
    telefone: null,
  };
}

async function nomeDoTipo(valor: string | null): Promise<string | null> {
  if (!valor) return null;
  const { ticket_field } = await zendeskApi<{ ticket_field: { custom_field_options?: Array<{ name: string; value: string }> } }>(`ticket_fields/${CAMPO_TIPO}.json`);
  return ticket_field?.custom_field_options?.find((o) => o.value === valor)?.name?.split("::").at(-1)?.trim() ?? null;
}

function montarContexto(t: Ticket, q: QuoteRow | null, conv: Conversa, servicoDoCampo: string | null): ContextoDaCotacao & { catalogServiceId: string | null } {
  const enderecoDoCampo = campo(t, CAMPO_ENDERECO);
  const candidatos = [enderecoDoCampo, q?.property_address ?? null, enderecoNasMensagens(conv.textosDoCliente)];
  const endereco = candidatos.find((e) => enderecoCompleto(e)) ?? enderecoDoCampo ?? q?.property_address ?? null;
  const postcode =
    extractUkPostcode(endereco ?? "") ?? (q?.postcode ? extractUkPostcode(q.postcode) : null) ?? extractUkPostcode(t.subject) ??
    conv.textosDoCliente.map((x) => extractUkPostcode(x)).find(Boolean) ?? null;
  const tipo = campo(t, CAMPO_TIPO);
  return {
    servico: q?.service_type?.trim() || servicoDoCampo || servicoDoAssunto(t.subject),
    catalogServiceId: q?.catalog_service_id ?? (tipo?.startsWith("os_") ? tipo.slice(3) : null),
    postcode,
    endereco,
    escopo: campo(t, CAMPO_ESCOPO) ?? q?.scope ?? null,
    fotos: conv.fotos.length + imagensDaQuote(q).length,
  };
}

/** Fala com o cliente pelo canal do ticket. WhatsApp fora da janela só aceita template. */
async function falarComCliente(t: Ticket, user: Usuario, conv: Conversa, texto: string, servico: string | null): Promise<string> {
  if (conv.canal === "whatsapp") {
    if (conv.conversa && conv.janelaAberta) {
      await enviarTexto(conv.conversa, texto, conv.voz);
      return "WhatsApp";
    }
    if (!conv.telefone) throw new Error("no WhatsApp number");
    // Mesmo template do follow-up de lead: reabre a janela; o texto completo vai na próxima.
    await scNotificacao({
      destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: conv.telefone },
      author: { role: "appMaker" },
      messageSchema: "whatsapp",
      message: {
        type: "template",
        template: {
          namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
          name: process.env.HARVEY_WA_LEAD_CHECKIN_TEMPLATE?.trim() || "quote_request_checkin",
          language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
          components: [{ type: "body", parameters: [{ type: "text", text: firstName(user.name ?? null) ?? "there" }, { type: "text", text: `your ${(servico ?? "quote").toLowerCase()} request` }] }],
        },
      },
      metadata: { origem: "auto_quote", ticket: String(t.id) },
    });
    return "WhatsApp template";
  }
  await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: { public: true, author_id: AUTOR_DO_AVISO, body: `${texto}\n\nKind regards,\nFixfy Team` } } } });
  return "email";
}

/** Fotos da conversa no bucket público do convite: o parceiro precisa vê-las no bid. */
async function guardarFotos(sb: SupabaseClient, ticketId: number, fotos: Conversa["fotos"]): Promise<string[]> {
  const auth = "Basic " + Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64");
  const baixadas = await Promise.all(
    fotos.slice(-6).map(async (f, i) => {
      try {
        const { dados, tipo } = f.auth
          ? await fetch(f.url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(20_000) }).then(async (r) => ({ dados: Buffer.from(await r.arrayBuffer()), tipo: (r.headers.get("content-type") ?? "").split(";")[0]!.trim() }))
          : await baixarMidia(f.url);
        if (!tipo.startsWith("image/") || dados.length > 8 * 1024 * 1024) return null;
        return { filename: `auto-quote-${i + 1}.jpg`, dataUrl: `data:${tipo};base64,${dados.toString("base64")}` };
      } catch {
        return null;
      }
    }),
  );
  return guardarFotosDoTicket(ticketId, baixadas.filter((f): f is NonNullable<typeof f> => !!f), sb);
}

async function criarOuAbrirQuote(sb: SupabaseClient, t: Ticket, user: Usuario, q: QuoteRow | null, ctx: ContextoDaCotacao & { catalogServiceId: string | null }, fotos: string[]): Promise<QuoteRow> {
  const endereco = ctx.endereco!.includes(ctx.postcode!) ? ctx.endereco! : `${ctx.endereco}, ${ctx.postcode}`;
  const comum = {
    service_type: ctx.servico,
    title: ctx.servico,
    property_address: endereco,
    postcode: ctx.postcode,
    scope: ctx.escopo,
    status: "bidding",
    quote_type: "partner",
    ...(ctx.catalogServiceId ? { catalog_service_id: ctx.catalogServiceId } : {}),
  };
  const sel = "id, reference, status, title, service_type, catalog_service_id, postcode, property_address, scope, images, total_value, partner_cost, partner_id, bidding_started_at, client_email";
  if (q) {
    const { data, error } = await sb.from("quotes").update({ ...comum, images: [...imagensDaQuote(q), ...fotos] }).eq("id", q.id).select(sel).single();
    if (error || !data) throw new Error(`quote update: ${error?.message}`);
    return data as QuoteRow;
  }
  const { data: numero, error: refErr } = await sb.rpc("next_quote_ref");
  if (refErr || !numero) throw new Error("could not get a quote reference");
  const email = user.email && !/@getfixfy\.com$/i.test(user.email) ? user.email : null;
  const { data, error } = await sb
    .from("quotes")
    .insert({
      ...comum,
      reference: String(numero),
      client_name: user.name || "Customer",
      client_email: email,
      total_value: 0, cost: 0, sell_price: 0, margin_percent: 0, partner_cost: 0, partner_quotes_count: 0, deposit_percent: 0, deposit_required: 0,
      customer_accepted: false, customer_deposit_paid: false,
      external_source: "zendesk",
      external_ref: String(t.id),
      images: fotos,
    })
    .select(sel)
    .single();
  if (error || !data) throw new Error(`quote insert: ${error?.message}`);
  return data as QuoteRow;
}

/* ============================== entrada ============================== */

async function tratarEntrada(sb: SupabaseClient, t: Ticket, aplicar: boolean, agora: Date, out: ResultadoCotacaoAutomatica): Promise<boolean> {
  const quem = `#${t.id} ${t.subject.slice(0, 50)}`;
  if (t.tags.includes(TAG_CONVIDOU) || t.tags.includes(TAG_FIM)) return false;
  const { user } = await zendeskApi<{ user: Usuario }>(`users/${t.requester_id}.json`);
  const desde = await entrouEmNeedsQuote(t.id);
  const conv = await lerConversa(sb, t, user, desde, agora);
  const q = await quoteDoTicket(sb, t.id);
  const ctx = montarContexto(t, q, conv, await nomeDoTipo(campo(t, CAMPO_TIPO)));
  const faltando = faltandoNoContexto(ctx);
  if (conv.equipeFalando) {
    // No ensaio diz também o que faria sem a trava, para o dono julgar a régua com ticket de verdade.
    let semATrava = "";
    if (!aplicar) {
      if (faltando.length) semATrava = `; without the team it would ask for ${faltando.join(", ")}`;
      else {
        const { escolhidos, elegiveis } = await melhoresParceirosParaCotacao(sb, { serviceType: ctx.servico!, catalogServiceId: ctx.catalogServiceId, postcode: ctx.postcode });
        semATrava = `; without the team it would invite ${escolhidos.length} of ${elegiveis} eligible (${escolhidos.map(nomeDoParceiro).join(", ")})`;
      }
    }
    out.pulados.push(`${quem}: team is talking to the customer (${conv.equipeFalando}), left alone${semATrava}`);
    return false;
  }
  const nome = firstName(user.name ?? null) ?? "there";

  // Quote do ticket já em leilão (o Harvey do WhatsApp convidou): só passa a acompanhar.
  if (q && q.status === "bidding" && q.bidding_started_at) {
    if (!aplicar) { out.acoes.push(`${quem}: would track the existing bidding ${q.reference} (no new invites)`); return true; }
    await updateTicket({ ticketId: t.id, customStatusId: ZD_STATUS_BIDDING, additionalTags: [TAG_CONVIDOU] });
    out.acoes.push(`${quem}: tracking ${q.reference}, already bidding`);
    return true;
  }

  if (faltando.length) {
    if (t.tags.includes(TAG_PEDIU_CONTEXTO)) {
      out.pulados.push(`${quem}: waiting for the customer (missing ${faltando.join(", ")})`);
      return false;
    }
    const texto = textoPedeContexto(nome, faltando, ctx.servico);
    const canal = conv.canal === "whatsapp" ? (conv.janelaAberta ? "WhatsApp" : "WhatsApp template") : "email";
    if (!aplicar) { out.acoes.push(`${quem}: would ask the customer for ${faltando.join(", ")} (${canal}): "${texto}"`); return true; }
    const via = await falarComCliente(t, user, conv, texto, ctx.servico);
    await nota(t.id, `🤖 Auto-quote: partners NOT invited yet, missing ${faltando.join(", ")}. Asked the customer (${via}):\n\n"${texto}"\n\nWhen they reply I'll check again and invite partners once the details are complete.`);
    await addTicketTags(t.id, [TAG_PEDIU_CONTEXTO]);
    out.acoes.push(`${quem}: asked the customer for ${faltando.join(", ")} (${via})`);
    return true;
  }

  const { escolhidos, elegiveis } = await melhoresParceirosParaCotacao(sb, { serviceType: ctx.servico!, catalogServiceId: ctx.catalogServiceId, postcode: ctx.postcode });
  const lista = escolhidos.map((p) => `${nomeDoParceiro(p)} (${p.rating ?? "-"}★)`).join(", ");
  if (escolhidos.length === 0) {
    if (!aplicar) { out.acoes.push(`${quem}: context complete but NO partner covers ${ctx.servico} at ${ctx.postcode}: would note + harvey_no_bids`); return true; }
    await nota(t.id, `🤖 Auto-quote: context is complete but no active partner covers ${ctx.servico} at ${ctx.postcode}. Nobody was invited. This needs a person: widen the trade or the area, or call a partner.`);
    await addTicketTags(t.id, [TAG_SEM_LANCE, TAG_FIM]);
    out.acoes.push(`${quem}: no partner covers it, sent to the team`);
    return true;
  }
  if (!aplicar) {
    out.acoes.push(`${quem}: would ${q ? `reuse ${q.reference}` : "create a quote"} and invite ${escolhidos.length} of ${elegiveis} eligible (${lista}); ticket → Bidding`);
    return true;
  }

  const fotos = await guardarFotos(sb, t.id, conv.fotos);
  const quote = await criarOuAbrirQuote(sb, t, user, q, ctx, fotos);
  const { dispatchQuoteBidInvites } = await import("@/lib/quote-bid-invites");
  const r = await dispatchQuoteBidInvites(sb, {
    quoteId: quote.id,
    quoteReference: quote.reference,
    title: ctx.servico!,
    serviceType: ctx.servico!,
    catalogServiceId: quote.catalog_service_id,
    propertyAddress: quote.property_address,
    scope: quote.scope,
    startIso: null,
    invitedBy: null,
    partnerIds: escolhidos.map((p) => p.id),
  });
  await updateTicket({
    ticketId: t.id,
    customStatusId: ZD_STATUS_BIDDING,
    publicComment: false,
    commentBody:
      `🤖 Auto-quote: ${quote.reference} sent to ${r.partnerIds.length} partner(s) for prices: ${lista}.` +
      (elegiveis < MIN_CONVIDADOS ? ` Only ${elegiveis} partner(s) cover this area.` : "") +
      `\n\nNext: reminder to them in 6h without a bid; at 24h without a bid the customer hears we're still on it and this comes back to Action Required.`,
    additionalTags: [TAG_CONVIDOU],
  });
  out.acoes.push(`${quem}: ${quote.reference} invited ${r.partnerIds.length} (${lista})`);
  return true;
}

/* ============================== leilão ============================== */

async function lembrarParceiros(sb: SupabaseClient, t: Ticket, q: QuoteRow, aplicar: boolean): Promise<string> {
  const { data: convites } = await sb.from("quote_partner_invitations").select("partner_id").eq("quote_id", q.id);
  const { data: lances } = await sb.from("quote_bids").select("partner_id").eq("quote_id", q.id);
  const jaCotaram = new Set(((lances ?? []) as Array<{ partner_id: string }>).map((l) => l.partner_id));
  const ids = ((convites ?? []) as Array<{ partner_id: string }>).map((c) => c.partner_id).filter((id) => !jaCotaram.has(id));
  if (!aplicar) return `would remind ${ids.length} invited partner(s) (side conversation reply + push)`;
  if (ids.length === 0) return "nobody to remind";

  const { data: parceiros } = await sb.from("partners").select("id, email, company_name, contact_name, zendesk_user_id").in("id", ids);
  const { side_conversations } = await zendeskApi<{ side_conversations: Array<{ id: string; participants?: Array<{ email?: string }> }> }>(`tickets/${t.id}/side_conversations.json`);
  const html = `<p>Hi,</p><p>Just a reminder that we're still waiting for your price on ${q.reference}. The bid link is in the message above. If you can't take this one, no problem, just let us know.</p><p>Thanks,<br>Fixfy Team</p>`;
  let lembrados = 0;
  for (const p of (parceiros ?? []) as Array<{ id: string; email?: string | null; company_name?: string | null; contact_name?: string | null; zendesk_user_id?: string | null }>) {
    const email = p.email?.trim().toLowerCase();
    const sc = email ? (side_conversations ?? []).find((s) => s.participants?.some((x) => x.email?.toLowerCase() === email)) : undefined;
    if (!sc || !email) continue;
    const r = await replyToSideConversation({ ticketId: t.id, sideConversationId: sc.id, htmlBody: html, toEmail: email, toName: p.contact_name || p.company_name || undefined, toUserId: p.zendesk_user_id });
    if (r.ok) lembrados++;
  }
  const { sendPushToPartners } = await import("@/lib/auto-assign-job-invites");
  const push = await sendPushToPartners(sb, ids, {
    title: "Reminder: quote waiting for your price",
    body: `${q.reference} · ${q.service_type ?? "Quote"} · ${q.postcode ?? ""}`.slice(0, 500),
    data: { type: "quote_bid_invite", quoteId: q.id, reference: q.reference },
  });
  return `reminded ${lembrados} by email thread and ${push} by push, of ${ids.length} without a bid`;
}

async function tratarLeilao(sb: SupabaseClient, t: Ticket, aplicar: boolean, agora: Date, out: ResultadoCotacaoAutomatica): Promise<boolean> {
  const quem = `#${t.id} ${t.subject.slice(0, 50)}`;
  const q = await quoteDoTicket(sb, t.id);
  if (!q) { out.pulados.push(`${quem}: no quote in the OS`); return false; }
  if (["awaiting_customer", "awaiting_payment", "converted_to_job", "rejected"].includes(q.status)) {
    if (aplicar) await addTicketTags(t.id, [TAG_FIM]);
    out.pulados.push(`${quem}: ${q.reference} already ${q.status}, nothing to do`);
    return false;
  }
  const { data: lancesBrutos } = await sb.from("quote_bids").select("id, partner_id, partner_name, bid_amount, status, created_at").eq("quote_id", q.id);
  const escolha = escolherMelhorLance((lancesBrutos ?? []) as unknown as Lance[]);
  const { data: primeiro } = await sb.from("quote_partner_invitations").select("invited_at").eq("quote_id", q.id).order("invited_at", { ascending: true }).limit(1);
  const inicio = q.bidding_started_at ?? (primeiro?.[0] as { invited_at?: string } | undefined)?.invited_at ?? null;
  const horas = inicio ? (agora.getTime() - new Date(inicio).getTime()) / H : 0;
  const passo = proximoPassoDoLeilao({ tags: t.tags, horasDesdeConvite: horas, temLance: !!escolha || (q.status === "quote_ready" && Number(q.total_value) > 0) });
  if (!passo) return false;

  if (passo === "lembrar_parceiros") {
    const r = await lembrarParceiros(sb, t, q, aplicar);
    if (!aplicar) { out.acoes.push(`${quem}: ${Math.round(horas)}h, no bid: ${r}`); return true; }
    await nota(t.id, `🤖 Auto-quote: ${Math.round(horas)}h without a bid on ${q.reference}, ${r}.`);
    await addTicketTags(t.id, [TAG_LEMBROU_PARCEIROS]);
    out.acoes.push(`${quem}: ${r}`);
    return true;
  }

  const { user } = await zendeskApi<{ user: Usuario }>(`users/${t.requester_id}.json`);
  const nome = firstName(user.name ?? null) ?? "there";
  const conv = await lerConversa(sb, t, user, null, agora);

  if (passo === "avisar_cliente") {
    const texto = textoAindaCotando(nome, q.service_type);
    // Preço não cabe em template, e "ainda cotando" também não: fora da janela, só a equipe sabe.
    const podeFalar = conv.canal === "email" || (conv.janelaAberta && !!conv.conversa);
    if (!aplicar) { out.acoes.push(`${quem}: ${Math.round(horas)}h, no bid: would ${podeFalar ? `tell the customer (${conv.canal}): "${texto}"` : "NOT message the customer (WhatsApp window closed)"} + note + harvey_no_bids → Action Required`); return true; }
    const via = podeFalar ? await falarComCliente(t, user, conv, texto, q.service_type) : null;
    await nota(t.id, `🤖 Auto-quote: 24h and no partner bid on ${q.reference}. ${via ? `Customer told we're still working on it (${via}), no time promised.` : "Customer NOT messaged: the WhatsApp 24h window is closed."}\n\nThis needs a person: call a partner, widen the area, or price it in-house.`);
    await addTicketTags(t.id, [TAG_SEM_LANCE]);
    // lead_gen tira o ticket do Action Required (a view exclui); passada a cotação ele já não é lead.
    if (t.tags.includes("lead_gen")) await removeTicketTags(t.id, ["lead_gen"]);
    await sb.from("quotes").update({ automation_status: AVISEI_SEM_LANCE, updated_at: new Date().toISOString() }).eq("id", q.id);
    out.acoes.push(`${quem}: 24h without bids, ${via ? `customer told (${via})` : "customer not messaged (window closed)"}, sent to Action Required`);
    return true;
  }

  // precificar
  const jaPrecificada = q.status === "quote_ready" && Number(q.total_value) > 0 && Number(q.partner_cost) > 0;
  const custo = jaPrecificada ? Number(q.partner_cost) : (escolha?.melhor.valor ?? 0);
  const total = jaPrecificada ? Number(q.total_value) : precoDoLance(custo);
  const faltando: Falta[] = faltandoNoContexto({
    servico: q.service_type,
    postcode: q.postcode,
    endereco: q.property_address,
    escopo: q.scope,
    fotos: imagensDaQuote(q).length,
  });
  const decisao = decidirEnvio({ total, custo, faltando, canalAberto: conv.canal === "email" || (conv.janelaAberta && !!conv.conversa) });
  const parceiro = escolha?.melhor.partner_name ?? "partner";
  const resumo = `bid £${custo.toFixed(2)} (${parceiro}) → £${total.toFixed(2)} at ${Math.round(margemDe(total, custo) * 100)}% margin`;
  const texto = textoDaQuote({ nome, servico: q.service_type, total, referencia: q.reference });
  if (!aplicar) {
    out.acoes.push(`${quem}: ${resumo}: would ${decisao.enviar ? `SEND to the customer (${conv.canal}) and move to Approval` : `move to Quote Ready for review (${decisao.motivos.join(", ")})`}`);
    return true;
  }

  if (!jaPrecificada && escolha) {
    const { selectQuoteBidForProposal } = await import("@/lib/quotes/select-quote-bid-for-proposal");
    const { insertQuoteLineItemsResilient } = await import("@/lib/quote-line-items-insert");
    await selectQuoteBidForProposal(sb, escolha.melhor.id, q.id);
    const { count } = await sb.from("quote_line_items").select("id", { count: "exact", head: true }).eq("quote_id", q.id);
    if (!count) {
      await insertQuoteLineItemsResilient(sb, [
        { quote_id: q.id, description: (q.title || q.service_type || "Works as described").slice(0, 300), quantity: 1, unit_price: total, sort_order: 0, partner_unit_cost: custo, notes: `From ${parceiro}'s bid` },
      ]);
    }
    await sb
      .from("quotes")
      .update({ status: "quote_ready", total_value: total, sell_price: total, margin_percent: Math.round(margemDe(total, custo) * 1000) / 10, updated_at: new Date().toISOString() })
      .eq("id", q.id);
  }

  if (decisao.enviar) {
    const via = await falarComCliente(t, user, conv, texto, q.service_type);
    await updateTicket({
      ticketId: t.id,
      customStatusId: ZD_STATUS_AWAITING_APPROVAL,
      publicComment: false,
      commentBody: `🤖 Auto-quote: ${resumo}. Under £600 with full context, so the quote was SENT to the customer (${via}):\n\n"${texto}"\n\nThe approval follow-up takes it from here.`,
      additionalTags: [TAG_QUOTE_ENVIADA, TAG_FIM],
    });
    if (t.tags.includes(TAG_SEM_LANCE)) await removeTicketTags(t.id, [TAG_SEM_LANCE]);
    out.acoes.push(`${quem}: ${resumo}, sent (${via})`);
    return true;
  }
  await updateTicket({
    ticketId: t.id,
    customStatusId: ZD_STATUS_QUOTE_READY,
    publicComment: false,
    commentBody: `🤖 Auto-quote: ${resumo}. NOT sent automatically: ${decisao.motivos.join(", ")}.\n\nCheck and send. Suggested message:\n\n${texto}`,
    additionalTags: [TAG_PARA_REVISAR, TAG_FIM],
  });
  if (t.tags.includes(TAG_SEM_LANCE)) await removeTicketTags(t.id, [TAG_SEM_LANCE]);
  out.acoes.push(`${quem}: ${resumo}, Quote Ready for review (${decisao.motivos.join(", ")})`);
  return true;
}

/* ============================== a varredura ============================== */

export async function varrerCotacaoAutomatica(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoCotacaoAutomatica> {
  const hora = horaDeLondres(agora);
  const foraDoHorario = hora < 8 || hora >= 20;
  const out: ResultadoCotacaoAutomatica = { ensaio: !aplicar, foraDoHorario, olhados: 0, acoes: [], pulados: [] };
  if (foraDoHorario && aplicar) return out;

  let feitas = 0;
  const entrada = await buscar(`type:ticket status<solved custom_status_id:${ZD_STATUS_NEEDS_QUOTE}`);
  const leilao = await buscar(`type:ticket status<solved tags:${TAG_CONVIDOU} -tags:${TAG_FIM}`);
  const filas: Array<[Ticket[], typeof tratarEntrada]> = [[leilao, tratarLeilao], [entrada, tratarEntrada]];
  for (const [tickets, tratar] of filas) {
    for (const t of tickets) {
      if (aplicar && feitas >= MAX_ACOES) { out.pulados.push(`#${t.id}: cycle limit (${MAX_ACOES}) reached, next cycle`); continue; }
      out.olhados++;
      try {
        if (await tratar(sb, t, aplicar, agora, out)) feitas++;
      } catch (e) {
        out.pulados.push(`#${t.id}: ${e instanceof Error ? e.message.slice(0, 140) : "failed"}`);
      }
    }
  }
  return out;
}
