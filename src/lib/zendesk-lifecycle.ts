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
  replyToSideConversation,
  getZendeskTicketId,
  getTicketRequester,
  setTicketRequester,
  isZendeskConfigured,
  updateTicket as zdUpdateTicket,
} from "@/lib/zendesk";
import { syncAccountToZendesk } from "@/lib/zendesk-account-sync";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { buildJobConfirmationHtml } from "@/lib/zendesk-job-confirmation";
import {
  buildJobCancelledHtml,
  buildJobCompletedHtml,
  buildPartnerJobConfirmedSideConvBody,
  buildQuoteRejectedHtml,
} from "@/lib/zendesk-lifecycle-templates";
import { createPartnerReportToken } from "@/lib/quote-response-token";
import { upsertShortLink, jobPartnerShortLinkEntityRef } from "@/lib/short-links";
import { appBaseUrl } from "@/lib/app-base-url";

type PartnerEmbed = {
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  zendesk_user_id?: number | string | null;
};

function partnerFromJobEmbed(job: unknown): {
  email: string;
  name: string;
  zendeskUserId?: string;
} {
  const partnerRow = (job as { partners?: PartnerEmbed | PartnerEmbed[] | null }).partners;
  const p = Array.isArray(partnerRow) ? partnerRow[0] : partnerRow;
  return {
    email: p?.email?.trim() ?? "",
    name: p?.company_name?.trim() || p?.contact_name?.trim() || "",
    zendeskUserId: p?.zendesk_user_id != null ? String(p.zendesk_user_id) : undefined,
  };
}

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
      external_source, external_ref, partner_id, partner_confirmed_at, client_id,
      zendesk_side_conversation_id,
      job_creation_notice_sent_at,
      clients ( name ),
      partners ( company_name, contact_name, email, zendesk_user_id )
    `)
    .eq("id", args.jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };

  // Idempotent claim. Two triggers fire on job creation — the /api/jobs call
  // and the AFTER INSERT DB trigger (via /api/internal/zendesk/sync-status). A
  // check-then-set would let both through (both read null) and post the partner
  // "Job confirmed" side conversation twice. Claim the slot atomically so only
  // the first caller proceeds; the loser sees 0 rows and bails.
  if ((job as { job_creation_notice_sent_at?: string | null }).job_creation_notice_sent_at) {
    return { ok: true };
  }
  const { data: claimed } = await supabase
    .from("jobs")
    .update({ job_creation_notice_sent_at: new Date().toISOString() })
    .eq("id", args.jobId)
    .is("job_creation_notice_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: true }; // another trigger already claimed → skip

  type ClientRel = { name?: string | null };
  const clientRowRaw = (job as unknown as { clients?: ClientRel | ClientRel[] | null }).clients;
  const clientRow: ClientRel | null = Array.isArray(clientRowRaw) ? (clientRowRaw[0] ?? null) : (clientRowRaw ?? null);
  const clientNameFallback = clientRow?.name ?? "";

  // Resolve the customer-facing recipient the same way quotes/invoices do — the
  // account's billing_type decides between the account email (B2B) and the end
  // client's email (B2C). Keeps job confirmation consistent with every other
  // customer send.
  const jobClientId = (job as { client_id?: string | null }).client_id?.trim() ?? "";
  const billing = await resolveNominalBillingParty(supabase, {
    clientId: jobClientId,
    fallbackName: clientNameFallback,
  });
  const clientName = billing.displayName || clientNameFallback;
  const clientEmail = billing.documentEmail?.trim() ?? "";
  const clientAccountId = billing.sourceAccountId?.trim() ?? "";

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

  // Make the booking confirmation reach the CUSTOMER on this ticket. Jobs
  // created in the OS open a ticket with team@getfixfy.com as requester (and a
  // private opening note), so a public comment would land in the team inbox.
  // Flip the requester to the customer (only when the ticket is still the
  // internal team@ one — never hijack a macro/quote-origin ticket that already
  // has a real customer) and file it under the account's Zendesk organization.
  // Mirrors the quote send-pdf flow.
  const TEAM_REQUESTER = "team@getfixfy.com";
  if (clientEmail.includes("@") && clientEmail.toLowerCase() !== TEAM_REQUESTER) {
    try {
      const cur = await getTicketRequester(ticketId);
      if (cur.ok && cur.requesterEmail === TEAM_REQUESTER) {
        let orgId: string | null = null;
        if (clientAccountId) {
          const { data: acct } = await supabase
            .from("accounts")
            .select("zendesk_organization_id")
            .eq("id", clientAccountId)
            .maybeSingle();
          orgId = (acct as { zendesk_organization_id?: string | null } | null)?.zendesk_organization_id ?? null;
          if (!orgId) {
            const sync = await syncAccountToZendesk(clientAccountId);
            orgId = sync.ok ? (sync.organizationId ?? null) : null;
          }
        }
        const set = await setTicketRequester({
          ticketId,
          email:          clientEmail,
          name:           clientName || null,
          entityId:       clientAccountId || String(job.id),
          organizationId: orgId ?? undefined,
        });
        if (!set.ok) {
          console.warn("[zendesk-lifecycle] dispatchJobCreated setTicketRequester failed:", set.error);
        }
      } else if (!cur.ok) {
        console.warn(
          "[zendesk-lifecycle] dispatchJobCreated could not read requester for ticket", ticketId,
          "— skipping reassignment (conservative).", cur.error,
        );
      }
    } catch (err) {
      console.error("[zendesk-lifecycle] dispatchJobCreated requester reassignment failed:", err);
    }
  }

  let mainPosted = false;
  try {
    await zdUpdateTicket({ ticketId, htmlBody: html, publicComment: true });
    mainPosted = true;
  } catch (err) {
    console.error("[zendesk-lifecycle] dispatchJobCreated main reply failed:", err);
  }

  // Partner side conv here only when a partner is on the job but not yet office-confirmed
  // (e.g. quote accept). Create Job with a manual partner sets partner_confirmed_at and
  // fires `assigned` via notifyPartnerJobZendesk — skip to avoid a duplicate thread.
  let sideConvId: string | null =
    (job as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null;

  const { email: partnerEmail, name: partnerName, zendeskUserId } = partnerFromJobEmbed(job);
  const partnerConfirmed = Boolean(
    (job as { partner_confirmed_at?: string | null }).partner_confirmed_at,
  );

  if (!sideConvId && job.partner_id && partnerEmail && !partnerConfirmed) {
    try {
      // Build the partner-scoped report URL up front and include it as the
      // primary CTA so the partner can submit the report without waiting
      // for a separate email or having the app installed.
      const reportToken = createPartnerReportToken(String(job.id), String(job.partner_id));
      const base = appBaseUrl();
      const reportTargetPath = `/job/report?token=${encodeURIComponent(reportToken)}`;
      let reportShortPath = reportTargetPath;
      try {
        const r = await upsertShortLink({
          targetPath: reportTargetPath,
          kind:       "partner_report",
          entityRef: jobPartnerShortLinkEntityRef(String(job.id), String(job.partner_id), "report"),
        });
        reportShortPath = r.shortPath;
      } catch (err) {
        console.error("[zendesk-lifecycle] short link upsert for report failed:", err);
      }
      const reportUrl = `${base}${reportShortPath}`;

      const sideConvBody = buildPartnerJobConfirmedSideConvBody({
        reference: String(job.reference ?? ""),
        title: String(job.title ?? ""),
        scheduledDate: dateStr,
        scheduledHour: hour,
        propertyAddress: String(job.property_address ?? ""),
        scope: (job.scope as string | null) ?? null,
        reportUrl,
      });
      const result = await createSideConversation({
        ticketId,
        toEmail: partnerEmail,
        toName: partnerName || null,
        toUserId: zendeskUserId,
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

  // job_creation_notice_sent_at was already claimed atomically at the top.
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
      external_source, external_ref, partner_id, zendesk_side_conversation_id,
      cancellation_reason, cancellation_notice_sent_at, completion_notice_sent_at,
      clients ( name ),
      partners ( company_name, contact_name, email, zendesk_user_id )
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

  // The public ticket comment above only reaches the customer. On cancellation
  // (e.g. an on-hold job being scrapped) the assigned partner must also be told
  // in their own side-conversation thread, otherwise they keep expecting the
  // job. Reply on the existing thread, or open one if none exists yet.
  // Non-fatal: a side-conv failure must not block marking the notice as sent.
  if (args.status === "cancelled" && job.partner_id) {
    const { email: partnerEmail, name: partnerName, zendeskUserId: partnerUserId } =
      partnerFromJobEmbed(job);

    if (partnerEmail) {
      const partnerHtml = buildJobCancelledHtml({
        customerName: partnerName,
        reference: String(job.reference ?? ""),
        title: String(job.title ?? ""),
        reason: (job.cancellation_reason as string | null) ?? null,
      });
      const existingScId =
        (job as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null;
      try {
        if (existingScId) {
          await replyToSideConversation({
            ticketId,
            sideConversationId: existingScId,
            toEmail: partnerEmail,
            toName: partnerName || undefined,
            toUserId: partnerUserId,
            htmlBody: partnerHtml,
          });
        } else {
          const created = await createSideConversation({
            ticketId,
            toEmail: partnerEmail,
            toName: partnerName || undefined,
            toUserId: partnerUserId,
            subject: `Job cancelled — #${job.reference}`,
            htmlBody: partnerHtml,
          });
          if (created.ok && created.id) {
            await supabase
              .from("jobs")
              .update({ zendesk_side_conversation_id: created.id })
              .eq("id", args.jobId);
          }
        }
      } catch (err) {
        console.error("[zendesk-lifecycle] cancel partner side conv failed:", err);
      }
    }
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
