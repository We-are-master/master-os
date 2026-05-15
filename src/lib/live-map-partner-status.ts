/**
 * Partner status model for the Beacon Live Operations map.
 *
 * Replaces the binary Active/Inactive heartbeat flag with five operational
 * states so the dispatcher can answer "who is in a job / who isn't" without
 * cross-referencing the jobs list.
 *
 * Priority order when multiple states could apply (highest first):
 *   on_site  → in_job  → en_route  → available  → offline
 */

export type LiveMapPartnerStatus =
  | "on_site"
  | "in_job"
  | "en_route"
  | "available"
  | "offline";

export const LIVE_MAP_PARTNER_STATUS_ORDER: LiveMapPartnerStatus[] = [
  "on_site",
  "in_job",
  "en_route",
  "available",
  "offline",
];

/** Colors used both by the map markers and the partners panel. */
export const LIVE_MAP_PARTNER_STATUS_COLOR: Record<LiveMapPartnerStatus, string> = {
  on_site: "#0F6E56",
  in_job: "#0F6E56",
  en_route: "#378ADD",
  available: "#10B981",
  offline: "#9A9AA0",
};

export const LIVE_MAP_PARTNER_STATUS_LABEL: Record<LiveMapPartnerStatus, string> = {
  on_site: "On site",
  in_job: "In job",
  en_route: "En route",
  available: "Available",
  offline: "Offline",
};

/** Single-line description shown under each status row in the panel. */
export const LIVE_MAP_PARTNER_STATUS_DESCRIPTION: Record<LiveMapPartnerStatus, string> = {
  on_site: "On a job and physically at the site",
  in_job: "Job in progress, location not yet matched",
  en_route: "Job starts within 60 min",
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

/** Haversine distance in metres. */
function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance threshold for the on-site sub-state, in metres. */
export const ON_SITE_RADIUS_M = 150;

/** En-route lookahead window — a partner is "en route" if a scheduled job
 *  starts within this many minutes from now. */
export const EN_ROUTE_WINDOW_MINUTES = 60;

/** Active-job statuses: a partner with one of these is "in a job". */
const ACTIVE_JOB_STATUSES = new Set([
  "in_progress",
  "late",
  "final_check",
]);

/** Pre-active statuses: a partner assigned to one is "en route" if it starts soon. */
const EN_ROUTE_JOB_STATUSES = new Set([
  "scheduled",
  "auto_assigning",
  "unassigned",
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
  partnerLat,
  partnerLng,
  inactive,
  jobs,
  nowMs,
}: ComputePartnerStatusInput): LiveMapPartnerStatus {
  const now = nowMs ?? Date.now();
  const partnerJobs = jobs.filter((j) => j.partner_id === partnerId);

  // 1. on_site: active job + within radius. Requires both partner and job coords.
  // 2. in_job: active job, no/insufficient geo match.
  let hasActive = false;
  for (const j of partnerJobs) {
    if (!ACTIVE_JOB_STATUSES.has(j.status)) continue;
    hasActive = true;
    if (
      typeof j.latitude === "number" &&
      typeof j.longitude === "number" &&
      Number.isFinite(j.latitude) &&
      Number.isFinite(j.longitude)
    ) {
      const d = distanceMeters(partnerLat, partnerLng, j.latitude, j.longitude);
      if (d <= ON_SITE_RADIUS_M) return "on_site";
    }
  }
  if (hasActive) return "in_job";

  // 3. en_route: scheduled/late job starting within EN_ROUTE_WINDOW_MINUTES.
  const enRouteCutoffMs = now + EN_ROUTE_WINDOW_MINUTES * 60_000;
  for (const j of partnerJobs) {
    if (!EN_ROUTE_JOB_STATUSES.has(j.status)) continue;
    if (!j.scheduled_start_at) continue;
    const startMs = new Date(j.scheduled_start_at).getTime();
    if (Number.isNaN(startMs)) continue;
    if (startMs > now && startMs <= enRouteCutoffMs) return "en_route";
  }

  // 4. available vs 5. offline.
  return inactive ? "offline" : "available";
}
