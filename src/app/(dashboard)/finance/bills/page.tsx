"use client";

import { useState, useEffect, useCallback, useMemo, type MouseEvent } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus,
  FileCheck,
  DollarSign,
  Loader2,
  Banknote,
  Pencil,
  Layers,
  ChevronDown,
  ChevronRight,
  Archive,
  Ban,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { Bill, BillStatus, BillRecurrence } from "@/types/database";
import {
  listBills,
  createBill,
  updateBill,
  markBillPaid,
  approveBillOrSeries,
  approveAllSubmittedInScope,
  archiveBillsByIds,
  listBillsInSameSeries,
} from "@/services/bills";
import { useProfile } from "@/hooks/use-profile";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import {
  DEFAULT_FINANCE_PERIOD_MODE,
  getFinancePeriodClosedBounds,
  formatFinancePeriodKpiDescription,
} from "@/lib/finance-period";
import { BILL_STANDARD_CATEGORY_OPTIONS, billCategoryLabel } from "@/lib/bill-categories";
import { RECURRENCE_GENERATION_COUNTS, recurrenceLabel } from "@/lib/bill-recurrence";
import { buildBillDisplayList, recurringGroupKey, type BillDisplayItem } from "@/lib/bill-groups";

type BillsPreset = "all" | "one_off" | "recurring" | "needs_attention" | "approved" | "archived";

const BILL_STATUSES: BillStatus[] = ["submitted", "approved", "paid", "rejected", "needs_attention"];

/** Filter chips (no Paid tab). Order: All → Submitted → Approved → Needs attention → Rejected → Archived */
const BILL_FILTER_ORDER = [
  "all",
  "submitted",
  "approved",
  "needs_attention",
  "rejected",
  "archived",
] as const;

function kpiEligible(b: Bill): boolean {
  return !b.archived_at && b.status !== "rejected" && b.status !== "needs_attention";
}

const statusConfig: Record<
  BillStatus,
  { label: string; variant: "default" | "primary" | "warning" | "success" | "danger" | "info" }
> = {
  submitted: { label: "Submitted", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  paid: { label: "Paid", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  needs_attention: { label: "Needs attention", variant: "danger" },
};

export default function BillsPage() {
  const { profile } = useProfile();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  /** All = one-off + recurring; default All */
  const [billKindTab, setBillKindTab] = useState<"all" | "one_off" | "recurring">("all");
  const [billsPreset, setBillsPreset] = useState<BillsPreset>("all");
  const [showAllRows, setShowAllRows] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [saving, setSaving] = useState(false);
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [archiveSeriesTarget, setArchiveSeriesTarget] = useState<Extract<BillDisplayItem, { type: "series" }> | null>(
    null
  );
  const [archiveSeriesBusy, setArchiveSeriesBusy] = useState(false);
  /** `item.key` for recurring series while Approve all is running for that card */
  const [approveSeriesBusyKey, setApproveSeriesBusyKey] = useState<string | null>(null);

  const archiveSeriesMonthLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    []
  );

  const periodBounds = useMemo(
    () => getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor),
    [periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listBills();
      setBills(data);
    } catch {
      toast.error("Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setShowAllRows(false);
    if (billsPreset === "all") {
      setBillKindTab("all");
      setStatusFilter("all");
      return;
    }
    if (billsPreset === "one_off") {
      setBillKindTab("one_off");
      setStatusFilter("all");
      return;
    }
    if (billsPreset === "recurring") {
      setBillKindTab("recurring");
      setStatusFilter("all");
      return;
    }
    setBillKindTab("all");
    setStatusFilter(billsPreset);
  }, [billsPreset]);

  const scopedBills = useMemo(() => {
    const inPeriod = !periodBounds
      ? bills
      : bills.filter(
          (b) => b.due_date && b.due_date >= periodBounds.from && b.due_date <= periodBounds.to
        );
    const archivedScoped =
      statusFilter === "archived"
        ? inPeriod.filter((b) => b.archived_at)
        : inPeriod.filter((b) => !b.archived_at);
    const matchesKind = (b: Bill) => {
      if (billKindTab === "all") return true;
      if (billKindTab === "recurring") return !!b.is_recurring;
      return !b.is_recurring;
    };
    return archivedScoped.filter(matchesKind);
  }, [bills, periodBounds, statusFilter, billKindTab]);

  const displayList = useMemo(
    () => buildBillDisplayList(scopedBills, statusFilter),
    [scopedBills, statusFilter]
  );

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor),
    [periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor]
  );

  const billKindKpiLabel =
    billKindTab === "all" ? "All types" : billKindTab === "recurring" ? "Recurring" : "One-off";

  const kpis = useMemo(() => {
    const inPeriodEligible = !periodBounds
      ? bills.filter((b) => kpiEligible(b))
      : bills.filter(
          (b) =>
            kpiEligible(b) &&
            b.due_date &&
            b.due_date >= periodBounds.from &&
            b.due_date <= periodBounds.to
        );
    const base = inPeriodEligible.filter((b) => {
      if (billKindTab === "all") return true;
      if (billKindTab === "recurring") return !!b.is_recurring;
      return !b.is_recurring;
    });
    const pending = base.filter((b) => b.status === "submitted");
    const approved = base.filter((b) => b.status === "approved");
    const paid = base.filter((b) => b.status === "paid");
    const pendingAmt = pending.reduce((s, b) => s + Number(b.amount), 0);
    const approvedAmt = approved.reduce((s, b) => s + Number(b.amount), 0);
    const paidAmt = paid.reduce((s, b) => s + Number(b.amount), 0);
    const totalAmt = base.reduce((s, b) => s + Number(b.amount), 0);
    return {
      pendingCount: pending.length,
      pendingAmount: pendingAmt,
      approvedCount: approved.length,
      approvedAmount: approvedAmt,
      paidCount: paid.length,
      paidAmount: paidAmt,
      totalCount: base.length,
      totalAmount: totalAmt,
    };
  }, [bills, periodBounds, billKindTab]);

  const headlineKpis = useMemo(() => {
    const active = bills.filter((b) => !b.archived_at && b.status !== "rejected");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    const next30 = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);

    const overdueRows = active.filter(
      (b) => b.due_date && b.due_date < today && b.status !== "paid" && b.status !== "needs_attention",
    );
    const monthRows = active.filter(
      (b) => b.due_date?.slice(0, 7) === monthKey && b.status !== "paid" && b.status !== "needs_attention",
    );
    const next30Rows = active.filter(
      (b) => b.due_date && b.due_date >= today && b.due_date <= next30 && b.status !== "needs_attention",
    );
    const recurringMonthlyRows = active.filter(
      (b) => !!b.is_recurring && b.recurrence_interval === "monthly" && b.status !== "needs_attention",
    );
    const recurringMonthlySeriesRows = recurringMonthlyRows
      .slice()
      .sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")))
      .filter((bill, index, rows) => rows.findIndex((row) => recurringGroupKey(row) === recurringGroupKey(bill)) === index);

    const sum = (rows: Bill[]) => rows.reduce((acc, row) => acc + Number(row.amount ?? 0), 0);
    return {
      overdueAmount: sum(overdueRows),
      overdueCount: overdueRows.length,
      dueMonthAmount: sum(monthRows),
      dueMonthCount: monthRows.length,
      next30Amount: sum(next30Rows),
      recurringMonthlyAmount: sum(recurringMonthlySeriesRows),
    };
  }, [bills]);

  const compactRows = useMemo(() => {
    const rows = displayList.map((item) => {
      if (item.type === "series") {
        const head = item.all[0];
        const due = getNextDueDate(item.all);
        const visibleCount = item.visible.length;
        const status = item.visible.every((r) => r.status === "approved")
          ? "Approved"
          : item.visible.every((r) => r.status === "needs_attention")
            ? "Needs attention"
            : "Mixed";
        const cadence = recurrenceLabel(head.recurrence_interval as BillRecurrence | undefined);
        return {
          key: item.key,
          amount: Number(head.amount ?? 0),
          title: head.description,
          category: billCategoryLabel(head.category),
          meta: `${due ? `Next due ${formatDate(due)}` : "No due date"} · ${cadence} · ${visibleCount} occurrence${visibleCount === 1 ? "" : "s"}`,
          status,
          children: item.visible,
          expandable: true,
          onToggle: () => setExpandedSeries((s) => ({ ...s, [item.key]: !(s[item.key] ?? false) })),
          expanded: expandedSeries[item.key] ?? false,
        };
      }
      const row = item.bill;
      const status = statusConfig[row.status]?.label ?? row.status;
      return {
        key: row.id,
        amount: Number(row.amount ?? 0),
        title: row.description,
        category: billCategoryLabel(row.category),
        meta: `${row.due_date ? `Next due ${formatDate(row.due_date)}` : "No due date"} · ${row.is_recurring ? recurrenceLabel(row.recurrence_interval) : "One-off"} · 1 occurrence`,
        status,
        children: [] as Bill[],
        expandable: false,
        onToggle: () => undefined,
        expanded: false,
      };
    });
    return rows.sort((a, b) => a.title.localeCompare(b.title));
  }, [displayList, expandedSeries]);

  const visibleCompactRows = showAllRows ? compactRows : compactRows.slice(0, 4);

  const handleApproveAllInSeries = async (seriesKey: string) => {
    const submittedInSeries = scopedBills.filter(
      (b) => !b.archived_at && recurringGroupKey(b) === seriesKey && b.status === "submitted"
    );
    if (submittedInSeries.length === 0) {
      toast.error("No submitted lines for this recurring bill.");
      return;
    }
    if (
      !confirm(
        `Approve all ${submittedInSeries.length} submitted line(s) for this recurring bill?`
      )
    ) {
      return;
    }
    setApproveSeriesBusyKey(seriesKey);
    try {
      const { totalApproved } = await approveAllSubmittedInScope(submittedInSeries);
      toast.success(totalApproved > 0 ? `Approved ${totalApproved} line(s).` : "Nothing to approve.");
      load();
    } catch {
      toast.error("Failed to approve");
    } finally {
      setApproveSeriesBusyKey(null);
    }
  };

  const handleApprove = async (bill: Bill) => {
    try {
      const { approvedCount } = await approveBillOrSeries(bill.id);
      if (bill.is_recurring && approvedCount > 1) {
        toast.success(`Approved ${approvedCount} occurrences in this recurring series.`);
      } else {
        toast.success("Bill approved");
      }
      load();
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async (bill: Bill) => {
    try {
      await updateBill(bill.id, { status: "rejected" });
      toast.success("Bill rejected");
      load();
    } catch {
      toast.error("Failed to reject");
    }
  };

  const handleMarkPaid = async (bill: Bill) => {
    try {
      await markBillPaid(bill.id);
      toast.success("Marked paid — updated in Pay Run and cost views for this line.");
      load();
    } catch {
      toast.error("Failed to mark paid");
    }
  };

  const openEditBill = (bill: Bill, e?: MouseEvent) => {
    e?.stopPropagation();
    setEditing(bill);
    setModalOpen(true);
  };

  const handleVoidBill = async (bill: Bill) => {
    if (
      !confirm(
        `Void this line (${formatDate(bill.due_date)} · ${formatCurrency(bill.amount)})? It will be archived: removed from pay runs, default lists, and cost KPIs (like deleted). You can restore from the Archived filter.`,
      )
    ) {
      return;
    }
    try {
      await archiveBillsByIds([bill.id]);
      toast.success("Bill voided — archived and removed from pay runs");
      load();
    } catch {
      toast.error("Failed to void bill");
    }
  };

  const handleNeedsAttention = async (bill: Bill) => {
    try {
      await updateBill(bill.id, { status: "needs_attention" });
      toast.success("Flagged for attention");
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleClearAttention = async (bill: Bill) => {
    try {
      await updateBill(bill.id, { status: "submitted" });
      toast.success("Moved back to Submitted");
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const executeArchiveSeriesChoice = async (archiveAll: boolean) => {
    const item = archiveSeriesTarget;
    if (!item) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seriesKey = item.key;
    const ids = archiveAll
      ? bills
          .filter((b) => !b.archived_at && recurringGroupKey(b) === seriesKey)
          .map((b) => b.id)
      : bills
          .filter(
            (b) =>
              !b.archived_at &&
              recurringGroupKey(b) === seriesKey &&
              b.due_date &&
              b.due_date.slice(0, 7) === monthKey
          )
          .map((b) => b.id);
    if (ids.length === 0) {
      toast.error(
        archiveAll
          ? "No bills to archive in this series."
          : "No bill in this series with a due date in the current month."
      );
      return;
    }
    setArchiveSeriesBusy(true);
    try {
      await archiveBillsByIds(ids);
      toast.success(`Archived ${ids.length} bill(s). Removed from pay runs.`);
      setArchiveSeriesTarget(null);
      load();
    } catch {
      toast.error("Failed to archive");
    } finally {
      setArchiveSeriesBusy(false);
    }
  };

  const handleRestoreFromArchive = async (bill: Bill) => {
    try {
      await updateBill(bill.id, { archived_at: null });
      toast.success("Bill restored to the active list");
      load();
    } catch {
      toast.error("Failed to restore");
    }
  };

  const handleArchiveFromModal = async () => {
    if (!editing) return;
    if (
      !confirm(
        "Archive this bill? It will disappear from the main list and pay runs until you restore it from the Archived filter."
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await archiveBillsByIds([editing.id]);
      toast.success("Bill archived — removed from pay runs");
      setModalOpen(false);
      setEditing(null);
      load();
    } catch {
      toast.error("Failed to archive");
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreFromModal = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateBill(editing.id, { archived_at: null });
      toast.success("Bill restored");
      setModalOpen(false);
      setEditing(null);
      load();
    } catch {
      toast.error("Failed to restore");
    } finally {
      setSaving(false);
    }
  };

  const formatStatusSummary = (bills: Bill[]) => {
    const order: BillStatus[] = ["submitted", "approved", "paid", "rejected", "needs_attention"];
    const counts = new Map<BillStatus, number>();
    for (const b of bills) {
      counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    }
    return order
      .filter((s) => (counts.get(s) ?? 0) > 0)
      .map((s) => `${counts.get(s)} ${statusConfig[s].label.toLowerCase()}`)
      .join(" · ");
  };

  /** Next due line in this group (skips paid/rejected); used in card header visibility. */
  function getNextDueDate(rows: Bill[]): string | null {
    const candidate = rows
      .filter((b) => !b.archived_at && b.status !== "paid" && b.status !== "rejected" && !!b.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
    if (candidate?.due_date) return candidate.due_date;
    const fallback = rows
      .filter((b) => !b.archived_at && !!b.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
    return fallback?.due_date ?? null;
  }

  /** One badge for the series row: single status or “Mixed”. */
  const renderSeriesHeadlineStatusBadge = (visible: Bill[]) => {
    const statuses = [...new Set(visible.map((b) => b.status))];
    if (statuses.length === 1) {
      const s = statuses[0];
      const c = statusConfig[s];
      return (
        <Badge variant={c?.variant ?? "default"} size="sm" dot>
          {c?.label ?? s}
        </Badge>
      );
    }
    return (
      <span className="inline-flex" title="Multiple workflow statuses in this series">
        <Badge variant="default" size="sm" dot>
          Mixed
        </Badge>
      </span>
    );
  };

  const renderStatusBadge = (r: Bill) => {
    const c = statusConfig[r.status];
    return (
      <Badge variant={c?.variant ?? "default"} dot>
        {c?.label ?? r.status}
      </Badge>
    );
  };

  const canVoidBill = (r: Bill) =>
    !r.archived_at && r.status !== "paid";

  const renderBillActions = (r: Bill) => (
    <div className="flex flex-wrap gap-1 justify-end items-center">
      <Button variant="ghost" size="sm" icon={<Pencil className="h-3 w-3" />} onClick={() => openEditBill(r)}>
        Edit
      </Button>
      {r.archived_at ? (
        <Button variant="ghost" size="sm" onClick={() => handleRestoreFromArchive(r)}>
          Restore
        </Button>
      ) : null}
      {!r.archived_at && (r.status === "submitted" || r.status === "needs_attention") && (
        <>
          <Button variant="ghost" size="sm" onClick={() => handleApprove(r)}>
            Approve
          </Button>
          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => handleReject(r)}>
            Reject
          </Button>
        </>
      )}
      {!r.archived_at && (r.status === "approved" || r.status === "needs_attention") && (
        <Button
          variant="secondary"
          size="sm"
          className="font-semibold"
          onClick={() => void handleMarkPaid(r)}
        >
          Mark paid
        </Button>
      )}
      {!r.archived_at && (r.status === "submitted" || r.status === "approved") && (
        <Button variant="ghost" size="sm" className="text-amber-700" onClick={() => handleNeedsAttention(r)}>
          Needs attention
        </Button>
      )}
      {!r.archived_at && r.status === "needs_attention" && (
        <Button variant="ghost" size="sm" onClick={() => handleClearAttention(r)}>
          Back to submitted
        </Button>
      )}
      {canVoidBill(r) ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-text-tertiary"
          icon={<Ban className="h-3 w-3" />}
          title="Archive this line — removes it from pay runs and cost KPIs"
          onClick={() => void handleVoidBill(r)}
        >
          Void
        </Button>
      ) : null}
    </div>
  );

  return (
    <PageTransition>
      <div className="space-y-5 px-1 sm:px-0">
        <PageHeader
          title="Bills & expenses"
          subtitle="Filter by All, One-off, or Recurring; then by workflow. Period: All · Monthly · Week · Date range (default: current month). KPIs and the list match the bill type and the period."
        >
          <Button
            size="sm"
            icon={<Plus className="h-3 w-3" />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            Add bill
          </Button>
        </PageHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border-light bg-card p-5">
            <p className="text-3xl sm:text-[30px] font-bold tabular-nums text-red-600">{formatCurrency(headlineKpis.overdueAmount)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Overdue</p>
            <p className="mt-3 text-sm text-text-tertiary">{headlineKpis.overdueCount} bills</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-5">
            <p className="text-3xl sm:text-[30px] font-bold tabular-nums text-text-primary">{formatCurrency(headlineKpis.dueMonthAmount)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Due this month</p>
            <p className="mt-3 text-sm text-text-tertiary">{headlineKpis.dueMonthCount} bills</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-5">
            <p className="text-3xl sm:text-[30px] font-bold tabular-nums text-text-primary">{formatCurrency(headlineKpis.next30Amount)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Next 30 days</p>
            <p className="mt-3 text-sm text-text-tertiary">Cashflow</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-5">
            <p className="text-3xl sm:text-[30px] font-bold tabular-nums text-text-primary">{formatCurrency(headlineKpis.recurringMonthlyAmount)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Recurring / mo</p>
            <p className="mt-3 text-sm text-text-tertiary">Base burn</p>
          </div>
        </div>

        <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:thin]">
          <div className="inline-flex min-w-full gap-2 sm:flex sm:min-w-0 sm:flex-wrap">
            {([
              { id: "all", label: "All" },
              { id: "one_off", label: "One-off" },
              { id: "recurring", label: "Recurring" },
              { id: "needs_attention", label: "Needs attention" },
              { id: "approved", label: "Approved" },
              { id: "archived", label: "Archived" },
            ] as Array<{ id: BillsPreset; label: string }>).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setBillsPreset(chip.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-4 py-1.5 text-xs sm:text-sm font-semibold transition-colors",
                  billsPreset === chip.id
                    ? "border-primary bg-primary text-white"
                    : "border-border-light bg-card text-text-secondary hover:bg-surface-hover",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
          </div>
        ) : compactRows.length === 0 ? (
          <p className="text-sm text-text-tertiary py-10 text-center rounded-xl border border-dashed border-border-light bg-surface-hover/30">
            No bills for this filter.
          </p>
        ) : (
          <div className="rounded-2xl border border-border-light bg-card overflow-hidden">
            {visibleCompactRows.map((row) => (
              <div key={row.key} className="border-b border-border-light last:border-0">
                <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
                  <div className="min-w-0 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={row.onToggle}
                      className={cn("mt-0.5 text-text-tertiary", !row.expandable && "cursor-default")}
                      aria-label={row.expandable ? "Expand bill row" : "Bill row"}
                      disabled={!row.expandable}
                    >
                      {row.expandable ? (
                        row.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className="truncate text-base sm:text-lg font-semibold text-text-primary">{row.title}</p>
                      <p className="mt-1 truncate text-xs sm:text-sm text-text-tertiary">{row.meta}</p>
                    </div>
                  </div>
                  <div className="shrink-0 w-full sm:w-auto flex items-center justify-start sm:justify-end gap-2 sm:gap-3">
                    <p className="text-base font-semibold tabular-nums text-[#111827]">{formatCurrency(row.amount)}</p>
                    <p className={cn("text-xs sm:text-sm font-medium whitespace-nowrap", row.status === "Approved" ? "text-emerald-600" : "text-text-tertiary")}>
                      {row.status === "Approved" ? "● " : ""}
                      {row.status}
                    </p>
                  </div>
                </div>
                {row.expandable && row.expanded ? (
                  <div className="bg-surface-hover/40 px-4 pb-4 sm:px-6 sm:pb-5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Occurrences</p>
                      {renderSeriesHeadlineStatusBadge(row.children)}
                    </div>
                    <div className="space-y-3">
                      {row.children.map((bill) => (
                        <div
                          key={bill.id}
                          className="rounded-xl border border-border-light bg-card p-3 sm:p-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm sm:text-base font-semibold text-text-primary">{bill.description}</p>
                              <p className="mt-1 text-xs sm:text-sm text-text-tertiary">
                                {bill.due_date ? formatDate(bill.due_date) : "No due date"} · {billCategoryLabel(bill.category)} ·{" "}
                                {bill.is_recurring ? recurrenceLabel(bill.recurrence_interval) : "One-off"}
                              </p>
                            </div>
                            <div className="shrink-0 text-left sm:text-right">
                              <p className="text-lg sm:text-xl font-semibold tabular-nums text-text-primary">
                                {formatCurrency(Number(bill.amount ?? 0))}
                              </p>
                              <div className="mt-1">{renderStatusBadge(bill)}</div>
                            </div>
                          </div>
                          <div className="mt-3">{renderBillActions(bill)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            <div className="px-6 py-4 text-center text-sm text-text-tertiary">
              Showing {Math.min(visibleCompactRows.length, compactRows.length)} of {compactRows.length} ·{" "}
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => setShowAllRows((s) => !s)}
              >
                {showAllRows ? "Show less" : "View all"}
              </button>
            </div>
          </div>
        )}

        <Modal
          open={!!archiveSeriesTarget}
          onClose={() => !archiveSeriesBusy && setArchiveSeriesTarget(null)}
          title="Archive recurring bills"
          subtitle={
            archiveSeriesTarget
              ? `${archiveSeriesTarget.all[0]?.description ?? "Series"} — choose what to archive`
              : undefined
          }
          size="sm"
        >
          <div className="p-6 space-y-4">
            <p className="text-sm text-text-secondary">
              Archive every bill in this series, or only lines with a due date in the current calendar month (
              <span className="font-medium text-text-primary">{archiveSeriesMonthLabel}</span>).
            </p>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                disabled={archiveSeriesBusy}
                icon={archiveSeriesBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
                onClick={() => {
                  void executeArchiveSeriesChoice(true);
                }}
              >
                Archive all
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={archiveSeriesBusy}
                onClick={() => {
                  void executeArchiveSeriesChoice(false);
                }}
              >
                This month only
              </Button>
            </div>
          </div>
        </Modal>

        <BillModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          initial={editing}
          onArchive={editing && !editing.archived_at ? handleArchiveFromModal : undefined}
          onRestore={editing?.archived_at ? handleRestoreFromModal : undefined}
          onSave={async (form) => {
            setSaving(true);
            try {
              if (editing) {
                if (form.installmentAmounts && Object.keys(form.installmentAmounts).length > 0) {
                  const entries = Object.entries(form.installmentAmounts);
                  for (const [id, amt] of entries) {
                    await updateBill(id, {
                      description: form.description ?? "",
                      category: form.category,
                      amount: amt,
                    });
                  }
                  toast.success(`Updated ${entries.length} installment(s).`);
                } else {
                  await updateBill(editing.id, {
                    description: form.description ?? "",
                    category: form.category,
                    amount: form.amount ?? 0,
                    due_date: form.due_date ?? "",
                    is_recurring: form.is_recurring ?? false,
                    recurrence_interval: form.is_recurring ? form.recurrence_interval : null,
                  });
                  toast.success("Bill updated");
                }
              } else {
                const interval = form.recurrence_interval ?? "monthly";
                const nScheduled =
                  form.is_recurring && interval
                    ? form.recurringOccurrenceCount != null && form.recurringOccurrenceCount > 0
                      ? Math.min(120, Math.max(1, Math.floor(form.recurringOccurrenceCount)))
                      : RECURRENCE_GENERATION_COUNTS[interval] ?? 12
                    : 1;
                await createBill({
                  description: form.description ?? "",
                  amount: form.amount ?? 0,
                  due_date: form.due_date ?? "",
                  is_recurring: form.is_recurring ?? false,
                  recurrence_interval: form.is_recurring ? interval : undefined,
                  category: form.category,
                  recurringOccurrenceCount:
                    form.is_recurring && form.category === "debit" && form.recurringOccurrenceCount != null
                      ? form.recurringOccurrenceCount
                      : undefined,
                  submitted_by_id: profile?.id,
                  submitted_by_name: profile?.full_name,
                  status: "submitted",
                });
                if (form.is_recurring && interval) {
                  toast.success(`Bill submitted — ${nScheduled} occurrence${nScheduled === 1 ? "" : "s"} scheduled ahead.`);
                } else {
                  toast.success("Bill submitted");
                }
              }
              setModalOpen(false);
              setEditing(null);
              load();
            } catch (e) {
              const msg =
                e && typeof e === "object" && "message" in e
                  ? String((e as { message: unknown }).message)
                  : e instanceof Error
                    ? e.message
                    : "Failed to save";
              toast.error(msg);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
        />
      </div>
    </PageTransition>
  );
}

type BillModalSavePayload = Partial<Bill> & {
  /** When set, updates each bill id with its amount (recurring edit). */
  installmentAmounts?: Record<string, number>;
  /** Debit recurring: how many installments to generate (1–120). */
  recurringOccurrenceCount?: number;
};

function BillModal({
  open,
  onClose,
  initial,
  onSave,
  onArchive,
  onRestore,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: Bill | null;
  onSave: (form: BillModalSavePayload) => Promise<void>;
  onArchive?: () => Promise<void>;
  onRestore?: () => Promise<void>;
  saving: boolean;
}) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [due_date, setDueDate] = useState("");
  const [is_recurring, setIsRecurring] = useState(false);
  const [recurrence_interval, setRecurrenceInterval] = useState<BillRecurrence>("monthly");
  const [billType, setBillType] = useState<"expense" | "debit">("expense");
  /** Remaining installments for debit + recurring (new bill only). */
  const [debitInstallments, setDebitInstallments] = useState("12");
  const [seriesSiblings, setSeriesSiblings] = useState<Bill[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [amountById, setAmountById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setDescription(initial?.description ?? "");
      const cat = initial?.category ?? "";
      const isDebit = cat === "debit";
      setBillType(isDebit ? "debit" : "expense");
      setCategory(
        isDebit
          ? "debit"
          : BILL_STANDARD_CATEGORY_OPTIONS.some((o) => o.value === cat)
            ? cat
            : cat && cat !== "debit"
              ? "other"
              : ""
      );
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setDueDate(initial?.due_date ?? "");
      setIsRecurring(initial?.is_recurring ?? false);
      setRecurrenceInterval((initial?.recurrence_interval as BillRecurrence) ?? "monthly");
      setDebitInstallments("12");
      setSeriesSiblings(null);
      setAmountById({});
    });
  }, [open, initial]);

  useEffect(() => {
    if (!open || !initial?.is_recurring || !initial.id) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSeriesLoading(true);
    });
    listBillsInSameSeries(initial)
      .then((rows) => {
        if (cancelled) return;
        setSeriesSiblings(rows);
        const m: Record<string, string> = {};
        for (const b of rows) m[b.id] = String(b.amount);
        setAmountById(m);
      })
      .catch(() => {
        if (!cancelled) setSeriesSiblings(null);
      })
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initial?.id, initial?.is_recurring]);

  const showInstallmentList = Boolean(
    initial?.is_recurring && !seriesLoading && seriesSiblings && seriesSiblings.length > 0
  );
  const hideTopAmountWhileLoading = Boolean(initial?.is_recurring && seriesLoading);

  const effectiveCategory = billType === "debit" ? "debit" : category;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (billType === "expense") {
      if (!category || !BILL_STANDARD_CATEGORY_OPTIONS.some((o) => o.value === category)) {
        toast.error("Category is required");
        return;
      }
    }
    if (showInstallmentList && seriesSiblings) {
      const installmentAmounts: Record<string, number> = {};
      for (const b of seriesSiblings) {
        const raw = amountById[b.id] ?? "0";
        const n = parseFloat(String(raw).replace(",", "."));
        if (Number.isNaN(n) || n < 0) {
          toast.error("Valid amount required for each installment");
          return;
        }
        installmentAmounts[b.id] = n;
      }
      onSave({
        description: description.trim(),
        category: initial?.category === "debit" ? "debit" : effectiveCategory,
        due_date: seriesSiblings[0]?.due_date ?? due_date,
        is_recurring: true,
        recurrence_interval: is_recurring ? recurrence_interval : undefined,
        installmentAmounts,
      });
      return;
    }
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num < 0) {
      toast.error("Valid amount required");
      return;
    }
    if (!due_date) {
      toast.error("Due date required");
      return;
    }
    if (!initial && billType === "debit" && is_recurring) {
      const inst = parseInt(String(debitInstallments).trim(), 10);
      if (!Number.isFinite(inst) || inst < 1 || inst > 120) {
        toast.error("Enter remaining installments (1–120) for this debit.");
        return;
      }
    }
    onSave({
      description: description.trim(),
      category: effectiveCategory,
      amount: num,
      due_date,
      is_recurring,
      recurrence_interval: is_recurring ? recurrence_interval : undefined,
      recurringOccurrenceCount:
        !initial && billType === "debit" && is_recurring
          ? Math.min(120, Math.max(1, parseInt(String(debitInstallments).trim(), 10) || 0))
          : undefined,
    });
  };

  const archived = Boolean(initial?.archived_at);
  const archivedLabel = initial?.archived_at
    ? formatDate(initial.archived_at.slice(0, 10))
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? (archived ? "Edit bill (archived)" : "Edit bill") : "Add bill"}
      size="md"
    >
      <form onSubmit={submit} className="p-6 space-y-4">
        {archived && archivedLabel && (
          <div className="rounded-lg border border-border-light bg-surface-hover/50 px-3 py-2 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
              <Archive className="h-3.5 w-3.5 shrink-0" />
              Archived on {archivedLabel}
            </span>
            <p className="mt-1 text-text-tertiary leading-snug">
              Restore to show this bill in the main list and include it in pay runs when approved.
            </p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Zoho subscription, office rent, car finance"
            required
          />
        </div>
        <Select
          label="Type"
          value={billType}
          disabled={Boolean(initial?.category === "debit" || (initial?.is_recurring && seriesSiblings && seriesSiblings.length > 1))}
          onChange={(e) => {
            const v = e.target.value as "expense" | "debit";
            setBillType(v);
            if (v === "debit") setCategory("debit");
            else setCategory((c) => (c === "debit" ? "" : c));
          }}
          options={[
            { value: "expense", label: "Standard expense" },
            { value: "debit", label: "Debit (financing / loan)" },
          ]}
        />
        <p className="text-[11px] text-text-tertiary -mt-2 leading-snug">
          <strong className="text-text-secondary">Debit</strong> marks financing: set how many installments remain so the schedule matches
          cash flow (e.g. 23 or 24 months).
        </p>
        {billType === "expense" ? (
          <Select
            label="Category *"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: "", label: "Select category…" },
              ...BILL_STANDARD_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
            required
          />
        ) : (
          <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Category</p>
            <p className="text-sm font-medium text-text-primary mt-0.5">{billCategoryLabel("debit")}</p>
          </div>
        )}
        {initial?.is_recurring && seriesLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary py-2">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Loading installments…
          </div>
        ) : null}
        {showInstallmentList && seriesSiblings ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-text-secondary">Amount per installment (£)</label>
            <p className="text-[11px] text-text-tertiary leading-snug">
              Each line is one scheduled occurrence. Change a row if that period differs from the others.
            </p>
            <div className="rounded-lg border border-border-light bg-surface-hover/30 max-h-60 overflow-y-auto divide-y divide-border-light">
              {seriesSiblings.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <span className="text-xs font-medium text-text-secondary w-[7.5rem] shrink-0 tabular-nums">
                    {formatDate(b.due_date)}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    className="flex-1 min-w-[5rem] max-w-[10rem]"
                    value={amountById[b.id] ?? ""}
                    onChange={(e) => setAmountById((prev) => ({ ...prev, [b.id]: e.target.value }))}
                    aria-label={`Amount due ${b.due_date}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!showInstallmentList && !hideTopAmountWhileLoading ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount (£)</label>
            <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
        ) : null}
        {!showInstallmentList ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">First due date</label>
            <Input type="date" value={due_date} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
        ) : null}
        <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="recurring"
              checked={is_recurring}
              disabled={Boolean(initial?.is_recurring && seriesSiblings && seriesSiblings.length > 1)}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="recurring" className="text-sm text-text-primary font-medium">
              Recurring schedule
            </label>
          </div>
          <p className="text-[11px] text-text-tertiary leading-snug">
            Not tied to “mark paid”. We pre-create up to {RECURRENCE_GENERATION_COUNTS.weekly} weekly /{" "}
            {RECURRENCE_GENERATION_COUNTS.monthly} monthly / {RECURRENCE_GENERATION_COUNTS.quarterly} quarterly /{" "}
            {RECURRENCE_GENERATION_COUNTS.yearly} yearly lines ahead (no automatic extension after that — add a new bill if you need more
            horizon). <span className="text-text-secondary">Approve once</span> to approve every occurrence still pending in this series;
            pay each period when due, or skip/exclude in the pay run if you do not pay that month.
          </p>
        </div>
        {is_recurring && (
          <Select
            label="Cadence"
            value={recurrence_interval}
            onChange={(e) => setRecurrenceInterval(e.target.value as BillRecurrence)}
            disabled={Boolean(initial?.is_recurring && seriesSiblings && seriesSiblings.length > 1)}
            options={[
              { value: "weekly", label: "Weekly" },
              { value: "weekly_friday", label: "Every Friday" },
              { value: "biweekly_friday", label: "Every 2 Fridays" },
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
        )}
        {billType === "debit" && is_recurring && !initial ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Remaining installments</label>
            <Input
              type="number"
              min={1}
              max={120}
              step={1}
              value={debitInstallments}
              onChange={(e) => setDebitInstallments(e.target.value)}
              placeholder="e.g. 23 or 24"
            />
            <p className="text-[11px] text-text-tertiary mt-1 leading-snug">
              We create one bill line per installment (up to 120) so pay runs and cash flow match your loan term.
            </p>
          </div>
        ) : null}
        {billType === "debit" && is_recurring && initial && seriesSiblings && seriesSiblings.length > 0 ? (
          <p className="text-[11px] text-text-tertiary rounded-lg border border-border-light bg-surface-hover/30 px-3 py-2">
            This debit series has <strong className="text-text-secondary">{seriesSiblings.length}</strong> scheduled line
            {seriesSiblings.length === 1 ? "" : "s"} (including archived in DB — list may differ). Remaining count is set at creation.
          </p>
        ) : null}
        {is_recurring && (recurrence_interval === "weekly_friday" || recurrence_interval === "biweekly_friday") ? (
          <p className="text-[11px] text-text-tertiary leading-snug -mt-1">
            Due dates are generated on <strong className="text-text-secondary">Fridays</strong>. If the first due date is not a Friday, we
            use the first Friday on or after it.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {initial && onArchive && (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              icon={<Archive className="h-3.5 w-3.5" />}
              onClick={() => void onArchive()}
            >
              Archive
            </Button>
          )}
          {initial && onRestore && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void onRestore()}>
              Restore
            </Button>
          )}
          <Button
            type="submit"
            disabled={saving || Boolean(initial?.is_recurring && seriesLoading)}
            icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Submit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
