import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

export type AccountBillingAddresseeMode = "end_client" | "account";

export type ResolvedNominalBilling = {
  displayName: string;
  /**
   * Email used for customer-facing documents and sends (quotes, final-review email, etc.).
   * - **end_client** (including linked account with `billing_type === "end_client"`): always from the
   *   `clients` row (`clients.email`), plus optional `fallbackEmail` from the resolver if missing.
   * - **account** (`billing_type === "account"`): `accounts.finance_email` → `accounts.email` → optional `fallbackEmail`.
   */
  documentEmail: string | null;
  sourceAccountId: string | null;
  mode: AccountBillingAddresseeMode;
};

type AccountRow = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  finance_email?: string | null;
  billing_type?: string | null;
};

async function fetchAccountForBilling(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<AccountRow | null> {
  const withBilling = await supabase
    .from("accounts")
    .select("id, company_name, contact_name, email, finance_email, billing_type")
    .eq("id", sourceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!withBilling.error) return (withBilling.data ?? null) as AccountRow | null;

  if (isSupabaseMissingColumnError(withBilling.error, "billing_type")) {
    const noBilling = await supabase
      .from("accounts")
      .select("id, company_name, contact_name, email, finance_email")
      .eq("id", sourceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!noBilling.error && noBilling.data) {
      return { ...(noBilling.data as Omit<AccountRow, "billing_type">), billing_type: "end_client" };
    }
    if (isSupabaseMissingColumnError(noBilling.error, "finance_email")) {
      const minimal = await supabase
        .from("accounts")
        .select("id, company_name, contact_name, email")
        .eq("id", sourceId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!minimal.error && minimal.data) {
        return {
          ...(minimal.data as Omit<AccountRow, "billing_type" | "finance_email">),
          finance_email: null,
          billing_type: "end_client",
        };
      }
    }
    return null;
  }

  if (isSupabaseMissingColumnError(withBilling.error, "finance_email")) {
    const noFinance = await supabase
      .from("accounts")
      .select("id, company_name, contact_name, email, billing_type")
      .eq("id", sourceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!noFinance.error && noFinance.data) {
      return { ...(noFinance.data as Omit<AccountRow, "finance_email">), finance_email: null };
    }
    if (isSupabaseMissingColumnError(noFinance.error, "billing_type")) {
      const minimal = await supabase
        .from("accounts")
        .select("id, company_name, contact_name, email")
        .eq("id", sourceId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!minimal.error && minimal.data) {
        return {
          ...(minimal.data as Omit<AccountRow, "billing_type" | "finance_email">),
          finance_email: null,
          billing_type: "end_client",
        };
      }
    }
    return null;
  }

  return null;
}

/**
 * Resolves the nominal customer on quotes/invoices (B2C contact vs B2B2C account)
 * from `clients` + `accounts.billing_type` and account finance contact.
 *
 * **Email source (`documentEmail`):**
 * - When the linked account bills the **end client** (`billing_type !== "account"`) or there is no account:
 *   use **`clients.email` only** — not `accounts.finance_email`.
 * - When bills go to **this account** (`billing_type === "account"`): use account finance/main email
 *   with fallbacks (see `ResolvedNominalBilling.documentEmail`).
 */
export async function resolveNominalBillingParty(
  supabase: SupabaseClient,
  options: { clientId: string; fallbackName?: string; fallbackEmail?: string | null },
): Promise<ResolvedNominalBilling> {
  const { clientId, fallbackName, fallbackEmail } = options;
  const fbName = (fallbackName ?? "Client").trim() || "Client";
  const fbEmail = typeof fallbackEmail === "string" && fallbackEmail.trim() ? fallbackEmail.trim() : null;

  if (!clientId?.trim()) {
    return {
      displayName: fbName,
      documentEmail: fbEmail,
      sourceAccountId: null,
      mode: "end_client",
    };
  }

  const { data: clientRow, error: cErr } = await supabase
    .from("clients")
    .select("id, full_name, email, source_account_id")
    .eq("id", clientId.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (cErr || !clientRow) {
    return { displayName: fbName, documentEmail: fbEmail, sourceAccountId: null, mode: "end_client" };
  }
  const c = clientRow as { id: string; full_name: string; email?: string | null; source_account_id?: string | null };
  const sourceId = c.source_account_id?.trim() || null;
  if (!sourceId) {
    return {
      displayName: c.full_name?.trim() || fbName,
      documentEmail: c.email?.trim() || fbEmail,
      sourceAccountId: null,
      mode: "end_client",
    };
  }

  const a = await fetchAccountForBilling(supabase, sourceId);
  if (!a) {
    return {
      displayName: c.full_name?.trim() || fbName,
      documentEmail: c.email?.trim() || fbEmail,
      sourceAccountId: sourceId,
      mode: "end_client",
    };
  }
  const mode: AccountBillingAddresseeMode = a.billing_type === "account" ? "account" : "end_client";
  if (mode === "end_client") {
    return {
      displayName: c.full_name?.trim() || fbName,
      documentEmail: c.email?.trim() || fbEmail,
      sourceAccountId: sourceId,
      mode: "end_client",
    };
  }
  const accName = (a.company_name?.trim() || a.contact_name?.trim() || c.full_name?.trim() || fbName) || "Client";
  const fe = a.finance_email?.trim();
  const main = a.email?.trim();
  const documentEmail = fe || main || fbEmail;
  return {
    displayName: accName,
    documentEmail,
    sourceAccountId: sourceId,
    mode: "account",
  };
}

export type QuoteProposalRecipientArgs = {
  clientId?: string | null;
  propertyId?: string | null;
  /** Routing draft / Change panel — quote row may lack `property_id`; still resolve inbox from this account. */
  accountId?: string | null;
  fallbackName?: string | null;
  fallbackEmail?: string | null;
};

/**
 * Default “customer” email for the quote drawer / proposal send pipeline.
 *
 * - **With `clientId`**: same rules as [`resolveNominalBillingParty`] (`billing_type`: account vs end_client).
 * - **Property-linked (`propertyId` only)**: use that site’s linked account **`finance_email` then `accounts.email`**.
 * - **`accountId` only** (draft / picker before `property_id` exists): same finance/main email fallback as the property-only path.
 *
 * Returns a trimmed address or **`""`** when unresolved.
 */
export async function getQuoteProposalRecipientEmail(
  supabase: SupabaseClient,
  args: QuoteProposalRecipientArgs,
): Promise<string> {
  const cid = args.clientId?.trim() || "";
  const pid = args.propertyId?.trim() || "";
  const aidFallback = args.accountId?.trim() || "";

  if (cid) {
    const b = await resolveNominalBillingParty(supabase, {
      clientId: cid,
      fallbackName: args.fallbackName ?? undefined,
      fallbackEmail: args.fallbackEmail,
    });
    return b.documentEmail?.trim() || "";
  }

  if (pid) {
    const { data: propRow, error } = await supabase
      .from("account_properties")
      .select("account_id")
      .eq("id", pid)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !propRow?.account_id?.trim()) return "";
    const a = await fetchAccountForBilling(supabase, propRow.account_id.trim());
    if (!a) return "";
    const fe = a.finance_email?.trim();
    const main = a.email?.trim();
    return fe || main || "";
  }

  if (aidFallback) {
    const a = await fetchAccountForBilling(supabase, aidFallback);
    if (!a) return "";
    const fe = a.finance_email?.trim();
    const main = a.email?.trim();
    return fe || main || "";
  }

  return "";
}
