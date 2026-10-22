/**
 * A conta (e o processo) de uma quote: quotes.source_account_id, senão a conta
 * de origem do cliente. Mesma regra de `contaDoJob`, para os fluxos da etapa 3.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { processoDaConta, processosV2Ligado, type RegrasDoProcesso } from "@/lib/processo/conta";

export type QuoteComConta = { source_account_id?: string | null; client_id?: string | null };

export async function contaDaQuote(sb: SupabaseClient, q: QuoteComConta): Promise<string | null> {
  if (q.source_account_id) return q.source_account_id;
  if (!q.client_id) return null;
  const { data } = await sb.from("clients").select("source_account_id").eq("id", q.client_id).maybeSingle<{ source_account_id: string | null }>();
  return data?.source_account_id ?? null;
}

/** As regras da conta da quote. Sem PROCESSOS_V2=on nem lê o banco: devolve null (comportamento de antes). */
export async function processoDaQuoteV2(sb: SupabaseClient, q: QuoteComConta): Promise<RegrasDoProcesso | null> {
  if (!processosV2Ligado()) return null;
  const conta = await contaDaQuote(sb, q);
  const regras = await processoDaConta(sb, conta);
  return regras?.v2 ? regras : null;
}
