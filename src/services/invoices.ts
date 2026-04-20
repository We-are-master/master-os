import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Invoice, InvoiceCollectionStage, InvoiceStatus } from "@/types/database";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import { syncJobAfterInvoiceCreated } from "@/lib/sync-invoices-from-job-payments";

/** Payload for creating an invoice (collection fields default when omitted). */
export type CreateInvoiceInput = Omit<Invoice, "id" | "reference" | "created_at" | "collection_stage"> & {
  collection_stage?: InvoiceCollectionStage;
};

/**
 * Invoices list — fast path uses `get_invoices_list_bundle` RPC (migration 125),
 * which returns paged rows + per-invoice customer payment totals in a single
 * round-trip. The legacy chunked .in("job_reference", slice) loop fired by
 * /finance/invoices is now server-side. Falls back to direct queryList path
 * on RPC failure.
 *
 * Note: the bundle RPC takes a single status string and does not yet support
 * the "pending → ['pending','partially_paid']" expansion. When `params.status`
 * is "pending", we fall through to the legacy path so that filter still works.
 */
export async function listInvoices(params: ListParams): Promise<ListResult<Invoice>> {
  const supabase = getSupabase();
  const page     = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;

  // Pending = (pending OR partially_paid). RPC doesn't support multi-status yet.
  const needsLegacyMultiStatus = params.status === "pending";

  if (!needsLegacyMultiStatus) {
    const statusArg = params.status && params.status !== "all" ? params.status : null;
    const searchArg = params.search?.trim() || null;

    const { data, error } = await supabase.rpc("get_invoices_list_bundle", {
      p_period_start: null,
      p_period_end:   null,
      p_status:       statusArg,
      p_search:       searchArg,
      p_limit:        pageSize,
      p_offset:       (page - 1) * pageSize,
    });

    if (!error && data) {
      const payload = data as { rows: Invoice[]; total: number };
      const total   = payload.total ?? 0;
      return {
        data:       payload.rows ?? [],
        count:      total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
  }

  // Legacy fallback (also handles the "pending" multi-status case)
  const p: ListParams = { ...params };
  if (p.status === "pending") {
    p.statusIn = ["pending", "partially_paid"];
    p.status = undefined;
  }
  return queryList<Invoice>("invoices", p, {
    searchColumns: ["reference", "client_name", "job_reference"],
    defaultSort: "created_at",
  });
}

/** Pass `reference` when you already fetched `next_invoice_ref` (e.g. parallel with `next_job_ref`). */
export async function createInvoice(
  input: CreateInvoiceInput,
  options?: { reference?: string | null },
): Promise<Invoice> {
  const supabase = getSupabase();
  let ref = options?.reference;
  if (ref == null || String(ref).trim() === "") {
    const { data: r, error: refErr } = await supabase.rpc("next_invoice_ref");
    if (refErr) throw refErr;
    ref = r as string;
  }
  const collection_stage: InvoiceCollectionStage =
    input.collection_stage ??
    (input.invoice_kind === "deposit" ? "awaiting_deposit" : "awaiting_final");
  const row = {
    ...input,
    amount_paid: input.amount_paid ?? 0,
    collection_stage,
    collection_stage_locked: input.collection_stage_locked ?? false,
    invoice_kind: input.invoice_kind ?? "other",
  };
  const { data, error } = await supabase
    .from("invoices")
    .insert({ ...row, reference: ref as string })
    .select()
    .single();
  if (!error) {
    const inv = data as Invoice;
    try {
      await syncJobAfterInvoiceCreated(supabase, inv);
    } catch (e) {
      console.error("syncJobAfterInvoiceCreated", inv.id, e);
    }
    return inv;
  }

  // Compatibility fallback for older DB constraints/schemas in production.
  const code = (error as { code?: string }).code;
  const msg = (error as { message?: string }).message ?? "";
  const maybeCompatIssue =
    code === "23514" ||
    msg.includes("invoice") ||
    msg.includes("collection_stage") ||
    msg.includes("invoice_kind") ||
    msg.includes("Could not find the") ||
    msg.includes("does not exist");
  if (!maybeCompatIssue) throw error;

  const legacyRow = {
    ...input,
    amount_paid: input.amount_paid ?? 0,
    invoice_kind: input.invoice_kind === "combined" ? "final" : (input.invoice_kind ?? "other"),
  } as Record<string, unknown>;
  delete legacyRow.collection_stage;
  delete legacyRow.collection_stage_locked;

  const { data: legacyData, error: legacyErr } = await supabase
    .from("invoices")
    .insert({ ...legacyRow, reference: ref })
    .select()
    .single();
  if (!legacyErr) {
    const inv = legacyData as Invoice;
    try {
      await syncJobAfterInvoiceCreated(supabase, inv);
    } catch (e) {
      console.error("syncJobAfterInvoiceCreated", inv.id, e);
    }
    return inv;
  }

  // Older installations may also lack amount_paid / invoice_kind.
  const minimalRow = {
    client_name: input.client_name,
    job_reference: input.job_reference,
    amount: input.amount,
    status: input.status,
    due_date: input.due_date,
    paid_date: input.paid_date,
  };
  const { data: minimalData, error: minimalErr } = await supabase
    .from("invoices")
    .insert({ ...minimalRow, reference: ref })
    .select()
    .single();
  if (minimalErr) throw minimalErr;
  const inv = minimalData as Invoice;
  try {
    await syncJobAfterInvoiceCreated(supabase, inv);
  } catch (e) {
    console.error("syncJobAfterInvoiceCreated", inv.id, e);
  }
  return inv;
}

/** Invoices tied to a job (by reference on the invoice + optional primary invoice id on the job). */
export async function listInvoicesLinkedToJob(
  jobReference: string,
  primaryInvoiceId?: string | null
): Promise<Invoice[]> {
  const supabase = getSupabase();
  const { data: byRef, error: e1 } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_reference", jobReference)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (e1) throw e1;
  const rows: Invoice[] = [...((byRef ?? []) as Invoice[])];
  if (primaryInvoiceId) {
    const { data: primary } = await supabase.from("invoices").select("*").eq("id", primaryInvoiceId).maybeSingle();
    const p = primary as Invoice | null;
    if (p && !rows.some((r) => r.id === p.id)) {
      rows.unshift(p);
    }
  }
  return rows;
}

export async function updateInvoice(id: string, input: Partial<Invoice>): Promise<Invoice> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (!error) return data as Invoice;

  // Compatibility fallback for older DB schemas (missing amount_paid/collection fields/invoice_kind).
  const code = (error as { code?: string }).code;
  const msg = (error as { message?: string }).message ?? "";
  const maybeCompatIssue =
    code === "23514" ||
    code === "PGRST204" ||
    msg.includes("invoice") ||
    msg.includes("collection_stage") ||
    msg.includes("collection_stage_locked") ||
    msg.includes("invoice_kind") ||
    msg.includes("amount_paid") ||
    msg.includes("cancellation_reason") ||
    msg.includes("Could not find the") ||
    msg.includes("does not exist");
  if (!maybeCompatIssue) throw error;

  const legacyPatch = { ...input } as Record<string, unknown>;
  delete legacyPatch.collection_stage;
  delete legacyPatch.collection_stage_locked;
  delete legacyPatch.invoice_kind;
  delete legacyPatch.amount_paid;
  delete legacyPatch.cancellation_reason;
  const { data: legacyData, error: legacyErr } = await supabase
    .from("invoices")
    .update(legacyPatch)
    .eq("id", id)
    .select()
    .single();
  if (!legacyErr) return legacyData as Invoice;
  throw legacyErr;
}

/**
 * When jobs are archived (soft-deleted), drop linked invoices from the Invoices tab:
 * soft-delete by `job_reference`, and any primary `invoice_id` on the job (in case reference drift).
 * Status is set to `cancelled` for accounting clarity.
 */
export async function softDeleteInvoicesForArchivedJobs(
  jobs: { reference: string; invoice_id?: string | null }[],
  deletedBy?: string
): Promise<void> {
  const supabase = getSupabase();
  const refs = [...new Set(jobs.map((j) => j.reference).filter((r) => r != null && String(r).trim() !== ""))];
  const ts = new Date().toISOString();
  const payload: { deleted_at: string; deleted_by?: string; status: Invoice["status"] } = {
    deleted_at: ts,
    status: "cancelled",
  };
  if (deletedBy) payload.deleted_by = deletedBy;

  if (refs.length > 0) {
    const { error } = await supabase.from("invoices").update(payload).in("job_reference", refs).is("deleted_at", null);
    if (error) throw error;
  }

  const primaryIds = [...new Set(jobs.map((j) => j.invoice_id).filter((id): id is string => id != null && String(id).trim() !== ""))];
  if (primaryIds.length > 0) {
    /** One bulk update instead of N sequential PATCHes (was O(jobs) round-trips). */
    const { error } = await supabase.from("invoices").update(payload).in("id", primaryIds).is("deleted_at", null);
    if (error) throw error;
  }
}

const OPEN_INVOICE_STATUSES: InvoiceStatus[] = ["draft", "pending", "awaiting_payment", "partially_paid", "overdue"];

/**
 * When a job is cancelled, cancel open invoices tied to that job and store the same reason as on the job.
 * Skips paid / already cancelled / soft-deleted rows.
 * Skips `weekly_batch` (same row can aggregate multiple jobs in a week — do not void the whole batch).
 */
export async function cancelOpenInvoicesForJobCancellation(options: {
  jobReference: string;
  cancellationReason: string;
  primaryInvoiceId?: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const ref = options.jobReference?.trim();
  if (!ref) return;
  const reason = options.cancellationReason?.trim() || "Job cancelled.";

  const collectEligibleIds = async (): Promise<string[]> => {
    const ids = new Set<string>();

    const { data: byRef, error: e1 } = await supabase
      .from("invoices")
      .select("id, invoice_kind")
      .eq("job_reference", ref)
      .is("deleted_at", null)
      .in("status", OPEN_INVOICE_STATUSES);
    if (e1) throw e1;
    for (const r of byRef ?? []) {
      const row = r as { id: string; invoice_kind?: string | null };
      if (row.invoice_kind === "weekly_batch") continue;
      ids.add(row.id);
    }

    const pid = options.primaryInvoiceId?.trim();
    if (pid) {
      const { data: primary, error: e2 } = await supabase
        .from("invoices")
        .select("id, status, invoice_kind")
        .eq("id", pid)
        .is("deleted_at", null)
        .maybeSingle();
      if (e2) throw e2;
      const p = primary as { id: string; status: string; invoice_kind?: string | null } | null;
      if (
        p &&
        OPEN_INVOICE_STATUSES.includes(p.status as InvoiceStatus) &&
        p.invoice_kind !== "weekly_batch"
      ) {
        ids.add(p.id);
      }
    }

    return [...ids];
  };

  const idList = await collectEligibleIds();
  if (idList.length === 0) return;

  const withReason = { status: "cancelled" as const, cancellation_reason: reason };
  const { error } = await supabase.from("invoices").update(withReason).in("id", idList);
  if (error && isSupabaseMissingColumnError(error)) {
    const { error: e2 } = await supabase.from("invoices").update({ status: "cancelled" }).in("id", idList);
    if (e2) throw e2;
  } else if (error) {
    throw error;
  }
}
