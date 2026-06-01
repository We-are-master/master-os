import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerReportToken } from "@/lib/quote-response-token";
import {
  closeSideConversation,
  createSideConversation,
  replyToSideConversation,
} from "@/lib/zendesk";
import { buildPartnerJobConfirmationEmail } from "@/lib/emails/partner-job-confirmation";
import { upsertShortLink, jobPartnerShortLinkEntityRef } from "@/lib/short-links";
import { appBaseUrl } from "@/lib/app-base-url";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";

export type JobForPartnerAcceptance = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  partner_id: string | null;
  client_name: string | null;
  property_address: string | null;
  scheduled_date: string | null;
  catalog_service_id: string | null;
  scope: string | null;
  job_type: "hourly" | "fixed" | null;
  hourly_partner_rate: number | null;
  partner_cost: number | null;
  external_source: string | null;
  external_ref: string | null;
  zendesk_side_conversation_id: string | null;
  partner_booked_email_sent_at?: string | null;
};

export type PartnerForAcceptance = {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  email: string | null;
  zendesk_user_id: string | null;
};

const JOB_SELECT =
  "id, reference, title, status, partner_id, partner_confirmed_at, client_name, property_address, scheduled_date, catalog_service_id, scope, job_type, hourly_partner_rate, partner_cost, auto_assign_invited_partner_ids, external_source, external_ref, zendesk_side_conversation_id, partner_booked_email_sent_at";

/** Atomically claim the one-time Job booked email send for this job. */
async function tryClaimPartnerBookedEmailSend(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("jobs")
    .update({ partner_booked_email_sent_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("partner_booked_email_sent_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[booked reply] claim failed:", error);
    return false;
  }
  return Boolean(data);
}

async function resolveBookedSideConversationId(
  supabase: SupabaseClient,
  jobId: string,
  partnerId: string,
  fallback: string | null,
): Promise<string | null> {
  if (fallback) return fallback;

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("zendesk_side_conversation_id")
    .eq("id", jobId)
    .maybeSingle();
  const onJob = (jobRow as { zendesk_side_conversation_id: string | null } | null)
    ?.zendesk_side_conversation_id;
  if (onJob) return onJob;

  const { data: inviteRow } = await supabase
    .from("job_partner_invites")
    .select("zendesk_side_conversation_id")
    .eq("job_id", jobId)
    .eq("partner_id", partnerId)
    .maybeSingle();
  return (inviteRow as { zendesk_side_conversation_id: string | null } | null)
    ?.zendesk_side_conversation_id ?? null;
}

export async function loadJobForPartnerAcceptance(
  supabase: SupabaseClient,
  jobId: string,
): Promise<(JobForPartnerAcceptance & { partner_confirmed_at: string | null; auto_assign_invited_partner_ids: string[] | null }) | null> {
  const { data } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  return data as (JobForPartnerAcceptance & { partner_confirmed_at: string | null; auto_assign_invited_partner_ids: string[] | null }) | null;
}

export async function loadPartnerForAcceptance(
  supabase: SupabaseClient,
  partnerId: string,
): Promise<PartnerForAcceptance | null> {
  const { data } = await supabase
    .from("partners")
    .select("id, contact_name, company_name, email, zendesk_user_id")
    .eq("id", partnerId)
    .maybeSingle();
  return data as PartnerForAcceptance | null;
}

export function partnerDisplayName(partner: PartnerForAcceptance): string {
  return partner.contact_name?.trim() || partner.company_name?.trim() || "Partner";
}

/** After auto-assign winner is set on the job — invite bookkeeping + Job booked side conv. */
export async function finalizeAutoAssignWinner(args: {
  supabase?: SupabaseClient;
  jobId: string;
  partnerId: string;
  job: JobForPartnerAcceptance;
  partner: PartnerForAcceptance;
  partnerName?: string | null;
}): Promise<{ winnerSideConvId: string | null }> {
  const supabase = args.supabase ?? createServiceClient();
  const now = new Date().toISOString();
  const partnerName =
    args.partnerName?.trim() ||
    args.partner.contact_name?.trim() ||
    args.partner.company_name?.trim() ||
    null;

  const { data: invitesData } = await supabase
    .from("job_partner_invites")
    .select("partner_id, zendesk_side_conversation_id, status")
    .eq("job_id", args.jobId);
  const invites = (invitesData ?? []) as Array<{
    partner_id: string;
    zendesk_side_conversation_id: string | null;
    status: string;
  }>;

  const winnerInvite = invites.find((i) => i.partner_id === args.partnerId);
  const losers = invites.filter((i) => i.partner_id !== args.partnerId);
  const winnerSideConvId = winnerInvite?.zendesk_side_conversation_id ?? null;

  if (winnerInvite) {
    await supabase
      .from("job_partner_invites")
      .update({ status: "accepted", decided_at: now })
      .eq("job_id", args.jobId)
      .eq("partner_id", args.partnerId);
  } else {
    await supabase.from("job_partner_invites").upsert(
      {
        job_id: args.jobId,
        partner_id: args.partnerId,
        status: "accepted",
        invited_at: now,
        decided_at: now,
      },
      { onConflict: "job_id,partner_id" },
    );
  }

  if (losers.length > 0) {
    await supabase
      .from("job_partner_invites")
      .update({ status: "lost", decided_at: now })
      .eq("job_id", args.jobId)
      .neq("partner_id", args.partnerId);

    const zendeskTicketId =
      args.job.external_source === "zendesk" ? args.job.external_ref : null;
    if (zendeskTicketId) {
      for (const loser of losers) {
        if (!loser.zendesk_side_conversation_id) continue;
        void closeSideConversation({
          ticketId: zendeskTicketId,
          sideConversationId: loser.zendesk_side_conversation_id,
        }).catch((err) => console.error("[finalizeAutoAssignWinner] close loser side conv failed:", err));
      }
    }
  }

  let sideConvId = args.job.zendesk_side_conversation_id ?? winnerSideConvId;
  if (winnerSideConvId && !args.job.zendesk_side_conversation_id) {
    await supabase
      .from("jobs")
      .update({ zendesk_side_conversation_id: winnerSideConvId })
      .eq("id", args.jobId);
    sideConvId = winnerSideConvId;
  }

  await sendBookedSideConvReply({
    supabase,
    job: {
      ...args.job,
      status: "scheduled",
      partner_id: args.partnerId,
      zendesk_side_conversation_id: sideConvId,
    },
    partner: args.partner,
    partnerName,
  });

  return { winnerSideConvId: sideConvId };
}

export async function sendBookedSideConvReply(args: {
  supabase?: SupabaseClient;
  job: JobForPartnerAcceptance;
  partner: PartnerForAcceptance;
  partnerName: string | null;
}): Promise<boolean> {
  const { job, partner } = args;
  const ticketId = job.external_source === "zendesk" ? job.external_ref : null;
  if (!ticketId || !partner.email) return false;

  const supabase = args.supabase ?? createServiceClient();
  if (job.partner_booked_email_sent_at) return false;
  const claimed = await tryClaimPartnerBookedEmailSend(supabase, job.id);
  if (!claimed) return false;

  const isHourly = job.job_type === "hourly";
  const priceDisplay = isHourly
    ? `£${Number(job.hourly_partner_rate ?? 0).toFixed(2)}/hr`
    : `£${Number(job.partner_cost ?? 0).toFixed(2)}`;
  const partnerFirstName =
    partner.contact_name?.trim().split(/\s+/)[0] ||
    partner.company_name?.trim() ||
    "Partner";

  const base = appBaseUrl();
  let reportUrl = `${base}/job/report?token=${encodeURIComponent(createPartnerReportToken(job.id, partner.id))}`;
  try {
    const r = await upsertShortLink({
      targetPath: `/job/report?token=${encodeURIComponent(createPartnerReportToken(job.id, partner.id))}`,
      kind: "partner_report",
      entityRef: jobPartnerShortLinkEntityRef(job.id, partner.id, "report"),
    });
    reportUrl = `${base}${r.shortPath}`;
  } catch (err) {
    console.error("[booked reply] short link failed:", err);
  }

  const partnerNotes = await loadPartnerJobEmailNotes(supabase, {
    catalogServiceId: job.catalog_service_id,
    jobTitle: job.title,
    jobType: isHourly ? "hourly" : "fixed",
  });

  const email = buildPartnerJobConfirmationEmail({
    partnerFirstName,
    jobReference: job.reference,
    jobTitle: job.title || "Maintenance job",
    clientName: job.client_name || "—",
    propertyAddress: job.property_address || "—",
    scheduledDate: job.scheduled_date,
    scope: job.scope || "(no scope provided)",
    jobType: isHourly ? "hourly" : "fixed",
    priceDisplay,
    partnerNotes,
    reportUrl,
  });

  const sideConversationId = await resolveBookedSideConversationId(
    supabase,
    job.id,
    partner.id,
    job.zendesk_side_conversation_id,
  );

  try {
    if (sideConversationId) {
      const r = await replyToSideConversation({
        ticketId,
        sideConversationId,
        htmlBody: email.html,
        bodyText: email.text,
      });
      if (!r.ok) console.error("[booked reply] failed:", r.error);
      else if (!job.zendesk_side_conversation_id) {
        await supabase
          .from("jobs")
          .update({ zendesk_side_conversation_id: sideConversationId })
          .eq("id", job.id);
      }
    } else {
      const r = await createSideConversation({
        ticketId,
        toEmail: partner.email,
        toName: partner.contact_name || partner.company_name || undefined,
        toUserId: partner.zendesk_user_id ?? undefined,
        subject: email.subject,
        htmlBody: email.html,
        bodyText: email.text,
      });
      if (r.ok && r.id) {
        await supabase
          .from("jobs")
          .update({ zendesk_side_conversation_id: r.id })
          .eq("id", job.id);
      } else {
        console.error("[booked reply] create side conv failed:", r.error);
      }
    }
  } catch (err) {
    console.error("[booked reply] threw:", err);
  }

  return true;
}
