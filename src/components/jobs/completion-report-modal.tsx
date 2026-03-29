"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { Job } from "@/types/database";
import { uploadManualJobReport } from "@/services/job-report-storage";

export type FinalReportPayload = {
  photo_urls: string[];
  work_summary: string;
  materials_used: string;
  issues_notes: string;
};

type Props = {
  job: Job;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onSubmitWithData: (payload: FinalReportPayload) => Promise<void>;
  onSkip: () => Promise<void>;
};

export function CompletionReportModal({ job, open, onClose, busy, onSubmitWithData, onSkip }: Props) {
  const [workSummary, setWorkSummary] = useState("");
  const [materials, setMaterials] = useState("");
  const [issues, setIssues] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const reset = useCallback(() => {
    setWorkSummary("");
    setMaterials("");
    setIssues("");
    setFiles([]);
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  const uploadPhotos = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const f of files) {
      const up = await uploadManualJobReport(job.id, f);
      urls.push(up.publicUrl);
    }
    return urls;
  };

  return (
    <Modal open={open} onClose={handleClose} title="Completion Report">
      <div className="p-4 space-y-4 max-h-[min(80vh,560px)] overflow-y-auto">
        <p className="text-sm text-text-secondary">
          Optional completion details. The on-site timer stops when you continue to Final Checks — elapsed time is preserved.
        </p>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Final photos (optional)</label>
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,application/pdf"
            multiple
            className="block w-full text-xs text-text-secondary file:mr-2 file:rounded-lg file:border file:border-border file:bg-card file:px-2 file:py-1"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 ? (
            <p className="text-[11px] text-text-tertiary mt-1">{files.length} file(s) selected</p>
          ) : null}
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Work summary (optional)</label>
          <textarea
            value={workSummary}
            onChange={(e) => setWorkSummary(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[72px]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Materials used (optional)</label>
          <textarea
            value={materials}
            onChange={(e) => setMaterials(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[56px]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Issues / notes (optional)</label>
          <textarea
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[56px]"
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-end pt-1 border-t border-border-light">
          <Button variant="ghost" size="sm" disabled={busy} onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            onClick={async () => {
              await onSkip();
              reset();
            }}
          >
            Skip &amp; Continue
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={async () => {
              const photo_urls = files.length ? await uploadPhotos() : [];
              await onSubmitWithData({
                photo_urls,
                work_summary: workSummary.trim(),
                materials_used: materials.trim(),
                issues_notes: issues.trim(),
              });
              reset();
            }}
          >
            Submit &amp; Move to Final Checks
          </Button>
        </div>
      </div>
    </Modal>
  );
}
