import type { Partner } from "@/types/database";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

/**
 * Person / trade-form pairs that should match (request type of work vs partner trade label).
 * E.g. "Carpenter" on the request vs "Carpentry" on the partner card.
 */
const TRADE_SYNONYM_GROUPS: readonly string[][] = [
  ["carpenter", "carpentry", "carpenters"],
  ["plumber", "plumbing", "plumbers"],
  ["electrician", "electrical"],
  ["builder", "building", "builders"],
  ["painter", "painting", "painters"],
  ["cleaner", "cleaning"],
];

function matchesSynonymGroup(serviceLower: string, tradeLower: string): boolean {
  for (const group of TRADE_SYNONYM_GROUPS) {
    const hitS = group.some((g) => serviceLower === g || serviceLower.includes(g) || g.includes(serviceLower));
    const hitT = group.some((g) => tradeLower === g || tradeLower.includes(g) || g.includes(tradeLower));
    if (hitS && hitT) return true;
  }
  return false;
}

/** True if partner trade(s) align with request service type (type of work). */
export function partnerMatchesTypeOfWork(partner: Partner, serviceType: string): boolean {
  const raw = String(serviceType ?? "").trim();
  const stNorm = normalizeTypeOfWork(raw) || raw;
  const st = stNorm.toLowerCase();
  if (!st) return false;

  const tradeStrings = [partner.trade, ...((partner.trades ?? []) as string[])]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => normalizeTypeOfWork(String(s).trim()) || String(s).trim())
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  for (const t of tradeStrings) {
    if (st === t) return true;
    if (st.includes(t) || t.includes(st)) return true;
    if (matchesSynonymGroup(st, t)) return true;
    const stWords = st.split(/[\s/,&-]+/).filter((w) => w.length >= 3);
    const tWords = t.split(/[\s/,&-]+/).filter((w) => w.length >= 3);
    for (const sw of stWords) {
      for (const tw of tWords) {
        if (sw.includes(tw) || tw.includes(sw)) return true;
        if (matchesSynonymGroup(sw, tw)) return true;
      }
    }
  }
  return false;
}

/** Never throws — safe for filters and UI lists when data is partial. */
export function safePartnerMatchesTypeOfWork(partner: Partner, serviceType: string | null | undefined): boolean {
  try {
    return partnerMatchesTypeOfWork(partner, String(serviceType ?? ""));
  } catch {
    return false;
  }
}
