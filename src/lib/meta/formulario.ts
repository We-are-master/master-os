/**
 * Lead do formulário instantâneo da Meta (Lead Ads) → OS → WhatsApp em segundos.
 *
 * A Meta avisa no webhook da página (campo `leadgen`) só com o id do lead; o OS
 * busca os campos na Graph API com o token da página e entra pelos MESMOS
 * trilhos do lead do Checkatrade, para nada novo precisar existir depois:
 *
 *   1. cliente no OS (acha pelo telefone ou e-mail, senão cria)
 *   2. template de boas-vindas pelo WhatsApp do Zendesk (020 4538 4668)
 *   3. ticket "Lead · Serviço · Nome · Postcode" com a ficha (external_id meta-lead:<id>)
 *   4. linha em harvey_wa_leads (lead_externo "meta:<id>"): quando o cliente
 *      responde, o Harvey junta este ticket no da conversa; sem resposta, a
 *      régua de 3 dias (followup-leads.ts) segue sozinha
 *   5. lead no CRM em New lead, origem meta_form, com os ids do anúncio em `raw`
 *   6. e-mail "Welcome to Fixfy" com WELCOME10 (processo/boas-vindas-lead.ts), como o Checkatrade
 *
 * A venda volta para a Meta em compra-do-formulario.ts.
 *
 * Ambiente:
 *   META_PAGE_TOKEN              token da página com leads_retrieval (obrigatório)
 *   META_LEAD_TEMPLATE           template de boas-vindas (padrão fixfy_form_welcome_v2)
 *   META_LEAD_TEMPLATE_LANG      idioma (padrão en_GB)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveDoTelefone } from "@/lib/harvey-wa/identidade";
import { nomeProprio } from "@/lib/nome-proprio";
import { assuntoDoLead, externalIdDoLead, jaFalamosComEle, telefoneE164 } from "@/lib/harvey-wa/primeiro-contato";
import { enviarTemplatePeloZendesk } from "@/lib/harvey-wa/template-zendesk";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { zendeskApi, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";

const GRAPH = "https://graph.facebook.com/v23.0";

export const templateDoFormulario = () => process.env.META_LEAD_TEMPLATE?.trim() || "fixfy_form_welcome_v2";

/** O texto do template como o cliente lê (para a nota do ticket). Igual ao submetido em scripts/whatsapp-template-formulario.mts. */
export const TEXTO_DO_TEMPLATE =
  "Hi {{1}}, thanks for getting in touch with Fixfy, I'm Harvey and I'll be looking after you.\n\nCould you tell me a bit more about what needs doing? A photo or two really helps us get the price right.\n\nThank you";

export type CampoDaMeta = { name?: string; values?: string[] };

export type LeadDaMeta = {
  leadgenId: string;
  criadoEm: string | null;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  formId: string | null;
  plataforma: string | null;
  nome: string;
  telefone: string | null;
  email: string | null;
  postcode: string | null;
  servico: string;
  /** Outras perguntas do formulário, para a ficha. */
  extras: Array<[string, string]>;
};

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "end_of_tenancy_clean" → "end of tenancy clean". */
export function textoDoValor(v: string): string {
  return v.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Os campos do formulário → o que o OS usa. Aceita as perguntas padrão da Meta e nomes livres. */
export function lerCampos(campos: CampoDaMeta[]): Pick<LeadDaMeta, "nome" | "telefone" | "email" | "postcode" | "servico" | "extras"> {
  const mapa = new Map<string, string>();
  for (const c of campos ?? []) {
    const chave = String(c.name ?? "").trim().toLowerCase();
    const valor = String(c.values?.[0] ?? "").trim();
    if (chave && valor) mapa.set(chave, valor);
  }
  const pega = (...chaves: string[]) => chaves.map((k) => mapa.get(k)).find(Boolean) ?? null;
  const usadas = new Set(["full_name", "first_name", "last_name", "phone_number", "phone", "email", "post_code", "postcode", "zip_code", "zip", "postal_code"]);

  const nome = pega("full_name") ?? [pega("first_name"), pega("last_name")].filter(Boolean).join(" ");
  const email = (pega("email") ?? "").toLowerCase();
  const chaveDoServico = [...mapa.keys()].find((k) => !usadas.has(k) && /service|servi|job|help|need|what/.test(k)) ?? null;
  if (chaveDoServico) usadas.add(chaveDoServico);
  const servico = chaveDoServico ? textoDoValor(mapa.get(chaveDoServico)!).toLowerCase() : "your job";

  return {
    nome: nome.trim(),
    telefone: pega("phone_number", "phone"),
    email: EMAIL_VALIDO.test(email) ? email : null,
    postcode: (pega("post_code", "postcode", "zip_code", "zip", "postal_code") ?? "").toUpperCase() || null,
    servico,
    extras: [...mapa.entries()].filter(([k]) => !usadas.has(k)).map(([k, v]) => [textoDoValor(k), textoDoValor(v)]),
  };
}

/** Os ids de lead que vieram no webhook da página (campo leadgen). */
export function idsDoWebhook(evento: unknown): string[] {
  const out: string[] = [];
  const entradas = (evento as { entry?: Array<{ changes?: Array<{ field?: string; value?: { leadgen_id?: unknown } }> }> })?.entry ?? [];
  for (const e of entradas) {
    for (const c of e.changes ?? []) {
      const id = c.field === "leadgen" ? String(c.value?.leadgen_id ?? "").trim() : "";
      if (/^\d+$/.test(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** Busca o lead na Graph API com o token da página. */
export async function buscarLeadNaMeta(leadgenId: string, fazerFetch: typeof fetch = fetch): Promise<LeadDaMeta> {
  const token = process.env.META_PAGE_TOKEN?.trim();
  if (!token) throw new Error("META_PAGE_TOKEN não configurado");
  const campos = "created_time,ad_id,ad_name,adset_id,campaign_id,campaign_name,form_id,platform,field_data";
  const res = await fazerFetch(`${GRAPH}/${leadgenId}?fields=${campos}&access_token=${encodeURIComponent(token)}`);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { field_data?: CampoDaMeta[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Graph ${res.status}: ${j.error?.message ?? "falhou"}`);
  const s = (k: string) => (typeof j[k] === "string" && (j[k] as string).trim() ? (j[k] as string).trim() : null);
  return {
    leadgenId,
    criadoEm: s("created_time"),
    adId: s("ad_id"),
    adName: s("ad_name"),
    adsetId: s("adset_id"),
    campaignId: s("campaign_id"),
    campaignName: s("campaign_name"),
    formId: s("form_id"),
    plataforma: s("platform"),
    ...lerCampos(j.field_data ?? []),
  };
}

export type ResultadoDoFormulario =
  | { kind: "repetido"; leadId: string }
  | { kind: "ok"; leadId: string | null; ticket: number | null; whatsapp: "enviado" | "ja_falamos" | "sem telefone" | "falhou"; motivo?: string };

const primeiroNome = (nome: string) => nomeProprio(nome.trim().split(/\s+/)[0] ?? "") || "there";

/** Entrada completa de UM lead do formulário. Idempotente pelo leadgen_id. */
export async function receberLeadDoFormulario(sb: SupabaseClient, lead: LeadDaMeta): Promise<ResultadoDoFormulario> {
  // A Meta reenvia o webhook: um lead do OS por leadgen_id.
  const { data: ja } = await sb.from("leads").select("id").eq("source", "meta_form").eq("raw->>leadgen_id", lead.leadgenId).limit(1);
  if (ja?.length) return { kind: "repetido", leadId: (ja[0] as { id: string }).id };

  const destino = telefoneE164(lead.telefone);
  const clienteId = await acharOuCriarCliente(sb, lead, destino);

  // 1) WhatsApp de boas-vindas.
  let whatsapp: "enviado" | "ja_falamos" | "sem telefone" | "falhou" = "sem telefone";
  let motivo: string | undefined;
  let notificacao: string | null = null;
  if (destino) {
    const chave = chaveDeEnvio("primeiro-contato", chaveDoTelefone(destino), `meta:${lead.leadgenId}`);
    try {
      if (await jaFalamosComEle(sb, destino)) whatsapp = "ja_falamos";
      else {
        const reserva = await reservarEnvio(sb, { chave, finalidade: "primeiro-contato", canal: "whatsapp", destinatario: destino, template: templateDoFormulario(), motivo: "meta form lead" });
        if (!reserva.reservado) whatsapp = "ja_falamos";
        else {
          try {
            const r = await enviarTemplatePeloZendesk({
              to: destino,
              name: templateDoFormulario(),
              language: process.env.META_LEAD_TEMPLATE_LANG?.trim() || "en_GB",
              bodyParams: [primeiroNome(lead.nome)],
            });
            notificacao = r.messageId || null;
            await confirmarEnvio(sb, chave, notificacao);
            whatsapp = "enviado";
          } catch (e) {
            await falhouEnvio(sb, chave, e).catch(() => undefined);
            throw e;
          }
        }
      }
    } catch (e) {
      whatsapp = "falhou";
      motivo = e instanceof Error ? e.message.slice(0, 240) : "falhou";
      console.error("[meta-form] WhatsApp", lead.leadgenId, motivo);
    }
  }

  // 2) Ticket do lead (com ou sem WhatsApp: a equipe vê o lead de qualquer jeito).
  const ticket = await abrirTicketDoFormulario(lead, destino, whatsapp, clienteId).catch((e) => {
    console.error("[meta-form] ticket", lead.leadgenId, e);
    return null;
  });

  // 2b) "Welcome to Fixfy" com WELCOME10 por e-mail, igual ao lead do Checkatrade (dono, 17/11/2026).
  // Mesmas travas (conta v2 direct, janela, primeira compra, uma vez por e-mail); com ticket, sai
  // como conversa lateral nele. O Harvey já lê que o código foi enviado (welcome-lead.ts).
  if (clienteId && lead.email) {
    await import("@/lib/processo/boas-vindas-lead")
      .then(({ mandarBoasVindasDoLead, dependenciasDasBoasVindas }) =>
        mandarBoasVindasDoLead(
          { ticketId: ticket, clienteId, telefone: destino, leadExterno: `meta:${lead.leadgenId}`, servico: lead.servico, nome: primeiroNome(lead.nome), email: lead.email },
          dependenciasDasBoasVindas(sb),
        ),
      )
      .then((bv) => console.log(`[meta-form] welcome ${lead.leadgenId}: ${bv.motivo}`))
      .catch((e) => console.error("[meta-form] welcome", lead.leadgenId, e));
  }

  // 3) harvey_wa_leads: liga a resposta do cliente a este ticket e põe o lead na régua de 3 dias.
  if (destino && whatsapp === "enviado") {
    await sb.from("harvey_wa_leads").upsert(
      {
        chave: chaveDoTelefone(destino),
        telefone: destino,
        cliente_id: clienteId,
        lead_externo: `meta:${lead.leadgenId}`,
        servico: lead.servico,
        notificacao,
        ticket_id: ticket,
        origem: "lead",
        enviado_em: new Date().toISOString(),
      },
      { onConflict: "chave" },
    );
  }

  // 4) CRM.
  const leadId = await registrarNoCrm(sb, lead, clienteId, ticket).catch((e) => {
    console.error("[meta-form] CRM", lead.leadgenId, e);
    return null;
  });
  // A conversa do WhatsApp acha o lead do CRM pela linha do Harvey (fontes-servidor.ts).
  if (leadId && destino && whatsapp === "enviado") {
    const { error } = await sb.from("harvey_wa_leads").update({ lead_id: leadId }).eq("chave", chaveDoTelefone(destino));
    if (error) console.warn("[meta-form] harvey_wa_leads.lead_id", error.message);
  }
  return { kind: "ok", leadId, ticket, whatsapp, ...(motivo ? { motivo } : {}) };
}

/** O que a pessoa já respondeu no formulário, como o Harvey lê. Puro. */
export function textoDoFormulario(l: {
  nome: string | null;
  email: string | null;
  postcode: string | null;
  servico: string | null;
  respostas: Array<[string, string]>;
  quando: string | null;
}): string {
  const servico = l.servico && l.servico !== "your job" ? l.servico : null;
  const respostas = l.respostas.filter(([, v]) => v && !/^<test lead/i.test(v)).map(([k, v]) => `${k}: ${v}`);
  return [
    `This person filled in our Facebook/Instagram instant form${l.quando ? ` on ${new Date(l.quando).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" })}` : ""} and our welcome template was the first message in this chat, sent in your name: it already greeted them by name, introduced you as Harvey and asked what needs doing with a photo or two. Do not greet them again, do not introduce yourself and do not use their name: go straight to what they wrote.`,
    "What they already told us in the form, so never ask for it again:",
    servico ? `service: ${servico};` : null,
    l.nome ? `name: ${l.nome};` : null,
    l.postcode ? `postcode: ${l.postcode};` : null,
    l.email ? `email: ${l.email} (use it for the payment link);` : null,
    ...respostas.map((r) => `${r};`),
    `Move the job on from what they chose${servico ? ` (${servico})` : ""}: ask only what is still missing to price it, such as what exactly needs doing, a photo, or the day.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Lead do formulário dos últimos 14 dias com este telefone: o contexto para o Harvey, ou null. */
export async function contextoDoFormulario(sb: SupabaseClient, telefone: string): Promise<string | null> {
  const e164 = telefoneE164(telefone);
  if (!e164) return null;
  const desde = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const { data } = await sb
    .from("leads")
    .select("name, email, postcode, raw, created_at")
    .eq("source", "meta_form")
    .eq("phone", e164)
    .gte("created_at", desde)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const l = data?.[0] as { name: string | null; email: string | null; postcode: string | null; raw: Record<string, unknown> | null; created_at: string } | undefined;
  if (!l) return null;
  const raw = l.raw ?? {};
  const respostas = Array.isArray(raw.respostas) ? (raw.respostas as Array<[string, string]>).filter((r) => Array.isArray(r) && r.length === 2) : [];
  return textoDoFormulario({
    nome: l.name && l.name !== "Meta lead" ? l.name : null,
    email: l.email,
    postcode: l.postcode,
    servico: typeof raw.servico === "string" ? raw.servico : null,
    respostas,
    quando: l.created_at,
  });
}

async function acharOuCriarCliente(sb: SupabaseClient, lead: LeadDaMeta, destino: string | null): Promise<string | null> {
  const chave = destino ? chaveDoTelefone(destino) : null;
  if (chave) {
    const { data } = await sb.from("clients").select("id").ilike("phone", `%${chave}`).is("deleted_at", null).limit(1);
    if (data?.[0]) return (data[0] as { id: string }).id;
  }
  if (lead.email) {
    const { data } = await sb.from("clients").select("id").ilike("email", lead.email).is("deleted_at", null).limit(1);
    if (data?.[0]) return (data[0] as { id: string }).id;
  }
  if (!destino && !lead.email) return null;
  const { data, error } = await sb
    .from("clients")
    .insert({
      full_name: lead.nome || "Meta lead",
      email: lead.email,
      phone: destino,
      postcode: lead.postcode,
      notes: `meta-lead:${lead.leadgenId}`,
      client_type: "residential",
      source: "direct",
      status: "active",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[meta-form] cliente", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

export function fichaDoFormulario(lead: LeadDaMeta, destino: string | null, whatsapp: string, clienteId: string | null): string {
  const mensagem = TEXTO_DO_TEMPLATE.replace("{{1}}", primeiroNome(lead.nome));
  const proximo =
    whatsapp === "enviado"
      ? "Next action: awaiting reply on WhatsApp. Harvey answers, and this ticket is merged into that conversation."
      : whatsapp === "ja_falamos"
        ? "WhatsApp not sent: we already have a conversation with this number. Check it before contacting."
        : `WhatsApp not sent (${whatsapp}). Contact the lead by phone or email.`;
  return [
    "NEW META FORM LEAD",
    "",
    `Name: ${lead.nome || "-"}`,
    `Phone: ${destino ?? lead.telefone ?? "-"}`,
    ...(destino ? [`WhatsApp: https://wa.me/${destino.replace(/\D/g, "")}`] : []),
    `Email: ${lead.email ?? "-"}`,
    `Postcode: ${lead.postcode ?? "-"}`,
    `Service: ${lead.servico}`,
    ...lead.extras.map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${v}`),
    "",
    `Campaign: ${lead.campaignName ?? lead.campaignId ?? "-"}`,
    `Ad: ${lead.adName ?? lead.adId ?? "-"}`,
    `Platform: ${lead.plataforma ?? "-"}`,
    `Meta lead id: ${lead.leadgenId}`,
    ...(clienteId ? [`OS contact: https://app.getfixfy.com/clients?clientId=${clienteId}`] : []),
    "",
    ...(whatsapp === "enviado" ? [mensagem, ""] : []),
    proximo,
  ].join("\n");
}

async function abrirTicketDoFormulario(lead: LeadDaMeta, destino: string | null, whatsapp: string, clienteId: string | null): Promise<number | null> {
  const externalId = externalIdDoLead(`meta:${lead.leadgenId}`);
  const { tickets } = await zendeskApi<{ tickets: Array<{ id: number }> }>(`tickets.json?external_id=${encodeURIComponent(externalId)}`);
  if (tickets?.[0]) return tickets[0].id;
  const enviado = whatsapp === "enviado";
  const r = await zendeskApi<{ ticket: { id: number } }>("tickets.json", {
    method: "POST",
    body: {
      ticket: {
        subject: assuntoDoLead(lead.servico, lead.nome, lead.postcode),
        comment: { body: fichaDoFormulario(lead, destino, whatsapp, clienteId), public: false },
        requester: lead.email ? { name: lead.nome || "Meta lead", email: lead.email } : { name: "Fixfy Team", email: "team@getfixfy.com" },
        priority: "high",
        // Mesmas tags do lead do Checkatrade (view 🎯 Leads, Harvey do WhatsApp cuida), origem em lead_meta_form.
        tags: ["harvey_wa_lead", "lead_meta_form", "lead_gen", "ai_quote_draft", ...(enviado ? ["lead_wa_sent"] : ["lead_call"])],
        external_id: externalId,
        ...(enviado ? { custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_replied" }] } : {}),
      },
    },
  });
  return r.ticket?.id ?? null;
}

async function registrarNoCrm(sb: SupabaseClient, lead: LeadDaMeta, clienteId: string | null, ticket: number | null): Promise<string | null> {
  const { data: ref } = await sb.rpc("next_lead_ref");
  const { data: criado, error } = await sb
    .from("leads")
    .insert({
      reference: String(ref),
      name: lead.nome || "Meta lead",
      email: lead.email,
      phone: telefoneE164(lead.telefone) ?? lead.telefone,
      address: lead.postcode ? `London, ${lead.postcode}` : "London",
      city: "London",
      postcode: lead.postcode,
      urgency: "medium",
      scope: [`${lead.servico.charAt(0).toUpperCase()}${lead.servico.slice(1)}.`, "Meta instant form. First contact by WhatsApp (Harvey)."].join(" "),
      status: "new",
      stage: "new",
      segment: "b2c",
      source: "meta_form",
      client_id: clienteId,
      published_at: null,
      raw: {
        leadgen_id: lead.leadgenId,
        ad_id: lead.adId,
        adset_id: lead.adsetId,
        campaign_id: lead.campaignId,
        campaign_name: lead.campaignName,
        form_id: lead.formId,
        platform: lead.plataforma,
        created_time: lead.criadoEm,
        // O que a pessoa respondeu no formulário: o Harvey lê para não perguntar de novo.
        servico: lead.servico,
        respostas: lead.extras,
      },
      ...(ticket ? { external_source: "zendesk", external_ref: String(ticket) } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`lead no CRM: ${error.message}`);
  const id = (criado as { id: string }).id;
  const { registrarEvento } = await import("@/lib/crm/lead-servidor");
  await registrarEvento(sb, {
    leadId: id,
    kind: "created",
    channel: "whatsapp",
    actorType: "system",
    toStage: "new",
    summary: `Lead created · Meta form${lead.campaignName ? ` (${lead.campaignName})` : ""}`,
    payload: { client_id: clienteId, ticket_id: ticket, leadgen_id: lead.leadgenId },
    idempotencyKey: `created:meta:${lead.leadgenId}`,
  }).catch(() => undefined);
  return id;
}
