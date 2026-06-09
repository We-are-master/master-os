import type { SupabaseClient } from "@supabase/supabase-js";

/** Trimmed `quotes.client_email` for billing when the linked client row has no email yet. */
export async function quoteClientEmailFallback(
  supabase: SupabaseClient,
  quoteId: string | null | undefined,
): Promise<string | null> {
  const id = quoteId?.trim();
  if (!id) return null;
  const { data } = await supabase.from("quotes").select("client_email").eq("id", id).maybeSingle();
  const email = (data as { client_email?: string | null } | null)?.client_email?.trim();
  return email || null;
}
