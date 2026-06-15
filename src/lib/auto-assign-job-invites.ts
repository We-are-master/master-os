import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  formatPartnerJobPriceDisplay,
  resolvePartnerHourlyForJob,
} from "@/lib/job-pricing-resolver";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import type { CatalogService, PartnerServicePrice } from "@/types/database";
import {
  repairJobIngestFromZendeskTicket,
  resolveJobMatchServiceType,
} from "@/lib/zendesk-job-ingest";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { createSideConversation } from "@/lib/zendesk";
import { buildPartnerJobConfirmationRequestEmail } from "@/lib/emails/partner-job-confirmation";
import { createPartnerJobAcceptToken } from "@/lib/quote-response-token";
import { upsertShortLink, jobPartnerShortLinkEntityRef } from "@/lib/short-links";
import { appBaseUrl } from "@/lib/app-base-url";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";
import { autoAssignExpiresAtIso } from "@/lib/auto-assign-offer";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const CATALOG_PRICING_SELECT =
  "id, name, pricing_mode, fixed_price, hourly_rate, default_hours, partner_cost, pricing_presets, pricing_addons";

async function loadSmartPriceInviteContext(
  supabase: SupabaseClient,
  catalogServiceId: string | null,
  partnerIds: string[],
): Promise<{
  catalog: CatalogService | null;
  overridesByPartnerId: Map<string, PartnerServicePrice>;
}> {
  const overridesByPartnerId = new Map<string, PartnerServicePrice>();
  if (!catalogServiceId || partnerIds.length === 0) {
    return { catalog: null, overridesByPartnerId };
  }

  const [{ data: catalogRow }, { data: priceRows }] = await Promise.all([
    supabase
      .from("service_catalog")
      .select(CATALOG_PRICING_SELECT)
      .eq("id", catalogServiceId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("partner_service_prices")
      .select("id, partner_id, catalog_service_id, use_standard, hourly_partner_rate, fixed_partner_cost, default_hours, preset_overrides")
      .eq("catalog_service_id", catalogServiceId)
      .in("partner_id", partnerIds)
      .is("deleted_at", null),
  ]);

  for (const row of (priceRows ?? []) as PartnerServicePrice[]) {
    overridesByPartnerId.set(row.partner_id, row);
  }

  return {
    catalog: (catalogRow as CatalogService | null) ?? null,
    overridesByPartnerId,
  };
}

function partnerPriceDisplayForInvite(
  jobType: "hourly" | "fixed" | null,
  jobHourlyPartnerRate: number | null,
  jobPartnerCost: number | null,
  catalog: CatalogService | null,
  partnerOverride: PartnerServicePrice | null | undefined,
  presetId?: string | null,
): string {
  if (jobType === "hourly" && catalog) {
    const { value, fixedPartnerTotal } = resolvePartnerHourlyForJob({
      catalog,
      partnerOverride: partnerOverride ?? null,
      presetId,
    });
    if (value != null && value > 0) {
      return formatPartnerJobPriceDisplay("hourly", value, null, fixedPartnerTotal);
    }
  }
  return formatPartnerJobPriceDisplay(jobType, jobHourlyPartnerRate, jobPartnerCost);
}

export interface BroadcastAutoAssignInvitesParams {
  jobId: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  propertyAddress: string;
  scope: string;
  scheduledDate: string | null;
  partnerIds: string[];
  /** When set, opens a Zendesk side conversation per partner with Email 1. */
  zendeskTicketId?: string | null;
}

export async function sendPushToPartners(
  supabase: SupabaseClient,
  partnerIds: string[],
  notification: { title: string; body: string; data: Record<string, unknown> },
): Promise<number> {
  if (!partnerIds.length) return 0;

  const { data: partners } = await supabase
    .from("partners")
    .select("id, expo_push_token, auth_user_id")
    .in("id", partnerIds)
    .eq("status", "active");

  const tokens: string[] = [];
  const missingAuthIds: string[] = [];

  for (const p of (partners ?? []) as { expo_push_token: string | null; auth_user_id: string | null }[]) {
    if (p.expo_push_token) tokens.push(p.expo_push_token);
    else if (p.auth_user_id) missingAuthIds.push(p.auth_user_id);
  }

  if (missingAuthIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, fcmToken")
      .in("id", missingAuthIds)
      .not("fcmToken", "is", null);
    for (const u of (users ?? []) as { fcmToken: string | null }[]) {
      if (u.fcmToken) tokens.push(u.fcmToken);
    }
  }

  const dedup = [...new Set(tokens)];
  if (!dedup.length) return 0;

  try {
    const messages = dedup.map((to) => ({
      to,
      title: notification.title,
      body: notification.body.slice(0, 500),
      data: notification.data,
      sound: "default" as const,
    }));
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error(`[auto-assign] Expo push ${res.status}:`, await res.text());
      return 0;
    }
    return dedup.length;
  } catch (err) {
    console.error("[auto-assign] push failed:", err);
    return 0;
  }
}

/**
 * For each matched partner in an auto-assign job:
 *   1. Mint a tokenised Accept link bound to (jobId, partnerId)
 *   2. When zendeskTicketId is set, open a side conversation with Email 1
 *   3. Insert / update job_partner_invites (push-only when no ticket or no email)
 */
export async function broadcastAutoAssignInvites(
  params: BroadcastAutoAssignInvitesParams,
): Promise<void> {
  const supabase = createServiceClient();
  const ticketId = params.zendeskTicketId?.trim() || null;

  const { data: partners } = await supabase
    .from("partners")
    .select("id, contact_name, company_name, email, zendesk_user_id")
    .in("id", params.partnerIds)
    .eq("status", "active");

  if (!partners || partners.length === 0) return;

  const { data: jobInfo } = await supabase
    .from("jobs")
    .select(
      "job_type, hourly_partner_rate, partner_cost, catalog_service_id, catalog_pricing_preset_id, title, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date",
    )
    .eq("id", params.jobId)
    .maybeSingle();
  const ji = jobInfo as {
    job_type: "hourly" | "fixed" | null;
    hourly_partner_rate: number | null;
    partner_cost: number | null;
    catalog_service_id: string | null;
    catalog_pricing_preset_id: string | null;
    title: string | null;
    scheduled_date: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    scheduled_finish_date: string | null;
  } | null;
  const isHourly = ji?.job_type === "hourly";
  const presetId = ji?.catalog_pricing_preset_id ?? null;
  const smartPriceCtx = isHourly
    ? await loadSmartPriceInviteContext(supabase, ji?.catalog_service_id ?? null, params.partnerIds)
    : { catalog: null, overridesByPartnerId: new Map<string, PartnerServicePrice>() };

  const base = appBaseUrl();

  for (const row of partners as {
    id: string;
    contact_name: string | null;
    company_name: string | null;
    email: string | null;
    zendesk_user_id: string | null;
  }[]) {
    const partnerFirstName =
      row.contact_name?.trim().split(/\s+/)[0] || row.company_name?.trim() || "Partner";
    const priceDisplay = partnerPriceDisplayForInvite(
      ji?.job_type ?? null,
      ji?.hourly_partner_rate ?? null,
      ji?.partner_cost ?? null,
      smartPriceCtx.catalog,
      smartPriceCtx.overridesByPartnerId.get(row.id),
      presetId,
    );

    let sideConversationId: string | null = null;

    if (row.email && ticketId) {
      try {
        const acceptToken = createPartnerJobAcceptToken(params.jobId, row.id);
        let acceptUrl = `${base}/job/confirm?token=${encodeURIComponent(acceptToken)}`;
        try {
          const r = await upsertShortLink({
            targetPath: `/job/confirm?token=${encodeURIComponent(acceptToken)}`,
            kind: "partner_accept",
            entityRef: jobPartnerShortLinkEntityRef(params.jobId, row.id, "accept"),
          });
          acceptUrl = `${base}${r.shortPath}`;
        } catch (err) {
          console.error("[broadcast invites] short link failed, using long URL:", err);
        }

        const partnerNotes = await loadPartnerJobEmailNotes(supabase, {
          catalogServiceId: ji?.catalog_service_id,
          jobTitle: params.jobTitle || ji?.title,
          jobType: isHourly ? "hourly" : "fixed",
        });

        const email = buildPartnerJobConfirmationRequestEmail({
          partnerFirstName,
          jobReference: params.jobReference,
          jobTitle: params.jobTitle,
          clientName: params.clientName,
          propertyAddress: params.propertyAddress,
          scheduledDate: ji?.scheduled_date ?? params.scheduledDate,
          scheduledStartAt: ji?.scheduled_start_at ?? null,
          scheduledEndAt: ji?.scheduled_end_at ?? null,
          scheduledFinishDate: ji?.scheduled_finish_date ?? null,
          scope: params.scope,
          priceDisplay,
          partnerNotes,
          acceptUrl,
        });

        const sc = await createSideConversation({
          ticketId,
          toEmail: row.email,
          toName: row.contact_name || row.company_name || undefined,
          toUserId: row.zendesk_user_id ?? undefined,
          subject: email.subject,
          htmlBody: email.html,
          bodyText: email.text,
        });

        if (sc.ok && sc.id) {
          sideConversationId = sc.id;
        } else {
          console.error(`[broadcast invites] side conv failed for partner ${row.id}:`, sc.error);
        }
      } catch (err) {
        console.error(`[broadcast invites] threw for partner ${row.id}:`, err);
      }
    }

    const { error: upErr } = await supabase.from("job_partner_invites").upsert(
      {
        job_id: params.jobId,
        partner_id: row.id,
        zendesk_side_conversation_id: sideConversationId,
        status: "invited",
        invited_at: new Date().toISOString(),
      },
      { onConflict: "job_id,partner_id" },
    );
    if (upErr) console.error(`[broadcast invites] upsert failed for partner ${row.id}:`, upErr);
  }
}

export interface DispatchAutoAssignInvitesArgs {
  supabase?: SupabaseClient;
  jobId: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  propertyAddress: string;
  scope: string;
  scheduledDate?: string | null;
  partnerIds: string[];
  zendeskTicketId?: string | null;
  sendPush?: boolean;
}

/** Push + optional Zendesk invitation emails for an auto-assign job. */
export async function dispatchAutoAssignJobInvites(
  args: DispatchAutoAssignInvitesArgs,
): Promise<{ pushSent: number }> {
  if (!args.partnerIds.length) return { pushSent: 0 };

  const supabase = args.supabase ?? createServiceClient();
  const scope = args.scope?.trim() || "(no scope provided)";

  let pushSent = 0;
  if (args.sendPush !== false) {
    const { data: jobInfo } = await supabase
      .from("jobs")
      .select("job_type, hourly_partner_rate, partner_cost, catalog_service_id, catalog_pricing_preset_id")
      .eq("id", args.jobId)
      .maybeSingle();
    const ji = jobInfo as {
      job_type: "hourly" | "fixed" | null;
      hourly_partner_rate: number | null;
      partner_cost: number | null;
      catalog_service_id: string | null;
      catalog_pricing_preset_id: string | null;
    } | null;
    const isHourly = ji?.job_type === "hourly";
    const presetId = ji?.catalog_pricing_preset_id ?? null;
    const smartPriceCtx = isHourly
      ? await loadSmartPriceInviteContext(
          supabase,
          ji?.catalog_service_id ?? null,
          args.partnerIds,
        )
      : { catalog: null, overridesByPartnerId: new Map<string, PartnerServicePrice>() };

    if (isHourly && smartPriceCtx.catalog) {
      for (const partnerId of args.partnerIds) {
        const priceDisplay = partnerPriceDisplayForInvite(
          ji?.job_type ?? null,
          ji?.hourly_partner_rate ?? null,
          ji?.partner_cost ?? null,
          smartPriceCtx.catalog,
          smartPriceCtx.overridesByPartnerId.get(partnerId),
          presetId,
        );
        pushSent += await sendPushToPartners(supabase, [partnerId], {
          title: "New job available",
          body: `${args.jobReference} · ${args.jobTitle} · ${priceDisplay} · ${args.propertyAddress}`,
          data: { type: "job_offer", jobId: args.jobId },
        });
      }
    } else {
      const priceDisplay = formatPartnerJobPriceDisplay(
        ji?.job_type ?? null,
        ji?.hourly_partner_rate,
        ji?.partner_cost,
      );
      pushSent = await sendPushToPartners(supabase, args.partnerIds, {
        title: "New job available",
        body: `${args.jobReference} · ${args.jobTitle} · ${priceDisplay} · ${args.propertyAddress}`,
        data: { type: "job_offer", jobId: args.jobId },
      });
    }
  }

  await supabase
    .from("jobs")
    .update({ auto_assign_expires_at: autoAssignExpiresAtIso() })
    .eq("id", args.jobId);

  await broadcastAutoAssignInvites({
    jobId: args.jobId,
    jobReference: args.jobReference,
    jobTitle: args.jobTitle,
    clientName: args.clientName,
    propertyAddress: args.propertyAddress,
    scope,
    scheduledDate: args.scheduledDate ?? null,
    partnerIds: args.partnerIds,
    zendeskTicketId: args.zendeskTicketId,
  });

  return { pushSent };
}

type JobAutoAssignRow = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  partner_id: string | null;
  client_name: string | null;
  property_address: string | null;
  scope: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  catalog_service_id: string | null;
  external_source: string | null;
  external_ref: string | null;
  auto_assign_invited_partner_ids: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
};

const JOB_AUTO_ASSIGN_SELECT =
  "id, reference, title, status, partner_id, client_name, property_address, scope, scheduled_date, scheduled_start_at, scheduled_end_at, catalog_service_id, external_source, external_ref, auto_assign_invited_partner_ids, latitude, longitude";

/**
 * Match partners (when needed), persist invite list, push + Zendesk Email 1.
 * Safe to call after OS manual create or POST /api/jobs with auto_assign.
 */
export async function ensureAndDispatchAutoAssignInvites(
  supabase: SupabaseClient,
  jobId: string,
): Promise<
  | { ok: true; partnerCount: number; pushSent: number }
  | { ok: false; error: string; status: number }
> {
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(JOB_AUTO_ASSIGN_SELECT)
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !jobRow) {
    return { ok: false, error: "Job not found.", status: 404 };
  }

  let job = jobRow as JobAutoAssignRow;

  const { patch: ingestPatch, corrections } = await repairJobIngestFromZendeskTicket(
    supabase,
    {
      id: job.id,
      reference: job.reference,
      client_name: job.client_name,
      property_address: job.property_address,
      status: job.status,
      partner_id: job.partner_id,
      catalog_service_id: job.catalog_service_id,
      external_source: job.external_source,
      external_ref: job.external_ref,
    },
  );
  if (Object.keys(ingestPatch).length > 0) {
    const { error: repairErr } = await supabase
      .from("jobs")
      .update(ingestPatch)
      .eq("id", job.id);
    if (repairErr) {
      console.error("[auto-assign] Zendesk ingest repair failed:", repairErr.message);
    } else {
      job = { ...job, ...ingestPatch };
      if (corrections.length > 0) {
        console.info("[auto-assign] Zendesk ingest repair:", corrections.join(", "));
      }
    }
  }

  if (job.status !== "auto_assigning") {
    return { ok: false, error: "Job is not in auto-assigning status.", status: 409 };
  }
  if (job.partner_id) {
    return { ok: false, error: "Job already has a partner assigned.", status: 409 };
  }

  let partnerIds = (job.auto_assign_invited_partner_ids ?? []).filter(Boolean);

  if (partnerIds.length === 0) {
    const { serviceType, catalogServiceId } = await resolveJobMatchServiceType(supabase, job);
    partnerIds = await matchPartnerIdsForWork(supabase, {
      serviceType,
      catalogServiceId,
      postcode: extractUkPostcode(job.property_address ?? ""),
      latitude: job.latitude ?? null,
      longitude: job.longitude ?? null,
      kind: "job",
      availabilitySlot: {
        scheduledDate: job.scheduled_date,
        startAt: job.scheduled_start_at,
        endAt: job.scheduled_end_at,
      },
    });

    if (partnerIds.length === 0) {
      await supabase.from("jobs").update({ status: "unassigned" }).eq("id", jobId);
      return { ok: false, error: "No matching partners found for this job.", status: 422 };
    }

    const { error: upErr } = await supabase
      .from("jobs")
      .update({
        auto_assign_invited_partner_ids: partnerIds,
        auto_assign_expires_at: autoAssignExpiresAtIso(),
      })
      .eq("id", jobId);
    if (upErr) {
      console.error("[auto-assign] failed to persist invited partner ids:", upErr);
      return { ok: false, error: "Could not save matched partners.", status: 500 };
    }
  }

  const zendeskTicketId =
    job.external_source === "zendesk" ? job.external_ref?.trim() || null : null;

  const { pushSent } = await dispatchAutoAssignJobInvites({
    supabase,
    jobId: job.id,
    jobReference: job.reference,
    jobTitle: job.title || "Maintenance job",
    clientName: job.client_name || "—",
    propertyAddress: job.property_address || "—",
    scope: job.scope || "(no scope provided)",
    scheduledDate: job.scheduled_date,
    partnerIds,
    zendeskTicketId,
  });

  return { ok: true, partnerCount: partnerIds.length, pushSent };
}
