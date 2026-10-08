/**
 * Primeiro contato do Harvey com um lead do Checkatrade, pelo WhatsApp do Zendesk.
 *
 * O lead nunca escreveu para a gente, então a Meta só aceita template aprovado
 * (fora da janela de 24 horas não existe mensagem livre). O template sai pela
 * Notification API do Sunshine com `messageSchema: "whatsapp"`: o Zendesk grava
 * a mensagem na conversa, e quando o cliente responde o Harvey já vê o que
 * mandamos e continua dali.
 *
 * Ordem, a mesma que o despacho do respond.io aprendeu a duras penas
 * (dispatch-one.ts): conferir se já falamos, enviar, e só então registrar.
 * Registro antes do envio tranca para sempre o lead cujo envio falhou.
 *
 * Ambiente (Vercel e .env.local da máquina dos scripts):
 *   HARVEY_WA_LEAD_TEMPLATE        nome do template aprovado: checkatrade_first_contact (07/10/2026)
 *   HARVEY_WA_LEAD_TEMPLATE_LANG   idioma do template: "en" para o checkatrade_first_contact (padrão en_GB)
 *   HARVEY_WA_TEMPLATE_NAMESPACE   só se o Zendesk pedir (WABA antiga)
 *   HARVEY_WA_LEAD_TEMPLATE_VARS   as variáveis do template, na ordem (padrão "nome,servico";
 *                                  o aprovado em 07/10/2026 chama pelo nome e o tipo de trabalho)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decideDispatch } from "@/lib/agent/sales/dispatch-gate";
import { areaDoTemplate } from "@/lib/agent/sales/dispatch-one";
import { firstName, parseLeadBrief } from "@/lib/agent/sales/lead-brief";
import type { CatalogService } from "@/types/database";
import { chaveDoTelefone } from "./identidade";
import { scApi, scNotificacao } from "./sunshine";
import { ticketNaOrgDeLeads } from "./zendesk-wa";
import { zendeskApi, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";

let integracaoWhatsApp: string | null = null;

/** O id da integração de WhatsApp do app no Sunshine (o número da Fixfy). */
async function idDaIntegracaoWhatsApp(): Promise<string> {
  if (integracaoWhatsApp) return integracaoWhatsApp;
  const fixo = process.env.HARVEY_WA_WHATSAPP_INTEGRATION_ID?.trim();
  if (fixo) return (integracaoWhatsApp = fixo);
  const r = await scApi<{ integrations: Array<{ id: string; type: string; status?: string }> }>("/integrations?filter[types]=whatsapp");
  const wa = (r.integrations ?? []).find((i) => i.type === "whatsapp" && i.status !== "inactive");
  if (!wa) throw new Error("Nenhuma integração de WhatsApp ativa no Sunshine");
  return (integracaoWhatsApp = wa.id);
}

/** As variáveis na ordem do template. A Meta recusa se o número não bater com o aprovado. */
export function variaveisDoTemplate(p: Pick<PrimeiroContato, "nome" | "servico" | "area">): string[] {
  const valores: Record<string, string> = { nome: p.nome, servico: p.servico, area: p.area };
  const ordem = (process.env.HARVEY_WA_LEAD_TEMPLATE_VARS?.trim() || "nome,servico").split(",").map((v) => v.trim());
  return ordem.map((v) => valores[v]).filter((v): v is string => Boolean(v));
}

export function templateDoLeadConfigurado(): boolean {
  return Boolean(process.env.HARVEY_WA_LEAD_TEMPLATE?.trim());
}

/** "+447700900123": o formato que o Sunshine quer no destinationId. */
export function telefoneE164(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 12) return `+${d}`;
  if (d.startsWith("0") && d.length >= 10) return `+44${d.slice(1)}`;
  if (d.startsWith("7") && d.length === 10) return `+44${d}`;
  return null;
}

/**
 * Já falamos com essa PESSOA? Vale qualquer um dos dois: um primeiro contato
 * registrado para o número, ou uma conversa viva com o Harvey no WhatsApp
 * (quem já escreveu não recebe "oi, vi seu pedido" por cima da conversa).
 */
export async function jaFalamosComEle(sb: SupabaseClient, telefone: string): Promise<boolean> {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return false;
  const fim = chave.slice(-4);
  const [{ data: envios }, { data: conversas }] = await Promise.all([
    sb.from("harvey_wa_leads").select("telefone").eq("chave", chave).limit(1),
    sb.from("harvey_wa_conversas").select("phone").ilike("phone", `%${fim}`).limit(50),
  ]);
  if ((envios ?? []).length) return true;
  return (conversas ?? []).some((c) => chaveDoTelefone(c.phone as string | null) === chave);
}

export type PrimeiroContato = {
  clienteId: string;
  telefone: string;
  nome: string;
  servico: string;
  area: string;
  leadExterno?: string | null;
};

export type ResultadoDoContato = { kind: "enviado"; notificacao: string | null; ticket: number | null } | { kind: "ja_falamos" } | { kind: "falhou"; motivo: string };

/** Manda o template de primeiro contato para UM lead e registra. Nunca lança. */
export async function mandarPrimeiroContato(sb: SupabaseClient, p: PrimeiroContato): Promise<ResultadoDoContato> {
  const nomeDoTemplate = process.env.HARVEY_WA_LEAD_TEMPLATE?.trim();
  if (!nomeDoTemplate) return { kind: "falhou", motivo: "HARVEY_WA_LEAD_TEMPLATE não configurado" };
  const destino = telefoneE164(p.telefone);
  if (!destino) return { kind: "falhou", motivo: `telefone inválido: ${p.telefone}` };
  try {
    if (await jaFalamosComEle(sb, destino)) return { kind: "ja_falamos" };
    // O namespace da conta de WhatsApp (o mesmo do n8n dos leads da Meta).
    const namespace = process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542";
    const r = await scNotificacao<{ notification?: { _id?: string; id?: string } }>({
      destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: destino },
      author: { role: "appMaker" },
      messageSchema: "whatsapp",
      message: {
        type: "template",
        template: {
          namespace,
          name: nomeDoTemplate,
          language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
          components: [
            {
              type: "body",
              parameters: variaveisDoTemplate(p).map((text) => ({ type: "text", text })),
            },
          ],
        },
      },
      metadata: { origem: "checkatrade", clienteId: p.clienteId, ...(p.leadExterno ? { leadExterno: p.leadExterno } : {}) },
    });
    const notificacao = r.notification?._id ?? r.notification?.id ?? null;
    await sb.from("harvey_wa_leads").upsert(
      { chave: chaveDoTelefone(destino), telefone: destino, cliente_id: p.clienteId, lead_externo: p.leadExterno ?? null, servico: p.servico, notificacao, enviado_em: new Date().toISOString() },
      { onConflict: "chave" },
    );
    // O ticket nasce agora, com o template dentro (como no respond.io); a resposta do cliente junta tudo nele.
    const ticket = await abrirTicketDoLead(sb, p, destino).catch((e) => (console.error("[harvey-wa] ticket do lead", e), null));
    return { kind: "enviado", notificacao, ticket };
  } catch (e) {
    return { kind: "falhou", motivo: e instanceof Error ? e.message.slice(0, 240) : "falhou" };
  }
}

export type LinhaDeCliente = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  address: string | null;
  notes: string | null;
};

export type DecisaoDoLead =
  | { kind: "mandar"; contato: PrimeiroContato }
  | { kind: "pular"; motivo: string };

/**
 * Lead do banco (clients) → o que vai no template, ou por que não vai. A
 * decisão (telefone, área coberta, serviço que vendemos) é a mesma do despacho
 * antigo: dispatch-gate.ts.
 */
export function decidirLead(r: LinhaDeCliente, catalogo: CatalogService[]): DecisaoDoLead {
  const brief = parseLeadBrief({ ...r, name: r.full_name });
  // Só lead do Checkatrade: o template fala "your Checkatrade request". Lead do
  // site também chega com celular pelo ingest e não pode receber esse texto.
  if (!brief.externalId) return { kind: "pular", motivo: "não é lead do Checkatrade" };
  const d = decideDispatch(brief, catalogo);
  if (!d.dispatch) return { kind: "pular", motivo: d.reason };
  return {
    kind: "mandar",
    contato: {
      clienteId: r.id,
      telefone: brief.phone!,
      nome: firstName(brief.name) ?? "there",
      servico: d.label,
      area: areaDoTemplate(d.postcodeText),
      leadExterno: brief.externalId ?? null,
    },
  };
}


/** O texto aprovado de cada template (Meta, conta do 020 4538 4668), para a nota do ticket. */
const TEXTO_DOS_TEMPLATES: Record<string, { corpo: string; rodape?: string }> = {
  checkatrade_request_received: {
    corpo:
      "Hi {{1}}, this is Fixfy. We've just received your Checkatrade request for {{2}}.\n\nCould you reply with a few photos of the job? That way we can give you an accurate price with no surprises. If you'd rather talk, just tell us a good time to call.",
    rodape: "Fixfy · London",
  },
};

/** O external_id do ticket do lead: o mesmo marcador das notas do OS. */
export function externalIdDoLead(leadExterno: string): string {
  return `checkatrade-lead:${leadExterno}`;
}

/**
 * Nome padrão de ticket de lead (dono, 07/10/2026), igual ao dos leads da Meta:
 * "<Origem> lead · <Serviço> · <Nome> · <Postcode>".
 */
/** "Lead · Handyman work · Nome · Postcode". A origem fica na Organisation do ticket (dono, 08/10/2026). */
export function assuntoDoLead(servico: string, nome: string, postcode: string | null): string {
  const s = servico.trim();
  return ["Lead", s.charAt(0).toUpperCase() + s.slice(1), nome.trim() || "No name", postcode?.trim().toUpperCase()].filter(Boolean).join(" · ");
}

/**
 * Abre o ticket do lead no Zendesk na hora do template, só com nota interna
 * (nenhum e-mail sai: os gatilhos de criação pedem comentário público). Quando
 * o cliente responde, o Harvey junta este ticket no do WhatsApp
 * (juntarTicketDoLead). Já existe (reenvio): só acrescenta a nota.
 */
export async function abrirTicketDoLead(sb: SupabaseClient, p: PrimeiroContato, destino: string, quando: Date = new Date()): Promise<number | null> {
  if (!p.leadExterno) return null;
  const { data: c } = await sb.from("clients").select("full_name,email,postcode,address,notes").eq("id", p.clienteId).maybeSingle();
  const brief = parseLeadBrief({ id: p.clienteId, name: c?.full_name ?? null, phone: destino, email: c?.email ?? null, postcode: c?.postcode ?? null, address: c?.address ?? null, notes: c?.notes ?? null });
  const nome = brief.name || p.nome;
  const email = (brief.email ?? "").trim().toLowerCase();
  const emailDoCliente = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !/@getfixfy\.com$/i.test(email) ? email : null;
  const ligarAte = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(quando.getTime() + 2 * 3600_000));
  const template = process.env.HARVEY_WA_LEAD_TEMPLATE?.trim() ?? "";
  // A mensagem como o cliente lê no WhatsApp, com as variáveis já trocadas (formato do dono, 07/10/2026).
  const vars = variaveisDoTemplate(p);
  const doEnv = process.env.HARVEY_WA_LEAD_TEMPLATE_TEXT?.trim().replace(/\\n/g, "\n");
  const molde = doEnv ? { corpo: doEnv } : TEXTO_DOS_TEMPLATES[template];
  const troca = (t: string) => vars.reduce((acc, v, i) => acc.split(`{{${i + 1}}}`).join(v), t);
  const notaDoEnvio = [
    molde ? troca(molde.corpo) : `(WhatsApp template ${template}: ${vars.join(", ")})`,
    "",
    `Next action: awaiting reply on WhatsApp (Harvey answers and this ticket is merged into that conversation). No reply by ${ligarAte}: call the lead on ${destino}.`,
    ...(molde?.rodape ? ["", molde.rodape] : []),
  ].join("\n");

  const externalId = externalIdDoLead(p.leadExterno);
  const { tickets } = await zendeskApi<{ tickets: Array<{ id: number; status: string }> }>(`tickets.json?external_id=${encodeURIComponent(externalId)}`);
  const aberto = tickets?.find((t) => !["solved", "closed"].includes(t.status));
  if (aberto) {
    await zendeskApi(`tickets/${aberto.id}.json`, { method: "PUT", body: { ticket: { comment: { body: notaDoEnvio, public: false } } } });
    return aberto.id;
  }
  const ficha = [
    "NEW CHECKATRADE LEAD",
    "",
    `Name: ${nome || "-"}`,
    `Phone: ${destino}`,
    `WhatsApp: https://wa.me/${destino.replace(/\D/g, "")}`,
    `Email: ${email || "-"}`,
    `Postcode: ${brief.postcode ?? "-"}`,
    `Service: ${p.servico}`,
    "",
    "What they asked for:",
    brief.enquiry ?? "(no message)",
    "",
    `OS contact: https://app.getfixfy.com/clients?clientId=${p.clienteId}`,
    `Checkatrade lead id: ${p.leadExterno}`,
    "",
    notaDoEnvio,
  ].join("\n");
  const r = await zendeskApi<{ ticket: { id: number } }>("tickets.json", {
    method: "POST",
    body: {
      ticket: {
        subject: assuntoDoLead(p.servico, nome, brief.postcode),
        comment: { body: ficha, public: false },
        requester: emailDoCliente ? { name: nome || "Checkatrade lead", email: emailDoCliente } : { name: "Fixfy Team", email: "team@getfixfy.com" },
        priority: "high",
        // ai_quote_draft: o Harvey de e-mail pula o ticket; quem cuida é o Harvey do WhatsApp.
        tags: ["harvey_wa_lead", "lead_checkatrade", "lead_wa_sent", "ai_quote_draft"],
        external_id: externalId,
        // 🟢 Sent: o template já saiu, a vez é do cliente. Vira 🔴 quando ele responde (dono, 08/10/2026).
        custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_replied" }],
      },
    },
  });
  // Origem na Organisation ("Checkatrade leads"), não no assunto. Sem e-mail o
  // solicitante é a Fixfy Team: a org entra quando o ticket juntar com o do WhatsApp.
  if (r.ticket?.id && emailDoCliente) {
    const { ticket: t } = await zendeskApi<{ ticket: { requester_id: number } }>(`tickets/${r.ticket.id}.json`);
    await ticketNaOrgDeLeads(r.ticket.id, t.requester_id).catch((e) => console.error("[harvey-wa] org dos leads", e));
  }
  return r.ticket?.id ?? null;
}


/**
 * O lead do Checkatrade também vira um LEAD no OS (tabela leads), na hora,
 * sem publicar aos parceiros (published_at nulo: o lead é nosso até fechar).
 * Uma vez por cliente. Devolve a referência (LD-...) ou null.
 */
export async function registrarLeadNoOs(sb: SupabaseClient, r: LinhaDeCliente, catalogo: CatalogService[], contaId: string | null): Promise<string | null> {
  const brief = parseLeadBrief({ ...r, name: r.full_name });
  if (!brief.externalId) return null;
  const { data: ja } = await sb.from("leads").select("reference").eq("client_id", r.id).is("deleted_at", null).limit(1);
  if (ja?.length) return (ja[0] as { reference: string }).reference;
  const d = decideDispatch(brief, catalogo);
  const servico = d.dispatch ? d.label : "handyman work";
  const doCatalogo = catalogo.find((c) => c.name === "General Maintenance");
  const urgente = /urgent|48 hours|emergency/i.test(r.notes ?? "");
  const { data: ref } = await sb.rpc("next_lead_ref");
  const { error } = await sb.from("leads").insert({
    reference: String(ref),
    name: brief.name || "Checkatrade lead",
    email: brief.email,
    phone: brief.phone,
    address: r.address || (brief.postcode ? `London, ${brief.postcode}` : "London"),
    city: "London",
    postcode: brief.postcode,
    urgency: urgente ? "high" : "medium",
    scope: [`${servico.charAt(0).toUpperCase()}${servico.slice(1)}.`, brief.enquiry ? `Customer's request: "${brief.enquiry}"` : null, "First contact by WhatsApp (Harvey)."].filter(Boolean).join(" "),
    status: "new",
    client_id: r.id,
    account_id: contaId,
    catalog_service_id: doCatalogo?.id ?? null,
    published_at: null,
  });
  if (error) throw new Error(`lead no OS: ${error.message}`);
  return String(ref);
}
