/** Revenue split labels for CEO dashboard (mapped from quote.service_type / job title). */

export const CEO_SERVICE_TIER_ORDER = [
  "Quick Fix",
  "Multi Task",
  "Standard",
  "Project",
  "Emergency",
  "Other",
] as const;

export type CeoServiceTier = (typeof CEO_SERVICE_TIER_ORDER)[number];

export function classifyCeoServiceTier(
  serviceType: string | null | undefined,
  jobTitle: string | null | undefined
): CeoServiceTier {
  const s = `${serviceType ?? ""} ${jobTitle ?? ""}`.toLowerCase();
  if (/emergency|urgent|same\s*-?\s*day|out\s*of\s*hours/.test(s)) return "Emergency";
  if (/quick\s*-?\s*fix|call\s*-?\s*out|small\s*job|one\s*-?\s*off\s*visit/.test(s)) return "Quick Fix";
  if (/multi\s*-?\s*task|multiple\s*tasks|bundle/.test(s)) return "Multi Task";
  if (/project|refurb|renovation|extension|full\s*fit/.test(s)) return "Project";
  if (/standard|routine|maintenance|service\s*visit/.test(s)) return "Standard";
  if (s.trim().length > 0) return "Other";
  return "Other";
}
