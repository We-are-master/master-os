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
  Plus, Download, CircleDollarSign, DollarSign, Repeat, Calendar, Loader, Play, CheckCircle2, FileText,
  AlertTriangle, UserX,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type {
  InternalCost,
  RecurringBill,
  InternalCostStatus,
  RecurringBillFrequency,
  RecurringBillStatus,
  PayrollInternalEmploymentType,
  PayrollInternalPayFrequency,
  PayrollInternalLifecycleStage,
  PayrollInternalProfile,
} from "@/types/database";
import {
  PAYROLL_UPLOAD_LABELS,
  PAYROLL_FREQUENCY_OPTIONS,
  PAYROLL_COST_CATEGORIES,
  payrollUploadKeysForRow,
  payrollDocsRowCompletion,
  type PayrollDocumentFileMeta,
  type PayrollPayFrequency,
} from "@/lib/payroll-doc-checklist";
import { uploadPayrollDocumentFile, getPayrollDocumentSignedUrl } from "@/services/payroll-documents-storage";
import { getSupabase } from "@/services/base";
import { createCommissionRun, listCommissionRuns, getCommissionRunWithItems, updateCommissionRunItem, approveCommissionRun } from "@/services/commission-runs";
import type { CommissionRun, CommissionRunItem } from "@/types/database";
import { useProfile } from "@/hooks/use-profile";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { getFinancePeriodClosedBounds, formatFinancePeriodKpiDescription } from "@/lib/finance-period";

const INTERNAL_COST_STATUSES: InternalCostStatus[] = ["pending", "paid"];
const RECURRING_FREQUENCIES: RecurringBillFrequency[] = ["monthly", "quarterly", "yearly"];

function parsePayrollDocumentFiles(raw: unknown): Record<string, PayrollDocumentFileMeta> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, PayrollDocumentFileMeta> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && v !== null && "path" in v) {
      const p = (v as { path?: unknown }).path;
      const fn = (v as { file_name?: unknown }).file_name;
      if (typeof p === "string" && p.length > 0) {
        out[k] = { path: p, file_name: typeof fn === "string" ? fn : "" };
      }
    }
  }
  return out;
}
const RECURRING_STATUSES: RecurringBillStatus[] = ["active", "paused"];

const internalCostStatusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" }> = {
  pending: { label: "Pending", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
};

const recurringStatusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" }> = {
  active: { label: "Active", variant: "success" },
  paused: { label: "Paused", variant: "default" },
};

function lifecycleStageOf(c: InternalCost): PayrollInternalLifecycleStage {
  const s = c.lifecycle_stage;
  if (s === "onboarding" || s === "active" || s === "needs_attention" || s === "offboard") return s;
  return "active";
}

const lifecycleStageConfig: Record<
  PayrollInternalLifecycleStage,
  { label: string; variant: "default" | "success" | "warning" | "info" }
> = {
  onboarding: { label: "Onboarding", variant: "info" },
  active: { label: "Active", variant: "success" },
  needs_attention: { label: "Needs attention", variant: "warning" },
  offboard: { label: "Offboard", variant: "default" },
};

function parsePayrollProfile(raw: unknown): PayrollInternalProfile {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    utr: str("utr"),
    ni_number: str("ni_number"),
    tax_code: str("tax_code"),
    position: str("position"),
    phone: str("phone"),
    address: str("address"),
    vat_number: str("vat_number"),
  };
}

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
  const [staffTab, setStaffTab] = useState<"employed" | "self_employed" | "other">("employed");
  const [staffSubTab, setStaffSubTab] = useState<"overview" | "documents" | "payments" | "compliance">("overview");
  const [showArchivedOffboard, setShowArchivedOffboard] = useState(false);
  const [offboardModalRow, setOffboardModalRow] = useState<InternalCost | null>(null);
  const [offboardReason, setOffboardReason] = useState("");
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);

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

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
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

  const internalByStaffTab = useMemo(() => {
    return internalCosts.filter((c) => {
      if (staffTab === "employed") return c.employment_type === "employee";
      if (staffTab === "self_employed") return c.employment_type === "self_employed";
      return c.employment_type !== "employee" && c.employment_type !== "self_employed";
    });
  }, [internalCosts, staffTab]);

  const scopedForStaffKpi = useMemo(() => {
    let list = internalByStaffTab;
    if (periodBounds) {
      list = list.filter((c) => c.due_date && c.due_date >= periodBounds.from && c.due_date <= periodBounds.to);
    }
    return list;
  }, [internalByStaffTab, periodBounds]);

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

  const commissionKpis = useMemo(() => {
    const list = filteredCommissionRuns;
    return {
      total: list.length,
      approved: list.filter((r) => r.status === "approved").length,
      draft: list.filter((r) => r.status === "draft").length,
    };
  }, [filteredCommissionRuns]);

  const filteredStaffTable = useMemo(() => {
    let list = internalByStaffTab;
    if (!showArchivedOffboard) list = list.filter((c) => lifecycleStageOf(c) !== "offboard");

    if (staffSubTab === "documents") {
      list = list.filter((c) => {
        const files = parsePayrollDocumentFiles(c.payroll_document_files);
        const { done, total } = payrollDocsRowCompletion(
          c.employment_type ?? null,
          files,
          c.documents_on_file ?? null,
          c.has_equity ?? false,
        );
        return total > 0 && done < total;
      });
    } else if (staffSubTab === "payments") {
      list = list.filter((c) => c.status === "pending" || !!c.due_date);
    } else if (staffSubTab === "compliance") {
      list = list.filter((c) => {
        const st = lifecycleStageOf(c);
        return st === "onboarding" || st === "needs_attention";
      });
    }

    if (internalFilter !== "all") list = list.filter((c) => c.status === internalFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.reference && c.reference.toLowerCase().includes(q)) ||
          (c.category && c.category.toLowerCase().includes(q)) ||
          (c.payee_name && c.payee_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [internalByStaffTab, showArchivedOffboard, staffSubTab, internalFilter, search]);

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
    const pending = scopedForStaffKpi.filter((c) => c.status === "pending");
    const paid = scopedForStaffKpi.filter((c) => c.status === "paid");
    return {
      totalPending: pending.reduce((s, c) => s + Number(c.amount), 0),
      totalPaid: paid.reduce((s, c) => s + Number(c.amount), 0),
      pendingCount: pending.length,
      paidCount: paid.length,
    };
  }, [scopedForStaffKpi]);

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

  const saveInternal = async (
    form: Partial<InternalCost>,
    extra?: { pendingFiles: Record<string, File> },
  ) => {
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const pendingFiles = extra?.pendingFiles ?? {};

    const mergeUploaded = async (
      costId: string,
      base: Record<string, PayrollDocumentFileMeta>,
    ): Promise<Record<string, PayrollDocumentFileMeta>> => {
      const out = { ...base };
      for (const [docKey, file] of Object.entries(pendingFiles)) {
        if (!file) continue;
        const up = await uploadPayrollDocumentFile(costId, docKey, file);
        out[docKey] = { path: up.path, file_name: up.file_name };
      }
      return out;
    };

    try {
      if (editingInternal) {
        const baseFiles = parsePayrollDocumentFiles(editingInternal.payroll_document_files);
        const mergedFiles = await mergeUploaded(editingInternal.id, baseFiles);
        const updates: Record<string, unknown> = {
          description: form.description!,
          amount: Number(form.amount),
          category: form.category || null,
          due_date: form.due_date || null,
          payee_name: form.payee_name?.trim() || null,
          employment_type: form.employment_type ?? null,
          pay_frequency: form.pay_frequency ?? null,
          payment_day_of_month: form.payment_day_of_month ?? null,
          payroll_document_files: mergedFiles,
          status: form.status ?? editingInternal.status,
          has_equity: form.has_equity ?? false,
          equity_percent: form.equity_percent != null && !Number.isNaN(Number(form.equity_percent)) ? Number(form.equity_percent) : null,
          equity_vesting_notes: form.equity_vesting_notes?.trim() || null,
          equity_start_date: form.equity_start_date || null,
          payroll_profile: form.payroll_profile ?? {},
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
          category: form.category || null,
          due_date: form.due_date || null,
          payee_name: form.payee_name?.trim() || null,
          employment_type: form.employment_type ?? null,
          pay_frequency: form.pay_frequency ?? null,
          payment_day_of_month: form.payment_day_of_month ?? null,
          payroll_document_files: {} as Record<string, PayrollDocumentFileMeta>,
          status: (form.status as InternalCostStatus) ?? "pending",
          paid_at: form.status === "paid" ? now.split("T")[0] : null,
          lifecycle_stage:
            form.employment_type === "employee" || form.employment_type === "self_employed"
              ? "onboarding"
              : "active",
          has_equity: form.has_equity ?? false,
          equity_percent: form.equity_percent != null && !Number.isNaN(Number(form.equity_percent)) ? Number(form.equity_percent) : null,
          equity_vesting_notes: form.equity_vesting_notes?.trim() || null,
          equity_start_date: form.equity_start_date || null,
          payroll_profile: form.payroll_profile ?? {},
          created_at: now,
          updated_at: now,
        };
        const { data: inserted, error: insErr } = await supabase
          .from("payroll_internal_costs")
          .insert(row)
          .select("id")
          .single();
        if (insErr) throw insErr;
        const newId = inserted?.id as string;
        if (Object.keys(pendingFiles).length > 0 && newId) {
          const mergedFiles = await mergeUploaded(newId, {});
          const { error: upErr } = await supabase
            .from("payroll_internal_costs")
            .update({ payroll_document_files: mergedFiles, updated_at: now })
            .eq("id", newId);
          if (upErr) throw upErr;
        }
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
    { id: "internal", label: "Payroll staff", count: internalCosts.length },
    { id: "recurring", label: "Recurring bills", count: scopedRecurring.length },
    { id: "commission", label: "Run Commission", count: filteredCommissionRuns.length },
  ];

  const patchInternalLifecycle = useCallback(
    async (id: string, patch: Record<string, unknown>): Promise<boolean> => {
      const supabase = getSupabase();
      const now = new Date().toISOString();
      setLifecycleBusyId(id);
      try {
        const { error } = await supabase.from("payroll_internal_costs").update({ ...patch, updated_at: now }).eq("id", id);
        if (error) throw error;
        await loadInternal();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
        return false;
      } finally {
        setLifecycleBusyId(null);
      }
    },
    [loadInternal],
  );

  const handleApproveRecurring = useCallback(
    async (row: InternalCost) => {
      if (!row.employment_type) return;
      const files = parsePayrollDocumentFiles(row.payroll_document_files);
      const { done, total } = payrollDocsRowCompletion(
        row.employment_type,
        files,
        row.documents_on_file ?? null,
        row.has_equity ?? false,
      );
      if (total > 0 && done < total) {
        toast.error("Upload all required documents before approving recurring pay");
        return;
      }
      const ok = await patchInternalLifecycle(row.id, {
        lifecycle_stage: "active",
        recurring_approved_at: new Date().toISOString(),
      });
      if (ok) toast.success("Approved once — recurring until offboard. Included in Pay Run when due in the week.");
    },
    [patchInternalLifecycle],
  );

  const handleConfirmOffboard = useCallback(async () => {
    if (!offboardModalRow) return;
    const reason = offboardReason.trim();
    if (reason.length < 3) {
      toast.error("Enter an offboard reason (min. 3 characters)");
      return;
    }
    const ok = await patchInternalLifecycle(offboardModalRow.id, {
      lifecycle_stage: "offboard",
      offboard_reason: reason,
      offboard_at: new Date().toISOString(),
    });
    if (ok) {
      toast.success("Person offboarded and archived with reason on file.");
      setOffboardModalRow(null);
      setOffboardReason("");
    }
  }, [offboardModalRow, offboardReason, patchInternalLifecycle]);

  const internalColumns: Column<InternalCost>[] = [
    {
      key: "payee_name",
      label: "Person",
      render: (r) => (
        <span className="text-sm font-medium text-text-primary">{r.payee_name?.trim() || "—"}</span>
      ),
    },
    {
      key: "employment_type",
      label: "Type",
      width: "120px",
      render: (r) => {
        if (r.employment_type === "employee") {
          return <Badge variant="info" size="sm">Employee</Badge>;
        }
        if (r.employment_type === "self_employed") {
          return <Badge variant="warning" size="sm">Self-employed</Badge>;
        }
        return <span className="text-sm text-text-tertiary">—</span>;
      },
    },
    {
      key: "lifecycle",
      label: "Stage",
      width: "132px",
      render: (r) => {
        const st = lifecycleStageOf(r);
        const cfg = lifecycleStageConfig[st] ?? lifecycleStageConfig.active;
        return (
          <Badge variant={cfg.variant} size="sm">
            {cfg.label}
          </Badge>
        );
      },
    },
    { key: "description", label: "Description", render: (r) => <span className="text-sm text-text-primary">{r.description}</span> },
    { key: "category", label: "Category", render: (r) => <span className="text-sm text-text-secondary">{r.category ?? "—"}</span> },
    {
      key: "pay_schedule",
      label: "Pay schedule",
      minWidth: "150px",
      render: (r) => {
        const freq = r.pay_frequency as PayrollPayFrequency | null | undefined;
        const freqLabel = PAYROLL_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.label ?? (freq ? freq : null);
        const day = r.payment_day_of_month;
        const monthlyDay =
          freq === "monthly" && day != null && day >= 1 && day <= 28 ? (
            <span className="text-[11px] text-text-secondary block">Day {day} of month</span>
          ) : null;
        const due = r.due_date ? (
          <span className="text-[11px] text-text-tertiary block">Next: {formatDate(r.due_date)}</span>
        ) : null;
        return (
          <div className="space-y-0.5">
            {freqLabel ? (
              <span className="text-xs font-medium text-text-primary leading-tight block">{freqLabel}</span>
            ) : (
              <span className="text-xs text-text-tertiary">—</span>
            )}
            {monthlyDay}
            {due}
          </div>
        );
      },
    },
    {
      key: "docs",
      label: "Docs",
      width: "72px",
      align: "center",
      render: (r) => {
        const files = parsePayrollDocumentFiles(r.payroll_document_files);
        const { done, total } = payrollDocsRowCompletion(
          r.employment_type ?? null,
          files,
          r.documents_on_file ?? null,
          r.has_equity ?? false,
        );
        if (!total) return <span className="text-sm text-text-tertiary">—</span>;
        const complete = done === total;
        return (
          <Badge variant={complete ? "success" : "warning"} size="sm">
            {done}/{total}
          </Badge>
        );
      },
    },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(r.amount)}</span> },
    { key: "due_date", label: "Due date", render: (r) => <span className="text-sm text-text-secondary whitespace-nowrap">{r.due_date ? formatDate(r.due_date) : "—"}</span> },
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
      minWidth: "220px",
      render: (r) => {
        const st = lifecycleStageOf(r);
        const busy = lifecycleBusyId === r.id;
        const isStaff = r.employment_type === "employee" || r.employment_type === "self_employed";
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => openEditInternal(r)}>
              Edit
            </Button>
            {isStaff && st === "onboarding" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={busy}
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                onClick={() => void handleApproveRecurring(r)}
              >
                Approve
              </Button>
            )}
            {isStaff && st === "active" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={busy}
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                onClick={() => void patchInternalLifecycle(r.id, { lifecycle_stage: "needs_attention" })}
              >
                Attention
              </Button>
            )}
            {isStaff && st === "needs_attention" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={busy}
                onClick={() => void patchInternalLifecycle(r.id, { lifecycle_stage: "active" })}
              >
                Active
              </Button>
            )}
            {st !== "offboard" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-text-tertiary"
                disabled={busy}
                icon={<UserX className="h-3.5 w-3.5" />}
                onClick={() => {
                  setOffboardModalRow(r);
                  setOffboardReason("");
                }}
              >
                Offboard
              </Button>
            )}
          </div>
        );
      },
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
          subtitle="Pay-run model: Employed vs Self-employed, stages (onboarding → active → needs attention → offboard). Approve once to make recurring until offboard. Only Active + due in week appear in Pay Run. Recurring bills and commission runs below."
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />}>Export CSV</Button>
          {section === "internal" && (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openAddInternal}>
              Add salary or cost
            </Button>
          )}
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
            <div className="flex flex-col gap-3 rounded-xl border border-border-light bg-card/50 p-3 sm:p-4">
              <p className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Staff group</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "employed" as const, label: "Employed" },
                    { id: "self_employed" as const, label: "Self-employed" },
                    { id: "other" as const, label: "Other internal" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStaffTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      staffTab === t.id ? "bg-primary text-white" : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-medium text-text-secondary uppercase tracking-wide pt-1">View</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "overview" as const, label: "Overview" },
                    { id: "documents" as const, label: "Documents" },
                    { id: "payments" as const, label: "Payments" },
                    { id: "compliance" as const, label: "Compliance" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStaffSubTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      staffSubTab === t.id ? "bg-text-primary text-white dark:bg-surface-tertiary" : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showArchivedOffboard}
                  onChange={(e) => setShowArchivedOffboard(e.target.checked)}
                  className="rounded border-border"
                />
                Show offboard (archived)
              </label>
            </div>

            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                title="Pending total"
                value={internalTotals.totalPending}
                format="currency"
                description={`Due date · ${kpiPeriodDesc}`}
                icon={DollarSign}
                accent="amber"
              />
              <KpiCard
                title="Paid total"
                value={internalTotals.totalPaid}
                format="currency"
                description={`Due date · ${kpiPeriodDesc}`}
                icon={CircleDollarSign}
                accent="emerald"
              />
              <KpiCard
                title="Pending items"
                value={internalTotals.pendingCount}
                format="number"
                description={`${kpiPeriodDesc}`}
                icon={Calendar}
                accent="primary"
              />
              <KpiCard
                title="Paid items"
                value={internalTotals.paidCount}
                format="number"
                description={`${kpiPeriodDesc}`}
                icon={CircleDollarSign}
                accent="blue"
              />
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
                <SearchInput placeholder="Search person, description, category…" className="w-56 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <DataTable
                columns={internalColumns}
                data={filteredStaffTable}
                getRowId={(r) => r.id}
                loading={loading}
                page={1}
                totalPages={1}
                totalItems={filteredStaffTable.length}
                tableClassName="min-w-[1280px]"
              />
            </motion.div>
          </>
        )}

        {section === "recurring" && (
          <>
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                title="Active bills"
                value={recurringTotals.activeCount}
                format="number"
                description={`Next due · ${kpiPeriodDesc}`}
                icon={Repeat}
                accent="primary"
              />
              <KpiCard
                title="Monthly equivalent"
                value={recurringTotals.totalMonthlyEquivalent}
                format="currency"
                description={`Scoped rows · ${kpiPeriodDesc}`}
                icon={DollarSign}
                accent="amber"
              />
              <KpiCard
                title="Due in 30 days"
                value={recurringTotals.nextDueCount}
                format="number"
                description={`Within window · ${kpiPeriodDesc}`}
                icon={Calendar}
                accent="amber"
              />
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
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <KpiCard
                title="Runs in period"
                value={commissionKpis.total}
                format="number"
                description={`Period overlap · ${kpiPeriodDesc}`}
                icon={Play}
                accent="primary"
              />
              <KpiCard
                title="Approved runs"
                value={commissionKpis.approved}
                format="number"
                description={kpiPeriodDesc}
                icon={CheckCircle2}
                accent="emerald"
              />
              <KpiCard
                title="Draft runs"
                value={commissionKpis.draft}
                format="number"
                description={kpiPeriodDesc}
                icon={FileText}
                accent="amber"
              />
            </StaggerContainer>
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

        <Modal
          open={!!offboardModalRow}
          onClose={() => {
            setOffboardModalRow(null);
            setOffboardReason("");
          }}
          title="Offboard"
          subtitle="The reason is stored on this record permanently (audit / archive)."
          size="md"
        >
          <div className="p-6 space-y-4">
            <p className="text-sm text-text-secondary">
              Offboard{" "}
              <span className="font-medium text-text-primary">
                {offboardModalRow?.payee_name?.trim() || offboardModalRow?.description || "—"}
              </span>
              . They will leave Pay Run and Active lists (toggle &quot;Show offboard&quot; to see archived rows).
            </p>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason *</label>
              <textarea
                className="w-full min-h-[100px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15"
                value={offboardReason}
                onChange={(e) => setOffboardReason(e.target.value)}
                placeholder="e.g. End of contract, resignation, project completed…"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOffboardModalRow(null);
                  setOffboardReason("");
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleConfirmOffboard()} icon={<UserX className="h-3.5 w-3.5" />}>
                Confirm offboard
              </Button>
            </div>
          </div>
        </Modal>

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
  onSave: (form: Partial<InternalCost>, extra?: { pendingFiles: Record<string, File> }) => Promise<void>;
  saving: boolean;
}) {
  const [payeeName, setPayeeName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Salary");
  const [employmentType, setEmploymentType] = useState<"" | PayrollInternalEmploymentType>("");
  const [payFrequency, setPayFrequency] = useState<"" | PayrollPayFrequency>("");
  const [paymentDay, setPaymentDay] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InternalCostStatus>("pending");
  const [existingFiles, setExistingFiles] = useState<Record<string, PayrollDocumentFileMeta>>({});
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | null>>({});
  const [hasEquity, setHasEquity] = useState(false);
  const [equityPercent, setEquityPercent] = useState("");
  const [equityVesting, setEquityVesting] = useState("");
  const [equityStartDate, setEquityStartDate] = useState("");
  const [profileUtr, setProfileUtr] = useState("");
  const [profileNi, setProfileNi] = useState("");
  const [profileTaxCode, setProfileTaxCode] = useState("");
  const [profilePosition, setProfilePosition] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileVat, setProfileVat] = useState("");

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setPayeeName(initial?.payee_name ?? "");
      setDescription(initial?.description ?? "");
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setCategory(initial?.category ?? "Salary");
      setEmploymentType((initial?.employment_type as PayrollInternalEmploymentType) ?? "");
      setPayFrequency((initial?.pay_frequency as PayrollPayFrequency) ?? "");
      setPaymentDay(
        initial?.payment_day_of_month != null && initial.payment_day_of_month >= 1
          ? String(initial.payment_day_of_month)
          : ""
      );
      setDueDate(initial?.due_date ?? "");
      setStatus(initial?.status ?? "pending");
      setExistingFiles(parsePayrollDocumentFiles(initial?.payroll_document_files));
      setPendingFiles({});
      setHasEquity(!!initial?.has_equity);
      setEquityPercent(initial?.equity_percent != null ? String(initial.equity_percent) : "");
      setEquityVesting(initial?.equity_vesting_notes ?? "");
      setEquityStartDate(initial?.equity_start_date ?? "");
      const prof = parsePayrollProfile(initial?.payroll_profile);
      setProfileUtr(prof.utr ?? "");
      setProfileNi(prof.ni_number ?? "");
      setProfileTaxCode(prof.tax_code ?? "");
      setProfilePosition(prof.position ?? "");
      setProfilePhone(prof.phone ?? "");
      setProfileAddress(prof.address ?? "");
      setProfileVat(prof.vat_number ?? "");
    });
  }, [open, initial]);

  const isOffboard = initial?.lifecycle_stage === "offboard";
  const docKeys = payrollUploadKeysForRow(employmentType || null, hasEquity);

  const openSigned = async (path: string) => {
    try {
      const url = await getPayrollDocumentSignedUrl(path, 3600);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open file");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffboard) {
      toast.error("This person is offboard (read-only).");
      return;
    }
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num < 0) {
      toast.error("Valid amount is required");
      return;
    }
    const emp = employmentType || null;
    let paymentDayNum: number | null = null;
    if (payFrequency === "monthly") {
      if (!paymentDay.trim()) {
        toast.error("Pay day of month (1–28) is required for monthly payroll");
        return;
      }
      const d = parseInt(paymentDay, 10);
      if (Number.isNaN(d) || d < 1 || d > 28) {
        toast.error("Pay day must be between 1 and 28");
        return;
      }
      paymentDayNum = d;
    } else {
      paymentDayNum = null;
    }

    const payrollProfilePayload: PayrollInternalProfile = {
      ...(profileUtr.trim() ? { utr: profileUtr.trim() } : {}),
      ...(profileNi.trim() ? { ni_number: profileNi.trim() } : {}),
      ...(profileTaxCode.trim() ? { tax_code: profileTaxCode.trim() } : {}),
      ...(profilePosition.trim() ? { position: profilePosition.trim() } : {}),
      ...(profilePhone.trim() ? { phone: profilePhone.trim() } : {}),
      ...(profileAddress.trim() ? { address: profileAddress.trim() } : {}),
      ...(profileVat.trim() ? { vat_number: profileVat.trim() } : {}),
    };

    const equityPercentNum =
      hasEquity && equityPercent.trim() ? parseFloat(equityPercent) : undefined;
    if (hasEquity && equityPercent.trim() && (Number.isNaN(equityPercentNum!) || equityPercentNum! < 0)) {
      toast.error("Equity % must be a valid number");
      return;
    }

    const pendingPayload = Object.fromEntries(Object.entries(pendingFiles).filter(([, f]) => f != null)) as Record<string, File>;

    if (emp) {
      if (!payFrequency) {
        toast.error("Select pay frequency");
        return;
      }
      if (!dueDate.trim()) {
        toast.error("Next payment date is required");
        return;
      }
      for (const k of docKeys) {
        const hasExisting = !!existingFiles[k]?.path;
        const hasPending = !!pendingFiles[k];
        if (!hasExisting && !hasPending) {
          toast.error(`Upload required: ${PAYROLL_UPLOAD_LABELS[k] ?? k}`);
          return;
        }
      }
      await onSave(
        {
          payee_name: payeeName.trim() || undefined,
          description: description.trim(),
          amount: num,
          category: category.trim() || undefined,
          employment_type: emp,
          pay_frequency: payFrequency as PayrollInternalPayFrequency,
          payment_day_of_month: paymentDayNum ?? undefined,
          due_date: dueDate || undefined,
          status,
          has_equity: hasEquity,
          equity_percent: equityPercentNum,
          equity_vesting_notes: hasEquity ? equityVesting.trim() || undefined : undefined,
          equity_start_date: hasEquity ? equityStartDate || undefined : undefined,
          payroll_profile: payrollProfilePayload,
        },
        { pendingFiles: pendingPayload },
      );
      return;
    }

    if (hasEquity) {
      for (const k of payrollUploadKeysForRow(null, true)) {
        const hasExisting = !!existingFiles[k]?.path;
        const hasPending = !!pendingFiles[k];
        if (!hasExisting && !hasPending) {
          toast.error(`Upload required: ${PAYROLL_UPLOAD_LABELS[k] ?? k}`);
          return;
        }
      }
    }

    let otherMonthlyDay: number | null = null;
    if (payFrequency === "monthly" && paymentDay.trim()) {
      const d = parseInt(paymentDay, 10);
      if (!Number.isNaN(d) && d >= 1 && d <= 28) otherMonthlyDay = d;
    }
    await onSave(
      {
        payee_name: payeeName.trim() || undefined,
        description: description.trim(),
        amount: num,
        category: category.trim() || undefined,
        employment_type: undefined,
        pay_frequency: payFrequency ? (payFrequency as PayrollInternalPayFrequency) : undefined,
        payment_day_of_month: otherMonthlyDay ?? undefined,
        due_date: dueDate || undefined,
        status,
        has_equity: hasEquity,
        equity_percent: equityPercentNum,
        equity_vesting_notes: hasEquity ? equityVesting.trim() || undefined : undefined,
        equity_start_date: hasEquity ? equityStartDate || undefined : undefined,
        payroll_profile: payrollProfilePayload,
      },
      Object.keys(pendingPayload).length > 0 ? { pendingFiles: pendingPayload } : undefined,
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit salary or cost" : "Add salary or cost"}
      subtitle="Stages: new staff start in Onboarding; Approve once on the list moves them to Active (recurring in Pay Run until offboard). Upload documents, optional UK profile and equity."
      size="lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4 max-h-[min(78vh,720px)] overflow-y-auto">
        {isOffboard && (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 dark:bg-amber-950/25 p-3 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Offboard (archived)</p>
            {initial?.offboard_reason && <p className="mt-1">Reason on file: {initial.offboard_reason}</p>}
            {initial?.offboard_at && (
              <p className="text-xs text-text-tertiary mt-1">{formatDate(initial.offboard_at.split("T")[0])}</p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Person / payee</label>
            <Input
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="Full name as on payroll or contract"
              disabled={isOffboard}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Description *</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Monthly salary April"
              required
              disabled={isOffboard}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount *</label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              disabled={isOffboard}
            />
          </div>
          <div>
            <Select
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={PAYROLL_COST_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              disabled={isOffboard}
            />
          </div>
          <div className="sm:col-span-2 rounded-xl border border-border-light bg-surface-hover/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-text-primary">Profile (UK — optional)</p>
            <p className="text-[11px] text-text-tertiary">UTR / VAT for contractors; NI, tax code, role for employees. Stored as structured fields for future payslips and self-bills.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input value={profileUtr} onChange={(e) => setProfileUtr(e.target.value)} placeholder="UTR" disabled={isOffboard} />
              <Input value={profileVat} onChange={(e) => setProfileVat(e.target.value)} placeholder="VAT number" disabled={isOffboard} />
              <Input value={profileNi} onChange={(e) => setProfileNi(e.target.value)} placeholder="NI number" disabled={isOffboard} />
              <Input value={profileTaxCode} onChange={(e) => setProfileTaxCode(e.target.value)} placeholder="Tax code (e.g. 1257L)" disabled={isOffboard} />
              <Input value={profilePosition} onChange={(e) => setProfilePosition(e.target.value)} placeholder="Position / role" disabled={isOffboard} />
              <Input value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} placeholder="Phone" disabled={isOffboard} />
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Address</label>
                <Input value={profileAddress} onChange={(e) => setProfileAddress(e.target.value)} placeholder="Address" disabled={isOffboard} />
              </div>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Select
              label="Employment type"
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as "" | PayrollInternalEmploymentType)}
              options={[
                { value: "", label: "Other / one-off cost (no uploads)" },
                { value: "employee", label: "Employee (PAYE)" },
                { value: "self_employed", label: "Self-employed (contractor)" },
              ]}
              disabled={isOffboard}
            />
          </div>
          <div className="sm:col-span-2">
            <Select
              label="Pay frequency"
              value={payFrequency}
              onChange={(e) => setPayFrequency(e.target.value as "" | PayrollPayFrequency)}
              options={[
                { value: "", label: "—" },
                ...PAYROLL_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
              ]}
              disabled={isOffboard}
            />
          </div>
          {payFrequency === "monthly" && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Pay day of month (1–28)</label>
              <Input
                type="number"
                min={1}
                max={28}
                value={paymentDay}
                onChange={(e) => setPaymentDay(e.target.value)}
                placeholder="e.g. 25"
                disabled={isOffboard}
              />
              <p className="text-[10px] text-text-tertiary mt-1">Calendar day each month (like a recurring bill).</p>
            </div>
          )}
          <div className={payFrequency === "monthly" ? "" : "sm:col-span-2"}>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Next payment date</label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isOffboard} />
            <p className="text-[10px] text-text-tertiary mt-1">Next run in the ledger (pending / paid).</p>
          </div>
        </div>

        <div className="rounded-xl border border-border-light p-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasEquity}
              disabled={isOffboard}
              onChange={(e) => {
                setHasEquity(e.target.checked);
                if (!e.target.checked) setPendingFiles((p) => ({ ...p, equity_agreement: null }));
              }}
              className="rounded border-border"
            />
            Equity participation
          </label>
          {hasEquity && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Equity %</label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={equityPercent}
                  onChange={(e) => setEquityPercent(e.target.value)}
                  placeholder="e.g. 0.5"
                  disabled={isOffboard}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Vesting (optional)</label>
                <Input
                  value={equityVesting}
                  onChange={(e) => setEquityVesting(e.target.value)}
                  placeholder="e.g. 4-year vest, 1-year cliff"
                  disabled={isOffboard}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Equity start date</label>
                <Input type="date" value={equityStartDate} onChange={(e) => setEquityStartDate(e.target.value)} disabled={isOffboard} />
              </div>
            </div>
          )}
        </div>

        {docKeys.length > 0 && (
          <div className="rounded-xl border border-border-light bg-surface-hover/40 p-4 space-y-3">
            <p className="text-xs font-semibold text-text-primary">Required documents (upload)</p>
            <p className="text-[11px] text-text-tertiary leading-snug">
              PDF, Word, or image. Each line must have a file before saving. Self-employed: passport, service agreement, self-bill agreement. Employee: passport, contract, right to work, PAYE setup, service agreement.
            </p>
            <ul className="space-y-4">
              {docKeys.map((key) => (
                <li key={key} className="space-y-1.5">
                  <p className="text-sm font-medium text-text-primary">{PAYROLL_UPLOAD_LABELS[key] ?? key}</p>
                  {existingFiles[key]?.path && !pendingFiles[key] ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text-secondary truncate max-w-[200px]">{existingFiles[key].file_name}</span>
                      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => void openSigned(existingFiles[key].path)}>
                        View
                      </Button>
                      {!isOffboard && (
                        <label className="text-xs font-medium text-primary cursor-pointer hover:underline">
                          Replace
                          <input
                            type="file"
                            className="sr-only"
                            accept=".pdf,.doc,.docx,image/*"
                            onChange={(ev) => {
                              const f = ev.target.files?.[0];
                              if (f) setPendingFiles((p) => ({ ...p, [key]: f }));
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ) : pendingFiles[key] ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-emerald-700 dark:text-emerald-400">Selected: {pendingFiles[key]!.name}</span>
                      {!isOffboard && (
                        <button type="button" className="text-xs text-text-tertiary hover:text-text-secondary" onClick={() => setPendingFiles((p) => ({ ...p, [key]: null }))}>
                          Clear
                        </button>
                      )}
                    </div>
                  ) : (
                    <label
                      className={`inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-text-secondary ${
                        isOffboard ? "opacity-50 cursor-not-allowed" : "hover:bg-surface-hover cursor-pointer"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Choose file
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.doc,.docx,image/*"
                        disabled={isOffboard}
                        onChange={(ev) => {
                          const f = ev.target.files?.[0];
                          if (f) setPendingFiles((p) => ({ ...p, [key]: f }));
                        }}
                      />
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as InternalCostStatus)}
          options={INTERNAL_COST_STATUSES.map((s) => ({ value: s, label: s === "paid" ? "Paid" : "Pending" }))}
          disabled={isOffboard}
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || isOffboard}
            icon={saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : undefined}
          >
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
    if (!open) return;
    queueMicrotask(() => {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setAmount(initial?.amount != null ? String(initial.amount) : "");
      setFrequency(initial?.frequency ?? "monthly");
      setNextDueDate(initial?.next_due_date ?? "");
      setCategory(initial?.category ?? "");
      setStatus(initial?.status ?? "active");
    });
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
