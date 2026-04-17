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
      className="flex gap-[10px] items-center justify-end bg-white"
      style={{
        padding: "14px 20px 14px 24px",
        borderTop: "0.5px solid var(--color-border-tertiary, #E4E4E7)",
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="bg-transparent px-4 py-[9px] text-[13px] rounded-lg cursor-pointer"
        style={{ border: "0.5px solid #D4D4D8", color: "#020040" }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#FAFAFB")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
      >
        Cancel
      </button>

      {forceMode ? (
        <button
          type="button"
          onClick={onForceApprove}
          disabled={!canForceApprove || submitting}
          className="text-white border-none px-[18px] py-[9px] text-[13px] font-medium rounded-lg flex items-center gap-[6px] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "#ED4B00", cursor: !canForceApprove || submitting ? "not-allowed" : "pointer" }}
          onMouseEnter={(e) => {
            if (!(e.currentTarget as HTMLButtonElement).disabled)
              (e.currentTarget as HTMLButtonElement).style.background = "#D43F00";
          }}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#ED4B00")}
        >
          <span className="text-[12px]">⚠</span> Force finalise &amp; send
          <span className="text-[14px]">→</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onApprove}
          disabled={!canApprove || submitting}
          className="text-white border-none px-[18px] py-[9px] text-[13px] font-medium rounded-lg flex items-center gap-[6px] disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ background: "#020040", cursor: !canApprove || submitting ? "not-allowed" : "pointer" }}
          onMouseEnter={(e) => {
            if (!(e.currentTarget as HTMLButtonElement).disabled)
              (e.currentTarget as HTMLButtonElement).style.background = "#0a0860";
          }}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#020040")}
        >
          Finalise &amp; send <span className="text-[14px]">→</span>
        </button>
      )}
    </div>
  );
}
