type Props = {
  margin: number;
  marginPct: number;
  partnerPayout: number;
  jobValue: number;
};

function fmtGBP(n: number) {
  return `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-[6px]">
      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
      <span style={{ color: "#6B6B70" }}>{label}</span>
      <span className="font-medium" style={{ color: "#020040" }}>{value}</span>
    </div>
  );
}

export function MarginHero({ margin, marginPct, partnerPayout, jobValue }: Props) {
  const total = Math.max(0, jobValue);
  const partnerPct = total > 0 ? Math.min(100, Math.max(0, (partnerPayout / total) * 100)) : 0;
  const fixfyPct = total > 0 ? Math.min(100, Math.max(0, (margin / total) * 100)) : 0;

  return (
    <div className="px-6 pt-6 pb-5" style={{ background: "#FAFAFB" }}>
      <div
        className="text-[13px] font-semibold uppercase mb-[8px]"
        style={{ color: "#020040", letterSpacing: "0.8px" }}
      >
        Margin
      </div>
      <div className="flex items-baseline gap-[12px] mb-4">
        <div
          className="text-[40px] font-semibold leading-none"
          style={{ color: "#020040", letterSpacing: "-0.8px" }}
        >
          {fmtGBP(margin)}
        </div>
        <div className="text-[16px] font-semibold" style={{ color: "#ED4B00" }}>
          {(Number.isFinite(marginPct) ? marginPct : 0).toFixed(1)}%
        </div>
      </div>

      <div
        className="flex h-[6px] rounded-[3px] overflow-hidden mb-[10px]"
        style={{ background: "#ECECEE" }}
      >
        <div style={{ width: `${partnerPct}%`, background: "#020040" }} />
        <div style={{ width: `${fixfyPct}%`, background: "#ED4B00" }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px]">
        <LegendItem color="#020040" label="Partner" value={fmtGBP(partnerPayout)} />
        <LegendItem color="#ED4B00" label="Fixfy" value={fmtGBP(margin)} />
        <div style={{ color: "#6B6B70" }}>
          Total{" "}
          <span className="font-medium ml-1" style={{ color: "#020040" }}>
            {fmtGBP(jobValue)}
          </span>
        </div>
      </div>
    </div>
  );
}
