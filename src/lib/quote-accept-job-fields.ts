import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Campos que o job ganha no aceite da cotação (15/10/2026).
 *
 * Antes o job nascia "scheduled" sem data e com o nome do parceiro vazio quando a
 * cotação guardava só o `partner_id` (achado no teste lead → job, JOB-9733).
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje em Londres, YYYY-MM-DD. */
function hojeLondres(agora: Date): string {
  return agora.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/**
 * Data do job: a primeira data proposta pelo parceiro no lance que ainda não passou,
 * depois a segunda. Só o dia; a janela de chegada o escritório combina depois.
 */
export function dataDoJobNoAceite(
  quote: { start_date_option_1?: string | null; start_date_option_2?: string | null },
  agora: Date = new Date(),
): string | null {
  const hoje = hojeLondres(agora);
  for (const bruto of [quote.start_date_option_1, quote.start_date_option_2]) {
    const d = String(bruto ?? "").trim().slice(0, 10);
    if (YMD.test(d) && d >= hoje) return d;
  }
  return null;
}

/** Nome do parceiro: o da cotação, senão o do cadastro (empresa, depois contato). */
export async function nomeDoParceiroNoAceite(
  supabase: SupabaseClient,
  quote: { partner_id?: string | null; partner_name?: string | null },
): Promise<string | null> {
  const doQuote = String(quote.partner_name ?? "").trim();
  if (doQuote) return doQuote;
  const id = String(quote.partner_id ?? "").trim();
  if (!id) return null;
  const { data } = await supabase.from("partners").select("company_name, contact_name").eq("id", id).maybeSingle();
  const p = data as { company_name?: string | null; contact_name?: string | null } | null;
  return p?.company_name?.trim() || p?.contact_name?.trim() || null;
}
