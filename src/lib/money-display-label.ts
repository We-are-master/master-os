/**
 * Customer/partner-facing £ amounts in emails and PDF templates.
 * Appends "inc VAT" unless the string already states VAT treatment.
 */

export function moneyIncVatLabel(amount: string): string {
  const t = amount.trim();
  if (!t) return t;
  if (/inc\s*vat/i.test(t)) return t;
  if (/ex\s*vat/i.test(t)) return t;
  return `${t} inc VAT`;
}

export function formatGbpIncVat(value: number): string {
  const formatted = value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return moneyIncVatLabel(`£${formatted}`);
}

/** Splits a display amount from the trailing "inc VAT" suffix (if present). */
export function splitMoneyIncVatParts(amount: string): { core: string; hasIncVat: boolean } {
  const label = moneyIncVatLabel(amount);
  const match = label.match(/^(.+?)\s+inc\s+vat$/i);
  if (match) return { core: match[1].trim(), hasIncVat: true };
  return { core: label, hasIncVat: false };
}
