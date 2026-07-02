/**
 * Normalize a raw Apify dataset item into a Lead. Different actors expose
 * different shapes (Google Maps Scraper, contact-info scrapers, directory
 * scrapers), so we read a tolerant union of common field names.
 */

export type LeadSegment = "partner" | "b2b_client";

export type NormalizedLead = {
  email: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  town: string | null;
  country: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Generic / role inboxes we don't want to cold-email (low signal, high spam risk).
const BLOCKED_PREFIXES = ["noreply", "no-reply", "donotreply", "postmaster", "abuse", "mailer-daemon"];

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function firstEmail(item: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];
  // Common single-field names.
  candidates.push(item.email, item.Email, item.contactEmail);
  // Common array fields.
  for (const key of ["emails", "Emails", "email_1", "emailList"]) {
    const v = item[key];
    if (Array.isArray(v)) candidates.push(...v);
    else candidates.push(v);
  }
  for (const c of candidates) {
    const e = str(c)?.toLowerCase();
    if (!e || !EMAIL_RE.test(e)) continue;
    const prefix = e.split("@")[0];
    if (BLOCKED_PREFIXES.some((p) => prefix.startsWith(p))) continue;
    return e;
  }
  return null;
}

function firstPhone(item: Record<string, unknown>): string | null {
  for (const key of ["phone", "phoneNumber", "phoneUnformatted", "Phone", "telephone"]) {
    const v = str(item[key]);
    if (v) return v;
  }
  const arr = item.phones;
  if (Array.isArray(arr)) {
    const v = str(arr[0]);
    if (v) return v;
  }
  return null;
}

function category(item: Record<string, unknown>): string | null {
  const single = str(item.categoryName) ?? str(item.category) ?? str(item.type);
  if (single) return single;
  const arr = item.categories;
  if (Array.isArray(arr)) return str(arr[0]);
  return null;
}

export function normalizeApifyItem(raw: unknown): NormalizedLead {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    email: firstEmail(item),
    company_name: str(item.title) ?? str(item.name) ?? str(item.companyName) ?? str(item.businessName),
    contact_name: str(item.contactName) ?? str(item.ownerName) ?? str(item.person),
    phone: firstPhone(item),
    website: str(item.website) ?? str(item.url) ?? str(item.domain),
    category: category(item),
    town: str(item.city) ?? str(item.town) ?? str(item.locality) ?? str(item.address),
    country: str(item.countryCode) ?? str(item.country),
  };
}

/** A lead is worth cold-emailing only if it has a deliverable-looking email. */
export function isEmailable(lead: NormalizedLead): boolean {
  return !!lead.email && EMAIL_RE.test(lead.email);
}
