"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, type Column } from "@/components/ui/data-table";
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
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { Bill, BillStatus, BillRecurrence } from "@/types/database";
import { listBills, createBill, updateBill, markBillPaid } from "@/services/bills";
import { useProfile } from "@/hooks/use-profile";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { getFinancePeriodClosedBounds, formatFinancePeriodKpiDescription } from "@/lib/finance-period";
import { BILL_CATEGORY_OPTIONS, billCategoryLabel } from "@/lib/bill-categories";
import { RECURRENCE_GENERATION_COUNTS } from "@/lib/bill-recurrence";

const BILL_STATUSES: BillStatus[] = ["submitted", "approved", "paid", "rejected", "needs_attention"];

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
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [saving, setSaving] = useState(false);
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("all");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

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
    if (!periodBounds) return bills;
    return bills.filter(
      (b) => b.due_date && b.due_date >= periodBounds.from && b.due_date <= periodBounds.to
    );
  }, [bills, periodBounds]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return scopedBills;
    return scopedBills.filter((b) => b.status === statusFilter);
  }, [scopedBills, statusFilter]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );

  const kpis = useMemo(() => {
    const pending = scopedBills.filter((b) => b.status === "submitted");
    const approved = scopedBills.filter((b) => b.status === "approved");
    const paid = scopedBills.filter((b) => b.status === "paid");
    const pendingAmt = pending.reduce((s, b) => s + Number(b.amount), 0);
    const approvedAmt = approved.reduce((s, b) => s + Number(b.amount), 0);
    const paidAmt = paid.reduce((s, b) => s + Number(b.amount), 0);
    const totalAmt = scopedBills.reduce((s, b) => s + Number(b.amount), 0);
    return {
      pendingCount: pending.length,
      pendingAmount: pendingAmt,
      approvedCount: approved.length,
      approvedAmount: approvedAmt,
      paidCount: paid.length,
      paidAmount: paidAmt,
      totalCount: scopedBills.length,
      totalAmount: totalAmt,
    };
  }, [scopedBills]);

  const handleApprove = async (bill: Bill) => {
    try {
      await updateBill(bill.id, { status: "approved" });
      toast.success("Bill approved");
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

  const columns: Column<Bill>[] = [
    {
      key: "description",
      label: "Description",
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-text-primary">{r.description}</p>
          <p className="text-xs text-text-tertiary">{billCategoryLabel(r.category)}</p>
          {r.is_recurring && (
            <Badge variant="info" size="sm" className="mt-1">
              Recurring · {r.recurrence_interval ?? "—"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (r) => <span className="text-sm font-medium tabular-nums">{formatCurrency(r.amount)}</span>,
    },
    {
      key: "due_date",
      label: "Due",
      render: (r) => <span className="text-sm text-text-secondary tabular-nums">{formatDate(r.due_date)}</span>,
    },
    {
      key: "submitted_by_name",
      label: "Submitted by",
      render: (r) => <span className="text-sm text-text-tertiary">{r.submitted_by_name ?? "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const c = statusConfig[r.status];
        return (
          <Badge variant={c?.variant ?? "default"} dot>
            {c?.label ?? r.status}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <div className="flex flex-wrap gap-1 justify-end">
          <Button variant="ghost" size="sm" icon={<Pencil className="h-3 w-3" />} onClick={() => { setEditing(r); setModalOpen(true); }}>
            Edit
          </Button>
          {(r.status === "submitted" || r.status === "needs_attention") && (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleApprove(r)}>
                Approve
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => handleReject(r)}>
                Reject
              </Button>
            </>
          )}
          {r.status === "approved" && (
            <Button variant="ghost" size="sm" onClick={() => handleMarkPaid(r)}>
              Mark paid
            </Button>
          )}
          {(r.status === "submitted" || r.status === "approved") && (
            <Button variant="ghost" size="sm" className="text-amber-700" onClick={() => handleNeedsAttention(r)}>
              Needs attention
            </Button>
          )}
          {r.status === "needs_attention" && (
            <Button variant="ghost" size="sm" onClick={() => handleClearAttention(r)}>
              Back to submitted
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Bills & expenses"
          subtitle="Operating debits in one place: one-off and recurring schedules. KPIs and the table follow the date filter above."
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
            description={`${kpis.pendingCount} submitted · Due in ${kpiPeriodDesc}`}
            icon={FileCheck}
            accent="amber"
          />
          <KpiCard
            title="Approved"
            value={kpis.approvedAmount}
            format="currency"
            description={`${kpis.approvedCount} awaiting payment · ${kpiPeriodDesc}`}
            icon={DollarSign}
            accent="primary"
          />
          <KpiCard
            title="Total bills (period)"
            value={kpis.totalAmount}
            format="currency"
            description={`${kpis.totalCount} line${kpis.totalCount === 1 ? "" : "s"} · All statuses · ${kpiPeriodDesc}`}
            icon={Layers}
            accent="blue"
          />
          <KpiCard
            title="Paid"
            value={kpis.paidAmount}
            format="currency"
            description={`${kpis.paidCount} paid · Due in ${kpiPeriodDesc}`}
            icon={Banknote}
            accent="emerald"
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-text-primary">Bills</p>
              <p className="text-xs text-text-tertiary">
                Filter by workflow stage. Use <span className="font-medium text-text-secondary">Needs attention</span> for follow-up.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {["all", ...BILL_STATUSES].map((s) => (
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
                {s === "all" ? "All" : statusConfig[s as BillStatus]?.label ?? s}
              </button>
            ))}
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            getRowId={(r) => r.id}
            loading={loading}
            page={1}
            totalPages={1}
            totalItems={filtered.length}
          />
        </motion.div>

        <BillModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          initial={editing}
          onSave={async (form) => {
            setSaving(true);
            try {
              if (editing) {
                await updateBill(editing.id, {
                  description: form.description ?? "",
                  category: form.category,
                  amount: form.amount ?? 0,
                  due_date: form.due_date ?? "",
                  is_recurring: form.is_recurring ?? false,
                  recurrence_interval: form.is_recurring ? form.recurrence_interval : null,
                });
                toast.success("Bill updated");
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

function BillModal({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: Bill | null;
  onSave: (form: Partial<Bill>) => Promise<void>;
  saving: boolean;
}) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [due_date, setDueDate] = useState("");
  const [is_recurring, setIsRecurring] = useState(false);
  const [recurrence_interval, setRecurrenceInterval] = useState<BillRecurrence>("monthly");

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
    });
  }, [open, initial]);

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

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit bill" : "Add bill"} size="md">
      <form onSubmit={submit} className="p-6 space-y-4">
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
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount (£)</label>
          <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">First due date</label>
          <Input type="date" value={due_date} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
        <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="recurring"
              checked={is_recurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="recurring" className="text-sm text-text-primary font-medium">
              Recurring schedule
            </label>
          </div>
          <p className="text-[11px] text-text-tertiary leading-snug">
            Not tied to “mark paid”. We pre-create the next {RECURRENCE_GENERATION_COUNTS.weekly} weeks /{" "}
            {RECURRENCE_GENERATION_COUNTS.monthly} months / {RECURRENCE_GENERATION_COUNTS.quarterly} quarters /{" "}
            {RECURRENCE_GENERATION_COUNTS.yearly} years of due dates so each period appears as its own line to approve and pay.
          </p>
        </div>
        {is_recurring && (
          <Select
            label="Cadence"
            value={recurrence_interval}
            onChange={(e) => setRecurrenceInterval(e.target.value as BillRecurrence)}
            options={[
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving…" : initial ? "Save changes" : "Submit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
