/** Strip non-digits; max 6 (UK sort code). */
export function normalizeUkSortCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** Strip non-digits; typical UK account 6–10 digits. */
export function normalizeUkAccountNumberInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 10);
}

/** Display helper: 123456 → 12-34-56 */
export function formatUkSortCodeForDisplay(digits: string): string {
  const d = normalizeUkSortCodeInput(digits);
  if (d.length === 0) return "";
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

export type UkBankValidationResult = { ok: true } | { ok: false; message: string };

/** Empty = valid (no bank details). If any field is set, all must be complete and formats valid. */
export function validatePartnerBankDetails(input: {
  sortDigits: string;
  accountDigits: string;
  accountHolder: string;
  bankName: string;
}): UkBankValidationResult {
  const holder = input.accountHolder.trim();
  const name = input.bankName.trim();
  const s = input.sortDigits;
  const a = input.accountDigits;
  const any = s.length > 0 || a.length > 0 || holder.length > 0 || name.length > 0;
  if (!any) return { ok: true };
  if (s.length !== 6) {
    return { ok: false, message: "Sort code must be 6 digits." };
  }
  if (a.length < 6 || a.length > 10) {
    return { ok: false, message: "Account number must be 6–10 digits." };
  }
  if (holder.length < 2) {
    return { ok: false, message: "Enter the account holder name (as on the bank account)." };
  }
  if (name.length < 2) {
    return { ok: false, message: "Enter the bank or building society name." };
  }
  if (holder.length > 120 || name.length > 120) {
    return { ok: false, message: "Account holder and bank name must be at most 120 characters." };
  }
  return { ok: true };
}
