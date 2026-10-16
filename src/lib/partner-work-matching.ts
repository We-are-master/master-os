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
import { dataEmLondres, elegiveisParaJob } from "@/lib/capacity";

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
  /**
   * Job com serviço do catálogo (plano de 29/09/2026): o casamento é exato pelo
   * catálogo e respeita disponibilidade, folga, máx. por dia, valor mínimo e
   * jobs ativos do parceiro (elegibilidade-parceiro.ts). `categoria` é o
   * degrau 2 da oferta: qualquer serviço da mesma categoria.
   */
  degrau?: "servico" | "categoria";
  /** O próprio job (não conta na carga do dia quando já existe). */
  jobId?: string | null;
  /** O que o parceiro recebe: compara com o valor mínimo dele. */
  partnerCost?: number | null;
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

  // Job com serviço do catálogo: as regras novas decidem quem pode receber.
  const estrito = args.kind === "job" && !!args.catalogServiceId?.trim();
  let permitidos: Set<string> | null = null;
  if (estrito) {
    const slot = args.availabilitySlot ?? {};
    const data = slot.scheduledDate?.slice(0, 10) || (slot.startAt ? dataEmLondres(slot.startAt) : null);
    const el = await elegiveisParaJob(
      supabase,
      {
        id: args.jobId ?? undefined,
        status: "auto_assigning",
        catalog_service_id: args.catalogServiceId!.trim(),
        data,
        startAt: slot.startAt ?? null,
        endAt: slot.endAt ?? null,
        partner_cost: args.partnerCost ?? null,
      },
      args.degrau ?? "servico",
    );
    permitidos = new Set(el.elegiveis.map((p) => p.id));
  }

  return partners
    .filter((p) => {
      if (permitidos) {
        if (!permitidos.has(p.id)) return false;
      } else if (!partnerMatchesTypeOfWork(p, args.serviceType ?? "", args.catalogServiceId)) return false;
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
