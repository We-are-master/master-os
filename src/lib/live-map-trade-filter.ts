import type { Partner } from "@/types/database";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";

function asPartnerStub(trade: string | undefined, trades: string[] | null | undefined): Pick<Partner, "trade" | "trades"> {
  return {
    trade: (trade ?? "").trim() || "General",
    trades: trades?.length ? trades : null,
  };
}

export function liveMapPointMatchesTradeFilter(
  point: { trade?: string; trades?: string[] | null },
  filterCanonical: string | "all",
): boolean {
  if (filterCanonical === "all") return true;
  return partnerMatchesTypeOfWork(asPartnerStub(point.trade, point.trades ?? null) as Partner, filterCanonical);
}
