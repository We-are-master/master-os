"use client";

import { useEffect, useState } from "react";
import { STAGE_LABEL } from "@/lib/crm/etapas";
import { listLeadEvents } from "@/services/leads";
import type { LeadEvent, LeadEventKind } from "@/types/database";
import { formatWhen } from "./crm-ui";

const KIND_LABEL: Record<LeadEventKind, string> = {
  created: "Lead created",
  stage_changed: "Stage changed",
  message_in: "Customer message",
  message_out: "Message sent",
  note: "Note",
  next_action_set: "Next action",
  quote_created: "Quote created",
  quote_sent: "Quote sent",
  payment: "Payment",
  assigned: "Assigned",
  job_created: "Job created",
};

const ACTOR: Record<string, string> = { staff: "Office", harvey: "Harvey", system: "System", customer: "Customer", partner: "Partner" };

function line(e: LeadEvent): string {
  if (e.kind === "stage_changed" && (e.from_stage || e.to_stage)) {
    const move = `${e.from_stage ? STAGE_LABEL[e.from_stage] : "·"} → ${e.to_stage ? STAGE_LABEL[e.to_stage] : "·"}`;
    return e.summary ? `${move} · ${e.summary}` : move;
  }
  if (e.kind === "next_action_set") {
    const at = typeof e.payload?.next_action_at === "string" ? formatWhen(e.payload.next_action_at) : "";
    return [e.summary, at].filter(Boolean).join(" · ");
  }
  return e.summary ?? "";
}

export function LeadTimeline({ leadId, reloadKey }: { leadId: string; reloadKey?: number }) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listLeadEvents(leadId)
      .then((rows) => {
        if (!active) return;
        setEvents(rows);
        setError(null);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Could not load the timeline"));
    return () => {
      active = false;
    };
  }, [leadId, reloadKey]);

  if (error) return <p className="text-xs text-[var(--bad-ink)]">{error}</p>;
  if (!events) return <p className="text-xs text-text-tertiary">Loading…</p>;
  if (!events.length) return <p className="text-xs text-text-tertiary">No activity yet.</p>;
  return (
    <ol className="space-y-2.5">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-[12px]">
          <span className="w-24 shrink-0 tabular-nums text-text-tertiary">{formatWhen(e.created_at)}</span>
          <div className="min-w-0">
            <p className="font-medium text-text-primary">
              {KIND_LABEL[e.kind] ?? e.kind}
              <span className="font-normal text-text-tertiary">
                {" · "}
                {ACTOR[e.actor_type] ?? e.actor_type}
                {e.channel ? ` · ${e.channel}` : ""}
              </span>
            </p>
            {line(e) ? <p className="text-text-secondary whitespace-pre-wrap break-words">{line(e)}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
