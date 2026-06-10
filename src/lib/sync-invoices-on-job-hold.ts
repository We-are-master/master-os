import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, InvoiceStatus } from "@/types/database";

const TERMINAL: InvoiceStatus[] = ["paid", "cancelled"];

export async function holdLinkedInvoicesForJob(
  client: SupabaseClient,
  jobReference: string,
): Promise<number> {
  const ref = jobReference.trim();
  if (!ref) return 0;

  const { data, error } = await client
    .from("invoices")
    .select("id, status, on_hold_previous_status")
    .eq("job_reference", ref)
    .is("deleted_at", null);
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const inv = row as Pick<Invoice, "id" | "status" | "on_hold_previous_status">;
    if (TERMINAL.includes(inv.status) || inv.status === "on_hold") continue;
    const { error: upErr } = await client
      .from("invoices")
      .update({
        status: "on_hold",
        on_hold_previous_status: inv.on_hold_previous_status ?? inv.status,
      })
      .eq("id", inv.id);
    if (upErr) throw upErr;
    updated += 1;
  }
  return updated;
}

export async function releaseLinkedInvoicesForJob(
  client: SupabaseClient,
  jobReference: string,
): Promise<number> {
  const ref = jobReference.trim();
  if (!ref) return 0;

  const { data, error } = await client
    .from("invoices")
    .select("id, status, on_hold_previous_status")
    .eq("job_reference", ref)
    .eq("status", "on_hold")
    .is("deleted_at", null);
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const inv = row as Pick<Invoice, "id" | "on_hold_previous_status">;
    const restore = (inv.on_hold_previous_status?.trim() || "pending") as InvoiceStatus;
    const { error: upErr } = await client
      .from("invoices")
      .update({
        status: restore,
        on_hold_previous_status: null,
      })
      .eq("id", inv.id);
    if (upErr) throw upErr;
    updated += 1;
  }
  return updated;
}
