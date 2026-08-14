type Props = {
  confirmed: boolean;
  onChange: (v: boolean) => void;
  sentToAccounts: boolean;
  onSentToAccountsChange: (v: boolean) => void;
  currentUserName: string;
  /** True quando o job tem relatório mas ele ainda não subiu na plataforma. */
  relatorioNaoSubiu?: boolean;
};

export function ResponsibilityCheck({
  confirmed,
  onChange,
  sentToAccounts,
  onSentToAccountsChange,
  currentUserName,
  relatorioNaoSubiu,
}: Props) {
  return (
    <div
      className="px-6 py-[14px] flex flex-col gap-[10px]"
      style={{
        background: "#FAFAFB",
        borderTop: "0.5px solid var(--color-border-tertiary, #E4E4E7)",
      }}
    >
      {/* Avisa, não bloqueia: se a plataforma do cliente cair, o job ainda
          precisa poder ser finalizado. Mas fechar sem o relatório ter subido é
          como 8 jobs terminaram com o relatório parado no OS, e ninguém viu. */}
      {relatorioNaoSubiu ? (
        <div
          className="rounded-[8px] px-3 py-2 text-[12px]"
          style={{ background: "#FFF8F3", border: "0.5px solid #F5CFB8", color: "#7A3D00" }}
        >
          The OS has not sent this report to the client platform. If it was submitted by hand
          there, nothing is missing. Otherwise, send it from step 3 above or from the Reports
          tab — finalising does not send it.
        </div>
      ) : null}
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
