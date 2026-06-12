import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToPartners } from "@/lib/auto-assign-job-invites";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { catalogServiceIdForTypeOfWorkLabel } from "@/lib/type-of-work";
import { sendQuotePartnerInviteEmails } from "@/lib/quote-partner-invite-email";

export interface DispatchQuoteBidInvitesParams {
  quoteId: string;
  quoteReference: string;
  title: string;
  serviceType: string;
  propertyAddress?: string | null;
  scope?: string | null;
  startIso?: string | null;
  /** When omitted, partners are matched from service type + postcode. */
  partnerIds?: string[];
  invitedBy?: string | null;
  catalogServiceId?: string | null;
}

export interface DispatchQuoteBidInvitesResult {
  partnerIds: string[];
  pushSent: number;
  emailsSent: number;
  invitationsTracked: number;
}

export async function resolveQuoteCatalogServiceId(
  supabase: SupabaseClient,
  serviceType: string,
): Promise<string | null> {
  const { data: catalog } = await supabase.from("service_catalog").select("id, name").eq("is_active", true);
  return catalogServiceIdForTypeOfWorkLabel(serviceType, catalog ?? []);
}

/**
 * On bidding quote create: match partners, set catalog_service_id, push + email + portal invitations.
 */
export async function dispatchQuoteBidInvites(
  supabase: SupabaseClient,
  params: DispatchQuoteBidInvitesParams,
): Promise<DispatchQuoteBidInvitesResult> {
  const serviceType = params.serviceType.trim();
  // A catalog_service_id alone is enough to match partners (exact id match);
  // only bail when we have neither a trade label nor a catalog id.
  if (!serviceType && !params.catalogServiceId) {
    return { partnerIds: [], pushSent: 0, emailsSent: 0, invitationsTracked: 0 };
  }

  let catalogServiceId = params.catalogServiceId ?? null;
  if (!catalogServiceId) {
    catalogServiceId = await resolveQuoteCatalogServiceId(supabase, serviceType);
    if (catalogServiceId) {
      await supabase.from("quotes").update({ catalog_service_id: catalogServiceId }).eq("id", params.quoteId);
    }
  }

  const postcode = extractUkPostcode(params.propertyAddress ?? "") ?? params.propertyAddress ?? null;
  let partnerIds = params.partnerIds ?? [];
  if (partnerIds.length === 0) {
    partnerIds = await matchPartnerIdsForWork(supabase, {
      serviceType,
      catalogServiceId,
      postcode,
      kind: "lead",
    });
  }

  if (partnerIds.length === 0) {
    return { partnerIds: [], pushSent: 0, emailsSent: 0, invitationsTracked: 0 };
  }

  await supabase.from("quotes").update({ partner_quotes_count: partnerIds.length }).eq("id", params.quoteId);

  const tradeLabel = serviceType || params.title.trim() || "Quote";
  const pushSent = await sendPushToPartners(supabase, partnerIds, {
    title: "New quote — bid invitation",
    body: `${params.quoteReference} · ${tradeLabel} · ${params.propertyAddress || serviceType}`.slice(0, 500),
    data: {
      type: "quote_bid_invite",
      quoteId: params.quoteId,
      reference: params.quoteReference,
      serviceType,
      startAt: params.startIso ?? null,
    },
  });

  const { sent: emailsSent } = await sendQuotePartnerInviteEmails(supabase, {
    quoteId: params.quoteId,
    partnerIds,
    invitedBy: params.invitedBy ?? null,
  });

  return {
    partnerIds,
    pushSent,
    emailsSent,
    invitationsTracked: partnerIds.length,
  };
}
