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

import { zendeskApi, isZendeskConfigured } from "@/lib/zendesk";
import { syncPartnerToZendesk } from "@/lib/zendesk-partner-sync";
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

/** O ticket aberto da conversa de WhatsApp dessa pessoa. */
async function ticketDaConversa(userId: number): Promise<number | null> {
  const r = await zendeskApi<{ results: Array<{ id: number }> }>(
    `search.json?query=${encodeURIComponent(`type:ticket via:whatsapp requester:${userId} status<solved`)}&sort_by=created_at&sort_order=desc`,
  );
  return r.results?.[0]?.id ?? null;
}

export type DadosDoCliente = { nome?: string | null; email?: string | null; endereco?: string | null; postcode?: string | null; osId?: string | null };

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
  if (ticket) await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags: ["customer", "harvey-wa"] } });
  return `cliente: usuário ${u.id} na org Fixfy Customers${ticket ? `, ticket ${ticket}` : ""}`;
}
