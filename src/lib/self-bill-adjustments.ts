import type { SelfBillAdjustment, SelfBillAdjustmentKind, SelfBillPayoutBreakdown } from "@/types/database";

/**
 * Ajustes de um self-bill de parceiro: deduções com nome e valor próprios,
 * fora dos jobs (taxa de cancelamento de um job que seguiu com outro parceiro,
 * material cobrado de volta, acerto combinado com o dono).
 *
 * Antes disto, o único jeito de tirar dinheiro de um documento era mexer no
 * `partner_cost` dos jobs (o PDF mostrava o job com valor menor e nenhuma
 * explicação) ou escrever em `commission`, que o recálculo zerava. A lista
 * mora em `self_bills.payout_breakdown.adjustments`: o recálculo soma e
 * grava em `commission`, e o PDF desenha cada linha numa seção separada, com
 * os jobs intactos.
 */

export const SELF_BILL_ADJUSTMENT_KINDS: readonly SelfBillAdjustmentKind[] = ["cancellation_fee", "materials", "other"];

export const SELF_BILL_ADJUSTMENT_KIND_LABEL: Record<SelfBillAdjustmentKind, string> = {
  cancellation_fee: "Cancellation fee",
  materials: "Materials charged back",
  other: "Adjustment",
};

const ORDEM: Record<SelfBillAdjustmentKind, number> = { cancellation_fee: 0, materials: 1, other: 2 };

const round2 = (n: number): number => Math.round(n * 100) / 100;

function isKind(value: unknown): value is SelfBillAdjustmentKind {
  return typeof value === "string" && (SELF_BILL_ADJUSTMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Lê a lista com defesa: entrada sem rótulo ou sem valor positivo não conta.
 * O valor é sempre positivo e significa dedução; a ordem de saída é a do PDF
 * (taxas, depois material, depois o resto), estável dentro de cada tipo.
 */
export function readSelfBillAdjustments(
  breakdown: SelfBillPayoutBreakdown | null | undefined,
): SelfBillAdjustment[] {
  const raw = breakdown?.adjustments;
  if (!Array.isArray(raw)) return [];
  const out: SelfBillAdjustment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Partial<SelfBillAdjustment>;
    const amount = round2(Number(a.amount));
    const label = String(a.label ?? "").trim();
    if (!Number.isFinite(amount) || amount <= 0 || !label) continue;
    out.push({
      ...a,
      kind: isKind(a.kind) ? a.kind : "other",
      label,
      amount,
    });
  }
  return out.sort((x, y) => ORDEM[x.kind] - ORDEM[y.kind]);
}

export function sumSelfBillAdjustments(list: readonly SelfBillAdjustment[]): number {
  return round2(list.reduce((s, a) => s + a.amount, 0));
}

/** O breakdown novo com a lista trocada, preservando o que mais houver nele. */
export function withSelfBillAdjustments(
  breakdown: SelfBillPayoutBreakdown | null | undefined,
  adjustments: readonly SelfBillAdjustment[],
): SelfBillPayoutBreakdown {
  return { ...(breakdown ?? {}), adjustments: adjustments.map((a) => ({ ...a })) };
}
