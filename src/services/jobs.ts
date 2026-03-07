import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Job } from "@/types/database";

export async function listJobs(params: ListParams): Promise<ListResult<Job>> {
  return queryList<Job>("jobs", params, {
    searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
    defaultSort: "created_at",
  });
}

export async function getJob(id: string): Promise<Job | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Job;
}

export async function getJobByQuoteId(quoteId: string): Promise<Job | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as Job | null;
}

export async function createJob(
  input: Omit<Job, "id" | "reference" | "created_at" | "updated_at">
): Promise<Job> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_job_ref");
  const { data, error } = await supabase
    .from("jobs")
    .insert({ ...input, reference: ref })
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}

export async function updateJob(
  id: string,
  input: Partial<Job>
): Promise<Job> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}
