"use client";

import { useEffect, useState } from "react";
import { startOfDay, endOfDay, formatISO } from "date-fns";
import { ArrowDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { dashboardBoundsToInclusiveLocalYmd } from "@/lib/dashboard-date-range";
import {
  countWorkingDaysInRange,
  monthlyWorkingDays,
  parseFrontendSetup,
  type FrontendSetup,
} from "@/lib/frontend-setup";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";

type Pnl = {
  revenue: number;
  partnerCost: number;
  workforce: number;
  bills: number;
  gross: number;
  net: number;
  jobs: number;
  workingDaysInWindow: number;
};

const initial: Pnl = {
  revenue: 0,
  partnerCost: 0,
  workforce: 0,
  bills: 0,
  gross: 0,
  net: 0,
  jobs: 0,
  workingDaysInWindow: 0,
};

/** Run-rate factor by recurrence cadence — duplicated from finance/bills/page.tsx pattern. */
const MONTHLY_FACTOR: Record<string, number> = {
  weekly: 4.345,
  weekly_friday: 4.345,
  biweekly_friday: 2.1725,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

const SELF_BILL_EXCLUDED = ["rejected", "payout_cancelled", "payout_archived", "payout_lost"];

export function PnlSnapshot() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [pnl, setPnl] = useState<Pnl>(initial);
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
      const { fromDay, toDay } = bounds
        ? dashboardBoundsToInclusiveLocalYmd(bounds)
        : { fromDay: ymd(now), toDay: ymd(now) };
      const fromDate = bounds ? new Date(bounds.fromIso) : startOfDay(now);
      const toDate = bounds ? new Date(bounds.toIso) : endOfDay(now);

      const [jobsRes, billsRes, payrollRes, internalSbRes, settingsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("client_price, extras_amount, partner_cost")
          .gte("scheduled_start_at", fromIso)
          .lte("scheduled_start_at", toIso)
          .neq("status", "cancelled")
          .is("deleted_at", null),
        // ALL active bills (no due_date filter) — we split into recurring run-rate
        // and one-off in-window manually below.
        supabase
          .from("bills")
          .select("id, amount, is_recurring, recurrence_interval, recurring_series_id, status, due_date")
          .is("archived_at", null)
          .neq("status", "rejected"),
        // ALL active/onboarding payroll rows — each row is a monthly commitment.
        supabase
          .from("payroll_internal_costs")
          .select("id, amount, lifecycle_stage")
          .neq("lifecycle_stage", "offboard"),
        // Ad-hoc internal self-bills (week_start in window, dedupe vs payroll catalog).
        supabase
          .from("self_bills")
          .select("internal_cost_id, net_payout, status, week_start")
          .eq("bill_origin", "internal")
          .not("status", "in", `(${SELF_BILL_EXCLUDED.map((s) => `"${s}"`).join(",")})`)
          .gte("week_start", fromDay)
          .lte("week_start", toDay),
        supabase.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      const setup: FrontendSetup = parseFrontendSetup(
        (settingsRes.data as { frontend_setup?: unknown } | null)?.frontend_setup,
      );
      const workingDaysInWindow = countWorkingDaysInRange(fromDate, toDate, setup);
      const monthlyDivisor = monthlyWorkingDays(setup); // e.g. 6 × 4.345 ≈ 26.07
      // "All time" / no bounds → fallback to a full month allocation so figures
      // make sense (one month's worth of overhead vs all-time revenue is silly,
      // but at least the day shares avoid collapsing to zero).
      const allocationFactor =
        monthlyDivisor > 0
          ? bounds
            ? workingDaysInWindow / monthlyDivisor
            : 1
          : 0;

      // ── Revenue + partner cost from jobs ─────────────────────────────────
      type JobRow = {
        client_price: number | null;
        extras_amount: number | null;
        partner_cost: number | null;
      };
      const jobsData = (jobsRes.data ?? []) as JobRow[];
      const revenue = jobsData.reduce(
        (a, r) => a + (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0),
        0,
      );
      const partnerCost = jobsData.reduce((a, r) => a + (Number(r.partner_cost) || 0), 0);

      // ── Bills: monthly burn of recurring (1 row/series) + one-off in window ──
      type BillRow = {
        id: string;
        amount: number | null;
        is_recurring: boolean | null;
        recurrence_interval: string | null;
        recurring_series_id: string | null;
        status: string | null;
        due_date: string | null;
      };
      const billRows = (billsRes.data ?? []) as BillRow[];
      const recurringActive = billRows.filter((b) => !!b.is_recurring && b.status !== "needs_attention");
      const seriesSeen = new Set<string>();
      let monthlyBurnBills = 0;
      for (const b of recurringActive) {
        const key = b.recurring_series_id?.trim() || b.id;
        if (seriesSeen.has(key)) continue;
        seriesSeen.add(key);
        const factor = MONTHLY_FACTOR[String(b.recurrence_interval ?? "monthly")] ?? 1;
        monthlyBurnBills += (Number(b.amount) || 0) * factor;
      }
      const oneOffBills = billRows
        .filter(
          (b) =>
            !b.is_recurring &&
            b.due_date &&
            b.due_date >= fromDay &&
            b.due_date <= toDay,
        )
        .reduce((a, b) => a + (Number(b.amount) || 0), 0);
      const bills = monthlyBurnBills * allocationFactor + oneOffBills;

      // ── Workforce: monthly payroll burn + ad-hoc self-bills (deduped) ────
      type PayrollRow = { id: string | null; amount: number | null; lifecycle_stage: string | null };
      const payrollRows = (payrollRes.data ?? []) as PayrollRow[];
      const monthlyBurnPayroll = payrollRows.reduce(
        (a, r) => a + (Number(r.amount) || 0),
        0,
      );
      const payrollIds = new Set(
        payrollRows.map((p) => p.id?.trim()).filter((id): id is string => !!id),
      );
      type SelfBillRow = { internal_cost_id: string | null; net_payout: number | null };
      const adhocPayroll = ((internalSbRes.data ?? []) as SelfBillRow[]).reduce((acc, sb) => {
        const linkedId = sb.internal_cost_id?.trim();
        if (linkedId && payrollIds.has(linkedId)) return acc;
        return acc + (Number(sb.net_payout) || 0);
      }, 0);
      const workforce = monthlyBurnPayroll * allocationFactor + adhocPayroll;

      // ── Final ────────────────────────────────────────────────────────────
      const gross = revenue - partnerCost;
      const net = gross - workforce - bills;

      setPnl({
        revenue,
        partnerCost,
        workforce,
        bills,
        gross,
        net,
        jobs: jobsData.length,
        workingDaysInWindow,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const grossPct = pnl.revenue > 0 ? (pnl.gross / pnl.revenue) * 100 : 0;
  const netPct = pnl.revenue > 0 ? (pnl.net / pnl.revenue) * 100 : 0;

  const subtitle = (() => {
    const period = rangeLabel ? `Period: ${rangeLabel}` : "All time";
    if (!bounds) return `${period} · overhead allocated as one month`;
    const d = pnl.workingDaysInWindow;
    return `${period} · ${d} working day${d === 1 ? "" : "s"} · overhead allocated daily`;
  })();

  return (
    <SectionCard
      title="Profit · Gross & Net"
      subtitle={subtitle}
      actions={
        <MicroLabel className="hidden sm:inline-block">
          {loading ? "—" : `${pnl.jobs} job${pnl.jobs === 1 ? "" : "s"}`}
        </MicroLabel>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
        {/* Gross side */}
        <div className="rounded-lg border border-fx-coral/25 bg-gradient-to-b from-card to-fx-coral-50/30 p-4">
          <div className="flex items-start justify-between gap-2">
            <MicroLabel>Gross profit</MicroLabel>
            <span className="font-mono text-[11px] text-fx-coral-p flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {loading ? "—" : `${grossPct.toFixed(1)}%`}
            </span>
          </div>
          <div className="mt-2 text-fx-coral-p font-medium tabular-nums tracking-[-0.02em] leading-[1.1] text-[28px]">
            {loading ? "—" : formatGbp(pnl.gross)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
            <PnlLine label="Revenue" amount={pnl.revenue} loading={loading} sign="+" />
            <PnlLine label="Partner cost" amount={pnl.partnerCost} loading={loading} sign="−" />
          </div>
        </div>

        {/* Arrow connector */}
        <div className="hidden lg:flex flex-col items-center justify-center gap-1 px-1">
          <ArrowDown className="h-4 w-4 text-fx-mute rotate-[-90deg]" />
          <MicroLabel>−Workforce −Bills</MicroLabel>
          <ArrowDown className="h-4 w-4 text-fx-mute rotate-[-90deg]" />
        </div>

        {/* Net side */}
        <div
          className={cn(
            "rounded-lg border p-4",
            pnl.net >= 0
              ? "border-fx-green/30 bg-gradient-to-b from-card to-fx-green-50/40"
              : "border-fx-red/25 bg-gradient-to-b from-card to-fx-red-50/40",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <MicroLabel>Net profit</MicroLabel>
            <span
              className={cn(
                "font-mono text-[11px] flex items-center gap-1",
                pnl.net >= 0 ? "text-fx-green" : "text-fx-red",
              )}
            >
              {loading ? "—" : `${netPct.toFixed(1)}%`}
            </span>
          </div>
          <div
            className={cn(
              "mt-2 font-medium tabular-nums tracking-[-0.02em] leading-[1.1] text-[28px]",
              pnl.net >= 0 ? "text-fx-green" : "text-fx-red",
            )}
          >
            {loading ? "—" : formatGbp(pnl.net)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
            <PnlLine label="Workforce" amount={pnl.workforce} loading={loading} sign="−" />
            <PnlLine label="Bills" amount={pnl.bills} loading={loading} sign="−" />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function PnlLine({
  label,
  amount,
  loading,
  sign,
}: {
  label: string;
  amount: number;
  loading: boolean;
  sign: "+" | "−";
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-1 font-mono text-text-primary tabular-nums">
        <span className={sign === "+" ? "text-fx-green" : "text-fx-red"}>{sign}</span>{" "}
        {loading ? "—" : formatGbp(amount)}
      </div>
    </div>
  );
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
