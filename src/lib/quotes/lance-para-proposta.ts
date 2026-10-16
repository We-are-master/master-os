/**
 * Lance do parceiro vira proposta ao cliente (Fase 4, dono 09/10/2026).
 *
 * O primeiro lance que chega numa quote em bidding vira o preço de venda com 30% de
 * margem (arredondado para cima de £5), a quote vai para `quote_ready` com uma linha
 * só e a equipe ganha nota no ticket. Com contexto completo (endereço, escopo, fotos,
 * e-mail do cliente) e abaixo do limite, a proposta SAI SOZINHA (atrás de
 * HARVEY_BID_AUTO_SEND=1); senão a equipe confere e manda com um clique.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { appBaseUrl } from "@/lib/app-base-url";
import { insertQuoteLineItemsResilient } from "@/lib/quote-line-items-insert";
import { selectQuoteBidForProposal } from "@/lib/quotes/select-quote-bid-for-proposal";

export const MARGEM_DO_LANCE = 0.3;
export const LIMITE_ENVIO_AUTOMATICO_GBP = () => Number(process.env.HARVEY_BID_AUTO_MAX_GBP?.trim() || "600");

export function precoDeVendaDoLance(custo: number, margem = MARGEM_DO_LANCE): number {
  return Math.ceil(custo / (1 - margem) / 5) * 5;
}

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

export async function prepararPropostaDoLance(sb: SupabaseClient, quoteId: string, bidId: string): Promise<ResultadoDoLance> {
  if (process.env.HARVEY_BID_PROPOSALS?.trim() !== "1") return { feito: false, motivo: "off" };
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
  const venda = precoDeVendaDoLance(custo);
  const { count: linhas } = await sb.from("quote_line_items").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
  const escopo = (quote.scope || quote.description || "").trim();
  const fotos = Array.isArray(quote.images) ? quote.images.length : 0;
  const decisao = decidirEnvioDoLance({
    venda,
    limite: LIMITE_ENVIO_AUTOMATICO_GBP(),
    temEndereco: /\d/.test(quote.property_address ?? "") && /[A-Z]{1,2}\d/i.test(quote.property_address ?? ""),
    temEscopo: escopo.length >= 40,
    temFotos: fotos > 0,
    temEmail: /@/.test(quote.client_email ?? ""),
    jaTinhaParceiro: Boolean(quote.partner_id) || (linhas ?? 0) > 0,
  });

  const quem = bid.partner_name ?? "partner";
  if (decisao.motivos.includes("a bid was already chosen for this quote")) {
    const porque = quote.partner_id ? "A bid was already chosen" : "The quote already has priced lines";
    const nota = `💬 New bid from ${quem}: £${custo.toFixed(2)} on ${quote.reference}. ${porque}, so nothing changed: compare in Quotes.`;
    await notaNoTicket(quote, nota);
    return { feito: true, venda, custo, enviado: false, decisao, nota };
  }

  await selectQuoteBidForProposal(sb, bidId, quoteId);
  await insertQuoteLineItemsResilient(sb, [
    { quote_id: quoteId, description: (quote.title || escopo.split("\n")[0] || "Works as described").slice(0, 300), quantity: 1, unit_price: venda, sort_order: 0, partner_unit_cost: custo, notes: `From ${quem}'s bid` },
  ]);
  await sb
    .from("quotes")
    .update({ total_value: venda, sell_price: venda, margin_percent: Math.round(((venda - custo) / venda) * 1000) / 10, status: "quote_ready", updated_at: new Date().toISOString() })
    .eq("id", quoteId);

  let enviado = false;
  if (decisao.auto && process.env.HARVEY_BID_AUTO_SEND?.trim() === "1") {
    const res = await fetch(`${appBaseUrl()}/api/quotes/send-pdf`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SYNC_SECRET?.trim() ?? "" },
      body: JSON.stringify({ quoteId }),
    }).catch(() => null);
    enviado = Boolean(res?.ok);
  }

  const nota = [
    `💬 Bid from ${quem}: £${custo.toFixed(2)} → proposal £${venda.toFixed(2)} (30% margin) on ${quote.reference}.`,
    enviado
      ? "Context was complete and under the limit: the proposal was SENT to the customer automatically."
      : decisao.auto
        ? "Context is complete and under the limit: ready to send (Quotes → Ready to send)."
        : `Needs the team before sending: ${decisao.motivos.join(", ")}.`,
  ].join("\n");
  await notaNoTicket(quote, nota);
  return { feito: true, venda, custo, enviado, decisao, nota };
}

async function notaNoTicket(quote: QuoteDoLance, nota: string) {
  const ticket = quote.external_source === "zendesk" ? Number(quote.external_ref) : NaN;
  if (!Number.isFinite(ticket) || ticket <= 0) return;
  const { zendeskApi, isZendeskConfigured } = await import("@/lib/zendesk");
  if (!isZendeskConfigured()) return;
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: nota } } } }).catch(() => null);
}
