import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidUUID } from "@/lib/auth-api";
import { dispatchQuoteBidInvites } from "@/lib/quote-bid-invites";

export type QuoteRetryNotifyInput = {
  quoteId: string;
  propertyAddressOverride?: string | null;
  invitedBy?: string | null;
};

export type QuoteRetryNotifySuccess = {
  ok: true;
  id: string;
  reference: string;
  status: string;
  partners_notified: {
    partnerIds: string[];
    pushSent: number;
    emailsSent: number;
    invitationsTracked: number;
  };
};

export type QuoteRetryNotifyFailure = {
  ok: false;
  status: number;
  error: string;
};

export type QuoteRetryNotifyResult = QuoteRetryNotifySuccess | QuoteRetryNotifyFailure;

type QuoteRow = {
  id: string;
  reference: string;
  status: string;
  title: string | null;
  service_type: string | null;
  catalog_service_id: string | null;
  property_address: string | null;
  scope: string | null;
  start_date_option_1: string | null;
  partner_quotes_count: number | null;
};

/** Re-run partner match + notify for bidding quotes stuck at 0 invites (e.g. missing address). */
export async function retryNotifyPartnersForQuote(
  supabase: SupabaseClient,
  input: QuoteRetryNotifyInput,
): Promise<QuoteRetryNotifyResult> {
  const quoteId = input.quoteId?.trim() ?? "";
  if (!isValidUUID(quoteId)) {
    return { ok: false, status: 400, error: "Invalid quote id." };
  }

  const { data: quoteRow, error: qErr } = await supabase
    .from("quotes")
    .select(
      "id, reference, status, title, service_type, catalog_service_id, property_address, scope, start_date_option_1, partner_quotes_count",
    )
    .eq("id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (qErr) {
    console.error("[quote-retry-notify] load failed:", qErr.message);
    return { ok: false, status: 500, error: "Could not load quote." };
  }
  if (!quoteRow) {
    return { ok: false, status: 404, error: "Quote not found." };
  }

  const quote = quoteRow as QuoteRow;

  if (quote.status !== "bidding") {
    return {
      ok: false,
      status: 400,
      error: `Quote not in 'bidding' status (current: '${quote.status}').`,
    };
  }

  const [{ count: inviteCount }, partnerQuotesCount] = await Promise.all([
    supabase
      .from("quote_partner_invitations")
      .select("id", { count: "exact", head: true })
      .eq("quote_id", quoteId),
    Promise.resolve(Number(quote.partner_quotes_count) || 0),
  ]);

  if ((inviteCount ?? 0) > 0 || partnerQuotesCount > 0) {
    return {
      ok: false,
      status: 400,
      error: "Quote already has partners_notified > 0 (already sent).",
    };
  }

  let propertyAddress = quote.property_address?.trim() || null;
  const override = input.propertyAddressOverride?.trim();
  if (!propertyAddress && override) {
    propertyAddress = override;
    const { error: upErr } = await supabase
      .from("quotes")
      .update({ property_address: propertyAddress })
      .eq("id", quoteId);
    if (upErr) {
      console.error("[quote-retry-notify] address update failed:", upErr.message);
      return { ok: false, status: 500, error: "Could not save property_address." };
    }
  }

  if (!propertyAddress) {
    return {
      ok: false,
      status: 400,
      error: "property_address still empty after override.",
    };
  }

  const serviceType = quote.service_type?.trim() ?? "";
  if (!serviceType && !quote.catalog_service_id) {
    return {
      ok: false,
      status: 400,
      error: "Quote has no service_type or catalog_service_id for partner matching.",
    };
  }

  const dispatch = await dispatchQuoteBidInvites(supabase, {
    quoteId,
    quoteReference: quote.reference,
    title: quote.title?.trim() || serviceType || "Quote",
    serviceType,
    catalogServiceId: quote.catalog_service_id,
    propertyAddress,
    scope: quote.scope,
    startIso: quote.start_date_option_1,
    invitedBy: input.invitedBy ?? null,
  });

  return {
    ok: true,
    id: quote.id,
    reference: quote.reference,
    status: quote.status,
    partners_notified: {
      partnerIds: dispatch.partnerIds,
      pushSent: dispatch.pushSent,
      emailsSent: dispatch.emailsSent,
      invitationsTracked: dispatch.invitationsTracked,
    },
  };
}
