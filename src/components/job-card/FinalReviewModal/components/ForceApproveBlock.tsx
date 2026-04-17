type Props = {
  reason: string;
  onReasonChange: (v: string) => void;
  onCancel: () => void;
  currentUserName: string;
};

export function ForceApproveBlock({ reason, onReasonChange, onCancel, currentUserName }: Props) {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="px-6 pb-[18px]">
      <div
        className="rounded-[12px] relative overflow-hidden"
        style={{ background: "#FFF8F3", border: "0.5px solid #F5CFB8", padding: "14px 16px" }}
      >
        <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: "#ED4B00" }} />

        <div className="flex items-center justify-between mb-[10px]">
          <div className="flex items-center gap-2">
            <div
              className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-medium text-white"
              style={{ background: "#ED4B00" }}
            >
              ⚠
            </div>
            <span className="text-[13px] font-medium" style={{ color: "#993C1D" }}>
              Force approve — reason required
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] bg-transparent border-none cursor-pointer hover:underline"
            style={{ color: "#993C1D" }}
          >
            Cancel force ✕
          </button>
        </div>

        <div className="text-[11px] mb-2 leading-[1.5]" style={{ color: "#6B6B70" }}>
          You&apos;re approving without uploaded reports. This will be logged in the job audit trail
          and visible to the team.
        </div>

        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Why are you force approving this job? (min. 20 characters, mandatory)"
          className="w-full box-border min-h-[70px] rounded-lg px-3 py-[10px] text-[13px] bg-white resize-vertical outline-none"
          style={{
            border: "0.5px solid #F5CFB8",
            color: "#020040",
            fontFamily: "inherit",
          }}
          onFocus={(e) => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = "#ED4B00")}
          onBlur={(e) => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = "#F5CFB8")}
        />

        <div className="flex justify-between mt-[6px] text-[11px]">
          <span style={{ color: reason.trim().length >= 20 ? "#0F6E56" : "#9A9AA0" }}>
            {reason.length} / 20 min
          </span>
          <span style={{ color: "#6B6B70" }}>
            Logged as:{" "}
            <span className="font-medium" style={{ color: "#020040" }}>
              {currentUserName}
            </span>{" "}
            · {today}
          </span>
        </div>
      </div>
    </div>
  );
}
