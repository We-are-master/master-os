type Props = {
  canApprove: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onApprove: () => void;
  /**
   * True quando o job vai fechar SEM o relatório ter chegado à plataforma:
   * sem report, bloqueado, ou liberado à força. O botão muda de nome e de cor
   * porque a decisão é outra — e forçar sem perceber era o buraco.
   */
  forcado?: boolean;
};

export function ModalFooter({
  canApprove,
  submitting,
  onCancel,
  onApprove,
  forcado,
}: Props) {
  return (
    <div
      className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end bg-card border-t border-fx-line px-5 py-3.5 sm:px-6 sm:py-3.5"
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

      <button
        type="button"
        onClick={onApprove}
        disabled={!canApprove || submitting}
        className="w-full sm:w-auto sm:min-w-[200px] px-[18px] py-[9px] text-[13px] font-medium rounded-lg text-white border-none transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed"
        style={{
          background: forcado ? "#B45309" : "#020040",
          cursor: !canApprove || submitting ? "not-allowed" : "pointer",
        }}
      >
        <span>{forcado ? "Force approve" : "Finalise & approve"}</span>
        <span aria-hidden className="text-[14px]">→</span>
      </button>
    </div>
  );
}
