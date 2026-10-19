/**
 * Lance do parceiro vira proposta ao cliente (Fase 4, dono 09/10/2026).
 *
 * O primeiro lance que chega numa quote em bidding vira o preço de venda com 30% de
 * margem (arredondado para cima de £5), a quote vai para `quote_ready` com uma linha
 * só e a equipe ganha nota no ticket. Com contexto completo (endereço, escopo, fotos,
 * e-mail do cliente) e abaixo do limite, a proposta SAI SOZINHA (atrás de
 * HARVEY_BID_AUTO_SEND=1); senão a equipe confere e manda com um clique.
 */
import { modoDe } from "@/lib/harvey/autonomia";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MARGEM_DO_LANCE, limiteDoEnvioAutomatico, precoDeVendaDoLance } from "@/lib/quotes/preco-do-lance";

export { MARGEM_DO_LANCE, precoDeVendaDoLance };
export const LIMITE_ENVIO_AUTOMATICO_GBP = limiteDoEnvioAutomatico;

export type DecisaoDoLance = { auto: boolean; motivos: string[] };

export function decidirEnvioDoLance(q: {
  venda: number;
  limite: number;
  temEndereco: boolean;
  temEscopo: boolean;
  temFotos: boolean;
  temEmail: boolean;
  jaTinhaParceiro: boolean;
}): DecisaoDoLance {
  const motivos: string[] = [];
  if (q.jaTinhaParceiro) motivos.push("a bid was already chosen for this quote");
  if (!q.temEndereco) motivos.push("no full address");
  if (!q.temEscopo) motivos.push("scope too thin");
  if (!q.temFotos) motivos.push("no photos");
  if (!q.temEmail) motivos.push("no customer email");
  if (q.venda > q.limite) motivos.push(`over £${q.limite} (big quote)`);
  return { auto: motivos.length === 0, motivos };
}

type QuoteDoLance = {
  id: string;
  reference: string;
  status: string;
  title: string | null;
  description: string | null;
  scope: string | null;
  client_email: string | null;
  property_address: string | null;
  images: unknown;
  partner_id: string | null;
  external_source: string | null;
  external_ref: string | null;
};

export type ResultadoDoLance =
  | { feito: false; motivo: string }
  | { feito: true; venda: number; custo: number; enviado: boolean; decisao: DecisaoDoLance; nota: string };

/**
 * Desde 20/10/2026 o lance NÃO vira preço aqui (dono: "um cálculo de preço só"). Antes, o
 * primeiro lance punha a quote em quote_ready na hora e tirava ela da varredura: sem a
 * janela de 2h para os outros parceiros, sem conferir o escopo, sem B2B. Agora quem
 * precifica é a varredura (quote-lances-sweep.ts); aqui só fica a nota do lance novo.
 */
export async function prepararPropostaDoLance(sb: SupabaseClient, quoteId: string, bidId: string): Promise<ResultadoDoLance> {
  if ((await modoDe("lances")) === "off") return { feito: false, motivo: "off" };
  const { data: q } = await sb
    .from("quotes")
    .select("id, reference, status, title, description, scope, client_email, property_address, images, partner_id, external_source, external_ref")
    .eq("id", quoteId)
    .maybeSingle();
  const quote = q as QuoteDoLance | null;
  if (!quote || quote.status !== "bidding") return { feito: false, motivo: "quote not in bidding" };
  const { data: b } = await sb.from("quote_bids").select("id, bid_amount, partner_name, status").eq("id", bidId).maybeSingle();
  const bid = b as { bid_amount: number; partner_name: string | null; status: string } | null;
  if (!bid || bid.status !== "submitted") return { feito: false, motivo: "bid not submitted" };
  const custo = Number(bid.bid_amount) || 0;
  await notaNoTicket(
    quote,
    `💬 New bid from ${bid.partner_name ?? "partner"}: £${custo.toFixed(2)} on ${quote.reference}. Harvey prices the best bid once the bidding window closes.`,
  );
  return { feito: false, motivo: "priced by the bids sweep" };
}

async function notaNoTicket(quote: QuoteDoLance, nota: string) {
  const ticket = quote.external_source === "zendesk" ? Number(quote.external_ref) : NaN;
  if (!Number.isFinite(ticket) || ticket <= 0) return;
  const { zendeskApi, isZendeskConfigured } = await import("@/lib/zendesk");
  if (!isZendeskConfigured()) return;
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: nota } } } }).catch(() => null);
}
