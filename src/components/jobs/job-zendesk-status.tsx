"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

interface ZendeskEvent {
  id: string;
  kind: string;
  status_at_event: string | null;
  push_ok: boolean;
  push_tokens_sent: number;
  push_error: string | null;
  zendesk_ok: boolean;
  zendesk_message_id: string | null;
  zendesk_error: string | null;
  created_at: string;
}

interface ZendeskStatusResponse {
  ok: boolean;
  isZendeskJob: boolean;
  ticketId: string | null;
  sideConversationId: string | null;
  events: ZendeskEvent[];
}

const KIND_LABEL: Record<string, string> = {
  assigned:        "Partner assigned",
  status_changed:  "Status changed",
  cancelled:       "Cancelled",
  on_hold:         "On hold",
  resumed:         "Resumed",
  completed:       "Completed",
  rescheduled:     "Rescheduled",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Compact status block for the job detail page that shows:
 *   - whether the job is linked to a Zendesk ticket
 *   - whether a side conversation has been opened
 *   - latest event delivery (push + zendesk) and its success/error
 *   - expandable history of recent events
 *
 * Hidden when the job didn't originate from Zendesk.
 */
export function JobZendeskStatus({ jobId, zendeskSubdomain }: { jobId: string; zendeskSubdomain?: string | null }) {
  const [data, setData] = useState<ZendeskStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/zendesk-events`, { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as ZendeskStatusResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border-light bg-surface px-3 py-2 text-xs text-text-tertiary flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading Zendesk status…
      </div>
    );
  }

  if (!data || !data.isZendeskJob) return null;

  const last = data.events[0] ?? null;
  const ticketUrl = zendeskSubdomain && data.ticketId
    ? `https://${zendeskSubdomain}.zendesk.com/agent/tickets/${data.ticketId}`
    : null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Zendesk</span>
          {data.sideConversationId ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 px-1.5 py-0.5 rounded">
              <CheckCircle2 className="h-3 w-3" /> side conv linked
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 px-1.5 py-0.5 rounded">
              <AlertCircle className="h-3 w-3" /> no side conv yet
            </span>
          )}
        </div>

        <span className="text-xs text-text-secondary font-mono">
          ticket #{data.ticketId}
        </span>
        {ticketUrl ? (
          <a
            href={ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            open <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}

        <div className="flex-1" />

        {last ? (
          <span className="text-[11px] text-text-tertiary">
            last: <b className="text-text-secondary font-medium">{KIND_LABEL[last.kind] ?? last.kind}</b> · {timeAgo(last.created_at)}
          </span>
        ) : (
          <span className="text-[11px] text-text-tertiary">no events yet</span>
        )}

        {data.events.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-text-tertiary hover:text-text-primary p-1 -mr-1"
            title={expanded ? "Hide history" : "Show history"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>

      {/* Last-event status pills (always visible if any) */}
      {last ? (
        <div className="flex items-center gap-2 px-3 pb-2 -mt-1">
          <StatusPill ok={last.push_ok} label="Push" detail={
            last.push_ok
              ? `${last.push_tokens_sent} device${last.push_tokens_sent === 1 ? "" : "s"}`
              : last.push_error ?? "failed"
          } />
          <StatusPill ok={last.zendesk_ok} label="Zendesk" detail={
            last.zendesk_ok ? "delivered" : (last.zendesk_error ?? "failed")
          } />
        </div>
      ) : null}

      {/* History */}
      {expanded && data.events.length > 0 ? (
        <div className="border-t border-border-light bg-surface/30">
          <ul className="divide-y divide-border-light">
            {data.events.map((ev) => (
              <li key={ev.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <div className="w-28 shrink-0">
                  <div className="font-medium text-text-primary">{KIND_LABEL[ev.kind] ?? ev.kind}</div>
                  <div className="text-[10px] text-text-tertiary">{timeAgo(ev.created_at)}</div>
                </div>
                <div className="flex-1 flex items-center gap-1.5">
                  <StatusPill ok={ev.push_ok} label="P" detail={ev.push_ok ? `${ev.push_tokens_sent}` : ev.push_error ?? "fail"} small />
                  <StatusPill ok={ev.zendesk_ok} label="Z" detail={ev.zendesk_ok ? "ok" : ev.zendesk_error ?? "fail"} small />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ ok, label, detail, small = false }: { ok: boolean; label: string; detail: string; small?: boolean }) {
  const className = ok
    ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300"
    : "text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300";
  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-0.5 ${small ? "text-[9px] px-1 py-0.5" : "text-[10px] px-1.5 py-0.5"} font-mono font-medium rounded ${className}`}
    >
      {ok ? <CheckCircle2 className={small ? "h-2.5 w-2.5" : "h-3 w-3"} /> : <AlertCircle className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />}
      {label}{small ? "" : `: ${detail}`}
    </span>
  );
}
