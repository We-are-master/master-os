"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, FileWarning, Sparkles, TrendingDown, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import {
  fetchPulseCancelledJobs,
  type PulseCancelledSummary,
} from "@/lib/pulse-cancelled-insights";
import { formatCompactPeriodLabel } from "@/lib/dashboard-date-range";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";
import {
  PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS,
  PULSE_FORECAST_PAIR_CARD_CLASS,
} from "@/lib/pulse-layout";

export type AlertsFeedMode = "cancelled" | "attention";

const MODES: { id: AlertsFeedMode; label: string }[] = [
  { id: "cancelled", label: "Cancelled" },
  { id: "attention", label: "Needs Attention" },
];

type AlertItem = {
  id: string;
  title: string;
  meta: string;
  href: string;
  tone: "red" | "coral" | "blue" | "amber" | "navy";
  icon: React.ReactNode;
};

type CancelledSummaryView = PulseCancelledSummary & { periodHint: string };

const TONE_CLASS: Record<AlertItem["tone"], string> = {
  red: "bg-fx-red-50 text-fx-red",
  coral: "bg-fx-coral-50 text-fx-coral-p",
  blue: "bg-fx-blue-50 text-fx-blue",
  amber: "bg-fx-amber-50 text-fx-amber",
  navy: "bg-fx-navy/10 text-fx-navy",
};

function AlertsModeToggle({
  mode,
  onChange,
  cancelledCount,
  attentionCount,
}: {
  mode: AlertsFeedMode;
  onChange: (m: AlertsFeedMode) => void;
  cancelledCount: number;
  attentionCount: number;
}) {
  const badges: Record<AlertsFeedMode, number> = {
    cancelled: cancelledCount,
    attention: attentionCount,
  };

  return (
    <div
      className="inline-flex items-center rounded-md border border-fx-line bg-fx-paper p-0.5"
      role="tablist"
      aria-label="Needs attention feed"
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          onClick={() => onChange(m.id)}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition-colors",
            mode === m.id
              ? "bg-card text-text-primary shadow-sm"
              : "text-fx-mute hover:text-text-primary",
          )}
        >
          {m.label}
          {badges[m.id] > 0 ? (
            <span
              className={cn(
                "min-w-[1.125rem] rounded-full px-1 py-px text-[10px] font-semibold tabular-nums leading-none",
                mode === m.id ? "bg-fx-coral-50 text-fx-coral-p" : "bg-fx-paper-2 text-fx-mute",
              )}
            >
              {badges[m.id]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function AlertsFeed() {
  const { bounds, rangeLabel, preset, customFrom, customTo } = useDashboardDateRange();
  const [mode, setMode] = useState<AlertsFeedMode>("cancelled");
  const [items, setItems] = useState<AlertItem[]>([]);
  const [cancelledSummary, setCancelledSummary] = useState<CancelledSummaryView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });

    void (async () => {
      const supabase = getSupabase();
      const periodHint = formatCompactPeriodLabel(preset, bounds, customFrom, customTo);
      const periodHintLower = periodHint.toLowerCase();

      const [cancelledData, awaitingPayment, lowMargin, needAttention] = await Promise.all([
        fetchPulseCancelledJobs(supabase, bounds),
        supabase
          .from("jobs")
          .select("reference, client_price, extras_amount", { count: "exact" })
          .eq("status", "awaiting_payment")
          .is("deleted_at", null),
        supabase
          .from("jobs")
          .select("id, reference, title, margin_percent")
          .gt("margin_percent", 0)
          .lt("margin_percent", 20)
          .is("deleted_at", null)
          .order("margin_percent", { ascending: true })
          .limit(1),
        supabase
          .from("jobs")
          .select("reference", { count: "exact" })
          .eq("status", "need_attention")
          .is("deleted_at", null),
      ]);

      if (cancelled) return;

      const out: AlertItem[] = [];

      if (cancelledData) {
        setCancelledSummary({ ...cancelledData, periodHint });
      } else {
        setCancelledSummary(null);
      }

      const awaitingCount = awaitingPayment.count ?? 0;
      const awaitingRows = (awaitingPayment.data ?? []) as {
        client_price: number | null;
        extras_amount: number | null;
      }[];
      const awaitingTotal = awaitingRows.reduce(
        (a, r) => a + (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0),
        0,
      );
      if (awaitingCount > 0) {
        out.push({
          id: "awaiting-payment",
          title: `${awaitingCount} Job${awaitingCount === 1 ? "" : "s"} Awaiting Payment`,
          meta: `${formatGbp(awaitingTotal)} pending collection`,
          href: "/jobs?status=awaiting_payment",
          tone: "coral",
          icon: <Wallet className="h-4 w-4" />,
        });
      }

      type MarginRow = { id?: string; reference: string; title?: string; margin_percent?: number };
      const lowMarginRows = (lowMargin.data ?? []) as MarginRow[];
      if (lowMarginRows[0]) {
        out.push({
          id: `margin-${lowMarginRows[0].id}`,
          title: "Margin Below Floor",
          meta: `${lowMarginRows[0].reference} · ${(lowMarginRows[0].margin_percent ?? 0).toFixed(0)}%`,
          href: `/jobs/${lowMarginRows[0].id}`,
          tone: "navy",
          icon: <TrendingDown className="h-4 w-4" />,
        });
      }

      const naCount = needAttention.count ?? 0;
      if (naCount > 0) {
        out.push({
          id: "need-attention",
          title: `${naCount} Job${naCount === 1 ? "" : "s"} Need Attention`,
          meta: "Stuck or flagged for review",
          href: "/jobs?status=need_attention",
          tone: "amber",
          icon: <FileWarning className="h-4 w-4" />,
        });
      }

      if (out.length === 0) {
        out.push({
          id: "all-clear",
          title: "All Clear",
          meta: `No payment issues or margin alerts · ${periodHintLower}`,
          href: "/jobs",
          tone: "blue",
          icon: <Wallet className="h-4 w-4" />,
        });
      }

      setItems(out);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [bounds, rangeLabel, preset, customFrom, customTo]);

  const cancelledCount = cancelledSummary?.count ?? 0;
  const attentionCount = items.filter((i) => i.id !== "all-clear").length;
  const cancelledPeriodLabel = cancelledSummary?.periodHint ?? "No cancellations in period";
  const subtitleText =
    mode === "cancelled"
      ? cancelledSummary
        ? cancelledPeriodLabel
        : "No cancellations in period"
      : `${attentionCount} alert${attentionCount === 1 ? "" : "s"}`;

  const viewAllHref = mode === "cancelled" ? "/jobs?status=closed" : "/jobs";

  return (
    <SectionCard
      className={PULSE_FORECAST_PAIR_CARD_CLASS}
      title="Needs Attention"
      subtitle={
        <span
          className="block truncate whitespace-nowrap"
          title={mode === "cancelled" && bounds ? rangeLabel : undefined}
        >
          {subtitleText}
        </span>
      }
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <AlertsModeToggle
            mode={mode}
            onChange={setMode}
            cancelledCount={cancelledCount}
            attentionCount={attentionCount}
          />
          <Link
            href={viewAllHref}
            className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors whitespace-nowrap"
          >
            View all
          </Link>
        </div>
      }
      bodyClassName={cn("p-0", PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS)}
    >
      {mode === "cancelled" ? (
        <CancelledTable summary={cancelledSummary} loading={loading} />
      ) : (
        <AttentionList items={items} loading={loading} />
      )}
    </SectionCard>
  );
}

function CancelledTable({
  summary,
  loading,
}: {
  summary: CancelledSummaryView | null;
  loading: boolean;
}) {
  const [topFiveOpen, setTopFiveOpen] = useState(false);

  if (loading) {
    return (
      <div className="px-4 py-4 space-y-3">
        <div className="h-16 bg-fx-paper-2/40 rounded-lg animate-pulse" />
        <div className="h-8 bg-fx-paper-2/40 rounded animate-pulse" />
      </div>
    );
  }

  if (!summary || summary.topFiveReasons.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-fx-mute text-[13px]">
        No cancelled jobs in this period.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3">
        <div className="flex gap-2 rounded-lg border border-violet-200/80 bg-violet-50/60 dark:border-violet-900/50 dark:bg-violet-950/30 px-3 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300 mt-0.5" aria-hidden />
          <p className="text-[12px] leading-snug text-violet-900/90 dark:text-violet-100/90">{summary.aiHint}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setTopFiveOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left border-t border-fx-line hover:bg-fx-paper transition-colors",
          topFiveOpen && "bg-fx-paper/40",
        )}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-fx-mute transition-transform",
            topFiveOpen && "rotate-180",
          )}
          aria-hidden
        />
        <span className="text-[13px] font-medium text-text-primary">Top 5 reasons</span>
        <MicroLabel className="ml-auto shrink-0">{formatGbp(summary.lostTotal)} total</MicroLabel>
      </button>

      {topFiveOpen ? (
        <div className="border-t border-fx-line">
          <table className="w-full border-collapse text-[13px] min-w-[240px]">
            <thead>
              <tr>
                {["Reason", "Jobs", "Amount"].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "text-left px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fx-mute bg-fx-paper border-b border-fx-line whitespace-nowrap",
                      h === "Amount" && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.topFiveReasons.map((row) => (
                <tr key={row.reason} className="border-b border-fx-line last:border-0 hover:bg-fx-paper transition-colors">
                  <td className="px-4 py-2.5 align-middle max-w-[180px]">
                    <span className="font-medium text-text-primary truncate block">{row.reason}</span>
                  </td>
                  <td className="px-4 py-2.5 align-middle whitespace-nowrap tabular-nums text-text-secondary">
                    {row.jobCount}
                  </td>
                  <td className="px-4 py-2.5 align-middle whitespace-nowrap text-right">
                    <span className="font-semibold tabular-nums text-text-primary">{formatGbp(row.lostTotal)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.count > summary.topFiveReasons.length ? (
            <div className="px-4 py-2 border-t border-fx-line text-center">
              <Link
                href="/jobs?status=closed"
                className="text-[11px] font-medium text-fx-mute hover:text-text-primary"
              >
                View all {summary.count} cancelled →
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AttentionList({ items, loading }: { items: AlertItem[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="px-5 py-4 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 bg-fx-paper-2/40 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <Link
          key={item.id}
          href={item.href}
          className={cn(
            "flex items-center gap-3 px-5 py-3.5 hover:bg-fx-paper transition-colors",
            i < items.length - 1 && "border-b border-fx-line",
          )}
        >
          <span
            className={cn(
              "inline-grid place-items-center h-7 w-7 rounded-full shrink-0",
              TONE_CLASS[item.tone],
            )}
          >
            {item.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-text-primary leading-tight">{item.title}</div>
            <MicroLabel className="mt-1 block">{item.meta}</MicroLabel>
          </div>
          <span className="text-[12px] font-medium text-fx-mute hover:text-text-primary">Open →</span>
        </Link>
      ))}
    </div>
  );
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
