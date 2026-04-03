"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
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
import { getFinancePeriodClosedBounds, formatFinancePeriodKpiDescription } from "@/lib/finance-period";
import { BILL_CATEGORY_OPTIONS, billCategoryLabel } from "@/lib/bill-categories";
import { RECURRENCE_GENERATION_COUNTS, recurrenceLabel } from "@/lib/bill-recurrence";
import { buildBillDisplayList, recurringGroupKey, type BillDisplayItem } from "@/lib/bill-groups";

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
  approved: { label: "Approved", variant: "primary" },
  paid: { label: "Paid", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  needs_attention: { label: "Needs attention", variant: "info" },
};

export default function BillsPage() {
  const { profile } = useProfile();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [billKindTab, setBillKindTab] = useState<"one_off" | "recurring">("one_off");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [saving, setSaving] = useState(false);
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("all");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
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
    () => getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
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
    const matchesKind = (b: Bill) => (billKindTab === "recurring" ? !!b.is_recurring : !b.is_recurring);
    return archivedScoped.filter(matchesKind);
  }, [bills, periodBounds, statusFilter, billKindTab]);

  const displayList = useMemo(
    () => buildBillDisplayList(scopedBills, statusFilter),
    [scopedBills, statusFilter]
  );

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );

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
    const base = inPeriodEligible.filter((b) =>
      billKindTab === "recurring" ? !!b.is_recurring : !b.is_recurring
    );
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
      toast.success("Bill marked paid.");
      load();
    } catch {
      toast.error("Failed to mark paid");
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

  const renderBillActions = (r: Bill) => (
    <div className="flex flex-wrap gap-1 justify-end">
      <Button variant="ghost" size="sm" icon={<Pencil className="h-3 w-3" />} onClick={() => { setEditing(r); setModalOpen(true); }}>
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
      {!r.archived_at && r.status === "approved" && (
        <Button variant="ghost" size="sm" onClick={() => handleMarkPaid(r)}>
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
    </div>
  );

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Bills & expenses"
          subtitle="Use One-off vs Recurring below; then filter by workflow. KPIs and the list match the tab and the period bar."
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

        <FinanceWeekRangeBar
          mode={periodMode}
          onModeChange={setPeriodMode}
          weekAnchor={weekAnchor}
          onWeekAnchorChange={setWeekAnchor}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onRangeFromChange={setRangeFrom}
          onRangeToChange={setRangeTo}
        />

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Pending"
            value={kpis.pendingAmount}
            format="currency"
            description={`${kpis.pendingCount} submitted · ${billKindTab === "recurring" ? "Recurring" : "One-off"} · ${kpiPeriodDesc}`}
            icon={FileCheck}
            accent="amber"
          />
          <KpiCard
            title="Approved"
            value={kpis.approvedAmount}
            format="currency"
            description={`${kpis.approvedCount} awaiting payment · ${billKindTab === "recurring" ? "Recurring" : "One-off"} · ${kpiPeriodDesc}`}
            icon={DollarSign}
            accent="primary"
          />
          <KpiCard
            title="Total bills (period)"
            value={kpis.totalAmount}
            format="currency"
            description={`${kpis.totalCount} line${kpis.totalCount === 1 ? "" : "s"} · ${billKindTab === "recurring" ? "Recurring" : "One-off"} · Excl. archived, rejected & needs attention · ${kpiPeriodDesc}`}
            icon={Layers}
            accent="blue"
          />
          <KpiCard
            title="Paid"
            value={kpis.paidAmount}
            format="currency"
            description={`${kpis.paidCount} paid · ${billKindTab === "recurring" ? "Recurring" : "One-off"} · ${kpiPeriodDesc}`}
            icon={Banknote}
            accent="emerald"
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-text-primary">Bills</p>
              <p className="text-xs text-text-tertiary">
                {statusFilter === "archived" ? (
                  <>
                    Archived bills are hidden from the default list and from pay runs. Restore from here or from Edit.
                  </>
                ) : (
                  <>
                    Filter by workflow stage. Use <span className="font-medium text-text-secondary">Needs attention</span> for
                    follow-up. <span className="font-medium text-text-secondary">Archived</span> hides bills without deleting them.
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "one_off" as const, label: "One-off" },
                { id: "recurring" as const, label: "Recurring" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setBillKindTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  billKindTab === t.id
                    ? "bg-primary text-white shadow-sm"
                    : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {BILL_FILTER_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary text-white shadow-sm"
                    : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
                }`}
              >
                {s === "all" ? "All" : s === "archived" ? "Archived" : statusConfig[s as BillStatus]?.label ?? s}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
            </div>
          ) : displayList.length === 0 ? (
            <p className="text-sm text-text-tertiary py-10 text-center rounded-xl border border-dashed border-border-light bg-surface-hover/30">
              No {billKindTab === "recurring" ? "recurring" : "one-off"} bills in this period for the current filters.
            </p>
          ) : (
            <div className="space-y-3">
              {displayList.map((item) => {
                if (item.type === "series") {
                  const head = item.all[0];
                  const expanded = expandedSeries[item.key] ?? false;
                  const summary = formatStatusSummary(item.visible);
                  const cadence = recurrenceLabel(head.recurrence_interval as BillRecurrence | undefined);
                  const submittedCountInSeries = scopedBills.filter(
                    (b) => !b.archived_at && recurringGroupKey(b) === item.key && b.status === "submitted"
                  ).length;
                  return (
                    <div
                      key={item.key}
                      className="rounded-xl border border-border-light bg-card overflow-hidden shadow-sm"
                    >
                      <div className="flex items-start gap-2 px-4 py-3 hover:bg-surface-hover/40 transition-colors">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? "Collapse series" : "Expand series"}
                          onClick={() =>
                            setExpandedSeries((s) => ({ ...s, [item.key]: !expanded }))
                          }
                          className="mt-0.5 text-text-tertiary shrink-0 p-0.5 rounded hover:bg-surface-hover"
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSeries((s) => ({ ...s, [item.key]: !expanded }))
                          }
                          className="flex-1 min-w-0 space-y-1.5 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-lg font-bold tabular-nums text-text-primary shrink-0">
                              {formatCurrency(head.amount)}
                            </span>
                            <Badge variant="primary" size="sm" className="shrink-0 font-semibold uppercase tracking-wide text-[10px]">
                              {cadence}
                            </Badge>
                            <Badge variant="info" size="sm" className="shrink-0">
                              Recurring
                            </Badge>
                            <p className="text-sm font-semibold text-text-primary min-w-0 w-full sm:w-auto sm:inline sm:ml-0">
                              {head.description}
                            </p>
                          </div>
                          <p className="text-xs text-text-tertiary">{billCategoryLabel(head.category)}</p>
                          <p className="text-xs text-text-secondary">
                            {item.visible.length} occurrence{item.visible.length === 1 ? "" : "s"} in view
                            {item.all.length !== item.visible.length && (
                              <span className="text-text-tertiary">
                                {" "}
                                ({item.all.length} total in period)
                              </span>
                            )}
                            {summary ? (
                              <>
                                <span className="text-text-tertiary"> · </span>
                                {summary}
                              </>
                            ) : null}
                          </p>
                        </button>
                        {statusFilter !== "archived" && (
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            {renderSeriesHeadlineStatusBadge(item.visible)}
                            {submittedCountInSeries > 0 ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-[11px] font-semibold border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                                disabled={approveSeriesBusyKey === item.key}
                                loading={approveSeriesBusyKey === item.key}
                                onClick={() => void handleApproveAllInSeries(item.key)}
                                title="Approve every submitted line for this recurring bill (all months in period)"
                              >
                                Approve all
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              icon={<Archive className="h-3 w-3" />}
                              onClick={() => setArchiveSeriesTarget(item)}
                            >
                              Archive
                            </Button>
                          </div>
                        )}
                      </div>
                      {expanded && (
                        <div className="border-t border-border-light bg-surface-hover/25">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[720px]">
                              <thead>
                                <tr className="border-b border-border-light text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                                  <th className="px-4 py-2 font-medium">Due</th>
                                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                                  <th className="px-4 py-2 font-medium">Submitted by</th>
                                  <th className="px-4 py-2 font-medium">Status</th>
                                  <th className="px-4 py-2 font-medium text-right w-[min(40%,280px)]">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {item.visible.map((r) => (
                                  <tr key={r.id} className="border-b border-border-light/80 last:border-0">
                                    <td className="px-4 py-2.5 align-top tabular-nums text-text-secondary whitespace-nowrap">
                                      {formatDate(r.due_date)}
                                    </td>
                                    <td className="px-4 py-2.5 align-top text-right font-medium tabular-nums whitespace-nowrap">
                                      {formatCurrency(r.amount)}
                                    </td>
                                    <td className="px-4 py-2.5 align-top text-text-tertiary whitespace-nowrap">
                                      {r.submitted_by_name ?? "—"}
                                    </td>
                                    <td className="px-4 py-2.5 align-top">{renderStatusBadge(r)}</td>
                                    <td className="px-4 py-2.5 align-top text-right">{renderBillActions(r)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                const r = item.bill;
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-border-light bg-card shadow-sm px-4 py-3 space-y-3"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {r.is_recurring ? (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-lg font-bold tabular-nums text-text-primary shrink-0">
                              {formatCurrency(r.amount)}
                            </span>
                            <Badge variant="primary" size="sm" className="shrink-0 font-semibold uppercase tracking-wide text-[10px]">
                              {recurrenceLabel(r.recurrence_interval)}
                            </Badge>
                            <Badge variant="info" size="sm" className="shrink-0">
                              Recurring
                            </Badge>
                            <p className="text-sm font-semibold text-text-primary min-w-0 w-full sm:w-auto">{r.description}</p>
                          </div>
                        ) : (
                          <p className="text-sm font-medium text-text-primary">{r.description}</p>
                        )}
                        <p className="text-xs text-text-tertiary">{billCategoryLabel(r.category)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm shrink-0">
                        {!r.is_recurring ? (
                          <span className="font-medium tabular-nums">{formatCurrency(r.amount)}</span>
                        ) : null}
                        <span className="text-text-secondary tabular-nums whitespace-nowrap">
                          Due {formatDate(r.due_date)}
                        </span>
                        <span className="text-text-tertiary whitespace-nowrap">
                          {r.submitted_by_name ?? "—"}
                        </span>
                        {renderStatusBadge(r)}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1 pt-0.5 border-t border-border-light/60 lg:border-0 lg:pt-0">
                      {renderBillActions(r)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

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
                await createBill({
                  description: form.description ?? "",
                  amount: form.amount ?? 0,
                  due_date: form.due_date ?? "",
                  is_recurring: form.is_recurring ?? false,
                  recurrence_interval: form.is_recurring ? interval : undefined,
                  category: form.category,
                  submitted_by_id: profile?.id,
                  submitted_by_name: profile?.full_name,
                  status: "submitted",
                });
                if (form.is_recurring && interval) {
                  const n = RECURRENCE_GENERATION_COUNTS[interval] ?? 12;
                  toast.success(`Bill submitted — ${n} occurrences scheduled ahead.`);
                } else {
                  toast.success("Bill submitted");
                }
              }
              setModalOpen(false);
              setEditing(null);
              load();
            } catch {
              toast.error("Failed to save");
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
  const [seriesSiblings, setSeriesSiblings] = useState<Bill[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [amountById, setAmountById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setDescription(initial?.description ?? "");
      const cat = initial?.category ?? "";
      setCategory(BILL_CATEGORY_OPTIONS.some((o) => o.value === cat) ? cat : cat ? "other" : "");
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setDueDate(initial?.due_date ?? "");
      setIsRecurring(initial?.is_recurring ?? false);
      setRecurrenceInterval((initial?.recurrence_interval as BillRecurrence) ?? "monthly");
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (!category || !BILL_CATEGORY_OPTIONS.some((o) => o.value === category)) {
      toast.error("Category is required");
      return;
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
        category,
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
    onSave({
      description: description.trim(),
      category,
      amount: num,
      due_date,
      is_recurring,
      recurrence_interval: is_recurring ? recurrence_interval : undefined,
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
            placeholder="e.g. Zoho subscription, office rent"
            required
          />
        </div>
        <Select
          label="Category *"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[{ value: "", label: "Select category…" }, ...BILL_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
          required
        />
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
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
        )}
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
