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
import {
  buildJobConfirmationHtml,
  formatJobConfirmationArrivalWindow,
  formatJobConfirmationLongDate,
  resolveCustomerGreetingName,
  splitPropertyAddressAndPostcode,
} from "@/lib/zendesk-job-confirmation";
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

const CLIENT_CONFIRMATION_STATUSES = new Set(["scheduled", "late"]);

async function resolveJobTypeOfWorkLabel(
  supabase: SupabaseClient,
  catalogServiceId: string | null | undefined,
  title: string | null | undefined,
): Promise<string> {
  const id = catalogServiceId?.trim();
  if (id) {
    const { data } = await supabase
      .from("service_catalog")
      .select("name")
      .eq("id", id)
      .maybeSingle();
    const name = (data as { name?: string | null } | null)?.name?.trim();
    if (name) return name;
  }
  return title?.trim() || "Maintenance";
}

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

type ClientRel = { full_name?: string | null };

function clientNameFromEmbed(row: {
  client_name?: string | null;
  clients?: ClientRel | ClientRel[] | null;
}): string {
  const denorm = row.client_name?.trim() ?? "";
  if (denorm) return denorm;
  const clientRowRaw = row.clients;
  const clientRow = Array.isArray(clientRowRaw) ? (clientRowRaw[0] ?? null) : (clientRowRaw ?? null);
  return clientRow?.full_name?.trim() ?? "";
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
}): Promise<{ ok: boolean; mainPosted?: boolean; sideConvId?: string | null; skipped?: string; error?: string }> {
  const supabase = args.client ?? createServiceClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      id, reference, title, property_address, scope, status,
      scheduled_date, scheduled_start_at, scheduled_end_at, total_value,
      catalog_service_id,
      external_source, external_ref, partner_id, partner_confirmed_at, client_id, client_name,
      zendesk_side_conversation_id,
      job_creation_notice_sent_at,
      clients ( full_name ),
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

  if ((job as { job_creation_notice_sent_at?: string | null }).job_creation_notice_sent_at) {
    return { ok: true };
  }

  const jobStatus = String((job as { status?: string | null }).status ?? "");
  const dateStr = String(job.scheduled_date ?? "").slice(0, 10);
  if (!CLIENT_CONFIRMATION_STATUSES.has(jobStatus) || !dateStr) {
    return { ok: true, skipped: "not_scheduled" };
  }

  // Idempotent claim — only after we know the job is booked. Unassigned jobs
  // created in the OS skip here without claiming so a later transition to
  // scheduled can still send the customer confirmation.
  const { data: claimed } = await supabase
    .from("jobs")
    .update({ job_creation_notice_sent_at: new Date().toISOString() })
    .eq("id", args.jobId)
    .is("job_creation_notice_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: true };

  const clientNameFallback = clientNameFromEmbed(job as { client_name?: string | null; clients?: ClientRel | ClientRel[] | null });

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

  let organizationName: string | null = null;
  if (clientAccountId) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("company_name, contact_name")
      .eq("id", clientAccountId)
      .is("deleted_at", null)
      .maybeSingle();
    const row = acct as { company_name?: string | null; contact_name?: string | null } | null;
    organizationName = row?.company_name?.trim() || row?.contact_name?.trim() || null;
  }

  const greetingName = resolveCustomerGreetingName(organizationName, clientName);
  const { propertyAddress, propertyPostcode } = splitPropertyAddressAndPostcode(
    String(job.property_address ?? ""),
  );
  const typeOfWork = await resolveJobTypeOfWorkLabel(
    supabase,
    (job as { catalog_service_id?: string | null }).catalog_service_id,
    String(job.title ?? ""),
  );

  const html = buildJobConfirmationHtml({
    greetingName,
    jobReference: String(job.reference ?? ""),
    jobTitle: String(job.title ?? "Maintenance job"),
    jobDate: formatJobConfirmationLongDate(dateStr),
    arrivalWindow: formatJobConfirmationArrivalWindow({
      scheduled_start_at: job.scheduled_start_at,
      scheduled_end_at: (job as { scheduled_end_at?: string | null }).scheduled_end_at,
    }),
    propertyAddress,
    propertyPostcode,
    typeOfWork,
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
      const scheduledHour = job.scheduled_start_at
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/London",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }).format(new Date(String(job.scheduled_start_at)))
        : "";

      const sideConvBody = buildPartnerJobConfirmedSideConvBody({
        reference: String(job.reference ?? ""),
        title: String(job.title ?? ""),
        scheduledDate: dateStr,
        scheduledHour,
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
      id, reference, title, status, client_name,
      external_source, external_ref, partner_id, zendesk_side_conversation_id,
      cancellation_reason, cancellation_notice_sent_at, completion_notice_sent_at,
      clients ( full_name ),
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

  const clientName = clientNameFromEmbed(job as { client_name?: string | null; clients?: ClientRel | ClientRel[] | null });

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

  // Partner "Job cancelled" email is sent via notifyPartnerJobZendesk (office cancel /
  // useCancelJob). This lifecycle step only posts the public customer notice on the ticket.

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
      id, reference, status, client_name,
      external_source, external_ref,
      rejection_reason, rejection_notice_sent_at,
      clients ( full_name )
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

  const clientName = clientNameFromEmbed(quote as { client_name?: string | null; clients?: ClientRel | ClientRel[] | null });

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
