type Props = {
  confirmed: boolean;
  onChange: (v: boolean) => void;
  sentToAccounts: boolean;
  onSentToAccountsChange: (v: boolean) => void;
  currentUserName: string;
  /** True quando o job tem relatório mas ele ainda não subiu na plataforma. */
  relatorioNaoSubiu?: boolean;
  /** True enquanto isso estiver travando o botão de finalizar. */
  bloqueadoPeloEnvio?: boolean;
  /** Libera a finalização mesmo com o relatório pendente. */
  onForcar?: () => void;
};

export function ResponsibilityCheck({
  confirmed,
  onChange,
  sentToAccounts,
  onSentToAccountsChange,
  currentUserName,
  relatorioNaoSubiu,
  bloqueadoPeloEnvio,
  onForcar,
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
          className="rounded-[8px] px-3 py-2.5 text-[12px]"
          style={{ background: "#FFF8F3", border: "0.5px solid #F5CFB8", color: "#7A3D00" }}
        >
          {bloqueadoPeloEnvio ? (
            <>
              <p className="m-0">
                <strong>Send the report first.</strong> Finalising is blocked until it reaches the
                client platform — use step 3 above. Once the job closes, a pending report only
                comes back if someone goes looking for it.
              </p>
              {onForcar ? (
                <button
                  type="button"
                  onClick={onForcar}
                  className="mt-2 rounded-[6px] bg-white px-[10px] py-[5px] text-[11px] font-semibold cursor-pointer"
                  style={{ color: "#7A3D00", border: "0.5px solid #E8C6A8" }}
                >
                  Finalise without sending
                </button>
              ) : null}
            </>
          ) : (
            <p className="m-0">
              <strong>Finalising without the report.</strong> It stays pending on the job — send it
              later from the Reports tab. Use this when the client platform is down or the report
              was already submitted there by hand.
            </p>
          )}
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
