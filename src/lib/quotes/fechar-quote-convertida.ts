/**
 * A quote virou job: o que ficou aberto nela fecha junto (dono, 23/10/2026).
 *
 * Caso real: QT-2026-1256 (lead do Checkatrade, suporte de bicicleta). Os
 * parceiros cotaram, o cliente reservou a hora de £72 pelo WhatsApp e o JOB-9790
 * nasceu da quote. Ficaram para trás o lance de £275 da WHistyle ainda "submitted",
 * a pendência "Team: review the draft and send the quote" no diário do Harvey e o
 * Action Required no ticket, pedindo para mandar uma quote que já tinha virado job.
 *
 *   - lance enviado de outro parceiro: `rejected` (o do parceiro do job fica);
 *   - pendências do diário com a referência da quote: resolvidas;
 *   - ticket da quote: Action Required No, com a nota do que aconteceu.
 *
 * Melhor esforço: o job já existe, nada aqui derruba quem chamou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { acaoFeita } from "@/lib/fila-de-acao";
import { resolverPendenciasDaQuote } from "@/lib/harvey-wa/diario";

export type LanceDaQuote = { id: string; partner_id: string | null; status: string | null };

/** Os lances que perdem: enviados (submitted) por quem não é o parceiro do job. */
export function lancesParaRecusar(lances: LanceDaQuote[], parceiroDoJob: string | null | undefined): string[] {
  const dono = String(parceiroDoJob ?? "").trim();
  return lances.filter((l) => l.status === "submitted" && (!dono || l.partner_id !== dono)).map((l) => l.id);
}

export type QuoteFechada = { recusados: number; pendencias: number; ticket: string | null };

export async function fecharQuoteConvertida(
  supabase: SupabaseClient,
  a: { quoteId: string; partnerIdDoJob: string | null | undefined; jobReference: string | null | undefined },
): Promise<QuoteFechada> {
  const r: QuoteFechada = { recusados: 0, pendencias: 0, ticket: null };
  try {
    const { data: lances } = await supabase.from("quote_bids").select("id, partner_id, status").eq("quote_id", a.quoteId);
    const ids = lancesParaRecusar((lances ?? []) as LanceDaQuote[], a.partnerIdDoJob);
    if (ids.length) {
      const { error } = await supabase.from("quote_bids").update({ status: "rejected", updated_at: new Date().toISOString() }).in("id", ids);
      if (error) console.error("[fechar-quote] lances:", error.message);
      else r.recusados = ids.length;
    }

    const { data: q } = await supabase.from("quotes").select("reference, external_source, external_ref").eq("id", a.quoteId).maybeSingle();
    const quote = q as { reference?: string | null; external_source?: string | null; external_ref?: string | null } | null;
    if (quote?.reference) r.pendencias = await resolverPendenciasDaQuote(quote.reference, supabase);
    if (quote?.external_source === "zendesk" && quote.external_ref) {
      r.ticket = quote.external_ref;
      await acaoFeita(quote.external_ref, `${quote.reference ?? "The quote"} became ${a.jobReference ?? "a job"}, nothing left to send on the quote`);
    }
  } catch (e) {
    console.error("[fechar-quote]", e instanceof Error ? e.message : e);
  }
  return r;
}
