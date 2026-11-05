"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOST_REASON_LABEL } from "@/lib/crm/etapas";
import { changeLeadStage } from "@/services/leads";
import type { Lead, LeadLostReason } from "@/types/database";
import { textareaClass } from "./crm-ui";

export function LeadLostModal({ lead, open, onClose, onDone }: { lead: Lead; open: boolean; onClose: () => void; onDone: (l: Lead) => void }) {
  const [reason, setReason] = useState<LeadLostReason | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason) return toast.error("Pick a reason to mark this lead as lost");
    setSaving(true);
    try {
      const updated = await changeLeadStage(lead.id, "lost", { lostReason: reason, lostNote: note });
      toast.success("Lead marked as lost");
      setReason("");
      setNote("");
      onDone(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark the lead as lost");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Mark lost" subtitle={`${lead.reference} · ${lead.name}. Stops the follow-ups.`} size="sm">
      <div className="px-4 pb-4 pt-4 space-y-3 sm:px-5 sm:pb-5">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-secondary mb-1.5">Reason</legend>
          {(Object.keys(LOST_REASON_LABEL) as LeadLostReason[]).map((r) => (
            <label
              key={r}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer",
                reason === r ? "border-primary bg-[var(--pick-bg)]" : "border-border-light hover:border-border",
              )}
            >
              <input type="radio" name="lost-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {LOST_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">Note</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} placeholder="Found a local plumber cheaper." />
        </div>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={saving || !reason}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark lost"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
