type Props = {
  confirmed: boolean;
  onChange: (v: boolean) => void;
  sentToAccounts: boolean;
  onSentToAccountsChange: (v: boolean) => void;
  currentUserName: string;
  /** True enquanto o relatório pendente estiver travando o Finalise. */
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

      {/*
        Enquanto o relatório não chegou na plataforma do cliente, finalizar é o
        que faz ele sumir: o job fecha, sai da fila, e o pendente só volta se
        alguém for procurar. Foi assim que o JOB-9428 virou awaiting_payment com
        o relatório nunca enviado.

        Mas o bloqueio não pode ser absoluto, e a saída ao lado não é fraqueza:
        se a Housekeep cair, se a plataforma não for automatizada, ou se alguém
        já mandou à mão, travar a finalização congelaria fatura, self-bill e
        pagamento por causa de um site de terceiro.
      */}
      {bloqueadoPeloEnvio ? (
        <div
          className="rounded-[8px] px-3 py-2.5 text-[12px]"
          style={{ background: "#FFF6EC", border: "0.5px solid #F0D6B8", color: "#7A3D00" }}
        >
          <p className="m-0">
            <strong>Send the report first.</strong> Finalising is blocked until it reaches the
            client platform, in step 3 above. Once the job closes, a pending report only comes
            back if someone goes looking for it.
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
        </div>
      ) : null}
    </div>
  );
}
