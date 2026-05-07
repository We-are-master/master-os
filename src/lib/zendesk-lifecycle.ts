/**
 * OS → Zendesk lifecycle side effects.
 *
 * The status custom_status_id is synced by `zendesk-status-sync.ts` (Fase 1+2).
 * This module fires the *one-shot* customer/partner notifications that should
 * accompany terminal/major lifecycle transitions:
 *
 *   - Job created from accepted quote → public reply on main ticket +
 *     partner side conversation ("Job confirmed").
 *   - Job completed                   → short public reply ("Job done").
 *   - Job cancelled                   → short public reply ("Job cancelled").
 *   - Quote rejected                  → short public reply ("Quote closed").
 *
 * Each notice is idempotent via a `*_notice_sent_at` timestamp on the entity.
 * The functions accept either an explicit Supabase client (for callers that
 * already have one open) or build a service-role client lazily.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createSideConversation,
  getZendeskTicketId,
  isZendeskConfigured,
  updateTicket as zdUpdateTicket,
} from "@/lib/zendesk";
import { buildJobConfirmationHtml } from "@/lib/zendesk-job-confirmation";
import {
  buildJobCancelledHtml,
  buildJobCompletedHtml,
  buildPartnerJobConfirmedSideConvBody,
  buildQuoteRejectedHtml,
} from "@/lib/zendesk-lifecycle-templates";

// ─── Job creation (accept flow) ──────────────────────────────────────────────

/**
 * Post the customer-facing booking confirmation on the main Zendesk ticket
 * and, if a partner is assigned, open a "Job confirmed" side conversation.
 * Safe to call from any server context — silent no-op when not configured.
 */
export async function dispatchJobCreatedZendesk(args: {
  jobId: string;
  client?: SupabaseClient;
}): Promise<{ ok: boolean; mainPosted?: boolean; sideConvId?: string | null; error?: string }> {
  const supabase = args.client ?? createServiceClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      id, reference, title, property_address, scope,
      scheduled_date, scheduled_start_at, total_value,
      external_source, external_ref, partner_id,
      zendesk_side_conversation_id,
      job_creation_notice_sent_at,
      clients ( name ),
      partners ( name, email )
    `)
    .eq("id", args.jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };

  // Idempotent — already dispatched.
  if ((job as { job_creation_notice_sent_at?: string | null }).job_creation_notice_sent_at) {
    return { ok: true };
  }

  const clientRow = (job as unknown as { clients?: { name?: string | null } | { name?: string | null }[] | null }).clients;
  const clientName =
    Array.isArray(clientRow) ? (clientRow[0]?.name ?? "") : (clientRow?.name ?? "");

  const dateStr = String(job.scheduled_date ?? "").slice(0, 10);
  const hour = job.scheduled_start_at
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(String(job.scheduled_start_at)))
    : "";

  const html = buildJobConfirmationHtml({
    customerName: clientName,
    reference: String(job.reference ?? ""),
    title: String(job.title ?? ""),
    propertyAddress: String(job.property_address ?? ""),
    scope: (job.scope as string | null) ?? null,
    scheduledDate: dateStr,
    scheduledHour: hour,
    totalGbp: Number(job.total_value ?? 0),
  });

  let mainPosted = false;
  try {
    await zdUpdateTicket({ ticketId, htmlBody: html, publicComment: true });
    mainPosted = true;
  } catch (err) {
    console.error("[zendesk-lifecycle] dispatchJobCreated main reply failed:", err);
  }

  // Open partner side conversation if a partner is already on the job.
  let sideConvId: string | null =
    (job as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null;

  const partnerRow = (job as unknown as { partners?: { name?: string | null; email?: string | null } | { name?: string | null; email?: string | null }[] | null }).partners;
  const partner = Array.isArray(partnerRow) ? partnerRow[0] : partnerRow;
  const partnerEmail = partner?.email?.trim() ?? "";
  const partnerName = partner?.name?.trim() ?? "";

  if (!sideConvId && job.partner_id && partnerEmail) {
    try {
      const sideConvBody = buildPartnerJobConfirmedSideConvBody({
        reference: String(job.reference ?? ""),
        title: String(job.title ?? ""),
        scheduledDate: dateStr,
        scheduledHour: hour,
        propertyAddress: String(job.property_address ?? ""),
        scope: (job.scope as string | null) ?? null,
      });
      const result = await createSideConversation({
        ticketId,
        toEmail: partnerEmail,
        toName: partnerName || null,
        subject: `Job confirmed — #${String(job.reference ?? "")}`,
        htmlBody: sideConvBody,
      });
      if (result.ok && result.id) {
        sideConvId = result.id;
        await supabase
          .from("jobs")
          .update({ zendesk_side_conversation_id: sideConvId })
          .eq("id", args.jobId);
      }
    } catch (err) {
      console.error("[zendesk-lifecycle] dispatchJobCreated side conv failed:", err);
    }
  }

  await supabase
    .from("jobs")
    .update({ job_creation_notice_sent_at: new Date().toISOString() })
    .eq("id", args.jobId);

  return { ok: true, mainPosted, sideConvId };
}

// ─── Terminal lifecycle notices ──────────────────────────────────────────────

async function dispatchJobTerminalNotice(args: {
  jobId: string;
  status: "completed" | "cancelled";
  client?: SupabaseClient;
}): Promise<{ ok: boolean; posted?: boolean; error?: string }> {
  const supabase = args.client ?? createServiceClient();
  const sentColumn =
    args.status === "completed" ? "completion_notice_sent_at" : "cancellation_notice_sent_at";

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      id, reference, title, status,
      external_source, external_ref,
      cancellation_reason, cancellation_notice_sent_at, completion_notice_sent_at,
      clients ( name )
    `)
    .eq("id", args.jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }
  const ticketId = getZendeskTicketId(job);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };
  if (job.status !== args.status) return { ok: true }; // status drifted — skip
  if ((job as Record<string, unknown>)[sentColumn]) return { ok: true };

  const clientRow = (job as unknown as { clients?: { name?: string | null } | { name?: string | null }[] | null }).clients;
  const clientName =
    Array.isArray(clientRow) ? (clientRow[0]?.name ?? "") : (clientRow?.name ?? "");

  const html =
    args.status === "completed"
      ? buildJobCompletedHtml({
          customerName: clientName,
          reference: String(job.reference ?? ""),
          title: String(job.title ?? ""),
        })
      : buildJobCancelledHtml({
          customerName: clientName,
          reference: String(job.reference ?? ""),
          title: String(job.title ?? ""),
          reason: (job.cancellation_reason as string | null) ?? null,
        });

  try {
    await zdUpdateTicket({ ticketId, htmlBody: html, publicComment: true });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await supabase.from("jobs").update({ [sentColumn]: new Date().toISOString() }).eq("id", args.jobId);
  return { ok: true, posted: true };
}

export function dispatchJobCompletedZendesk(jobId: string, client?: SupabaseClient) {
  return dispatchJobTerminalNotice({ jobId, status: "completed", client });
}

export function dispatchJobCancelledZendesk(jobId: string, client?: SupabaseClient) {
  return dispatchJobTerminalNotice({ jobId, status: "cancelled", client });
}

export async function dispatchQuoteRejectedZendesk(
  quoteId: string,
  client?: SupabaseClient,
): Promise<{ ok: boolean; posted?: boolean; error?: string }> {
  const supabase = client ?? createServiceClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select(`
      id, reference, status,
      external_source, external_ref,
      rejection_reason, rejection_notice_sent_at,
      clients ( name )
    `)
    .eq("id", quoteId)
    .maybeSingle();

  if (error || !quote) {
    return { ok: false, error: error?.message ?? "Quote not found" };
  }
  const ticketId = getZendeskTicketId(quote);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };
  if (quote.status !== "rejected") return { ok: true };
  if ((quote as { rejection_notice_sent_at?: string | null }).rejection_notice_sent_at) {
    return { ok: true };
  }

  const clientRow = (quote as unknown as { clients?: { name?: string | null } | { name?: string | null }[] | null }).clients;
  const clientName =
    Array.isArray(clientRow) ? (clientRow[0]?.name ?? "") : (clientRow?.name ?? "");

  const html = buildQuoteRejectedHtml({
    customerName: clientName,
    reference: String(quote.reference ?? ""),
    title: "your quote",
    reason: (quote.rejection_reason as string | null) ?? null,
  });

  try {
    await zdUpdateTicket({ ticketId, htmlBody: html, publicComment: true });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  await supabase
    .from("quotes")
    .update({ rejection_notice_sent_at: new Date().toISOString() })
    .eq("id", quoteId);

  return { ok: true, posted: true };
}
