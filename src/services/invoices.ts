import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Invoice, InvoiceCollectionStage } from "@/types/database";

/** Payload for creating an invoice (collection fields default when omitted). */
export type CreateInvoiceInput = Omit<Invoice, "id" | "reference" | "created_at" | "collection_stage"> & {
  collection_stage?: InvoiceCollectionStage;
};

export async function listInvoices(params: ListParams): Promise<ListResult<Invoice>> {
  const p: ListParams = { ...params };
  if (p.status === "pending") {
    p.statusIn = ["pending", "partially_paid"];
    p.status = undefined;
  }
  return queryList<Invoice>("invoices", p, {
    searchColumns: ["reference", "client_name", "job_reference"],
    defaultSort: "created_at",
  });
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_invoice_ref");
  const collection_stage: InvoiceCollectionStage =
    input.collection_stage ??
    (input.invoice_kind === "deposit" ? "awaiting_deposit" : "awaiting_final");
  const row = {
    ...input,
    amount_paid: input.amount_paid ?? 0,
    collection_stage,
    collection_stage_locked: input.collection_stage_locked ?? false,
    invoice_kind: input.invoice_kind ?? "other",
  };
  const { data, error } = await supabase
    .from("invoices")
    .insert({ ...row, reference: ref })
    .select()
    .single();
  if (error) throw error;
  return data as Invoice;
}

/** Invoices tied to a job (by reference on the invoice + optional primary invoice id on the job). */
export async function listInvoicesLinkedToJob(
  jobReference: string,
  primaryInvoiceId?: string | null
): Promise<Invoice[]> {
  const supabase = getSupabase();
  const { data: byRef, error: e1 } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_reference", jobReference)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (e1) throw e1;
  const rows: Invoice[] = [...((byRef ?? []) as Invoice[])];
  if (primaryInvoiceId) {
    const { data: primary } = await supabase.from("invoices").select("*").eq("id", primaryInvoiceId).maybeSingle();
    const p = primary as Invoice | null;
    if (p && !rows.some((r) => r.id === p.id)) {
      rows.unshift(p);
    }
  }
  return rows;
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
