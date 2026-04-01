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
import { Plus, FileCheck, DollarSign, Loader2, Banknote } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { Bill, BillStatus } from "@/types/database";
import { listBills, createBill, updateBill, markBillPaid } from "@/services/bills";
import { useProfile } from "@/hooks/use-profile";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { getFinancePeriodClosedBounds, formatFinancePeriodKpiDescription } from "@/lib/finance-period";

const BILL_STATUSES: BillStatus[] = ["submitted", "approved", "paid", "rejected"];

const statusConfig: Record<BillStatus, { label: string; variant: "default" | "primary" | "warning" | "success" | "danger" }> = {
  submitted: { label: "Submitted", variant: "warning" },
  approved: { label: "Approved", variant: "primary" },
  paid: { label: "Paid", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
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
    const submitted = scopedBills.filter((b) => b.status === "submitted");
    const approved = scopedBills.filter((b) => b.status === "approved");
    const paid = scopedBills.filter((b) => b.status === "paid");
    return {
      submittedCount: submitted.length,
      submittedAmount: submitted.reduce((s, b) => s + Number(b.amount), 0),
      approvedCount: approved.length,
      approvedAmount: approved.reduce((s, b) => s + Number(b.amount), 0),
      paidAmount: paid.reduce((s, b) => s + Number(b.amount), 0),
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
      toast.success(bill.is_recurring ? "Bill marked paid. Next occurrence created." : "Bill marked paid.");
      load();
    } catch {
      toast.error("Failed to mark paid");
    }
  };

  const columns: Column<Bill>[] = [
    {
      key: "description",
      label: "Description",
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-text-primary">{r.description}</p>
          {r.category && <p className="text-xs text-text-tertiary">{r.category}</p>}
          {r.is_recurring && <Badge variant="info" size="sm" className="mt-1">Recurring</Badge>}
        </div>
      ),
    },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="text-sm font-medium">{formatCurrency(r.amount)}</span> },
    { key: "due_date", label: "Due", render: (r) => <span className="text-sm text-text-secondary">{formatDate(r.due_date)}</span> },
    { key: "submitted_by_name", label: "Submitted by", render: (r) => <span className="text-sm text-text-tertiary">{r.submitted_by_name ?? "—"}</span> },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const c = statusConfig[r.status];
        return <Badge variant={c?.variant ?? "default"} dot>{c?.label ?? r.status}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <div className="flex gap-1">
          {r.status === "submitted" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleApprove(r)}>Approve</Button>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => handleReject(r)}>Reject</Button>
            </>
          )}
          {r.status === "approved" && (
            <Button variant="ghost" size="sm" onClick={() => handleMarkPaid(r)}>Mark Paid</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Bills" subtitle="Company expenses. Recurring bills auto-create next when paid.">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setEditing(null); setModalOpen(true); }}>
            Add Bill
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
            title="Submitted"
            value={kpis.submittedAmount}
            format="currency"
            description={`${kpis.submittedCount} bill${kpis.submittedCount === 1 ? "" : "s"} · Due ${kpiPeriodDesc}`}
            icon={FileCheck}
            accent="amber"
          />
          <KpiCard
            title="Approved (pending pay)"
            value={kpis.approvedAmount}
            format="currency"
            description={`${kpis.approvedCount} bill${kpis.approvedCount === 1 ? "" : "s"} · Due ${kpiPeriodDesc}`}
            icon={DollarSign}
            accent="primary"
          />
          <KpiCard
            title="Paid (period)"
            value={kpis.paidAmount}
            format="currency"
            description={`Due date · ${kpiPeriodDesc}`}
            icon={Banknote}
            accent="emerald"
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex gap-2 mb-4">
            {["all", ...BILL_STATUSES].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${statusFilter === s ? "bg-primary text-white" : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"}`}
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
          onClose={() => { setModalOpen(false); setEditing(null); }}
          initial={editing}
          onSave={async (form) => {
            setSaving(true);
            try {
              if (editing) {
                await updateBill(editing.id, form);
                toast.success("Bill updated");
              } else {
                await createBill({
                  description: form.description ?? "",
                  amount: form.amount ?? 0,
                  due_date: form.due_date ?? "",
                  is_recurring: form.is_recurring ?? false,
                  recurrence_interval: form.recurrence_interval ?? undefined,
                  category: form.category,
                  submitted_by_id: profile?.id,
                  submitted_by_name: profile?.full_name,
                  status: "submitted",
                });
                toast.success("Bill submitted");
              }
              setModalOpen(false);
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
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [due_date, setDueDate] = useState("");
  const [is_recurring, setIsRecurring] = useState(false);
  const [recurrence_interval, setRecurrenceInterval] = useState<Bill["recurrence_interval"]>("monthly");

  useEffect(() => {
    if (open) {
      setDescription(initial?.description ?? "");
      setCategory(initial?.category ?? "");
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setDueDate(initial?.due_date ?? "");
      setIsRecurring(initial?.is_recurring ?? false);
      setRecurrenceInterval(initial?.recurrence_interval ?? "monthly");
    }
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error("Description required");
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
      category: category.trim() || undefined,
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
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Zoho, Office rent" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Category (optional)</label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. software, rent" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
          <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Due date</label>
          <Input type="date" value={due_date} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="recurring" checked={is_recurring} onChange={(e) => setIsRecurring(e.target.checked)} className="rounded border-border" />
          <label htmlFor="recurring" className="text-sm text-text-primary">Recurring (next bill auto-created when paid)</label>
        </div>
        {is_recurring && (
          <Select
            label="Interval"
            value={recurrence_interval ?? "monthly"}
            onChange={(e) => setRecurrenceInterval(e.target.value as Bill["recurrence_interval"])}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving..." : initial ? "Update" : "Submit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
