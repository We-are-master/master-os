"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Download, CircleDollarSign, DollarSign, Repeat, Calendar, Loader, Play, CheckCircle2,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { InternalCost, RecurringBill, InternalCostStatus, RecurringBillFrequency, RecurringBillStatus } from "@/types/database";
import { getSupabase } from "@/services/base";
import { createCommissionRun, listCommissionRuns, getCommissionRunWithItems, updateCommissionRunItem, approveCommissionRun } from "@/services/commission-runs";
import type { CommissionRun, CommissionRunItem } from "@/types/database";
import { useProfile } from "@/hooks/use-profile";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { getFinancePeriodClosedBounds } from "@/lib/finance-period";

const INTERNAL_COST_STATUSES: InternalCostStatus[] = ["pending", "paid"];
const RECURRING_FREQUENCIES: RecurringBillFrequency[] = ["monthly", "quarterly", "yearly"];
const RECURRING_STATUSES: RecurringBillStatus[] = ["active", "paused"];

const internalCostStatusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" }> = {
  pending: { label: "Pending", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
};

const recurringStatusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" }> = {
  active: { label: "Active", variant: "success" },
  paused: { label: "Paused", variant: "default" },
};

export default function PayrollPage() {
  const { profile } = useProfile();
  const [section, setSection] = useState<"internal" | "recurring" | "commission">("internal");
  const [internalCosts, setInternalCosts] = useState<InternalCost[]>([]);
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [commissionRuns, setCommissionRuns] = useState<CommissionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [internalFilter, setInternalFilter] = useState<string>("all");
  const [recurringFilter, setRecurringFilter] = useState<string>("all");

  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const [recurringModalOpen, setRecurringModalOpen] = useState(false);
  const [editingInternal, setEditingInternal] = useState<InternalCost | null>(null);
  const [editingRecurring, setEditingRecurring] = useState<RecurringBill | null>(null);
  const [saving, setSaving] = useState(false);

  const [runCommissionOpen, setRunCommissionOpen] = useState(false);
  const [runCommissionPeriodStart, setRunCommissionPeriodStart] = useState("");
  const [runCommissionPeriodEnd, setRunCommissionPeriodEnd] = useState("");
  const [runCommissionDraft, setRunCommissionDraft] = useState<{ run: CommissionRun; items: CommissionRunItem[] } | null>(null);
  const [runCommissionBusy, setRunCommissionBusy] = useState(false);
  const [runCommissionApproving, setRunCommissionApproving] = useState(false);

  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("all");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const periodBounds = useMemo(
    () => getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );

  const loadInternal = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("payroll_internal_costs")
      .select("*")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    setInternalCosts((data ?? []) as InternalCost[]);
  }, []);

  const loadRecurring = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("payroll_recurring_bills")
      .select("*")
      .order("next_due_date", { ascending: true });
    if (error) throw error;
    setRecurringBills((data ?? []) as RecurringBill[]);
  }, []);

  const loadCommissionRuns = useCallback(async () => {
    try {
      const list = await listCommissionRuns();
      setCommissionRuns(list);
    } catch { /* non-critical */ }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadInternal(), loadRecurring(), loadCommissionRuns()]);
    } catch {
      toast.error("Failed to load payroll data. Ensure tables payroll_internal_costs and payroll_recurring_bills exist.");
    } finally {
      setLoading(false);
    }
  }, [loadInternal, loadRecurring, loadCommissionRuns]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const scopedInternal = useMemo(() => {
    if (!periodBounds) return internalCosts;
    return internalCosts.filter(
      (c) => c.due_date && c.due_date >= periodBounds.from && c.due_date <= periodBounds.to
    );
  }, [internalCosts, periodBounds]);

  const scopedRecurring = useMemo(() => {
    if (!periodBounds) return recurringBills;
    return recurringBills.filter(
      (b) => b.next_due_date && b.next_due_date >= periodBounds.from && b.next_due_date <= periodBounds.to
    );
  }, [recurringBills, periodBounds]);

  const filteredCommissionRuns = useMemo(() => {
    if (!periodBounds) return commissionRuns;
    return commissionRuns.filter(
      (r) => r.period_end >= periodBounds.from && r.period_start <= periodBounds.to
    );
  }, [commissionRuns, periodBounds]);

  const filteredInternal = useMemo(() => {
    let list = scopedInternal;
    if (internalFilter !== "all") list = list.filter((c) => c.status === internalFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.reference && c.reference.toLowerCase().includes(q)) ||
          (c.category && c.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [scopedInternal, internalFilter, search]);

  const filteredRecurring = useMemo(() => {
    let list = scopedRecurring;
    if (recurringFilter !== "all") list = list.filter((b) => b.status === recurringFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.description && b.description.toLowerCase().includes(q)) ||
          (b.category && b.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [scopedRecurring, recurringFilter, search]);

  const internalTotals = useMemo(() => {
    const pending = scopedInternal.filter((c) => c.status === "pending");
    const paid = scopedInternal.filter((c) => c.status === "paid");
    return {
      totalPending: pending.reduce((s, c) => s + Number(c.amount), 0),
      totalPaid: paid.reduce((s, c) => s + Number(c.amount), 0),
      pendingCount: pending.length,
      paidCount: paid.length,
    };
  }, [scopedInternal]);

  const recurringTotals = useMemo(() => {
    const active = scopedRecurring.filter((b) => b.status === "active");
    const monthlyEquivalent = active.reduce((s, b) => {
      const amt = Number(b.amount);
      if (b.frequency === "monthly") return s + amt;
      if (b.frequency === "quarterly") return s + amt / 3;
      return s + amt / 12;
    }, 0);
    return {
      activeCount: active.length,
      totalMonthlyEquivalent: monthlyEquivalent,
      nextDueCount: scopedRecurring.filter(
        (b) => b.status === "active" && b.next_due_date && b.next_due_date <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      ).length,
    };
  }, [scopedRecurring]);

  const openAddInternal = () => {
    setEditingInternal(null);
    setInternalModalOpen(true);
  };

  const openEditInternal = (row: InternalCost) => {
    setEditingInternal(row);
    setInternalModalOpen(true);
  };

  const openAddRecurring = () => {
    setEditingRecurring(null);
    setRecurringModalOpen(true);
  };

  const openEditRecurring = (row: RecurringBill) => {
    setEditingRecurring(row);
    setRecurringModalOpen(true);
  };

  const saveInternal = async (form: Partial<InternalCost>) => {
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      if (editingInternal) {
        const updates: Partial<InternalCost> = {
          description: form.description!,
          amount: Number(form.amount),
          category: form.category || undefined,
          due_date: form.due_date || undefined,
          status: form.status ?? editingInternal.status,
          updated_at: now,
        };
        if (form.status === "paid") updates.paid_at = now.split("T")[0];
        const { error } = await supabase
          .from("payroll_internal_costs")
          .update(updates)
          .eq("id", editingInternal.id);
        if (error) throw error;
        toast.success("Cost updated");
      } else {
        const row = {
          description: form.description!,
          amount: Number(form.amount),
          category: form.category || undefined,
          due_date: form.due_date || undefined,
          status: (form.status as InternalCostStatus) ?? "pending",
          paid_at: form.status === "paid" ? now.split("T")[0] : null,
          created_at: now,
          updated_at: now,
        };
        const { error } = await supabase.from("payroll_internal_costs").insert(row);
        if (error) throw error;
        toast.success("Internal cost added");
      }
      setInternalModalOpen(false);
      loadInternal();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const saveRecurring = async (form: Partial<RecurringBill>) => {
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      if (editingRecurring) {
        const { error } = await supabase
          .from("payroll_recurring_bills")
          .update({
            name: form.name!,
            description: form.description || null,
            amount: Number(form.amount),
            frequency: form.frequency!,
            next_due_date: form.next_due_date!,
            category: form.category || null,
            status: form.status ?? editingRecurring.status,
            updated_at: now,
          })
          .eq("id", editingRecurring.id);
        if (error) throw error;
        toast.success("Recurring bill updated");
      } else {
        const { error } = await supabase.from("payroll_recurring_bills").insert({
          name: form.name!,
          description: form.description || null,
          amount: Number(form.amount),
          frequency: form.frequency!,
          next_due_date: form.next_due_date!,
          category: form.category || null,
          status: (form.status as RecurringBillStatus) ?? "active",
          created_at: now,
          updated_at: now,
        });
        if (error) throw error;
        toast.success("Recurring bill added");
      }
      setRecurringModalOpen(false);
      loadRecurring();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleRunCommissionGenerate = async () => {
    if (!runCommissionPeriodStart || !runCommissionPeriodEnd) {
      toast.error("Select period start and end");
      return;
    }
    setRunCommissionBusy(true);
    try {
      const run = await createCommissionRun(runCommissionPeriodStart, runCommissionPeriodEnd);
      const withItems = await getCommissionRunWithItems(run.id);
      setRunCommissionDraft({ run, items: withItems.items });
      toast.success("Commission run created. Review and approve.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create run");
    } finally {
      setRunCommissionBusy(false);
    }
  };

  const handleRunCommissionApprove = async () => {
    if (!runCommissionDraft?.run.id || !profile?.id) return;
    setRunCommissionApproving(true);
    try {
      await approveCommissionRun(runCommissionDraft.run.id, profile.id);
      toast.success("Commission run approved. It will appear in Pay Run.");
      setRunCommissionDraft(null);
      setRunCommissionOpen(false);
      loadCommissionRuns();
    } catch {
      toast.error("Failed to approve");
    } finally {
      setRunCommissionApproving(false);
    }
  };

  const sectionTabs = [
    { id: "internal", label: "Internal costs", count: scopedInternal.length },
    { id: "recurring", label: "Recurring bills", count: scopedRecurring.length },
    { id: "commission", label: "Run Commission", count: filteredCommissionRuns.length },
  ];

  const internalColumns: Column<InternalCost>[] = [
    { key: "description", label: "Description", render: (r) => <span className="text-sm font-medium text-text-primary">{r.description}</span> },
    { key: "category", label: "Category", render: (r) => <span className="text-sm text-text-secondary">{r.category ?? "—"}</span> },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="text-sm font-medium text-text-primary">{formatCurrency(r.amount)}</span> },
    { key: "due_date", label: "Due date", render: (r) => <span className="text-sm text-text-secondary">{r.due_date ? formatDate(r.due_date) : "—"}</span> },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const config = internalCostStatusConfig[r.status];
        return <Badge variant={config?.variant ?? "default"} dot>{config?.label ?? r.status}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEditInternal(r)}>Edit</Button>
      ),
    },
  ];

  const recurringColumns: Column<RecurringBill>[] = [
    { key: "name", label: "Name", render: (r) => <span className="text-sm font-medium text-text-primary">{r.name}</span> },
    { key: "category", label: "Category", render: (r) => <span className="text-sm text-text-secondary">{r.category ?? "—"}</span> },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="text-sm font-medium text-text-primary">{formatCurrency(r.amount)}</span> },
    { key: "frequency", label: "Frequency", render: (r) => <span className="text-sm text-text-secondary capitalize">{r.frequency}</span> },
    { key: "next_due_date", label: "Next due", render: (r) => <span className="text-sm text-text-secondary">{formatDate(r.next_due_date)}</span> },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const config = recurringStatusConfig[r.status];
        return <Badge variant={config?.variant ?? "default"} dot>{config?.label ?? r.status}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEditRecurring(r)}>Edit</Button>
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Payroll & costs"
          subtitle="Internal costs, recurring bills, and commission runs (salaries + tiers)."
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />}>Export CSV</Button>
          {section === "internal" && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openAddInternal}>Add cost</Button>}
          {section === "recurring" && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openAddRecurring}>Add recurring bill</Button>}
          {section === "commission" && <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => { setRunCommissionDraft(null); setRunCommissionOpen(true); }}>Run Commission</Button>}
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

        <Tabs tabs={sectionTabs} activeTab={section} onChange={(id) => setSection(id as "internal" | "recurring" | "commission")} />

        {section === "internal" && (
          <>
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Pending total" value={internalTotals.totalPending} format="currency" icon={DollarSign} accent="amber" />
              <KpiCard title="Paid total" value={internalTotals.totalPaid} format="currency" icon={CircleDollarSign} accent="emerald" />
              <KpiCard title="Pending items" value={internalTotals.pendingCount} format="number" icon={Calendar} accent="primary" />
              <KpiCard title="Paid items" value={internalTotals.paidCount} format="number" icon={CircleDollarSign} accent="blue" />
            </StaggerContainer>
            <motion.div variants={fadeInUp} initial="hidden" animate="visible">
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-2">
                  {(["all", "pending", "paid"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setInternalFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        internalFilter === f ? "bg-primary text-white" : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
                      }`}
                    >
                      {f === "all" ? "All" : f === "pending" ? "Pending" : "Paid"}
                    </button>
                  ))}
                </div>
                <SearchInput placeholder="Search costs..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <DataTable
                columns={internalColumns}
                data={filteredInternal}
                getRowId={(r) => r.id}
                loading={loading}
                page={1}
                totalPages={1}
                totalItems={filteredInternal.length}
              />
            </motion.div>
          </>
        )}

        {section === "recurring" && (
          <>
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Active bills" value={recurringTotals.activeCount} format="number" icon={Repeat} accent="primary" />
              <KpiCard title="Monthly equivalent" value={recurringTotals.totalMonthlyEquivalent} format="currency" icon={DollarSign} accent="amber" />
              <KpiCard title="Due in 30 days" value={recurringTotals.nextDueCount} format="number" icon={Calendar} accent="amber" />
            </StaggerContainer>
            <motion.div variants={fadeInUp} initial="hidden" animate="visible">
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-2">
                  {(["all", "active", "paused"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setRecurringFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        recurringFilter === f ? "bg-primary text-white" : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
                      }`}
                    >
                      {f === "all" ? "All" : f === "active" ? "Active" : "Paused"}
                    </button>
                  ))}
                </div>
                <SearchInput placeholder="Search bills..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <DataTable
                columns={recurringColumns}
                data={filteredRecurring}
                getRowId={(r) => r.id}
                loading={loading}
                page={1}
                totalPages={1}
                totalItems={filteredRecurring.length}
              />
            </motion.div>
          </>
        )}

        {section === "commission" && (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible">
            <p className="text-sm text-text-secondary mb-4">Run Commission: select a period. System uses paid invoices to compute tier and fills commission per team member (Head Ops, AM, Biz Dev). Approve to send to Pay Run.</p>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-hover">
                    <th className="text-left p-3">Period</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommissionRuns.slice(0, 10).map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium">{formatDate(r.period_start)} – {formatDate(r.period_end)}</td>
                      <td className="p-3">
                        <Badge variant={r.status === "approved" ? "success" : "warning"} size="sm">{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCommissionRuns.length === 0 && <p className="p-6 text-center text-text-tertiary">No commission runs yet. Click Run Commission to create one.</p>}
            </div>
          </motion.div>
        )}

        <InternalCostModal
          open={internalModalOpen}
          onClose={() => { setInternalModalOpen(false); setEditingInternal(null); }}
          initial={editingInternal}
          onSave={saveInternal}
          saving={saving}
        />
        <RecurringBillModal
          open={recurringModalOpen}
          onClose={() => { setRecurringModalOpen(false); setEditingRecurring(null); }}
          initial={editingRecurring}
          onSave={saveRecurring}
          saving={saving}
        />

        <Modal open={runCommissionOpen} onClose={() => { setRunCommissionOpen(false); setRunCommissionDraft(null); }} title="Run Commission" subtitle="Select period. Paid invoices in period determine tier; pool is split by role." size="lg">
          <div className="p-6 space-y-4">
            {!runCommissionDraft ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Period start</label>
                    <Input type="date" value={runCommissionPeriodStart} onChange={(e) => setRunCommissionPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Period end</label>
                    <Input type="date" value={runCommissionPeriodEnd} onChange={(e) => setRunCommissionPeriodEnd(e.target.value)} />
                  </div>
                </div>
                <Button onClick={handleRunCommissionGenerate} disabled={runCommissionBusy} icon={runCommissionBusy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}>
                  {runCommissionBusy ? "Generating..." : "Generate"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-text-secondary">
                  Period: {formatDate(runCommissionDraft.run.period_start)} – {formatDate(runCommissionDraft.run.period_end)}. Review amounts and approve to send to Pay Run.
                </p>
                <div className="rounded-lg border border-border overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-hover sticky top-0">
                      <tr>
                        <th className="text-left p-2">Member</th>
                        <th className="text-right p-2">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runCommissionDraft.items.map((i) => (
                        <tr key={i.id} className="border-t border-border">
                          <td className="p-2 font-medium">{i.team_member_name ?? i.team_member_id}</td>
                          <td className="p-2 text-right">{formatCurrency(i.commission_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRunCommissionDraft(null)}>Back</Button>
                  <Button onClick={handleRunCommissionApprove} disabled={runCommissionApproving} icon={runCommissionApproving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}>
                    {runCommissionApproving ? "Approving..." : "Approve All"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>
    </PageTransition>
  );
}

function InternalCostModal({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: InternalCost | null;
  onSave: (form: Partial<InternalCost>) => Promise<void>;
  saving: boolean;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InternalCostStatus>("pending");

  useEffect(() => {
    if (open) {
      setDescription(initial?.description ?? "");
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setCategory(initial?.category ?? "");
      setDueDate(initial?.due_date ?? "");
      setStatus(initial?.status ?? "pending");
    }
  }, [open, initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num < 0) {
      toast.error("Valid amount is required");
      return;
    }
    onSave({ description: description.trim(), amount: num, category: category.trim() || undefined, due_date: dueDate || undefined, status });
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit internal cost" : "Add internal cost"} size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Office supplies March" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
          <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Category (optional)</label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. payroll, rent, utilities" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Due date (optional)</label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as InternalCostStatus)}
          options={INTERNAL_COST_STATUSES.map((s) => ({ value: s, label: s === "paid" ? "Paid" : "Pending" }))}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving..." : initial ? "Update" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RecurringBillModal({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: RecurringBill | null;
  onSave: (form: Partial<RecurringBill>) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<RecurringBillFrequency>("monthly");
  const [nextDueDate, setNextDueDate] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<RecurringBillStatus>("active");

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setFrequency(initial?.frequency ?? "monthly");
      setNextDueDate(initial?.next_due_date ?? "");
      setCategory(initial?.category ?? "");
      setStatus(initial?.status ?? "active");
    }
  }, [open, initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num < 0) {
      toast.error("Valid amount is required");
      return;
    }
    if (!nextDueDate) {
      toast.error("Next due date is required");
      return;
    }
    onSave({ name: name.trim(), description: description.trim() || undefined, amount: num, frequency, next_due_date: nextDueDate, category: category.trim() || undefined, status });
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit recurring bill" : "Add recurring bill"} size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office rent" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Description (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
          <Input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </div>
        <Select
          label="Frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as RecurringBillFrequency)}
          options={RECURRING_FREQUENCIES.map((f) => ({ value: f, label: f.charAt(0).toUpperCase() + f.slice(1) }))}
        />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Next due date</label>
          <Input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Category (optional)</label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. rent, software, utilities" />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as RecurringBillStatus)}
          options={RECURRING_STATUSES.map((s) => ({ value: s, label: s === "active" ? "Active" : "Paused" }))}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving..." : initial ? "Update" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
