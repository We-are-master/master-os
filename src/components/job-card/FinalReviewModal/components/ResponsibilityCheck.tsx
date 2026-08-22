type Props = {
  confirmed: boolean;
  onChange: (v: boolean) => void;
  currentUserName: string;
  /**
   * O relatório chegou à plataforma do cliente. Vem do `submitted_at` da API
   * deles, não de opinião de ninguém.
   */
  envioResolvido: boolean;
  /** Quando chegou, para a linha dizer a hora em vez de só "sim". */
  envioQuando?: string | null;
  /** Como o relatório foi resolvido, quando não foi por envio automático. */
  envioNota?: string | null;
  /** True enquanto o relatório pendente estiver travando o Finalise. */
  bloqueadoPeloEnvio?: boolean;
  /** Libera a finalização mesmo com o relatório pendente. */
  onForcar?: () => void;
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ResponsibilityCheck({
  confirmed,
  onChange,
  currentUserName,
  envioResolvido,
  envioQuando,
  envioNota,
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

      {/*
        O SEGUNDO checkbox saiu em 20/08/2026, e a razão não é economia de
        clique.

        Ele pedia "confirmo que o relatório foi submetido ao cliente" — um fato
        que o sistema PROVA e a pessoa só podia adivinhar. Pedir atestado
        humano de algo verificável tem duas saídas e as duas são ruins: ou trava
        um envio que já aconteceu, ou colhe um "sim" que ninguém checou. No
        JOB-9454 o relatório entrou às 18:00 e a tela ainda pedia que alguém
        jurasse que sim.

        Agora a linha AFIRMA, com a hora que veio do `submitted_at` da API
        deles. Quando não foi, ela não vira pergunta: vira o aviso abaixo, que
        é o que de fato precisa de decisão.
      */}
      {envioResolvido ? (
        <p
          className="m-0 flex items-start gap-[10px] text-[12px] leading-[1.5]"
          style={{ color: "#12704F" }}
        >
          <span aria-hidden style={{ marginTop: "1px" }}>
            ✓
          </span>
          <span>
            Report is on the client platform
            {envioQuando ? ` · ${hora(envioQuando)}` : ""}
            {envioNota ? ` · ${envioNota}` : ""}. Checked on their side, not ticked by hand.
          </span>
        </p>
      ) : null}

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
              {/* O nome que a decisão merece: isto é forçar. Se o relatório já
                  foi mandado à mão, o certo é o "Already sent it? Mark it" do
                  passo 3, que deixa rastro. */}
              Force approve without sending
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
