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
    stage: "talking",
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
