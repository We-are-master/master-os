import type { SupabaseClient } from "@supabase/supabase-js";

export function clientNamesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").trim().toLowerCase();
  const y = String(b ?? "").trim().toLowerCase();
  return x.length > 0 && x === y;
}

/**
 * Whether an email-matched client row should be reused for this Zendesk end-customer.
 * Skips corporate account placeholder and name mismatches (e.g. Checkatrade vs Patrick).
 */
export function shouldReuseClientByEmail(
  existingFullName: string | null | undefined,
  clientName: string,
  accountCompanyName: string | null | undefined,
): boolean {
  const existingName = String(existingFullName ?? "").trim();
  if (!existingName) return true;
  const corp = String(accountCompanyName ?? "").trim();
  if (corp && clientNamesEqual(existingName, corp)) return false;
  return clientNamesEqual(existingName, clientName);
}

export type ResolveZendeskJobClientInput = {
  accountId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  accountCompanyName?: string | null;
};

type ClientRow = { id: string; phone?: string | null; full_name?: string | null };

export type ResolveZendeskJobClientResult = {
  clientId: string;
  clientFullName: string;
  created: boolean;
};

function canonicalName(row: ClientRow | null | undefined, fallback: string): string {
  return row?.full_name?.trim() || fallback.trim();
}

/**
 * Find or create the end-customer client for a Zendesk job.
 *
 * Email-only reuse is skipped when the matched row's full_name differs from
 * clientName or matches the account company name (corporate placeholder).
 */
export async function resolveClientIdForZendeskJob(
  supabase: SupabaseClient,
  input: ResolveZendeskJobClientInput,
): Promise<ResolveZendeskJobClientResult> {
  const accountId = input.accountId.trim();
  const clientName = input.clientName.trim();
  const clientEmail = input.clientEmail?.trim() || null;
  const clientPhone = input.clientPhone?.trim() || null;
  const accountCompanyName = input.accountCompanyName?.trim() || null;

  if (clientEmail) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("clients")
      .select("id, phone, full_name")
      .eq("source_account_id", accountId)
      .ilike("email", clientEmail)
      .is("deleted_at", null)
      .maybeSingle();
    if (emailErr) throw new Error(emailErr.message);
    const row = (byEmail ?? null) as ClientRow | null;
    if (row?.id && shouldReuseClientByEmail(row.full_name, clientName, accountCompanyName)) {
      await backfillClientPhone(supabase, row, clientPhone);
      return {
        clientId: row.id,
        clientFullName: canonicalName(row, clientName),
        created: false,
      };
    }
  }

  const { data: byName, error: nameErr } = await supabase
    .from("clients")
    .select("id, phone, full_name")
    .eq("source_account_id", accountId)
    .ilike("full_name", clientName)
    .is("deleted_at", null)
    .maybeSingle();
  if (nameErr) throw new Error(nameErr.message);
  const nameRow = (byName ?? null) as ClientRow | null;
  if (nameRow?.id) {
    await backfillClientPhone(supabase, nameRow, clientPhone);
    if (clientEmail) {
      const { error: emailUpdateErr } = await supabase
        .from("clients")
        .update({ email: clientEmail })
        .eq("id", nameRow.id)
        .is("deleted_at", null);
      if (emailUpdateErr) throw new Error(emailUpdateErr.message);
    }
    return {
      clientId: nameRow.id,
      clientFullName: canonicalName(nameRow, clientName),
      created: false,
    };
  }

  const { data: created, error: createErr } = await supabase
    .from("clients")
    .insert({
      full_name: clientName,
      email: clientEmail,
      phone: clientPhone,
      client_type: "commercial",
      source: "corporate",
      source_account_id: accountId,
    })
    .select("id, full_name")
    .single();
  if (createErr || !created?.id) {
    throw new Error(createErr?.message || "Could not create client.");
  }
  const createdRow = created as ClientRow;
  return {
    clientId: createdRow.id,
    clientFullName: canonicalName(createdRow, clientName),
    created: true,
  };
}

async function backfillClientPhone(
  supabase: SupabaseClient,
  row: ClientRow,
  clientPhone: string | null,
): Promise<void> {
  if (!clientPhone || row.phone?.trim()) return;
  const { error } = await supabase.from("clients").update({ phone: clientPhone }).eq("id", row.id);
  if (error) throw new Error(error.message);
}
