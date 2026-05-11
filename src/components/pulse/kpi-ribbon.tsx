"use client";

import { useEffect, useState } from "react";
import { startOfDay, endOfDay, formatISO } from "date-fns";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { KpiCard, LiveIndicator } from "@/components/fx/primitives";

type Kpis = {
  liveNow: number;
  liveBreakdown: { onSite: number; late: number; check: number };
  revenuePeriod: number;
  jobsPeriod: number;
  marginPeriod: number;
  marginNet: number;
  slaRisk: number;
  slaJobs: string[];
  quotesPending: number;
  quotesPipeline: number;
};

const ACTIVE_STATUSES = ["in_progress", "late", "final_check"] as const;
const QUOTE_PENDING_STATUSES = ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"] as const;

const initial: Kpis = {
  liveNow: 0,
  liveBreakdown: { onSite: 0, late: 0, check: 0 },
  revenuePeriod: 0,
  jobsPeriod: 0,
  marginPeriod: 0,
  marginNet: 0,
  slaRisk: 0,
  slaJobs: [],
  quotesPending: 0,
  quotesPipeline: 0,
};

export function KpiRibbon() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [kpis, setKpis] = useState<Kpis>(initial);
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

      const [active, periodJobs, late, quotes] = await Promise.all([
        supabase
          .from("jobs")
          .select("status", { count: "exact" })
          .in("status", ACTIVE_STATUSES as unknown as string[])
          .is("deleted_at", null),
        supabase
          .from("jobs")
          .select("client_price, extras_amount, partner_cost")
          .gte("scheduled_start_at", fromIso)
          .lte("scheduled_start_at", toIso)
          .neq("status", "cancelled")
          .is("deleted_at", null),
        supabase
          .from("jobs")
          .select("reference", { count: "exact" })
          .eq("status", "late")
          .is("deleted_at", null)
          .order("scheduled_start_at", { ascending: true })
          .limit(2),
        supabase
          .from("quotes")
          .select("total_value", { count: "exact" })
          .in("status", QUOTE_PENDING_STATUSES as unknown as string[])
          .is("deleted_at", null),
      ]);

      if (cancelled) return;

      type ActiveRow = { status: string };
      const activeRows = (active.data ?? []) as ActiveRow[];
      const liveBreakdown = {
        onSite: activeRows.filter((r) => r.status === "in_progress").length,
        late: activeRows.filter((r) => r.status === "late").length,
        check: activeRows.filter((r) => r.status === "final_check").length,
      };

      type PeriodRow = {
        client_price: number | null;
        extras_amount: number | null;
        partner_cost: number | null;
      };
      const periodRows = (periodJobs.data ?? []) as PeriodRow[];
      const billed = periodRows.reduce(
        (a, r) => a + (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0),
        0,
      );
      const cost = periodRows.reduce((a, r) => a + (Number(r.partner_cost) || 0), 0);
      const marginNet = billed - cost;
      const marginPeriod = billed > 0 ? (marginNet / billed) * 100 : 0;

      type LateRow = { reference: string };
      const lateRows = (late.data ?? []) as LateRow[];

      type QuoteRow = { total_value: number | null };
      const quoteRows = (quotes.data ?? []) as QuoteRow[];
      const quotesPipeline = quoteRows.reduce((a, r) => a + (Number(r.total_value) || 0), 0);

      setKpis({
        liveNow: active.count ?? 0,
        liveBreakdown,
        revenuePeriod: billed,
        jobsPeriod: periodRows.length,
        marginPeriod,
        marginNet,
        slaRisk: late.count ?? 0,
        slaJobs: lateRows.map((r) => r.reference),
        quotesPending: quotes.count ?? 0,
        quotesPipeline,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const periodLabel = bounds ? rangeLabel : "Today";

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Live now"
        variant="coral"
        value={loading ? "—" : kpis.liveNow}
        sub={
          loading
            ? "Loading…"
            : `${kpis.liveBreakdown.onSite} on-site · ${kpis.liveBreakdown.late} late · ${kpis.liveBreakdown.check} wrap-up`
        }
        topRight={<LiveIndicator label="" />}
      />
      <KpiCard
        label={`Revenue · ${periodLabel}`}
        value={loading ? "—" : formatGbp(kpis.revenuePeriod)}
        sub={loading ? "Loading…" : `Across ${kpis.jobsPeriod} job${kpis.jobsPeriod === 1 ? "" : "s"}`}
      />
      <KpiCard
        label={`Margin · ${periodLabel}`}
        value={loading ? "—" : `${kpis.marginPeriod.toFixed(1)}%`}
        sub={loading ? "Loading…" : `${formatGbp(kpis.marginNet)} net of partner cost`}
      />
      <KpiCard
        label="SLA at risk"
        variant={kpis.slaRisk > 0 ? "alert" : "default"}
        value={loading ? "—" : kpis.slaRisk}
        sub={
          loading
            ? "Loading…"
            : kpis.slaJobs.length > 0
              ? kpis.slaJobs.join(" · ")
              : "All jobs on track"
        }
      />
      <KpiCard
        label="Quotes pending"
        value={loading ? "—" : kpis.quotesPending}
        sub={loading ? "Loading…" : `${formatGbp(kpis.quotesPipeline)} in pipeline`}
      />
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
