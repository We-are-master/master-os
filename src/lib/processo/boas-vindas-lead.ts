/**
 * E-mail de boas-vindas ao lead (plano do dono, 22/10/2026, etapa 3).
 *
 * Lead do Checkatrade (ou direto) que chega COM e-mail, na conta Fixfy em v2: além
 * do template de WhatsApp, o cliente recebe um e-mail simples e formal que diz o
 * serviço que ele pediu. Sai como comentário público no ticket do lead
 * (primeiro-contato.ts `abrirTicketDoLead`), para a resposta cair no mesmo ticket.
 *
 * Travas, todas obrigatórias:
 *   1. conta v2 e direct (Fixfy). Fora disso nada muda.
 *   2. janela de envio do Harvey (ajustes.ts `janelaAberta`, padrão 8h às 20h de Londres).
 *   3. o requester do ticket é o próprio cliente (ticket sem e-mail nasce no
 *      team@getfixfy.com: comentário público ali seria e-mail para nós mesmos).
 *   4. reservarEnvio `lead-welcome-email:<leadExterno ou telefone>` ANTES do envio.
 *
 * Lead só com e-mail (sem telefone) já recebe o primeiro contato por e-mail
 * (mandarPrimeiroContatoPorEmail): este não sai em cima dele, porque só é chamado
 * no caminho do WhatsApp.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegrasDoProcesso } from "./conta";
import { emailDeBoasVindasDoLead } from "./textos-lead";

/** A conta Fixfy: é com ela que os leads do Checkatrade e diretos entram. */
export const CONTA_FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
export const TAG_BOAS_VINDAS = "lead_welcome_sent";
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type LeadParaBoasVindas = {
  ticketId: number | null;
  clienteId: string;
  telefone: string | null;
  leadExterno: string | null;
  servico: string;
  nome: string | null;
  /** O e-mail do cliente; sem ele, lido de clients. */
  email?: string | null;
  contaId?: string | null;
  checkatrade?: boolean;
};

export function chaveDasBoasVindas(l: Pick<LeadParaBoasVindas, "leadExterno" | "telefone">): string | null {
  const id = String(l.leadExterno ?? "").trim() || String(l.telefone ?? "").replace(/\D/g, "");
  return id ? `lead-welcome-email:${id}` : null;
}

export function emailDoLeadValido(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return EMAIL_VALIDO.test(e) && !/@getfixfy\.com$/.test(e) ? e : null;
}

export type DecisaoDasBoasVindas = { mandar: true; chave: string; email: string } | { mandar: false; motivo: string };

export function decidirBoasVindas(a: {
  lead: LeadParaBoasVindas;
  regras: Pick<RegrasDoProcesso, "v2" | "tipo"> | null;
  janelaAberta: boolean;
  email: string | null;
  requesterDoTicket: string | null;
}): DecisaoDasBoasVindas {
  if (!(a.regras?.v2 === true && a.regras.tipo === "direct")) return { mandar: false, motivo: "account not on the v2 direct process" };
  if (!a.lead.ticketId) return { mandar: false, motivo: "no lead ticket" };
  const email = emailDoLeadValido(a.email);
  if (!email) return { mandar: false, motivo: "lead has no valid email" };
  if (emailDoLeadValido(a.requesterDoTicket) !== email) return { mandar: false, motivo: "ticket requester is not the customer" };
  if (!a.janelaAberta) return { mandar: false, motivo: "outside sending hours" };
  const chave = chaveDasBoasVindas(a.lead);
  if (!chave) return { mandar: false, motivo: "no lead id or phone for the dedupe key" };
  return { mandar: true, chave, email };
}

export type DependenciasDasBoasVindas = {
  regras: (contaId: string) => Promise<RegrasDoProcesso | null>;
  janelaAberta: (agora: Date) => Promise<boolean>;
  emailDoCliente: (clienteId: string) => Promise<string | null>;
  requesterDoTicket: (ticketId: number) => Promise<string | null>;
  reservar: (chave: string, l: LeadParaBoasVindas, email: string) => Promise<{ reservado: boolean; motivo?: string }>;
  confirmar: (chave: string) => Promise<void>;
  falhou: (chave: string, erro: unknown) => Promise<void>;
  comentar: (ticketId: number, html: string) => Promise<void>;
};

export type ResultadoDasBoasVindas = { enviado: boolean; motivo: string };

/** Nunca lança: o template de WhatsApp já saiu e é o que importa. */
export async function mandarBoasVindasDoLead(
  lead: LeadParaBoasVindas,
  deps: DependenciasDasBoasVindas,
  agora: Date = new Date(),
): Promise<ResultadoDasBoasVindas> {
  let reserva: string | null = null;
  try {
    const regras = await deps.regras(lead.contaId ?? CONTA_FIXFY);
    // Sem v2 sai antes de qualquer leitura: produção igual a antes.
    if (!(regras?.v2 === true && regras.tipo === "direct")) return { enviado: false, motivo: "account not on the v2 direct process" };
    const email = lead.email !== undefined ? lead.email : await deps.emailDoCliente(lead.clienteId);
    const d = decidirBoasVindas({
      lead,
      regras,
      janelaAberta: await deps.janelaAberta(agora),
      email,
      requesterDoTicket: lead.ticketId ? await deps.requesterDoTicket(lead.ticketId) : null,
    });
    if (!d.mandar) return { enviado: false, motivo: d.motivo };
    const r = await deps.reservar(d.chave, lead, d.email);
    if (!r.reservado) return { enviado: false, motivo: r.motivo ?? "already sent" };
    reserva = d.chave;
    const { html } = emailDeBoasVindasDoLead({ nome: lead.nome, servico: lead.servico, checkatrade: lead.checkatrade ?? Boolean(lead.leadExterno) });
    await deps.comentar(lead.ticketId!, html);
    await deps.confirmar(d.chave);
    return { enviado: true, motivo: `welcome email sent to ${d.email}` };
  } catch (e) {
    if (reserva) await deps.falhou(reserva, e).catch(() => undefined);
    return { enviado: false, motivo: e instanceof Error ? e.message.slice(0, 200) : "failed" };
  }
}

/** As dependências de verdade (Supabase, Zendesk, ajustes do Harvey). */
export function dependenciasDasBoasVindas(sb: SupabaseClient): DependenciasDasBoasVindas {
  return {
    regras: async (contaId) => (await import("./conta")).processoDaConta(sb, contaId),
    janelaAberta: async (agora) => {
      const { ajustesDoHarvey, janelaAberta } = await import("@/lib/harvey-wa/ajustes");
      return janelaAberta(await ajustesDoHarvey(), agora);
    },
    emailDoCliente: async (clienteId) => {
      const { data } = await sb.from("clients").select("email").eq("id", clienteId).maybeSingle();
      return ((data as { email?: string | null } | null)?.email ?? null) || null;
    },
    requesterDoTicket: async (ticketId) => {
      const { zendeskApi } = await import("@/lib/zendesk");
      const r = await zendeskApi<{ ticket?: { requester_id?: number }; users?: Array<{ id: number; email?: string | null }> }>(`tickets/${ticketId}.json?include=users`);
      return r.users?.find((u) => u.id === r.ticket?.requester_id)?.email ?? null;
    },
    reservar: async (chave, l, email) => {
      const { reservarEnvio } = await import("@/lib/idempotencia/envio");
      return reservarEnvio(sb, { chave, finalidade: "lead-welcome-email", canal: "email", ticketId: l.ticketId, destinatario: email, template: "lead_welcome_v1", motivo: "new lead" });
    },
    confirmar: async (chave) => (await import("@/lib/idempotencia/envio")).confirmarEnvio(sb, chave),
    falhou: async (chave, erro) => (await import("@/lib/idempotencia/envio")).falhouEnvio(sb, chave, erro),
    comentar: async (ticketId, html) => {
      const { updateTicket } = await import("@/lib/zendesk");
      const { autorDoAviso } = await import("@/lib/zendesk-quoter/aviso-de-cotacao");
      await updateTicket({ ticketId, htmlBody: html, publicComment: true, authorId: await autorDoAviso(), additionalTags: [TAG_BOAS_VINDAS] });
    },
  };
}
