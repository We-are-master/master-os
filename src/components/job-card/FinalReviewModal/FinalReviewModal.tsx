"use client";

import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinanceCards } from "./components/FinanceCards";
import { ForceApproveBlock } from "./components/ForceApproveBlock";
import { MarginHero } from "./components/MarginHero";
import { ModalFooter } from "./components/ModalFooter";
import { ModalHeader } from "./components/ModalHeader";
import { ResponsibilityCheck } from "./components/ResponsibilityCheck";
import { PaymentScheduleSection } from "./components/PaymentScheduleSection";
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
    paymentSchedule,
  } = props;

  const allStepsComplete =
    invoiceStatus === "issued" &&
    selfBillStatus === "issued" &&
    reports.length > 0 &&
    reports.every((r) => r.uploaded) &&
    reports.every((r) => r.approved);

  // Client-communication choice removed from this modal — defaults to internal-only
  // ("stage_only"). Approval gating now depends only on attestations + steps.
  const attestationsOk = confirmed && sentToAccounts;
  const canApprove = attestationsOk && allStepsComplete && !forceMode && !submitting;
  // Keep this aligned with ForceApproveBlock's counter copy (min. 10 chars).
  const canForceApprove =
    attestationsOk && forceMode && forceReason.trim().length >= 10 && !submitting;

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
              forceMode={forceMode}
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
