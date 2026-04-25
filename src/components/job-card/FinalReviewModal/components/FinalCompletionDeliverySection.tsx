import type { AccountFinalEmailPolicy } from "@/lib/account-final-email-policy";
import { canSendClientEmailWithPack } from "@/lib/account-final-email-policy";
import type { CompletionDelivery } from "../types";

type Props = {
  completionDelivery: CompletionDelivery | null;
  onCompletionDeliveryChange: (v: CompletionDelivery) => void;
  accountPolicy: AccountFinalEmailPolicy;
  includeInvoice: boolean;
  onIncludeInvoiceChange: (v: boolean) => void;
  includeReport: boolean;
  onIncludeReportChange: (v: boolean) => void;
};

export function FinalCompletionDeliverySection({
  completionDelivery,
  onCompletionDeliveryChange,
  accountPolicy,
  includeInvoice,
  onIncludeInvoiceChange,
  includeReport,
  onIncludeReportChange,
}: Props) {
  const canEmail = canSendClientEmailWithPack(accountPolicy);

  return (
    <div
      className="px-6 py-[14px] flex flex-col gap-[10px]"
      style={{
        background: "#FFFFFF",
        borderTop: "0.5px solid var(--color-border-tertiary, #E4E4E7)",
      }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#6B6B70", letterSpacing: "0.4px" }}>
        Client communication
      </p>
      <p className="text-[11px] leading-[1.45]" style={{ color: "#9A9AA0" }}>
        Account defaults control what you can include. Choose how to complete this job.
      </p>

      <label
        className="flex items-start gap-[10px] text-[12px] cursor-pointer leading-[1.5]"
        style={{ color: "#020040" }}
      >
        <input
          type="radio"
          name="completion-delivery"
          checked={completionDelivery === "stage_only"}
          onChange={() => onCompletionDeliveryChange("stage_only")}
          className="mt-[3px]"
          style={{ accentColor: "#020040" }}
        />
        <span>
          <span className="font-medium">Internal only</span>
          <span className="block text-[11px] font-normal mt-0.5" style={{ color: "#6B6B70" }}>
            Move the job to the next step. No email to the client.
          </span>
        </span>
      </label>

      {canEmail ? (
        <label
          className="flex items-start gap-[10px] text-[12px] cursor-pointer leading-[1.5]"
          style={{ color: "#020040" }}
        >
          <input
            type="radio"
            name="completion-delivery"
            checked={completionDelivery === "email"}
            onChange={() => onCompletionDeliveryChange("email")}
            className="mt-[3px]"
            style={{ accentColor: "#020040" }}
          />
          <span>
            <span className="font-medium">Send client email</span>
            <span className="block text-[11px] font-normal mt-0.5" style={{ color: "#6B6B70" }}>
              After finalising, email the billing contact with what you select below.
            </span>
          </span>
        </label>
      ) : (
        <p className="text-[11px] rounded-lg px-3 py-2" style={{ background: "#FAFAFB", color: "#6B6B70" }}>
          This account has both “invoice in email” and “report PDFs” turned off — use internal only, or update the account
          Billing settings to allow an email pack.
        </p>
      )}

      {completionDelivery === "email" && canEmail ? (
        <div
          className="ml-6 pl-3 border-l-2 space-y-2"
          style={{ borderColor: "#E4E4E7" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6B6B70" }}>
            Include in email
          </p>
          {accountPolicy.canIncludeReport ? (
            <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "#020040" }}>
              <input
                type="checkbox"
                checked={includeReport}
                onChange={(e) => onIncludeReportChange(e.target.checked)}
                style={{ accentColor: "#020040" }}
              />
              Final report PDFs
            </label>
          ) : null}
          {accountPolicy.canIncludeInvoice ? (
            <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "#020040" }}>
              <input
                type="checkbox"
                checked={includeInvoice}
                onChange={(e) => onIncludeInvoiceChange(e.target.checked)}
                style={{ accentColor: "#020040" }}
              />
              Invoice / payment details (in email body)
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
