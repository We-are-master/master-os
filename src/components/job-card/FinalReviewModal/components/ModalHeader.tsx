import { X } from "lucide-react";

type Props = {
  jobId: string;
  jobTitle: string;
  clientName: string;
  onClose: () => void;
};

export function ModalHeader({ jobId, jobTitle, clientName, onClose }: Props) {
  const initial = (clientName?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <div
      className="flex items-center justify-between px-6 pt-5 pb-[18px]"
      style={{ borderBottom: "0.5px solid var(--color-border-tertiary, #E4E4E7)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[13px] font-medium text-white shrink-0"
          style={{ background: "#020040" }}
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium" style={{ color: "#020040" }}>
              Final review
            </span>
            <span
              className="text-[11px] px-2 py-[2px] rounded-md font-medium"
              style={{ color: "#ED4B00", background: "#FFF1EB" }}
            >
              Awaiting approval
            </span>
          </div>
          <div className="text-[12px] mt-[2px] truncate" style={{ color: "#6B6B70" }}>
            {jobId} · {clientName} · {jobTitle}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1 leading-none bg-transparent border-none cursor-pointer shrink-0"
        style={{ color: "#9A9AA0" }}
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
