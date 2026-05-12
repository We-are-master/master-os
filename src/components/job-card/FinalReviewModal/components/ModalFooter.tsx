type Props = {
  forceMode: boolean;
  canApprove: boolean;
  canForceApprove: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onApprove: () => void;
  onForceApprove: () => void;
};

export function ModalFooter({
  forceMode,
  canApprove,
  canForceApprove,
  submitting,
  onCancel,
  onApprove,
  onForceApprove,
}: Props) {
  return (
    <div
      className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end bg-white px-5 py-3.5 sm:px-6 sm:py-3.5"
      style={{ borderTop: "0.5px solid var(--color-border-tertiary, #E4E4E7)" }}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="w-full sm:w-auto bg-transparent px-4 py-[9px] text-[13px] font-medium rounded-lg cursor-pointer transition-colors hover:bg-[#FAFAFB] disabled:cursor-not-allowed"
        style={{ border: "0.5px solid #D4D4D8", color: "#020040" }}
      >
        Cancel
      </button>

      {forceMode ? (
        <button
          type="button"
          onClick={onForceApprove}
          disabled={!canForceApprove || submitting}
          className="w-full sm:w-auto sm:min-w-[220px] px-[18px] py-[9px] text-[13px] font-medium rounded-lg text-white border-none transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[#D43F00]"
          style={{
            background: "#ED4B00",
            cursor: !canForceApprove || submitting ? "not-allowed" : "pointer",
          }}
        >
          <span aria-hidden>⚠</span>
          <span>Force finalise</span>
          <span aria-hidden className="text-[14px]">→</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onApprove}
          disabled={!canApprove || submitting}
          className="w-full sm:w-auto sm:min-w-[200px] px-[18px] py-[9px] text-[13px] font-medium rounded-lg text-white border-none transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed hover:enabled:bg-[#0a0860]"
          style={{
            background: "#020040",
            cursor: !canApprove || submitting ? "not-allowed" : "pointer",
          }}
        >
          <span>Finalise &amp; approve</span>
          <span aria-hidden className="text-[14px]">→</span>
        </button>
      )}
    </div>
  );
}
