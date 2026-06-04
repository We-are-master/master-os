"use client";

import { dueDateSourceLabel, type DueDateSource } from "@/lib/partner-payout-schedule";
import { formatDate } from "@/lib/utils";

type Props = {
  invoiceDueYmd: string;
  onInvoiceDueYmdChange: (v: string) => void;
  invoiceDueSource: DueDateSource;
  partnerDueYmd: string;
  onPartnerDueYmdChange: (v: string) => void;
  partnerDueSource: DueDateSource;
  showPartner: boolean;
  partnerTermsLabel: string | null;
  orgStandardTerms: string;
  orgPayoutReferenceYmd?: string | null;
  loading?: boolean;
};

function SourceChip({ source }: { source: DueDateSource }) {
  const colors: Record<DueDateSource, { bg: string; text: string }> = {
    standard: { bg: "rgba(2,0,64,0.08)", text: "#020040" },
    partner: { bg: "rgba(237,75,0,0.1)", text: "#C43D00" },
    custom: { bg: "rgba(107,107,112,0.12)", text: "#6B6B70" },
  };
  const c = colors[source];
  return (
    <span
      className="text-[10px] font-medium uppercase px-[6px] py-[2px] rounded"
      style={{ background: c.bg, color: c.text, letterSpacing: "0.4px" }}
    >
      {dueDateSourceLabel(source)}
    </span>
  );
}

export function PaymentScheduleSection({
  invoiceDueYmd,
  onInvoiceDueYmdChange,
  invoiceDueSource,
  partnerDueYmd,
  onPartnerDueYmdChange,
  partnerDueSource,
  showPartner,
  partnerTermsLabel,
  orgStandardTerms,
  orgPayoutReferenceYmd,
  loading,
}: Props) {
  return (
    <div className="px-6 pb-[18px] space-y-3">
      <div>
        <p className="text-[11px] font-medium uppercase mb-2" style={{ color: "#020040", letterSpacing: "0.6px" }}>
          Payment schedule
        </p>
        <p className="text-[11px] mb-3" style={{ color: "#6B6B70" }}>
          Confirm customer invoice and partner payout due dates before approving.
        </p>
      </div>

      <div
        className="rounded-[10px] space-y-3"
        style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E7", padding: "12px 14px" }}
      >
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label className="text-[11px] font-medium" style={{ color: "#020040" }}>
              Customer invoice due
            </label>
            <SourceChip source={invoiceDueSource} />
          </div>
          <input
            type="date"
            disabled={loading}
            value={invoiceDueYmd}
            onChange={(e) => onInvoiceDueYmdChange(e.target.value)}
            className="w-full rounded-[6px] px-3 py-[7px] text-[13px] disabled:opacity-50"
            style={{ border: "0.5px solid #D8D8DD", color: "#020040" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "#9A9AA0" }}>
            From linked account payment terms unless you change the date (Custom).
          </p>
        </div>

        {showPartner ? (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-[11px] font-medium" style={{ color: "#020040" }}>
                Partner payout due
              </label>
              <SourceChip source={partnerDueSource} />
            </div>
            <input
              type="date"
              disabled={loading}
              value={partnerDueYmd}
              onChange={(e) => onPartnerDueYmdChange(e.target.value)}
              className="w-full rounded-[6px] px-3 py-[7px] text-[13px] disabled:opacity-50"
              style={{ border: "0.5px solid #D8D8DD", color: "#020040" }}
            />
            <p className="text-[10px] mt-1" style={{ color: "#9A9AA0" }}>
              {partnerTermsLabel?.trim()
                ? `Partner schedule: ${partnerTermsLabel.trim()}`
                : orgPayoutReferenceYmd?.trim()
                  ? `Standard: ${orgStandardTerms} (ref ${formatDate(orgPayoutReferenceYmd.trim().slice(0, 10))})`
                  : `Standard: ${orgStandardTerms}`}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
