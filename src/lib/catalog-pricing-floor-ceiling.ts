/**
 * Catalog pricing floor (minimum sell) and ceiling (maximum partner pay).
 *
 * - Account sell rates must be >= catalog standard (floor).
 * - Partner pay rates are COMPARED to the catalog standard, not capped by it.
 *
 * O teto deixou de cortar em 21/08/2026, por decisão do dono. Ele existia para
 * impedir pagar acima do padrão, e a consequência era pior: o preço combinado
 * com o parceiro não cabia no sistema. O London Safety Certificate cobra £98,99
 * no EICR de studio contra £69 do padrão, e o OS guardava £98,99 e lia £69 — o
 * número verdadeiro entrava e sumia calado.
 *
 * `isPartnerPayValid` continua existindo e dizendo que passou do padrão. A
 * diferença é que agora isso é AVISO na tela (a margem que aparece na hora de
 * alocar), não um corte silencioso no valor.
 */

export type PricingDeltaKind = "sell" | "pay";

export type PricingDelta = {
  kind: PricingDeltaKind;
  standard: number;
  rate: number;
  delta: number;
  label: string;
  valid: boolean;
};

export function resolveAccountSell(floor: number, override: number | null | undefined): number {
  const f = finiteNonNeg(floor);
  if (override == null || !Number.isFinite(Number(override))) return f;
  return Math.max(f, finiteNonNeg(Number(override)));
}

export function resolvePartnerPay(ceiling: number, override: number | null | undefined): number {
  const c = finiteNonNeg(ceiling);
  if (override == null || !Number.isFinite(Number(override))) return c;
  // Sem `Math.min`: o combinado com o parceiro vale, mesmo acima do padrão.
  return finiteNonNeg(Number(override));
}

export function isAccountSellValid(floor: number, rate: number): boolean {
  return finiteNonNeg(rate) >= finiteNonNeg(floor);
}

export function isPartnerPayValid(ceiling: number, rate: number): boolean {
  return finiteNonNeg(rate) <= finiteNonNeg(ceiling);
}

export function sellDeltaLabel(floor: number, rate: number): string {
  const f = finiteNonNeg(floor);
  const r = finiteNonNeg(rate);
  const d = Math.round((r - f) * 100) / 100;
  if (d <= 0) return "At minimum";
  return `+£${d.toFixed(2)} above minimum`;
}

export function payDeltaLabel(ceiling: number, rate: number): string {
  const c = finiteNonNeg(ceiling);
  const r = finiteNonNeg(rate);
  const d = Math.round((c - r) * 100) / 100;
  if (d <= 0) return "At ceiling";
  return `−£${d.toFixed(2)} below ceiling`;
}

export function marginPercent(sell: number, pay: number): number | null {
  const s = finiteNonNeg(sell);
  const p = finiteNonNeg(pay);
  if (!(s > 0)) return null;
  return Math.round(((s - p) / s) * 10000) / 100;
}

export function buildSellDelta(floor: number, rate: number): PricingDelta {
  const f = finiteNonNeg(floor);
  const r = finiteNonNeg(rate);
  return {
    kind: "sell",
    standard: f,
    rate: r,
    delta: Math.round((r - f) * 100) / 100,
    label: sellDeltaLabel(f, r),
    valid: r >= f,
  };
}

export function buildPayDelta(ceiling: number, rate: number): PricingDelta {
  const c = finiteNonNeg(ceiling);
  const r = finiteNonNeg(rate);
  return {
    kind: "pay",
    standard: c,
    rate: r,
    delta: Math.round((c - r) * 100) / 100,
    label: payDeltaLabel(c, r),
    valid: r <= c,
  };
}

export function catalogPartnerHourlyRate(
  partnerCost: number | null | undefined,
  defaultHours: number | null | undefined,
): number {
  const cost = partnerCost != null ? Number(partnerCost) : 0;
  if (!(cost > 0)) return 0;
  const hours = defaultHours && Number(defaultHours) > 0 ? Number(defaultHours) : 1;
  return Math.round((cost / hours) * 100) / 100;
}

function finiteNonNeg(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}
