/**
 * Label for a corporate `accounts` row when showing Client → Account links.
 * Prefer company name; fall back to contact or email (some accounts have empty company_name).
 */
export function accountLinkedLabel(row: {
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
}): string {
  const t = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return t(row.company_name) || t(row.contact_name) || t(row.email) || "";
}
