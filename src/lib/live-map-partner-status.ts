/**
 * Partner status model for the Beacon Live Operations map.
 *
 * Three operational states for dispatchers:
 *   in_job → available → offline
 */

export type LiveMapPartnerStatus = "in_job" | "available" | "offline";

export const LIVE_MAP_PARTNER_STATUS_ORDER: LiveMapPartnerStatus[] = [
  "in_job",
  "available",
  "offline",
];

/** Colors used both by the map markers and the partners panel. */
export const LIVE_MAP_PARTNER_STATUS_COLOR: Record<LiveMapPartnerStatus, string> = {
  in_job: "#0F6E56",
  available: "#10B981",
  offline: "#9A9AA0",
};

export const LIVE_MAP_PARTNER_STATUS_LABEL: Record<LiveMapPartnerStatus, string> = {
  in_job: "In job",
  available: "Available",
  offline: "Offline",
};

/** Single-line description shown under each status row in the panel. */
export const LIVE_MAP_PARTNER_STATUS_DESCRIPTION: Record<LiveMapPartnerStatus, string> = {
  in_job: "Active job in progress",
  available: "Online, no active job",
  offline: "No heartbeat for 15 min+",
};

export interface LiveMapPartnerStatusLegendEntry {
  key: LiveMapPartnerStatus;
  label: string;
  color: string;
  description: string;
}

export function liveMapPartnerStatusLegend(): LiveMapPartnerStatusLegendEntry[] {
  return LIVE_MAP_PARTNER_STATUS_ORDER.map((key) => ({
    key,
    label: LIVE_MAP_PARTNER_STATUS_LABEL[key],
    color: LIVE_MAP_PARTNER_STATUS_COLOR[key],
    description: LIVE_MAP_PARTNER_STATUS_DESCRIPTION[key],
  }));
}

/** Active-job statuses: a partner with one of these is "in a job". */
const ACTIVE_JOB_STATUSES = new Set([
  "in_progress",
  "late",
  "final_check",
]);

export interface PartnerStatusJobInput {
  partner_id: string | null | undefined;
  status: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  scheduled_start_at?: string | null;
}

export interface ComputePartnerStatusInput {
  partnerId: string;
  partnerLat: number;
  partnerLng: number;
  inactive: boolean;
  jobs: PartnerStatusJobInput[];
  nowMs?: number;
}

export function computePartnerStatus({
  partnerId,
  inactive,
  jobs,
}: ComputePartnerStatusInput): LiveMapPartnerStatus {
  const partnerJobs = jobs.filter((j) => j.partner_id === partnerId);

  for (const j of partnerJobs) {
    if (ACTIVE_JOB_STATUSES.has(j.status)) return "in_job";
  }

  return inactive ? "offline" : "available";
}
