import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import type { ServiceRequest } from "@/types/database";

/** Nullable UUID columns: empty string breaks PostgREST (invalid uuid) — coerce to null. */
const UUID_NULLABLE = new Set([
  "client_id",
  "client_address_id",
  "catalog_service_id",
  "owner_id",
  "assigned_to",
]);

function postgrestErrorMessage(err: { message?: string; details?: string; hint?: string }): string {
  const parts = [err.message, err.details, err.hint]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" — ") : "Database request failed";
}

/** True when API/schema has no `request_kind` column yet (migration 071 not applied). */
function isMissingRequestKindColumnError(err: { message?: string }): boolean {
  const m = (err.message ?? "").toLowerCase();
  return m.includes("request_kind") && (m.includes("schema cache") || m.includes("column"));
}

/** True when DB has not received ccz/parking migration yet. */
function isMissingAccessFlagsColumnError(err: { message?: string }): boolean {
  const m = (err.message ?? "").toLowerCase();
  const mentionsCol = m.includes("in_ccz") || m.includes("has_free_parking");
  return mentionsCol && (m.includes("schema cache") || m.includes("column"));
}

function stripAccessFlags<T extends Record<string, unknown>>(row: T): Omit<T, "in_ccz" | "has_free_parking"> {
  // keep retry payload backward-compatible when migration 077 is missing
  const { in_ccz: _a, has_free_parking: _b, ...rest } = row;
  return rest;
}

function buildServiceRequestInsertPayload(
  input: Omit<ServiceRequest, "id" | "reference" | "created_at" | "updated_at">,
  reference: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...input, reference };
  delete merged.source_account_name;

  for (const key of UUID_NULLABLE) {
    const v = merged[key];
    if (typeof v === "string" && v.trim() === "") {
      merged[key] = null;
    }
  }

  const rk = merged.request_kind;
  if (rk !== "quote" && rk !== "work") {
    merged.request_kind = "quote";
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Enrich rows with linked account label (FK + company/contact/email, then email match). */
async function enrichRequestsWithAccountNames(requests: ServiceRequest[]): Promise<ServiceRequest[]> {
  const clientIds = [...new Set(requests.map((r) => r.client_id).filter(Boolean))] as string[];
  if (clientIds.length === 0) return requests;
  const labels = await batchResolveLinkedAccountLabels(getSupabase(), clientIds);
  return requests.map((r) => ({
    ...r,
    source_account_name: r.client_id ? labels.get(r.client_id) ?? null : null,
  }));
}

export async function listRequests(params: ListParams): Promise<ListResult<ServiceRequest>> {
  const result = await queryList<ServiceRequest>("service_requests", params, {
    searchColumns: ["reference", "client_name", "client_email", "property_address", "service_type"],
    defaultSort: "created_at",
  });
  const data = await enrichRequestsWithAccountNames(result.data);
  return { ...result, data };
}

export async function getRequest(id: string): Promise<ServiceRequest | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? null;
}

export async function createRequest(
  input: Omit<ServiceRequest, "id" | "reference" | "created_at" | "updated_at">
): Promise<ServiceRequest> {
  const supabase = getSupabase();
  const { data: ref, error: refErr } = await supabase.rpc("next_request_ref");
  if (refErr) throw new Error(postgrestErrorMessage(refErr));
  if (ref == null || String(ref).trim() === "") {
    throw new Error("Could not generate request reference (next_request_ref).");
  }
  const payload = buildServiceRequestInsertPayload(input, String(ref));
  let { data, error } = await supabase.from("service_requests").insert(payload).select().single();
  if (error && isMissingRequestKindColumnError(error) && "request_kind" in payload) {
    const { request_kind: _rk, ...withoutKind } = payload;
    const retry = await supabase.from("service_requests").insert(withoutKind).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error && isMissingAccessFlagsColumnError(error)) {
    const retry = await supabase.from("service_requests").insert(stripAccessFlags(payload)).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(postgrestErrorMessage(error));
  // Skip account-name enrichment (saves 2 round-trips); list/detail refresh loads it.
  return data as ServiceRequest;
}

export async function updateRequest(
  id: string,
  input: Partial<ServiceRequest>
): Promise<ServiceRequest> {
  const supabase = getSupabase();
  const patch: Record<string, unknown> = { ...input };
  delete patch.source_account_name;
  for (const key of UUID_NULLABLE) {
    const v = patch[key];
    if (typeof v === "string" && v.trim() === "") {
      patch[key] = null;
    }
  }
  let { data, error } = await supabase
    .from("service_requests")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error && isMissingRequestKindColumnError(error) && "request_kind" in patch) {
    const { request_kind: _rk, ...withoutKind } = patch;
    const retry = await supabase
      .from("service_requests")
      .update(withoutKind)
      .eq("id", id)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error && isMissingAccessFlagsColumnError(error)) {
    const retry = await supabase
      .from("service_requests")
      .update(stripAccessFlags(patch))
      .eq("id", id)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(postgrestErrorMessage(error));
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? (data as ServiceRequest);
}

export async function updateRequestStatus(id: string, status: string): Promise<ServiceRequest> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Request not found or update had no effect");
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? (data as ServiceRequest);
}
