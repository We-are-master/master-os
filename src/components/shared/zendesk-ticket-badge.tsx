"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import type { Job } from "@/types/database";

/**
 * Inline pill that surfaces the Zendesk ticket id on a job/quote when
 * `external_source = "zendesk"`. Hidden for jobs that didn't originate
 * from Zendesk (e.g. portal, manual creation).
 *
 * When `jobId` + `zendeskSubdomain` are both provided, the badge becomes
 * an external link that opens the Zendesk ticket in a new tab AND hovering
 * reveals a popover with delivery status and the latest ticket events
 * (replaces the old `<JobZendeskStatus />` strip).
 */
type ZendeskEvent = {
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
};

type ZendeskStatusResponse = {
  ok: boolean;
  isZendeskJob: boolean;
  ticketId: string | null;
  /** Pre-built deep-link to the Zendesk ticket — server-built from ZENDESK_SUBDOMAIN env. */
  ticketUrl: string | null;
  subdomain: string | null;
  sideConversationId: string | null;
  events: ZendeskEvent[];
};

const KIND_LABEL: Record<string, string> = {
  assigned: "Partner Assigned",
  status_changed: "Status Changed",
  cancelled: "Cancelled",
  on_hold: "On Hold",
  resumed: "Resumed",
  completed: "Completed",
  rescheduled: "Rescheduled",
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

export function ZendeskTicketBadge({
  source,
  ref,
  jobId,
  zendeskSubdomain,
  size = "sm",
}: {
  source: Job["external_source"];
  ref: Job["external_ref"];
  /** Pass to enable the hover popover with delivery status. */
  jobId?: string;
  /** Pass to make the badge clickable (opens the Zendesk ticket). */
  zendeskSubdomain?: string | null;
  size?: "xs" | "sm";
}) {
  const [data, setData] = useState<ZendeskStatusResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Eager fetch on mount when a jobId is supplied — needed so click on the
  // badge can navigate to the ticket without waiting for a hover.
  // Lists without jobId stay lazy (no fetch at all).
  useEffect(() => {
    if (!jobId || source !== "zendesk") return;
    let cancelled = false;
    void fetch(`/api/jobs/${jobId}/zendesk-events`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ZendeskStatusResponse | null) => {
        if (cancelled) return;
        setData(json);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, source]);

  if (source !== "zendesk" || !ref) return null;

  const padding = size === "xs" ? "px-1 py-0.5" : "px-1.5 py-0.5";
  const fontSize = size === "xs" ? "text-[9px]" : "text-[10px]";
  /**
   * Build the Zendesk ticket URL synchronously so the badge is clickable on
   * first render — no waiting for the API. Priority order:
   *   1. URL from the API (server-built from `ZENDESK_SUBDOMAIN` env or
   *      `company_settings.frontend_setup.zendesk_subdomain`)
   *   2. `zendeskSubdomain` prop (legacy callers, lists without jobId)
   *   3. Hardcoded fallback to "fixfy" — keeps click-through working for
   *      the master-os instance even when nothing is configured server-side.
   *      Replace if porting to a different Zendesk account.
   */
  const FALLBACK_SUBDOMAIN = "fixfy";
  const ticketUrl =
    data?.ticketUrl
    ?? (zendeskSubdomain ? `https://${zendeskSubdomain}.zendesk.com/agent/tickets/${ref}` : null)
    ?? `https://${FALLBACK_SUBDOMAIN}.zendesk.com/agent/tickets/${ref}`;

  const badgeInner = (
    <span
      className={`inline-flex items-center gap-1 font-mono font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 ${padding} ${fontSize} rounded ${
        ticketUrl ? "hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors cursor-pointer" : ""
      }`}
    >
      <span aria-hidden="true">🎫</span>#{ref}
    </span>
  );

  const handleEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(true);
  };
  const handleLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(false), 120);
  };

  // No jobId → keep legacy behaviour (just a pill, optionally a link).
  if (!jobId) {
    if (ticketUrl) {
      return (
        <a
          href={ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open Zendesk ticket #${ref}`}
        >
          {badgeInner}
        </a>
      );
    }
    return <span title={`Zendesk ticket #${ref}`}>{badgeInner}</span>;
  }

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {ticketUrl ? (
        <a
          href={ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open Zendesk ticket #${ref}`}
        >
          {badgeInner}
        </a>
      ) : (
        <span title={`Zendesk ticket #${ref}`}>{badgeInner}</span>
      )}
      {hovered && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-[320px] rounded-lg border border-fx-line bg-card shadow-fx-2 p-3 text-xs cursor-default"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          role="dialog"
          aria-label="Zendesk delivery status"
        >
          {!loaded ? (
            <div className="flex items-center gap-2 text-fx-mute">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading status…
            </div>
          ) : !data || !data.isZendeskJob ? (
            <div className="text-fx-mute">No Zendesk data for this job.</div>
          ) : (
            <ZendeskStatusBody data={data} ticketUrl={ticketUrl} />
          )}
        </div>
      )}
    </span>
  );
}

function ZendeskStatusBody({
  data,
  ticketUrl,
}: {
  data: ZendeskStatusResponse;
  ticketUrl: string | null;
}) {
  const last = data.events[0] ?? null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-mute">Zendesk</span>
        {data.sideConversationId ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="h-3 w-3" /> side conv linked
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 px-1.5 py-0.5 rounded">
            <AlertCircle className="h-3 w-3" /> no side conv yet
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-text-primary">
        <span className="font-mono text-[12px]">ticket #{data.ticketId}</span>
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
      </div>
      {last ? (
        <div className="border-t border-fx-line pt-2">
          <p className="text-[11px] text-fx-mute">
            last:{" "}
            <span className="text-text-primary font-medium">
              {KIND_LABEL[last.kind] ?? last.kind}
            </span>{" "}
            · {timeAgo(last.created_at)}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <Pill ok={last.push_ok} label="Push" detail={last.push_ok ? `${last.push_tokens_sent} device${last.push_tokens_sent === 1 ? "" : "s"}` : last.push_error ?? "failed"} />
            <Pill ok={last.zendesk_ok} label="Zendesk" detail={last.zendesk_ok ? "delivered" : last.zendesk_error ?? "failed"} />
          </div>
        </div>
      ) : (
        <div className="border-t border-fx-line pt-2 text-fx-mute text-[11px]">No events yet.</div>
      )}
      {data.events.length > 1 ? (
        <div className="border-t border-fx-line pt-2 max-h-32 overflow-y-auto">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-mute mb-1">Recent</p>
          <ul className="divide-y divide-fx-line">
            {data.events.slice(1, 5).map((ev) => (
              <li key={ev.id} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                <span className="text-text-primary">{KIND_LABEL[ev.kind] ?? ev.kind}</span>
                <span className="text-fx-mute font-mono text-[10px]">{timeAgo(ev.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Pill({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const cls = ok
    ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300"
    : "text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300";
  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${cls}`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {label}: {detail}
    </span>
  );
}
