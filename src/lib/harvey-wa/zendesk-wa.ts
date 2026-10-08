/**
 * Parceiro e cliente separados no Zendesk (dono, 29/09/2026: grupos + orgs).
 *
 * O Zendesk abre um ticket para cada conversa de WhatsApp, com um usuário que
 * tem o telefone. O Harvey acha esse usuário pelo número e:
 *  - parceiro: vai para a org dele (🔧, a mesma do sync do OS), tag `partner`,
 *    e o ticket da conversa cai no grupo "Partners"
 *  - cliente (e gente nova): org "Fixfy Customers", tag `customer`, e o perfil
 *    preenchido com o que o OS sabe (nome, e-mail, endereço, id no OS)
 *
 * Grupo, org e campos de usuário são criados na primeira vez (idempotente).
 */

import { createServiceClient } from "@/lib/supabase/service";
import { zendeskApi, isZendeskConfigured, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { syncPartnerToZendesk } from "@/lib/zendesk-partner-sync";
import { ZD_STATUS_NEW, ZD_STATUS_OPEN, ZD_STATUS_PARTNER, ZD_STATUS_WHATSAPP } from "@/lib/zendesk-statuses";
import type { Identidade } from "./identidade";

const GRUPO_PARCEIROS = "Partners";
const ORG_CLIENTES = { external_id: "fixfy:b2c-customers", name: "Fixfy Customers" };
const CAMPOS_USUARIO = [
  { key: "fixfy_contact_type", title: "Fixfy contact type" },
  { key: "fixfy_os_id", title: "Fixfy OS id" },
  { key: "fixfy_postcode", title: "Postcode" },
];

let cache: { grupo?: number; org?: number; campos?: boolean } = {};

async function grupoDosParceiros(): Promise<number> {
  if (cache.grupo) return cache.grupo;
  const { groups } = await zendeskApi<{ groups: Array<{ id: number; name: string }> }>("groups.json?per_page=100");
  let g = groups.find((x) => x.name.toLowerCase() === GRUPO_PARCEIROS.toLowerCase());
  if (!g) g = (await zendeskApi<{ group: { id: number; name: string } }>("groups.json", { method: "POST", body: { group: { name: GRUPO_PARCEIROS, description: "Partners (tradespeople and cleaners): documents, jobs, payouts." } } })).group;
  return (cache.grupo = g.id);
}

async function orgDosClientes(): Promise<number> {
  if (cache.org) return cache.org;
  const r = await zendeskApi<{ organization: { id: number } }>("organizations/create_or_update.json", {
    method: "POST",
    body: { organization: { ...ORG_CLIENTES, notes: "B2C customers (website, WhatsApp). Filled in by Harvey from the OS." } },
  });
  return (cache.org = r.organization.id);
}

/**
 * A origem do lead sai do assunto e vai para a Organisation: o ticket fica na
 * org "🏢 Checkatrade" (dono, 08/10/2026: "não dividir a org").
 *
 * Cuidado: a org tem o gatilho "Auto-solve Checkatrade noise (mega catch-all)",
 * que RESOLVE todo ticket que NASCE nela. Por isso:
 *  - a pessoa entra na Checkatrade como org EXTRA; a padrão é a Fixfy Customers
 *    (ticket novo dela nasce na padrão e não é auto-resolvido);
 *  - o ticket só vai para a Checkatrade numa atualização, nunca na criação.
 */
const ORG_CHECKATRADE = Number(process.env.ZENDESK_ORG_CHECKATRADE?.trim() || "5700930743967");

async function membro(userId: number, organizationId: number, padrao: boolean): Promise<void> {
  try {
    await zendeskApi("organization_memberships.json", { method: "POST", body: { organization_membership: { user_id: userId, organization_id: organizationId, default: padrao } } });
  } catch (e) {
    // 422 = já é membro.
    if (!String(e).includes("422")) throw e;
  }
}

/** Ticket (que já existe) na org Checkatrade, com a pessoa tendo a Fixfy Customers de padrão. */
export async function ticketNaOrgDeLeads(ticket: number, userId: number): Promise<void> {
  const { user } = await zendeskApi<{ user: { organization_id: number | null; email: string | null } }>(`users/${userId}.json`);
  // Nunca a nossa própria equipe (Fixfy Team é solicitante de lead sem e-mail).
  if (/@getfixfy\.com$/i.test(user?.email ?? "")) return;
  const clientes = await orgDosClientes();
  if (!user?.organization_id || user.organization_id === ORG_CHECKATRADE) {
    await membro(userId, clientes, true);
    await zendeskApi(`users/${userId}.json`, { method: "PUT", body: { user: { organization_id: clientes } } });
  }
  await membro(userId, ORG_CHECKATRADE, false);
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { organization_id: ORG_CHECKATRADE } } });
}

async function camposDeUsuario() {
  if (cache.campos) return;
  const { user_fields } = await zendeskApi<{ user_fields: Array<{ key: string }> }>("user_fields.json");
  const tem = new Set(user_fields.map((f) => f.key));
  for (const c of CAMPOS_USUARIO) {
    if (!tem.has(c.key)) await zendeskApi("user_fields.json", { method: "POST", body: { user_field: { type: "text", key: c.key, title: c.title } } });
  }
  cache.campos = true;
}

type UsuarioZd = { id: number; name: string; email: string | null; tags: string[]; organization_id: number | null };

async function usuarioPeloTelefone(telefone: string): Promise<UsuarioZd | null> {
  const { users } = await zendeskApi<{ users: UsuarioZd[] }>(`users/search.json?query=${encodeURIComponent(telefone)}`);
  return users?.[0] ?? null;
}

/**
 * Status do ticket da conversa: cliente 🟩 WhatsApp (Action Required), parceiro
 * 🟢 Partner. Só troca quando ninguém mexeu ainda (New, Open ou o próprio):
 * ticket que a equipe já passou para Quote, Bidding, Job etc. fica como está.
 */
async function statusDaConversa(ticket: number, alvo: number) {
  const { ticket: t } = await zendeskApi<{ ticket: { custom_status_id: number | null } }>(`tickets/${ticket}.json`);
  const livre = [ZD_STATUS_NEW, ZD_STATUS_OPEN, ZD_STATUS_WHATSAPP, ZD_STATUS_PARTNER, null];
  if (t.custom_status_id !== alvo && livre.includes(t.custom_status_id)) {
    await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { custom_status_id: alvo } } });
  }
}

/** O ticket aberto da conversa de WhatsApp dessa pessoa. */
async function ticketDaConversa(userId: number): Promise<number | null> {
  // Lista da pessoa, não a busca: o índice da busca demora minutos para ver um
  // ticket novo, e o da conversa nasce segundos antes de a gente procurar
  // (ticket do Dan #50964, 08/10/2026, ficou sem o do lead por isso).
  const r = await zendeskApi<{ tickets: Array<{ id: number; status: string; via?: { channel?: string } }> }>(
    `users/${userId}/tickets/requested.json?sort_by=created_at&sort_order=desc&per_page=25`,
  );
  return r.tickets?.find((t) => t.via?.channel === "whatsapp" && !["solved", "closed"].includes(t.status))?.id ?? null;
}

/**
 * Express: o cliente respondeu o template de boas-vindas. O ticket do job (aberto
 * pelo OS quando o Ruben aceitou) entra no ticket do WhatsApp e o job passa a
 * apontar para a conversa, para os avisos do job e a equipe ficarem num lugar só.
 */
export async function juntarTicketDoJob(ticketWa: number, j: { ticketId: number; jobId: string }): Promise<string> {
  if (j.ticketId === ticketWa) return "";
  const { ticket } = await zendeskApi<{ ticket: { status: string; subject: string; requester_id: number } }>(`tickets/${j.ticketId}.json`);
  if (["solved", "closed"].includes(ticket?.status)) return "";
  await herdarDoLead(ticketWa, ticket, ["harvey_wa", "checkatrade_express"], false).catch((e) => console.error("[harvey-wa] herdar do job:", e));
  await zendeskApi(`tickets/${ticketWa}/merge.json`, {
    method: "POST",
    body: {
      ids: [j.ticketId],
      source_comment: `The customer replied on WhatsApp. This job continues in #${ticketWa}.`,
      source_comment_is_public: false,
      target_comment: `Job ticket #${j.ticketId} (Checkatrade Express) merged here. The job now points to this conversation.`,
      target_comment_is_public: false,
    },
  });
  const sb = createServiceClient();
  await sb.from("jobs").update({ external_source: "zendesk", external_ref: String(ticketWa) }).eq("id", j.jobId).eq("external_ref", String(j.ticketId));
  await sb.from("harvey_wa_leads").update({ ticket_id: ticketWa }).eq("job_id", j.jobId);
  return `, job #${j.ticketId} juntado`;
}

/** Um ticket aberto antes da conversa (lead do site) entra no ticket do WhatsApp. */
export async function juntarTicketAntigo(ticketWa: number, ticketId: number): Promise<string> {
  if (ticketId === ticketWa) return "";
  const { ticket } = await zendeskApi<{ ticket: { status: string; subject: string; requester_id: number } }>(`tickets/${ticketId}.json`);
  if (["solved", "closed"].includes(ticket?.status)) return "";
  await herdarDoLead(ticketWa, ticket, ["harvey_wa", "website_lead"]).catch((e) => console.error("[harvey-wa] herdar do site:", e));
  await zendeskApi(`tickets/${ticketWa}/merge.json`, {
    method: "POST",
    body: {
      ids: [ticketId],
      source_comment: `The customer replied on WhatsApp. Everything continues in #${ticketWa}.`,
      source_comment_is_public: false,
      target_comment: `Website booking ticket #${ticketId} merged here (abandoned booking, recovery WhatsApp answered).`,
      target_comment_is_public: false,
    },
  });
  return `, ticket do site #${ticketId} juntado`;
}

export type DadosDoCliente = { nome?: string | null; email?: string | null; endereco?: string | null; postcode?: string | null; osId?: string | null; ticketDoLead?: string | null; ticketDoJob?: { ticketId: number; jobId: string } | null; ticketAntigo?: number | null };

/**
 * Assunto, prioridade, tags e pessoa do ticket anterior (lead do Checkatrade,
 * reserva do site, job do Express) passam para o ticket da conversa: o Zendesk
 * o cria como "Conversation with <nome do WhatsApp>" e ele fica com o assunto
 * padrão (dono, 08/10/2026).
 */
async function herdarDoLead(ticketWa: number, lead: { subject: string; requester_id: number }, tags: string[] = ["harvey_wa_lead", "lead_checkatrade"], juntarPessoa = true): Promise<void> {
  const { ticket: wa } = await zendeskApi<{ ticket: { requester_id: number } }>(`tickets/${ticketWa}.json`);
  await zendeskApi(`tickets/${ticketWa}.json`, { method: "PUT", body: { ticket: { subject: lead.subject, priority: "high" } } });
  // PUT acrescenta (POST substituiria as tags da conversa).
  await zendeskApi(`tickets/${ticketWa}/tags.json`, { method: "PUT", body: { tags } });
  // Job do Express: o solicitante pode ser a conta (Checkatrade), nunca juntar com o morador.
  if (!juntarPessoa || !wa?.requester_id) return;
  if (tags.includes("lead_checkatrade")) await ticketNaOrgDeLeads(ticketWa, wa.requester_id).catch((e) => console.error("[harvey-wa] org dos leads:", e));
  if (wa.requester_id === lead.requester_id) return;
  const { user: doLead } = await zendeskApi<{ user: { id: number; name: string; email: string | null; role: string } }>(`users/${lead.requester_id}.json`);
  // Lead sem e-mail nasce com a Fixfy Team de solicitante: esse não se junta a ninguém.
  if (!doLead || doLead.role !== "end-user" || /@getfixfy\.com$/i.test(doLead.email ?? "")) return;
  // A pessoa do lead (nome e e-mail do Checkatrade) e a do WhatsApp (telefone) viram uma só.
  await zendeskApi(`users/${doLead.id}/merge.json`, { method: "PUT", body: { user: { id: wa.requester_id } } });
  if (doLead.name) await zendeskApi(`users/${wa.requester_id}.json`, { method: "PUT", body: { user: { name: doLead.name } } });
}

/**
 * O cliente respondeu o template: o ticket do lead (aberto no envio, com a
 * ficha e a nota do template) entra no ticket do WhatsApp. Merge do Zendesk:
 * o do lead fecha e o histórico fica todo na conversa.
 */
export async function juntarTicketDoLead(ticketWa: number, externalId: string): Promise<string> {
  const { tickets } = await zendeskApi<{ tickets: Array<{ id: number; status: string; subject: string; requester_id: number }> }>(`tickets.json?external_id=${encodeURIComponent(externalId)}`);
  const lead = tickets?.find((t) => t.id !== ticketWa && !["solved", "closed"].includes(t.status));
  if (!lead) return "";
  // O ticket da conversa vira o do lead (dono, 08/10/2026: "abre um completamente
  // novo"): o Zendesk sempre cria um ticket para a conversa do WhatsApp, com o nome
  // do perfil do WhatsApp. Ele herda o assunto, a prioridade, as tags e a pessoa do lead.
  await herdarDoLead(ticketWa, lead).catch((e) => console.error("[harvey-wa] herdar do lead:", e));
  await zendeskApi(`tickets/${ticketWa}/merge.json`, {
    method: "POST",
    body: {
      ids: [lead.id],
      source_comment: `The customer replied on WhatsApp. Everything continues in #${ticketWa}.`,
      source_comment_is_public: false,
      target_comment: `Lead ticket #${lead.id} (first contact, template sent) merged here.`,
      target_comment_is_public: false,
    },
  });
  return `, lead #${lead.id} juntado`;
}

/**
 * Arruma a pessoa e o ticket da conversa no Zendesk. Devolve o que fez (para o
 * log); nunca derruba a resposta do Harvey.
 */
export async function classificarNoZendesk(telefone: string | null, quem: Identidade, dados: DadosDoCliente = {}): Promise<string> {
  if (!telefone || !isZendeskConfigured()) return "sem telefone ou Zendesk";
  const u = await usuarioPeloTelefone(telefone);
  if (!u) return "usuário não achado";
  await camposDeUsuario();
  const ticket = await ticketDaConversa(u.id);

  if (quem.tipo === "parceiro") {
    const p = quem.parceiro;
    let org = p.zendesk_organization_id ? Number(p.zendesk_organization_id) : null;
    if (!org) org = Number((await syncPartnerToZendesk(p.id)).organizationId ?? 0) || null;
    await zendeskApi(`users/${u.id}.json`, {
      method: "PUT",
      body: {
        user: {
          ...(org ? { organization_id: org } : {}),
          tags: [...new Set([...(u.tags ?? []).filter((t) => t !== "customer"), "partner"])],
          user_fields: { fixfy_contact_type: "partner", fixfy_os_id: p.id },
          notes: `Fixfy partner (${p.status}). OS partner id ${p.id}`,
        },
      },
    });
    if (ticket) {
      await zendeskApi(`tickets/${ticket}.json`, {
        method: "PUT",
        body: { ticket: { group_id: await grupoDosParceiros(), ...(org ? { organization_id: org } : {}) } },
      });
      await statusDaConversa(ticket, ZD_STATUS_PARTNER);
      await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags: ["partner", "harvey-wa"] } });
    }
    return `parceiro: usuário ${u.id}${ticket ? `, ticket ${ticket} no grupo Partners` : ""}`;
  }

  const org = await orgDosClientes();
  const c = quem.tipo === "cliente" ? quem.cliente : null;
  const nome = dados.nome || c?.full_name || null;
  const email = (dados.email || c?.email || "").trim().toLowerCase() || null;
  const postcode = dados.postcode || c?.postcode || null;
  const osId = dados.osId || c?.id || null;
  const endereco = dados.endereco || c?.address || null;
  const corpo = {
    organization_id: org,
    tags: [...new Set([...(u.tags ?? []).filter((t) => t !== "partner"), "customer"])],
    user_fields: { fixfy_contact_type: "customer", ...(osId ? { fixfy_os_id: osId } : {}), ...(postcode ? { fixfy_postcode: postcode } : {}) },
    ...(nome ? { name: nome } : {}),
    ...(endereco ? { details: [endereco, postcode].filter(Boolean).join(", ") } : {}),
    ...(osId ? { notes: `Fixfy customer. OS: https://app.getfixfy.com/clients?clientId=${osId}` } : {}),
  };
  // O e-mail pode já ser de outro usuário (quem reservou pelo site): aí fica só o resto.
  try {
    await zendeskApi(`users/${u.id}.json`, { method: "PUT", body: { user: { ...corpo, ...(email && !u.email ? { email } : {}) } } });
  } catch {
    await zendeskApi(`users/${u.id}.json`, { method: "PUT", body: { user: corpo } });
  }
  let juntou = "";
  if (ticket) {
    await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags: ["customer", "harvey-wa"] } });
    await statusDaConversa(ticket, ZD_STATUS_WHATSAPP);
    if (dados.ticketDoLead) juntou = await juntarTicketDoLead(ticket, dados.ticketDoLead).catch((e) => `, merge falhou: ${e instanceof Error ? e.message : e}`);
    if (dados.ticketAntigo) juntou += await juntarTicketAntigo(ticket, dados.ticketAntigo).catch((e) => `, merge do ticket do site falhou: ${e instanceof Error ? e.message : e}`);
    if (dados.ticketDoJob) juntou += await juntarTicketDoJob(ticket, dados.ticketDoJob).catch((e) => `, merge do job falhou: ${e instanceof Error ? e.message : e}`);
  }
  return `cliente: usuário ${u.id} na org Fixfy Customers${ticket ? `, ticket ${ticket}` : ""}${juntou}`;
}

/**
 * Junta no ticket da conversa do WhatsApp o ticket que nasceu antes dela (lead
 * do Checkatrade, reserva do site, job do Express). Roda em TODA mensagem do
 * cliente, pausado ou não: antes só rodava depois de o Harvey responder, e com
 * ele pausado (07/10/2026) cada resposta abria um ticket novo e o do lead ficava
 * sozinho. O ticket da conversa pode demorar uns segundos a aparecer.
 */
export async function juntarTicketsDaConversa(telefone: string, dados: Pick<DadosDoCliente, "ticketDoLead" | "ticketAntigo" | "ticketDoJob">): Promise<string> {
  if (!isZendeskConfigured() || (!dados.ticketDoLead && !dados.ticketAntigo && !dados.ticketDoJob)) return "";
  const u = await usuarioPeloTelefone(telefone);
  if (!u) return "usuário não achado";
  let ticket: number | null = null;
  for (let tentativa = 0; tentativa < 4 && !ticket; tentativa++) {
    ticket = await ticketDaConversa(u.id);
    if (!ticket) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!ticket) return "ticket da conversa não apareceu";
  let juntou = "";
  if (dados.ticketDoLead) juntou += await juntarTicketDoLead(ticket, dados.ticketDoLead).catch((e) => `, merge falhou: ${e instanceof Error ? e.message : e}`);
  if (dados.ticketAntigo) juntou += await juntarTicketAntigo(ticket, dados.ticketAntigo).catch((e) => `, merge do ticket do site falhou: ${e instanceof Error ? e.message : e}`);
  if (dados.ticketDoJob) juntou += await juntarTicketDoJob(ticket, dados.ticketDoJob).catch((e) => `, merge do job falhou: ${e instanceof Error ? e.message : e}`);
  return `ticket ${ticket}${juntou}`;
}

/**
 * Reply status do ticket da conversa (campo do Zendesk, o mesmo dos tickets de
 * e-mail): 🔴 reply_awaiting quando o cliente escreveu por último, 🟢
 * reply_replied quando fomos nós (equipe, Harvey ou template). Os gatilhos do
 * Zendesk não servem aqui: no WhatsApp quem escreve no ticket é o sistema (o
 * bloco do chat transcript), então "role is end_user/agent" nunca casa (dono,
 * 08/10/2026). A tag harvey_wa vai junto: é ela que segura o e-mail de cópia
 * da conversa para o cliente (gatilho "Notify requester and CCs").
 */
export async function marcarReplyStatusNaConversa(telefone: string, valor: "reply_awaiting" | "reply_replied", esperarTicket: boolean): Promise<string> {
  if (!isZendeskConfigured()) return "";
  const u = await usuarioPeloTelefone(telefone);
  if (!u) return "usuário não achado";
  let ticket: number | null = null;
  for (let tentativa = 0; tentativa < (esperarTicket ? 4 : 1) && !ticket; tentativa++) {
    ticket = await ticketDaConversa(u.id);
    if (!ticket && esperarTicket) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!ticket) return "sem ticket";
  const { ticket: t } = await zendeskApi<{ ticket: { tags: string[]; custom_fields: Array<{ id: number; value: unknown }> } }>(`tickets/${ticket}.json`);
  const atual = t.custom_fields.find((f) => f.id === ZENDESK_REPLY_STATUS_FIELD_ID)?.value;
  if (atual !== valor) await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: valor }] } } });
  // PUT acrescenta (POST substituiria as tags da conversa).
  if (!t.tags.includes("harvey_wa")) await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags: ["harvey_wa"] } });
  return `ticket ${ticket}: ${valor}`;
}

/**
 * Conversa que começou direto no WhatsApp (anúncio, cliente que já tinha o
 * número): sem ticket anterior para herdar, o ticket fica "Conversation with
 * <nome>". Na primeira cotação ele ganha o assunto padrão. Só troca o assunto
 * que o Zendesk criou; assunto que alguém já mudou fica.
 */
export async function assuntoPadraoNaConversa(telefone: string | null, a: { origem: string; servico: string; nome: string | null; postcode: string | null }): Promise<string> {
  if (!telefone || !isZendeskConfigured()) return "";
  const u = await usuarioPeloTelefone(telefone);
  if (!u) return "";
  const ticket = await ticketDaConversa(u.id);
  if (!ticket) return "";
  const { ticket: t } = await zendeskApi<{ ticket: { subject: string | null } }>(`tickets/${ticket}.json`);
  if (t?.subject && !/^conversation with/i.test(t.subject.trim())) return "";
  // "Plumber: half day + Gas safety certificate (CP12)" → "Plumber + Gas safety certificate (CP12)".
  const s = a.servico.split(" + ").map((x) => x.split(":")[0].trim()).filter(Boolean).join(" + ");
  const assunto = ["Lead", s.charAt(0).toUpperCase() + s.slice(1), a.nome?.trim() || u.name || "No name", a.postcode?.trim().toUpperCase()].filter(Boolean).join(" · ");
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { subject: assunto } } });
  return `assunto: ${assunto}`;
}

/**
 * Nota interna no ticket da conversa quando o Harvey passa para a equipe: o
 * motivo e tudo que ele já sabe, para ninguém perguntar de novo ao cliente.
 * O ticket pode demorar uns segundos a aparecer depois da passagem.
 */
export async function notaInternaNaConversa(telefone: string | null, texto: string, tags: string[] = ["harvey_passou"]): Promise<string> {
  if (!telefone || !isZendeskConfigured()) return "sem telefone ou Zendesk";
  const u = await usuarioPeloTelefone(telefone);
  if (!u) return "usuário não achado";
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const ticket = await ticketDaConversa(u.id);
    if (ticket) {
      await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false } } } });
      await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags } });
      return `nota no ticket ${ticket}`;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return "ticket não apareceu";
}

/**
 * Pagou o link: nota interna com a reserva. O ticket NÃO fecha: desde 07/10/2026
 * o job pago nasce neste mesmo ticket (o site manda o id como ticket_id).
 */
export async function anotarPagamentoNaConversa(telefone: string | null, texto: string): Promise<string> {
  if (!telefone || !isZendeskConfigured()) return "sem telefone ou Zendesk";
  const u = await usuarioPeloTelefone(telefone);
  const ticket = u ? await ticketDaConversa(u.id) : null;
  if (!ticket) return "ticket não achado";
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false } } } });
  return `nota no ticket ${ticket}`;
}

/** O ticket aberto da conversa de WhatsApp de quem tem esse telefone. */
export async function ticketPeloTelefone(telefone: string | null): Promise<number | null> {
  if (!telefone || !isZendeskConfigured()) return null;
  const u = await usuarioPeloTelefone(telefone);
  return u ? ticketDaConversa(u.id) : null;
}
