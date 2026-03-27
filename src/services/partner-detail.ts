import { getSupabase } from "@/services/base";
import type { Profile } from "@/types/database";
import type { Job } from "@/types/database";

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  role: string;
  jobs_count: number;
  total_earnings: number;
}

export interface UserLocationRow {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  is_active: boolean;
  created_at: string;
}

export interface PartnerFinancialSummary {
  total_earned: number;
  total_paid: number;
  pending_payout: number;
  jobs_count: number;
  completed_count: number;
  self_bills_count: number;
}

/**
 * List app users for the "Team (App)" tab:
 * - profiles that appear as jobs.partner_id (field partners with assigned work), and
 * - profiles linked from the directory via partners.auth_user_id (even with 0 jobs).
 */
export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = getSupabase();
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("partner_id, partner_name, partner_cost")
    .not("partner_id", "is", null);
  if (jobsError) throw jobsError;

  const { data: linkedRows, error: linkErr } = await supabase
    .from("partners")
    .select("auth_user_id")
    .not("auth_user_id", "is", null);
  if (linkErr) throw linkErr;

  const fromJobs = [...new Set((jobs ?? []).map((j) => j.partner_id).filter(Boolean))] as string[];
  const fromDirectory = [...new Set((linkedRows ?? []).map((r) => r.auth_user_id).filter(Boolean))] as string[];
  const partnerIds = [...new Set([...fromJobs, ...fromDirectory])];
  if (partnerIds.length === 0) return [];

  const { data: profiles, error: profError } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url, role")
    .in("id", partnerIds);
  if (profError) throw profError;

  const jobsByPartner = (jobs ?? []).reduce<Record<string, { count: number; earnings: number }>>((acc, j) => {
    const id = j.partner_id as string;
    if (!acc[id]) acc[id] = { count: 0, earnings: 0 };
    acc[id].count += 1;
    acc[id].earnings += Number(j.partner_cost ?? 0);
    return acc;
  }, {});

  const rows = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name ?? "—",
    email: p.email ?? "",
    avatar_url: p.avatar_url,
    role: p.role ?? "operator",
    jobs_count: jobsByPartner[p.id]?.count ?? 0,
    total_earnings: jobsByPartner[p.id]?.earnings ?? 0,
  })) as TeamMember[];

  rows.sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }));
  return rows;
}

/** Latest location for one user (app partner) */
export async function getLatestLocation(userId: string): Promise<UserLocationRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("get_latest_user_location", { p_user_id: userId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row as UserLocationRow | null;
}

/** Jobs for a partner (by auth user id) */
export async function getJobsByPartnerUserId(userId: string): Promise<Job[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("partner_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Job[];
}

/** Profile by id */
export async function getProfileById(userId: string): Promise<Profile | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) return null;
  return data as Profile;
}

/** Financial summary for a partner (by auth user id: jobs + self_bills by partner_name) */
export async function getPartnerFinancial(userId: string): Promise<PartnerFinancialSummary> {
  const supabase = getSupabase();
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId).single();
  const partnerName = (profile as { full_name?: string } | null)?.full_name ?? null;

  const { data: jobs } = await supabase
    .from("jobs")
    .select("partner_cost, status")
    .eq("partner_id", userId);
  const jobList = (jobs ?? []) as { partner_cost: number; status: string }[];
  const total_earned = jobList.reduce((s, j) => s + Number(j.partner_cost ?? 0), 0);
  const completed_count = jobList.filter((j) => j.status === "completed" || j.status === "need_attention").length;

  let total_paid = 0;
  let pending_payout = 0;
  let self_bills_count = 0;
  if (partnerName) {
    const { data: bills } = await supabase
      .from("self_bills")
      .select("status, net_payout")
      .eq("partner_name", partnerName);
    const list = (bills ?? []) as { status: string; net_payout: number }[];
    self_bills_count = list.length;
    total_paid = list.filter((b) => b.status === "paid").reduce((s, b) => s + Number(b.net_payout ?? 0), 0);
    pending_payout = list
      .filter((b) => b.status === "awaiting_payment" || b.status === "ready_to_pay")
      .reduce((s, b) => s + Number(b.net_payout ?? 0), 0);
  }

  return {
    total_earned,
    total_paid,
    pending_payout,
    jobs_count: jobList.length,
    completed_count,
    self_bills_count,
  };
}
