/**
 * Quote em Bidding sem lance: a mesma régua para todo mundo (dono, 23/10/2026).
 * Housekeep, lead do WhatsApp, lead por e-mail, conta B2B: tanto faz.
 *
 *   24h sem lance desde o primeiro convite: 🔎 No Bids + Action Required, uma vez.
 *   48h sem lance e sem ninguém agir: o cliente recebe o "not able to quote" e a
 *   quote fecha (rejected).
 *
 * "Agir" é a equipe responder à mão no ticket (resposta pública depois do primeiro
 * convite) ou convidar mais parceiros: as 48h contam do ÚLTIMO convite, então
 * alargar a busca dá às pessoas o tempo de responder. Conta que é só com gente
 * (B2B humano) não recebe nada sozinha: no lugar do envio, Action Required.
 *
 * Substitui o 8h/36h-48h da Housekeep, o aviso de 26h das outras quotes e o
 * "still checking" de 24h da cotação automática do WhatsApp.
 *
 * As decisões são puras; o envio recebe as dependências para dar para testar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

export const HORAS_ATE_NO_BIDS = 24;
export const HORAS_ATE_FECHAR = 48;

/** Marcas em quotes.automation_status. A de 24h é a que o espelho lê para 🔎 No Bids. */
export const MARCA_NO_BIDS = "no_bids_reported";
export const MARCA_FECHADA_SEM_LANCE = "no_bids_closed";
export const MARCA_EQUIPE_AGIU = "no_bids_team_acted";
export const MARCA_PRECISA_DE_GENTE = "no_bids_needs_person";
export const MARCA_TICKET_FECHADO = "no_bids_ticket_closed";
/** Marcas antigas da Housekeep (até 23/10/2026): a de 8h volta para a régua, as finais continuam finais. */
const MARCA_HK_8H_ANTIGA = "housekeep_no_bid_8h";
const MARCAS_FINAIS = new Set([
  MARCA_FECHADA_SEM_LANCE, MARCA_EQUIPE_AGIU, MARCA_PRECISA_DE_GENTE, MARCA_TICKET_FECHADO,
  "housekeep_no_availability_sent", "housekeep_team_replied",
]);

export const MOTIVO_SEM_LANCE = `No partner availability: no bid within ${HORAS_ATE_FECHAR}h of the last invite`;

export type PassoSemLance = "nada" | "esperar" | "no_bids" | "fechar";

export function passoSemLance(i: { horasDesdePrimeiroConvite: number; horasDesdeUltimoConvite: number; marca: string | null | undefined }): PassoSemLance {
  const marca = i.marca === MARCA_HK_8H_ANTIGA ? null : i.marca ?? null;
  if (marca && MARCAS_FINAIS.has(marca)) return "nada";
  if (i.horasDesdeUltimoConvite >= HORAS_ATE_FECHAR) return "fechar";
  if (i.horasDesdePrimeiroConvite >= HORAS_ATE_NO_BIDS && marca !== MARCA_NO_BIDS) return "no_bids";
  return "esperar";
}

// ─── O texto (do dono, 23/10/2026) ───────────────────────────────────────────

/** "Hi team" para conta (Housekeep, B2B); o primeiro nome para cliente direto. */
export function saudacaoSemLance(a: { b2b: boolean; primeiroNome?: string | null }): string {
  if (a.b2b) return "Hi team,";
  const nome = a.primeiroNome?.trim();
  return nome ? `Hi ${nome},` : "Hi there,";
}

const CORPO = [
  "Unfortunately we’re not able to quote for this job at the moment. We’d rather tell you now than keep you waiting.",
  "If anything changes we will get back to you.",
];

export function textoSemLanceHtml(saudacao: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [`<p>${esc(saudacao)}</p>`, ...CORPO.map((p) => `<p>${p}</p>`), "<p>Kind regards,<br>Fixfy Team</p>"].join("\n");
}

export function textoSemLancePlano(saudacao: string): string {
  return [saudacao, "", ...CORPO.flatMap((p) => [p, ""]), "Kind regards,", "Fixfy Team"].join("\n");
}

// ─── Por onde falar com o cliente ────────────────────────────────────────────

export type CanalSemLance =
  | { via: "ticket" }
  | { via: "whatsapp" }
  | { via: "email"; para: string }
  | { via: "nenhum"; motivo: string };

/**
 * Ticket de e-mail (Housekeep, lead por e-mail): resposta pública no próprio ticket.
 * Conversa do WhatsApp: texto se a janela de 24h está aberta e o Harvey está na
 * conversa; senão e-mail do cliente, se houver. Template de WhatsApp não cabe aqui
 * (WhatsApp só em 3 momentos), então sem janela e sem e-mail fica com a equipe.
 */
export function canalSemLance(a: {
  daConversa: boolean;
  janelaAberta: boolean;
  harveyNaConversa: boolean;
  emailDoCliente: string | null | undefined;
}): CanalSemLance {
  if (!a.daConversa) return { via: "ticket" };
  if (a.janelaAberta && a.harveyNaConversa) return { via: "whatsapp" };
  const email = a.emailDoCliente?.trim();
  if (email && email.includes("@") && !/@getfixfy\.com$/i.test(email)) return { via: "email", para: email };
  return { via: "nenhum", motivo: "WhatsApp window closed and no customer email" };
}

// ─── Fechar a quote ──────────────────────────────────────────────────────────

export type QuoteSemLance = { id: string; reference: string; external_ref: string };

export type DependenciasDoFechamento = {
  /** Manda o texto pelo canal escolhido; devolve onde saiu (ex.: "zendesk:777"). */
  enviar: (ticketId: number) => Promise<string>;
  canal: "email" | "whatsapp";
  destinatario?: string | null;
  /** Status do ticket acompanha a quote (best-effort). */
  sincronizarStatus?: (quoteId: string) => Promise<unknown>;
};

export type ResultadoDoFechamento = { enviado: boolean; linha: string };

/** Manda o "not able to quote" uma vez e fecha a quote. */
export async function fecharQuoteSemLance(sb: SupabaseClient, q: QuoteSemLance, deps: DependenciasDoFechamento): Promise<ResultadoDoFechamento> {
  const ticketId = Number(q.external_ref);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return { enviado: false, linha: "no ticket on the quote" };
  const chave = chaveDeEnvio("quote-sem-lance", q.id);
  const reserva = await reservarEnvio(sb, {
    chave,
    finalidade: "quote-sem-lance",
    canal: deps.canal,
    quoteId: q.id,
    ticketId,
    destinatario: deps.destinatario ?? null,
    template: "quote_no_bids_48h",
    motivo: MOTIVO_SEM_LANCE,
  });
  if (!reserva.reservado) return { enviado: false, linha: `not sent: ${reserva.motivo ?? "already reserved"}` };
  try {
    const onde = await deps.enviar(ticketId);
    await confirmarEnvio(sb, chave, onde);
  } catch (e) {
    await falhouEnvio(sb, chave, e).catch(() => undefined);
    return { enviado: false, linha: `send failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
  const { error } = await sb
    .from("quotes")
    .update({
      status: "rejected",
      rejection_reason: MOTIVO_SEM_LANCE,
      automation_status: MARCA_FECHADA_SEM_LANCE,
      bidding_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", q.id);
  if (error) return { enviado: true, linha: `sent, but the quote did not close: ${error.message}` };
  if (deps.sincronizarStatus) await deps.sincronizarStatus(q.id).catch(() => undefined);
  return { enviado: true, linha: "not-able-to-quote sent, quote closed" };
}
