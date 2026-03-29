"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { Job } from "@/types/database";
import { uploadManualJobReport } from "@/services/job-report-storage";

export type StartReportPayload = {
  photo_urls: string[];
  notes: string;
  checklist: Record<string, boolean>;
};

type ChecklistItem = { id: string; label: string };

function parseChecklist(job: Job): ChecklistItem[] | null {
  const raw = job.operational_checklist;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const items = raw
      .map((x, i) => {
        if (typeof x === "string") return { id: `c${i}`, label: x };
        if (x && typeof x === "object" && "label" in x) {
          return { id: String((x as { id?: string }).id ?? `c${i}`), label: String((x as { label: string }).label) };
        }
        return null;
      })
      .filter(Boolean) as ChecklistItem[];
    return items.length ? items : null;
  }
  if (typeof raw === "object" && raw !== null && "items" in raw && Array.isArray((raw as { items: unknown }).items)) {
    return parseChecklist({ ...job, operational_checklist: (raw as { items: unknown[] }).items } as Job);
  }
  return null;
}

type Props = {
  job: Job;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onSubmitWithData: (payload: StartReportPayload) => Promise<void>;
  onSkip: () => Promise<void>;
};

export function StartJobReportModal({ job, open, onClose, busy, onSubmitWithData, onSkip }: Props) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});

  const checklistItems = parseChecklist(job);

  const reset = useCallback(() => {
    setNotes("");
    setFiles([]);
    setChecklistState({});
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
    <Modal open={open} onClose={handleClose} title="Start Job Report">
      <div className="p-4 space-y-4 max-h-[min(80vh,520px)] overflow-y-auto">
        <p className="text-sm text-text-secondary">
          Optional photos and notes before the job goes live. You can skip and start the timer without saving anything.
        </p>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Photos (optional)</label>
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
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Notes / summary (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="On-site notes, access, hazards…"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[88px]"
          />
        </div>
        {checklistItems && checklistItems.length > 0 ? (
          <div className="rounded-xl border border-border-light bg-surface-hover/40 p-3 space-y-2">
            <p className="text-xs font-semibold text-text-secondary">Checklist</p>
            <ul className="space-y-2">
              {checklistItems.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id={`chk-${item.id}`}
                    checked={!!checklistState[item.id]}
                    onChange={(e) => setChecklistState((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <label htmlFor={`chk-${item.id}`} className="text-sm text-text-primary cursor-pointer">
                    {item.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
            Skip &amp; Start Timer
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={async () => {
              const photo_urls = files.length ? await uploadPhotos() : [];
              await onSubmitWithData({
                photo_urls,
                notes: notes.trim(),
                checklist: checklistState,
              });
              reset();
            }}
          >
            Submit &amp; Start Job
          </Button>
        </div>
      </div>
    </Modal>
  );
}
