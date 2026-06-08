"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { startOfDay, endOfDay, formatISO } from "date-fns";
import { FileWarning, TrendingDown, Wallet, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { officeCancellationReasonLabel } from "@/lib/job-office-cancellation";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";

type AlertItem = {
  id: string;
  title: string;
  meta: string;
  href: string;
  tone: "red" | "coral" | "blue" | "amber" | "navy";
  icon: React.ReactNode;
};

type CancelledJobRow = {
  id: string;
  reference: string;
  title: string | null;
  cancellation_reason: string | null;
  cancellation_reason_preset_id: string | null;
  cancelled_client_price: number | null;
  cancelled_extras_amount: number | null;
};

const TONE_CLASS: Record<AlertItem["tone"], string> = {
  red: "bg-fx-red-50 text-fx-red",
  coral: "bg-fx-coral-50 text-fx-coral-p",
  blue: "bg-fx-blue-50 text-fx-blue",
  amber: "bg-fx-amber-50 text-fx-amber",
  navy: "bg-fx-navy/10 text-fx-navy",
};

function jobLostGbp(job: CancelledJobRow): number {
  return (Number(job.cancelled_client_price) || 0) + (Number(job.cancelled_extras_amount) || 0);
}

function cancelReasonLabel(job: CancelledJobRow): string {
  if (job.cancellation_reason_preset_id?.trim()) {
    return officeCancellationReasonLabel(job.cancellation_reason_preset_id);
  }
  const text = job.cancellation_reason?.trim();
  if (!text) return "Cancelled";
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

export function AlertsFeed() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });

    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const fromIso = bounds?.fromIso ?? formatISO(startOfDay(now));
      const toIso = bounds?.toIso ?? formatISO(endOfDay(now));

      let cancelledAggQuery = supabase
        .from("jobs")
        .select("cancelled_client_price, cancelled_extras_amount")
        .eq("status", "cancelled")
        .is("deleted_at", null);

      let cancelledRecentQuery = supabase
        .from("jobs")
        .select(
          "id, reference, title, cancellation_reason, cancellation_reason_preset_id, cancelled_client_price, cancelled_extras_amount",
        )
        .eq("status", "cancelled")
        .is("deleted_at", null)
        .order("cancelled_at", { ascending: false })
        .limit(3);

      if (bounds) {
        cancelledAggQuery = cancelledAggQuery.gte("cancelled_at", fromIso).lte("cancelled_at", toIso);
        cancelledRecentQuery = cancelledRecentQuery.gte("cancelled_at", fromIso).lte("cancelled_at", toIso);
      }

      const [cancelledAggRes, cancelledRecentRes, awaitingPayment, lowMargin, needAttention] = await Promise.all([
        cancelledAggQuery,
        cancelledRecentQuery,
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
      const periodHint = bounds ? rangeLabel.toLowerCase() : "all time";
      const cancelledAgg = (cancelledAggRes.data ?? []) as Pick<
        CancelledJobRow,
        "cancelled_client_price" | "cancelled_extras_amount"
      >[];
      const cancelledRecent = (cancelledRecentRes.data ?? []) as CancelledJobRow[];

      if (cancelledAgg.length > 0) {
        const lostTotal = cancelledAgg.reduce((sum, j) => sum + jobLostGbp(j as CancelledJobRow), 0);
        const count = cancelledAgg.length;
        out.push({
          id: "lost-revenue",
          title: formatGbp(lostTotal) + " Lost Revenue",
          meta: `${count} job${count === 1 ? "" : "s"} cancelled · ${periodHint}`,
          href: "/jobs?status=closed",
          tone: "coral",
          icon: <TrendingDown className="h-4 w-4" />,
        });

        for (const job of cancelledRecent) {
          const lost = jobLostGbp(job);
          out.push({
            id: `cancelled-${job.id}`,
            title: job.title?.trim() || job.reference,
            meta: `${cancelReasonLabel(job)} · ${formatGbp(lost)}`,
            href: `/jobs/${job.id}`,
            tone: "red",
            icon: <XCircle className="h-4 w-4" />,
          });
        }
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
          meta: `No cancellations, payment issues, or margin alerts · ${periodHint}`,
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
  }, [bounds, rangeLabel]);

  return (
    <SectionCard
      title="Needs Attention"
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
      actions={
        <Link
          href="/jobs"
          className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors"
        >
          View all
        </Link>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-col">
        {loading ? (
          <div className="px-5 py-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 bg-fx-paper-2/40 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          items.map((item, i) => (
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
          ))
        )}
      </div>
    </SectionCard>
  );
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
