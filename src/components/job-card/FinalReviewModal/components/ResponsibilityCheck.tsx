type Props = {
  confirmed: boolean;
  onChange: (v: boolean) => void;
  sentToAccounts: boolean;
  onSentToAccountsChange: (v: boolean) => void;
  currentUserName: string;
};

export function ResponsibilityCheck({
  confirmed,
  onChange,
  sentToAccounts,
  onSentToAccountsChange,
  currentUserName,
}: Props) {
  return (
    <div
      className="px-6 py-[14px] flex flex-col gap-[10px]"
      style={{
        background: "#FAFAFB",
        borderTop: "0.5px solid var(--color-border-tertiary, #E4E4E7)",
      }}
    >
      <label
        className="flex items-start gap-[10px] text-[12px] cursor-pointer leading-[1.5]"
        style={{ color: "#6B6B70" }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: "2px", accentColor: "#020040" }}
        />
        <span>
          I,{" "}
          <span className="font-medium" style={{ color: "#020040" }}>
            {currentUserName}
          </span>
          , have reviewed this job and take responsibility for report and payment approval.
        </span>
      </label>

      <label
        className="flex items-start gap-[10px] text-[12px] cursor-pointer leading-[1.5]"
        style={{ color: "#6B6B70" }}
      >
        <input
          type="checkbox"
          checked={sentToAccounts}
          onChange={(e) => onSentToAccountsChange(e.target.checked)}
          style={{ marginTop: "2px", accentColor: "#020040" }}
        />
        <span>
          I confirm the report has also been{" "}
          <span className="font-medium" style={{ color: "#020040" }}>
            submitted to the customer
          </span>
          .
        </span>
      </label>
    </div>
  );
}
