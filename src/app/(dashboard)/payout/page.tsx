"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseISO, isValid } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import {
  type FinancePeriodMode,
  DEFAULT_FINANCE_PERIOD_MODE,
} from "@/lib/finance-period";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Users,
  Wrench,
  CreditCard,
  DollarSign,
  Plus,
  Search,
  Check,
  Loader2,
  X as XIcon,
} from "lucide-react";
import {
  fetchPayoutRange,
  fetchPayoutMultiWeek,
  buildPayoutCsv,
  CATEGORY_ORDER,
  getWeekFromAnchor,
  type PayoutItem,
  type PayoutCategory,
  type PayoutStatus,
} from "./payout-data";
import { ReviewPayModal } from "./review-pay-modal";

type PrimaryTab = "all" | "draft" | "approved" | "paid" | "cancelled";
type CategoryFilter = "all" | PayoutCategory;

const CATEGORY_META: Record<
  PayoutCategory,
  { label: string; unit: (n: number) => string; payMethod: string; Icon: typeof Users }
> = {
  workforce: {
    label: "Workforce",
    unit: (n) => `${n} ${n === 1 ? "contractor" : "contractors"}`,
    payMethod: "bank transfer",
    Icon: Users,
  },
  partners: {
    label: "Partners",
    unit: (n) => `${n} ${n === 1 ? "self-bill" : "self-bills"}`,
    payMethod: "bank transfer",
    Icon: Wrench,
  },
  expenses: {
    label: "Expenses",
    unit: (n) => `${n} ${n === 1 ? "bill" : "bills"}`,
    payMethod: "direct debit",
    Icon: CreditCard,
  },
};

/** Splits "£4,200.00" into { whole: "£4,200", decimals: ".00" } for styled rendering. */
function splitAmount(n: number): { whole: string; decimals: string } {
  const formatted = formatCurrency(n);
  const dotIdx = formatted.lastIndexOf(".");
  if (dotIdx === -1) return { whole: formatted, decimals: "" };
  return { whole: formatted.slice(0, dotIdx), decimals: formatted.slice(dotIdx) };
}

/** Format "Wk 15 · 14 – 20 Apr 2026" (or range form when spanning weeks). */
function formatRangeHeadline(rangeStart: string, rangeEnd: string): string {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const startWeekNum = ((d: Date) => {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  })(start);
  const endWeekNum = ((d: Date) => {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  })(end);
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = sameMonth
    ? String(start.getDate())
    : start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const endStr = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const wkPart = startWeekNum === endWeekNum ? `Wk ${startWeekNum}` : `Wk ${startWeekNum}–${endWeekNum}`;
  return `${wkPart} · ${startStr} – ${endStr}`;
}

export default function PayoutPage() {
  // ── Period state (mirrors FinanceWeekRangeBar conventions) ─────────────────
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date());
  /** Extra weeks the user picked in "Week" mode (besides the primary weekAnchor).
   * Rendered as chips below the FinanceWeekRangeBar; all are fetched in parallel. */
  const [extraWeekAnchors, setExtraWeekAnchors] = useState<Date[]>([]);
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const [items, setItems] = useState<PayoutItem[]>([]);
  const [overdueItems, setOverdueItems] = useState<PayoutItem[]>([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [loading, setLoading] = useState(true);

  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("approved");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [localPaid, setLocalPaid] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<PayoutCategory>>(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);

  /** All ISO-week anchors currently selected in Week mode (primary + extras, deduped & sorted). */
  const selectedWeekAnchors = useMemo(() => {
    const seen = new Set<string>();
    const all = [weekAnchor, ...extraWeekAnchors].filter((d) => {
      const key = getWeekFromAnchor(d).weekLabel;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return all.sort((a, b) => a.getTime() - b.getTime());
  }, [weekAnchor, extraWeekAnchors]);

  /** Derive from/to dates based on the FinanceWeekRangeBar mode. */
  const derivedRange = useMemo(() => {
    if (periodMode === "week") return { from: weekAnchor, to: weekAnchor };
    if (periodMode === "month") {
      const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
      const last = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
      return { from: first, to: last };
    }
    if (periodMode === "range") {
      const f = rangeFrom.trim() ? parseISO(rangeFrom.trim()) : weekAnchor;
      const t = rangeTo.trim() ? parseISO(rangeTo.trim()) : weekAnchor;
      return {
        from: isValid(f) ? f : weekAnchor,
        to: isValid(t) ? t : weekAnchor,
      };
    }
    return { from: weekAnchor, to: weekAnchor };
  }, [periodMode, weekAnchor, monthAnchor, rangeFrom, rangeTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // In Week mode with multiple chips, fetch each week in parallel and merge.
      const res =
        periodMode === "week" && selectedWeekAnchors.length > 1
          ? await fetchPayoutMultiWeek(selectedWeekAnchors)
          : await fetchPayoutRange(derivedRange.from, derivedRange.to);
      setItems(res.items);
      setOverdueItems(res.overdueItems);
      setRangeStart(res.rangeStart);
      setRangeEnd(res.rangeEnd);
    } catch (e) {
      console.error("Payout load failed", e);
      toast.error(e instanceof Error ? e.message : "Failed to load payout");
    } finally {
      setLoading(false);
    }
  }, [periodMode, selectedWeekAnchors, derivedRange.from, derivedRange.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [rangeStart, rangeEnd]);

  const effectiveStatus = useCallback(
    (it: PayoutItem): PayoutStatus => {
      if (localPaid.has(it.id)) return "paid";
      return it.status;
    },
    [localPaid],
  );

  const primaryCounts = useMemo(() => {
    const counts = { draft: 0, approved: 0, paid: 0, cancelled: 0, all: items.length };
    for (const it of items) {
      const st = effectiveStatus(it);
      if (st === "draft") counts.draft++;
      else if (st === "approved") counts.approved++;
      else if (st === "paid") counts.paid++;
      else if (st === "cancelled") counts.cancelled++;
    }
    return counts;
  }, [items, effectiveStatus]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const st = effectiveStatus(it);
      if (primaryTab !== "all" && st !== primaryTab) return false;
      if (categoryFilter !== "all" && it.category !== categoryFilter) return false;
      if (q && !`${it.name} ${it.reference} ${it.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, primaryTab, categoryFilter, search, effectiveStatus]);

  const kpis = useMemo(() => {
    const totals: Record<PayoutCategory, { amount: number; count: number }> = {
      workforce: { amount: 0, count: 0 },
      partners: { amount: 0, count: 0 },
      expenses: { amount: 0, count: 0 },
    };
    let grand = 0;
    let grandCount = 0;
    for (const it of items) {
      const st = effectiveStatus(it);
      if (st === "cancelled") continue;
      totals[it.category].amount += it.amount;
      totals[it.category].count += 1;
      grand += it.amount;
      grandCount += 1;
    }
    return { ...totals, grand, grandCount };
  }, [items, effectiveStatus]);

  const groups = useMemo(() => {
    const byCat = new Map<PayoutCategory, PayoutItem[]>();
    for (const it of filteredItems) {
      if (!byCat.has(it.category)) byCat.set(it.category, []);
      byCat.get(it.category)!.push(it);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c) && (byCat.get(c) ?? []).length > 0).map((c) => ({
      key: c,
      rows: byCat.get(c)!,
    }));
  }, [filteredItems]);

  const selectedItems = useMemo(
    () => filteredItems.filter((it) => selectedIds.has(it.id)),
    [filteredItems, selectedIds],
  );
  const selectedTotal = useMemo(() => selectedItems.reduce((s, i) => s + i.amount, 0), [selectedItems]);

  // ── Period handlers (FinanceWeekRangeBar quirks) ──────────────────────────
  const handlePeriodModeChange = (m: FinancePeriodMode) => {
    setPeriodMode(m);
    // Multi-week chips only apply to Week mode — clear them when switching away.
    if (m !== "week") setExtraWeekAnchors([]);
    if (m === "range" && rangeFrom.trim()) {
      const d = parseISO(rangeFrom.trim());
      if (isValid(d)) setWeekAnchor(d);
    }
  };

  // ── Multi-week handlers (Week mode only) ──────────────────────────────────
  const addPreviousWeek = () => {
    const earliest = selectedWeekAnchors[0] ?? weekAnchor;
    const previous = new Date(earliest.getTime() - 7 * 86400000);
    const previousLabel = getWeekFromAnchor(previous).weekLabel;
    // Guard against re-adding a week that's already in the list (e.g., after DST boundaries).
    if (selectedWeekAnchors.some((a) => getWeekFromAnchor(a).weekLabel === previousLabel)) return;
    setExtraWeekAnchors((prev) => [...prev, previous]);
  };

  const removeWeekAnchor = (anchor: Date) => {
    const target = getWeekFromAnchor(anchor).weekLabel;
    const isPrimary = getWeekFromAnchor(weekAnchor).weekLabel === target;
    if (isPrimary) {
      // Promote the first extra as the new primary; if none, keep as-is (can't remove last chip).
      if (extraWeekAnchors.length === 0) return;
      const [first, ...rest] = extraWeekAnchors;
      setWeekAnchor(first);
      setExtraWeekAnchors(rest);
      return;
    }
    setExtraWeekAnchors((prev) =>
      prev.filter((a) => getWeekFromAnchor(a).weekLabel !== target),
    );
  };
  const handleRangeFromChange = (v: string) => {
    setRangeFrom(v);
    if (periodMode === "range" && v.trim()) {
      const d = parseISO(v.trim());
      if (isValid(d)) setWeekAnchor(d);
    }
  };

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSelectionFromRows = (rows: PayoutItem[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (effectiveStatus(r) !== "approved") continue;
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  };

  const selectAllVisibleReady = () => {
    const ready = filteredItems.filter((r) => effectiveStatus(r) === "approved");
    setSelectedIds(new Set(ready.map((r) => r.id)));
  };

  const toggleCategory = (cat: PayoutCategory) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const markPaidLocal = (id: string) => {
    setLocalPaid((prev) => new Set(prev).add(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success("Marked paid (session)");
  };

  const exportAllVisible = () => {
    if (filteredItems.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const csv = buildPayoutCsv(filteredItems, rangeStart);
    downloadCsv(csv, `payout-${rangeStart}.csv`);
  };

  const exportSelected = () => {
    if (selectedItems.length === 0) {
      toast.error("Nothing selected");
      return;
    }
    const csv = buildPayoutCsv(selectedItems, rangeStart);
    downloadCsv(csv, `payout-selected-${rangeStart}.csv`);
  };

  const handleConfirmPay = async (method: "bank_transfer" | "manual") => {
    for (const it of selectedItems) markPaidLocal(it.id);
    setReviewOpen(false);
    toast.success(`${selectedItems.length} item(s) marked paid (${method === "bank_transfer" ? "bank transfer" : "manual"})`);
  };

  // ── Derived presentation ───────────────────────────────────────────────────
  const weekHeadline = rangeStart && rangeEnd ? formatRangeHeadline(rangeStart, rangeEnd) : "—";
  const cutoffLine = useMemo(() => {
    if (!rangeEnd) return "";
    const end = new Date(rangeEnd);
    const payoutDay = new Date(end.getTime() + 86400000);
    const cutoff = `Cutoff ${end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} 23:59`;
    const payout = `Payout ${payoutDay.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
    return `${cutoff} · ${payout}`;
  }, [rangeEnd]);

  const overdueTotal = useMemo(() => overdueItems.reduce((s, i) => s + i.amount, 0), [overdueItems]);
  const earliestOverdueWeek = useMemo(() => {
    if (overdueItems.length === 0) return null;
    const sorted = [...overdueItems].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return sorted[0].weekLabel.replace(/^\d{4}-W/, "Wk ");
  }, [overdueItems]);

  const allReadyVisible = useMemo(() => filteredItems.filter((r) => effectiveStatus(r) === "approved"), [filteredItems, effectiveStatus]);
  const allReadySelected =
    allReadyVisible.length > 0 && allReadyVisible.every((r) => selectedIds.has(r.id));

  return (
    <PageTransition>
      {/* Extra bottom padding so the sticky footer never covers content. */}
      <div className="space-y-6 px-1 pb-24 sm:px-0">
        {/* ── 1. Header ─────────────────────────────────────────────────── */}
        <PageHeader
          title="Payout"
          subtitle="Operations' weekly payment run — Workforce, Partners & Expenses"
        >
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={exportAllVisible}
          >
            Export file
          </Button>
          <Link href="/finance/bills">
            <Button
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              className="bg-[#020040] hover:bg-[#020040]/90 text-white border-[#020040]"
            >
              Add expense
            </Button>
          </Link>
        </PageHeader>

        {/* ── 2. Period picker ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[22px] font-bold text-[#1C1917] leading-tight">{weekHeadline}</p>
              <p className="mt-0.5 text-xs text-text-tertiary">{cutoffLine}</p>
            </div>
          </div>
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
            rangeHelperText="Pick From / To dates to pay multiple weeks in one run."
          />

          {/* Multi-week chip row — Week mode only. Lets the user stack several
              weeks into a single run without forcing a contiguous date range. */}
          {periodMode === "week" ? (
            <WeekChipsRow
              anchors={selectedWeekAnchors}
              primaryAnchor={weekAnchor}
              onAddPrevious={addPreviousWeek}
              onRemove={removeWeekAnchor}
            />
          ) : null}
        </div>

        {/* ── 3. Overdue banner (conditional) ──────────────────────────── */}
        {overdueItems.length > 0 ? (
          <div
            className="flex flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            style={{ backgroundColor: "#FEF5F3", borderColor: "#F5BFBF" }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#A32D2D] text-white">
                <AlertCircle className="h-4 w-4" aria-hidden />
              </div>
              <p className="text-sm text-[#A32D2D]">
                <span className="font-semibold">
                  {overdueItems.length} item{overdueItems.length === 1 ? "" : "s"} overdue payout
                </span>
                <span className="ml-2 font-normal text-[#A32D2D]/80">
                  {earliestOverdueWeek ? `from ${earliestOverdueWeek} · ` : ""}
                  <span className="tabular-nums">{formatCurrency(overdueTotal)}</span> still open
                </span>
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-[#F5BFBF] bg-card text-[#A32D2D] hover:bg-white"
              onClick={() => {
                setPrimaryTab("approved");
                setPeriodMode("range");
                const earliestDate = overdueItems
                  .map((i) => i.weekStart)
                  .filter(Boolean)
                  .sort()[0];
                if (earliestDate) {
                  setRangeFrom(earliestDate);
                  setRangeTo(rangeEnd);
                  const d = parseISO(earliestDate);
                  if (isValid(d)) setWeekAnchor(d);
                }
              }}
            >
              Review overdue
            </Button>
          </div>
        ) : null}

        {/* ── 4. KPI tiles ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label="Workforce"
            amount={kpis.workforce.amount}
            subtitle={`${kpis.workforce.count} contractor${kpis.workforce.count === 1 ? "" : "s"}`}
            Icon={Users}
          />
          <KpiTile
            label="Partners"
            amount={kpis.partners.amount}
            subtitle={`${kpis.partners.count} self-bill${kpis.partners.count === 1 ? "" : "s"}`}
            Icon={Wrench}
          />
          <KpiTile
            label="Expenses"
            amount={kpis.expenses.amount}
            subtitle={`${kpis.expenses.count} bill${kpis.expenses.count === 1 ? "" : "s"}`}
            Icon={CreditCard}
          />
          <KpiTile
            label="Grand total"
            amount={kpis.grand}
            subtitle={`${kpis.grandCount} items · ready to pay`}
            Icon={DollarSign}
            variant="accent"
          />
        </div>

        {/* ── 5. Status tabs ───────────────────────────────────────────── */}
        <div className="border-b border-border-light">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: "all", label: "All", count: primaryCounts.all },
                { id: "draft", label: "Draft", count: primaryCounts.draft },
                { id: "approved", label: "Approved", count: primaryCounts.approved, accent: true },
                { id: "paid", label: "Paid", count: primaryCounts.paid },
                { id: "cancelled", label: "Cancelled", count: primaryCounts.cancelled },
              ] as Array<{ id: PrimaryTab; label: string; count: number; accent?: boolean }>
            ).map((t) => {
              const active = primaryTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPrimaryTab(t.id)}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 px-3 py-2 text-xs transition-colors",
                    active
                      ? "font-semibold text-[#ED4B00]"
                      : "font-medium text-[#6B6B70] hover:text-text-primary",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      active
                        ? "bg-[#FFF1EB] text-[#ED4B00]"
                        : t.accent && t.count > 0
                          ? "bg-[#FFF1EB] text-[#ED4B00]"
                          : "bg-[#F1EFE8] text-[#6B6B70]",
                    )}
                  >
                    {t.count}
                  </span>
                  {active ? (
                    <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[#ED4B00]" aria-hidden />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 6. Toolbar (category filter + search + select all) ───────── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-1 rounded-xl border border-border-light bg-card p-0.5">
            {(
              [
                { id: "all", label: "All" },
                { id: "workforce", label: "Workforce" },
                { id: "partners", label: "Partners" },
                { id: "expenses", label: "Expenses" },
              ] as Array<{ id: CategoryFilter; label: string }>
            ).map((c) => {
              const active = categoryFilter === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryFilter(c.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[#020040] text-white"
                      : "text-text-secondary hover:bg-surface-hover",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-[240px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, SB, JOB..."
                className="pl-8"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllVisibleReady}
              disabled={allReadyVisible.length === 0}
            >
              {allReadySelected ? "Clear selection" : "Select all approved"}
            </Button>
          </div>
        </div>

        {/* ── 7. Grouped list ──────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-text-tertiary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState primaryTab={primaryTab} />
        ) : (
          <div className="rounded-2xl border border-border-light bg-card overflow-hidden">
            {groups.map((g, idx) => {
              const meta = CATEGORY_META[g.key];
              const Icon = meta.Icon;
              const total = g.rows.reduce((s, i) => s + i.amount, 0);
              const readyRows = g.rows.filter((r) => effectiveStatus(r) === "approved");
              const allSelected = readyRows.length > 0 && readyRows.every((r) => selectedIds.has(r.id));
              const collapsed = collapsedGroups.has(g.key);
              const totalSplit = splitAmount(total);

              return (
                <div key={g.key} className={cn(idx > 0 && "border-t border-border-light")}>
                  {/* Category header */}
                  <div className="flex items-center justify-between gap-3 bg-[#FAFAFB] px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => setSelectionFromRows(readyRows, e.target.checked)}
                        disabled={readyRows.length === 0}
                        aria-label={`Select all ${meta.label}`}
                        className="h-4 w-4"
                      />
                      <Icon className="h-4 w-4 shrink-0 text-[#020040]" aria-hidden />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#1C1917]">{meta.label}</p>
                          <p className="text-[11px] text-text-tertiary">
                            {meta.unit(g.rows.length)} · {meta.payMethod}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <p className="text-sm font-semibold tabular-nums text-[#1C1917]">
                        <span>{totalSplit.whole}</span>
                        <span className="text-text-tertiary">{totalSplit.decimals}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleCategory(g.key)}
                        className="text-text-tertiary hover:text-text-primary transition-colors"
                        aria-label={collapsed ? "Expand" : "Collapse"}
                      >
                        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Rows */}
                  {!collapsed ? (
                    <div>
                      {g.rows.map((row) => (
                        <PayoutRow
                          key={row.id}
                          row={row}
                          status={effectiveStatus(row)}
                          selected={selectedIds.has(row.id)}
                          onToggleSelect={() => toggleOne(row.id)}
                          onMarkPaid={() => markPaidLocal(row.id)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 8. Sticky full-width footer ──────────────────────────────── */}
        {selectedIds.size > 0 ? (
          <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border-light bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
            <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Selected</p>
                <p className="text-sm">
                  <span className="font-semibold tabular-nums text-[#ED4B00]">{selectedIds.size}</span>
                  <span className="ml-1 text-text-primary">item{selectedIds.size === 1 ? "" : "s"}</span>
                  <span className="mx-1.5 text-text-tertiary">·</span>
                  <span className="font-semibold tabular-nums text-[#ED4B00]">{formatCurrency(selectedTotal)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportSelected}>
                  Export selected
                </Button>
                <Button
                  size="sm"
                  icon={<Check className="h-3.5 w-3.5" />}
                  onClick={() => setReviewOpen(true)}
                  className="bg-[#ED4B00] hover:bg-[#D84300] text-white border-[#ED4B00] hover:border-[#D84300]"
                >
                  Review &amp; pay
                </Button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-1 text-[11px] font-medium text-text-tertiary hover:text-text-primary"
                  title="Clear selection"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ReviewPayModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          items={selectedItems}
          weekLabel={weekHeadline}
          payoutHint={cutoffLine.split("·")[1]?.trim() ?? ""}
          onConfirm={handleConfirmPay}
        />
      </div>
    </PageTransition>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function WeekChipsRow({
  anchors,
  primaryAnchor,
  onAddPrevious,
  onRemove,
}: {
  anchors: Date[];
  primaryAnchor: Date;
  onAddPrevious: () => void;
  onRemove: (anchor: Date) => void;
}) {
  if (anchors.length === 0) return null;
  const primaryLabel = getWeekFromAnchor(primaryAnchor).weekLabel;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mr-1">
        Selected weeks
      </span>
      {anchors.map((a) => {
        const { weekStart, weekEnd, weekLabel } = getWeekFromAnchor(a);
        const isPrimary = weekLabel === primaryLabel;
        const weekNum = Number(weekLabel.slice(-2));
        const start = new Date(weekStart);
        const end = new Date(weekEnd);
        const sameMonth = start.getMonth() === end.getMonth();
        const startStr = sameMonth
          ? String(start.getDate())
          : start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
        const endStr = end.toLocaleDateString(undefined, { day: "numeric", month: "short" });
        return (
          <span
            key={weekLabel}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
              isPrimary
                ? "border-[#020040] bg-[#020040] text-white"
                : "border-border-light bg-card text-text-secondary",
            )}
          >
            Wk {weekNum}
            <span className={cn("font-normal", isPrimary ? "text-white/80" : "text-text-tertiary")}>
              · {startStr}–{endStr}
            </span>
            {anchors.length > 1 ? (
              <button
                type="button"
                onClick={() => onRemove(a)}
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
                  isPrimary
                    ? "text-white/80 hover:bg-white/15 hover:text-white"
                    : "text-text-tertiary hover:bg-surface-hover hover:text-text-primary",
                )}
                aria-label={`Remove ${weekLabel}`}
                title="Remove this week"
              >
                <XIcon className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        );
      })}
      <button
        type="button"
        onClick={onAddPrevious}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border bg-card px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:border-[#020040]/40 hover:text-[#020040]"
        title="Include the week before the earliest selected week"
      >
        <Plus className="h-3 w-3" />
        Add week
      </button>
    </div>
  );
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Export ready");
}

function KpiTile({
  label,
  amount,
  subtitle,
  Icon,
  variant = "default",
}: {
  label: string;
  amount: number;
  subtitle: string;
  Icon: typeof Users;
  variant?: "default" | "accent";
}) {
  const isAccent = variant === "accent";
  const { whole, decimals } = splitAmount(amount);
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3.5",
        isAccent ? "" : "border-border-light bg-card",
      )}
      style={isAccent ? { backgroundColor: "#FFF8F3", borderColor: "#F5CFB8" } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide",
              isAccent ? "text-[#B25418]" : "text-text-tertiary",
            )}
          >
            {label}
          </p>
          <p
            className={cn(
              "mt-1 tabular-nums leading-tight",
              isAccent ? "text-[#ED4B00]" : "text-[#1C1917]",
            )}
          >
            <span className="text-[26px] font-bold">{whole}</span>
            <span className={cn("text-[16px] font-bold", isAccent ? "text-[#ED4B00]/70" : "text-text-tertiary")}>
              {decimals}
            </span>
          </p>
          <p
            className={cn("mt-0.5 text-[11px]", isAccent ? "text-[#733712]" : "text-text-secondary")}
          >
            {subtitle}
          </p>
        </div>
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            isAccent ? "bg-[#ED4B00]/15 text-[#ED4B00]" : "bg-[#020040]/8 text-[#020040]",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function PayoutRow({
  row,
  status,
  selected,
  onToggleSelect,
  onMarkPaid,
}: {
  row: PayoutItem;
  status: PayoutStatus;
  selected: boolean;
  onToggleSelect: () => void;
  onMarkPaid: () => void;
}) {
  const isApproved = status === "approved";
  const isDraft = status === "draft";
  const amount = splitAmount(row.amount);
  const wkShort = row.weekLabel.replace(/^\d{4}-W/, "Wk ");
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-border-light px-4 py-3 sm:px-5",
        isApproved && "bg-[#FFFDFA]",
        !isApproved && "bg-card",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        disabled={!isApproved}
        aria-label={`Select ${row.name}`}
        className="h-4 w-4 shrink-0"
      />

      <Link
        href={row.linkHref}
        target="_blank"
        rel="noopener"
        className="shrink-0"
        title={`Open ${row.name}`}
      >
        <Avatar
          name={row.avatarName}
          size="xs"
          className="bg-[#020040] text-white ring-2 ring-transparent hover:ring-[#020040]/20 transition-shadow"
        />
      </Link>

      <div className="min-w-0 flex-1 sm:max-w-[220px]">
        <Link
          href={row.linkHref}
          target="_blank"
          rel="noopener"
          className="block truncate text-sm font-semibold text-[#1C1917] hover:text-[#ED4B00] hover:underline"
          title={row.name}
        >
          {row.name}
        </Link>
        <p className="truncate text-[11px] text-text-tertiary">{row.description ?? "—"}</p>
      </div>

      <div className="hidden sm:flex sm:flex-col sm:min-w-0 sm:flex-1">
        <Link
          href={row.linkHref}
          target="_blank"
          rel="noopener"
          className="truncate font-mono text-[11px] text-[#1C1917] hover:text-[#ED4B00] hover:underline"
          title={row.reference}
        >
          {row.reference}
          {typeof row.jobsCount === "number" && row.jobsCount > 0 ? (
            <span className="font-sans text-text-tertiary"> · {row.jobsCount} job{row.jobsCount === 1 ? "" : "s"}</span>
          ) : null}
          <span className="font-sans text-text-tertiary"> · {wkShort}</span>
        </Link>
      </div>

      <div className="hidden sm:block sm:w-40 text-[11px] text-text-tertiary text-right whitespace-nowrap truncate">
        {row.bankLast4 ?? "—"}
      </div>

      <div className="shrink-0 text-right sm:w-28">
        <p className="text-sm font-semibold tabular-nums text-[#1C1917]">
          <span>{amount.whole}</span>
          <span className="text-text-tertiary">{amount.decimals}</span>
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0 sm:w-36 sm:justify-end">
        {isApproved ? (
          <button
            type="button"
            onClick={onMarkPaid}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[#0F6E56]/30 bg-[#EFF7F3] px-2 text-[11px] font-semibold text-[#0F6E56] transition-colors hover:bg-[#DBEEE5]"
            title="Mark paid"
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
            Mark paid
          </button>
        ) : isDraft ? (
          <Link
            href={row.linkHref}
            target="_blank"
            rel="noopener"
            className="inline-flex h-7 items-center rounded-md border border-border-light bg-card px-2 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover"
            title="Review & approve in origin"
          >
            Review
          </Link>
        ) : (
          <StatusChip status={status} />
        )}
        <Link
          href={row.linkHref}
          target="_blank"
          rel="noopener"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover"
          title="Open in origin"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: PayoutStatus }) {
  if (status === "paid")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#EFF7F3] px-2 py-0.5 text-[11px] font-semibold text-[#0F6E56]">
        <Check className="h-3 w-3" strokeWidth={3} /> Paid
      </span>
    );
  if (status === "draft")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#F1EFE8] px-2 py-0.5 text-[11px] font-semibold text-[#6B6B70]">
        Draft
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#FEF5F3] px-2 py-0.5 text-[11px] font-semibold text-[#A32D2D]">
        Cancelled
      </span>
    );
  return null;
}

function EmptyState({ primaryTab }: { primaryTab: PrimaryTab }) {
  const msg =
    primaryTab === "approved"
      ? "Nothing approved and ready to pay in this period."
      : primaryTab === "paid"
        ? "No payments made yet in this period."
        : primaryTab === "draft"
          ? "No drafts waiting for review."
          : primaryTab === "cancelled"
            ? "Nothing cancelled."
            : "No items match these filters.";
  return (
    <div className="rounded-2xl border border-dashed border-border-light bg-surface-hover/30 py-12 text-center">
      <p className="text-sm text-text-tertiary">{msg}</p>
      <p className="mt-1 text-[11px] text-text-tertiary">
        Try adjusting the week range, status tab, or category filter above.
      </p>
    </div>
  );
}
