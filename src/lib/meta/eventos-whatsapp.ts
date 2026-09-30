/**
 * Venda que nasceu num anúncio de WhatsApp volta para a Meta.
 *
 * A primeira mensagem de quem clicou num anúncio de WhatsApp traz o id do
 * clique (`referral.ctwa_clid`); o webhook da Cloud API guarda em
 * `wa_cliques_anuncio`. Depois o OS manda, pela Conversions API, os eventos
 * da conversa com esse id (canal business_messaging), e o Ads Manager passa a
 * mostrar lead e venda por anúncio:
 *
 *   Harvey deu o preço     → LeadSubmitted
 *   Harvey mandou link/banco → InitiateCheckout (valor do job)
 *   sinal pago             → Purchase (valor do job)
 *
 * Só sai evento de quem tem clique de anúncio nos últimos 7 dias. Nunca
 * derruba o fluxo: erro vai para o log e para `meta_eventos_wa`.
 *
 * Variáveis: META_WA_DATASET_ID (o dataset ligado à conta do WhatsApp; padrão
 * Master PX, o mesmo do site), META_CAPI_TOKEN (sem ela, o WHATSAPP_TOKEN do
 * "Conversions API System User", que enxerga o Master PX) e WHATSAPP_WABA_ID.
 * META_TEST_EVENT_CODE manda para "Test events" do Events Manager.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = "https://graph.facebook.com/v23.0";
const MASTER_PX = "1555218078932742";
const JANELA_DO_CLIQUE_DIAS = 7;

export type EventoWa = "LeadSubmitted" | "InitiateCheckout" | "Purchase";

export type CliqueAnuncio = { ctwaClid: string; adId: string | null; headline: string | null; sourceUrl: string | null };

type Referral = { ctwa_clid?: unknown; source_id?: unknown; source_type?: unknown; headline?: unknown; source_url?: unknown };

/** O clique de anúncio que veio numa mensagem do webhook, ou null. */
export function cliqueDaMensagem(m: { referral?: Referral } | null | undefined): CliqueAnuncio | null {
  const r = m?.referral;
  const clid = typeof r?.ctwa_clid === "string" ? r.ctwa_clid.trim() : "";
  if (!clid) return null;
  const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return { ctwaClid: clid, adId: txt(r?.source_id, 64), headline: txt(r?.headline, 200), sourceUrl: txt(r?.source_url, 500) };
}

/** Só os dígitos do telefone, como o WhatsApp manda no `from` (+44 7700 → 447700...). */
export function soDigitos(telefone: string | null | undefined): string {
  return String(telefone ?? "").replace(/\D/g, "");
}

/** O corpo do evento que a Conversions API de conversas pede. */
export function montarEvento(a: {
  evento: EventoWa;
  eventId: string;
  ctwaClid: string;
  wabaId: string;
  valor?: number | null;
  quando?: Date;
}): Record<string, unknown> {
  const comValor = a.evento !== "LeadSubmitted" && Number.isFinite(Number(a.valor)) && Number(a.valor) > 0;
  return {
    event_name: a.evento,
    event_time: Math.floor((a.quando ?? new Date()).getTime() / 1000),
    event_id: a.eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: { whatsapp_business_account_id: a.wabaId, ctwa_clid: a.ctwaClid },
    ...(comValor ? { custom_data: { currency: "GBP", value: Math.round(Number(a.valor) * 100) / 100 } } : {}),
  };
}

/** O event_id de cada evento. A compra usa o mesmo do site (`Purchase-<ref>`), para a Meta contar uma vez só. */
export function idDoEvento(evento: EventoWa, chave: string): string {
  return evento === "Purchase" ? `Purchase-${chave}` : `${evento}-${chave}`;
}

export type ResultadoEvento = "enviado" | "repetido" | "sem clique" | "sem configuração" | "falhou";

/**
 * Manda um evento da conversa desse telefone, se ele veio de anúncio.
 * `chave`: a referência da reserva (checkout/compra) ou o id da conversa (lead).
 */
export async function mandarEventoWhatsApp(
  sb: SupabaseClient,
  a: { telefone: string | null | undefined; evento: EventoWa; chave: string; valor?: number | null; agora?: Date },
  fazerFetch: typeof fetch = fetch,
): Promise<ResultadoEvento> {
  const dataset = process.env.META_WA_DATASET_ID?.trim() || MASTER_PX;
  const token = process.env.META_CAPI_TOKEN?.trim() || process.env.WHATSAPP_TOKEN?.trim();
  const waba = process.env.WHATSAPP_WABA_ID?.trim();
  const phone = soDigitos(a.telefone);
  if (!phone || !a.chave) return "sem clique";

  const agora = a.agora ?? new Date();
  const desde = new Date(agora.getTime() - JANELA_DO_CLIQUE_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: clique } = await sb
    .from("wa_cliques_anuncio")
    .select("ctwa_clid")
    .eq("phone", phone)
    .gte("recebido_em", desde)
    .order("recebido_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!clique?.ctwa_clid) return "sem clique";
  if (!dataset || !token || !waba) {
    console.error(`[meta-wa] ${a.evento} de ${a.chave} não saiu: falta token (META_CAPI_TOKEN/WHATSAPP_TOKEN) ou WHATSAPP_WABA_ID`);
    return "sem configuração";
  }

  const eventId = idDoEvento(a.evento, a.chave);
  // A trava: um evento por (evento, event_id). Quem chegar depois vê o conflito e para.
  const { error: repetido } = await sb
    .from("meta_eventos_wa")
    .insert({ evento: a.evento, event_id: eventId, phone, ctwa_clid: clique.ctwa_clid, valor: a.valor ?? null });
  if (repetido) return "repetido";

  const corpo: Record<string, unknown> = { data: [montarEvento({ evento: a.evento, eventId, ctwaClid: clique.ctwa_clid, wabaId: waba, valor: a.valor, quando: agora })] };
  const teste = process.env.META_TEST_EVENT_CODE?.trim();
  if (teste) corpo.test_event_code = teste;

  try {
    const res = await fazerFetch(`${GRAPH}/${dataset}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const resposta = await res.json().catch(() => ({}));
    await sb.from("meta_eventos_wa").update({ status: res.ok ? "enviado" : "falhou", resposta }).eq("event_id", eventId).eq("evento", a.evento);
    if (!res.ok) console.error(`[meta-wa] ${a.evento} ${eventId} falhou`, res.status, JSON.stringify(resposta).slice(0, 300));
    return res.ok ? "enviado" : "falhou";
  } catch (err) {
    await sb.from("meta_eventos_wa").update({ status: "falhou", resposta: { erro: String(err) } }).eq("event_id", eventId).eq("evento", a.evento);
    console.error(`[meta-wa] ${a.evento} ${eventId} falhou`, err);
    return "falhou";
  }
}
