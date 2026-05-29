/**
 * Mirror an account from the OS into Zendesk as an Organisation + User.
 *
 * Same idea + same idempotency story as zendesk-partner-sync.ts, but for
 * accounts (clients) — uses the 🏢 emoji prefix and `os_type: account`.
 *
 * Side conversations on quotes/jobs that target the account's
 * zendesk_user_id thread into the account's Zendesk organisation view.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  isZendeskConfigured,
  createOrUpdateZendeskOrganization,
  createOrUpdateZendeskUser,
} from "@/lib/zendesk";

export interface AccountZendeskSyncResult {
  ok:              boolean;
  organizationId?: string | null;
  userId?:         string | null;
  skipped?:        string;
  error?:          string;
}

export async function syncAccountToZendesk(accountId: string): Promise<AccountZendeskSyncResult> {
  if (!isZendeskConfigured()) return { ok: false, skipped: "zendesk_not_configured" };
  if (!accountId) return { ok: false, error: "accountId is required" };

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name, contact_name, email, contact_number, zendesk_organization_id, zendesk_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "account_not_found" };
  }
  const account = data as {
    id: string;
    company_name: string | null;
    contact_name: string | null;
    email: string | null;
    contact_number: string | null;
    zendesk_organization_id: string | null;
    zendesk_user_id: string | null;
  };

  const orgName = account.company_name?.trim() || account.contact_name?.trim() || account.email?.split("@")[0] || "Account";

  // ─── 1. Organisation ─────────────────────────────────────────────────
  const org = await createOrUpdateZendeskOrganization({
    kind:     "account",
    name:     orgName,
    entityId: account.id,
  });
  if (!org.ok) {
    return { ok: false, error: `org: ${org.error ?? "unknown"}` };
  }

  // ─── 2. User (primary contact) ───────────────────────────────────────
  // Accounts may not have a contact email — in that case we keep the org
  // and skip the user. Persist the org id either way.
  let userId: string | null = null;
  if (account.email?.trim()) {
    const user = await createOrUpdateZendeskUser({
      kind:           "account",
      name:           account.contact_name?.trim() || account.company_name?.trim() || account.email,
      email:          account.email,
      entityId:       account.id,
      organizationId: org.id ?? undefined,
      phone:          account.contact_number ?? undefined,
    });
    if (!user.ok) {
      await supabase
        .from("accounts")
        .update({ zendesk_organization_id: org.id ?? null })
        .eq("id", account.id);
      return { ok: false, organizationId: org.id, error: `user: ${user.error ?? "unknown"}` };
    }
    userId = user.id ?? null;
  }

  // ─── 3. Persist the ids back on the account row ──────────────────────
  const { error: upErr } = await supabase
    .from("accounts")
    .update({
      zendesk_organization_id: org.id ?? null,
      zendesk_user_id:         userId,
    })
    .eq("id", account.id);
  if (upErr) {
    return {
      ok:             false,
      organizationId: org.id,
      userId:         userId,
      error:          `persist: ${upErr.message}`,
    };
  }

  return { ok: true, organizationId: org.id, userId };
}
