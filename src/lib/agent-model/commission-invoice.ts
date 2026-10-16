/**
 * As linhas e os totais da fatura de VAT da comissão (Schedule A), como dado puro.
 *
 * Uma fatura por payout statement: uma linha por reserva da plataforma com a
 * comissão (com VAT), e uma linha por Late-Withdrawal Fee. O VAT é do TOTAL:
 * total/6 a 20%, e o líquido é o resto. A Late-Withdrawal Fee entra porque o
 * contrato manda (Partner Agreement 2026-10-06, cláusula 8.3: vale para os
 * dois tipos de reserva e aparece na fatura de VAT da Fixfy).
 */
import { COMMISSION_VAT_RATE_PCT, commissionPercentOfPrice, vatFromInclusive } from "./commission";

export type CommissionInvoiceLine = {
  kind: "commission" | "late_withdrawal_fee";
  reference: string;
  /** Data da reserva (YYYY-MM-DD). */
  date?: string | null;
  description: string;
  /** Valor com VAT incluído. */
  amount: number;
  /** Comissão: porcentagem do preço do profissional (1 casa), mostrada ao lado do valor. */
  percentOfPrice?: number | null;
  /** Comissão: o preço do profissional sobre o qual a porcentagem incide. */
  customerPrice?: number | null;
};

/**
 * O que o documento do parceiro tem de Schedule A (modelo de agente), montado
 * por `renderSelfBillPdfBuffer`. `null` lá = modelo desligado ou folha interna.
 */
export type SelfBillAgentSummary = {
  /** Uma linha por reserva da plataforma (job ou visita). */
  platformLines: {
    reference: string;
    doneOn?: string;
    title: string;
    customerPrice: number;
    commission: number;
    partnerNet: number;
    flagged: boolean;
    shortfall: number;
  }[];
  /** Late-Withdrawal Fees (clawback de cancelamento), valores positivos, com VAT. */
  lateWithdrawalFees: { reference: string; doneOn?: string; amount: number }[];
  hasPlatformBookings: boolean;
  hasClientWork: boolean;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function buildCommissionInvoiceLines(summary: SelfBillAgentSummary | null | undefined): CommissionInvoiceLine[] {
  if (!summary) return [];
  const out: CommissionInvoiceLine[] = [];
  for (const l of summary.platformLines) {
    if (l.commission <= 0.005) continue;
    out.push({
      kind: "commission",
      reference: l.reference,
      date: l.doneOn ?? null,
      description: `Commission for arranging the booking and collecting payment: ${l.title}`.trim(),
      amount: round2(l.commission),
      percentOfPrice: commissionPercentOfPrice(l.commission, l.customerPrice),
      customerPrice: round2(l.customerPrice),
    });
  }
  for (const f of summary.lateWithdrawalFees) {
    if (f.amount <= 0.005) continue;
    out.push({
      kind: "late_withdrawal_fee",
      reference: f.reference,
      date: f.doneOn ?? null,
      description: "Late-Withdrawal Fee (booking cancelled with 24 hours' notice or less, or not attended)",
      amount: round2(f.amount),
    });
  }
  return out;
}

export type CommissionInvoiceTotals = {
  totalIncVat: number;
  vatAmount: number;
  netAmount: number;
  vatRatePct: number;
};

export function commissionInvoiceTotals(lines: CommissionInvoiceLine[]): CommissionInvoiceTotals {
  const total = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const split = vatFromInclusive(total, COMMISSION_VAT_RATE_PCT);
  return { totalIncVat: split.gross, vatAmount: split.vat, netAmount: split.net, vatRatePct: split.ratePct };
}

/** Avisos para o escritório: reservas em que o parceiro recebe mais do que o cliente pagou. */
export function commissionFlagWarnings(summary: SelfBillAgentSummary | null | undefined): string[] {
  if (!summary) return [];
  return summary.platformLines
    .filter((l) => l.flagged)
    .map(
      (l) =>
        `${l.reference}: partner payout £${l.partnerNet.toFixed(2)} is above the customer price £${l.customerPrice.toFixed(2)} ` +
        `(short by £${l.shortfall.toFixed(2)}), so the commission was set to £0.00. Check the job.`,
    );
}
