"use client";

import { pulseMoney } from "@/lib/pulse-money-display";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FileWarning, TrendingDown, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { formatCompactPeriodLabel } from "@/lib/dashboard-date-range";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";
import {
  PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS,
  PULSE_FORECAST_PAIR_CARD_CLASS,
} from "@/lib/pulse-layout";

type AlertItem = {
  id: string;
  title: string;
  meta: string;
  href: string;
  tone: "red" | "coral" | "blue" | "amber" | "navy";
  icon: React.ReactNode;
};

const TONE_CLASS: Record<AlertItem["tone"], string> = {
  red: "bg-fx-red-50 text-fx-red",
  coral: "bg-fx-coral-50 text-fx-coral-p",
  blue: "bg-fx-blue-50 text-fx-blue",
  amber: "bg-fx-amber-50 text-fx-amber",
  navy: "bg-fx-navy/10 text-fx-navy",
};

export function AlertsFeed() {
  const { bounds, rangeLabel, preset, customFrom, customTo } = useDashboardDateRange();
  const [items, setItems] = useState<AlertItem[]>([]);
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

      const [awaitingPayment, lowMargin, needAttention] = await Promise.all([
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

  const attentionCount = items.filter((i) => i.id !== "all-clear").length;
  const subtitleText = `${attentionCount} alert${attentionCount === 1 ? "" : "s"}`;

  return (
    <SectionCard
      className={PULSE_FORECAST_PAIR_CARD_CLASS}
      title="Needs Attention"
      subtitle={<span className="block truncate whitespace-nowrap">{subtitleText}</span>}
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Link
            href="/jobs"
            className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors whitespace-nowrap"
          >
            View all
          </Link>
        </div>
      }
      bodyClassName={cn("p-0", PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS)}
    >
      <AttentionList items={items} loading={loading} />
    </SectionCard>
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

/** Segue a lente de moeda do Pulse (GBP por padrão, BRL quando o usuário troca). */
function formatGbp(n: number): string {
  return pulseMoney(n);
}
