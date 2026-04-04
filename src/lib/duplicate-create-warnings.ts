import { getSupabase } from "@/services/base";

/** Ask user to confirm when similar rows already exist (browser `confirm`). */
export function confirmDespiteDuplicateWarning(lines: string[]): boolean {
  if (lines.length === 0) return true;
  const body = `Possible duplicates found:\n\n• ${lines.join("\n• ")}\n\nCreate anyway?`;
  return window.confirm(body);
}

export function normalizeEmailForDedupe(raw?: string | null): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return s.length > 0 && s.includes("@") ? s : null;
}

/** Digits only; require at least 8 to reduce false positives. */
export function normalizePhoneDigits(raw?: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

function normalizeAddressForDedupe(raw?: string | null): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type DuplicateAccountHint = { company_name: string; email: string };

/** Accounts: same email (exact) or very similar company name (substring match). */
export async function findDuplicateAccountHints(input: {
  companyName: string;
  email: string;
}): Promise<DuplicateAccountHint[]> {
  const supabase = getSupabase();
  const email = normalizeEmailForDedupe(input.email);
  const company = input.companyName.trim();
  const hints: DuplicateAccountHint[] = [];
  const seen = new Set<string>();

  if (email) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, company_name, email")
      .is("deleted_at", null)
      .ilike("email", email)
      .limit(8);
    if (!error) {
      for (const row of data ?? []) {
        const r = row as { id: string; company_name: string; email: string };
        if (!seen.has(r.id)) {
          seen.add(r.id);
          hints.push({ company_name: r.company_name, email: r.email });
        }
      }
    }
  }

  if (company.length >= 3) {
    const safe = escapeIlikePattern(company);
    const { data, error } = await supabase
      .from("accounts")
      .select("id, company_name, email")
      .is("deleted_at", null)
      .ilike("company_name", `%${safe}%`)
      .limit(8);
    if (!error) {
      for (const row of data ?? []) {
        const r = row as { id: string; company_name: string; email: string };
        if (!seen.has(r.id)) {
          seen.add(r.id);
          hints.push({ company_name: r.company_name, email: r.email });
        }
      }
    }
  }

  return hints;
}

export type DuplicateClientHint = { full_name: string; email?: string | null; phone?: string | null };

export async function findDuplicateClients(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<DuplicateClientHint[]> {
  const supabase = getSupabase();
  const email = normalizeEmailForDedupe(input.email);
  const phoneDigits = normalizePhoneDigits(input.phone);
  const hints: DuplicateClientHint[] = [];
  const seen = new Set<string>();

  if (email) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, email, phone")
      .is("deleted_at", null)
      .ilike("email", email)
      .limit(15);
    if (!error) {
      for (const row of data ?? []) {
        const r = row as { id: string; full_name: string; email?: string | null; phone?: string | null };
        if (!seen.has(r.id)) {
          seen.add(r.id);
          hints.push({ full_name: r.full_name, email: r.email, phone: r.phone });
        }
      }
    }
  }

  if (phoneDigits) {
    const tail = phoneDigits.slice(-9);
    const safeTail = escapeIlikePattern(tail);
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, email, phone")
      .is("deleted_at", null)
      .not("phone", "is", null)
      .ilike("phone", `%${safeTail}%`)
      .limit(25);
    if (!error) {
      for (const row of data ?? []) {
        const r = row as { id: string; full_name: string; email?: string | null; phone?: string | null };
        const p = normalizePhoneDigits(r.phone);
        if (p && p === phoneDigits && !seen.has(r.id)) {
          seen.add(r.id);
          hints.push({ full_name: r.full_name, email: r.email, phone: r.phone });
        }
      }
    }
  }

  return hints;
}

export type DuplicateRequestHint = { reference: string; client_name: string; status: string };

export async function findDuplicateRequests(input: {
  clientEmail: string;
  propertyAddress: string;
}): Promise<DuplicateRequestHint[]> {
  const email = normalizeEmailForDedupe(input.clientEmail);
  const addr = normalizeAddressForDedupe(input.propertyAddress);
  if (!email || addr.length < 6) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .select("reference, client_name, property_address, status")
    .is("deleted_at", null)
    .ilike("client_email", email)
    .limit(40);
  if (error) return [];

  const terminal = new Set(["converted_to_quote", "converted_to_job", "declined"]);
  const out: DuplicateRequestHint[] = [];
  for (const row of data ?? []) {
    const r = row as {
      reference: string;
      client_name: string;
      property_address: string;
      status: string;
    };
    if (terminal.has(r.status)) continue;
    if (normalizeAddressForDedupe(r.property_address) !== addr) continue;
    out.push({ reference: r.reference, client_name: r.client_name, status: r.status });
  }
  return out.slice(0, 8);
}

export type DuplicateQuoteHint = { reference: string; title: string; status: string };

export async function findDuplicateQuotes(input: {
  clientEmail: string;
  title: string;
  propertyAddress?: string | null;
}): Promise<DuplicateQuoteHint[]> {
  const email = normalizeEmailForDedupe(input.clientEmail);
  if (!email) return [];

  const titleNorm = input.title.trim().toLowerCase();
  const propNorm = normalizeAddressForDedupe(input.propertyAddress ?? "");

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quotes")
    .select("reference, title, property_address, status, client_email")
    .is("deleted_at", null)
    .ilike("client_email", email)
    .in("status", ["draft", "in_survey", "bidding", "awaiting_customer"])
    .limit(40);
  if (error) return [];

  const out: DuplicateQuoteHint[] = [];
  for (const row of data ?? []) {
    const r = row as {
      reference: string;
      title: string;
      property_address?: string | null;
      status: string;
    };
    const sameTitle = titleNorm.length >= 3 && r.title.trim().toLowerCase() === titleNorm;
    const sameProp =
      propNorm.length >= 6 &&
      normalizeAddressForDedupe(r.property_address ?? "") === propNorm;
    if (sameTitle || sameProp) {
      out.push({ reference: r.reference, title: r.title, status: r.status });
    }
  }
  return out.slice(0, 8);
}

export type DuplicateJobHint = { reference: string; title: string; status: string };

export async function findDuplicateJobs(input: {
  clientId?: string | null;
  propertyAddress: string;
}): Promise<DuplicateJobHint[]> {
  const addr = normalizeAddressForDedupe(input.propertyAddress);
  if (!input.clientId?.trim() || addr.length < 6) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("reference, title, property_address, status, client_id")
    .is("deleted_at", null)
    .eq("client_id", input.clientId.trim())
    .not("status", "eq", "completed")
    .not("status", "eq", "cancelled")
    .limit(40);
  if (error) return [];

  const out: DuplicateJobHint[] = [];
  for (const row of data ?? []) {
    const r = row as { reference: string; title: string; property_address: string; status: string };
    if (normalizeAddressForDedupe(r.property_address) !== addr) continue;
    out.push({ reference: r.reference, title: r.title, status: r.status });
  }
  return out.slice(0, 8);
}

export function formatAccountDuplicateLines(hints: DuplicateAccountHint[]): string[] {
  return hints.map((h) => `Account: ${h.company_name} (${h.email})`);
}

export function formatClientDuplicateLines(hints: DuplicateClientHint[]): string[] {
  return hints.map((h) => {
    const bits = [h.full_name, h.email, h.phone].filter(Boolean);
    return `Client: ${bits.join(" · ")}`;
  });
}

export function formatRequestDuplicateLines(hints: DuplicateRequestHint[]): string[] {
  return hints.map((h) => `Request ${h.reference} — ${h.client_name} (${h.status})`);
}

export function formatQuoteDuplicateLines(hints: DuplicateQuoteHint[]): string[] {
  return hints.map((h) => `Quote ${h.reference} — ${h.title} (${h.status})`);
}

export function formatJobDuplicateLines(hints: DuplicateJobHint[]): string[] {
  return hints.map((h) => `Job ${h.reference} — ${h.title} (${h.status})`);
}

export type DuplicatePartnerHint = { company_name: string; email: string };

export async function findDuplicatePartners(input: {
  email: string;
  companyName?: string;
}): Promise<DuplicatePartnerHint[]> {
  const supabase = getSupabase();
  const hints: DuplicatePartnerHint[] = [];
  const seen = new Set<string>();

  const email = normalizeEmailForDedupe(input.email);
  if (email) {
    const { data, error } = await supabase
      .from("partners")
      .select("id, company_name, email")
      .ilike("email", email)
      .limit(8);
    if (!error) {
      for (const row of data ?? []) {
        const r = row as { id: string; company_name: string; email: string };
        if (!seen.has(r.id)) {
          seen.add(r.id);
          hints.push({ company_name: r.company_name, email: r.email });
        }
      }
    }
  }

  const co = input.companyName?.trim();
  if (co && co.length >= 3) {
    const safe = escapeIlikePattern(co);
    const { data, error } = await supabase
      .from("partners")
      .select("id, company_name, email")
      .ilike("company_name", `%${safe}%`)
      .limit(8);
    if (!error) {
      for (const row of data ?? []) {
        const r = row as { id: string; company_name: string; email: string };
        if (!seen.has(r.id)) {
          seen.add(r.id);
          hints.push({ company_name: r.company_name, email: r.email });
        }
      }
    }
  }

  return hints;
}

export function formatPartnerDuplicateLines(hints: DuplicatePartnerHint[]): string[] {
  return hints.map((h) => `Partner: ${h.company_name} (${h.email})`);
}
