"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Download,
  ExternalLink,
  Filter as FilterIcon,
  HardHat,
  Building2,
  Receipt,
  LayoutList,
  LayoutGrid,
  CalendarDays,
  Plus,
  Search,
  Check,
  X as XIcon,
  Loader2,
} from "lucide-react";
import {
  fetchPayoutWeek,
  getWeekFromAnchor,
  shiftWeek,
  isThisWeek,
  buildPayoutCsv,
  CATEGORY_ORDER,
  type PayoutItem,
  type PayoutCategory,
  type PayoutStatus,
} from "./payout-data";
import { ReviewPayModal } from "./review-pay-modal";

type PrimaryTab = "ready" | "skipped" | "paid" | "cancelled" | "all";
type ViewMode = "list" | "group" | "calendar";
type QuickFilter = "due_today" | "high_value" | "overdue" | "workforce" | "partners" | "expenses";

const CATEGORY_META: Record<
  PayoutCategory,
  { label: string; subtitle: string; Icon: typeof HardHat; accentBg: string; accentFg: string }
> = {
  workforce: {
    label: "Workforce",
    subtitle: "Internal contractors · weekly fee",
    Icon: HardHat,
    accentBg: "bg-[#020040]/8",
    accentFg: "text-[#020040]",
  },
  partners: {
    label: "Partners",
    subtitle: "External trades · self-bills",
    Icon: Building2,
    accentBg: "bg-[#020040]/8",
    accentFg: "text-[#020040]",
  },
  expenses: {
    label: "Expenses",
    subtitle: "Suppliers · utilities · software",
    Icon: Receipt,
    accentBg: "bg-amber-500/15",
    accentFg: "text-amber-700",
  },
};

export default function PayoutPage() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [items, setItems] = useState<PayoutItem[]>([]);
  const [overdueItems, setOverdueItems] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("ready");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("group");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [localSkipped, setLocalSkipped] = useState<Set<string>>(new Set());
  const [localPaid, setLocalPaid] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<PayoutCategory>>(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);

  const { weekStart, weekEnd, weekLabel } = getWeekFromAnchor(anchor);

  const weekHeadline = useMemo(() => {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    const weekNum = Number(weekLabel.slice(-2));
    const startStr = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const endStr = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return `Wk ${weekNum} · ${startStr}–${endStr}`;
  }, [weekStart, weekEnd, weekLabel]);

  const cutoffLine = useMemo(() => {
    const end = new Date(weekEnd);
    const payoutDay = new Date(end.getTime() + 86400000);
    const cutoff = `Cutoff ${end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} 23:59`;
    const payout = `Payout ${payoutDay.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
    return `${cutoff} · ${payout}`;
  }, [weekEnd]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items: weekItems, overdueItems: od } = await fetchPayoutWeek(anchor);
      setItems(weekItems);
      setOverdueItems(od);
    } catch (e) {
      console.error("Payout load failed", e);
      toast.error(e instanceof Error ? e.message : "Failed to load payout");
    } finally {
      setLoading(false);
    }
  }, [anchor]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [weekStart, weekEnd]);

  /** Apply local overrides (skipped / paid this session) on top of the fetched status. */
  const effectiveStatus = useCallback(
    (it: PayoutItem): PayoutStatus => {
      if (localPaid.has(it.id)) return "paid";
      if (localSkipped.has(it.id)) return "skipped";
      return it.status;
    },
    [localPaid, localSkipped],
  );

  /** Counts per primary tab — always reflect the current week, regardless of quick filters. */
  const primaryCounts = useMemo(() => {
    const counts = { ready: 0, skipped: 0, paid: 0, cancelled: 0, all: items.length };
    for (const it of items) {
      const st = effectiveStatus(it);
      if (st === "ready") counts.ready++;
      else if (st === "skipped") counts.skipped++;
      else if (st === "paid") counts.paid++;
      else if (st === "cancelled") counts.cancelled++;
    }
    return counts;
  }, [items, effectiveStatus]);

  const filteredItems = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const st = effectiveStatus(it);
      if (primaryTab !== "all" && st !== primaryTab) return false;

      if (q && !`${it.name} ${it.reference} ${it.description ?? ""}`.toLowerCase().includes(q)) return false;

      // Quick filters act as ANDs (multi-select constraint).
      if (quickFilters.has("workforce") && it.category !== "workforce") return false;
      if (quickFilters.has("partners") && it.category !== "partners") return false;
      if (quickFilters.has("expenses") && it.category !== "expenses") return false;
      if (quickFilters.has("due_today") && it.dueDate !== today) return false;
      if (quickFilters.has("high_value") && it.amount <= 1000) return false;
      if (quickFilters.has("overdue")) {
        if (!it.dueDate || it.dueDate >= today || st !== "ready") return false;
      }
      return true;
    });
  }, [items, primaryTab, quickFilters, search, effectiveStatus]);

  const quickCounts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let overdue = 0;
    for (const it of items) {
      const st = effectiveStatus(it);
      if (st !== "ready") continue;
      if (it.dueDate && it.dueDate < today) overdue++;
    }
    return { overdue };
  }, [items, effectiveStatus]);

  const kpis = useMemo(() => {
    const totals: Record<PayoutCategory, { amount: number; count: number }> = {
      workforce: { amount: 0, count: 0 },
      partners: { amount: 0, count: 0 },
      expenses: { amount: 0, count: 0 },
    };
    let grand = 0;
    for (const it of items) {
      const st = effectiveStatus(it);
      if (st === "cancelled") continue;
      totals[it.category].amount += it.amount;
      totals[it.category].count += 1;
      grand += it.amount;
    }
    return { ...totals, grand, grandCount: items.filter((i) => effectiveStatus(i) !== "cancelled").length };
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
        if (effectiveStatus(r) !== "ready") continue;
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  };

  const toggleCategory = (cat: PayoutCategory) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleQuickFilter = (q: QuickFilter) => {
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q);
      else next.add(q);
      return next;
    });
  };

  const markPaidLocal = (id: string) => {
    setLocalPaid((prev) => new Set(prev).add(id));
    setLocalSkipped((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success("Marked paid (session)");
  };

  const skipLocal = (id: string) => {
    setLocalSkipped((prev) => new Set(prev).add(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.message("Skipped for this payout run");
  };

  const exportSelected = () => {
    const rows = selectedItems.length > 0 ? selectedItems : filteredItems;
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const csv = buildPayoutCsv(rows, weekLabel);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-${weekLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export ready");
  };

  const handleConfirmPay = async (method: "bank_transfer" | "manual") => {
    for (const it of selectedItems) markPaidLocal(it.id);
    setReviewOpen(false);
    toast.success(`${selectedItems.length} item(s) marked paid (${method === "bank_transfer" ? "bank transfer" : "manual"})`);
  };

  // ── Week navigation ────────────────────────────────────────────────────────
  const goPrev = () => setAnchor((a) => shiftWeek(a, -1));
  const goNext = () => setAnchor((a) => shiftWeek(a, 1));
  const goThis = () => setAnchor(new Date());

  const overdueTotal = useMemo(() => overdueItems.reduce((s, i) => s + i.amount, 0), [overdueItems]);
  const earliestOverdueWeek = useMemo(() => {
    if (overdueItems.length === 0) return null;
    const sorted = [...overdueItems].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return sorted[0].weekLabel;
  }, [overdueItems]);

  return (
    <PageTransition>
      <div className="space-y-4 px-1 sm:px-0">
        {/* 1. Header */}
        <PageHeader
          title="Payout"
          subtitle="Pay your workforce, partners, and supplier bills in one run."
        >
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={exportSelected}
          >
            Export file
          </Button>
          <Link href="/finance/bills">
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} className="bg-[#ED4B00] hover:bg-[#D84300] text-white border-[#ED4B00] hover:border-[#D84300]">
              Add expense
            </Button>
          </Link>
        </PageHeader>

        {/* 2. Week selector card */}
        <div className="rounded-2xl border border-border-light bg-card px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#020040]/8 text-[#020040]">
                <Calendar className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-[#1C1917]">{weekHeadline}</p>
                <p className="text-[11px] text-text-tertiary">{cutoffLine}</p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1 rounded-xl border border-border-light bg-[#FAFAFB] p-1">
              <button
                type="button"
                onClick={goPrev}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-card"
                title="Previous week"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <button
                type="button"
                onClick={goThis}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
                  isThisWeek(anchor)
                    ? "bg-[#ED4B00] text-white"
                    : "text-text-secondary hover:bg-card",
                )}
              >
                This week
              </button>
              <button
                type="button"
                onClick={goNext}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-card"
                title="Next week"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* 3. Overdue banner (conditional) */}
        {overdueItems.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border bg-[#FEF5F3] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "#F5BFBF" }}>
            <div className="flex items-start gap-2 min-w-0">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#A32D2D]/10 text-[#A32D2D]">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#A32D2D]">
                  {overdueItems.length} item{overdueItems.length === 1 ? "" : "s"} overdue payout
                </p>
                <p className="text-[11px] text-[#A32D2D]/90">
                  <span className="tabular-nums font-semibold">{formatCurrency(overdueTotal)}</span>
                  {earliestOverdueWeek ? <> still open from {earliestOverdueWeek}</> : null}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-[#F5BFBF] bg-card text-[#A32D2D] hover:bg-white"
              onClick={() => {
                setPrimaryTab("ready");
                setQuickFilters((prev) => {
                  const next = new Set(prev);
                  next.add("overdue");
                  return next;
                });
              }}
            >
              Review overdue
            </Button>
          </div>
        ) : null}

        {/* 4. KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label="Workforce"
            value={kpis.workforce.amount}
            count={kpis.workforce.count}
            Icon={HardHat}
            accent="navy"
          />
          <KpiTile
            label="Partners"
            value={kpis.partners.amount}
            count={kpis.partners.count}
            Icon={Building2}
            accent="navy"
          />
          <KpiTile
            label="Expenses"
            value={kpis.expenses.amount}
            count={kpis.expenses.count}
            Icon={Receipt}
            accent="amber"
          />
          <div
            className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5"
            style={{ backgroundColor: "#FFF8F3", borderColor: "#F5CFB8" }}
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#B25418]">Grand total</p>
              <p className="text-base font-semibold tabular-nums leading-tight text-[#ED4B00]" style={{ fontSize: 16 }}>
                {formatCurrency(kpis.grand)}
              </p>
              <p className="text-[11px] text-[#733712]">{kpis.grandCount} items · {weekHeadline.split(" · ")[0]}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#ED4B00]/15 text-[#ED4B00]">
              <Receipt className="h-4 w-4" aria-hidden />
            </div>
          </div>
        </div>

        {/* 5a. Primary tabs + view switcher + search */}
        <div className="flex flex-col gap-2 border-b border-border-light">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "ready", label: "Ready", count: primaryCounts.ready },
                  { id: "skipped", label: "Skipped", count: primaryCounts.skipped },
                  { id: "paid", label: "Paid", count: primaryCounts.paid },
                  { id: "cancelled", label: "Cancelled", count: primaryCounts.cancelled },
                  { id: "all", label: "All", count: primaryCounts.all },
                ] as Array<{ id: PrimaryTab; label: string; count: number }>
              ).map((t) => {
                const active = primaryTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPrimaryTab(t.id)}
                    className={cn(
                      "relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors",
                      active ? "font-semibold text-[#ED4B00]" : "font-medium text-[#6B6B70] hover:text-text-primary",
                    )}
                  >
                    {t.label}
                    <span
                      className={cn(
                        "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                        active ? "bg-[#FFF1EB] text-[#ED4B00]" : "bg-[#F1EFE8] text-[#6B6B70]",
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
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-tertiary" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, ref..."
                  className="pl-7 w-[240px]"
                />
              </div>
              <div className="inline-flex rounded-lg border border-border-light bg-card p-0.5">
                {(
                  [
                    { id: "list", Icon: LayoutList, title: "List" },
                    { id: "group", Icon: LayoutGrid, title: "Group" },
                    { id: "calendar", Icon: CalendarDays, title: "Calendar" },
                  ] as Array<{ id: ViewMode; Icon: typeof LayoutList; title: string }>
                ).map(({ id, Icon, title }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setView(id)}
                    title={title}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                      view === id
                        ? "bg-[#020040] text-white"
                        : "text-text-tertiary hover:bg-surface-hover",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" icon={<FilterIcon className="h-3.5 w-3.5" />}>
                Filter
              </Button>
            </div>
          </div>
        </div>

        {/* 5b. Quick filters — combine with primary tab */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mr-1">Quick</span>
          <QuickPill
            active={quickFilters.has("due_today")}
            onClick={() => toggleQuickFilter("due_today")}
            label="Due today"
          />
          <QuickPill
            active={quickFilters.has("high_value")}
            onClick={() => toggleQuickFilter("high_value")}
            label="High value > £1k"
          />
          <QuickPill
            active={quickFilters.has("overdue")}
            onClick={() => toggleQuickFilter("overdue")}
            label={`Overdue ${quickCounts.overdue > 0 ? `· ${quickCounts.overdue}` : ""}`}
            tone="danger"
          />
          <span className="mx-1 h-4 w-px bg-border-light" aria-hidden />
          <QuickPill
            active={quickFilters.has("workforce")}
            onClick={() => toggleQuickFilter("workforce")}
            label="Workforce only"
          />
          <QuickPill
            active={quickFilters.has("partners")}
            onClick={() => toggleQuickFilter("partners")}
            label="Partners only"
          />
          <QuickPill
            active={quickFilters.has("expenses")}
            onClick={() => toggleQuickFilter("expenses")}
            label="Expenses only"
          />
        </div>

        {/* 6. Grouped list */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-light bg-surface-hover/30 py-10 text-center text-sm text-text-tertiary">
            Nothing matches these filters. Try loosening them or switching week.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const meta = CATEGORY_META[g.key];
              const Icon = meta.Icon;
              const total = g.rows.reduce((s, i) => s + i.amount, 0);
              const readyRows = g.rows.filter((r) => effectiveStatus(r) === "ready");
              const allSelected = readyRows.length > 0 && readyRows.every((r) => selectedIds.has(r.id));
              const collapsed = collapsedGroups.has(g.key);
              return (
                <div key={g.key} className="rounded-xl border border-border-light bg-card overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-border-light bg-[#FAFAFB] px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleCategory(g.key)}
                        className="text-text-tertiary"
                        aria-label={collapsed ? "Expand" : "Collapse"}
                      >
                        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => setSelectionFromRows(readyRows, e.target.checked)}
                        disabled={readyRows.length === 0}
                        aria-label={`Select all ${meta.label}`}
                      />
                      <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", meta.accentBg, meta.accentFg)}>
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1C1917]">
                          {meta.label}
                          <span className="ml-1.5 text-[11px] font-medium text-text-tertiary">
                            {g.rows.length} item{g.rows.length === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="text-[11px] text-text-tertiary">{meta.subtitle}</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-[#020040]">
                      {formatCurrency(total)}
                    </p>
                  </div>

                  {collapsed ? null : (
                    <div className="divide-y divide-border-light">
                      {g.rows.map((row) => {
                        const st = effectiveStatus(row);
                        const isReady = st === "ready";
                        return (
                          <PayoutRow
                            key={row.id}
                            row={row}
                            status={st}
                            selected={selectedIds.has(row.id)}
                            onToggleSelect={() => toggleOne(row.id)}
                            onMarkPaid={() => markPaidLocal(row.id)}
                            onSkip={() => skipLocal(row.id)}
                            disabled={!isReady}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 7. Sticky footer */}
        {selectedIds.size > 0 ? (
          <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-2xl border border-border-light bg-card px-4 py-2.5 shadow-xl">
            <p className="text-xs font-medium text-text-primary">
              <span className="font-semibold text-[#ED4B00] tabular-nums">{selectedIds.size}</span> item{selectedIds.size === 1 ? "" : "s"} selected ·{" "}
              <span className="font-semibold tabular-nums text-[#ED4B00]">{formatCurrency(selectedTotal)}</span>
            </p>
            <Button variant="outline" size="sm" onClick={exportSelected}>
              Export selected
            </Button>
            <Button
              size="sm"
              onClick={() => setReviewOpen(true)}
              className="bg-[#ED4B00] hover:bg-[#D84300] text-white border-[#ED4B00] hover:border-[#D84300]"
            >
              Review &amp; pay
            </Button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] font-medium text-text-tertiary hover:text-text-primary"
            >
              Clear
            </button>
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
// Sub-components (kept inline — this page is the only consumer)
// ──────────────────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  count,
  Icon,
  accent,
}: {
  label: string;
  value: number;
  count: number;
  Icon: typeof HardHat;
  accent: "navy" | "amber";
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
        <p className="text-base font-semibold tabular-nums leading-tight text-[#020040]" style={{ fontSize: 16 }}>
          {formatCurrency(value)}
        </p>
        <p className="text-[11px] text-text-secondary">{count} item{count === 1 ? "" : "s"}</p>
      </div>
      <div
        className={cn(
          "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg",
          accent === "amber" ? "bg-amber-500/15 text-amber-700" : "bg-[#020040]/8 text-[#020040]",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

function QuickPill({
  active,
  onClick,
  label,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: "neutral" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
        active
          ? danger
            ? "bg-[#A32D2D] text-white"
            : "bg-[#020040] text-white"
          : danger
            ? "bg-[#FEF5F3] text-[#A32D2D] hover:bg-[#FCE4DF]"
            : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary",
      )}
    >
      {label}
    </button>
  );
}

function PayoutRow({
  row,
  status,
  selected,
  onToggleSelect,
  onMarkPaid,
  onSkip,
  disabled,
}: {
  row: PayoutItem;
  status: PayoutStatus;
  selected: boolean;
  onToggleSelect: () => void;
  onMarkPaid: () => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  const statusChip = statusChipFor(status);
  const highlightUnpaid = status === "ready";
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-3 py-2 transition-colors sm:flex-row sm:items-center sm:gap-3",
        highlightUnpaid && "bg-[#FFFDFA]",
        !highlightUnpaid && "bg-card",
        disabled && status !== "paid" && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={disabled}
          aria-label={`Select ${row.name}`}
        />
        <Link
          href={row.linkHref}
          target="_blank"
          rel="noopener"
          className="shrink-0"
          title={`Open ${row.name}`}
        >
          <Avatar name={row.avatarName} size="xs" className="ring-2 ring-transparent hover:ring-[#020040]/20 transition-shadow" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={row.linkHref}
              target="_blank"
              rel="noopener"
              className="truncate text-sm font-semibold text-text-primary hover:text-[#ED4B00] hover:underline"
              title={row.name}
            >
              {row.name}
            </Link>
          </div>
          <p className="truncate text-[11px] text-text-tertiary">{row.description ?? "—"}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-text-secondary sm:w-56 sm:min-w-0 sm:flex-shrink-0">
        <Link
          href={row.linkHref}
          target="_blank"
          rel="noopener"
          className="font-mono text-[10px] text-[#020040] hover:underline inline-flex items-center gap-0.5 truncate"
          title={row.reference}
        >
          {row.reference}
          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
        </Link>
        {typeof row.jobsCount === "number" && row.jobsCount > 0 ? (
          <span className="shrink-0">· {row.jobsCount} job{row.jobsCount === 1 ? "" : "s"}</span>
        ) : null}
        <span className="shrink-0 text-text-tertiary">· {row.weekLabel.replace(/^\d{4}-W/, "Wk ")}</span>
      </div>

      <div className="hidden sm:block sm:w-24 text-[11px] text-text-tertiary text-right whitespace-nowrap">
        {row.bankLast4 ?? "—"}
      </div>

      <div className="text-sm font-semibold tabular-nums text-text-primary sm:w-24 sm:text-right">
        {formatCurrency(row.amount)}
      </div>

      <div className="flex items-center gap-1 sm:w-36 sm:justify-end">
        {status === "ready" ? (
          <>
            <button
              type="button"
              onClick={onMarkPaid}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#0F6E56]/30 bg-[#EFF7F3] text-[#0F6E56] transition-colors hover:bg-[#DBEEE5]"
              title="Mark paid"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex h-7 px-2 items-center justify-center rounded-md border border-border-light bg-card text-[11px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover"
              title="Skip this payout"
            >
              Skip
            </button>
          </>
        ) : (
          <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", statusChip.className)}>
            {statusChip.Icon ? <statusChip.Icon className="h-3 w-3" /> : null}
            {statusChip.label}
          </span>
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

function statusChipFor(status: PayoutStatus): { label: string; Icon: typeof Check | null; className: string } {
  if (status === "paid") return { label: "Paid", Icon: Check, className: "bg-[#EFF7F3] text-[#0F6E56]" };
  if (status === "skipped") return { label: "Skipped", Icon: XIcon, className: "bg-[#F1EFE8] text-[#6B6B70]" };
  if (status === "cancelled") return { label: "Cancelled", Icon: XIcon, className: "bg-[#FEF5F3] text-[#A32D2D]" };
  return { label: "Ready", Icon: null, className: "bg-[#FFF1EB] text-[#ED4B00]" };
}
