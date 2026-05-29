/**
 * Mirror a partner from the OS into Zendesk as an Organisation + User.
 *
 * Called fire-and-forget after partner creation. Idempotent: re-running
 * with the same partner id just updates the existing Zendesk records
 * (Zendesk dedupes by `external_id = fixfy:partner:<uuid>`).
 *
 * Purpose: when side conversations are opened on jobs, we can target the
 * partner's `zendesk_user_id` in the `to[]` field. Zendesk then threads
 * the side conv into the partner's organisation view, which makes
 * filtering/reporting trivial for the office.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  isZendeskConfigured,
  createOrUpdateZendeskOrganization,
  createOrUpdateZendeskUser,
} from "@/lib/zendesk";

export interface PartnerZendeskSyncResult {
  ok:              boolean;
  organizationId?: string | null;
  userId?:         string | null;
  skipped?:        string;
  error?:          string;
}

export async function syncPartnerToZendesk(partnerId: string): Promise<PartnerZendeskSyncResult> {
  if (!isZendeskConfigured()) return { ok: false, skipped: "zendesk_not_configured" };
  if (!partnerId) return { ok: false, error: "partnerId is required" };

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("partners")
    .select("id, company_name, contact_name, email, phone, zendesk_organization_id, zendesk_user_id")
    .eq("id", partnerId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "partner_not_found" };
  }
  const partner = data as {
    id: string;
    company_name: string | null;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    zendesk_organization_id: string | null;
    zendesk_user_id: string | null;
  };

  if (!partner.email?.trim()) {
    return { ok: false, skipped: "partner_has_no_email" };
  }

  const orgName = partner.company_name?.trim() || partner.contact_name?.trim() || partner.email.split("@")[0];

  // ─── 1. Organisation ─────────────────────────────────────────────────
  const org = await createOrUpdateZendeskOrganization({
    kind:     "partner",
    name:     orgName,
    entityId: partner.id,
  });
  if (!org.ok) {
    return { ok: false, error: `org: ${org.error ?? "unknown"}` };
  }

  // ─── 2. User (the partner contact) ───────────────────────────────────
  const user = await createOrUpdateZendeskUser({
    kind:           "partner",
    name:           partner.contact_name?.trim() || partner.company_name?.trim() || partner.email,
    email:          partner.email,
    entityId:       partner.id,
    organizationId: org.id ?? undefined,
    phone:          partner.phone ?? undefined,
  });
  if (!user.ok) {
    // Persist the org id at least — useful even without the user.
    await supabase
      .from("partners")
      .update({ zendesk_organization_id: org.id ?? null })
      .eq("id", partner.id);
    return { ok: false, organizationId: org.id, error: `user: ${user.error ?? "unknown"}` };
  }

  // ─── 3. Persist the ids back on the partner row ───────────────────────
  const { error: upErr } = await supabase
    .from("partners")
    .update({
      zendesk_organization_id: org.id ?? null,
      zendesk_user_id:         user.id ?? null,
    })
    .eq("id", partner.id);
  if (upErr) {
    return {
      ok:             false,
      organizationId: org.id,
      userId:         user.id,
      error:          `persist: ${upErr.message}`,
    };
  }

  return { ok: true, organizationId: org.id, userId: user.id };
}
