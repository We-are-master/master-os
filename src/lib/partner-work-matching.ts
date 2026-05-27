import type { SupabaseClient } from "@supabase/supabase-js";
import type { Partner } from "@/types/database";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";

// Shared partner matching for distributing work (leads / job offers) to partners.
// Builds on partnerMatchesTypeOfWork (trade match) and adds the partner self-service
// preferences set in the Trade Portal: lead/emergency opt-in and excluded postcodes.
//
// NOTE: distance from base postcode (partners.service_radius_miles) is NOT enforced here —
// that needs lat/long geocoding we don't have; only outward-code exclusion is applied.

type PartnerPrefsRow = Partner & {
  excluded_postcodes?: string[] | null;
  job_preferences?: { receiveLeads?: boolean; receiveEmergency?: boolean } | null;
};

/** Outward part of a UK postcode (e.g. "SW11 4PG" -> "SW11"); inward is always the last 3 chars. */
function outwardCode(pc?: string | null): string {
  if (!pc) return "";
  const s = pc.toUpperCase().replace(/\s+/g, "");
  return s.length > 3 ? s.slice(0, s.length - 3) : s;
}

export interface MatchWorkArgs {
  serviceType?: string | null;
  catalogServiceId?: string | null;
  postcode?: string | null;
  /** "lead" honours the partner's receiveLeads opt-in; emergency honours receiveEmergency. */
  kind?: "lead" | "job";
  emergency?: boolean;
}

/** Active partners whose trade matches the work, who opted in, and aren't excluded by postcode. */
export async function matchPartnerIdsForWork(supabase: SupabaseClient, args: MatchWorkArgs): Promise<string[]> {
  const { data } = await supabase
    .from("partners")
    .select("id, trade, trades, catalog_service_ids, status, excluded_postcodes, job_preferences")
    .eq("status", "active");

  const partners = (data ?? []) as unknown as PartnerPrefsRow[];
  const outward = outwardCode(args.postcode);

  return partners
    .filter((p) => {
      if (!partnerMatchesTypeOfWork(p, args.serviceType ?? "", args.catalogServiceId)) return false;
      const prefs = p.job_preferences ?? null;
      if (args.kind === "lead" && prefs && prefs.receiveLeads === false) return false;
      if (args.emergency && prefs && prefs.receiveEmergency === false) return false;
      if (outward && Array.isArray(p.excluded_postcodes)) {
        const blocked = p.excluded_postcodes.some((ex) => {
          const e = String(ex ?? "").toUpperCase().replace(/\s+/g, "");
          return e.length > 0 && outward.startsWith(e);
        });
        if (blocked) return false;
      }
      return true;
    })
    .map((p) => p.id);
}
