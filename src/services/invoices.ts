import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Invoice } from "@/types/database";

export async function listInvoices(params: ListParams): Promise<ListResult<Invoice>> {
  return queryList<Invoice>("invoices", params, {
    searchColumns: ["reference", "client_name", "job_reference"],
    defaultSort: "created_at",
  });
}

export async function createInvoice(
  input: Omit<Invoice, "id" | "reference" | "created_at">
): Promise<Invoice> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_invoice_ref");
  const { data, error } = await supabase
    .from("invoices")
    .insert({ ...input, reference: ref })
    .select()
    .single();
  if (error) throw error;
  return data as Invoice;
}

export async function updateInvoice(id: string, input: Partial<Invoice>): Promise<Invoice> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Invoice;
}
