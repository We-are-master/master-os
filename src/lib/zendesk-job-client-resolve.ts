import type { SupabaseClient } from "@supabase/supabase-js";

/** Quantas linhas lemos antes de escolher. Duplicata real e sempre 2 ou 3. */
const MATCH_LIMIT = 20;

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
 * O mesmo email pode estar em mais de um cliente da conta (dado sujo, nao erro).
 * Escolhe a linha cujo nome bate com o do ticket; sem nenhuma, devolve null e o
 * chamador cai na busca por nome.
 */
export function pickClientMatchedByEmail(
  rows: ClientRow[],
  clientName: string,
  accountCompanyName: string | null | undefined,
): ClientRow | null {
  const usaveis = rows.filter(
    (row) => row.id && shouldReuseClientByEmail(row.full_name, clientName, accountCompanyName),
  );
  // Entre as permitidas, o nome do ticket desempata; senao vale a mais antiga.
  return usaveis.find((row) => clientNamesEqual(row.full_name, clientName)) ?? usaveis[0] ?? null;
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
      .order("created_at", { ascending: true })
      .limit(MATCH_LIMIT);
    if (emailErr) throw new Error(emailErr.message);
    const row = pickClientMatchedByEmail(
      ((byEmail ?? []) as ClientRow[]),
      clientName,
      accountCompanyName,
    );
    if (row?.id) {
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
    .order("created_at", { ascending: true })
    .limit(MATCH_LIMIT);
  if (nameErr) throw new Error(nameErr.message);
  // Mesmo nome repetido na conta: a linha mais antiga e a canonica.
  const nameRow = (((byName ?? []) as ClientRow[]).find((row) => row.id) ?? null) as ClientRow | null;
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
