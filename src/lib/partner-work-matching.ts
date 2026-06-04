import type { SupabaseClient } from "@supabase/supabase-js";
import type { Partner } from "@/types/database";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";
import {
  partnerAvailableForSlot,
  type JobSlot,
  type PartnerAvailability,
} from "@/lib/partner-availability";
import {
  isPartnerExcludedByPostcode,
  outwardFromPostcode,
  partnerCoversJob,
  type JobCoverageTarget,
  type PartnerCoverageFields,
} from "@/lib/partner-coverage";
import { geocodeUkAddressServer } from "@/lib/job-geocode-server";

// Shared partner matching for distributing work (leads / job offers) to partners.
// Trade match + portal prefs + positive coverage (radius or postcodes) + excluded postcodes.

type PartnerPrefsRow = Partner &
  PartnerCoverageFields & {
  job_preferences?: { receiveLeads?: boolean; receiveEmergency?: boolean } | null;
  availability?: PartnerAvailability | null;
};

export interface MatchWorkArgs {
  serviceType?: string | null;
  catalogServiceId?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** "lead" honours the partner's receiveLeads opt-in; emergency honours receiveEmergency. */
  kind?: "lead" | "job";
  emergency?: boolean;
  /**
   * When set (job auto-assign), drop partners whose configured working days/hours
   * don't cover the booking slot. Partners with no availability configured pass.
   */
  availabilitySlot?: JobSlot;
}

const PARTNER_MATCH_SELECT =
  "id, trade, trades, catalog_service_ids, status, excluded_postcodes, job_preferences, availability, coverage_mode, service_radius_miles, coverage_latitude, coverage_longitude, coverage_base_postcode, included_postcodes, coverage_cities, uk_coverage_regions, location";

/** Active partners whose trade matches the work, who opted in, and whose coverage includes the job. */
export async function matchPartnerIdsForWork(supabase: SupabaseClient, args: MatchWorkArgs): Promise<string[]> {
  const { data } = await supabase
    .from("partners")
    .select(PARTNER_MATCH_SELECT)
    .eq("status", "active");

  const partners = (data ?? []) as unknown as PartnerPrefsRow[];
  const outward = outwardFromPostcode(args.postcode);
  let lat = args.latitude ?? null;
  let lng = args.longitude ?? null;
  if ((lat == null || lng == null) && args.postcode?.trim()) {
    const coords = await geocodeUkAddressServer(args.postcode);
    if (coords) {
      lat = coords.latitude;
      lng = coords.longitude;
    }
  }
  const target: JobCoverageTarget = {
    postcode: args.postcode,
    latitude: lat,
    longitude: lng,
  };

  return partners
    .filter((p) => {
      if (!partnerMatchesTypeOfWork(p, args.serviceType ?? "", args.catalogServiceId)) return false;
      const prefs = p.job_preferences ?? null;
      if (args.kind === "lead" && prefs && prefs.receiveLeads === false) return false;
      if (args.emergency && prefs && prefs.receiveEmergency === false) return false;
      if (outward && isPartnerExcludedByPostcode(p, outward)) return false;
      if (!partnerCoversJob(p, target)) return false;
      if (args.availabilitySlot && !partnerAvailableForSlot(p.availability, args.availabilitySlot)) {
        return false;
      }
      return true;
    })
    .map((p) => p.id);
}
