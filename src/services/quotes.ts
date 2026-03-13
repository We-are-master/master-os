import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Quote } from "@/types/database";

export async function listQuotes(params: ListParams): Promise<ListResult<Quote>> {
  return queryList<Quote>("quotes", params, {
    searchColumns: ["reference", "title", "client_name", "client_email"],
    defaultSort: "created_at",
  });
}

export async function getQuote(id: string): Promise<Quote | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Quote;
}

export async function createQuote(
  input: Omit<Quote, "id" | "reference" | "created_at" | "updated_at">
): Promise<Quote> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_quote_ref");
  const { data, error } = await supabase
    .from("quotes")
    .insert({ ...input, reference: ref })
    .select()
    .single();
  if (error) throw error;
  return data as Quote;
}

export async function updateQuote(
  id: string,
  input: Partial<Quote>
): Promise<Quote> {
  const supabase = getSupabase();
  const payload = { ...input, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("quotes")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Quote;
}
