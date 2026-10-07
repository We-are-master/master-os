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
import { zendeskApi, isZendeskConfigured } from "@/lib/zendesk";
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
  const r = await zendeskApi<{ results: Array<{ id: number }> }>(
    `search.json?query=${encodeURIComponent(`type:ticket via:whatsapp requester:${userId} status<solved`)}&sort_by=created_at&sort_order=desc`,
  );
  return r.results?.[0]?.id ?? null;
}

/**
 * Express: o cliente respondeu o template de boas-vindas. O ticket do job (aberto
 * pelo OS quando o Ruben aceitou) entra no ticket do WhatsApp e o job passa a
 * apontar para a conversa, para os avisos do job e a equipe ficarem num lugar só.
 */
export async function juntarTicketDoJob(ticketWa: number, j: { ticketId: number; jobId: string }): Promise<string> {
  if (j.ticketId === ticketWa) return "";
  const { ticket } = await zendeskApi<{ ticket: { status: string } }>(`tickets/${j.ticketId}.json`);
  if (["solved", "closed"].includes(ticket?.status)) return "";
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
  const { ticket } = await zendeskApi<{ ticket: { status: string } }>(`tickets/${ticketId}.json`);
  if (["solved", "closed"].includes(ticket?.status)) return "";
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
 * O cliente respondeu o template: o ticket do lead (aberto no envio, com a
 * ficha e a nota do template) entra no ticket do WhatsApp. Merge do Zendesk:
 * o do lead fecha e o histórico fica todo na conversa.
 */
export async function juntarTicketDoLead(ticketWa: number, externalId: string): Promise<string> {
  const { tickets } = await zendeskApi<{ tickets: Array<{ id: number; status: string }> }>(`tickets.json?external_id=${encodeURIComponent(externalId)}`);
  const lead = tickets?.find((t) => t.id !== ticketWa && !["solved", "closed"].includes(t.status));
  if (!lead) return "";
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
 * Nota interna no ticket da conversa quando o Harvey passa para a equipe: o
 * motivo e tudo que ele já sabe, para ninguém perguntar de novo ao cliente.
 * O ticket pode demorar uns segundos a aparecer depois da passagem.
 */
export async function notaInternaNaConversa(telefone: string | null, texto: string): Promise<string> {
  if (!telefone || !isZendeskConfigured()) return "sem telefone ou Zendesk";
  const u = await usuarioPeloTelefone(telefone);
  if (!u) return "usuário não achado";
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const ticket = await ticketDaConversa(u.id);
    if (ticket) {
      await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false } } } });
      await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags: ["harvey_passou"] } });
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
