"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinanceCards } from "./components/FinanceCards";
import { MarginHero } from "./components/MarginHero";
import { ModalFooter } from "./components/ModalFooter";
import { ModalHeader } from "./components/ModalHeader";
import { ResponsibilityCheck } from "./components/ResponsibilityCheck";
import { PaymentScheduleSection } from "./components/PaymentScheduleSection";
import { StepsTimeline } from "./components/StepsTimeline";
import type { FinalReviewModalProps } from "./types";

type EnvioExterno = { estado: "nao_enviado" | "enviando" | "enviado" | "falhou"; link?: string | null; erro?: string | null };

/**
 * Estado do envio do relatório para a plataforma de origem.
 *
 * Enquanto estiver enviando, pergunta de 3 em 3 segundos e para sozinho quando
 * termina. O envio leva de 8 a 35 segundos porque preenche um formulário de
 * verdade do outro lado, então segurar a tela não é opção.
 */
function useEnvioExterno(jobId: string | null | undefined, aberto: boolean): EnvioExterno | undefined {
  const [envio, setEnvio] = useState<EnvioExterno | undefined>(undefined);

  useEffect(() => {
    if (!aberto || !jobId) return;
    let vivo = true;
    const buscar = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}/submit-external-report`);
        if (!r.ok || !vivo) return;
        const d = (await r.json()) as { estado: EnvioExterno["estado"]; report_link?: string | null; error?: string | null };
        if (vivo) setEnvio({ estado: d.estado, link: d.report_link ?? null, erro: d.error ?? null });
      } catch {
        // Falha de rede não pode derrubar o modal: sem estado, o passo 3 só não
        // mostra o selo, e o resto da revisão continua utilizável.
      }
    };
    void buscar();
    const t = setInterval(() => {
      if (envio?.estado === "enviando") void buscar();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [jobId, aberto, envio?.estado]);

  return envio;
}

export function FinalReviewModal(props: FinalReviewModalProps) {
  const {
    isOpen,
    onClose,
    reviewSummary,
    jobId,
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
  } = props;

  const envioExterno = useEnvioExterno(jobId, isOpen);

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
            onClick={submitting ? undefined : onClose}
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
              onClose={onClose}
              reviewSummary={reviewSummary ?? null}
            />

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
              onCancel={onClose}
              onApprove={onApprove}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
