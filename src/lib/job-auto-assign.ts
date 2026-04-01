import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job, Partner } from "@/types/database";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";

/**
 * Active partners whose trades match the job title / type of work (same rules as manual partner picker).
 */
export function filterPartnersMatchingJobTitle(partners: Partner[], jobTitle: string): Partner[] {
  const title = String(jobTitle ?? "").trim();
  if (!title) return [];
  return (partners ?? []).filter((p) => partnerMatchesTypeOfWork(p, title));
}

export async function fetchActivePartners(admin: SupabaseClient): Promise<Partner[]> {
  const { data, error } = await admin.from("partners").select("*").eq("status", "active");
  if (error) throw error;
  return (data ?? []) as Partner[];
}

export function partnerDisplayName(p: Pick<Partner, "company_name" | "contact_name">): string {
  const c = p.company_name?.trim();
  if (c) return c;
  return p.contact_name?.trim() || "Partner";
}

/** Atomic assign: only if still auto_assigning, unassigned, and window open. */
export type AutoAssignAcceptPatch = {
  partner_id: string;
  partner_name: string;
  status: "scheduled";
  auto_assign_expires_at: null;
  auto_assign_invited_partner_ids: null;
  auto_assign_minutes: null;
  updated_at: string;
};

export function buildAutoAssignAcceptPatch(partner: Partner): AutoAssignAcceptPatch {
  return {
    partner_id: partner.id,
    partner_name: partnerDisplayName(partner),
    status: "scheduled",
    auto_assign_expires_at: null,
    auto_assign_invited_partner_ids: null,
    auto_assign_minutes: null,
    updated_at: new Date().toISOString(),
  };
}

export function jobTitleForAutoAssignMatch(job: Pick<Job, "title">): string {
  return String(job.title ?? "").trim();
}
