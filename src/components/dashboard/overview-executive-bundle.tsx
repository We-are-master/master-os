"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { formatCurrency, cn } from "@/lib/utils";
import { jobBillableRevenue, jobDirectCost } from "@/lib/job-financials";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { listCommissionTiers } from "@/services/tiers";
import type { CommissionTier } from "@/types/database";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, Star, Building2, Layers } from "lucide-react";
import { BestSellersByOwner } from "@/components/dashboard/best-sellers-by-owner";

type JobRow = {
  id: string;
  client_id?: string | null;
  partner_name?: string | null;
  client_price: number;
  extras_amount?: number | null;
  partner_cost: number;
  materials_cost: number;
  commission?: number | null;
};

async function fetchSalesJobRows(
  supabase: ReturnType<typeof getSupabase>,
  fromIso: string,
  toIso: string,
): Promise<JobRow[]> {
  const selFull = "id, client_id, partner_name, client_price, extras_amount, partner_cost, materials_cost, commission";
  const selLegacy = "id, client_id, partner_name, client_price, partner_cost, materials_cost, commission";

  async function loadCompletedPaid(selectCols: string) {
    return supabase
      .from("jobs")
      .select(selectCols)
      .eq("status", "completed")
      .eq("finance_status", "paid")
      .not("completed_date", "is", null)
      .gte("completed_date", fromIso)
      .lte("completed_date", toIso);
  }

  let completedRes = await loadCompletedPaid(selFull);
  let err = completedRes.error;
  let completedRows = (completedRes.data ?? []) as unknown as JobRow[];
  if (err && isPostgrestWriteRetryableError(err)) {
    completedRes = await loadCompletedPaid(selLegacy);
    completedRows = (completedRes.data ?? []) as unknown as JobRow[];
  }

  const rows = [...completedRows];
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

async function paidInvoiceTotal(supabase: ReturnType<typeof getSupabase>, fromIso: string, toIso: string): Promise<number> {
  const fromDay = fromIso.slice(0, 10);
  const toDay = toIso.slice(0, 10);
  const { data, error } = await supabase
    .from("invoices")
    .select("amount, paid_date")
    .eq("status", "paid")
    .gte("paid_date", fromDay)
    .lte("paid_date", toDay);
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

interface CashBucket {
  label: string;
  collected: number;
  partnerPayouts: number;
  bills: number;
  net: number;
}

export function OverviewExecutiveBundle() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";

  const [loading, setLoading] = useState(true);
  const [revenue, setRevenue] = useState(0);
  const [partnerDirect, setPartnerDirect] = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);
  const [commission, setCommission] = useState(0);
  const [billingForTier, setBillingForTier] = useState(0);
  const [tiers, setTiers] = useState<CommissionTier[]>([]);
  const [topPartner, setTopPartner] = useState<{ name: string; revenue: number } | null>(null);
  const [topAccounts, setTopAccounts] = useState<{ name: string; revenue: number }[]>([]);
  const [cashflow, setCashflow] = useState<CashBucket[]>([]);

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

        const [jobRows, tiersList, invTotal] = await Promise.all([
          fetchSalesJobRows(supabase, fromIso, toBound),
          listCommissionTiers().catch(() => [] as CommissionTier[]),
          paidInvoiceTotal(supabase, fromIso, toBound),
        ]);

        if (cancelled) return;

        let rev = 0;
        let direct = 0;
        let comm = 0;
        for (const r of jobRows) {
          const j = r as Parameters<typeof jobBillableRevenue>[0];
          rev += jobBillableRevenue(j);
          direct += jobDirectCost(r);
          comm += Number(r.commission ?? 0);
        }
        const gross = rev - direct;
        setRevenue(rev);
        setPartnerDirect(direct);
        setGrossProfit(gross);
        setCommission(comm);
        setBillingForTier(invTotal);
        setTiers(tiersList);

        const partnerMap = new Map<string, number>();
        for (const r of jobRows) {
          const n = r.partner_name?.trim();
          if (!n) continue;
          partnerMap.set(n, (partnerMap.get(n) ?? 0) + jobBillableRevenue(r as Parameters<typeof jobBillableRevenue>[0]));
        }
        const topP = [...partnerMap.entries()].sort((a, b) => b[1] - a[1])[0];
        setTopPartner(topP ? { name: topP[0], revenue: topP[1] } : null);

        const clientTotals = new Map<string, number>();
        for (const r of jobRows) {
          const cid = r.client_id?.trim();
          if (!cid) continue;
          clientTotals.set(cid, (clientTotals.get(cid) ?? 0) + jobBillableRevenue(r as Parameters<typeof jobBillableRevenue>[0]));
        }
        const clientIds = [...clientTotals.keys()];
        let accountsOut: { name: string; revenue: number }[] = [];
        if (clientIds.length > 0) {
          const { data: clients } = await supabase.from("clients").select("id, source_account_id").in("id", clientIds);
          const accByClient = new Map<string, string | null>();
          const accIds = new Set<string>();
          for (const c of clients ?? []) {
            const id = (c as { id: string }).id;
            const aid = (c as { source_account_id?: string | null }).source_account_id ?? null;
            accByClient.set(id, aid);
            if (aid) accIds.add(aid);
          }
          const accNames = new Map<string, string>();
          if (accIds.size > 0) {
            const { data: accs } = await supabase
              .from("accounts")
              .select("id, company_name")
              .in("id", [...accIds])
              .is("deleted_at", null);
            for (const a of accs ?? []) {
              accNames.set((a as { id: string }).id, String((a as { company_name?: string }).company_name ?? "Account"));
            }
          }
          const byAccount = new Map<string, number>();
          const unlinked = new Map<string, number>();
          for (const [cid, amt] of clientTotals) {
            const aid = accByClient.get(cid);
            if (aid && accNames.has(aid)) {
              const nm = accNames.get(aid)!;
              byAccount.set(nm, (byAccount.get(nm) ?? 0) + amt);
            } else {
              unlinked.set("Direct / unlinked clients", (unlinked.get("Direct / unlinked clients") ?? 0) + amt);
            }
          }
          accountsOut = [
            ...[...byAccount.entries()].map(([name, rev]) => ({ name, revenue: rev })),
            ...[...unlinked.entries()].map(([name, revenue]) => ({ name, revenue })),
          ]
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);
        }
        setTopAccounts(accountsOut);

        const fromMs = new Date(fromIso).getTime();
        const toMs = new Date(toBound).getTime();
        const spanDays = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));
        const fromDay = fromIso.slice(0, 10);
        const toDay = toBound.slice(0, 10);

        const [{ data: invPaid }, { data: sbPaid }, billRes] = await Promise.all([
          supabase
            .from("invoices")
            .select("amount, paid_date")
            .eq("status", "paid")
            .gte("paid_date", fromDay)
            .lte("paid_date", toDay),
          supabase
            .from("self_bills")
            .select("net_payout, updated_at")
            .eq("status", "paid")
            .gte("updated_at", fromIso)
            .lte("updated_at", toBound),
          supabase
            .from("bills")
            .select("amount, paid_at")
            .eq("status", "paid")
            .gte("paid_at", fromIso)
            .lte("paid_at", toBound),
        ]);
        const billsPaid = billRes.error ? [] : ((billRes.data ?? []) as { amount: number; paid_at?: string }[]);

        const buckets: CashBucket[] = [];
        if (spanDays <= 45) {
          const dayKeys: string[] = [];
          const walk = new Date(fromDay + "T12:00:00");
          const endWalk = new Date(toDay + "T12:00:00");
          while (walk <= endWalk) {
            dayKeys.push(walk.toISOString().slice(0, 10));
            walk.setDate(walk.getDate() + 1);
            if (dayKeys.length > 62) break;
          }
          const keyToIdx = new Map(dayKeys.map((k, i) => [k, i]));
          for (const k of dayKeys) {
            buckets.push({
              label: new Date(k + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              collected: 0,
              partnerPayouts: 0,
              bills: 0,
              net: 0,
            });
          }
          for (const inv of invPaid ?? []) {
            const d = (inv as { paid_date?: string }).paid_date?.slice(0, 10);
            const i = d ? keyToIdx.get(d) : undefined;
            if (i !== undefined) buckets[i]!.collected += Number((inv as { amount?: number }).amount ?? 0);
          }
          for (const sb of sbPaid ?? []) {
            const d = (sb as { updated_at?: string }).updated_at?.slice(0, 10);
            const i = d ? keyToIdx.get(d) : undefined;
            if (i !== undefined) buckets[i]!.partnerPayouts += Number((sb as { net_payout?: number }).net_payout ?? 0);
          }
          for (const b of billsPaid) {
            const d = b.paid_at?.slice(0, 10);
            const i = d ? keyToIdx.get(d) : undefined;
            if (i !== undefined) buckets[i]!.bills += Number(b.amount ?? 0);
          }
        } else {
          const monthKeys: string[] = [];
          const curM = new Date(new Date(fromIso).getFullYear(), new Date(fromIso).getMonth(), 1);
          const endM = new Date(toBound);
          while (curM <= endM) {
            monthKeys.push(`${curM.getFullYear()}-${String(curM.getMonth() + 1).padStart(2, "0")}`);
            buckets.push({
              label: curM.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
              collected: 0,
              partnerPayouts: 0,
              bills: 0,
              net: 0,
            });
            curM.setMonth(curM.getMonth() + 1);
            if (monthKeys.length > 24) break;
          }
          const keyToIdxM = new Map(monthKeys.map((k, i) => [k, i]));
          for (const inv of invPaid ?? []) {
            const pd = (inv as { paid_date?: string }).paid_date;
            const mk = pd?.slice(0, 7);
            const i = mk ? keyToIdxM.get(mk) : undefined;
            if (i !== undefined) buckets[i]!.collected += Number((inv as { amount?: number }).amount ?? 0);
          }
          for (const sb of sbPaid ?? []) {
            const u = (sb as { updated_at?: string }).updated_at;
            if (!u) continue;
            const mk = u.slice(0, 7);
            const i = keyToIdxM.get(mk);
            if (i !== undefined) buckets[i]!.partnerPayouts += Number((sb as { net_payout?: number }).net_payout ?? 0);
          }
          for (const bill of billsPaid) {
            const u = bill.paid_at;
            if (!u) continue;
            const mk = u.slice(0, 7);
            const i = keyToIdxM.get(mk);
            if (i !== undefined) buckets[i]!.bills += Number(bill.amount ?? 0);
          }
        }
        for (const b of buckets) {
          b.net = b.collected - b.partnerPayouts - b.bills;
        }
        setCashflow(buckets);
      } catch {
        if (!cancelled) {
          setRevenue(0);
          setPartnerDirect(0);
          setGrossProfit(0);
          setCommission(0);
          setCashflow([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [boundsKey]);

  const netProfit = grossProfit - commission;
  const grossPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
  const netPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;
  const { current, next, fillPct } = tierProgress(billingForTier, tiers);

  return (
    <div className="space-y-5">
      <Card padding="none" className="overflow-hidden border-border-light shadow-sm">
        <div className="px-5 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border-light/80 bg-gradient-to-r from-surface-hover/40 to-transparent">
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">Executive snapshot</p>
            <p className="text-xs text-text-tertiary mt-0.5">
              Sales jobs in range · {bounds ? rangeLabel : "All time"}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border-light">
          {[
            { label: "Revenue", value: revenue, sub: "Sold job value (customer total)", accent: "text-emerald-600" },
            { label: "Partner & materials", value: partnerDirect, sub: "Direct job cost", accent: "text-amber-600" },
            {
              label: "Gross margin",
              value: grossProfit,
              sub: `${grossPct}% of revenue`,
              accent: grossPct >= 20 ? "text-emerald-600" : "text-rose-600",
            },
            {
              label: "Net margin",
              value: netProfit,
              sub: `${netPct}% after commission`,
              accent: netPct >= 15 ? "text-sky-600" : "text-rose-600",
            },
          ].map((cell) => (
            <div key={cell.label} className="p-4 sm:p-5">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{cell.label}</p>
              <p className={cn("text-xl sm:text-2xl font-bold tabular-nums mt-1", cell.accent)}>
                {loading ? "—" : formatCurrency(cell.value)}
              </p>
              <p className="text-[11px] text-text-tertiary mt-1 leading-snug">{cell.sub}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden border-border-light">
        <CardHeader className="px-5 pt-4 pb-2">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 flex items-center justify-center">
              <Layers className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-base">Tier vs Revenue</CardTitle>
              <p className="text-xs text-text-tertiary mt-0.5">
                Paid invoices in range — progress toward the next tier threshold
              </p>
            </div>
          </div>
        </CardHeader>
        <div className="px-5 pb-5 space-y-3">
          {loading ? (
            <div className="h-16 animate-pulse rounded-xl bg-surface-hover" />
          ) : tiers.length === 0 ? (
            <p className="text-sm text-text-tertiary">Configure commission tiers in Settings to track progress here.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-lg font-bold text-text-primary tabular-nums">{formatCurrency(billingForTier)}</span>
                  <span className="text-sm text-text-tertiary">paid invoices</span>
                  {current && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">
                      Tier {current.tier_number} · {current.rate_percent}% on excess
                    </span>
                  )}
                </div>
                {next && (
                  <span className="text-xs text-text-tertiary">
                    Next: <strong className="text-text-secondary">{formatCurrency(next.breakeven_amount)}</strong> breakeven
                  </span>
                )}
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-surface-hover ring-1 ring-inset ring-border-light/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 transition-all duration-500"
                  style={{ width: `${fillPct}%` }}
                />
              </div>
              <p className="text-[11px] text-text-tertiary">
                Progress from your current tier floor toward the next breakeven, based on paid invoices in range.
              </p>
            </>
          )}
        </div>
      </Card>

      <BestSellersByOwner />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        <Card padding="none" className="h-full min-h-0 flex flex-col border-border-light">
          <CardHeader className="px-5 pt-4 flex flex-row items-center justify-between shrink-0 mb-0">
            <div>
              <CardTitle className="text-base">Top partner</CardTitle>
              <p className="text-xs text-text-tertiary mt-0.5">By revenue in range</p>
            </div>
            <TrendingUp className="h-4 w-4 text-text-tertiary" />
          </CardHeader>
          <div className="px-5 pb-5 flex-1 flex flex-col min-h-0">
            {loading ? (
              <div className="h-24 animate-pulse rounded-xl bg-surface-hover" />
            ) : topPartner ? (
              <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-200/40 dark:border-amber-900/30">
                <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center">
                  <Star className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{topPartner.name}</p>
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{formatCurrency(topPartner.revenue)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-tertiary py-6 text-center">No partner revenue in this period</p>
            )}
          </div>
        </Card>

        <Card padding="none" className="h-full min-h-0 flex flex-col border-border-light">
          <CardHeader className="px-5 pt-4 flex flex-row items-center justify-between shrink-0 mb-0">
            <div>
              <CardTitle className="text-base">Top 5 accounts</CardTitle>
              <p className="text-xs text-text-tertiary mt-0.5">Linked corporate accounts · revenue in range</p>
            </div>
            <Building2 className="h-4 w-4 text-text-tertiary" />
          </CardHeader>
          <div className="px-5 pb-5 space-y-2 flex-1 flex flex-col min-h-0">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-hover" />)
            ) : topAccounts.length === 0 ? (
              <p className="text-sm text-text-tertiary py-4 text-center">No account-linked revenue in this period</p>
            ) : (
              topAccounts.map((row, i) => (
                <div key={row.name} className="flex items-center gap-3 py-2 border-b border-border-light/60 last:border-0">
                  <span
                    className={cn(
                      "h-7 w-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0",
                      i === 0 ? "bg-indigo-100 text-indigo-700" : "bg-surface-hover text-text-tertiary",
                    )}
                  >
                    {i + 1}
                  </span>
                  <p className="text-sm font-medium text-text-primary truncate flex-1">{row.name}</p>
                  <p className="text-sm font-bold tabular-nums text-text-primary">{formatCurrency(row.revenue)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card padding="none" className="border-border-light">
        <CardHeader className="px-5 pt-4">
          <CardTitle className="text-base">Cashflow</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            Collected (invoices paid) vs partner payouts vs company bills paid — net estimate
          </p>
        </CardHeader>
        <div className="px-3 pb-5">
          {loading ? (
            <div className="h-52 animate-pulse rounded-xl bg-surface-hover" />
          ) : cashflow.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-text-tertiary">No cash movements in range</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cashflow} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v, name) => [formatCurrency(Number(v ?? 0)), String(name ?? "")]}
                  contentStyle={{ borderRadius: 10, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="collected" name="Collected" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="partnerPayouts" name="Partner payouts" fill="#f87171" radius={[4, 4, 0, 0]} />
                <Bar dataKey="bills" name="Bills paid" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
