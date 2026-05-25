import { extractUkPostcode, normalizeUkPostcode } from "@/lib/uk-postcode";
import { normalizeEmailForDedupe, normalizePhoneDigits } from "@/lib/duplicate-create-warnings";

export type LeadFieldErrors = Partial<
  Record<"name" | "email" | "phone" | "address" | "scope", string>
>;

export function validateLeadEmail(raw: string): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Enter a valid email address";
  return null;
}

/** UK landline/mobile: 10–11 digits domestic (0…) or 12 with country code 44. */
export function validateLeadPhone(raw: string): string | null {
  const digits = normalizePhoneDigits(raw);
  if (!digits) return "Enter a valid UK phone number (at least 10 digits)";
  if (digits.startsWith("44")) {
    const national = digits.slice(2);
    if (national.length < 10 || national.length > 11) return "Enter a valid UK phone number";
    return null;
  }
  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) return null;
  return "Enter a valid UK phone number (e.g. 07xxx or +44)";
}

export function formatLeadPhoneDisplay(raw: string): string {
  const t = String(raw ?? "").trim();
  const digits = normalizePhoneDigits(t);
  if (!digits) return t;
  if (digits.startsWith("44") && digits.length >= 12) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`.trim();
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return t;
}

export function validateLeadAddress(raw: string): string | null {
  const address = String(raw ?? "").trim();
  if (address.length < 8) return "Enter a full address (at least 8 characters)";
  const pc = extractUkPostcode(address);
  if (!pc && address.length < 12) {
    return "Include a UK postcode or a more complete address";
  }
  return null;
}

export function validateLeadName(raw: string): string | null {
  const name = String(raw ?? "").trim();
  if (!name) return "Name is required";
  if (name.length < 2) return "Name is too short";
  return null;
}

export function validateLeadScope(raw: string): string | null {
  const scope = String(raw ?? "").trim();
  if (!scope) return "Scope is required";
  return null;
}

export function validateLeadForm(input: {
  name: string;
  email: string;
  phone: string;
  address: string;
  scope: string;
}): LeadFieldErrors {
  const errors: LeadFieldErrors = {};
  const nameErr = validateLeadName(input.name);
  if (nameErr) errors.name = nameErr;
  const emailErr = validateLeadEmail(input.email);
  if (emailErr) errors.email = emailErr;
  const phoneErr = validateLeadPhone(input.phone);
  if (phoneErr) errors.phone = phoneErr;
  const addressErr = validateLeadAddress(input.address);
  if (addressErr) errors.address = addressErr;
  const scopeErr = validateLeadScope(input.scope);
  if (scopeErr) errors.scope = scopeErr;
  return errors;
}

export function normalizeLeadEmail(raw: string): string {
  return normalizeEmailForDedupe(raw) ?? String(raw).trim().toLowerCase();
}

export function normalizeLeadPostcode(raw?: string | null, addressFallback?: string): string | null {
  const direct = String(raw ?? "").trim();
  if (direct) {
    const parsed = extractUkPostcode(direct);
    return parsed ? normalizeUkPostcode(parsed) : normalizeUkPostcode(direct);
  }
  if (addressFallback) {
    const fromAddr = extractUkPostcode(addressFallback);
    return fromAddr ? normalizeUkPostcode(fromAddr) : null;
  }
  return null;
}
