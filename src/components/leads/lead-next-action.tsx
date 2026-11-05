"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setLeadNextAction } from "@/services/leads";
import type { Lead } from "@/types/database";
import { formatWhen, isOverdue, isoToLocalInput, localInputToIso } from "./crm-ui";

/** Próximo passo do lead: texto + data/hora. Obrigatório em lead aberto. */
export function LeadNextAction({ lead, required, onSaved }: { lead: Lead; required: boolean; onSaved: (l: Lead) => void }) {
  const [text, setText] = useState(lead.next_action ?? "");
  const [at, setAt] = useState(isoToLocalInput(lead.next_action_at));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(lead.next_action ?? "");
    setAt(isoToLocalInput(lead.next_action_at));
  }, [lead.id, lead.next_action, lead.next_action_at]);

  const missing = required && !lead.next_action_at;
  const overdue = required && isOverdue(lead.next_action_at);
  const dirty = text.trim() !== (lead.next_action ?? "").trim() || at !== isoToLocalInput(lead.next_action_at);

  const save = async () => {
    const iso = localInputToIso(at);
    if (!text.trim()) return toast.error("Write the next action");
    if (!iso) return toast.error("Pick a date and time for the next action");
    setSaving(true);
    try {
      const updated = await setLeadNextAction(lead.id, text, iso);
      toast.success("Next action saved");
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the next action");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 space-y-2",
        missing ? "border-[var(--bad-ink)]/40 bg-danger-light/40" : overdue ? "border-[var(--warn-ink)]/40 bg-warning-light/40" : "border-border-light",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Next action{required ? " · required" : ""}
        </p>
        {lead.next_action_at ? (
          <span className={cn("text-[11px] tabular-nums", overdue ? "text-[var(--bad-ink)] font-semibold" : "text-text-tertiary")}>
            {overdue ? "Overdue · " : ""}
            {formatWhen(lead.next_action_at)}
          </span>
        ) : null}
      </div>
      {missing ? (
        <p className="text-[11px] text-[var(--bad-ink)]">An open lead always has a next action. Set one to save this lead.</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem]">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to the customer, chase the payment link…" />
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant={dirty || missing ? "primary" : "secondary"} onClick={save} disabled={saving || (!dirty && !missing)}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save next action"}
        </Button>
      </div>
    </div>
  );
}
