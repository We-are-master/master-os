/**
 * Fontes que alimentam o funil do CRM (fase 5): reserva abandonada do site,
 * primeiro contato do Harvey e o lead criado à mão. Só regra pura aqui.
 */
import type { LeadSegment } from "@/types/database";
import { limparScope, semPreco } from "@/lib/scope-limpo";

/** Conta direct (ou sem conta) é B2C; qualquer outro processo é B2B. */
export function segmentoPeloProcesso(processType: string | null | undefined): LeadSegment {
  const p = String(processType ?? "").trim();
  return p && p !== "direct" ? "b2b" : "b2c";
}

/** Linha da reserva abandonada que interessa ao lead (site_leads, mig 294/302). */
export type SiteLeadParaCrm = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  postcode: string | null;
  client_id: string | null;
  service_label: string | null;
  zendesk_ticket_id: number | string | null;
};

/** O scope que o lead herda da reserva: o serviço escolhido, nunca o preço. */
export function escopoDoSiteLead(serviceLabel: string | null | undefined): string {
  const servico = semPreco(String(serviceLabel ?? "").replace(/\s+/g, " ").trim()).trim();
  const linhas = [servico ? `${servico.replace(/[.\s]+$/, "")}.` : null, "Started a booking on the website and replied to our follow-up."];
  return limparScope(linhas.filter(Boolean).join("\n")) ?? "";
}

/**
 * O lead do CRM que nasce quando o cliente da reserva abandonada responde
 * (decisão do dono: antes da resposta, não). Sem reference: quem grava pede
 * o próximo número. `ticketId`: quem chama escolhe (o do lead do site, senão o da resposta).
 */
export function leadDoSiteLead(l: SiteLeadParaCrm, ticketId: number | string | null): Record<string, unknown> {
  const ticket = String(ticketId ?? l.zendesk_ticket_id ?? "").trim();
  const postcode = String(l.postcode ?? "").trim().toUpperCase() || null;
  const email = String(l.email ?? "").trim().toLowerCase();
  const nome = String(l.full_name ?? "").trim() || email.split("@")[0] || "Website customer";
  return {
    name: nome,
    email: email || null,
    phone: String(l.phone ?? "").trim() || null,
    address: postcode ? `London, ${postcode}` : "London",
    city: "London",
    postcode,
    urgency: "medium",
    scope: escopoDoSiteLead(l.service_label),
    status: "interested",
    stage: "new",
    segment: "b2c",
    source: "website",
    client_id: l.client_id ?? null,
    external_source: /^\d+$/.test(ticket) ? "zendesk" : null,
    external_ref: /^\d+$/.test(ticket) ? ticket : null,
    next_action: "Reply to the customer",
    next_action_at: new Date().toISOString(),
    published_at: null,
  };
}

/** A quote que entra no CRM sem lead (Harvey, Zendesk, OS): o que interessa dela. */
export type QuoteParaCrm = {
  id: string;
  reference: string | null;
  title: string | null;
  status: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  property_address: string | null;
  postcode: string | null;
  scope: string | null;
  catalog_service_id: string | null;
  source_account_id: string | null;
  external_source: string | null;
  external_ref: string | null;
};

/** Quote recusada ou apagada não abre card novo: o card só nasce de quote viva. */
export function quoteAbreLead(status: string | null | undefined): boolean {
  return !!status && status !== "rejected";
}

/**
 * O lead que nasce de uma quote sem lead (06/11/2026, dono: toda quote aparece
 * no CRM). Nasce em Quoting; a sincronização pelas quotes leva para Quoted ou
 * Won logo depois. Fica nosso: nunca publicado aos parceiros.
 */
export function leadDaQuote(q: QuoteParaCrm, segment: LeadSegment): Record<string, unknown> {
  const ticket = q.external_source === "zendesk" ? String(q.external_ref ?? "").trim() : "";
  const postcode = String(q.postcode ?? "").trim().toUpperCase() || null;
  const email = String(q.client_email ?? "").trim().toLowerCase();
  const nome = String(q.client_name ?? "").trim() || email.split("@")[0] || "Customer";
  const endereco = String(q.property_address ?? "").trim() || (postcode ? `London, ${postcode}` : "London");
  const titulo = semPreco(String(q.title ?? "").replace(/\s+/g, " ").trim()).trim();
  const scope = limparScope(String(q.scope ?? "").trim() || (titulo ? `${titulo.replace(/[.\s]+$/, "")}.` : "")) ?? "";
  return {
    name: nome,
    email: email || null,
    address: endereco,
    city: "London",
    postcode,
    urgency: "medium",
    scope,
    status: "new",
    stage: "quoting",
    segment,
    client_id: q.client_id ?? null,
    account_id: q.source_account_id ?? null,
    catalog_service_id: q.catalog_service_id ?? null,
    external_source: /^\d+$/.test(ticket) ? "zendesk" : null,
    external_ref: /^\d+$/.test(ticket) ? ticket : null,
    published_at: null,
  };
}
