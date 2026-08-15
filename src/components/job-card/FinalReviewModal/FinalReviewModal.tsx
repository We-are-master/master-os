"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinanceCards } from "./components/FinanceCards";
import { MarginHero } from "./components/MarginHero";
import { ModalFooter } from "./components/ModalFooter";
import { ModalHeader } from "./components/ModalHeader";
import { ResponsibilityCheck } from "./components/ResponsibilityCheck";
import { PaymentScheduleSection } from "./components/PaymentScheduleSection";
import { StepsTimeline } from "./components/StepsTimeline";
import type { EstadoEnvioExterno } from "./components/ExternalReportStep";
import type { FinalReviewModalProps } from "./types";
import { JobReportV2Card } from "@/components/jobs/job-report-v2-card";

type EnvioExterno = EstadoEnvioExterno;

/**
 * Estado do envio do relatório para a plataforma de origem.
 *
 * Enquanto estiver enviando, pergunta de 3 em 3 segundos e para sozinho quando
 * termina. O envio leva de 8 a 35 segundos porque preenche um formulário de
 * verdade do outro lado, então segurar a tela não é opção.
 */
function useEnvioExterno(
  jobUuid: string | null | undefined,
  aberto: boolean,
): { envio: EnvioExterno | undefined; recarregar: () => void } {
  const [envio, setEnvio] = useState<EnvioExterno | undefined>(undefined);
  // Ref e não dep do efeito: com `envio?.estado` na lista, cada resposta
  // remontava o intervalo, e o polling dependia de o estado ter mudado.
  const estadoRef = useRef<EnvioExterno["estado"] | undefined>(undefined);
  const buscarRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!aberto || !jobUuid) return;
    let vivo = true;

    const buscar = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobUuid}/submit-external-report`);
        if (!r.ok || !vivo) return;
        const d = (await r.json()) as {
          estado: EnvioExterno["estado"];
          report_link?: string | null;
          error?: string | null;
          bloqueio?: string | null;
          attempts?: number;
          submitted_at?: string | null;
        };
        if (!vivo) return;
        estadoRef.current = d.estado;
        setEnvio({
          estado: d.estado,
          link: d.report_link ?? null,
          erro: d.error ?? null,
          bloqueio: d.bloqueio ?? null,
          attempts: d.attempts ?? 0,
          submittedAt: d.submitted_at ?? null,
        });
      } catch {
        // Falha de rede não pode derrubar o modal: sem estado, o passo 3 só não
        // mostra o selo, e o resto da revisão continua utilizável.
      }
    };
    buscarRef.current = () => void buscar();

    void buscar();
    const t = setInterval(() => {
      if (estadoRef.current === "enviando") void buscar();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [jobUuid, aberto]);

  return { envio, recarregar: () => buscarRef.current() };
}

export function FinalReviewModal(props: FinalReviewModalProps) {
  const {
    isOpen,
    onClose,
    reviewSummary,
    jobId,
    jobUuid,
    jobTitle,
    clientName,
    partnerName,
    currentUserName,
    jobValue,
    partnerPayout,
    margin,
    marginPct,
    received,
    paidOut,
    clientOutstanding,
    partnerOutstanding,
    invoiceStatus,
    selfBillStatus,
    invoiceReference,
    selfBillReference,
    reports,
    confirmed,
    onConfirmedChange,
    sentToAccounts,
    onSentToAccountsChange,
    onApprove,
    submitting,
    hourlySlot,
    paymentSchedule,
    rawFinalReport,
    onEditReport,
  } = props;

  /**
   * Duas etapas, nesta ordem: o relatório e depois o dinheiro.
   *
   * Aprovar sem ter visto o relatório era o buraco: o botão dizia "Review &
   * approve" e abria direto no financeiro, então "review" queria dizer conferir
   * margem e datas, nunca o que o parceiro escreveu. Agora a primeira tela é o
   * relatório inteiro, com as fotos, e dela se sai por "Edit" ou seguindo.
   *
   * Só aparece quando há relatório. Job sem relatório abre direto no
   * financeiro, como antes: não há o que conferir e uma tela vazia no caminho
   * seria só um clique a mais.
   */
  const temRelatorio = !!rawFinalReport && Object.keys(rawFinalReport as object).length > 0;
  const [etapa, setEtapa] = useState<"relatorio" | "financeiro">(
    temRelatorio ? "relatorio" : "financeiro",
  );
  // O componente continua montado com o modal fechado, então a etapa volta ao
  // começo no fechamento e não na abertura: é handler, roda uma vez, e não
  // precisa de efeito nem de ref no render, que este repo proíbe.
  const fechar = () => {
    setEtapa(temRelatorio ? "relatorio" : "financeiro");
    onClose();
  };

  const { envio: envioExterno, recarregar } = useEnvioExterno(jobUuid, isOpen);

  /**
   * Aprovar manda o relatório para a plataforma do cliente, sem pedir de novo.
   *
   * Antes o envio era um botão à parte, dois centímetros acima do Approve: o
   * job era finalizado, a tela fechava, e o relatório ficava para trás sem
   * ninguém perceber. Aprovar já significa "está bom e pode ir"; pedir a mesma
   * confirmação duas vezes só cria a chance de esquecer a segunda.
   *
   * Dispara e não espera. O envio preenche um formulário de verdade do outro
   * lado e leva de 8 a 35 segundos; segurar a finalização por isso trocaria um
   * relatório esquecido por uma tela travada. O passo 3 acompanha o estado e
   * mostra "Try again" se falhar, então nada some em silêncio.
   *
   * O bloqueio é respeitado: sem foto, ou sem relatório, nem tenta. A nota na
   * aba já disse isso antes de a pessoa chegar aqui.
   */
  const aprovarEEnviar = () => {
    const podeEnviar =
      jobUuid && envioExterno && !envioExterno.bloqueio &&
      envioExterno.estado !== "enviado" && envioExterno.estado !== "enviando";
    if (podeEnviar) {
      void fetch(`/api/jobs/${jobUuid}/submit-external-report`, { method: "POST" })
        .then(() => recarregar())
        .catch((err) => console.error("[final-review] envio externo falhou ao aprovar:", err));
    }
    onApprove();
  };

  // Docs must exist; report upload/approve is no longer a hard gate —
  // office attests “report submitted to the customer” (partners rarely use the app).
  const docsReady = invoiceStatus === "issued" && selfBillStatus === "issued";
  const attestationsOk = confirmed && sentToAccounts;
  const canApprove = attestationsOk && docsReady && !submitting;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain py-4 sm:items-center sm:py-6 px-3 sm:px-4">
          <motion.div
            variants={overlayTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={submitting ? undefined : fechar}
            className="final-review-modal-overlay absolute inset-0 bg-black/30 dark:bg-black/65 glass"
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="final-review-modal-panel relative w-full h-fit max-h-[min(90dvh,100dvh-2rem)] flex flex-col bg-card border border-fx-line overflow-hidden my-auto rounded-2xl shadow-modal"
            style={{ maxWidth: "620px" }}
          >
            <ModalHeader
              jobId={jobId}
              jobTitle={jobTitle}
              clientName={clientName}
              onClose={fechar}
              reviewSummary={reviewSummary ?? null}
            />

            {etapa === "relatorio" ? (
              <>
                <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
                  <p className="mb-2 text-[11px]" style={{ color: "#6B6B70" }}>
                    This is the report as it was filled in. Check it before the money.
                  </p>
                  <JobReportV2Card jobId={jobUuid} kind="final" rawReport={rawFinalReport} approvedAt={null} readOnly />
                </div>
                <div
                  className="flex items-center justify-between gap-2 px-4 py-3"
                  style={{ borderTop: "0.5px solid #E4E4E8" }}
                >
                  <button
                    type="button"
                    onClick={onEditReport}
                    disabled={!onEditReport}
                    className="rounded-[6px] px-3 py-[6px] text-[12px] font-medium cursor-pointer disabled:opacity-40"
                    style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                  >
                    Edit report
                  </button>
                  <button
                    type="button"
                    onClick={() => setEtapa("financeiro")}
                    className="rounded-[6px] px-3.5 py-[6px] text-[12px] font-semibold text-white cursor-pointer"
                    style={{ background: "#020040" }}
                  >
                    Looks right, continue →
                  </button>
                </div>
              </>
            ) : (
            <div className="min-h-0 overflow-y-auto overscroll-contain">
              <MarginHero
                margin={margin}
                marginPct={marginPct}
                partnerPayout={partnerPayout}
                jobValue={jobValue}
              />

              <StepsTimeline
                invoiceStatus={invoiceStatus}
                selfBillStatus={selfBillStatus}
                invoiceReference={invoiceReference}
                selfBillReference={selfBillReference}
                jobValue={jobValue}
                partnerPayout={partnerPayout}
                reports={reports}
                envioExterno={envioExterno}
                jobUuid={jobUuid}
                onEnvioDisparado={recarregar}
              />

              <FinanceCards
                clientName={clientName}
                partnerName={partnerName}
                received={received}
                paidOut={paidOut}
                clientOutstanding={clientOutstanding}
                partnerOutstanding={partnerOutstanding}
              />

              {hourlySlot ? <div className="px-6 pb-[18px]">{hourlySlot}</div> : null}

              {paymentSchedule ? (
                <PaymentScheduleSection
                  invoiceDueYmd={paymentSchedule.invoiceDueYmd}
                  onInvoiceDueYmdChange={paymentSchedule.onInvoiceDueYmdChange}
                  invoiceDueSource={paymentSchedule.invoiceDueSource}
                  partnerDueYmd={paymentSchedule.partnerDueYmd}
                  onPartnerDueYmdChange={paymentSchedule.onPartnerDueYmdChange}
                  partnerDueSource={paymentSchedule.partnerDueSource}
                  showPartner={paymentSchedule.showPartner}
                  partnerTermsLabel={paymentSchedule.partnerTermsLabel}
                  orgStandardTerms={paymentSchedule.orgStandardTerms}
                  orgPayoutReferenceYmd={paymentSchedule.orgPayoutReferenceYmd}
                  loading={paymentSchedule.loading}
                />
              ) : null}
            </div>
            )}

            {/* Aceite e aprovação só na etapa do dinheiro: assinar
                responsabilidade enquanto ainda se está lendo o relatório é
                assinar antes de ter conferido. */}
            {etapa === "financeiro" ? (
              <>
                <ResponsibilityCheck
                  confirmed={confirmed}
                  onChange={onConfirmedChange}
                  sentToAccounts={sentToAccounts}
                  onSentToAccountsChange={onSentToAccountsChange}
                  currentUserName={currentUserName}
                />
                <ModalFooter
                  canApprove={canApprove}
                  submitting={submitting}
                  onCancel={fechar}
                  onApprove={aprovarEEnviar}
                />
              </>
            ) : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
