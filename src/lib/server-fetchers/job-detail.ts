/**
 * Server-side data loader for the Job Detail page.
 *
 * Calls `get_job_detail_bundle` (migration 125) server-side so the page
 * arrives at the browser with job + client + partner + payments + invoice
 * + self_bill + line_items + reports + audit timeline already populated.
 */
import { repairJobIngestFromZendeskTicket } from "@/lib/zendesk-job-ingest";
import { createServiceClient } from "@/lib/supabase/service";
import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { JobDetailBundle } from "@/services/jobs";
import type { Job } from "@/types/database";

async function loadJobDetailBundle(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  id: string,
): Promise<JobDetailBundle | null> {
  const { data, error } = await supabase.rpc("get_job_detail_bundle", {
    p_job_id: id.trim(),
  });
  if (error || !data) return null;
  const payload = data as JobDetailBundle | { error: string };
  if ("error" in payload) return null;
  return payload;
}

async function repairZendeskJobOnLoad(jobId: string, job: Job): Promise<boolean> {
  if (job.external_source !== "zendesk" || !job.external_ref?.trim()) return false;

  const admin = createServiceClient();
  let accountCompanyName: string | null = null;
  const clientId = job.client_id?.trim();
  if (clientId) {
    const { data: client } = await admin
      .from("clients")
      .select("source_account_id")
      .eq("id", clientId)
      .maybeSingle();
    const accountId = (client as { source_account_id?: string } | null)?.source_account_id?.trim();
    if (accountId) {
      const { data: acc } = await admin
        .from("accounts")
        .select("company_name")
        .eq("id", accountId)
        .maybeSingle();
      accountCompanyName = (acc as { company_name?: string } | null)?.company_name?.trim() || null;
    }
  }

  const { patch, corrections } = await repairJobIngestFromZendeskTicket(
    admin,
    {
      id: job.id,
      reference: job.reference,
      client_id: job.client_id,
      client_address_id: job.client_address_id,
      client_name: job.client_name,
      property_address: job.property_address,
      status: job.status,
      partner_id: job.partner_id,
      catalog_service_id: job.catalog_service_id,
      external_source: job.external_source,
      external_ref: job.external_ref,
    },
    accountCompanyName,
  );

  if (Object.keys(patch).length === 0) return false;

  const { error } = await admin.from("jobs").update(patch).eq("id", jobId);
  if (error) {
    console.error("[job-detail] Zendesk repair on load failed:", error.message);
    return false;
  }
  if (corrections.length > 0) {
    console.info("[job-detail] Zendesk repair on load:", corrections.join(", "));
  }
  return true;
}

export async function fetchInitialJobDetail(id: string): Promise<JobDetailBundle | null> {
  if (!id?.trim()) return null;
  try {
    const supabase = await getServerSupabase();
    let bundle = await loadJobDetailBundle(supabase, id);
    if (!bundle?.job) return bundle;

    const job = bundle.job as Job;
    const repaired = await repairZendeskJobOnLoad(id.trim(), job);
    if (repaired) {
      bundle = await loadJobDetailBundle(supabase, id);
    }
    return bundle;
  } catch {
    return null;
  }
}
