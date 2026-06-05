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
