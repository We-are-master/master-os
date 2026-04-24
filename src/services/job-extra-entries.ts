import { getSupabase } from "@/services/base";

let jobExtraEntriesTableAvailable: boolean | null = null;

export function isJobExtraEntriesTableUnavailable(): boolean {
  return jobExtraEntriesTableAvailable === false;
}

function isMissingJobExtraEntriesTableError(err: unknown): boolean {
  if (typeof err !== "object" || err == null) return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  const details = "details" in err ? String((err as { details?: unknown }).details ?? "") : "";
  const haystack = `${message} ${details}`.toLowerCase();
  if (code === "PGRST205" || code === "42P01") return true;
  return haystack.includes("job_extra_entries") && (
    haystack.includes("could not find the table") ||
    haystack.includes("does not exist")
  );
}

export type JobExtraEntry = {
  id: string;
  job_id: string;
  side: "client" | "partner";
  extra_type: string;
  reason: string;
  amount: number;
  allocation: "extras" | "materials" | "partner_cost";
  linked_group_id?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_by_name?: string | null;
  deleted_reason?: string | null;
};

type ListJobExtraEntriesOptions = {
  includeDeleted?: boolean;
};

export async function listJobExtraEntries(
  jobId: string,
  options?: ListJobExtraEntriesOptions,
): Promise<JobExtraEntry[]> {
  if (jobExtraEntriesTableAvailable === false) return [];
  const id = jobId.trim();
  if (!id) return [];
  const supabase = getSupabase();
  let q = supabase
    .from("job_extra_entries")
    .select("*")
    .eq("job_id", id)
    .order("created_at", { ascending: false });
  if (!options?.includeDeleted) q = q.is("deleted_at", null);
  const { data, error } = await q;
  if (error) {
    if (isMissingJobExtraEntriesTableError(error)) {
      jobExtraEntriesTableAvailable = false;
      return [];
    }
    throw error;
  }
  jobExtraEntriesTableAvailable = true;
  return (data ?? []) as JobExtraEntry[];
}

type CreateJobExtraEntryInput = {
  job_id: string;
  side: "client" | "partner";
  extra_type: string;
  reason: string;
  amount: number;
  allocation: "extras" | "materials" | "partner_cost";
  linked_group_id?: string;
  created_by?: string;
  created_by_name?: string;
};

export async function createJobExtraEntry(input: CreateJobExtraEntryInput): Promise<JobExtraEntry> {
  if (jobExtraEntriesTableAvailable === false) {
    throw new Error("job_extra_entries table unavailable");
  }
  const supabase = getSupabase();
  const payload = {
    job_id: input.job_id.trim(),
    side: input.side,
    extra_type: input.extra_type.trim(),
    reason: input.reason.trim(),
    amount: Math.round(Number(input.amount) * 100) / 100,
    allocation: input.allocation,
    linked_group_id: input.linked_group_id?.trim() || null,
    created_by: input.created_by?.trim() || null,
    created_by_name: input.created_by_name?.trim() || null,
  };
  const { data, error } = await supabase
    .from("job_extra_entries")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    if (isMissingJobExtraEntriesTableError(error)) {
      jobExtraEntriesTableAvailable = false;
    }
    throw error;
  }
  jobExtraEntriesTableAvailable = true;
  return data as JobExtraEntry;
}

type SoftDeleteJobExtraEntryInput = {
  id: string;
  deletedBy?: string;
  deletedByName?: string;
  reason?: string;
};

export async function softDeleteJobExtraEntry(input: SoftDeleteJobExtraEntryInput): Promise<void> {
  if (jobExtraEntriesTableAvailable === false) return;
  const id = input.id.trim();
  if (!id) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("job_extra_entries")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: input.deletedBy?.trim() || null,
      deleted_by_name: input.deletedByName?.trim() || null,
      deleted_reason: input.reason?.trim() || null,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    if (isMissingJobExtraEntriesTableError(error)) {
      jobExtraEntriesTableAvailable = false;
      return;
    }
    throw error;
  }
  jobExtraEntriesTableAvailable = true;
}
