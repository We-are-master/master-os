/**
 * Greeting name for partner-facing emails from the OS.
 * Prefer trading / company name (B2B), then contact, then a neutral fallback.
 */
export function partnerEmailGreetingName(partner: {
  company_name?: string | null;
  contact_name?: string | null;
}): string {
  const company = partner.company_name?.trim();
  if (company) return company;
  const contact = partner.contact_name?.trim();
  if (contact) return contact;
  return "there";
}
