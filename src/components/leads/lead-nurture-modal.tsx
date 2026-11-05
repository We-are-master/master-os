"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeLeadStage } from "@/services/leads";
import type { Lead } from "@/types/database";
import { textareaClass } from "./crm-ui";

const londonToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function plusDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function LeadNurtureModal({ lead, open, onClose, onDone }: { lead: Lead; open: boolean; onClose: () => void; onDone: (l: Lead) => void }) {
  const today = londonToday();
  const [until, setUntil] = useState(() => plusDays(today, 7));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!until) return toast.error("Pick a date to come back to this lead");
    if (until <= today) return toast.error("The come-back date must be in the future");
    setSaving(true);
    try {
      const updated = await changeLeadStage(lead.id, "nurture", {
        nurtureUntil: until,
        summary: reason.trim() ? `Nurture until ${until} · ${reason.trim()}` : `Nurture until ${until}`,
      });
      toast.success("Lead paused until " + until.split("-").reverse().join("/"));
      setReason("");
      onDone(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not pause the lead");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nurture" subtitle={`${lead.reference} · ${lead.name}. Stops the follow-ups until the date.`} size="sm">
      <div className="px-4 pb-4 pt-4 space-y-3 sm:px-5 sm:pb-5">
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">Come back on</label>
          <Input type="date" min={plusDays(today, 1)} value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">Reason (optional)</label>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} placeholder="No reply after reminders" />
        </div>
        <p className="text-[11px] text-text-tertiary">On the date the lead goes back to Talking with the next action &quot;Check in&quot;.</p>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !until || until <= today}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pause lead"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
