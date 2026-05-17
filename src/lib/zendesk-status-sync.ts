/**
 * OS → Zendesk status sync.
 *
 * Single place that maps internal job/quote status onto the linked Zendesk
 * ticket's custom_status_id. Called both directly from API routes and
 * indirectly from the Postgres trigger that fires on `jobs.status` /
 * `quotes.status` updates (see migration 166_zendesk_status_sync_trigger.sql).
 *
 * Idempotent and side-effect-only — safe to call repeatedly. Skips silently
 * when the entity isn't Zendesk-linked or Zendesk isn't configured.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getZendeskTicketId, isZendeskConfigured, updateTicket as zdUpdateTicket } from "@/lib/zendesk";
import {
  ZD_STATUS_AWAITING_APPROVAL,
  ZD_STATUS_BIDDING,
  ZD_STATUS_CANCELLED,
  ZD_STATUS_COMPLETED,
  ZD_STATUS_FINAL_CHECKS,
  ZD_STATUS_IN_PROGRESS,
  ZD_STATUS_LOST,
  ZD_STATUS_ON_HOLD,
  ZD_STATUS_READY_TO_QUOTE,
  ZD_STATUS_SCHEDULED,
  ZD_STATUS_UNASSIGNED,
} from "@/lib/zendesk-statuses";
import type { JobStatus, QuoteStatus } from "@/types/database";

// ─── Status maps ─────────────────────────────────────────────────────────────

/**
 * Maps internal quote.status → Zendesk custom_status_id.
 * Returns null for statuses that intentionally don't update the ticket
 * (e.g. converted_to_job — handled by the job sync instead).
 */
export function quoteStatusToZendesk(status: QuoteStatus): number | null {
  switch (status) {
    case "draft":
      return ZD_STATUS_READY_TO_QUOTE;
    case "in_survey":
    case "bidding":
      return ZD_STATUS_BIDDING;
    case "awaiting_customer":
    case "awaiting_payment":
      return ZD_STATUS_AWAITING_APPROVAL;
    case "rejected":
      return ZD_STATUS_LOST;
    case "converted_to_job":
      // Job takes over the ticket lifecycle from here.
      return null;
    default:
      return null;
  }
}

/**
 * Maps internal job.status → Zendesk custom_status_id.
 * Returns null for `deleted` (soft-deleted jobs should not touch the ticket).
 */
export function jobStatusToZendesk(status: JobStatus): number | null {
  switch (status) {
    case "unassigned":
    case "auto_assigning":
      return ZD_STATUS_UNASSIGNED;
    case "scheduled":
    case "late":
    case "need_attention":
      return ZD_STATUS_SCHEDULED;
    case "in_progress":
      return ZD_STATUS_IN_PROGRESS;
    case "final_check":
      return ZD_STATUS_FINAL_CHECKS;
    /** Work is done; only payment collection is pending. From the customer's
     *  perspective the support thread is closed, so flip the ticket to
     *  Completed (which auto-solves it in Zendesk). If finance moves the job
     *  back to final_check / in_progress, the trigger fires again and the
     *  ticket re-opens to the right status. */
    case "awaiting_payment":
    case "completed":
      return ZD_STATUS_COMPLETED;
    case "on_hold":
      return ZD_STATUS_ON_HOLD;
    case "cancelled":
      return ZD_STATUS_CANCELLED;
    case "deleted":
      return null;
    default:
      return null;
  }
}

// ─── Sync result ─────────────────────────────────────────────────────────────

export type ZendeskSyncSkipReason =
  | "not_zendesk_linked"
  | "no_ticket_id"
  | "zendesk_not_configured"
  | "no_status_mapping"
  | "entity_not_found";

export interface ZendeskSyncResult {
  ok: boolean;
  /** True when we made an API call to Zendesk. False when we skipped or errored. */
  synced: boolean;
  ticketId?: string;
  customStatusId?: number;
  /** When synced=false, why we skipped. */
  skip?: ZendeskSyncSkipReason;
  /** When ok=false, the error message. */
  error?: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sync the linked Zendesk ticket's custom_status_id to reflect the current
 * status of a job. No-ops if the job isn't Zendesk-linked.
 */
export async function syncJobZendeskStatus(
  jobId: string,
  client?: SupabaseClient,
): Promise<ZendeskSyncResult> {
  const supabase = client ?? createServiceClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, status, external_source, external_ref")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return { ok: false, synced: false, error: error?.message ?? "Job not found", skip: "entity_not_found" };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) {
    return { ok: true, synced: false, skip: job.external_source === "zendesk" ? "no_ticket_id" : "not_zendesk_linked" };
  }
  if (!isZendeskConfigured()) {
    return { ok: true, synced: false, skip: "zendesk_not_configured" };
  }

  const customStatusId = jobStatusToZendesk(job.status as JobStatus);
  if (customStatusId == null) {
    return { ok: true, synced: false, ticketId, skip: "no_status_mapping" };
  }

  try {
    await zdUpdateTicket({ ticketId, customStatusId });
    return { ok: true, synced: true, ticketId, customStatusId };
  } catch (err) {
    return {
      ok: false,
      synced: false,
      ticketId,
      customStatusId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sync the linked Zendesk ticket's custom_status_id to reflect the current
 * status of a quote. No-ops if the quote isn't Zendesk-linked.
 */
export async function syncQuoteZendeskStatus(
  quoteId: string,
  client?: SupabaseClient,
): Promise<ZendeskSyncResult> {
  const supabase = client ?? createServiceClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("id, status, external_source, external_ref")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return { ok: false, synced: false, error: error?.message ?? "Quote not found", skip: "entity_not_found" };
  }

  const ticketId = getZendeskTicketId(quote);
  if (!ticketId) {
    return { ok: true, synced: false, skip: quote.external_source === "zendesk" ? "no_ticket_id" : "not_zendesk_linked" };
  }
  if (!isZendeskConfigured()) {
    return { ok: true, synced: false, skip: "zendesk_not_configured" };
  }

  const customStatusId = quoteStatusToZendesk(quote.status as QuoteStatus);
  if (customStatusId == null) {
    return { ok: true, synced: false, ticketId, skip: "no_status_mapping" };
  }

  try {
    await zdUpdateTicket({ ticketId, customStatusId });
    return { ok: true, synced: true, ticketId, customStatusId };
  } catch (err) {
    return {
      ok: false,
      synced: false,
      ticketId,
      customStatusId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
