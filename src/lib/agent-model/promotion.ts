/**
 * Leitura tolerante de `jobs.promotion_amount` (migration 313).
 *
 * Quem seleciona colunas explícitas não pode pedir `promotion_amount` direto:
 * antes da 313 aplicada o PostgREST recusa a consulta inteira e o documento
 * sairia sem job nenhum. Aqui a promoção vem numa consulta separada e, se a
 * coluna ainda não existe, a resposta é "sem promoção" (0), que é exatamente o
 * comportamento de antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

let avisouColunaAusente = false;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Promoção por job (id → £). Job sem promoção ou coluna ausente não aparece. */
export async function loadJobPromotionAmounts(
  supabase: SupabaseClient,
  jobIds: (string | null | undefined)[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(jobIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("jobs").select("id, promotion_amount").in("id", ids);
  if (error) {
    if (!avisouColunaAusente) {
      avisouColunaAusente = true;
      console.warn("[promotion] jobs.promotion_amount unavailable (migration 313 applied?):", error.message);
    }
    return out;
  }
  for (const r of (data ?? []) as { id: string; promotion_amount?: number | string | null }[]) {
    const v = Math.max(0, round2(Number(r.promotion_amount ?? 0)));
    if (v > 0.005) out.set(r.id, v);
  }
  return out;
}

export async function loadJobPromotionAmount(
  supabase: SupabaseClient,
  jobId: string | null | undefined,
): Promise<number> {
  const id = String(jobId ?? "").trim();
  if (!id) return 0;
  return (await loadJobPromotionAmounts(supabase, [id])).get(id) ?? 0;
}

/**
 * Teto do que um link de pagamento pode cobrar de um job com promoção:
 * preço + extras − promoção − o que já foi pago. Nunca negativo.
 */
export function customerBalanceCap(input: {
  clientPrice: number | null | undefined;
  extrasAmount?: number | null;
  promotionAmount: number;
  amountPaid: number;
}): number {
  const total = Number(input.clientPrice ?? 0) + Number(input.extrasAmount ?? 0) - Math.max(0, input.promotionAmount);
  return Math.max(0, round2(total - Math.max(0, Number(input.amountPaid) || 0)));
}
