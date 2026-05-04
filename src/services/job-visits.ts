import { getSupabase, softDeleteById } from "./base";
import type { Job, JobVisit, JobVisitStatus } from "@/types/database";

type ListRow = JobVisit & {
  service_catalog?: { id: string; name: string } | null;
};

/** All non-soft-deleted visits for a job, ordered by visit_index ASC. */
export async function listJobVisits(jobId: string): Promise<JobVisit[]> {
  if (!jobId?.trim()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("job_visits")
    .select("*, service_catalog:catalog_service_id ( id, name )")
    .eq("job_id", jobId.trim())
    .is("deleted_at", null)
    .order("visit_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as ListRow;
    return { ...r, catalog_service_name: r.service_catalog?.name ?? null };
  });
}

/**
 * Insert a new visit. `visit_index` is NOT in input — assigned automatically
 * to `max(existing_index_for_job) + 1`, starting at 2 (visit 1 = parent job).
 */
export type CreateJobVisitInput = Omit<JobVisit,
  | "id" | "visit_index" | "created_at" | "updated_at" | "deleted_at"
  | "catalog_service_name" | "created_by" | "updated_by">;

export async function createJobVisit(input: CreateJobVisitInput): Promise<JobVisit> {
  const supabase = getSupabase();
  // Pick the next visit_index. Race-safe enough for the modest concurrency
  // expected on a job detail page; the unique partial index from mig 161
  // guards a real collision (returns 23505, caller can retry).
  const { data: existing, error: listErr } = await supabase
    .from("job_visits")
    .select("visit_index")
    .eq("job_id", input.job_id)
    .is("deleted_at", null)
    .order("visit_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (listErr) throw new Error(listErr.message);
  const nextIndex = (existing?.visit_index ?? 1) + 1; // 1 is the parent job → first visit becomes 2

  const { data, error } = await supabase
    .from("job_visits")
    .insert({ ...input, visit_index: nextIndex })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as JobVisit;
}

export async function updateJobVisit(id: string, patch: Partial<JobVisit>): Promise<JobVisit> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("job_visits")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as JobVisit;
}

export async function softDeleteJobVisit(id: string, deletedBy?: string): Promise<void> {
  await softDeleteById("job_visits", id, deletedBy);
}

export async function setVisitStatus(id: string, status: JobVisitStatus): Promise<JobVisit> {
  return updateJobVisit(id, { status });
}

/**
 * Visit-1 representation (read-only): synthesises a "primary" visit row from
 * the parent job's primary fields. Used by the Visits tab UI to render the
 * primary card uniformly with the extra visits.
 */
export interface PrimaryVisitView {
  /** Marker discriminator. */
  kind: "primary";
  job_id: string;
  visit_index: 1;
  catalog_service_id: string | null;
  partner_id: string | null;
  partner_name: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  expected_finish_at: string | null;
  client_price: number;
  partner_cost: number;
  materials_cost: number;
  /** The parent job status — surfaced for UX even though it's not really "per visit". */
  job_status: Job["status"];
  scope: string | null;
  notes: string | null;
}

export interface ExtraVisitView extends JobVisit { kind: "extra" }

export type VisitRow = PrimaryVisitView | ExtraVisitView;

export function jobToPrimaryVisit(job: Job): PrimaryVisitView {
  return {
    kind: "primary",
    job_id: job.id,
    visit_index: 1,
    catalog_service_id: job.catalog_service_id ?? null,
    partner_id: job.partner_id ?? null,
    partner_name: job.partner_name ?? null,
    scheduled_date: job.scheduled_date ?? null,
    scheduled_start_at: job.scheduled_start_at ?? null,
    scheduled_end_at: job.scheduled_end_at ?? null,
    expected_finish_at: job.expected_finish_at ?? null,
    client_price: Number(job.client_price ?? 0),
    partner_cost: Number(job.partner_cost ?? 0),
    materials_cost: Number(job.materials_cost ?? 0),
    job_status: job.status,
    scope: job.scope ?? null,
    notes: job.internal_notes ?? null,
  };
}

/**
 * Compose [primary, ...extras] in display order. The primary is read-only in
 * the UI (operator edits via the existing Details tab); extras are CRUD'able.
 */
export function listAllVisitsAsRows(job: Job, extras: JobVisit[]): VisitRow[] {
  const sorted = [...extras].sort((a, b) => a.visit_index - b.visit_index);
  return [
    jobToPrimaryVisit(job),
    ...sorted.map((v) => ({ ...v, kind: "extra" as const })),
  ];
}

/** Aggregate prices across primary + extras for the Visits-tab summary card. */
export function summariseVisits(job: Job, extras: JobVisit[]): {
  count: number;
  totalClientPrice: number;
  totalPartnerCost: number;
} {
  const liveExtras = extras.filter((v) => !v.deleted_at && v.status !== "cancelled");
  return {
    count: 1 + liveExtras.length,
    totalClientPrice: Number(job.client_price ?? 0) + liveExtras.reduce((s, v) => s + Number(v.client_price ?? 0), 0),
    totalPartnerCost: Number(job.partner_cost ?? 0) + liveExtras.reduce((s, v) => s + Number(v.partner_cost ?? 0), 0),
  };
}
