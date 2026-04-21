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
  Users,
  Wrench,
  CreditCard,
  DollarSign,
  Plus,
  Search,
  Check,
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

type PrimaryTab = "all" | "ready" | "skipped" | "paid" | "cancelled";
type QuickFilter = "due_today" | "high_value" | "overdue" | "workforce" | "partners" | "expenses";
type WeekMode = "single" | "range";

const CATEGORY_META: Record<
  PayoutCategory,
  { label: string; payMethodSubtitle: string; Icon: typeof Users }
> = {
  workforce: {
    label: "Workforce",
    payMethodSubtitle: "bank transfer",
    Icon: Users,
  },
  partners: {
    label: "Partners",
    payMethodSubtitle: "bank transfer · every 2 Fridays",
    Icon: Wrench,
  },
  expenses: {
    label: "Expenses",
    payMethodSubtitle: "direct debit · weekly",
    Icon: CreditCard,
  },
};

/** Renders £4,200.00 with the decimals slightly smaller (£4,200.**00** look). */
function splitAmount(n: number): { whole: string; decimals: string } {
  const formatted = formatCurrency(n);
  const dotIdx = formatted.lastIndexOf(".");
  if (dotIdx === -1) return { whole: formatted, decimals: "" };
  return {
    whole: formatted.slice(0, dotIdx),
    decimals: formatted.slice(dotIdx),
  };
}

export default function PayoutPage() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [weekMode, setWeekMode] = useState<WeekMode>("single");
  const [items, setItems] = useState<PayoutItem[]>([]);
  const [overdueItems, setOverdueItems] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("all");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());
  const [search, setSearch] = useState("");

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
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = sameMonth
      ? String(start.getDate())
      : start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const endStr = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return `Wk ${weekNum} · ${startStr} – ${endStr}`;
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

  const effectiveStatus = useCallback(
    (it: PayoutItem): PayoutStatus => {
      if (localPaid.has(it.id)) return "paid";
      if (localSkipped.has(it.id)) return "skipped";
      return it.status;
    },
    [localPaid, localSkipped],
  );

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

  const goPrev = () => setAnchor((a) => shiftWeek(a, -1));
  const goNext = () => setAnchor((a) => shiftWeek(a, 1));
  const goThis = () => setAnchor(new Date());

  const overdueTotal = useMemo(() => overdueItems.reduce((s, i) => s + i.amount, 0), [overdueItems]);
  const earliestOverdueWeek = useMemo(() => {
    if (overdueItems.length === 0) return null;
    const sorted = [...overdueItems].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return sorted[0].weekLabel.replace(/^\d{4}-W/, "Wk ");
  }, [overdueItems]);

  return (
    <PageTransition>
      {/* Bottom padding so the sticky footer never covers content. */}
      <div className="space-y-4 px-1 pb-20 sm:px-0">
        {/* 1. Header */}
        <PageHeader
          title="Payout"
          subtitle="Operations' weekly payment run — Workforce, Partners & Expenses"
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
            <Button
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              className="bg-[#020040] hover:bg-[#020040]/90 text-white border-[#020040]"
            >
              Add expense
            </Button>
          </Link>
        </PageHeader>

        {/* 2. Week selector card */}
        <div className="rounded-2xl border border-border-light bg-card px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 min-w-0">
              <Calendar className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
              <div className="min-w-0">
                <p className="text-lg font-semibold text-[#1C1917] leading-tight">{weekHeadline}</p>
                <p className="mt-0.5 text-[11px] text-text-tertiary">{cutoffLine}</p>
              </div>
            </div>
            <div className="inline-flex items-center gap-0.5 rounded-xl border border-border-light bg-[#FAFAFB] p-0.5">
              <SegBtn onClick={goPrev} title="Previous week">
                <ChevronLeft className="h-3 w-3" /> Previous
              </SegBtn>
              <SegBtn
                onClick={() => {
                  setWeekMode("single");
                  goThis();
                }}
                active={weekMode === "single" && isThisWeek(anchor)}
              >
                This week
              </SegBtn>
              <SegBtn onClick={goNext} title="Next week">
                Next week
              </SegBtn>
              <SegBtn
                onClick={() => setWeekMode(weekMode === "range" ? "single" : "range")}
                active={weekMode === "range"}
              >
                Range <ChevronDown className="h-3 w-3" />
              </SegBtn>
            </div>
          </div>
        </div>

        {/* 3. Overdue banner */}
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
            label="WORKFORCE"
            amount={kpis.workforce.amount}
            subtitle={`${kpis.workforce.count} contractor${kpis.workforce.count === 1 ? "" : "s"}`}
            Icon={Users}
          />
          <KpiTile
            label="PARTNERS"
            amount={kpis.partners.amount}
            subtitle={`${kpis.partners.count} self-bill${kpis.partners.count === 1 ? "" : "s"}`}
            Icon={Wrench}
          />
          <KpiTile
            label="EXPENSES"
            amount={kpis.expenses.amount}
            subtitle={`${kpis.expenses.count} bill${kpis.expenses.count === 1 ? "" : "s"}`}
            Icon={CreditCard}
          />
          <KpiTile
            label="GRAND TOTAL"
            amount={kpis.grand}
            subtitle={`${kpis.grandCount} items · ready to pay`}
            Icon={DollarSign}
            variant="accent"
          />
        </div>

        {/* 5. Filters card */}
        <div className="rounded-2xl border border-border-light bg-card px-4 py-3 sm:px-5 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              Filters
            </span>
            <PrimaryPill
              active={primaryTab === "all"}
              onClick={() => setPrimaryTab("all")}
              label={`All ${primaryCounts.all}`}
            />
            <PrimaryPill
              active={primaryTab === "ready"}
              onClick={() => setPrimaryTab("ready")}
              label="Ready"
              count={primaryCounts.ready}
              tone="ready"
            />
            <PrimaryPill
              active={primaryTab === "skipped"}
              onClick={() => setPrimaryTab("skipped")}
              label="Skipped"
              count={primaryCounts.skipped}
            />
            <PrimaryPill
              active={primaryTab === "paid"}
              onClick={() => setPrimaryTab("paid")}
              label="Paid"
              count={primaryCounts.paid}
            />
            <PrimaryPill
              active={primaryTab === "cancelled"}
              onClick={() => setPrimaryTab("cancelled")}
              label="Cancelled"
              count={primaryCounts.cancelled}
            />
            <span className="mx-1 h-5 w-px bg-border-light" aria-hidden />
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
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <QuickPill
              active={quickFilters.has("overdue")}
              onClick={() => toggleQuickFilter("overdue")}
              label="Overdue"
              count={quickCounts.overdue}
              tone="danger"
            />
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

          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, SB, JOB..."
              className="pl-8"
            />
          </div>
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
          <div className="rounded-2xl border border-border-light bg-card overflow-hidden">
            {groups.map((g, idx) => {
              const meta = CATEGORY_META[g.key];
              const Icon = meta.Icon;
              const total = g.rows.reduce((s, i) => s + i.amount, 0);
              const readyRows = g.rows.filter((r) => effectiveStatus(r) === "ready");
              const allSelected = readyRows.length > 0 && readyRows.every((r) => selectedIds.has(r.id));
              const collapsed = collapsedGroups.has(g.key);
              const countSub = `${g.rows.length} ${g.key === "workforce" ? (g.rows.length === 1 ? "contractor" : "contractors") : g.key === "partners" ? (g.rows.length === 1 ? "self-bill" : "self-bills") : (g.rows.length === 1 ? "bill" : "bills")}`;
              const totalSplit = splitAmount(total);
              return (
                <div key={g.key} className={cn(idx > 0 && "border-t border-border-light")}>
                  <div className="flex items-center justify-between gap-3 bg-card px-3 py-3 sm:px-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => setSelectionFromRows(readyRows, e.target.checked)}
                        disabled={readyRows.length === 0}
                        aria-label={`Select all ${meta.label}`}
                        className="h-4 w-4"
                      />
                      <Icon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p className="text-sm font-semibold text-[#1C1917]">{meta.label}</p>
                          <p className="text-[11px] text-text-tertiary">
                            {countSub} · {meta.payMethodSubtitle}
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
                        className="text-text-tertiary"
                        aria-label={collapsed ? "Expand" : "Collapse"}
                      >
                        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronDown className="h-4 w-4 rotate-180" />}
                      </button>
                    </div>
                  </div>

                  {collapsed ? null : (
                    <div>
                      {g.rows.map((row) => {
                        const st = effectiveStatus(row);
                        return (
                          <PayoutRow
                            key={row.id}
                            row={row}
                            status={st}
                            selected={selectedIds.has(row.id)}
                            onToggleSelect={() => toggleOne(row.id)}
                            onMarkPaid={() => markPaidLocal(row.id)}
                            onSkip={() => skipLocal(row.id)}
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

        {/* 7. Sticky full-width bottom footer */}
        {selectedIds.size > 0 ? (
          <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border-light bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
            <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-6 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Selected</p>
                <p className="text-sm font-semibold text-[#ED4B00]">
                  <span className="tabular-nums">{selectedIds.size}</span> item{selectedIds.size === 1 ? "" : "s"}
                  <span className="ml-1.5 font-normal text-text-secondary">·</span>
                  <span className="ml-1.5 tabular-nums">{formatCurrency(selectedTotal)}</span>
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

function SegBtn({
  onClick,
  active = false,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "bg-[#020040] text-white shadow-sm" : "text-text-secondary hover:bg-card",
      )}
    >
      {children}
    </button>
  );
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
        "rounded-2xl border px-4 py-3",
        isAccent ? "" : "border-border-light bg-card",
      )}
      style={isAccent ? { backgroundColor: "#FFF8F3", borderColor: "#F5CFB8" } : undefined}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide",
          isAccent ? "text-[#B25418]" : "text-text-tertiary",
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
        <span>{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 tabular-nums leading-tight",
          isAccent ? "text-[#ED4B00]" : "text-[#1C1917]",
        )}
      >
        <span className="text-[28px] font-bold">{whole}</span>
        <span className={cn("text-[18px] font-bold", isAccent ? "text-[#ED4B00]/70" : "text-text-tertiary")}>
          {decimals}
        </span>
      </p>
      <p
        className={cn("mt-0.5 text-[11px]", isAccent ? "text-[#733712]" : "text-text-secondary")}
      >
        {subtitle}
      </p>
    </div>
  );
}

function PrimaryPill({
  active,
  onClick,
  label,
  count,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tone?: "neutral" | "ready";
}) {
  const isReady = tone === "ready";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? "border-[#020040] bg-[#020040] text-white"
          : isReady
            ? "border-border-light bg-card text-text-primary hover:bg-surface-hover"
            : "border-border-light bg-card text-text-secondary hover:bg-surface-hover",
      )}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={cn(
            "inline-flex min-w-[18px] items-center justify-center rounded px-1 py-0 text-[10px] font-semibold tabular-nums",
            active
              ? "bg-white/15 text-white"
              : isReady
                ? "bg-[#ED4B00] text-white"
                : "bg-[#F1EFE8] text-text-secondary",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function QuickPill({
  active,
  onClick,
  label,
  count,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tone?: "neutral" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? danger
            ? "border-[#A32D2D] bg-[#A32D2D] text-white"
            : "border-[#020040] bg-[#020040] text-white"
          : danger
            ? "border-[#F5BFBF] bg-[#FEF5F3] text-[#A32D2D] hover:bg-[#FCE4DF]"
            : "border-border-light bg-card text-text-secondary hover:bg-surface-hover",
      )}
    >
      {label}
      {typeof count === "number" && count > 0 ? (
        <span
          className={cn(
            "inline-flex min-w-[18px] items-center justify-center rounded px-1 py-0 text-[10px] font-semibold tabular-nums",
            active
              ? "bg-white/20 text-white"
              : danger
                ? "bg-[#A32D2D] text-white"
                : "bg-surface-tertiary text-text-secondary",
          )}
        >
          {count}
        </span>
      ) : null}
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
}: {
  row: PayoutItem;
  status: PayoutStatus;
  selected: boolean;
  onToggleSelect: () => void;
  onMarkPaid: () => void;
  onSkip: () => void;
}) {
  const isReady = status === "ready";
  const isPaid = status === "paid";
  const amount = splitAmount(row.amount);
  const wkShort = row.weekLabel.replace(/^\d{4}-W/, "Wk ");
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-border-light px-3 py-2.5 sm:px-4",
        isReady && "bg-[#FFFDFA]",
        isPaid && "bg-card",
        !isReady && !isPaid && "bg-card opacity-80",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        disabled={!isReady}
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
        {isReady ? (
          <>
            <button
              type="button"
              onClick={onMarkPaid}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#0F6E56]/30 bg-[#EFF7F3] text-[#0F6E56] transition-colors hover:bg-[#DBEEE5]"
              title="Mark paid"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex h-7 items-center justify-center rounded-md border border-border-light bg-card px-2 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover"
              title="Skip this payout"
            >
              Skip
            </button>
          </>
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
  if (status === "skipped")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#F1EFE8] px-2 py-0.5 text-[11px] font-semibold text-[#6B6B70]">
        Skipped
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
