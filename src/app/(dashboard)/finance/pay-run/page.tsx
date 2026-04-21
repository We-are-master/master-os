"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { parseISO, isValid } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import { type FinancePeriodMode, DEFAULT_FINANCE_PERIOD_MODE } from "@/lib/finance-period";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Users,
  Briefcase,
  Receipt,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { PayRunItem, PayRunItemType } from "@/types/database";
import {
  getWeekBounds,
  getOrCreatePayRun,
  getPayRunWithItems,
  syncPayRunItems,
  markPayRunItemsPaid,
  exportPayRunToCsv,
  decodePayRunLabel,
  payRunItemTypeLabel,
  payRunQueueBucket,
  fetchSelfBillStatusesByIds,
} from "@/services/pay-runs";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";

/** Previous ISO week Monday, given any date. Shifts the week anchor back by 7 days. */
function previousWeekAnchor(d: Date): Date {
  return new Date(d.getTime() - 7 * 86400000);
}

/** List of Monday anchors covering [fromDate, toDate] inclusive. */
function weeksBetween(fromDate: Date, toDate: Date): Date[] {
  const start = parseISO(getWeekBounds(fromDate).week_start);
  const end = parseISO(getWeekBounds(toDate).week_end);
  if (!isValid(start) || !isValid(end) || start > end) return [];
  const out: Date[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    out.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + 7 * 86400000);
  }
  return out;
}

type TypeGroupKey = "partner" | "workforce" | "bill";
function itemGroupKey(t: PayRunItemType): TypeGroupKey {
  if (t === "self_bill") return "partner";
  if (t === "internal_cost") return "workforce";
  return "bill";
}
const TYPE_META: Record<
  TypeGroupKey,
  { label: string; icon: typeof Users; accentBg: string; accentFg: string }
> = {
  partner: { label: "Partners", icon: Users, accentBg: "bg-[#020040]/8", accentFg: "text-[#020040]" },
  workforce: { label: "Workforce", icon: Briefcase, accentBg: "bg-emerald-500/15", accentFg: "text-emerald-600" },
  bill: { label: "Bills", icon: Receipt, accentBg: "bg-amber-500/15", accentFg: "text-amber-600" },
};

type ItemWithMeta = PayRunItem & { week_start_key: string };

export default function PayRunPage() {
  /** Default week = previous week, because the flow is "on week X, pay week X-1". */
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState(() => previousWeekAnchor(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const [allItems, setAllItems] = useState<ItemWithMeta[]>([]);
  const [selfBillStatusById, setSelfBillStatusById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPaid, setShowPaid] = useState(false);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  /** Range of weeks to load based on period mode. */
  const weeksInRange = useMemo(() => {
    if (periodMode === "week") return weeksBetween(weekAnchor, weekAnchor);
    if (periodMode === "month") {
      const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
      const last = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
      return weeksBetween(first, last);
    }
    if (periodMode === "range") {
      const f = rangeFrom.trim() ? parseISO(rangeFrom.trim()) : null;
      const t = rangeTo.trim() ? parseISO(rangeTo.trim()) : null;
      const fromDate = f && isValid(f) ? f : weekAnchor;
      const toDate = t && isValid(t) ? t : weekAnchor;
      return weeksBetween(fromDate, toDate);
    }
    return weeksBetween(weekAnchor, weekAnchor);
  }, [periodMode, weekAnchor, monthAnchor, rangeFrom, rangeTo]);

  const rangeStart = weeksInRange.length > 0 ? getWeekBounds(weeksInRange[0]).week_start : "";
  const rangeEnd =
    weeksInRange.length > 0 ? getWeekBounds(weeksInRange[weeksInRange.length - 1]).week_end : "";

  const load = useCallback(async () => {
    if (weeksInRange.length === 0) {
      setAllItems([]);
      setSelfBillStatusById({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        weeksInRange.map(async (w) => {
          const { week_start, week_end } = getWeekBounds(w);
          const run = await getOrCreatePayRun(week_start, week_end);
          await syncPayRunItems(run.id, week_start, week_end);
          const list = await getPayRunWithItems(run.id);
          return list.map<ItemWithMeta>((row) => ({ ...row, week_start_key: week_start }));
        }),
      );
      const merged = results.flat();
      setAllItems(merged);
      const sbIds = merged.filter((i) => i.item_type === "self_bill").map((i) => i.source_id);
      try {
        setSelfBillStatusById(await fetchSelfBillStatusesByIds(sbIds));
      } catch {
        setSelfBillStatusById({});
      }
    } catch (e) {
      console.error("Pay run load failed", e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in (e as object)
            ? String((e as { message: unknown }).message)
            : "Failed to load pay run";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [weeksInRange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [rangeStart, rangeEnd]);

  /** Items filtered by Show paid toggle. */
  const visibleItems = useMemo(() => {
    if (showPaid) return allItems;
    return allItems.filter((i) => i.status !== "paid");
  }, [allItems, showPaid]);

  /** Overdue items: pending and due_date strictly before the loaded range start. */
  const overdueBeforeRange = useMemo(() => {
    if (!rangeStart) return [] as ItemWithMeta[];
    return allItems.filter(
      (i) => i.status === "pending" && i.due_date && i.due_date < rangeStart,
    );
  }, [allItems, rangeStart]);

  /** Grouped structure: week_start → groupKey → rows. */
  const grouped = useMemo(() => {
    const byWeek = new Map<string, Map<TypeGroupKey, ItemWithMeta[]>>();
    for (const row of visibleItems) {
      const wk = row.week_start_key;
      const gk = itemGroupKey(row.item_type);
      if (!byWeek.has(wk)) byWeek.set(wk, new Map());
      const inner = byWeek.get(wk)!;
      if (!inner.has(gk)) inner.set(gk, []);
      inner.get(gk)!.push(row);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b)) // oldest week first
      .map(([wkStart, inner]) => ({
        weekStart: wkStart,
        groups: (["partner", "workforce", "bill"] as TypeGroupKey[])
          .filter((k) => inner.has(k))
          .map((k) => ({ key: k, rows: inner.get(k)! })),
      }));
  }, [visibleItems]);

  const kpis = useMemo(() => {
    const pending = allItems.filter((i) => i.status === "pending");
    const paid = allItems.filter((i) => i.status === "paid");
    const overdue = overdueBeforeRange;
    return {
      dueCount: pending.length,
      dueAmount: pending.reduce((s, i) => s + Number(i.amount), 0),
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, i) => s + Number(i.amount), 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((s, i) => s + Number(i.amount), 0),
    };
  }, [allItems, overdueBeforeRange]);

  const rangeLabel = useMemo(() => {
    if (weeksInRange.length === 0) return "—";
    if (weeksInRange.length === 1) {
      const { weekLabel, weekStart, weekEnd } = getWeekBoundsForDate(weeksInRange[0]);
      return `${weekLabel} · ${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
    }
    const first = getWeekBoundsForDate(weeksInRange[0]);
    const last = getWeekBoundsForDate(weeksInRange[weeksInRange.length - 1]);
    return `${first.weekLabel} → ${last.weekLabel} · ${formatDate(first.weekStart)} – ${formatDate(last.weekEnd)}`;
  }, [weeksInRange]);

  // ── Range quick actions ────────────────────────────────────────────────────
  const applyQuickRange = (weeksCount: number) => {
    const end = previousWeekAnchor(new Date()); // last complete week
    const startAnchor = new Date(end.getTime() - (weeksCount - 1) * 7 * 86400000);
    setPeriodMode("range");
    setRangeFrom(getWeekBounds(startAnchor).week_start);
    setRangeTo(getWeekBounds(end).week_end);
    setWeekAnchor(startAnchor);
  };

  const handlePeriodModeChange = (m: FinancePeriodMode) => {
    setPeriodMode(m);
    if (m === "range" && rangeFrom.trim()) {
      const d = parseISO(rangeFrom.trim());
      if (isValid(d)) setWeekAnchor(d);
    }
  };

  const handleRangeFromChange = (v: string) => {
    setRangeFrom(v);
    if (periodMode === "range" && v.trim()) {
      const d = parseISO(v.trim());
      if (isValid(d)) setWeekAnchor(d);
    }
  };

  const extendRangeToIncludeOverdue = () => {
    if (overdueBeforeRange.length === 0) return;
    const earliest = overdueBeforeRange
      .map((i) => i.due_date ?? i.week_start_key)
      .filter(Boolean)
      .sort()[0];
    if (!earliest) return;
    const d = parseISO(earliest);
    if (!isValid(d)) return;
    const currentEnd = rangeEnd ? parseISO(rangeEnd) : previousWeekAnchor(new Date());
    setPeriodMode("range");
    setRangeFrom(getWeekBounds(d).week_start);
    setRangeTo(getWeekBounds(currentEnd).week_end);
    setWeekAnchor(d);
  };

  // ── Selection helpers ──────────────────────────────────────────────────────
  const pendingInView = useMemo(() => visibleItems.filter((i) => i.status === "pending"), [visibleItems]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSelectionFromRows = (rows: ItemWithMeta[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (r.status !== "pending") continue;
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  };

  const allPendingSelected =
    pendingInView.length > 0 && pendingInView.every((i) => selectedIds.has(i.id));

  const toggleWeekCollapsed = (wk: string) => {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(wk)) next.delete(wk);
      else next.add(wk);
      return next;
    });
  };
  const toggleGroupCollapsed = (k: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const handlePaySelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("Select at least one item");
      return;
    }
    setPaying(true);
    try {
      await markPayRunItemsPaid(Array.from(selectedIds));
      toast.success(`${selectedIds.size} item(s) marked as paid`);
      setSelectedIds(new Set());
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark paid");
    } finally {
      setPaying(false);
    }
  };

  const handleExport = () => {
    if (!rangeStart || !rangeEnd) return;
    const csv = exportPayRunToCsv(visibleItems, rangeStart, rangeEnd);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pay-run-${rangeStart}-${rangeEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageTransition>
      <div className="space-y-4 px-1 sm:px-0">
        <PageHeader
          title="Pay Run"
          subtitle={rangeLabel}
          infoTooltip="Pay the previous week(s). Partners, workforce, and bills in one place. Default shows last week — add more weeks if you're catching up."
        >
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={handleExport}
            disabled={visibleItems.length === 0}
          >
            Export CSV
          </Button>
        </PageHeader>

        <FinanceWeekRangeBar
          showAllOption={false}
          mode={periodMode}
          onModeChange={handlePeriodModeChange}
          weekAnchor={weekAnchor}
          onWeekAnchorChange={setWeekAnchor}
          monthAnchor={monthAnchor}
          onMonthAnchorChange={setMonthAnchor}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onRangeFromChange={handleRangeFromChange}
          onRangeToChange={setRangeTo}
          rangeHelperText="Default is last week. Use Date range or the quick buttons below to pay multiple weeks at once."
        />

        {/* Quick range picks */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Quick</span>
          {[
            { key: "last", label: "Last week", weeks: 1 },
            { key: "last2", label: "Last 2 weeks", weeks: 2 },
            { key: "last4", label: "Last 4 weeks", weeks: 4 },
            { key: "last8", label: "Last 8 weeks", weeks: 8 },
          ].map((qr) => (
            <button
              key={qr.key}
              type="button"
              onClick={() => {
                if (qr.weeks === 1) {
                  setPeriodMode("week");
                  setWeekAnchor(previousWeekAnchor(new Date()));
                } else {
                  applyQuickRange(qr.weeks);
                }
              }}
              className="rounded-lg bg-surface-hover px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-surface-tertiary transition-colors"
            >
              {qr.label}
            </button>
          ))}
        </div>

        {/* Overdue strip — auto-appears when there's pending pay outside the loaded range */}
        {overdueBeforeRange.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-red-200/90 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 min-w-0">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                  Overdue from previous weeks
                </p>
                <p className="text-sm font-bold tabular-nums text-red-700 dark:text-red-400">
                  {formatCurrency(kpis.overdueAmount)}
                  <span className="ml-1.5 text-[11px] font-medium text-red-600/90 dark:text-red-400/90">
                    · {kpis.overdueCount} item{kpis.overdueCount === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={extendRangeToIncludeOverdue} className="shrink-0">
              Include these
            </Button>
          </div>
        ) : null}

        {/* Compact KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Due in range</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">
                {formatCurrency(kpis.dueAmount)}
              </p>
              <p className="text-[11px] text-text-secondary">
                {kpis.dueCount} pending · {weeksInRange.length} week{weeksInRange.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#020040]/8 text-[#020040]">
              <DollarSign className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5",
              kpis.overdueCount > 0 ? "border-red-200/90 dark:border-red-900/50" : "border-border-light",
            )}
          >
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-text-tertiary",
                )}
              >
                Overdue (before range)
              </p>
              <p
                className={cn(
                  "text-[20px] font-bold tabular-nums leading-tight",
                  kpis.overdueAmount > 0.02 ? "text-red-600 dark:text-red-400" : "text-[#020040]",
                )}
              >
                {formatCurrency(kpis.overdueAmount)}
              </p>
              <p
                className={cn(
                  "text-[11px] font-medium",
                  kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-text-secondary",
                )}
              >
                {kpis.overdueCount} unpaid
              </p>
            </div>
            <div
              className={cn(
                "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg",
                kpis.overdueAmount > 0.02
                  ? "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
                  : "bg-surface-tertiary text-text-tertiary",
              )}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Paid in range</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">
                {formatCurrency(kpis.paidAmount)}
              </p>
              <p className="text-[11px] text-text-secondary">
                {kpis.paidCount} item{kpis.paidCount === 1 ? "" : "s"} done
              </p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            </div>
          </div>
        </div>

        {/* Toolbar: show paid toggle + bulk actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">Payment queue</h3>
            <button
              type="button"
              onClick={() => setShowPaid((s) => !s)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
                showPaid
                  ? "bg-primary text-white"
                  : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary",
              )}
              title={showPaid ? "Hide already-paid items" : "Show already-paid items"}
            >
              {showPaid ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {showPaid ? "Showing paid" : "Hiding paid"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectionFromRows(pendingInView, !allPendingSelected)}
              disabled={pendingInView.length === 0}
            >
              {allPendingSelected ? "Clear selection" : "Select all unpaid"}
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || paying}
              icon={paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={handlePaySelected}
            >
              Mark selected paid ({selectedIds.size})
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-light bg-surface-hover/30 py-10 text-center text-sm text-text-tertiary">
            No items for this range. Pick another week or hit one of the quick buttons above.
          </p>
        ) : (
          <div className="space-y-3">
            {grouped.map((week) => {
              const { weekLabel } = getWeekBoundsForDate(parseISO(week.weekStart));
              const weekBounds = getWeekBounds(parseISO(week.weekStart));
              const weekItems = week.groups.flatMap((g) => g.rows);
              const weekPending = weekItems.filter((r) => r.status === "pending");
              const weekPaid = weekItems.filter((r) => r.status === "paid");
              const weekTotal = weekPending.reduce((s, i) => s + Number(i.amount), 0);
              const weekCollapsed = collapsedWeeks.has(week.weekStart);
              const weekAllSelected =
                weekPending.length > 0 && weekPending.every((r) => selectedIds.has(r.id));

              return (
                <div key={week.weekStart} className="rounded-xl border border-border-light bg-card overflow-hidden">
                  {/* Week header */}
                  <div className="flex flex-col gap-2 border-b border-border-light bg-[#FAFAFB] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleWeekCollapsed(week.weekStart)}
                        className="text-text-tertiary"
                        aria-label={weekCollapsed ? "Expand week" : "Collapse week"}
                      >
                        {weekCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <input
                        type="checkbox"
                        checked={weekAllSelected}
                        onChange={(e) => setSelectionFromRows(weekPending, e.target.checked)}
                        aria-label={`Select all pending in ${weekLabel}`}
                        disabled={weekPending.length === 0}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">
                          {weekLabel}
                          <span className="ml-2 text-[11px] font-medium text-text-tertiary">
                            {formatDate(weekBounds.week_start)} – {formatDate(weekBounds.week_end)}
                          </span>
                        </p>
                        <p className="text-[11px] text-text-secondary">
                          {weekPending.length} pending · {weekPaid.length} paid
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-bold tabular-nums text-[#020040] sm:pr-1">
                      {formatCurrency(weekTotal)}
                    </p>
                  </div>

                  {/* Groups inside week */}
                  {weekCollapsed ? null : (
                    <div className="divide-y divide-border-light">
                      {week.groups.map((g) => {
                        const meta = TYPE_META[g.key];
                        const Icon = meta.icon;
                        const groupKey = `${week.weekStart}::${g.key}`;
                        const groupCollapsed = collapsedGroups.has(groupKey);
                        const groupPending = g.rows.filter((r) => r.status === "pending");
                        const groupTotal = groupPending.reduce((s, i) => s + Number(i.amount), 0);
                        const allGroupSelected =
                          groupPending.length > 0 && groupPending.every((r) => selectedIds.has(r.id));

                        return (
                          <div key={groupKey}>
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-hover/40">
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => toggleGroupCollapsed(groupKey)}
                                  className="text-text-tertiary"
                                  aria-label={groupCollapsed ? "Expand group" : "Collapse group"}
                                >
                                  {groupCollapsed ? (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <input
                                  type="checkbox"
                                  checked={allGroupSelected}
                                  onChange={(e) => setSelectionFromRows(groupPending, e.target.checked)}
                                  aria-label={`Select all ${meta.label} in ${weekLabel}`}
                                  disabled={groupPending.length === 0}
                                />
                                <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md", meta.accentBg, meta.accentFg)}>
                                  <Icon className="h-3 w-3" aria-hidden />
                                </div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                                  {meta.label}
                                  <span className="ml-1.5 text-[10px] font-medium normal-case text-text-tertiary">
                                    {g.rows.length} item{g.rows.length === 1 ? "" : "s"}
                                  </span>
                                </p>
                              </div>
                              <p className="text-xs font-semibold tabular-nums text-text-primary">
                                {formatCurrency(groupTotal)}
                              </p>
                            </div>

                            {/* Rows */}
                            {groupCollapsed ? null : (
                              <div>
                                {g.rows.map((row, index) => {
                                  const { name, reference } = decodePayRunLabel(row.source_label);
                                  const bucket = payRunQueueBucket(row, selfBillStatusById[row.source_id]);
                                  const statusLabel =
                                    bucket === "paid"
                                      ? "Paid"
                                      : bucket === "draft"
                                        ? "Draft"
                                        : "Approved";
                                  const statusVariant =
                                    bucket === "paid"
                                      ? ("success" as const)
                                      : bucket === "draft"
                                        ? ("default" as const)
                                        : ("warning" as const);
                                  const isZebra = index % 2 === 1;
                                  const isPending = row.status === "pending";
                                  return (
                                    <div
                                      key={row.id}
                                      className={cn(
                                        "flex flex-col gap-1.5 border-t border-border-light px-3 py-2 sm:flex-row sm:items-center sm:gap-3",
                                        isZebra && "bg-[#F5F5F7]",
                                        !isPending && "opacity-70",
                                      )}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <input
                                          type="checkbox"
                                          checked={selectedIds.has(row.id)}
                                          onChange={() => toggleOne(row.id)}
                                          disabled={!isPending}
                                          aria-label={`Select ${name}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-medium text-text-primary" title={name}>
                                            {name}
                                          </p>
                                          <p className="truncate text-[10px] font-mono text-text-tertiary" title={reference}>
                                            {reference || payRunItemTypeLabel(row.item_type)}
                                          </p>
                                        </div>
                                      </div>
                                      <p className="text-[11px] text-text-tertiary sm:w-24 sm:text-right whitespace-nowrap">
                                        {row.due_date ? `Due ${formatDate(row.due_date)}` : "—"}
                                      </p>
                                      <p className="text-sm font-semibold tabular-nums text-text-primary sm:w-24 sm:text-right">
                                        {formatCurrency(row.amount)}
                                      </p>
                                      <div className="sm:w-28 sm:flex sm:justify-end">
                                        <Badge variant={statusVariant} size="sm" dot>
                                          {statusLabel}
                                        </Badge>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Sticky selection footer */}
        {selectedIds.size > 0 ? (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-border-light bg-[#020040] px-4 py-2.5 shadow-xl">
            <p className="text-xs font-medium text-white">
              {selectedIds.size} selected ·{" "}
              <span className="tabular-nums font-semibold">
                {formatCurrency(
                  allItems
                    .filter((i) => selectedIds.has(i.id))
                    .reduce((s, i) => s + Number(i.amount), 0),
                )}
              </span>
            </p>
            <Button
              size="sm"
              disabled={paying}
              icon={paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={handlePaySelected}
              className="bg-white text-[#020040] hover:bg-white/90"
            >
              Mark paid
            </Button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] font-medium text-white/80 hover:text-white"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
