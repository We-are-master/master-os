type Props = {
  clientName: string;
  partnerName: string;
  received: number;
  paidOut: number;
  clientOutstanding: number;
  partnerOutstanding: number;
};

function fmtGBP(n: number) {
  return `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

export function FinanceCards({
  clientName,
  partnerName,
  received,
  paidOut,
  clientOutstanding,
  partnerOutstanding,
}: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-[22px]" style={{ padding: "0 24px 22px" }}>
      {/* Client card — navy tinted */}
      <div
        className="rounded-[12px] relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #F4F5FB 0%, #EDEEF7 100%)",
          border: "0.5px solid #D8DBEE",
          boxShadow:
            "0 2px 8px -2px rgba(2,0,64,0.08), inset 0 1px 0 rgba(255,255,255,0.6)",
          padding: "14px 16px",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "#020040" }} />
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-[7px]">
            <div
              className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-[10px] font-medium text-white"
              style={{ background: "#020040" }}
            >
              C
            </div>
            <span
              className="text-[11px] uppercase font-medium"
              style={{ color: "#020040", letterSpacing: "0.6px" }}
            >
              Client
            </span>
          </div>
          <span
            className="text-[10px] px-[6px] py-[2px] rounded truncate max-w-[45%]"
            style={{ color: "#6B6B70", background: "rgba(255,255,255,0.7)" }}
          >
            {clientName}
          </span>
        </div>
        <div
          className="flex justify-between text-[12px] mb-[6px] pb-[6px]"
          style={{ borderBottom: "0.5px solid rgba(2,0,64,0.1)" }}
        >
          <span style={{ color: "#6B6B70" }}>Received</span>
          <span className="font-medium" style={{ color: "#020040" }}>
            {fmtGBP(received)}
          </span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="font-medium" style={{ color: "#020040" }}>
            To receive
          </span>
          <span className="font-medium" style={{ color: "#ED4B00" }}>
            {fmtGBP(clientOutstanding)}
          </span>
        </div>
      </div>

      {/* Partner card — coral tinted */}
      <div
        className="rounded-[12px] relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #FFF5F0 0%, #FFE9DC 100%)",
          border: "0.5px solid #F5CFB8",
          boxShadow:
            "0 2px 8px -2px rgba(237,75,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6)",
          padding: "14px 16px",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "#ED4B00" }} />
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-[7px]">
            <div
              className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-[10px] font-medium text-white"
              style={{ background: "#ED4B00" }}
            >
              P
            </div>
            <span
              className="text-[11px] uppercase font-medium"
              style={{ color: "#993C1D", letterSpacing: "0.6px" }}
            >
              Partner
            </span>
          </div>
          <span
            className="text-[10px] px-[6px] py-[2px] rounded truncate max-w-[45%]"
            style={{ color: "#993C1D", background: "rgba(255,255,255,0.7)" }}
          >
            {partnerName || "—"}
          </span>
        </div>
        <div
          className="flex justify-between text-[12px] mb-[6px] pb-[6px]"
          style={{ borderBottom: "0.5px solid rgba(237,75,0,0.15)" }}
        >
          <span style={{ color: "#6B6B70" }}>Paid</span>
          <span className="font-medium" style={{ color: "#020040" }}>
            {fmtGBP(paidOut)}
          </span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="font-medium" style={{ color: "#993C1D" }}>
            To pay
          </span>
          <span className="font-medium" style={{ color: "#020040" }}>
            {fmtGBP(partnerOutstanding)}
          </span>
        </div>
      </div>
    </div>
  );
}
