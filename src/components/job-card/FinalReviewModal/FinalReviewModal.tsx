"use client";

import { AnimatePresence, motion } from "framer-motion";
import { canSendClientEmailWithPack } from "@/lib/account-final-email-policy";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinalCompletionDeliverySection } from "./components/FinalCompletionDeliverySection";
import { FinanceCards } from "./components/FinanceCards";
import { ForceApproveBlock } from "./components/ForceApproveBlock";
import { MarginHero } from "./components/MarginHero";
import { ModalFooter } from "./components/ModalFooter";
import { ModalHeader } from "./components/ModalHeader";
import { ResponsibilityCheck } from "./components/ResponsibilityCheck";
import { StepsTimeline } from "./components/StepsTimeline";
import type { FinalReviewModalProps } from "./types";

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
    completionDelivery,
    onCompletionDeliveryChange,
    includeInvoiceInEmail,
    onIncludeInvoiceInEmailChange,
    includeReportInEmail,
    onIncludeReportInEmailChange,
    accountEmailPolicy,
    confirmed,
    onConfirmedChange,
    sentToAccounts,
    onSentToAccountsChange,
    forceMode,
    onForceModeChange,
    forceReason,
    onForceReasonChange,
    onApprove,
    onForceApprove,
    submitting,
    hourlySlot,
  } = props;

  const allStepsComplete =
    invoiceStatus === "issued" &&
    selfBillStatus === "issued" &&
    reports.length > 0 &&
    reports.every((r) => r.uploaded) &&
    reports.every((r) => r.approved);

  const canSendEmailPack = canSendClientEmailWithPack(accountEmailPolicy);
  const emailPackHasContent =
    (includeReportInEmail && accountEmailPolicy.canIncludeReport) ||
    (includeInvoiceInEmail && accountEmailPolicy.canIncludeInvoice);
  const deliverChoiceOk =
    completionDelivery !== null &&
    (completionDelivery === "stage_only" || (completionDelivery === "email" && canSendEmailPack && emailPackHasContent));

  const attestationsOk = confirmed && sentToAccounts;
  const canApprove = deliverChoiceOk && attestationsOk && allStepsComplete && !forceMode && !submitting;
  const canForceApprove =
    deliverChoiceOk && attestationsOk && forceMode && forceReason.trim().length >= 20 && !submitting;

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
            className="absolute inset-0"
            style={{ background: "rgba(15,15,20,0.08)", backdropFilter: "blur(4px)" }}
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="relative w-full h-fit max-h-[min(90dvh,100dvh-2rem)] flex flex-col bg-white overflow-hidden my-auto"
            style={{
              maxWidth: "620px",
              borderRadius: "16px",
              border: "0.5px solid var(--color-border-tertiary, #E4E4E7)",
              boxShadow:
                "0 20px 50px -20px rgba(2,0,64,0.12), 0 4px 12px -4px rgba(0,0,0,0.04)",
            }}
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
                forceMode={forceMode}
                onForceApproveClick={() => onForceModeChange(true)}
              />

              {forceMode ? (
                <ForceApproveBlock
                  reason={forceReason}
                  onReasonChange={onForceReasonChange}
                  onCancel={() => {
                    onForceModeChange(false);
                    onForceReasonChange("");
                  }}
                  currentUserName={currentUserName}
                />
              ) : null}

              <FinanceCards
                clientName={clientName}
                partnerName={partnerName}
                received={received}
                paidOut={paidOut}
                clientOutstanding={clientOutstanding}
                partnerOutstanding={partnerOutstanding}
              />

              {hourlySlot ? <div className="px-6 pb-[18px]">{hourlySlot}</div> : null}
            </div>

            <FinalCompletionDeliverySection
              completionDelivery={completionDelivery}
              onCompletionDeliveryChange={onCompletionDeliveryChange}
              accountPolicy={accountEmailPolicy}
              includeInvoice={includeInvoiceInEmail}
              onIncludeInvoiceChange={onIncludeInvoiceInEmailChange}
              includeReport={includeReportInEmail}
              onIncludeReportChange={onIncludeReportInEmailChange}
            />

            <ResponsibilityCheck
              confirmed={confirmed}
              onChange={onConfirmedChange}
              sentToAccounts={sentToAccounts}
              onSentToAccountsChange={onSentToAccountsChange}
              currentUserName={currentUserName}
            />

            <ModalFooter
              forceMode={forceMode}
              completionDelivery={completionDelivery}
              canApprove={canApprove}
              canForceApprove={canForceApprove}
              submitting={submitting}
              onCancel={onClose}
              onApprove={onApprove}
              onForceApprove={onForceApprove}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
