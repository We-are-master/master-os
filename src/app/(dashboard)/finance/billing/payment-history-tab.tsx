"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

type SelfBillSummary = {
  id: string;
  reference: string;
  partner_id: string | null;
  partner_name: string;
  net_payout: number;
  status: string;
  email_sent_at: string | null;
  paid_at: string | null;
  payment_run_id: string | null;
  zendesk_side_conversation_id: string | null;
};

type PaymentRun = {
  id: string;
  cycle_kind: "standard" | "off_cycle";
  period_start: string;
  period_end: string;
  expected_pay_date: string | null;
  zendesk_ticket_id: string | null;
  zendesk_ticket_url: string | null;
  total_amount: number;
  self_bill_ids: string[];
  self_bills: SelfBillSummary[];
  created_at: string;
};

type TimelineEntry = {
  id: string;
  entity_id: string;
  entity_ref: string;
  action: string;
  field_name: string | null;
  new_value: string | null;
  user_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function runStatusPill(run: PaymentRun): { label: string; tone: "info" | "ok" | "warn" } {
  const total = run.self_bills.length;
  if (!total) return { label: "Pending", tone: "warn" };
  const sent = run.self_bills.filter((sb) => !!sb.email_sent_at).length;
  const paid = run.self_bills.filter((sb) => !!sb.paid_at).length;
  if (paid === total) return { label: "All paid", tone: "ok" };
  if (sent === total) return { label: "All sent", tone: "info" };
  if (sent > 0) return { label: `${sent}/${total} sent`, tone: "info" };
  return { label: "Pending", tone: "warn" };
}

const TONE_CLS: Record<"info" | "ok" | "warn", string> = {
  ok: "bg-emerald-50 text-emerald-700",
  info: "bg-blue-50 text-blue-700",
  warn: "bg-amber-50 text-amber-700",
};

export function PaymentHistoryTab() {
  const [runs, setRuns] = useState<PaymentRun[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch("/api/finance/payment-runs")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          runs?: PaymentRun[];
          timeline?: TimelineEntry[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "Failed to load payment history");
          setRuns([]);
          setTimeline([]);
          return;
        }
        setRuns(json.runs ?? []);
        setTimeline(json.timeline ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
        setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="px-4 py-12 text-center text-sm text-text-tertiary">
        Loading payment history…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-12 text-center text-sm text-red-600">{error}</div>
    );
  }
  if (!runs || runs.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-text-tertiary">
        No payment runs yet. Send self-bills from Going Out · Money Out to start the log.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="divide-y divide-border-light rounded-xl border border-border-light bg-white shadow-sm">
        {runs.map((run) => {
          const open = expanded.has(run.id);
          const status = runStatusPill(run);
          const periodLabel = `${fmtDate(run.period_start)} – ${fmtDate(run.period_end)}`;
          return (
            <div key={run.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover/40"
                onClick={() => toggle(run.id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      run.cycle_kind === "standard" ? "bg-[#020040]/[0.08] text-[#020040]" : "bg-amber-50 text-amber-800",
                    )}
                  >
                    {run.cycle_kind === "standard" ? "Standard" : "Off-cycle"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#020040]">{periodLabel}</p>
                    <p className="text-xs text-text-tertiary">
                      {run.self_bills.length} self-bill{run.self_bills.length === 1 ? "" : "s"} · created {fmtDateTime(run.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", TONE_CLS[status.tone])}>
                    {status.label}
                  </span>
                  <p className="text-sm font-semibold tabular-nums text-[#020040]">{formatCurrency(run.total_amount)}</p>
                  {run.zendesk_ticket_url ? (
                    <a
                      href={run.zendesk_ticket_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border border-border-light p-1 hover:bg-surface-hover/50"
                      title="Open Zendesk master ticket"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-text-secondary" />
                    </a>
                  ) : null}
                  <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", open && "rotate-180")} />
                </div>
              </button>
              {open ? (
                <div className="overflow-x-auto bg-surface-hover/10">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-text-tertiary">
                      <tr>
                        <th className="px-4 py-2">Ref</th>
                        <th className="px-3 py-2">Partner</th>
                        <th className="px-3 py-2">Sent</th>
                        <th className="px-3 py-2">Paid</th>
                        <th className="px-3 py-2 text-right">Net payout</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light">
                      {run.self_bills.map((sb) => (
                        <tr key={sb.id}>
                          <td className="px-4 py-2 font-semibold">{sb.reference}</td>
                          <td className="px-3 py-2 text-text-secondary">{sb.partner_name}</td>
                          <td className="px-3 py-2 text-xs text-text-secondary">
                            {sb.email_sent_at ? fmtDateTime(sb.email_sent_at) : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary">
                            {sb.paid_at ? fmtDateTime(sb.paid_at) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(Number(sb.net_payout ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <aside className="rounded-xl border border-border-light bg-white shadow-sm">
        <div className="border-b border-border-light px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary">Activity log</p>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {timeline.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-text-tertiary">No events yet.</p>
          ) : (
            <ul className="divide-y divide-border-light">
              {timeline.map((entry) => {
                const meta = entry.metadata ?? {};
                const ticketUrl = typeof meta.zendesk_ticket_url === "string" ? meta.zendesk_ticket_url : null;
                return (
                  <li key={entry.id} className="px-4 py-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text-primary">{entry.entity_ref}</span>
                      <span className="text-text-tertiary">{fmtDateTime(entry.created_at)}</span>
                    </div>
                    <p className="mt-0.5 text-text-secondary">
                      {entry.field_name === "email_sent"
                        ? `Sent to ${entry.new_value ?? "partner"}`
                        : entry.action === "paid"
                          ? `Paid${entry.new_value ? ` — ${entry.new_value}` : ""}`
                          : entry.field_name ?? entry.action}
                    </p>
                    {entry.user_name ? (
                      <p className="mt-0.5 text-text-tertiary">by {entry.user_name}</p>
                    ) : null}
                    {ticketUrl ? (
                      <a
                        href={ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        Zendesk ticket <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
