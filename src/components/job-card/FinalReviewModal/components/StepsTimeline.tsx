import { useState } from "react";
import type { InvoiceDisplayStatus, ReportItem, SelfBillDisplayStatus } from "../types";
import { ExternalReportStep, type EstadoEnvioExterno } from "./ExternalReportStep";

type StepState = "issued" | "approved" | "pending" | "on_hold" | "blocked";

type Props = {
  invoiceStatus: InvoiceDisplayStatus;
  selfBillStatus: SelfBillDisplayStatus;
  invoiceReference?: string | null;
  selfBillReference?: string | null;
  jobValue: number;
  partnerPayout: number;
  reports: ReportItem[];
  /**
   * Estado do envio do relatório para a plataforma de origem (Stefane).
   *
   * Vive no passo 3, junto com o upload do parceiro, porque as duas coisas
   * respondem a mesma pergunta: o relatório existe onde precisa existir? Subir
   * no OS e não subir na Housekeep é meio caminho, e é como 198 jobs viraram
   * 16 relatórios.
   */
  envioExterno?: EstadoEnvioExterno;
  /** UUID do job — o passo 3 fala com a API por conta própria. */
  jobUuid?: string;
  /** Avisa o modal de que um envio começou, para o polling assumir. */
  onEnvioDisparado: () => void;
  /** Abre o relatório para edição, oferecido quando o envio é recusado. */
  onEditReport?: () => void;
  /** O relatório foi aprovado nesta sessão do modal — o passo 3 diz "sending". */
  relatorioAprovado?: boolean;
};

/**
 * Marcar à mão, no passo em que a falta aparece.
 *
 * O botão existia só dentro do envio externo, e só em dois dos seus estados.
 * Quem chega no passo 3 com "Final report · missing" via UMA saída, "Fill the
 * report", e preencher formulário não é o que resolve quando o relatório já
 * foi entregue por fora. Aqui a segunda saída fica visível junto da primeira:
 * grava `external_report_manual_at`, que é o que desarma o robô do Express e
 * libera o Finalise.
 */
function MarkSentManually({ jobUuid, onMarcado }: { jobUuid: string; onMarcado: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const marcar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/jobs/${jobUuid}/submit-external-report?manual=1`, { method: "POST" });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { motivo?: string; error?: string } | null;
        setErro(corpo?.motivo ?? corpo?.error ?? "Could not mark it. Try again in a moment.");
        return;
      }
      onMarcado();
    } catch {
      setErro("Could not reach the server. Try again in a moment.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void marcar()}
        disabled={salvando}
        className="rounded-[6px] border border-[#D8D8DD] bg-white px-2.5 py-[3px] text-[11px] font-semibold text-[#020040] transition-colors hover:bg-[#F4F4F6] disabled:opacity-50"
      >
        {salvando ? "Marking…" : "Sent Manually"}
      </button>
      {erro ? (
        <span className="w-full text-[11px]" style={{ color: "#A32D2D" }}>
          {erro}
        </span>
      ) : null}
    </>
  );
}

function fmtGBP(n: number) {
  return `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function stepLabel(state: StepState): string {
  if (state === "issued") return "Issued";
  if (state === "approved") return "Approved";
  if (state === "on_hold") return "On hold";
  return "Pending";
}

function textColor(state: StepState): string {
  if (state === "issued" || state === "approved") return "#020040";
  if (state === "on_hold") return "#A32D2D";
  if (state === "blocked") return "#9A9AA0";
  return "#ED4B00";
}

function Circle({ state, index }: { state: StepState; index: number }) {
  if (state === "issued" || state === "approved") {
    return (
      <div
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-white text-[11px]"
        style={{ background: "#020040" }}
      >
        ✓
      </div>
    );
  }
  if (state === "on_hold") {
    return (
      <div
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-medium bg-white"
        style={{ border: "1.5px solid #A32D2D", color: "#A32D2D" }}
      >
        !
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-medium bg-white"
        style={{ border: "1.5px solid #9A9AA0", color: "#9A9AA0" }}
      >
        {index}
      </div>
    );
  }
  return (
    <div
      className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-medium bg-white"
      style={{ border: "1.5px solid #ED4B00", color: "#ED4B00" }}
    >
      {index}
    </div>
  );
}

export function StepsTimeline({
  invoiceStatus,
  selfBillStatus,
  invoiceReference,
  selfBillReference,
  jobValue,
  partnerPayout,
  reports,
  envioExterno,
  jobUuid,
  onEnvioDisparado,
  onEditReport,
  relatorioAprovado = false,
}: Props) {
  const invoiceState: StepState =
    invoiceStatus === "issued" ? "issued" : invoiceStatus === "on_hold" ? "on_hold" : "pending";
  const selfBillState: StepState =
    selfBillStatus === "issued" ? "issued" : selfBillStatus === "on_hold" ? "on_hold" : "pending";

  const allUploaded = reports.length > 0 && reports.every((r) => r.uploaded);
  const allApproved = reports.length > 0 && reports.every((r) => r.approved);
  /**
   * Entregue à mão também é entregue. Sem isto o passo ficava laranja para
   * sempre depois de marcado, e a tela pedia de novo o que já tinha sido feito.
   */
  const entregueAMao = !!envioExterno?.manualAt;
  /**
   * Quando a plataforma recusa PORQUE o relatório não existe, ela não está
   * contando nada novo: o chip vermelho ao lado já disse isso, e as duas saídas
   * reais (preencher, ou marcar que já foi à mão) estão a dois centímetros
   * dali. O bloco embaixo só acrescentava a mesma frase em outras palavras e um
   * "Try again" que não tem como dar certo sem relatório — quatro botões para
   * um passo que tem duas decisões.
   */
  const repeteAFaltaDoRelatorio =
    !allUploaded && /has not sent the final report/i.test(envioExterno?.bloqueio ?? "");
  const relatorioResolvido = allUploaded || entregueAMao;
  const reportsUploadedState: StepState = relatorioResolvido ? "issued" : "pending";
  const reportsApprovedState: StepState = !allUploaded ? "blocked" : allApproved ? "approved" : "pending";

  const completedCount =
    [invoiceState, selfBillState, reportsUploadedState, reportsApprovedState].filter(
      (s) => s === "issued" || s === "approved",
    ).length;
  const completedPct = (completedCount / 4) * 100;

  const steps: Array<{
    index: number;
    title: string;
    state: StepState;
    subtitle?: React.ReactNode;
    trailing?: React.ReactNode;
  }> = [
    {
      index: 1,
      title: "Client invoice",
      state: invoiceState,
      subtitle: (
        <span className="text-[12px]" style={{ color: "#6B6B70" }}>
          {invoiceReference ? `${invoiceReference} · ` : ""}
          {fmtGBP(jobValue)}
        </span>
      ),
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(invoiceState) }}>
          {stepLabel(invoiceState)}
        </span>
      ),
    },
    {
      index: 2,
      title: "Partner self-bill",
      state: selfBillState,
      subtitle: (
        <span className="text-[12px]" style={{ color: "#6B6B70" }}>
          {selfBillReference ? `${selfBillReference} · ` : ""}
          {fmtGBP(partnerPayout)}
        </span>
      ),
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(selfBillState) }}>
          {stepLabel(selfBillState)}
        </span>
      ),
    },
    {
      index: 3,
      title: "Partner reports uploaded",
      state: reportsUploadedState,
      subtitle: (
        <div className="flex flex-wrap items-center gap-[6px] mt-[6px]">
          {reports.map((r) => (
            <span
              key={r.id}
              className="text-[11px] px-2 py-[3px] rounded-[5px]"
              style={{
                background: r.uploaded ? "#F1F5FB" : entregueAMao ? "#F4F4F6" : "#FFF1EB",
                color: r.uploaded ? "#020040" : entregueAMao ? "#6B6B70" : "#ED4B00",
              }}
            >
              {/* Depois de marcado à mão, "missing" em laranja pede uma ação que
                  já foi feita por fora. O que sobra é um fato sem urgência: o
                  OS não guarda cópia deste relatório. */}
              {r.name} · {r.uploaded ? "uploaded" : entregueAMao ? "not in the OS" : "missing"}
            </span>
          ))}
          {/* Relatório faltando é o unico ponto do fluxo onde a pessoa tem algo
              a fazer AGORA, e era o unico sem botao: o passo mostrava o chip
              vermelho "missing" e parava ali, com a acao de preencher existindo
              e escondida. `onEditReport` fecha esta revisao e abre o formulario
              do relatorio, que e exatamente o que falta. */}
          {!allUploaded && onEditReport ? (
            <button
              type="button"
              onClick={onEditReport}
              className="rounded-[6px] border border-[#ED4B00]/30 bg-[#FFF1EB] px-2.5 py-[3px] text-[11px] font-semibold text-[#ED4B00] transition-colors hover:bg-[#FFE4D8]"
            >
              Fill the report
            </button>
          ) : null}
          {/* Uma marcação manual só, e sempre no mesmo lugar. Antes ela vivia
              lá embaixo, dentro do envio externo, e só em dois dos seus
              estados: com o relatório faltando apareciam as duas ao mesmo
              tempo, com nomes diferentes, fazendo a mesma coisa. */}
          {!allUploaded && !entregueAMao && jobUuid && envioExterno && !envioExterno.indisponivel && envioExterno.estado !== "enviado" ? (
            <MarkSentManually jobUuid={jobUuid} onMarcado={onEnvioDisparado} />
          ) : null}
          {/* Todo o envio externo — estado, conferência e ação — mora aqui.
              Antes o passo só falava depois que o envio já tinha acontecido,
              calado justamente quando havia algo a fazer. */}
          {jobUuid && envioExterno && !repeteAFaltaDoRelatorio ? (
            <div className="w-full">
              <ExternalReportStep jobUuid={jobUuid} envio={envioExterno} onEnviado={onEnvioDisparado} onEditReport={onEditReport} relatorioEnviado={allUploaded} aprovado={relatorioAprovado} />
            </div>
          ) : null}
        </div>
      ),
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(reportsUploadedState) }}>
          {stepLabel(reportsUploadedState)}
        </span>
      ),
    },
    {
      index: 4,
      title: "Reports reviewed by you",
      state: reportsApprovedState,
      subtitle: !allUploaded ? (
        <span className="text-[12px]" style={{ color: "#9A9AA0" }}>
          {/* Marcado à mão não deixa nada no OS para conferir. Dizer
              "Available after upload" ali era esperar um upload que já foi
              dispensado. */}
          {entregueAMao ? "Nothing to review · sent manually" : "Available after upload"}
        </span>
      ) : null,
      trailing: (
        <span className="text-[12px] font-medium" style={{ color: textColor(reportsApprovedState) }}>
          {stepLabel(reportsApprovedState)}
        </span>
      ),
    },
  ];

  return (
    <div className="relative px-6 pt-5 pb-4">
      <div
        className="absolute left-[33px] top-[30px] bottom-[20px] w-[2px]"
        style={{
          background: `linear-gradient(180deg, #020040 0%, #020040 ${completedPct}%, #ECECEE ${completedPct}%, #ECECEE 100%)`,
        }}
      />
      <ul className="flex flex-col gap-4 relative">
        {steps.map((s) => (
          <li key={s.index} className="flex items-start gap-3">
            <div className="shrink-0 mt-[1px]">
              <Circle state={s.state} index={s.index} />
            </div>
            <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="text-[13px] font-medium"
                  style={{ color: s.state === "blocked" ? "#9A9AA0" : "#020040" }}
                >
                  {s.title}
                </div>
                {s.subtitle}
              </div>
              {s.trailing ? <div className="shrink-0">{s.trailing}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
