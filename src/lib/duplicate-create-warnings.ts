import { getSupabase } from "@/services/base";
import { isUuid } from "@/lib/utils";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

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

/** Same service + same free-text body (requests). */
function normalizeRequestBodyForDedupe(raw?: string | null): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function requestContentKey(serviceType: string, description: string): string {
  const st = normalizeTypeOfWork(serviceType).trim().toLowerCase();
  const body = normalizeRequestBodyForDedupe(description);
  return `${st}\n${body}`;
}

/** Aligns with job titles stored from type-of-work / request conversion. */
function normalizeJobTitleForDedupe(title?: string | null): string {
  const t = normalizeTypeOfWork(title ?? "").trim();
  return t.toLowerCase();
}

function jobScheduleKey(input: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): string {
  return [
    String(input.scheduled_date ?? "").trim().slice(0, 10),
    String(input.scheduled_start_at ?? "").trim(),
    String(input.scheduled_end_at ?? "").trim(),
  ].join("\t");
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
  /** When set (valid UUID), query by FK — usually far fewer rows than email ilike. */
  clientId?: string | null;
  clientEmail: string;
  propertyAddress: string;
  /** Service line + description together define the same “request”. */
  serviceType: string;
  description: string;
}): Promise<DuplicateRequestHint[]> {
  const addr = normalizeAddressForDedupe(input.propertyAddress);
  if (addr.length < 6) return [];

  const contentKey = requestContentKey(input.serviceType ?? "", input.description ?? "");
  if (!contentKey.trim()) return [];

  const supabase = getSupabase();
  const terminal = new Set(["converted_to_quote", "converted_to_job", "declined"]);
  const out: DuplicateRequestHint[] = [];

  const cid = typeof input.clientId === "string" ? input.clientId.trim() : "";
  if (cid && isUuid(cid)) {
    const { data, error } = await supabase
      .from("service_requests")
      .select("reference, client_name, property_address, status, service_type, description")
      .is("deleted_at", null)
      .eq("client_id", cid)
      .limit(25);
    if (error) return [];
    for (const row of data ?? []) {
      const r = row as {
        reference: string;
        client_name: string;
        property_address: string;
        status: string;
        service_type: string;
        description: string;
      };
      if (terminal.has(r.status)) continue;
      if (normalizeAddressForDedupe(r.property_address) !== addr) continue;
      if (requestContentKey(r.service_type, r.description) !== contentKey) continue;
      out.push({ reference: r.reference, client_name: r.client_name, status: r.status });
    }
    return out.slice(0, 8);
  }

  const email = normalizeEmailForDedupe(input.clientEmail);
  if (!email) return [];

  const { data, error } = await supabase
    .from("service_requests")
    .select("reference, client_name, property_address, status, service_type, description")
    .is("deleted_at", null)
    .ilike("client_email", email)
    .limit(40);
  if (error) return [];

  for (const row of data ?? []) {
    const r = row as {
      reference: string;
      client_name: string;
      property_address: string;
      status: string;
      service_type: string;
      description: string;
    };
    if (terminal.has(r.status)) continue;
    if (normalizeAddressForDedupe(r.property_address) !== addr) continue;
    if (requestContentKey(r.service_type, r.description) !== contentKey) continue;
    out.push({ reference: r.reference, client_name: r.client_name, status: r.status });
  }
  return out.slice(0, 8);
}

export type DuplicateQuoteHint = { reference: string; title: string; status: string };

export async function findDuplicateQuotes(input: {
  clientEmail: string;
  title: string;
  propertyAddress?: string | null;
  startDateOption1?: string | null;
  startDateOption2?: string | null;
}): Promise<DuplicateQuoteHint[]> {
  const email = normalizeEmailForDedupe(input.clientEmail);
  if (!email) return [];

  const titleNorm = input.title.trim().toLowerCase();
  const propNorm = normalizeAddressForDedupe(input.propertyAddress ?? "");
  if (propNorm.length < 6) return [];

  const opt1 = String(input.startDateOption1 ?? "").trim();
  const opt2 = String(input.startDateOption2 ?? "").trim();

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quotes")
    .select("reference, title, property_address, status, client_email, start_date_option_1, start_date_option_2")
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
      start_date_option_1?: string | null;
      start_date_option_2?: string | null;
    };
    const sameTitle = titleNorm.length >= 3 && r.title.trim().toLowerCase() === titleNorm;
    const sameProp = normalizeAddressForDedupe(r.property_address ?? "") === propNorm;
    const sameSchedule =
      String(r.start_date_option_1 ?? "").trim() === opt1 && String(r.start_date_option_2 ?? "").trim() === opt2;
    if (sameTitle && sameProp && sameSchedule) {
      out.push({ reference: r.reference, title: r.title, status: r.status });
    }
  }
  return out.slice(0, 8);
}

export type DuplicateJobHint = { reference: string; title: string; status: string };

export async function findDuplicateJobs(input: {
  clientId?: string | null;
  propertyAddress: string;
  title: string;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): Promise<DuplicateJobHint[]> {
  const addr = normalizeAddressForDedupe(input.propertyAddress);
  if (!input.clientId?.trim() || addr.length < 6) return [];

  const titleKey = normalizeJobTitleForDedupe(input.title);
  if (!titleKey) return [];

  const schedKey = jobScheduleKey({
    scheduled_date: input.scheduled_date,
    scheduled_start_at: input.scheduled_start_at,
    scheduled_end_at: input.scheduled_end_at,
  });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "reference, title, property_address, status, client_id, scheduled_date, scheduled_start_at, scheduled_end_at",
    )
    .is("deleted_at", null)
    .eq("client_id", input.clientId.trim())
    .not("status", "eq", "completed")
    .not("status", "eq", "cancelled")
    .limit(40);
  if (error) return [];

  const out: DuplicateJobHint[] = [];
  for (const row of data ?? []) {
    const r = row as {
      reference: string;
      title: string;
      property_address: string;
      status: string;
      scheduled_date?: string | null;
      scheduled_start_at?: string | null;
      scheduled_end_at?: string | null;
    };
    if (normalizeAddressForDedupe(r.property_address) !== addr) continue;
    if (normalizeJobTitleForDedupe(r.title) !== titleKey) continue;
    if (
      jobScheduleKey({
        scheduled_date: r.scheduled_date,
        scheduled_start_at: r.scheduled_start_at,
        scheduled_end_at: r.scheduled_end_at,
      }) !== schedKey
    ) {
      continue;
    }
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
