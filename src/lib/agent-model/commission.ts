/**
 * A comissão da Fixfy numa reserva da plataforma (Schedule A) e o VAT dela.
 *
 * No modelo de agente a receita da Fixfy é só a comissão, e ela INCLUI VAT
 * (Commission Schedule 2026-10-06). O parceiro recebe o preço menos a
 * comissão. No OS isso já está gravado de outro jeito: o preço que o cliente
 * paga é `client_price + extras_amount`, e o que o parceiro recebe é
 * `partner_cost + materials_cost` (a mesma soma que o self-bill paga). Então:
 *
 *     comissão = (client_price + extras_amount) − (partner_cost + materials_cost)
 *
 * Nada aqui grava. É conta para documento: payout statement e fatura de
 * comissão. O valor aprovado do payout continua o do banco.
 *
 * Comissão negativa (parceiro recebendo mais do que o cliente pagou) não
 * existe no contrato: vira 0 e sai marcada (`flagged`) para alguém olhar.
 */

/** Dados da Fixfy que vão na fatura de comissão (e só nela, com o VAT). */
export const FIXFY_LEGAL_ENTITY = {
  legalName: "GETFIXFY LTD",
  tradingName: "Fixfy",
  addressLines: ["124 City Road", "London EC1V 2NX", "United Kingdom"],
  companyNumber: "15406523",
  vatNumber: "478 1027 82",
} as const;

/** VAT padrão do Reino Unido sobre a comissão. */
export const COMMISSION_VAT_RATE_PCT = 20;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type CommissionInput = {
  clientPrice: number | null | undefined;
  extrasAmount?: number | null;
  partnerCost: number | null | undefined;
  materialsCost?: number | null;
};

export type CommissionResult = {
  /** O que o cliente paga pelo serviço (preço do profissional). */
  customerPrice: number;
  /** O que o parceiro recebe. */
  partnerNet: number;
  /** Comissão da Fixfy, com VAT incluído. Nunca negativa. */
  commission: number;
  /** True quando a conta deu negativa e foi zerada: precisa de revisão. */
  flagged: boolean;
  /** Quanto faltou (positivo) quando `flagged`. */
  shortfall: number;
};

export function platformBookingCommission(input: CommissionInput): CommissionResult {
  const customerPrice = round2(Number(input.clientPrice ?? 0) + Number(input.extrasAmount ?? 0));
  const partnerNet = round2(Number(input.partnerCost ?? 0) + Number(input.materialsCost ?? 0));
  const raw = round2(customerPrice - partnerNet);
  if (raw < -0.005) {
    return { customerPrice, partnerNet, commission: 0, flagged: true, shortfall: round2(-raw) };
  }
  return { customerPrice, partnerNet, commission: Math.max(0, raw), flagged: false, shortfall: 0 };
}

export type VatSplit = { gross: number; vat: number; net: number; ratePct: number };

/**
 * Separa o VAT de um valor COM VAT. A 20%, o VAT é 1/6 do total
 * ("VAT element = total/6"), arredondado ao centavo; o líquido é o resto.
 */
export function vatFromInclusive(gross: number, ratePct: number = COMMISSION_VAT_RATE_PCT): VatSplit {
  const g = round2(gross);
  if (ratePct <= 0) return { gross: g, vat: 0, net: g, ratePct: 0 };
  const vat = ratePct === 20 ? round2(g / 6) : round2(g - g / (1 + ratePct / 100));
  return { gross: g, vat, net: round2(g - vat), ratePct };
}
