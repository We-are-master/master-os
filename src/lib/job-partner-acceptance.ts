import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { closeSideConversation, createSideConversation } from "@/lib/zendesk";
import { buildPartnerJobConfirmationEmail } from "@/lib/emails/partner-job-confirmation";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";
import { buildPartnerJobReportUrl } from "@/lib/partner-job-report-url";
import { syncJobZendeskFormFields } from "@/lib/zendesk-ticket-form-sync";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";

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
  auto_assign_invited_partner_ids?: string[] | null;
  auto_assign_expires_at?: string | null;
};

export type PartnerForAcceptance = {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  email: string | null;
  zendesk_user_id: string | null;
};

export type BookedEmailResult = {
  sent: boolean;
  sideConversationId?: string | null;
  skipped?: string;
  error?: string;
};

const JOB_SELECT =
  "id, reference, title, status, partner_id, partner_name, partner_confirmed_at, client_name, property_address, scheduled_date, catalog_service_id, scope, job_type, hourly_partner_rate, partner_cost, auto_assign_invited_partner_ids, auto_assign_expires_at, external_source, external_ref, zendesk_side_conversation_id, partner_booked_email_sent_at";

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

async function clearPartnerBookedEmailClaim(supabase: SupabaseClient, jobId: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({ partner_booked_email_sent_at: null })
    .eq("id", jobId);
}

/** Close every offer-thread side conversation before opening the Job booked thread. */
async function closeJobOfferSideConversations(
  supabase: SupabaseClient,
  jobId: string,
  ticketId: string,
): Promise<void> {
  const sideConversationIds = new Set<string>();

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("zendesk_side_conversation_id")
    .eq("id", jobId)
    .maybeSingle();
  const onJob = (jobRow as { zendesk_side_conversation_id: string | null } | null)
    ?.zendesk_side_conversation_id;
  if (onJob) sideConversationIds.add(onJob);

  const { data: invites } = await supabase
    .from("job_partner_invites")
    .select("zendesk_side_conversation_id")
    .eq("job_id", jobId);
  for (const invite of invites ?? []) {
    const id = (invite as { zendesk_side_conversation_id: string | null })
      .zendesk_side_conversation_id;
    if (id) sideConversationIds.add(id);
  }

  await Promise.all(
    [...sideConversationIds].map((sideConversationId) =>
      closeSideConversation({ ticketId, sideConversationId }).catch((err) =>
        console.error("[booked reply] close offer side conv failed:", err),
      ),
    ),
  );
}

export async function loadJobForPartnerAcceptance(
  supabase: SupabaseClient,
  jobId: string,
): Promise<(JobForPartnerAcceptance & { partner_name: string | null; partner_confirmed_at: string | null; auto_assign_invited_partner_ids: string[] | null }) | null> {
  const { data } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  return data as (JobForPartnerAcceptance & { partner_name: string | null; partner_confirmed_at: string | null; auto_assign_invited_partner_ids: string[] | null }) | null;
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

/** Stored on jobs.partner_name — trading name first (aligned with trade portal). */
export function partnerNameForJobRow(partner: PartnerForAcceptance): string | null {
  return partner.company_name?.trim() || partner.contact_name?.trim() || null;
}

export type AutoAssignClaimResult =
  | { claimed: true; reference: string }
  | { claimed: false; reason: "job_taken" | "not_available" | "error"; error?: string };

export type AutoAssignAcceptResult =
  | {
      ok: true;
      jobReference: string;
      partnerLabel: string;
      alreadyConfirmed: boolean;
      claimed: boolean;
      bookedEmail: BookedEmailResult;
    }
  | {
      ok: false;
      error: "job_taken" | "not_available" | "partner_mismatch";
      message: string;
      jobReference?: string;
    };

/**
 * Atomic first-to-accept claim for auto-assigning jobs.
 * Used by email accept and trade portal (via internal API).
 */
export async function claimAutoAssignJob(args: {
  supabase: SupabaseClient;
  jobId: string;
  partnerId: string;
  partnerName: string | null;
}): Promise<AutoAssignClaimResult> {
  const now = new Date().toISOString();
  const { data, error } = await args.supabase
    .from("jobs")
    .update({
      partner_id: args.partnerId,
      partner_name: args.partnerName,
      status: "scheduled",
      partner_confirmed_at: now,
      auto_assign_invited_partner_ids: null,
      auto_assign_expires_at: null,
    })
    .eq("id", args.jobId)
    .eq("status", "auto_assigning")
    .is("partner_id", null)
    .contains("auto_assign_invited_partner_ids", [args.partnerId])
    .select("id, reference");

  if (error) {
    console.error("[claimAutoAssignJob] update failed:", error);
    return { claimed: false, reason: "error", error: error.message };
  }
  if (!data || data.length === 0) {
    const { data: fresh } = await args.supabase
      .from("jobs")
      .select("partner_id")
      .eq("id", args.jobId)
      .maybeSingle();
    const taken = Boolean((fresh as { partner_id: string | null } | null)?.partner_id);
    return { claimed: false, reason: taken ? "job_taken" : "not_available" };
  }
  return { claimed: true, reference: (data[0] as { reference: string }).reference };
}

/**
 * Single auto-assign accept path for email CTA and trade portal.
 * Claim → finalize (Zendesk booked email, invite bookkeeping, ticket sync).
 * Idempotent when the job is already scheduled for this partner (e.g. stale portal claim).
 */
export async function processAutoAssignJobAccept(args: {
  supabase: SupabaseClient;
  jobId: string;
  partnerId: string;
  partnerName?: string | null;
}): Promise<AutoAssignAcceptResult> {
  const job = await loadJobForPartnerAcceptance(args.supabase, args.jobId);
  if (!job) {
    return { ok: false, error: "not_available", message: "This job is no longer available." };
  }

  const partner = await loadPartnerForAcceptance(args.supabase, args.partnerId);
  if (!partner) {
    return { ok: false, error: "not_available", message: "This job is no longer available." };
  }

  const partnerLabel = partnerDisplayName(partner);
  const partnerName = args.partnerName ?? partnerNameForJobRow(partner);

  const isAutoClaimable =
    job.status === "auto_assigning" &&
    job.partner_id === null &&
    (job.auto_assign_invited_partner_ids ?? []).includes(args.partnerId);

  const isAlreadyWinner =
    job.status === "scheduled" && job.partner_id === args.partnerId;

  if (isAlreadyWinner) {
    if (job.auto_assign_invited_partner_ids?.length || job.auto_assign_expires_at) {
      await args.supabase
        .from("jobs")
        .update({
          auto_assign_invited_partner_ids: null,
          auto_assign_expires_at: null,
          partner_confirmed_at: job.partner_confirmed_at ?? new Date().toISOString(),
          ...(partnerName ? { partner_name: partnerName } : {}),
        })
        .eq("id", args.jobId)
        .eq("partner_id", args.partnerId);
    }

    if (job.partner_booked_email_sent_at) {
      return {
        ok: true,
        jobReference: job.reference,
        partnerLabel,
        alreadyConfirmed: true,
        claimed: false,
        bookedEmail: { sent: false, skipped: "already_sent" },
      };
    }

    const freshJob = (await loadJobForPartnerAcceptance(args.supabase, args.jobId)) ?? job;
    const { bookedEmail } = await finalizeAutoAssignWinner({
      supabase: args.supabase,
      jobId: args.jobId,
      partnerId: args.partnerId,
      job: freshJob,
      partner,
      partnerName,
    });

    return {
      ok: true,
      jobReference: job.reference,
      partnerLabel,
      alreadyConfirmed: false,
      claimed: false,
      bookedEmail,
    };
  }

  if (!isAutoClaimable) {
    if (job.status === "scheduled" || job.partner_id) {
      return {
        ok: false,
        error: "job_taken",
        message:
          "This job has already been taken by another partner. Thanks for being quick!",
        jobReference: job.reference,
      };
    }
    return {
      ok: false,
      error: "partner_mismatch",
      message: "This job is no longer assigned to you.",
      jobReference: job.reference,
    };
  }

  const claim = await claimAutoAssignJob({
    supabase: args.supabase,
    jobId: args.jobId,
    partnerId: args.partnerId,
    partnerName,
  });

  if (!claim.claimed) {
    const fresh = await loadJobForPartnerAcceptance(args.supabase, args.jobId);
    if (fresh?.status === "scheduled" && fresh.partner_id === args.partnerId) {
      return processAutoAssignJobAccept(args);
    }
    return {
      ok: false,
      error: claim.reason === "job_taken" ? "job_taken" : "not_available",
      message:
        claim.reason === "job_taken"
          ? "This job has already been taken by another partner. Thanks for being quick!"
          : "This job is no longer available.",
      jobReference: job.reference,
    };
  }

  const freshJob = (await loadJobForPartnerAcceptance(args.supabase, args.jobId)) ?? job;
  const { bookedEmail } = await finalizeAutoAssignWinner({
    supabase: args.supabase,
    jobId: args.jobId,
    partnerId: args.partnerId,
    job: freshJob,
    partner,
    partnerName,
  });

  return {
    ok: true,
    jobReference: freshJob.reference,
    partnerLabel,
    alreadyConfirmed: false,
    claimed: true,
    bookedEmail,
  };
}

/** After auto-assign winner is set on the job — invite bookkeeping + Job booked side conv. */
export async function finalizeAutoAssignWinner(args: {
  supabase?: SupabaseClient;
  jobId: string;
  partnerId: string;
  job: JobForPartnerAcceptance;
  partner: PartnerForAcceptance;
  partnerName?: string | null;
}): Promise<{ winnerSideConvId: string | null; bookedEmail: BookedEmailResult }> {
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
  }

  const bookedEmail = await sendBookedSideConvReply({
    supabase,
    job: {
      ...args.job,
      status: "scheduled",
      partner_id: args.partnerId,
    },
    partner: args.partner,
    partnerName,
  });

  void Promise.all([
    syncJobZendeskStatus(args.jobId, supabase),
    syncJobZendeskFormFields(args.jobId, supabase),
  ]).catch((err) => console.error("[finalizeAutoAssignWinner] zendesk sync failed:", err));

  return {
    winnerSideConvId: bookedEmail.sideConversationId ?? winnerSideConvId,
    bookedEmail,
  };
}

export async function sendBookedSideConvReply(args: {
  supabase?: SupabaseClient;
  job: JobForPartnerAcceptance;
  partner: PartnerForAcceptance;
  partnerName: string | null;
}): Promise<BookedEmailResult> {
  const { job, partner } = args;
  const ticketId = job.external_source === "zendesk" ? job.external_ref : null;
  if (!ticketId) return { sent: false, skipped: "no_zendesk_ticket" };
  if (!partner.email?.trim()) return { sent: false, skipped: "no_partner_email" };

  const supabase = args.supabase ?? createServiceClient();
  if (job.partner_booked_email_sent_at) return { sent: false, skipped: "already_sent" };
  const claimed = await tryClaimPartnerBookedEmailSend(supabase, job.id);
  if (!claimed) return { sent: false, skipped: "claim_lost" };

  const isHourly = job.job_type === "hourly";
  const priceDisplay = isHourly
    ? `£${Number(job.hourly_partner_rate ?? 0).toFixed(2)}/hr`
    : `£${Number(job.partner_cost ?? 0).toFixed(2)}`;
  const partnerFirstName =
    partner.contact_name?.trim().split(/\s+/)[0] ||
    partner.company_name?.trim() ||
    "Partner";

  const reportUrl = await buildPartnerJobReportUrl(job.id, partner.id);

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

  const persistSuccess = async (sideConvId: string | null) => {
    const patch: Record<string, unknown> = {};
    if (sideConvId) patch.zendesk_side_conversation_id = sideConvId;
    if (args.partnerName) patch.partner_name = args.partnerName;
    if (Object.keys(patch).length > 0) {
      await supabase.from("jobs").update(patch).eq("id", job.id);
    }
  };

  try {
    await closeJobOfferSideConversations(supabase, job.id, ticketId);

    const created = await createSideConversation({
      ticketId,
      toEmail: partner.email,
      toName: partner.contact_name || partner.company_name || undefined,
      toUserId: partner.zendesk_user_id ?? undefined,
      subject: email.subject,
      htmlBody: email.html,
      bodyText: email.text,
    });
    if (created.ok && created.id) {
      await persistSuccess(created.id);
      return { sent: true, sideConversationId: created.id };
    }

    await clearPartnerBookedEmailClaim(supabase, job.id);
    const err = created.error ?? "zendesk_send_failed";
    console.error("[booked reply] create side conv failed:", err);
    return { sent: false, error: err };
  } catch (err) {
    await clearPartnerBookedEmailClaim(supabase, job.id);
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[booked reply] threw:", err);
    return { sent: false, error: msg };
  }
}
