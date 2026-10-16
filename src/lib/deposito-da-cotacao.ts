import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Entrada da cotação pela conta (16/10/2026).
 *
 * Regra do dono: cotação aceita abre o pagamento da entrada na hora. A conta diz
 * quanto (`accounts.quote_deposit_percent`): 50% para todo mundo, 0 para quem paga
 * na fatura (Housekeep, Express). Cliente direto, sem conta, é 50%.
 *
 * Só preenche quando a cotação está sem entrada: se quem montou a cotação pôs um
 * valor, ele vale. Hoje as cotações saíam todas com 0 e o aceite nunca pedia nada.
 */

export const ENTRADA_PADRAO_PCT = 50;

export type EntradaDaCotacao = { deposit_percent: number; deposit_required: number };

/** Entrada a gravar na cotação, ou null para deixar como está. */
export function entradaPelaConta(args: {
  total: number;
  entradaAtual: number;
  /** Percentual da conta; null = cliente sem conta (padrão de 50%). */
  percentualDaConta: number | null;
}): EntradaDaCotacao | null {
  const total = Math.round((Number(args.total) || 0) * 100) / 100;
  if (total <= 0.01) return null;
  if ((Number(args.entradaAtual) || 0) > 0.01) return null;
  const pct = Math.min(100, Math.max(0, Math.round(args.percentualDaConta ?? ENTRADA_PADRAO_PCT)));
  if (pct <= 0) return null;
  return { deposit_percent: pct, deposit_required: Math.round(total * pct) / 100 };
}

/**
 * Percentual da conta. Null = cliente sem conta. Se a coluna ainda não existe
 * (migration 336 não aplicada), devolve `undefined`: aí nada muda, para não cobrar
 * entrada de conta que paga na fatura.
 */
export async function percentualDeEntradaDaConta(
  supabase: SupabaseClient,
  accountId: string | null | undefined,
): Promise<number | null | undefined> {
  const id = String(accountId ?? "").trim();
  if (!id) return null;
  const { data, error } = await supabase.from("accounts").select("quote_deposit_percent").eq("id", id).maybeSingle();
  if (error) {
    console.warn("[entrada-da-cotacao] sem quote_deposit_percent (migration 336?):", error.message);
    return undefined;
  }
  const v = (data as { quote_deposit_percent?: number | null } | null)?.quote_deposit_percent;
  return v == null ? ENTRADA_PADRAO_PCT : Number(v);
}

/** Aplica e grava a entrada da conta na cotação, quando ela está sem entrada. */
export async function aplicarEntradaDaConta(
  supabase: SupabaseClient,
  quote: { id: string; total_value?: number | null; deposit_required?: number | null },
  accountId: string | null | undefined,
): Promise<EntradaDaCotacao | null> {
  const pct = await percentualDeEntradaDaConta(supabase, accountId);
  if (pct === undefined) return null;
  const entrada = entradaPelaConta({
    total: Number(quote.total_value ?? 0),
    entradaAtual: Number(quote.deposit_required ?? 0),
    percentualDaConta: pct,
  });
  if (!entrada) return null;
  const { error } = await supabase.from("quotes").update(entrada).eq("id", quote.id);
  if (error) {
    console.error("[entrada-da-cotacao] gravar entrada", quote.id, error.message);
    return null;
  }
  return entrada;
}
