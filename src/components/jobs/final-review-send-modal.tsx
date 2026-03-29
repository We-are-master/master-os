"use client";

import { useState, useCallback, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { Job } from "@/types/database";
import { cn } from "@/lib/utils";

type Props = {
  job: Job;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onSendEmail: () => Promise<void>;
  onMarkSent: () => Promise<void>;
};

export function FinalReviewSendModal({ job, open, onClose, busy, onSendEmail, onMarkSent }: Props) {
  const [reportOk, setReportOk] = useState(false);
  const [invoiceOk, setInvoiceOk] = useState(false);
  const [invoiceMissing, setInvoiceMissing] = useState(false);
  const [noReportsWarning, setNoReportsWarning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNoReportsWarning(!job.start_report_submitted && !job.final_report_submitted);
  }, [open, job, job.start_report_submitted, job.final_report_submitted]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}/preview/invoice`, { method: "GET", credentials: "include" });
        if (cancelled) return;
        setInvoiceMissing(res.status === 404);
      } catch {
        if (!cancelled) setInvoiceMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, job.id]);

  const approved = reportOk && invoiceOk;
  const tooltip = "Please approve report and invoice before sending";

  const handleClose = useCallback(() => {
    if (busy) return;
    setReportOk(false);
    setInvoiceOk(false);
    onClose();
  }, [busy, onClose]);

  const reportSrc = `/api/jobs/${job.id}/preview/job-report`;

  return (
    <Modal open={open} onClose={handleClose} title="Final Review & Send">
      <div className="p-4 space-y-4 max-h-[min(90vh,720px)] overflow-y-auto">
        {noReportsWarning ? (
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-text-secondary">
            No reports were submitted for this job (or both were skipped). You can still review PDFs and continue.
          </div>
        ) : null}
        {invoiceMissing ? (
          <div className="rounded-lg border border-border-light bg-surface-hover/50 px-3 py-2 text-xs text-text-secondary">
            Invoice not yet generated. You can still mark as sent manually.
          </div>
        ) : null}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-[200px]">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase text-text-tertiary">Job report (PDF)</p>
            <iframe title="Job report preview" src={reportSrc} className="w-full h-[220px] rounded-lg border border-border-light bg-surface-hover/30" />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase text-text-tertiary">Invoice (PDF)</p>
            {invoiceMissing ? (
              <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border-light text-xs text-text-tertiary px-3 text-center">
                Invoice preview unavailable.
              </div>
            ) : (
              <iframe
                title="Invoice preview"
                src={`/api/jobs/${job.id}/preview/invoice`}
                className="w-full h-[220px] rounded-lg border border-border-light bg-surface-hover/30"
              />
            )}
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={reportOk} onChange={(e) => setReportOk(e.target.checked)} className="mt-1" />
            <span className="text-sm text-text-primary">I confirm the report is approved</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={invoiceOk} onChange={(e) => setInvoiceOk(e.target.checked)} className="mt-1" />
            <span className="text-sm text-text-primary">I confirm the invoice is approved</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 justify-end pt-1 border-t border-border-light">
          <Button variant="ghost" size="sm" disabled={busy} onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            title={!approved ? tooltip : undefined}
            className={cn(!approved && "opacity-50")}
            disabled={!approved || busy}
            onClick={() => void onMarkSent()}
          >
            Mark as Sent
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            title={!approved ? tooltip : undefined}
            className={cn(!approved && "opacity-50")}
            disabled={!approved || busy || invoiceMissing}
            onClick={() => void onSendEmail()}
          >
            Send to Client
          </Button>
        </div>
      </div>
    </Modal>
  );
}
