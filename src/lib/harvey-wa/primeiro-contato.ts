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

import { contaDasNotas, rotuloDaConta } from "@/lib/checkatrade-contas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideDispatch } from "@/lib/agent/sales/dispatch-gate";
import { areaDoTemplate } from "@/lib/agent/sales/dispatch-one";
import { firstName, parseLeadBrief } from "@/lib/agent/sales/lead-brief";
import type { CatalogService } from "@/types/database";
import { chaveDoTelefone } from "./identidade";
import { scApi, scNotificacao } from "./sunshine";
import { zendeskApi, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { emailPessoal, saudacao } from "@/lib/emails/fixfy-shell";
import { servicoCurto } from "@/lib/zendesk-quote-sent";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

let integracaoWhatsApp: string | null = null;

/** O id da integração de WhatsApp do app no Sunshine (o número da Fixfy). */
export async function idDaIntegracaoWhatsApp(): Promise<string> {
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
  // Só libera a reserva se o template não saiu; depois de sair, erro no ticket não reenvia.
  let reservaAberta: string | null = null;
  try {
    if (await jaFalamosComEle(sb, destino)) return { kind: "ja_falamos" };
    // Reserva antes de mandar (22/10/2026): a entrada do Ruben e a rodada das 08:02 podiam
    // passar as duas pelo jaFalamosComEle e mandar o template duas vezes.
    const chaveDoEnvio = chaveDeEnvio("primeiro-contato", chaveDoTelefone(destino), p.leadExterno ?? p.servico);
    const reserva = await reservarEnvio(sb, { chave: chaveDoEnvio, finalidade: "primeiro-contato", canal: "whatsapp", destinatario: destino, template: nomeDoTemplate, motivo: "new lead" });
    if (!reserva.reservado) return { kind: "ja_falamos" };
    reservaAberta = chaveDoEnvio;
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
    await confirmarEnvio(sb, chaveDoEnvio, notificacao);
    reservaAberta = null;
    await sb.from("harvey_wa_leads").upsert(
      { chave: chaveDoTelefone(destino), telefone: destino, cliente_id: p.clienteId, lead_externo: p.leadExterno ?? null, servico: p.servico, notificacao, enviado_em: new Date().toISOString() },
      { onConflict: "chave" },
    );
    // O ticket nasce agora, com o template dentro (como no respond.io); a resposta do cliente junta tudo nele.
    const ticket = await abrirTicketDoLead(sb, p, destino).catch((e) => (console.error("[harvey-wa] ticket do lead", e), null));
    // E-mail de boas-vindas no ticket do lead (só conta v2 direct; processo/boas-vindas-lead.ts).
    if (ticket) {
      await import("@/lib/processo/boas-vindas-lead")
        .then(({ mandarBoasVindasDoLead, dependenciasDasBoasVindas }) =>
          mandarBoasVindasDoLead({ ticketId: ticket, clienteId: p.clienteId, telefone: destino, leadExterno: p.leadExterno ?? null, servico: p.servico, nome: p.nome }, dependenciasDasBoasVindas(sb)),
        )
        .then((bv) => bv.enviado && console.log(`[harvey-wa] boas-vindas #${ticket}: ${bv.motivo}`))
        .catch((e) => console.error("[harvey-wa] boas-vindas", e));
    }
    return { kind: "enviado", notificacao, ticket };
  } catch (e) {
    if (reservaAberta) await falhouEnvio(sb, reservaAberta, e).catch(() => undefined);
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

export type ContatoPorEmail = { clienteId: string; email: string; nome: string; nomeCompleto: string; servico: string; postcode: string | null; leadExterno: string };

export type DecisaoDoLead =
  | { kind: "mandar"; contato: PrimeiroContato }
  /** Sem telefone, com e-mail: o primeiro contato vai por e-mail (dono, 12/10/2026). */
  | { kind: "email"; contato: ContatoPorEmail }
  | { kind: "pular"; motivo: string };

/** Postcode de Londres usado só para decidir o SERVIÇO de quem não informou o seu. */
const POSTCODE_NEUTRO = "EC1V 2NX";
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  let d = decideDispatch(brief, catalogo);
  // Sem postcode não é motivo para perder o lead (dono, 12/10/2026): o template não
  // usa o postcode, e o Harvey pergunta na conversa antes de dar preço.
  let semPostcode = false;
  if (!d.dispatch && d.reason === "sem postcode utilizável") {
    d = decideDispatch({ ...brief, postcode: POSTCODE_NEUTRO }, catalogo);
    semPostcode = true;
  }
  const nome = /^unnamed/i.test(brief.name ?? "") ? "there" : (firstName(brief.name) ?? "there");
  // Sem telefone não há WhatsApp, mas com e-mail o primeiro contato sai por lá.
  if (!d.dispatch && d.reason === "sem telefone utilizável") {
    const email = (brief.email ?? "").trim().toLowerCase();
    if (!EMAIL_VALIDO.test(email) || /@getfixfy\.com$/.test(email)) return { kind: "pular", motivo: d.reason };
    const porEmail = decideDispatch({ ...brief, phone: "07000000000", postcode: (brief.postcode ?? "").trim() || POSTCODE_NEUTRO }, catalogo);
    if (!porEmail.dispatch) return { kind: "pular", motivo: porEmail.reason };
    return { kind: "email", contato: { clienteId: r.id, email, nome, nomeCompleto: brief.name ?? "", servico: porEmail.label, postcode: brief.postcode ?? null, leadExterno: brief.externalId } };
  }
  if (!d.dispatch) return { kind: "pular", motivo: d.reason };
  return {
    kind: "mandar",
    contato: {
      clienteId: r.id,
      telefone: brief.phone!,
      nome,
      servico: d.label,
      area: semPostcode ? "London" : areaDoTemplate(d.postcodeText),
      leadExterno: brief.externalId ?? null,
    },
  };
}

/**
 * O e-mail de primeiro contato (copy 30). Lead desta régua é sempre do Checkatrade
 * (decidirLead só deixa passar quem tem o id do Checkatrade), então a origem
 * entra na frase; lead de outra origem passa `checkatrade: false` e ela some.
 * O assunto é o do cliente: nada de "Lead" nem rótulo interno (handoff 20/10/2026).
 */
export function emailDePrimeiroContato(c: { nome: string; servico: string; checkatrade?: boolean }): { assunto: string; preheader: string; html: string; text: string } {
  const s = servicoCurto(c.servico);
  const origem = c.checkatrade === false ? "" : " through Checkatrade";
  const assunto = `Your ${s ? `${s} ` : ""}enquiry · A few details to get started`;
  const preheader = "Send a few photos so we can help with your quote.";
  const { html, text } = emailPessoal({
    preheader,
    saudacao: saudacao({ tipo: "b2c", primeiroNome: /^there$/i.test(c.nome.trim()) ? "" : c.nome }),
    paragrafos: [
      `Thanks for getting in touch about ${s || "your job"}${origem}. We’d be happy to help.`,
      "Could you reply with a few photos and the property postcode? A short description of what needs doing will help us check the work and prepare your quote.",
      "If you’d rather talk it through, let us know a convenient time to call.",
    ],
    zendesk: true,
  });
  return { assunto, preheader, html, text };
}

/**
 * Primeiro contato por E-MAIL, para o lead do Checkatrade que veio sem telefone.
 *
 * Sai como comentário público de um ticket novo do Zendesk: o cliente recebe o e-mail
 * e a resposta dele cai no mesmo ticket. O external_id do lead é a trava: se o ticket
 * já existe, nada sai de novo. Nunca lança.
 */
export async function mandarPrimeiroContatoPorEmail(c: ContatoPorEmail): Promise<{ kind: "enviado"; ticket: number | null } | { kind: "ja_falamos" } | { kind: "falhou"; motivo: string }> {
  try {
    const externalId = externalIdDoLead(c.leadExterno);
    const { tickets } = await zendeskApi<{ tickets: Array<{ id: number }> }>(`tickets.json?external_id=${encodeURIComponent(externalId)}`);
    if (tickets?.length) return { kind: "ja_falamos" };
    const email = emailDePrimeiroContato({ nome: c.nome, servico: c.servico });
    const r = await zendeskApi<{ ticket: { id: number } }>("tickets.json", {
      method: "POST",
      body: {
        ticket: {
          // O assunto é o e-mail que o cliente recebe: o da copy, não o "Lead · ..." interno.
          subject: email.assunto,
          comment: { html_body: email.html, public: true },
          requester: { name: c.nomeCompleto || "Checkatrade lead", email: c.email },
          priority: "high",
          status: "pending",
          // ai_quote_draft: o Harvey de e-mail não cota em cima; lead_gen segura na view Leads até a resposta.
          tags: ["lead_checkatrade", "lead_gen", "lead_email_sent", "ai_quote_draft"],
          external_id: externalId,
        },
      },
    });
    return { kind: "enviado", ticket: r.ticket?.id ?? null };
  } catch (e) {
    return { kind: "falhou", motivo: e instanceof Error ? e.message.slice(0, 240) : "falhou" };
  }
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
/**
 * "Lead · Handyman work · Nome · Postcode" (dono, 08/10/2026). A origem fica na
 * tag (lead_checkatrade). Não vai para a org 🏢 Checkatrade: ela marca o Contact
 * Type como B2B, um app do Zendesk devolve o ticket para a org padrão em segundos
 * e o gatilho "mega catch-all" resolve sozinho todo ticket que nasce nela.
 */
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
  const conta = contaDasNotas(c?.notes ?? null);
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
    // Em qual conta do Checkatrade responder a este lead (duas contas, 11/10/2026).
    rotuloDaConta(conta),
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
        // lead_gen: fica na view 🎯 Leads até responder; o gatilho "Lead replied" tira a tag
        // e o ticket vai para a Action Required (dono, 08/10/2026).
        tags: ["harvey_wa_lead", "lead_checkatrade", `checkatrade_${conta}`, "lead_wa_sent", "lead_gen", "ai_quote_draft"],
        external_id: externalId,
        // 🟢 Sent: o template já saiu, a vez é do cliente. Vira 🔴 quando ele responde (dono, 08/10/2026).
        custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_replied" }],
      },
    },
  });
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
