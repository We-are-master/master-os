import type { Partner } from "@/types/database";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";
import {
  formatPartnerCoverageSummary,
  partnerCoversJob,
  type JobCoverageTarget,
  type PartnerCoverageFields,
} from "@/lib/partner-coverage";

export type CoverageSearchTarget = {
  postcode?: string;
  latitude: number;
  longitude: number;
  label?: string;
};

export type PartnerCoverageRow = PartnerCoverageFields &
  Pick<
    Partner,
    "id" | "company_name" | "contact_name" | "trade" | "trades" | "catalog_service_ids" | "status" | "auth_user_id"
  >;

export type MatchedCoveragePartner = {
  partner: PartnerCoverageRow;
  coverageSummary: string;
  isOnlineNow: boolean;
};

export function activePartnersCoveringTarget(
  partners: PartnerCoverageRow[],
  target: CoverageSearchTarget,
  tradeFilter: "all" | string,
  onlineAuthUserIds: ReadonlySet<string>,
): MatchedCoveragePartner[] {
  const jobTarget: JobCoverageTarget = {
    postcode: target.postcode,
    latitude: target.latitude,
    longitude: target.longitude,
  };

  const out: MatchedCoveragePartner[] = [];
  for (const partner of partners) {
    if (partner.status !== "active") continue;
    if (tradeFilter !== "all" && !partnerMatchesTypeOfWork(partner as Partner, tradeFilter)) continue;
    if (!partnerCoversJob(partner, jobTarget)) continue;
    const authId = partner.auth_user_id?.trim();
    out.push({
      partner,
      coverageSummary: formatPartnerCoverageSummary(partner),
      isOnlineNow: Boolean(authId && onlineAuthUserIds.has(authId)),
    });
  }

  out.sort((a, b) => {
    if (a.isOnlineNow !== b.isOnlineNow) return a.isOnlineNow ? -1 : 1;
    return (a.partner.company_name ?? "").localeCompare(b.partner.company_name ?? "");
  });
  return out;
}
