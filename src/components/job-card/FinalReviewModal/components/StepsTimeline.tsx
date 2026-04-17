import type { InvoiceDisplayStatus, ReportItem, SelfBillDisplayStatus } from "../types";

type StepState = "issued" | "approved" | "pending" | "on_hold" | "blocked";

type Props = {
  invoiceStatus: InvoiceDisplayStatus;
  selfBillStatus: SelfBillDisplayStatus;
  invoiceReference?: string | null;
  selfBillReference?: string | null;
  jobValue: number;
  partnerPayout: number;
  reports: ReportItem[];
  forceMode: boolean;
  onForceApproveClick: () => void;
};

function fmtGBP(n: number) {
  return `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function stepLabel(state: StepState): string {
  if (state === "issued") return "Issued";
  if (state === "approved") return "Approved";
  if (state === "on_hold") return "On hold";
  return "Pending";
}

function textColor(state: StepState): string {
  if (state === "issued" || state === "approved") return "#020040";
  if (state === "on_hold") return "#A32D2D";
  if (state === "blocked") return "#9A9AA0";
  return "#ED4B00";
}

function Circle({ state, index }: { state: StepState; index: number }) {
  if (state === "issued" || state === "approved") {
    return (
      <div
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-white text-[11px]"
        style={{ background: "#020040" }}
      >
        ✓
      </div>
    );
  }
  if (state === "on_hold") {
    return (
      <div
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-medium bg-white"
        style={{ border: "1.5px solid #A32D2D", color: "#A32D2D" }}
      >
        !
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-medium bg-white"
        style={{ border: "1.5px solid #9A9AA0", color: "#9A9AA0" }}
      >
        {index}
      </div>
    );
  }
  return (
    <div
      className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-medium bg-white"
      style={{ border: "1.5px solid #ED4B00", color: "#ED4B00" }}
    >
      {index}
    </div>
  );
}

export function StepsTimeline({
  invoiceStatus,
  selfBillStatus,
  invoiceReference,
  selfBillReference,
  jobValue,
  partnerPayout,
  reports,
  forceMode,
  onForceApproveClick,
}: Props) {
  const invoiceState: StepState =
    invoiceStatus === "issued" ? "issued" : invoiceStatus === "on_hold" ? "on_hold" : "pending";
  const selfBillState: StepState =
    selfBillStatus === "issued" ? "issued" : selfBillStatus === "on_hold" ? "on_hold" : "pending";

  const allUploaded = reports.length > 0 && reports.every((r) => r.uploaded);
  const allApproved = reports.length > 0 && reports.every((r) => r.approved);
  const reportsUploadedState: StepState = allUploaded ? "issued" : "pending";
  const reportsApprovedState: StepState = !allUploaded ? "blocked" : allApproved ? "approved" : "pending";

  const completedCount =
    [invoiceState, selfBillState, reportsUploadedState, reportsApprovedState].filter(
      (s) => s === "issued" || s === "approved",
    ).length;
  const completedPct = (completedCount / 4) * 100;

  const steps: Array<{
    index: number;
    title: string;
    state: StepState;
    subtitle?: React.ReactNode;
    trailing?: React.ReactNode;
  }> = [
    {
      index: 1,
      title: "Client invoice",
      state: invoiceState,
      subtitle: (
        <span className="text-[12px]" style={{ color: "#6B6B70" }}>
          {invoiceReference ? `${invoiceReference} · ` : ""}
          {fmtGBP(jobValue)}
        </span>
      ),
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(invoiceState) }}>
          {stepLabel(invoiceState)}
        </span>
      ),
    },
    {
      index: 2,
      title: "Partner self-bill",
      state: selfBillState,
      subtitle: (
        <span className="text-[12px]" style={{ color: "#6B6B70" }}>
          {selfBillReference ? `${selfBillReference} · ` : ""}
          {fmtGBP(partnerPayout)}
        </span>
      ),
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(selfBillState) }}>
          {stepLabel(selfBillState)}
        </span>
      ),
    },
    {
      index: 3,
      title: "Partner reports uploaded",
      state: reportsUploadedState,
      subtitle: (
        <div className="flex flex-wrap gap-[6px] mt-[6px]">
          {reports.map((r) => (
            <span
              key={r.id}
              className="text-[11px] px-2 py-[3px] rounded-[5px]"
              style={{
                background: r.uploaded ? "#F1F5FB" : "#FFF1EB",
                color: r.uploaded ? "#020040" : "#ED4B00",
              }}
            >
              {r.name} · {r.uploaded ? "uploaded" : "missing"}
            </span>
          ))}
        </div>
      ),
      trailing:
        !allUploaded && !forceMode ? (
          <button
            type="button"
            onClick={onForceApproveClick}
            className="text-[11px] text-white font-medium border-none px-[11px] py-[6px] rounded-md cursor-pointer whitespace-nowrap flex items-center gap-[4px]"
            style={{ background: "#ED4B00" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#D43F00")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#ED4B00")}
          >
            <span className="text-[11px]">⚠</span> Force approve
          </button>
        ) : null,
    },
    {
      index: 4,
      title: "Reports reviewed by you",
      state: reportsApprovedState,
      subtitle: !allUploaded ? (
        <span className="text-[12px]" style={{ color: "#9A9AA0" }}>
          Available after upload
        </span>
      ) : null,
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(reportsApprovedState) }}>
          {stepLabel(reportsApprovedState)}
        </span>
      ),
    },
  ];

  return (
    <div className="relative px-6 pt-5 pb-4">
      <div
        className="absolute left-[33px] top-[30px] bottom-[20px] w-[2px]"
        style={{
          background: `linear-gradient(180deg, #020040 0%, #020040 ${completedPct}%, #ECECEE ${completedPct}%, #ECECEE 100%)`,
        }}
      />
      <ul className="flex flex-col gap-4 relative">
        {steps.map((s) => (
          <li key={s.index} className="flex items-start gap-3">
            <div className="shrink-0 mt-[1px]">
              <Circle state={s.state} index={s.index} />
            </div>
            <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="text-[13px] font-medium"
                  style={{ color: s.state === "blocked" ? "#9A9AA0" : "#020040" }}
                >
                  {s.title}
                </div>
                {s.subtitle}
              </div>
              {s.trailing ? <div className="shrink-0">{s.trailing}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
