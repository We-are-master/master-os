/**
 * Confirmação de booking da Housekeep no v2 (plano do dono, 22/10/2026).
 *
 * A Housekeep pede a cotação num e-mail e confirma noutro: dois tickets. O job
 * da confirmação liga na quote aberta do MESMO endereço (postcode prova; a rua
 * desempata), de até 30 dias, mesmo em outro ticket. Quando essa quote já tem
 * parceiro escolhido e a data do booking é uma das que ele ofereceu, o job nasce
 * com ele, Scheduled. Senão, Unassigned como sempre, com o motivo na nota.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTA_HOUSEKEEP } from "./plataformas";

export const DIAS_DA_QUOTE_DO_BOOKING = 30;
const ABERTAS = ["draft", "in_survey", "bidding", "quote_ready", "awaiting_customer", "awaiting_payment"];
/** Status em que o parceiro da quote já foi escolhido (lance aprovado ou o melhor lance gravado). */
const COM_PARCEIRO_ESCOLHIDO = new Set(["quote_ready", "awaiting_customer", "awaiting_payment"]);

export type QuoteDoBooking = {
  id: string;
  reference: string;
  status: string;
  postcode: string | null;
  property_address: string | null;
  created_at: string;
  partner_id: string | null;
  partner_name?: string | null;
  partner_cost: number | string | null;
  start_date_option_1: string | null;
  start_date_option_2: string | null;
  external_ref?: string | null;
};

export const postcodeNormalizado = (p: string | null | undefined) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Postcodes do Reino Unido escritos no texto, já normalizados. */
function postcodesDe(texto: string | null | undefined): string[] {
  const achados = String(texto ?? "").toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g) ?? [];
  return achados.map(postcodeNormalizado);
}

/** A primeira linha do endereço sem pontuação ("Flat 2, 14 Park Lane" → "flat 2 14 park lane"). */
function primeiraLinha(e: string | null | undefined): string {
  return String(e ?? "").split(/[,\n]/)[0]!.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function numerosDe(e: string | null | undefined): string[] {
  return primeiraLinha(e).match(/\d+[a-z]?/g) ?? [];
}

/**
 * A quote do booking. Postcode tem de bater; com mais de uma, o número da casa
 * e a primeira linha desempatam; empate que sobra = null (não chuta).
 */
export function escolherQuoteDoBooking(
  quotes: QuoteDoBooking[],
  b: { postcode: string | null; endereco: string | null; agora?: Date },
): QuoteDoBooking | null {
  const pc = postcodeNormalizado(b.postcode) || postcodesDe(b.endereco)[0] || "";
  if (!pc) return null;
  const agora = (b.agora ?? new Date()).getTime();
  const limite = agora - DIAS_DA_QUOTE_DO_BOOKING * 864e5;
  const doPostcode = quotes.filter((q) => {
    if (!ABERTAS.includes(q.status)) return false;
    const criada = Date.parse(q.created_at);
    if (!Number.isFinite(criada) || criada < limite) return false;
    const daQuote = [postcodeNormalizado(q.postcode), ...postcodesDe(q.property_address)].filter(Boolean);
    return daQuote.includes(pc);
  });
  if (doPostcode.length <= 1) return doPostcode[0] ?? null;

  const numeros = numerosDe(b.endereco);
  const linha = primeiraLinha(b.endereco);
  const pontos = (q: QuoteDoBooking) => {
    const nq = numerosDe(q.property_address);
    const mesmoNumero = numeros.length > 0 && numeros.every((n) => nq.includes(n)) ? 2 : 0;
    const mesmaLinha = linha && primeiraLinha(q.property_address) === linha ? 1 : 0;
    return mesmoNumero + mesmaLinha;
  };
  const ordenadas = [...doPostcode].sort((a, b2) => pontos(b2) - pontos(a) || Date.parse(b2.created_at) - Date.parse(a.created_at));
  const melhor = ordenadas[0]!;
  const segundo = ordenadas[1]!;
  if (pontos(melhor) === 0 || pontos(melhor) === pontos(segundo)) return null;
  return melhor;
}

export type PlanoDoJob = {
  quoteId: string | null;
  partnerId: string | null;
  partnerCost: number | null;
  status: "scheduled" | "unassigned";
  notas: string[];
};

/**
 * Com quem e em que estado o job nasce.
 *
 * Parceiro só entra quando: a quote tem parceiro escolhido, custo, a data do
 * booking é uma das datas que ele ofereceu, e a janela de chegada veio do card
 * (não o 09:00 de último recurso). Faltou qualquer uma: Unassigned, com o motivo.
 */
export function planoDoJobDoBooking(
  quote: QuoteDoBooking | null,
  b: { dataDoBooking: string | null; janelaDoCard: boolean },
): PlanoDoJob {
  if (!quote) return { quoteId: null, partnerId: null, partnerCost: null, status: "unassigned", notas: ["No open Housekeep quote for this address in the last 30 days."] };
  const base = { quoteId: quote.id, partnerId: null, partnerCost: null, status: "unassigned" as const };
  const ref = quote.reference;
  if (!quote.partner_id || !COM_PARCEIRO_ESCOLHIDO.has(quote.status)) {
    return { ...base, notas: [`Linked to ${ref}: no partner chosen on it yet, so the job is Unassigned.`] };
  }
  const custo = Number(quote.partner_cost);
  const datas = [quote.start_date_option_1, quote.start_date_option_2].map((d) => String(d ?? "").slice(0, 10)).filter(Boolean);
  const dia = String(b.dataDoBooking ?? "").slice(0, 10);
  const faltas: string[] = [];
  if (!dia) faltas.push("booked date");
  else if (!datas.includes(dia)) faltas.push(datas.length ? `booked date ${dia} is not one the partner offered (${datas.join(", ")})` : "the partner offered no date on the quote");
  if (!b.janelaDoCard) faltas.push("arrival window (not on the booking card)");
  if (!(custo > 0)) faltas.push("partner cost on the quote");
  if (faltas.length) {
    return { ...base, notas: [`Linked to ${ref}, but left Unassigned. Missing: ${faltas.join("; ")}.`] };
  }
  return {
    quoteId: quote.id,
    partnerId: quote.partner_id,
    partnerCost: custo,
    status: "scheduled",
    notas: [`Linked to ${ref}: created with ${quote.partner_name?.trim() || "the quote's partner"} on ${dia} (Scheduled).`],
  };
}

/** As quotes abertas da Housekeep dos últimos 30 dias. */
export async function quotesAbertasDaHousekeep(sb: SupabaseClient, agora = new Date()): Promise<QuoteDoBooking[]> {
  const desde = new Date(agora.getTime() - DIAS_DA_QUOTE_DO_BOOKING * 864e5).toISOString();
  const { data, error } = await sb
    .from("quotes")
    .select("id, reference, status, postcode, property_address, created_at, partner_id, partner_name, partner_cost, start_date_option_1, start_date_option_2, external_ref")
    .eq("source_account_id", CONTA_HOUSEKEEP)
    .in("status", ABERTAS)
    .is("deleted_at", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteDoBooking[];
}
