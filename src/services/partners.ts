import { getSupabase, type ListParams, type ListResult } from "./base";
import { PARTNER_RATING_MAX } from "@/lib/partner-rating";
import { PARTNER_ONBOARDING_STAGE_STATUSES } from "@/lib/partner-status";
import type { Partner } from "@/types/database";
import { sanitizePostgrestValue, safePostgrestEnumValue } from "@/lib/supabase/sanitize";
import {
  isSupabaseMissingColumnError,
  parsePostgrestUnknownColumnName,
} from "@/lib/supabase-schema-compat";

/**
 * Retry partner writes by dropping only the column PostgREST says is missing.
 * Older code stripped `trades` whenever *any* column in the payload failed, which
 * silently saved only `trade` (primary) — list icons then showed a single trade.
 */
async function writePartnerWithSchemaCompat(
  mode: "insert" | "update",
  id: string | null,
  input: Record<string, unknown>,
): Promise<Partner> {
  const supabase = getSupabase();
  const payload: Record<string, unknown> = { ...input };
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    const res =
      mode === "insert"
        ? await supabase.from("partners").insert(payload).select().single()
        : await supabase.from("partners").update(payload).eq("id", id!).select().single();

    if (!res.error) return res.data as Partner;
    lastErr = res.error;

    const col = parsePostgrestUnknownColumnName(res.error);
    if (col && col in payload && col !== "id") {
      delete payload[col];
      continue;
    }

    if (!isSupabaseMissingColumnError(res.error)) break;

    // Unknown missing-column shape — drop the least-critical optional keys one group at a time.
    const optionalGroups: string[][] = [
      ["partner_status_reasons"],
      ["catalog_service_ids"],
      ["vat_registered"],
      ["partner_legal_type", "utr"],
      ["uk_coverage_regions", "partner_address", "partner_address_latitude", "partner_address_longitude"],
      ["coverage_mode", "service_radius_miles", "coverage_latitude", "coverage_longitude", "coverage_base_postcode", "included_postcodes", "coverage_cities"],
      ["bank_sort_code", "bank_account_number", "bank_account_holder", "bank_name"],
      // Drop `trades` last so multi-trade saves survive other schema gaps.
      ["trades"],
    ];
    let dropped = false;
    for (const group of optionalGroups) {
      if (group.some((k) => k in payload)) {
        for (const k of group) delete payload[k];
        dropped = true;
        break;
      }
    }
    if (!dropped) break;
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Partner write failed"));
}

export interface PartnerListParams extends ListParams {
  trade?: string;
}

/**
 * List partners via the consolidated `get_partners_list_bundle` RPC
 * (migration 125). One round-trip returns paged rows + per-partner doc/job
 * aggregates instead of N parallel queries.
 *
 * Falls back to the legacy direct-query path if the RPC is unavailable
 * (older databases or RLS misconfig). The fallback path is unchanged from
 * the original implementation so the contract is identical.
 */
export async function listPartners(params: PartnerListParams): Promise<ListResult<Partner>> {
  const supabase = getSupabase();
  const page     = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;

  // ─── Fast path: bundle RPC (one round-trip) ─────────────────────────────
  const statusArg =
    !params.status || params.status === "all"
      ? null
      // The RPC takes a single status string. The page treats "inactive" and "onboarding"
      // as unions; fall back to the direct path so IN-list filters are preserved.
      : params.status === "inactive" || params.status === "onboarding"
        ? "__needs_fallback__"
        : params.status;

  const tradeArg = params.trade && params.trade !== "all" ? params.trade : null;
  const searchArg = params.search?.trim() || null;

  if (statusArg !== "__needs_fallback__") {
    const { data, error } = await supabase.rpc("get_partners_list_bundle", {
      p_status: statusArg,
      p_trade:  tradeArg,
      p_search: searchArg,
      p_limit:  pageSize,
      p_offset: (page - 1) * pageSize,
    });

    if (!error && data) {
      const payload = data as { rows: Partner[]; total: number };
      const total   = payload.total ?? 0;
      return {
        data:       payload.rows ?? [],
        count:      total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
    // RPC missing or RLS issue → fall through to legacy path
  }

  // ─── Legacy fallback: direct table queries ──────────────────────────────
  return listPartnersLegacy(params, page, pageSize);
}

/** Original direct-query path. Kept as fallback for envs where the RPC is missing. */
async function listPartnersLegacy(
  params: PartnerListParams,
  page: number,
  pageSize: number,
): Promise<ListResult<Partner>> {
  const supabase = getSupabase();
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  let query = supabase.from("partners").select("*", { count: "exact" });

  if (params.status && params.status !== "all") {
    /** Inactive stage includes legacy `on_break` rows (same lifecycle as inactive + reason). */
    if (params.status === "inactive") {
      query = query.in("status", ["inactive", "on_break"]);
    } else if (params.status === "onboarding") {
      query = query.in("status", [...PARTNER_ONBOARDING_STAGE_STATUSES]);
    } else {
      query = query.eq("status", params.status);
    }
  }
  if (params.trade && params.trade !== "all") {
    // Reject any trade value containing PostgREST metacharacters — those would
    // break out of the .or() filter and inject extra clauses (filter bypass).
    const safeTrade = safePostgrestEnumValue(params.trade);
    if (safeTrade) {
      query = query.or(`trade.eq.${safeTrade},trades.cs.{${safeTrade}}`);
    }
  }
  if (params.search) {
    const safeSearch = sanitizePostgrestValue(params.search);
    if (safeSearch) {
      query = query.or(
        `company_name.ilike.%${safeSearch}%,contact_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`
      );
    }
  }

  query = query.order(params.sortBy ?? "total_earnings", { ascending: params.sortDir === "asc" });
  query = query.range(from, to);

  let { data, error, count } = await query;
  if (error && params.trade && params.trade !== "all") {
    // Fallback for environments where `trades` column is not available yet.
    let fallback = supabase.from("partners").select("*", { count: "exact" });
    if (params.status && params.status !== "all") {
      if (params.status === "inactive") {
        fallback = fallback.in("status", ["inactive", "on_break"]);
      } else if (params.status === "onboarding") {
        fallback = fallback.in("status", [...PARTNER_ONBOARDING_STAGE_STATUSES]);
      } else {
        fallback = fallback.eq("status", params.status);
      }
    }
    const safeTradeFallback = safePostgrestEnumValue(params.trade);
    if (safeTradeFallback) {
      fallback = fallback.eq("trade", safeTradeFallback);
    }
    if (params.search) {
      const safeSearchFallback = sanitizePostgrestValue(params.search);
      if (safeSearchFallback) {
        fallback = fallback.or(
          `company_name.ilike.%${safeSearchFallback}%,contact_name.ilike.%${safeSearchFallback}%,email.ilike.%${safeSearchFallback}%`
        );
      }
    }
    fallback = fallback.order(params.sortBy ?? "total_earnings", { ascending: params.sortDir === "asc" }).range(from, to);
    const fallbackRes = await fallback;
    data = fallbackRes.data;
    error = fallbackRes.error;
    count = fallbackRes.count;
  }
  if (error) throw error;

  return {
    data: (data ?? []) as Partner[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

const LIST_ALL_PAGE_SIZE = 500;
const LIST_ALL_MAX_PAGES = 100;

/** Fetch every partner row (paginated server-side). PostgREST caps a single range; this loops until a short page. */
export async function listPartnersAll(params: Omit<PartnerListParams, "page" | "pageSize"> = {}): Promise<Partner[]> {
  const out: Partner[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= LIST_ALL_MAX_PAGES; page++) {
    const r = await listPartners({ ...params, page, pageSize: LIST_ALL_PAGE_SIZE });
    const rows = (r.data ?? []).filter((p): p is Partner => typeof p?.id === "string" && p.id.length > 0);
    for (const p of rows) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    if (rows.length < LIST_ALL_PAGE_SIZE) break;
  }
  return out;
}

export async function createPartner(
  input: Omit<Partner, "id" | "joined_at" | "rating" | "jobs_completed" | "total_earnings" | "compliance_score">
): Promise<Partner> {
  // Guard against duplicate partner records: the "Add Partner" wizard already
  // warns staff about a possible email/name match (findDuplicatePartners) but
  // that warning is dismissable, and other callers may skip it entirely. This
  // is the last line of defence — without it, a duplicate partner row ends up
  // with no `auth_user_id`, so its assigned jobs silently never appear in the
  // Trade Portal or the app for that partner (incident 2026-08-19: RJ Cleaner
  // Services). Case-insensitive, since `partners.email` isn't guaranteed
  // lowercase and partners self-register with mixed case.
  const email = (input as { email?: string | null }).email?.trim();
  if (email) {
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from("partners")
      .select("id, company_name, status, auth_user_id")
      .ilike("email", email)
      .maybeSingle();
    if (existing) {
      const e = existing as { id: string; company_name: string; status: string; auth_user_id: string | null };
      throw new Error(
        e.auth_user_id
          ? `A partner with this email already exists: "${e.company_name}" (status: ${e.status}) and already has a Trade Portal login. Open that record in Directory instead of creating a new one.`
          : `A partner with this email already exists: "${e.company_name}" (status: ${e.status}). Open that record in Directory and edit it instead of creating a duplicate.`
      );
    }
  }

  return writePartnerWithSchemaCompat("insert", null, {
    ...(input as unknown as Record<string, unknown>),
    rating: PARTNER_RATING_MAX,
  });
}

export async function updatePartner(id: string, input: Partial<Partner>): Promise<Partner> {
  return writePartnerWithSchemaCompat("update", id, { ...(input as unknown as Record<string, unknown>) });
}
