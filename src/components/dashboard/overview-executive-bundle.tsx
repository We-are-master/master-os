"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { getCompanySettings } from "@/services/company";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { formatCurrency, cn } from "@/lib/utils";
import { jobBillableRevenue, jobDirectCost, jobProfit } from "@/lib/job-financials";
import { listCommissionTiers } from "@/services/tiers";
import type { CommissionTier } from "@/types/database";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Layers, Target, Users, CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { DailyOperationsTable, DailyOperationsTodayTile, useDailyOperations } from "./daily-operations";
import {
  buildWeeklyCashPositionBuckets,
  buildWeeklyJobSoldSeries,
  buildWeeklyOpenInvoiceDueForecast,
  type WeeklyCashPositionRow,
  type WeeklyInvoiceDueForecastRow,
} from "@/lib/dashboard-cashflow-buckets";
import {
  fetchPipelineJobsForDashboard,
  jobExecutionStartYmd,
  defaultMonthlySalesGoalGbp,
  periodSalesGoalGbp,
  resolveMonthlySalesGoalFromCompany,
  type OverviewPipelineJobRow,
} from "@/lib/dashboard-overview-jobs";
import {
  getDashboardSalesGoalMonthlyOverrideGbp,
} from "@/lib/dashboard-sales-goal-preference";
import { dashboardBoundsToInclusiveLocalYmd } from "@/lib/dashboard-date-range";
import {
  localCalendarMonthYmdBounds,
  sumInvoiceOpenBalanceOutstanding,
} from "@/lib/overview-dashboard-kpis";

/** Customer cash in from job ledger (deposit + final), matches Financial summary registrations. */
async function customerPaymentsTotalInRange(
  supabase: ReturnType<typeof getSupabase>,
  fromIso: string,
  toIso: string
): Promise<number> {
  const fromDay = fromIso.slice(0, 10);
  const toDay = toIso.slice(0, 10);
  const { data, error } = await supabase
    .from("job_payments")
    .select("amount")
    .in("type", ["customer_deposit", "customer_final"])
    .is("deleted_at", null)
    .gte("payment_date", fromDay)
    .lte("payment_date", toDay);
  if (error) return 0;
  return (data ?? []).reduce((s, r: { amount?: number }) => s + Number(r.amount ?? 0), 0);
}

function tierProgress(revenue: number, tiers: CommissionTier[]): {
  current: CommissionTier | null;
  next: CommissionTier | null;
  fillPct: number;
} {
  const sorted = [...tiers].sort((a, b) => a.breakeven_amount - b.breakeven_amount);
  if (sorted.length === 0) return { current: null, next: null, fillPct: 0 };
  let current: CommissionTier | null = null;
  for (const t of sorted) {
    if (revenue >= t.breakeven_amount) current = t;
    else break;
  }
  const idx = current ? sorted.findIndex((t) => t.id === current!.id) : -1;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1]! : null;
  const floor = current?.breakeven_amount ?? 0;
  if (!next) {
    const cap = Math.max(revenue * 1.05, sorted[sorted.length - 1]!.breakeven_amount * 1.2, 1);
    return { current, next: null, fillPct: Math.min(100, (revenue / cap) * 100) };
  }
  const span = Math.max(1, next.breakeven_amount - floor);
  const fillPct = Math.max(0, Math.min(100, ((revenue - floor) / span) * 100));
  return { current, next, fillPct };
}

export function OverviewExecutiveBundle() {
  const showInvoiceDueCashForecast = false;
  const { bounds, rangeLabel, preset, customFrom, customTo } = useDashboardDateRange();
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";
  const rangeDepsKey = `${preset}|${customFrom}|${customTo}`;

  const [loading, setLoading] = useState(true);
  const [revenue, setRevenue] = useState(0);
  const [partnerDirect, setPartnerDirect] = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);
  const [billsCost, setBillsCost] = useState(0);
  const [payrollCost, setPayrollCost] = useState(0);

  // Monthly KPI block — always locked to current calendar month, ignores dashboard filter
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [monthlyDirectCost, setMonthlyDirectCost] = useState(0);
  const [monthlyBills, setMonthlyBills] = useState(0);
  const [monthlyPayroll, setMonthlyPayroll] = useState(0);
  const currentMonthLabel = useMemo(() => localCalendarMonthYmdBounds(new Date()).monthLabel, []);
  const dailyOps = useDailyOperations();
  const [billingForTier, setBillingForTier] = useState(0);
  const [tierMonthLabel, setTierMonthLabel] = useState("");
  const [tiers, setTiers] = useState<CommissionTier[]>([]);
  // Top 5 — account owners and Top 5 — accounts cards were hidden. We keep the
  // state wired so the derivation query stays consistent, but the values are
  // unused in the rendered tree. If the cards come back, only JSX changes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [accountOwnerLeaderboard, setAccountOwnerLeaderboard] = useState<
    { ownerProfileId: string | null; displayName: string; revenue: number }[]
  >([]);
  const [topPartners, setTopPartners] = useState<{ name: string; marginContribution: number }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [topAccounts, setTopAccounts] = useState<
    { accountId: string; name: string; revenue: number; ownerName?: string | null }[]
  >([]);
  const [cashflow, setCashflow] = useState<WeeklyCashPositionRow[]>([]);
  const [forecastWeeks, setForecastWeeks] = useState<{ label: string; sold: number }[]>([]);
  const [invoiceDueForecastWeeks, setInvoiceDueForecastWeeks] = useState<WeeklyInvoiceDueForecastRow[]>([]);
  const [funnel, setFunnel] = useState({
    quotesAwaiting: 0,
    quotesAwaitingCount: 0,
    quotesSentInPeriod: 0,
    jobsFromQuotesInPeriod: 0,
    salesJobCount: 0,
    salesBookedValue: 0,
    collectedCash: 0,
    fixedMonthlyOverhead: 0,
    overheadMonthLabel: "",
    outstandingAr: 0,
  });
  const [monthlySalesGoal, setMonthlySalesGoal] = useState(() => defaultMonthlySalesGoalGbp());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const clock = new Date();
        const toIso = clock.toISOString();
        const fromIso = bounds?.fromIso ?? "2000-01-01T00:00:00.000Z";
        const toBound = bounds?.toIso ?? toIso;

        const [companySettings, pipelineRows, tiersList, customerCashTotal, invoicesRes] = await Promise.all([
          getCompanySettings(),
          fetchPipelineJobsForDashboard(
            supabase,
            bounds,
            bounds ? { dateBasis: "schedule_start" } : undefined,
          ),
          listCommissionTiers().catch(() => [] as CommissionTier[]),
          customerPaymentsTotalInRange(supabase, fromIso, toBound),
          supabase
            .from("invoices")
            .select("amount, amount_paid, status, due_date, paid_date, created_at")
            .is("deleted_at", null),
        ]);

        if (cancelled) return;

        /** Match invoice `due_date` civil dates — do not use UTC slice of `bounds` ISO strings. */
        const fromDay = bounds ? dashboardBoundsToInclusiveLocalYmd(bounds).fromDay : fromIso.slice(0, 10);
        const toDay = bounds ? dashboardBoundsToInclusiveLocalYmd(bounds).toDay : toBound.slice(0, 10);
        const monthClock = localCalendarMonthYmdBounds(clock);
        /** Bills/payroll for net margin: dashboard range, or current calendar month when range is “all time”. */
        const overheadFromDay = bounds ? fromDay : monthClock.fromDay;
        const overheadToDay = bounds ? toDay : monthClock.toDay;
        const overheadPeriodLabel = bounds ? rangeLabel : monthClock.monthLabel;

        setMonthlySalesGoal(
          resolveMonthlySalesGoalFromCompany(
            companySettings,
            tiersList,
            null,
            getDashboardSalesGoalMonthlyOverrideGbp(),
          ),
        );

        const invoiceRows = (invoicesRes.error ? [] : invoicesRes.data ?? []) as {
          amount?: number;
          amount_paid?: number;
          status?: string;
          due_date?: string | null;
          paid_date?: string | null;
          created_at?: string | null;
        }[];

        let rev = 0;
        let direct = 0;
        for (const r of pipelineRows) {
          const j = r as Parameters<typeof jobBillableRevenue>[0];
          rev += jobBillableRevenue(j);
          direct += jobDirectCost(r as OverviewPipelineJobRow);
        }
        const gross = rev - direct;
        setRevenue(rev);
        setPartnerDirect(direct);
        setGrossProfit(gross);
        const { fromDay: tierFromDay, toDay: tierToDay, monthLabel: tierLabel } = monthClock;
        const tierPaymentsTotal = await customerPaymentsTotalInRange(
          supabase,
          `${tierFromDay}T00:00:00.000Z`,
          `${tierToDay}T23:59:59.999Z`,
        );
        setBillingForTier(tierPaymentsTotal);
        setTierMonthLabel(tierLabel);
        setTiers(tiersList);

        let billsTotal = 0;
        let payrollTotal = 0;
        try {
          const { data: billRows, error: billErr } = await supabase
            .from("bills")
            .select("amount")
            .is("archived_at", null)
            .neq("status", "rejected")
            .gte("due_date", overheadFromDay)
            .lte("due_date", overheadToDay);
          if (!billErr && billRows) {
            billsTotal = billRows.reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0);
          }
        } catch {
          billsTotal = 0;
        }
        try {
          const { data: payrollRows, error: payErr } = await supabase
            .from("payroll_internal_costs")
            .select("amount")
            .not("due_date", "is", null)
            .gte("due_date", overheadFromDay)
            .lte("due_date", overheadToDay);
          if (!payErr && payrollRows) {
            payrollTotal = payrollRows.reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0);
          }
        } catch {
          payrollTotal = 0;
        }
        setBillsCost(billsTotal);
        setPayrollCost(payrollTotal);

        const partnerMargin = new Map<string, number>();
        for (const r of pipelineRows) {
          const pn = r.partner_name?.trim();
          if (!pn) continue;
          const p = jobProfit(r as Parameters<typeof jobProfit>[0]);
          partnerMargin.set(pn, (partnerMargin.get(pn) ?? 0) + p);
        }
        setTopPartners(
          [...partnerMargin.entries()]
            .map(([name, marginContribution]) => ({ name, marginContribution }))
            .sort((a, b) => b.marginContribution - a.marginContribution)
            .slice(0, 5),
        );

        const clientTotals = new Map<string, number>();
        for (const r of pipelineRows) {
          const cid = r.client_id?.trim();
          if (!cid) continue;
          clientTotals.set(cid, (clientTotals.get(cid) ?? 0) + jobBillableRevenue(r as Parameters<typeof jobBillableRevenue>[0]));
        }
        const clientIds = [...clientTotals.keys()];
        let accountsOut: { accountId: string; name: string; revenue: number; ownerName?: string | null }[] = [];
        let ownersOut: { ownerProfileId: string | null; displayName: string; revenue: number }[] = [];

        if (clientIds.length > 0) {
          const { data: clientsAfter } = await supabase
            .from("clients")
            .select("id, source_account_id")
            .in("id", clientIds);
          const accByClient = new Map<string, string | null>();
          const accIds = new Set<string>();
          for (const c of clientsAfter ?? []) {
            const id = (c as { id: string }).id;
            const aid = (c as { source_account_id?: string | null }).source_account_id ?? null;
            accByClient.set(id, aid);
            if (aid) accIds.add(aid);
          }

          const accMetaById = new Map<
            string,
            { company_name: string; account_owner_id: string | null }
          >();
          if (accIds.size > 0) {
            const { data: accs } = await supabase
              .from("accounts")
              .select("id, company_name, account_owner_id")
              .in("id", [...accIds])
              .is("deleted_at", null);
            for (const a of accs ?? []) {
              const id = (a as { id: string }).id;
              const oid = (a as { account_owner_id?: string | null }).account_owner_id;
              const account_owner_id =
                oid != null && String(oid).trim() !== "" ? String(oid).trim() : null;
              accMetaById.set(id, {
                company_name: String((a as { company_name?: string }).company_name ?? "Account"),
                account_owner_id,
              });
            }
          }

          const profileIds = new Set<string>();
          for (const m of accMetaById.values()) {
            if (m.account_owner_id) profileIds.add(m.account_owner_id);
          }
          const profileNames = new Map<string, string>();
          if (profileIds.size > 0) {
            const { data: profs } = await supabase
              .from("profiles")
              .select("id, full_name, email")
              .in("id", [...profileIds]);
            for (const p of profs ?? []) {
              const pid = (p as { id: string }).id;
              const nm = String((p as { full_name?: string | null }).full_name?.trim() || "").trim();
              const em = String((p as { email?: string | null }).email?.trim() || "").trim();
              profileNames.set(pid, nm || em || "User");
            }
          }

          const byAccountId = new Map<
            string,
            { revenue: number; companyName: string; ownerName: string | null; accountOwnerId: string | null }
          >();
          let orphanRevenue = 0;
          for (const [cid, amt] of clientTotals) {
            const aid = accByClient.get(cid);
            if (aid && accMetaById.has(aid)) {
              const meta = accMetaById.get(aid)!;
              const cur =
                byAccountId.get(aid) ?? {
                  revenue: 0,
                  companyName: meta.company_name,
                  ownerName:
                    meta.account_owner_id != null ? profileNames.get(meta.account_owner_id) ?? null : null,
                  accountOwnerId: meta.account_owner_id,
                };
              cur.revenue += amt;
              byAccountId.set(aid, cur);
            } else {
              orphanRevenue += amt;
            }
          }

          const ownerAgg = new Map<string, number>();
          for (const row of byAccountId.values()) {
            const key = row.accountOwnerId ?? "__unassigned__";
            ownerAgg.set(key, (ownerAgg.get(key) ?? 0) + row.revenue);
          }
          ownersOut = [...ownerAgg.entries()]
            .map(([key, revenue]) => ({
              ownerProfileId: key === "__unassigned__" ? null : key,
              displayName:
                key === "__unassigned__"
                  ? "Unassigned"
                  : (profileNames.get(key) ?? "User"),
              revenue,
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

          accountsOut = [...byAccountId.entries()].map(([accountId, v]) => ({
            accountId,
            name: v.companyName,
            revenue: v.revenue,
            ownerName: v.ownerName,
          }));
          if (orphanRevenue > 0.02) {
            accountsOut.push({
              accountId: "orphan",
              name: "Clients still without account",
              revenue: orphanRevenue,
              ownerName: null,
            });
          }
          accountsOut = accountsOut.sort((a, b) => b.revenue - a.revenue).slice(0, 5);
        }
        setAccountOwnerLeaderboard(ownersOut);
        setTopAccounts(accountsOut);

        const quotesQuery = supabase
          .from("quotes")
          .select("total_value")
          .eq("status", "awaiting_customer")
          .is("deleted_at", null);
        const quotesCountQuery = supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .eq("status", "awaiting_customer")
          .is("deleted_at", null);

        const jobsFromQuotesInPeriod = pipelineRows.filter((r) => {
          const qid = (r as OverviewPipelineJobRow & { quote_id?: string | null }).quote_id;
          return Boolean(qid != null && String(qid).trim() !== "");
        }).length;

        async function quotesSentInSelectedPeriod(): Promise<number> {
          if (!bounds) {
            const pdfAll = await supabase.from("quotes").select("id").not("customer_pdf_sent_at", "is", null);
            if (pdfAll.error) {
              const leg = await supabase
                .from("quotes")
                .select("id")
                .in("status", ["awaiting_customer", "accepted"]);
              return (leg.data ?? []).length;
            }
            const fbAll = await supabase
              .from("quotes")
              .select("id")
              .is("customer_pdf_sent_at", null)
              .in("status", ["awaiting_customer", "accepted"]);
            return (pdfAll.data ?? []).length + (fbAll.error ? 0 : (fbAll.data ?? []).length);
          }
          const pdf = await supabase
            .from("quotes")
            .select("id")
            .not("customer_pdf_sent_at", "is", null)
            .gte("customer_pdf_sent_at", bounds.fromIso)
            .lte("customer_pdf_sent_at", bounds.toIso);
          if (pdf.error) {
            const leg = await supabase
              .from("quotes")
              .select("id")
              .in("status", ["awaiting_customer", "accepted"])
              .gte("created_at", bounds.fromIso)
              .lte("created_at", bounds.toIso);
            return (leg.data ?? []).length;
          }
          const fb = await supabase
            .from("quotes")
            .select("id")
            .is("customer_pdf_sent_at", null)
            .in("status", ["awaiting_customer", "accepted"])
            .gte("created_at", bounds.fromIso)
            .lte("created_at", bounds.toIso);
          return (pdf.data ?? []).length + (fb.error ? 0 : (fb.data ?? []).length);
        }

        const quotesSentCount = await quotesSentInSelectedPeriod();
        const [customerCashRes, sbOutstandingRes, billsOutstandingRes, quotesAwaitingRes, quotesAwaitingCountRes, payrollPendingRes] =
          await Promise.all([
          supabase
            .from("job_payments")
            .select("amount, payment_date")
            .in("type", ["customer_deposit", "customer_final"])
            .is("deleted_at", null)
            .gte("payment_date", fromDay)
            .lte("payment_date", toDay),
          supabase
            .from("self_bills")
            .select("net_payout, week_start, created_at")
            .in("status", ["awaiting_payment", "ready_to_pay"]),
          supabase
            .from("bills")
            .select("amount, due_date")
            .in("status", ["submitted", "approved", "needs_attention"])
            .is("archived_at", null)
            .gte("due_date", fromDay)
            .lte("due_date", toDay),
            quotesQuery,
            quotesCountQuery,
            supabase
              .from("payroll_internal_costs")
              .select("amount, due_date")
              .eq("status", "pending")
              .not("due_date", "is", null)
              .gte("due_date", fromDay)
              .lte("due_date", toDay),
          ]);
        const customerCashRows = (customerCashRes.data ?? []) as { amount?: number; payment_date?: string }[];
        const sbOutstanding = (sbOutstandingRes.data ?? []) as {
          net_payout?: number;
          week_start?: string | null;
          created_at?: string;
        }[];
        const billsOutstanding = (billsOutstandingRes.error ? [] : billsOutstandingRes.data ?? []) as {
          amount?: number;
          due_date?: string;
        }[];
        const quotesAwaitingSum = (quotesAwaitingRes.data ?? []).reduce(
          (s, r) => s + Number((r as { total_value?: number }).total_value ?? 0),
          0,
        );
        const quotesAwaitingCount = quotesAwaitingCountRes.count ?? 0;

        const fixedMonthlyOverhead = billsTotal + payrollTotal;
        const outstandingAr = sumInvoiceOpenBalanceOutstanding(invoiceRows);

        setFunnel({
          quotesAwaiting: quotesAwaitingSum,
          quotesAwaitingCount,
          quotesSentInPeriod: quotesSentCount,
          jobsFromQuotesInPeriod,
          salesJobCount: pipelineRows.length,
          salesBookedValue: rev,
          collectedCash: customerCashTotal,
          fixedMonthlyOverhead,
          overheadMonthLabel: overheadPeriodLabel,
          outstandingAr,
        });

        const forecastToIso = toBound;
        let forecastFromIso = fromIso;
        if (bounds) {
          const days = Math.max(
            1,
            Math.round(
              (new Date(bounds.toIso).getTime() - new Date(bounds.fromIso).getTime()) / 86400000,
            ) + 1,
          );
          if (days > 400) {
            const cap = new Date(bounds.toIso);
            cap.setDate(cap.getDate() - 52 * 7);
            forecastFromIso = cap.toISOString();
          }
        } else {
          const cap = new Date();
          cap.setDate(cap.getDate() - 12 * 7);
          forecastFromIso = cap.toISOString();
        }
        setForecastWeeks(
          buildWeeklyJobSoldSeries(
            pipelineRows,
            (row) => jobBillableRevenue(row as Parameters<typeof jobBillableRevenue>[0]),
            forecastFromIso,
            forecastToIso,
            (row) => jobExecutionStartYmd(row as OverviewPipelineJobRow),
          ),
        );

        /**
         * Invoice due forecast is always anchored to "now" so it behaves like a
         * cash-flow planner: show the last 3 weeks (context — what's already overdue /
         * collected into the bucket) plus 7 weeks forward = 10-week rolling window.
         * Ignoring the dashboard bounds deliberately — this widget is about the
         * near-term cash horizon, not the audit date range.
         */
        const forecastAnchor = new Date();
        const forecastStart = new Date(forecastAnchor.getTime() - 3 * 7 * 86400000);
        const forecastEnd = new Date(forecastAnchor.getTime() + 7 * 7 * 86400000);
        const invForecastFromIso = forecastStart.toISOString();
        const invForecastToIso = forecastEnd.toISOString();
        setInvoiceDueForecastWeeks(buildWeeklyOpenInvoiceDueForecast(invoiceRows, invForecastFromIso, invForecastToIso));

        const payrollOutstanding = (payrollPendingRes.error ? [] : payrollPendingRes.data ?? []) as {
          amount?: number;
          due_date?: string;
        }[];

        const buckets = buildWeeklyCashPositionBuckets(
          fromIso,
          toBound,
          customerCashRows,
          sbOutstanding,
          billsOutstanding,
          payrollOutstanding,
        );
        setCashflow(buckets);
      } catch {
        if (!cancelled) {
          setRevenue(0);
          setPartnerDirect(0);
          setGrossProfit(0);
          setBillsCost(0);
          setPayrollCost(0);
          setBillingForTier(0);
          setTierMonthLabel("");
          setAccountOwnerLeaderboard([]);
          setTopPartners([]);
          setTopAccounts([]);
          setCashflow([]);
          setForecastWeeks([]);
          setInvoiceDueForecastWeeks([]);
          setFunnel({
            quotesAwaiting: 0,
            quotesAwaitingCount: 0,
            quotesSentInPeriod: 0,
            jobsFromQuotesInPeriod: 0,
            salesJobCount: 0,
            salesBookedValue: 0,
            collectedCash: 0,
            fixedMonthlyOverhead: 0,
            overheadMonthLabel: "",
            outstandingAr: 0,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [boundsKey, rangeDepsKey]);

  useEffect(() => {
    function refreshGoal() {
      void Promise.all([getCompanySettings(), listCommissionTiers().catch(() => [] as CommissionTier[])]).then(([s, t]) => {
        setMonthlySalesGoal(
          resolveMonthlySalesGoalFromCompany(
            s,
            t,
            null,
            getDashboardSalesGoalMonthlyOverrideGbp(),
          ),
        );
      });
    }
    window.addEventListener("master-os-company-settings", refreshGoal);
    return () => window.removeEventListener("master-os-company-settings", refreshGoal);
  }, []);

  // Load current-month data independently of the dashboard date filter
  useEffect(() => {
    let cancelled = false;
    async function loadMonthly() {
      const supabase = getSupabase();
      setMonthlyLoading(true);
      try {
        const { fromDay, toDay } = localCalendarMonthYmdBounds(new Date());
        const monthBounds = {
          fromIso: `${fromDay}T00:00:00.000Z`,
          toIso: `${toDay}T23:59:59.999Z`,
        };
        const MONTHLY_STATUSES = [
          "unassigned", "auto_assigning", "scheduled", "late",
          "in_progress_phase1", "in_progress_phase2", "in_progress_phase3",
          "final_check", "awaiting_payment", "need_attention", "completed",
        ];
        const jobsRes = await supabase
          .from("jobs")
          .select("id, client_price, extras_amount, partner_cost, materials_cost, scheduled_date, scheduled_finish_date")
          .is("deleted_at", null)
          .in("status", MONTHLY_STATUSES)
          .gte("scheduled_date", fromDay)
          .lte("scheduled_date", toDay);
        const rows = (jobsRes.data ?? []) as OverviewPipelineJobRow[];
        const [, billsRes, payrollRes] = await Promise.all([
          Promise.resolve(),
          supabase.from("bills").select("amount").is("archived_at", null).neq("status", "rejected")
            .gte("due_date", fromDay).lte("due_date", toDay),
          supabase.from("payroll_internal_costs").select("amount").not("due_date", "is", null)
            .gte("due_date", fromDay).lte("due_date", toDay),
        ]);
        let rev = 0;
        let direct = 0;
        for (const r of rows) {
          rev += jobBillableRevenue(r as Parameters<typeof jobBillableRevenue>[0]);
          direct += jobDirectCost(r as OverviewPipelineJobRow);
        }
        const bills = (billsRes.data ?? []).reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0);
        const payroll = (payrollRes.data ?? []).reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0);
        if (!cancelled) {
          setMonthlyRevenue(rev);
          setMonthlyDirectCost(direct);
          setMonthlyBills(bills);
          setMonthlyPayroll(payroll);
        }
      } catch {
        if (!cancelled) {
          setMonthlyRevenue(0);
          setMonthlyDirectCost(0);
          setMonthlyBills(0);
          setMonthlyPayroll(0);
        }
      } finally {
        if (!cancelled) setMonthlyLoading(false);
      }
    }
    void loadMonthly();
    return () => { cancelled = true; };
  }, []);

  const monthlyGross = monthlyRevenue - monthlyDirectCost;
  const monthlyNet = monthlyRevenue - monthlyDirectCost - monthlyBills - monthlyPayroll;
  const monthlyGrossPct = monthlyRevenue > 0 ? Math.round((monthlyGross / monthlyRevenue) * 1000) / 10 : 0;
  const monthlyNetPct = monthlyRevenue > 0 ? Math.round((monthlyNet / monthlyRevenue) * 1000) / 10 : 0;

  const revenuePeriodSubtext = useMemo(() => {
    if (!bounds) return "Booked pipeline · no date filter (all open pipeline jobs)";
    return `Booked pipeline · schedule start in ${rangeLabel} (same filter as Jobs → schedule window)`;
  }, [bounds, rangeLabel]);

  const salesGoalTargetGbp = useMemo(() => {
    if (!monthlySalesGoal || monthlySalesGoal <= 0) return null;
    if (bounds) return periodSalesGoalGbp(bounds, monthlySalesGoal);
    return monthlySalesGoal;
  }, [bounds, monthlySalesGoal]);

  /** Pipeline revenue minus direct job cost, company bills (due in range), and payroll internal lines (due in range). */
  const netProfit = grossProfit - billsCost - payrollCost;
  const grossPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
  const netPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;
  const cashflowTotals = cashflow.reduce(
    (acc, b) => ({
      collected: acc.collected + b.collected,
      partnerToPay: acc.partnerToPay + b.partnerToPay,
      billsToPay: acc.billsToPay + b.billsToPay,
      workforceToPay: acc.workforceToPay + b.workforceToPay,
      net: acc.net + b.net,
    }),
    { collected: 0, partnerToPay: 0, billsToPay: 0, workforceToPay: 0, net: 0 },
  );
  const periodAllInCosts = partnerDirect + billsCost + payrollCost;

  const cashflowLegend = useMemo(
    () => [
      { key: "in", label: "Cash in", color: "#22c55e" },
      { key: "bills", label: "Bills", color: "#a855f7" },
      { key: "partners", label: "Partners", color: "#eab308" },
      { key: "workforce", label: "Workforce", color: "#fb7185" },
    ],
    [],
  );
  const { current, next, fillPct } = tierProgress(billingForTier, tiers);

  const goalVsTargetPct =
    salesGoalTargetGbp != null && salesGoalTargetGbp > 0
      ? Math.min(100, (revenue / salesGoalTargetGbp) * 100)
      : 0;

  const topWeeksByRevenue = useMemo(
    () => [...forecastWeeks].sort((a, b) => b.sold - a.sold).slice(0, 5),
    [forecastWeeks],
  );

  const rankBadgeClass = (i: number) =>
    cn(
      "h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0",
      i === 0
        ? "bg-amber-100 text-amber-800"
        : i === 1
          ? "bg-slate-100 text-slate-600"
          : i === 2
            ? "bg-orange-100 text-orange-800"
            : i === 3
              ? "bg-violet-100 text-violet-700"
              : "bg-surface-hover text-text-tertiary",
    );

  return (
    <div className="space-y-4">
      <Card padding="none" className="overflow-hidden border-border-light bg-[#FAFAFB] shadow-sm ring-1 ring-border-light/20">
        {/* Header — always locked to current month */}
        <div className="px-4 py-2.5 border-b border-border-light flex items-center justify-between gap-2 bg-[#FAFAFB]">
          <p className="text-xs font-bold text-text-primary tracking-tight">
            Monthly Overview — <span className="text-primary">{currentMonthLabel}</span>
          </p>
          <p className="text-[10px] text-text-tertiary">Always locked to current calendar month</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border-light border-b border-border-light">
          {[
            {
              label: "Revenue",
              value: monthlyRevenue,
              sub: `Jobs scheduled in ${currentMonthLabel}`,
              accent: "text-emerald-600",
            },
            {
              label: "Costs",
              value: monthlyDirectCost,
              sub: "Direct cost on those jobs",
              accent: "text-amber-600",
            },
            {
              label: "Gross margin",
              value: monthlyGross,
              sub: `${monthlyGrossPct}% of revenue`,
              accent: monthlyGrossPct >= 20 ? "text-emerald-600" : "text-rose-600",
            },
            {
              label: "Net margin",
              value: monthlyNet,
              sub: `${monthlyNetPct}% · after bills & payroll`,
              accent: monthlyNetPct >= 0 ? "text-sky-600" : "text-rose-600",
            },
          ].map((cell) => (
            <div key={cell.label} className="p-3 sm:p-4">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{cell.label}</p>
                <FixfyHintIcon text={cell.sub} />
              </div>
              <p className={cn("text-lg sm:text-xl font-bold tabular-nums mt-0.5", cell.accent)}>
                {monthlyLoading ? "—" : formatCurrency(cell.value)}
              </p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-border-light sm:divide-x">
          <div className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide leading-tight">
                Quotes awaiting customer
              </p>
              <FixfyHintIcon text={loading ? "Awaiting customer response" : `${funnel.quotesAwaitingCount} open (not accepted)`} />
            </div>
            <p className={cn("text-lg sm:text-xl font-bold tabular-nums mt-0.5", "text-sky-600")}>
              {loading ? "—" : formatCurrency(funnel.quotesAwaiting)}
            </p>
          </div>
          <div className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide leading-tight">
                Workforce cost
              </p>
              <FixfyHintIcon text={`Internal payroll · ${currentMonthLabel}`} />
            </div>
            <p className={cn("text-lg sm:text-xl font-bold tabular-nums mt-0.5", "text-orange-600")}>
              {monthlyLoading ? "—" : formatCurrency(monthlyPayroll)}
            </p>
          </div>
          <div className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide leading-tight">
                Total bills
              </p>
              <FixfyHintIcon text={`Supplier bills · ${currentMonthLabel}`} />
            </div>
            <p className={cn("text-lg sm:text-xl font-bold tabular-nums mt-0.5", "text-rose-600")}>
              {monthlyLoading ? "—" : formatCurrency(monthlyBills)}
            </p>
          </div>
          <div className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide leading-tight">
                Total overhead
              </p>
              <FixfyHintIcon text={`Workforce + bills · ${currentMonthLabel}`} />
            </div>
            <p className={cn("text-lg sm:text-xl font-bold tabular-nums mt-0.5", "text-purple-600")}>
              {monthlyLoading ? "—" : formatCurrency(monthlyPayroll + monthlyBills)}
            </p>
          </div>
        </div>
      </Card>

      {showInvoiceDueCashForecast ? <Card padding="none" className="overflow-hidden border-border-light">
        <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-border-light/70">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
              <Target className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-primary">Sales goal</p>
              <p className="text-[10px] text-text-tertiary truncate">
                {bounds && salesGoalTargetGbp != null ? (
                  <>
                    Target {formatCurrency(salesGoalTargetGbp)} ({formatCurrency(monthlySalesGoal)}/mo scaled to range)
                  </>
                ) : (
                  <>Baseline {formatCurrency(monthlySalesGoal)} · compares to Revenue above</>
                )}
              </p>
            </div>
          </div>
          {!loading && (
            <span className="text-xs font-bold tabular-nums text-text-primary">
              {salesGoalTargetGbp != null && salesGoalTargetGbp > 0 ? `${Math.round(goalVsTargetPct)}%` : "—"}
            </span>
          )}
        </div>
        <div className="px-4 pb-2.5 pt-2">
          {loading ? (
            <div className="h-2 animate-pulse rounded-full bg-surface-hover" />
          ) : salesGoalTargetGbp != null && salesGoalTargetGbp > 0 ? (
            <div className="h-2 rounded-full overflow-hidden bg-surface-hover ring-1 ring-inset ring-border-light/50">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
                style={{ width: `${goalVsTargetPct}%` }}
              />
            </div>
          ) : (
            <p className="text-[10px] text-text-tertiary">Set a monthly sales goal in Settings.</p>
          )}
        </div>
      </Card> : null}

      {/* Today snapshot — full month breakdown below, collapsed by default */}
      <DailyOperationsTodayTile data={dailyOps} />
      <DailyOperationsDetails data={dailyOps} />

      <Card padding="none" className="overflow-hidden border-border-light">
        <CardHeader className="px-4 pt-3 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 flex items-center justify-center shrink-0">
              <Layers className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Tier vs Revenue</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Customer payments (job ledger) in <strong className="text-text-secondary">{tierMonthLabel || "this month"}</strong> — ignores dashboard date filter
              </p>
            </div>
          </div>
        </CardHeader>
        <div className="px-4 pb-4 space-y-2">
          {loading ? (
            <div className="h-12 animate-pulse rounded-lg bg-surface-hover" />
          ) : tiers.length === 0 ? (
            <p className="text-xs text-text-tertiary">Configure commission tiers in Settings to track progress here.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-base font-bold text-text-primary tabular-nums">{formatCurrency(billingForTier)}</span>
                  <span className="text-xs text-text-tertiary">collected this month</span>
                  {current && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">
                      Tier {current.tier_number} · {current.rate_percent}%
                    </span>
                  )}
                </div>
                {next && (
                  <span className="text-[10px] text-text-tertiary">
                    Next breakeven <strong className="text-text-secondary">{formatCurrency(next.breakeven_amount)}</strong>
                  </span>
                )}
              </div>
              <div className="h-2 rounded-full overflow-hidden bg-surface-hover ring-1 ring-inset ring-border-light/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 transition-all duration-500"
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden border-border-light">
        <CardHeader className="px-4 pt-3 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-teal-500/20 to-cyan-500/10 flex items-center justify-center shrink-0">
              <CalendarDays className="h-3.5 w-3.5 text-teal-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Invoice due — cash forecast</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Open invoice balance by <strong className="text-text-secondary">week of due date</strong> (uses invoice{" "}
                <strong className="text-text-secondary">created</strong> when due is missing) · rolling 10-week window
              </p>
            </div>
          </div>
        </CardHeader>
        <div className="px-2 sm:px-3 pb-4">
          {loading ? (
            <div className="h-48 animate-pulse rounded-xl bg-surface-hover" />
          ) : invoiceDueForecastWeeks.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-text-tertiary">No open invoices in range</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={invoiceDueForecastWeeks} margin={{ top: 8, right: 8, left: 4, bottom: 8 }} barCategoryGap="16%">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border-light/50" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "var(--color-text-tertiary)" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  height={48}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(0)}k` : `£${v}`)}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]!.payload as WeeklyInvoiceDueForecastRow;
                    return (
                      <div
                        className="rounded-lg border border-border-light px-3 py-2 text-xs shadow-md"
                        style={{ background: "var(--color-card)" }}
                      >
                        <p className="font-semibold text-text-primary mb-1">{String(label)}</p>
                        <p className="font-bold tabular-nums text-teal-600">Due {formatCurrency(row.dueOpen)}</p>
                        <p className="text-[10px] text-text-tertiary mt-1">Open balance attributed to this week</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="dueOpen" name="Open due" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="none" className="border-border-light h-full flex flex-col min-h-0">
          <CardHeader className="px-3 pt-3 pb-1.5 flex flex-row items-center justify-between shrink-0 mb-0">
            <div>
              <CardTitle className="text-sm font-semibold">Top 5 — partners</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Gross margin · same booked jobs as Revenue
              </p>
            </div>
            <Users className="h-3.5 w-3.5 text-text-tertiary" />
          </CardHeader>
          <div className="px-3 pb-3 space-y-1 flex-1 min-h-0">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-md bg-surface-hover" />)
            ) : topPartners.length === 0 ? (
              <p className="text-xs text-text-tertiary py-3 text-center">No partner-attributed jobs</p>
            ) : (
              topPartners.map((row, i) => (
                <div key={row.name} className="flex items-center gap-2 py-1.5 border-b border-border-light/50 last:border-0">
                  <span className={rankBadgeClass(i)}>{i + 1}</span>
                  <p className="text-xs font-medium text-text-primary truncate flex-1">{row.name}</p>
                  <p className="text-xs font-bold tabular-nums text-text-primary shrink-0">
                    {formatCurrency(row.marginContribution)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card padding="none" className="border-border-light h-full flex flex-col min-h-0">
          <CardHeader className="px-3 pt-3 pb-1.5 flex flex-row items-center justify-between shrink-0 mb-0">
            <div>
              <CardTitle className="text-sm font-semibold">Top 5 — weeks</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                {revenuePeriodSubtext} · by execution-start week
              </p>
            </div>
            <CalendarDays className="h-3.5 w-3.5 text-text-tertiary" />
          </CardHeader>
          <div className="px-3 pb-3 space-y-1 flex-1 min-h-0">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-md bg-surface-hover" />)
            ) : topWeeksByRevenue.length === 0 ? (
              <p className="text-xs text-text-tertiary py-3 text-center">No weeks in range</p>
            ) : (
              topWeeksByRevenue.map((row, i) => (
                <div key={row.label} className="flex items-center gap-2 py-1.5 border-b border-border-light/50 last:border-0">
                  <span className={rankBadgeClass(i)}>{i + 1}</span>
                  <p className="text-xs font-medium text-text-primary truncate flex-1">{row.label}</p>
                  <p className="text-xs font-bold tabular-nums text-text-primary shrink-0">{formatCurrency(row.sold)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card padding="none" className="border-border-light ring-1 ring-border-light/20 overflow-hidden">
        <CardHeader className="px-4 pt-3 pb-2 border-b border-border-light/60 bg-gradient-to-r from-cyan-500/5 to-violet-500/5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">Cash flow</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5 max-w-xl">
                One column per week: <strong className="text-text-secondary">stacked</strong> cash in (green), bills (violet), partners
                (amber), workforce (rose). Heights are each line’s amount for that week;{" "}
                <strong className="text-text-secondary">net</strong> = in − partners − bills − workforce (see tooltip).
              </p>
            </div>
            {!loading && cashflow.length > 0 && (
              <span
                className={cn(
                  "text-xs font-bold tabular-nums px-2 py-0.5 rounded-md self-start",
                  cashflowTotals.net >= 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                )}
              >
                Period net {formatCurrency(cashflowTotals.net)}
              </span>
            )}
          </div>
        </CardHeader>
        <div className="px-3 sm:px-4 pb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border-light/50">
          {cashflowLegend.map((item) => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: item.color }} aria-hidden />
              <span className="text-[10px] font-medium text-text-secondary">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="px-2 sm:px-3 py-2">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-lg overflow-hidden border border-border-light/70 bg-border-light/50 mb-2">
            {[
              {
                k: "sales",
                label: "Sales (booked)",
                main: loading ? "—" : formatCurrency(funnel.salesBookedValue),
                sub: loading ? "—" : `${funnel.salesJobCount} jobs`,
                accent: "text-emerald-600",
              },
              {
                k: "rev",
                label: "Revenue",
                main: loading ? "—" : formatCurrency(revenue),
                sub: loading ? "—" : revenuePeriodSubtext,
                accent: "text-emerald-700 dark:text-emerald-400",
              },
              {
                k: "costs",
                label: "Projected costs",
                main: loading ? "—" : formatCurrency(periodAllInCosts),
                sub: "Direct + bills + payroll · period",
                accent: "text-amber-600",
              },
              {
                k: "net",
                label: "Period net (cash)",
                main: loading ? "—" : formatCurrency(cashflowTotals.net),
                sub: loading
                  ? "—"
                  : `Σ weekly net · open AR ${formatCurrency(funnel.outstandingAr)}`,
                accent: cashflowTotals.net >= 0 ? "text-emerald-600" : "text-rose-600",
              },
            ].map((cell) => (
              <div key={cell.k} className="bg-card px-2.5 py-2 min-w-0">
                <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide truncate">{cell.label}</p>
                <p className={cn("text-sm font-bold tabular-nums leading-tight mt-0.5 truncate", cell.accent)}>{cell.main}</p>
                <p className="text-[9px] text-text-tertiary leading-snug mt-0.5 line-clamp-2">{cell.sub}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="px-2 sm:px-3 pb-4 pt-0">
          {loading ? (
            <div className="h-56 animate-pulse rounded-xl bg-surface-hover" />
          ) : cashflow.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-text-tertiary">No data in range</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={cashflow} margin={{ top: 8, right: 8, left: 4, bottom: 8 }} barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border-light/50" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "var(--color-text-tertiary)" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  height={48}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(0)}k` : `£${v}`)}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const w = payload[0]!.payload as WeeklyCashPositionRow;
                    return (
                      <div
                        className="rounded-lg border border-border-light px-3 py-2 text-xs shadow-md"
                        style={{ background: "var(--color-card)" }}
                      >
                        <p className="font-semibold text-text-primary mb-1">{String(label)}</p>
                        <p className={cn("font-bold tabular-nums", w.net >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          Net {formatCurrency(w.net)}
                        </p>
                        <p className="text-[10px] text-text-tertiary mt-1 space-y-0.5">
                          <span className="block">Cash in {formatCurrency(w.collected)}</span>
                          <span className="block">Bills {formatCurrency(w.billsToPay)}</span>
                          <span className="block">Partners {formatCurrency(w.partnerToPay)}</span>
                          <span className="block">Workforce {formatCurrency(w.workforceToPay)}</span>
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="collected" name="Cash in" stackId="cf" fill="#22c55e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="billsToPay" name="Bills" stackId="cf" fill="#a855f7" />
                <Bar dataKey="partnerToPay" name="Partners" stackId="cf" fill="#eab308" />
                <Bar dataKey="workforceToPay" name="Workforce" stackId="cf" fill="#fb7185" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * Collapsible wrapper under the Today tile: the full Mon–Sat table lives behind
 * a disclosure toggle so the overview stays scannable by default, and finance
 * can drill into the day-by-day breakdown without leaving the page.
 */
function DailyOperationsDetails({ data }: { data: ReturnType<typeof useDailyOperations> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? "Hide daily breakdown" : "Show daily breakdown"}
        <span className="ml-1 text-[10px] font-normal text-text-tertiary">
          Mon–Sat · {data.monthLabel}
        </span>
      </button>
      {open ? <DailyOperationsTable data={data} summaryPlacement="top" /> : null}
    </div>
  );
}
