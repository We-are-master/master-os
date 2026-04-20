"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SearchInput, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Drawer } from "@/components/ui/drawer";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Download,
  Wallet,
  DollarSign,
  CheckCircle2,
  CalendarRange,
  RefreshCw,
  FileText,
  ExternalLink,
  LayoutGrid,
  List,
  Pencil,
  XCircle,
  Clock,
  AlertTriangle,
  Check,
  RotateCcw,
  TrendingUp,
  Ban,
  Receipt,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { SelfBill } from "@/types/database";
import { getSupabase } from "@/services/base";
import {
  weekPeriodHelpText,
  partnerFieldSelfBillPaymentDueHelpText,
  partnerFieldSelfBillPaymentDueDate,
  parseDateRangeOrWeek,
  getWeekBoundsForDate,
} from "@/lib/self-bill-period";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import {
  DEFAULT_FINANCE_PERIOD_MODE,
  formatFinancePeriodKpiDescription,
  getMonthBoundsForDate,
} from "@/lib/finance-period";
import { SELF_BILL_FINANCE_VOID_LABEL, selfBillPartnerStatusLine } from "@/lib/self-bill-display";
import {
  isSelfBillPayoutVoided,
  jobContributesToSelfBillPayout,
  listJobsForSelfBill,
  listJobsLinkedToSelfBillIds,
  selfBillJobPayoutStateLabel,
} from "@/services/self-bills";
import type { Job } from "@/types/database";
import { partnerSelfBillGrossAmount } from "@/lib/job-financials";

const JOB_PAYMENTS_IN_CHUNK = 80;

const PERIOD_HEADER_LABEL: Record<FinancePeriodMode, string> = {
  all: "All",
  day: "Day",
  month: "Month",
  week: "Week",
  range: "Range",
};

// ── Status model ──────────────────────────────────────────────────────────────

/** DB statuses that map to the "Draft" UI bucket (job still in progress). */
const DRAFT_DB_STATUSES = new Set(["draft", "accumulating", "needs_attention"]);

/** DB statuses that map to the "Ready to Pay" UI bucket (before overdue check). */
const READY_DB_STATUSES = new Set(["ready_to_pay", "pending_review", "awaiting_payment"]);

function selfBillDueYmd(sb: Pick<SelfBill, "week_end" | "due_date">): string {
  // Prefer stored due_date (set by partner.payment_terms or manual edit)
  const stored = sb.due_date?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  // Fall back to computed Friday-after-week-end
  const we = sb.week_end?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(we)) return "";
  return partnerFieldSelfBillPaymentDueDate(we);
}

function sbTodayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function isSelfBillOverdue(sb: Pick<SelfBill, "status" | "week_end" | "due_date">, todayYmd: string): boolean {
  if (!READY_DB_STATUSES.has(sb.status)) return false;
  const due = selfBillDueYmd(sb);
  if (!due) return false;
  return todayYmd > due;
}

type SelfBillDisplayStatus = {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info";
};

function getSelfBillDisplayStatus(sb: SelfBill, todayYmd: string): SelfBillDisplayStatus {
  if (isSelfBillPayoutVoided(sb)) return { label: "Void", variant: "default" };
  if (sb.status === "paid") return { label: "Paid", variant: "success" };
  if (sb.status === "audit_required") return { label: "Audit required", variant: "danger" };
  if (sb.status === "rejected") return { label: "Rejected", variant: "default" };
  if (DRAFT_DB_STATUSES.has(sb.status)) return { label: "Draft", variant: "default" };
  if (READY_DB_STATUSES.has(sb.status)) {
    if (isSelfBillOverdue(sb, todayYmd)) return { label: "Overdue", variant: "danger" };
    return { label: "Ready to Pay", variant: "info" };
  }
  return { label: sb.status, variant: "default" };
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TAB_ORDER = [
  "all",
  "draft",
  "ready_to_pay",
  "overdue",
  "paid",
  "audit_required",
  "rejected",
] as const;

type SelfBillTab = (typeof TAB_ORDER)[number];

const TAB_LABELS: Record<SelfBillTab, string> = {
  all: "All",
  draft: "Draft",
  ready_to_pay: "Ready to Pay",
  overdue: "Overdue",
  paid: "Paid",
  audit_required: "Audit required",
  rejected: "Cancelled & Rejected",
};

function selfBillMatchesTab(sb: SelfBill, tab: SelfBillTab, todayYmd: string): boolean {
  if (tab === "all") return true;
  if (isSelfBillPayoutVoided(sb)) return tab === "rejected";
  if (tab === "draft") return DRAFT_DB_STATUSES.has(sb.status);
  if (tab === "ready_to_pay") return READY_DB_STATUSES.has(sb.status) && !isSelfBillOverdue(sb, todayYmd);
  if (tab === "overdue") return isSelfBillOverdue(sb, todayYmd);
  if (tab === "paid") return sb.status === "paid";
  if (tab === "audit_required") return sb.status === "audit_required";
  if (tab === "rejected") return sb.status === "rejected";
  return false;
}

// ── Payout helpers ─────────────────────────────────────────────────────────────

async function fetchPartnerPaidTotalsByJobIds(jobIds: string[]): Promise<Record<string, number>> {
  if (jobIds.length === 0) return {};
  const supabase = getSupabase();
  const sums: Record<string, number> = {};
  for (let i = 0; i < jobIds.length; i += JOB_PAYMENTS_IN_CHUNK) {
    const chunk = jobIds.slice(i, i + JOB_PAYMENTS_IN_CHUNK);
    const q = supabase.from("job_payments").select("job_id, amount").eq("type", "partner").in("job_id", chunk).is("deleted_at", null);
    let { data, error } = await q;
    if (error) {
      const retry = await supabase.from("job_payments").select("job_id, amount").eq("type", "partner").in("job_id", chunk);
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    for (const row of data ?? []) {
      const id = String((row as { job_id: string }).job_id);
      sums[id] = (sums[id] ?? 0) + Number((row as { amount: number }).amount);
    }
  }
  return sums;
}

function jobLinePartnerGross(j: Pick<Job, "partner_cost" | "materials_cost" | "partner_agreed_value">): number {
  return Math.round(partnerSelfBillGrossAmount(j as Job) * 100) / 100;
}

function computeSelfBillAmountDue(
  sb: SelfBill,
  jobs: JobLine[] | undefined,
  partnerPaidByJobId: Record<string, number>,
): number {
  if (isSelfBillPayoutVoided(sb)) return 0;
  if (sb.bill_origin === "internal") {
    return Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
  }
  const list = jobs ?? [];
  let due = 0;
  for (const j of list) {
    if (!jobContributesToSelfBillPayout(j)) continue;
    const cap = jobLinePartnerGross(j);
    const paid = partnerPaidByJobId[j.id] ?? 0;
    due += Math.max(0, cap - paid);
  }
  return Math.round(due * 100) / 100;
}

function isPartnerFieldBill(sb: SelfBill): boolean {
  return sb.bill_origin !== "internal";
}

// ── Types ──────────────────────────────────────────────────────────────────────

type JobLine = Pick<
  Job,
  | "id"
  | "reference"
  | "title"
  | "partner_cost"
  | "partner_agreed_value"
  | "materials_cost"
  | "status"
  | "property_address"
  | "self_bill_id"
  | "deleted_at"
  | "partner_cancelled_at"
>;

// ── Page component ─────────────────────────────────────────────────────────────

export default function SelfBillPage() {
  const [activeTab, setActiveTab] = useState<SelfBillTab>("draft");
  const [layoutMode, setLayoutMode] = useState<"cards" | "table">("table");
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const periodMenuRef = useRef<HTMLDivElement>(null);
  const [drawerSelfBill, setDrawerSelfBill] = useState<SelfBill | null>(null);
  const [drawerJobs, setDrawerJobs] = useState<Awaited<ReturnType<typeof listJobsForSelfBill>>>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsBySelfBillId, setJobsBySelfBillId] = useState<Record<string, JobLine[]>>({});
  const [partnerPaidByJobId, setPartnerPaidByJobId] = useState<Record<string, number>>({});
  const [editSelfBill, setEditSelfBill] = useState<SelfBill | null>(null);
  const [editForm, setEditForm] = useState({ job_value: "", materials: "", commission: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [originFilter, setOriginFilter] = useState<"all" | "partner" | "internal">("all");
  const [todayYmd] = useState(() => sbTodayYmd());
  const [recalculating, setRecalculating] = useState(false);

  const searchParams = useSearchParams();
  const autoOpenSbId = searchParams.get("open");
  const autoOpenFiredRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    try {
      let q = supabase.from("self_bills").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false });
      if (periodMode === "week") {
        const { weekLabel } = getWeekBoundsForDate(weekAnchor);
        q = q.eq("week_label", weekLabel);
      } else if (periodMode === "month") {
        const { from, to } = getMonthBoundsForDate(monthAnchor);
        q = q.gte("week_start", from).lte("week_start", to);
      } else if (periodMode === "range") {
        const range = parseDateRangeOrWeek({ from: rangeFrom.trim() || undefined, to: rangeTo.trim() || undefined });
        if (range.weekStartMin) q = q.gte("week_start", range.weekStartMin);
        if (range.weekStartMax) q = q.lte("week_start", range.weekStartMax);
      }
      const { data, error } = await q;
      if (error) throw error;
      setSelfBills((data ?? []) as SelfBill[]);
    } catch (e) {
      console.error("Self-bills load failed", e);
      toast.error(e instanceof Error ? e.message : "Failed to load self-bills");
    } finally {
      setLoading(false);
    }
  }, [periodMode, weekAnchor, monthAnchor, rangeFrom, rangeTo]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel("self_bills_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "self_bills" }, () => { loadData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = periodMenuRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setPeriodMenuOpen(false);
    };
    if (periodMenuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [periodMenuOpen]);

  const filtered = useMemo(() => {
    let result = selfBills.filter((sb) => selfBillMatchesTab(sb, activeTab, todayYmd));
    if (originFilter === "partner") result = result.filter((sb) => isPartnerFieldBill(sb));
    else if (originFilter === "internal") result = result.filter((sb) => sb.bill_origin === "internal");
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (sb) =>
          (sb.partner_name ?? "").toLowerCase().includes(q) ||
          (sb.reference ?? "").toLowerCase().includes(q) ||
          (sb.week_label ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [selfBills, activeTab, search, originFilter, todayYmd]);

  const tabCounts = useMemo(() => {
    const counts: Record<SelfBillTab, number> = { all: selfBills.length, draft: 0, ready_to_pay: 0, overdue: 0, paid: 0, audit_required: 0, rejected: 0 };
    for (const sb of selfBills) {
      for (const tab of TAB_ORDER) {
        if (tab !== "all" && selfBillMatchesTab(sb, tab, todayYmd)) {
          counts[tab]++;
          break;
        }
      }
    }
    return counts;
  }, [selfBills, todayYmd]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor),
    [periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor],
  );

  const totals = useMemo(() => {
    let readyDueSum = 0;
    let overdueSum = 0;
    for (const sb of selfBills) {
      if (isSelfBillPayoutVoided(sb)) continue;
      const due = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
      if (READY_DB_STATUSES.has(sb.status) && !isSelfBillOverdue(sb, todayYmd)) readyDueSum += due;
      if (isSelfBillOverdue(sb, todayYmd)) overdueSum += due;
    }
    const draftCount = selfBills.filter((sb) => DRAFT_DB_STATUSES.has(sb.status)).length;
    const readyCount = selfBills.filter((sb) => READY_DB_STATUSES.has(sb.status) && !isSelfBillOverdue(sb, todayYmd)).length;
    const overdueCount = selfBills.filter((sb) => isSelfBillOverdue(sb, todayYmd)).length;
    // Avg payout per week: group non-voided partner self-bills by week_label, average the net_payout per week
    const weekMap = new Map<string, number>();
    for (const sb of selfBills) {
      if (isSelfBillPayoutVoided(sb) || !isPartnerFieldBill(sb)) continue;
      const wk = sb.week_label ?? sb.period ?? "?";
      weekMap.set(wk, (weekMap.get(wk) ?? 0) + Number(sb.net_payout ?? 0));
    }
    const avgPerWeek = weekMap.size > 0
      ? [...weekMap.values()].reduce((s, v) => s + v, 0) / weekMap.size
      : 0;
    return { draftCount, readyCount, readyDueSum, overdueCount, overdueSum, avgPerWeek };
  }, [selfBills, jobsBySelfBillId, partnerPaidByJobId, todayYmd]);

  const updateSbStatus = async (id: string, newStatus: string) => {
    const supabase = getSupabase();
    const { error } = await supabase.from("self_bills").update({ status: newStatus }).eq("id", id);
    if (error) throw error;
  };

  const refreshDrawer = (id: string, newStatus: string) => {
    setDrawerSelfBill((prev) => prev?.id === id ? { ...prev, status: newStatus as SelfBill["status"] } : prev);
  };

  const handleMarkReadyToPay = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "ready_to_pay");
      toast.success("Marked ready to pay");
      refreshDrawer(sb.id, "ready_to_pay");
      loadData();
    } catch { toast.error("Failed to update status"); }
  };

  const handleMarkPaid = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "paid");
      toast.success("Self-bill marked as paid");
      refreshDrawer(sb.id, "paid");
      loadData();
    } catch { toast.error("Failed to mark as paid"); }
  };

  const handleMarkAuditRequired = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "audit_required");
      toast.success("Flagged for audit review");
      refreshDrawer(sb.id, "audit_required");
      loadData();
    } catch { toast.error("Failed to flag for audit"); }
  };

  const handleRejectSelfBill = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "rejected");
      toast.success("Self-bill rejected");
      refreshDrawer(sb.id, "rejected");
      loadData();
    } catch { toast.error("Failed to reject"); }
  };

  const handleReopenSelfBill = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "ready_to_pay");
      toast.success("Self-bill reopened");
      refreshDrawer(sb.id, "ready_to_pay");
      loadData();
    } catch { toast.error("Failed to reopen"); }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const eligible = Array.from(selectedIds).filter((id) => {
      const sb = selfBills.find((s) => s.id === id);
      return sb && !isSelfBillPayoutVoided(sb);
    });
    if (eligible.length === 0) {
      toast.error("Selected self-bills include void records — remove them from the selection.");
      return;
    }
    if (eligible.length < selectedIds.size) toast.message(`${selectedIds.size - eligible.length} void self-bill(s) skipped`);
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("self_bills").update({ status: newStatus }).in("id", eligible);
      if (error) throw error;
      toast.success(`${eligible.length} self-bill(s) updated`);
      setSelectedIds(new Set());
      loadData();
    } catch { toast.error("Failed to update self-bills"); }
  };

  const openEdit = (sb: SelfBill) => {
    setEditSelfBill(sb);
    setEditForm({ job_value: String(sb.job_value ?? 0), materials: String(sb.materials ?? 0), commission: String(sb.commission ?? 0) });
  };

  const saveEdit = async () => {
    if (!editSelfBill) return;
    const jv = Number(editForm.job_value) || 0;
    const mat = Number(editForm.materials) || 0;
    const comm = Number(editForm.commission) || 0;
    const net = jv + mat - comm;
    setSavingEdit(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("self_bills").update({ job_value: jv, materials: mat, commission: comm, net_payout: net }).eq("id", editSelfBill.id);
      if (error) throw error;
      toast.success("Totals updated");
      setEditSelfBill(null);
      loadData();
    } catch { toast.error("Failed to save"); } finally { setSavingEdit(false); }
  };

  const openDrawer = async (sb: SelfBill) => {
    setLoadingJobs(true);
    setDrawerSelfBill(sb);
    setDrawerJobs([]);
    try {
      const jobs = await listJobsForSelfBill(sb.id);
      setDrawerJobs(jobs);
    } catch { toast.error("Failed to load jobs"); } finally { setLoadingJobs(false); }
  };

  useEffect(() => {
    if (!autoOpenSbId || autoOpenFiredRef.current || selfBills.length === 0) return;
    const match = selfBills.find((sb) => sb.id === autoOpenSbId);
    if (!match) return;
    autoOpenFiredRef.current = true;
    void openDrawer(match);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSbId, selfBills]);

  useEffect(() => {
    let cancelled = false;
    const ids = selfBills.map((sb) => sb.id);
    if (ids.length === 0) { setJobsBySelfBillId({}); setPartnerPaidByJobId({}); return; }
    (async () => {
      try {
        const rows = await listJobsLinkedToSelfBillIds(ids);
        if (cancelled) return;
        const map: Record<string, JobLine[]> = {};
        for (const j of rows) {
          const sid = j.self_bill_id as string;
          if (!map[sid]) map[sid] = [];
          map[sid].push(j);
        }
        setJobsBySelfBillId(map);
        const jobIds = [...new Set(rows.map((r) => r.id))];
        const paidMap = await fetchPartnerPaidTotalsByJobIds(jobIds);
        if (!cancelled) setPartnerPaidByJobId(paidMap);
      } catch (e) {
        console.error("Self-bill linked jobs load failed", e);
        if (!cancelled) { setJobsBySelfBillId({}); setPartnerPaidByJobId({}); toast.error(e instanceof Error ? e.message : "Failed to load jobs"); }
      }
    })();
    return () => { cancelled = true; };
  }, [selfBills]);

  const handleExportCsv = useCallback(() => {
    const headers = ["Reference", "Partner", "Origin", "Week label", "Week start", "Status", "Net payout", "Amount due", "Jobs count", "Created at"];
    const rows = filtered.map((sb) => {
      const due = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
      return [sb.reference, sb.partner_name, sb.bill_origin ?? "", sb.week_label ?? "", sb.week_start ?? "", sb.status, String(sb.net_payout ?? ""), String(due), String(sb.jobs_count ?? ""), sb.created_at ?? ""];
    });
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `self-bills-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }, [filtered, jobsBySelfBillId, partnerPaidByJobId]);

  const handleFullSync = useCallback(async () => {
    setRecalculating(true);
    try {
      const res = await fetch("/api/admin/selfbills/full-sync", { method: "POST" });
      const data = await res.json().catch(() => ({})) as { backfilled?: number; promoted?: number; totalsUpdated?: number; dueDatesUpdated?: number; errors?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const parts = [
        data.backfilled ? `${data.backfilled} linked` : null,
        data.promoted ? `${data.promoted} promoted` : null,
        data.totalsUpdated ? `${data.totalsUpdated} totals updated` : null,
      ].filter(Boolean);
      toast.success(`Sync complete — ${parts.length ? parts.join(", ") : "everything up to date"}`);
      void loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setRecalculating(false);
    }
  }, [loadData]);

  const tabs = useMemo(
    () => TAB_ORDER.map((id) => ({ id, label: TAB_LABELS[id], count: tabCounts[id] })),
    [tabCounts],
  );

  const columns: Column<SelfBill>[] = [
    {
      key: "reference",
      label: "Self bill",
      minWidth: "200px",
      cellClassName: "!whitespace-nowrap max-w-[min(260px,36vw)] overflow-hidden align-top",
      render: (item) => (
        <p className="text-sm font-semibold text-text-primary font-mono truncate min-w-0 max-w-full" title={item.reference}>
          {item.reference}
        </p>
      ),
    },
    {
      key: "partner_name",
      label: "Partner",
      render: (item) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={item.partner_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{item.partner_name}</p>
              {item.bill_origin === "internal" && <Badge variant="info" size="sm" className="shrink-0 text-[10px]">Internal</Badge>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "week_label",
      label: "Period",
      width: "160px",
      render: (item) => {
        const wk = item.week_label ? `WK${item.week_label.replace(/^\d{4}-W/, "")}` : null;
        const start = item.week_start ? formatDate(item.week_start) : null;
        const end = item.week_end ? formatDate(item.week_end) : null;
        if (!wk && !start) return <span className="text-sm text-text-tertiary">—</span>;
        return (
          <div>
            {wk ? <p className="text-[11px] font-semibold text-text-primary">{wk}</p> : null}
            {start && end ? <p className="text-[11px] text-text-tertiary whitespace-nowrap">{start} → {end}</p> : null}
          </div>
        );
      },
    },
    {
      key: "payment_due",
      label: "Due date",
      width: "108px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) return <span className="text-sm text-text-tertiary whitespace-nowrap">—</span>;
        const due = selfBillDueYmd(item);
        if (!due) return <span className="text-sm text-text-tertiary whitespace-nowrap">—</span>;
        const isOverdue = isSelfBillOverdue(item, todayYmd);
        return (
          <span className={cn("text-sm whitespace-nowrap", isOverdue ? "font-semibold text-red-600" : "text-text-secondary")}>
            {formatDate(due)}
          </span>
        );
      },
    },
    {
      key: "jobs_count",
      label: "Jobs",
      align: "center",
      width: "72px",
      render: (item) => {
        const linked = jobsBySelfBillId[item.id]?.length ?? 0;
        const n = linked > 0 ? linked : item.jobs_count;
        return (
          <button type="button" className="text-sm font-semibold text-primary hover:underline tabular-nums" onClick={(e) => { e.stopPropagation(); void openDrawer(item); }}>
            {n}
          </button>
        );
      },
    },
    {
      key: "net_payout",
      label: "To pay",
      align: "right",
      minWidth: "108px",
      render: (item) => (
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(item.net_payout)}</span>
          {isSelfBillPayoutVoided(item) && item.original_net_payout != null && Number(item.original_net_payout) > 0.02
            ? <span className="block text-[10px] text-text-tertiary tabular-nums">Orig. {formatCurrency(Number(item.original_net_payout))}</span>
            : null}
        </div>
      ),
    },
    {
      key: "amount_due",
      label: "Due",
      align: "right",
      minWidth: "112px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) return <span className="text-sm text-text-tertiary">—</span>;
        const due = computeSelfBillAmountDue(item, jobsBySelfBillId[item.id], partnerPaidByJobId);
        return (
          <span className={`text-sm font-semibold tabular-nums ${due > 0.02 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {formatCurrency(due)}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      minWidth: "140px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) {
          return (
            <div className="space-y-1 min-w-0">
              <Badge variant="default" size="sm" className="text-[10px]">{SELF_BILL_FINANCE_VOID_LABEL}</Badge>
              <p className="text-[11px] font-medium text-text-primary truncate">{selfBillPartnerStatusLine(item)}</p>
            </div>
          );
        }
        const disp = getSelfBillDisplayStatus(item, todayYmd);
        return <Badge variant={disp.variant} dot size="sm">{disp.label}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      width: "80px",
      cellClassName: "!align-middle",
      render: (item) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {!isSelfBillPayoutVoided(item) && item.status !== "paid" && item.status !== "rejected" ? (
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(item)} title="Edit totals">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <a
            href={`/api/self-bills/${encodeURIComponent(item.id)}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 text-primary hover:text-primary/70"
            title="Download PDF"
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
        </div>
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Self-billing"
          infoTooltip={`Partner field jobs and internal People (contractors). Period: All · Month · Week · Date range (default: current month). ${weekPeriodHelpText()} ${partnerFieldSelfBillPaymentDueHelpText()}`}
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative" ref={periodMenuRef}>
              <Button
                variant="outline"
                size="sm"
                icon={<CalendarRange className="h-3.5 w-3.5" />}
                onClick={() => setPeriodMenuOpen((o) => !o)}
                className={cn(periodMode !== "all" && "border-primary/40 bg-primary/5")}
              >
                {periodMode === "all" ? "Period" : PERIOD_HEADER_LABEL[periodMode]}
              </Button>
              {periodMenuOpen ? (
                <div className="absolute top-full right-0 z-50 mt-1 w-[min(calc(100vw-1.5rem),24rem)] rounded-xl border border-border bg-card p-3 shadow-lg">
                  <FinanceWeekRangeBar
                    mode={periodMode}
                    onModeChange={setPeriodMode}
                    weekAnchor={weekAnchor}
                    onWeekAnchorChange={setWeekAnchor}
                    monthAnchor={monthAnchor}
                    onMonthAnchorChange={setMonthAnchor}
                    rangeFrom={rangeFrom}
                    rangeTo={rangeTo}
                    onRangeFromChange={setRangeFrom}
                    onRangeToChange={setRangeTo}
                    hideAllDescription
                    className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none sm:!p-0 max-h-[min(70vh,520px)] overflow-y-auto overflow-x-hidden"
                  />
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => void loadData()}
              title="Reload self-bills from the server"
            >
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", recalculating && "animate-spin")} />}
              loading={recalculating}
              onClick={() => void handleFullSync()}
              title="Sync self-bills: backfill missing, update statuses and totals"
            >
              Sync
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCsv}>
              Export
            </Button>
          </div>
        </PageHeader>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5 text-left hover:border-border transition-colors" onClick={() => setActiveTab("draft")}>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Draft</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{totals.draftCount}</p>
              <p className="text-[11px] text-text-secondary">Pending approval · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <Clock className="h-4 w-4" aria-hidden />
            </div>
          </button>
          <button type="button" className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5 text-left hover:border-border transition-colors" onClick={() => setActiveTab("ready_to_pay")}>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Ready to Pay</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.readyDueSum)}</p>
              <p className="text-[11px] text-text-secondary">{totals.readyCount} self-bill{totals.readyCount !== 1 ? "s" : ""} · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
              <DollarSign className="h-4 w-4" aria-hidden />
            </div>
          </button>
          <button type="button" className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5 text-left hover:border-border transition-colors" onClick={() => setActiveTab("overdue")}>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Overdue</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-red-600">{formatCurrency(totals.overdueSum)}</p>
              <p className="text-[11px] text-text-secondary">{totals.overdueCount} past due · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-600">
              <AlertTriangle className="h-4 w-4" aria-hidden />
            </div>
          </button>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Weekly run rate</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.avgPerWeek)}</p>
              <p className="text-[11px] text-text-secondary">Avg payout per week · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
              <TrendingUp className="h-4 w-4" aria-hidden />
            </div>
          </div>
        </div>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as SelfBillTab)} />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <SearchInput
                placeholder="Search name, ref, week…"
                className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Source">
                {([{ id: "all", label: "All" }, { id: "partner", label: "Partners" }, { id: "internal", label: "Internal" }] as const).map(({ id, label }) => (
                  <button key={id} type="button" className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${originFilter === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`} onClick={() => setOriginFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Layout">
                <button type="button" className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${layoutMode === "cards" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`} onClick={() => setLayoutMode("cards")}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Cards
                </button>
                <button type="button" className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${layoutMode === "table" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`} onClick={() => setLayoutMode("table")}>
                  <List className="h-3.5 w-3.5" />
                  Table
                </button>
              </div>
            </div>
          </div>

          {/* Tab summary bar */}
          {!loading && filtered.length > 0 ? (
            <div className="flex items-center justify-end gap-x-5 rounded-[10px] border border-border-light bg-card px-4 py-2.5">
              <div className="flex-1 text-[11px] font-medium text-text-tertiary">
                {filtered.length} self-bill{filtered.length !== 1 ? "s" : ""}
              </div>
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Amount Due</p>
                <p className="text-sm font-semibold tabular-nums text-[#ED4B00]">
                  {formatCurrency(filtered.reduce((s, sb) => s + computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId), 0))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Net Payout</p>
                <p className="text-sm font-semibold tabular-nums text-[#020040] dark:text-text-primary">
                  {formatCurrency(filtered.filter((sb) => !isSelfBillPayoutVoided(sb)).reduce((s, sb) => s + Number(sb.net_payout ?? 0), 0))}
                </p>
              </div>
            </div>
          ) : null}

          {layoutMode === "cards" ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {loading ? (
                <p className="text-sm text-text-tertiary col-span-full py-10 text-center">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-text-tertiary col-span-full py-10 text-center">No self-bills in this view.</p>
              ) : (
                filtered.map((sb) => (
                  <SelfBillCard
                    key={sb.id}
                    sb={sb}
                    jobs={jobsBySelfBillId[sb.id] ?? []}
                    partnerPaidByJobId={partnerPaidByJobId}
                    todayYmd={todayYmd}
                    onOpenDrawer={() => void openDrawer(sb)}
                    onMarkReadyToPay={() => void handleMarkReadyToPay(sb)}
                    onMarkPaid={() => void handleMarkPaid(sb)}
                    onEdit={() => openEdit(sb)}
                  />
                ))
              )}
            </div>
          ) : activeTab === "ready_to_pay" ? (
            <WeekGroupedTable
              columns={columns}
              filtered={filtered}
              loading={loading}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={(item) => void openDrawer(item)}
              handleBulkStatusChange={handleBulkStatusChange}
            />
          ) : (
            <DataTable
              columns={columns}
              data={filtered}
              getRowId={(item) => item.id}
              loading={loading}
              page={1}
              totalPages={1}
              totalItems={filtered.length}
              emptyMessage="No self-bills in this view."
              onRowClick={(item) => void openDrawer(item)}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              tableClassName="min-w-[1220px]"
              bulkActions={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  <BulkBtn label="Ready to pay" onClick={() => void handleBulkStatusChange("ready_to_pay")} variant="info" />
                  <BulkBtn label="Mark paid" onClick={() => void handleBulkStatusChange("paid")} variant="success" />
                </div>
              }
            />
          )}
        </motion.div>
      </div>

      <SelfBillDetailDrawer
        sb={drawerSelfBill}
        jobs={drawerJobs}
        loadingJobs={loadingJobs}
        partnerPaidByJobId={partnerPaidByJobId}
        todayYmd={todayYmd}
        onClose={() => setDrawerSelfBill(null)}
        onMarkReadyToPay={() => drawerSelfBill && void handleMarkReadyToPay(drawerSelfBill)}
        onMarkPaid={() => drawerSelfBill && void handleMarkPaid(drawerSelfBill)}
        onMarkAuditRequired={() => drawerSelfBill && void handleMarkAuditRequired(drawerSelfBill)}
        onReject={() => drawerSelfBill && void handleRejectSelfBill(drawerSelfBill)}
        onReopen={() => drawerSelfBill && void handleReopenSelfBill(drawerSelfBill)}
        onEditTotals={() => drawerSelfBill && openEdit(drawerSelfBill)}
      />

      <Modal open={!!editSelfBill} onClose={() => setEditSelfBill(null)} title="Edit self-bill totals" subtitle="Adjust labour, materials, or commission if figures need correction." size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Labour (job value)</label>
              <Input type="number" step="0.01" value={editForm.job_value} onChange={(e) => setEditForm((f) => ({ ...f, job_value: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Materials</label>
              <Input type="number" step="0.01" value={editForm.materials} onChange={(e) => setEditForm((f) => ({ ...f, materials: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Commission</label>
              <Input type="number" step="0.01" value={editForm.commission} onChange={(e) => setEditForm((f) => ({ ...f, commission: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-text-tertiary">
            Net payout = labour + materials − commission:{" "}
            <strong className="text-text-primary tabular-nums">
              {formatCurrency((Number(editForm.job_value) || 0) + (Number(editForm.materials) || 0) - (Number(editForm.commission) || 0))}
            </strong>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setEditSelfBill(null)}>Cancel</Button>
            <Button type="button" loading={savingEdit} onClick={() => void saveEdit()}>Save</Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}

// ── Self-bill detail drawer ────────────────────────────────────────────────────

function SelfBillDetailDrawer({
  sb,
  jobs,
  loadingJobs,
  partnerPaidByJobId,
  todayYmd,
  onClose,
  onMarkReadyToPay,
  onMarkPaid,
  onMarkAuditRequired,
  onReject,
  onReopen,
  onEditTotals,
}: {
  sb: SelfBill | null;
  jobs: Awaited<ReturnType<typeof listJobsForSelfBill>>;
  loadingJobs: boolean;
  partnerPaidByJobId: Record<string, number>;
  todayYmd: string;
  onClose: () => void;
  onMarkReadyToPay: () => void;
  onMarkPaid: () => void;
  onMarkAuditRequired: () => void;
  onReject: () => void;
  onReopen: () => void;
  onEditTotals: () => void;
}) {
  const [tab, setTab] = useState<"details" | "jobs" | "invoices" | "payment" | "activity">("details");
  const [dueDateModalOpen, setDueDateModalOpen] = useState(false);
  const [dueDateValue, setDueDateValue] = useState("");
  const [dueDateReason, setDueDateReason] = useState("");
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [linkedInvoices, setLinkedInvoices] = useState<Array<{ id: string; reference: string; amount: number; status: string; due_date?: string | null; job_reference?: string | null }>>([]);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [jobsExpanded, setJobsExpanded] = useState(false);

  // Reset when a new self-bill is opened
  const prevSbId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sb && sb.id !== prevSbId.current) {
      setTab("details");
      setLinkedInvoices([]);
      setCancelModalOpen(false);
      setDueDateModalOpen(false);
      setJobsExpanded(false);
      prevSbId.current = sb.id;
    }
  }, [sb]);

  // Fetch linked invoices whenever jobs change
  useEffect(() => {
    if (!sb) return;
    const refs = jobs.map((j) => (j as unknown as { reference?: string }).reference).filter(Boolean) as string[];
    if (refs.length === 0) { setLinkedInvoices([]); return; }
    const supabase = getSupabase();
    void supabase
      .from("invoices")
      .select("id, reference, amount, status, due_date, job_reference")
      .in("job_reference", refs)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setLinkedInvoices((data ?? []) as typeof linkedInvoices);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb?.id, jobs.length]);

  const handleSaveDueDate = async () => {
    if (!sb) return;
    const trimmed = dueDateValue.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) { toast.error("Invalid date format."); return; }
    if (dueDateReason.trim().length < 10) { toast.error("Reason must be at least 10 characters."); return; }
    setSavingDueDate(true);
    try {
      const res = await fetch(`/api/self-bills/${sb.id}/due-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: trimmed, reason: dueDateReason.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to update");
      }
      toast.success("Due date updated.");
      setDueDateModalOpen(false);
      // Patch the parent sb via refreshDrawer pattern — we call onReopen as a cheap refresh trigger
      // A proper fix would be a dedicated onSbUpdated callback; for now reload page data
      onReopen(); // triggers loadData in parent which refreshes drawerSelfBill
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update due date");
    } finally {
      setSavingDueDate(false);
    }
  };

  const handleCancelSelfBill = async () => {
    if (!sb) return;
    setCancelSaving(true);
    try {
      const supabase = getSupabase();
      await supabase.from("self_bills").update({ status: "payout_cancelled" }).eq("id", sb.id);
      toast.success("Self-bill cancelled.");
      setCancelModalOpen(false);
      onReopen(); // refresh
    } catch {
      toast.error("Failed to cancel self-bill.");
    } finally {
      setCancelSaving(false);
    }
  };

  if (!sb) return <Drawer open={false} onClose={onClose}>{null}</Drawer>;

  const voided = isSelfBillPayoutVoided(sb);
  const origSnap = sb.original_net_payout != null && Number(sb.original_net_payout) > 0.02 ? Number(sb.original_net_payout) : null;
  const dueYmd = !voided ? selfBillDueYmd(sb) : "";
  const overdue = !voided && isSelfBillOverdue(sb, todayYmd);
  const disp = getSelfBillDisplayStatus(sb, todayYmd);
  const totalPaidToDate = jobs.reduce((sum, j) => sum + Number(partnerPaidByJobId[j.id] ?? 0), 0);
  const sheetDue = voided ? 0 : (() => {
    if (sb.bill_origin === "internal") return Math.max(0, Number(sb.net_payout ?? 0));
    let due = 0;
    for (const j of jobs) {
      if (!jobContributesToSelfBillPayout(j)) continue;
      const cap = jobLinePartnerGross(j);
      const paid = partnerPaidByJobId[j.id] ?? 0;
      due += Math.max(0, cap - paid);
    }
    return Math.round(due * 100) / 100;
  })();
  const grossTotal = Math.round((Number(sb.job_value ?? 0) + Number(sb.materials ?? 0)) * 100) / 100;

  const drawerTabs: Array<{ id: "details" | "jobs" | "invoices" | "payment" | "activity"; label: string; count?: number }> = [
    { id: "details", label: "Details" },
    { id: "jobs", label: "Jobs", count: jobs.length },
    { id: "invoices", label: "Invoices", count: linkedInvoices.length || undefined },
    { id: "payment", label: "Payment" },
    { id: "activity", label: "Activity" },
  ];

  const isDraft = DRAFT_DB_STATUSES.has(sb.status);
  const isReady = READY_DB_STATUSES.has(sb.status);
  const isPaid = sb.status === "paid";
  const isRejected = sb.status === "rejected" || voided;
  const isAudit = sb.status === "audit_required";
  const canTransition = !isPaid && !isRejected && !voided;

  // Status tone — same pattern as InvoiceDetailDrawer
  const statusTone = isPaid
    ? { bg: "#EFF7F3", border: "#9FE1CB", text: "#0F6E56", dot: "#0F6E56" }
    : overdue
      ? { bg: "#FEF5F3", border: "#F5BFBF", text: "#A32D2D", dot: "#A32D2D" }
      : isAudit
        ? { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E", dot: "#D97706" }
        : isRejected
          ? { bg: "#F5F5F7", border: "#D8D8DD", text: "#6B6B70", dot: "#6B6B70" }
          : isDraft
            ? { bg: "#FFF8F3", border: "#F5CFB8", text: "#ED4B00", dot: "#ED4B00" }
            : { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8", dot: "#2563EB" };

  const statusSub = dueYmd
    ? overdue
      ? `Due ${formatDate(dueYmd)} · Payment overdue`
      : isPaid
        ? `Paid`
        : `Due ${formatDate(dueYmd)}`
    : `Created ${formatDate(sb.created_at)}`;

  const footer = tab === "details" ? (
    <div className="px-4 pb-3 pt-2 space-y-2">
      <div className="flex gap-2">
        {isPaid ? (
          <Button variant="outline" size="sm" className="flex-1" onClick={onReopen}>
            <span className="inline-flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5 shrink-0" /> Reopen self-bill
            </span>
          </Button>
        ) : isRejected ? null : isDraft || isAudit ? (
          <Button variant="success" size="sm" className="flex-1" onClick={onMarkReadyToPay}>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 shrink-0" /> Mark Ready to Pay
            </span>
          </Button>
        ) : isReady ? (
          <>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => toast.info("Record payout flow — coming soon.")}>
              + Record payout
            </Button>
            {overdue && (
              <Button variant="danger" size="sm" onClick={() => toast.error("Escalate flow — coming soon.")}>
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Escalate
                </span>
              </Button>
            )}
            <Button variant="success" size="sm" className="flex-1" onClick={onMarkPaid}>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0" /> Mark as paid
              </span>
            </Button>
          </>
        ) : null}
      </div>
      {canTransition && (
        <div className="flex items-center gap-2">
          {!isAudit ? (
            <button
              type="button"
              onClick={onMarkAuditRequired}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-amber-200 bg-amber-50 py-1.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Flag for audit
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReject}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-red-200 bg-red-50 py-1.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
          >
            <XCircle className="h-3.5 w-3.5 shrink-0" /> Reject
          </button>
          <button
            type="button"
            onClick={() => { setCancelReason(""); setCancelModalOpen(true); }}
            className="inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
            title="Cancel self-bill (does not affect job or invoice)"
          >
            <Ban className="h-3.5 w-3.5 shrink-0" />
          </button>
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <Drawer
      open
      onClose={onClose}
      title={sb.reference ?? sb.partner_name}
      width="w-[540px]"
      headerExtra={(
        <div className="text-[11px] text-text-secondary leading-snug">
          {sb.week_label || sb.week_start ? (
            <span className="font-medium">
              {sb.week_label ? `WK${sb.week_label.replace(/^\d{4}-W/, "")}` : ""}
              {sb.week_start ? ` · ${formatDate(sb.week_start)}` : ""}
              {sb.week_end ? ` → ${formatDate(sb.week_end)}` : ""}
            </span>
          ) : null}
          {dueYmd ? (
            <span className={cn("ml-2", overdue ? "font-semibold text-red-600" : "text-text-tertiary")}>
              · Due {formatDate(dueYmd)}
            </span>
          ) : null}
        </div>
      )}
      footer={footer}
    >
      <div className="min-h-full bg-surface-hover/50">
        {/* Partner card */}
        <div className="px-[22px] pb-4 pt-4">
          <div
            className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface-hover/50 px-4 py-[14px]"
            style={{ boxShadow: "0 1px 3px rgba(10,13,46,0.04)" }}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Avatar name={sb.partner_name} size="md" className="shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-text-primary">{sb.partner_name}</p>
                <p className="text-[11px] text-text-secondary">
                  {sb.bill_origin === "internal" ? "Internal partner" : "Field partner"}
                </p>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  {sb.bill_origin === "internal" ? "Internal · Payroll" : "Partner payout"}{sb.week_label ? ` · ${sb.week_label}` : ""}
                </p>
              </div>
            </div>
            <a href={`/partners?search=${encodeURIComponent(sb.partner_name ?? "")}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] font-semibold text-primary">View ↗</a>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border px-[22px]">
          <div className="w-full min-w-0 overflow-x-auto [scrollbar-width:thin]">
          <div className="inline-flex flex-nowrap items-stretch gap-0">
            {drawerTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "relative shrink-0 whitespace-nowrap px-4 py-2.5 text-left text-sm transition-colors",
                  tab === item.id ? "font-semibold text-[#ED4B00]" : "font-medium text-text-secondary",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {item.label}
                  {item.count !== undefined ? (
                    <span className="rounded-md bg-[#F0F2F7] px-1.5 py-0.5 text-[10px] font-semibold text-text-tertiary">
                      {item.count}
                    </span>
                  ) : null}
                </span>
                {tab === item.id ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ED4B00]" /> : null}
              </button>
            ))}
          </div>
          </div>
        </div>

        {/* ── Details tab ── */}
        {tab === "details" ? (
          <div className="space-y-4 p-[22px]">
            {/* Status row — same pattern as InvoiceDetailDrawer */}
            <div
              className="rounded-[6px]"
              style={{ backgroundColor: statusTone.bg, border: `0.5px solid ${statusTone.border}`, padding: "10px 12px" }}
            >
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: statusTone.dot }} />
                  <span className="shrink-0 text-[12px] font-semibold" style={{ color: statusTone.text }}>{disp.label}</span>
                  <span className="h-[10px] w-px shrink-0" style={{ backgroundColor: statusTone.border }} />
                  <div className="flex min-w-0 items-center gap-1 group/due">
                    <p className="min-w-0 truncate text-[11px] font-medium text-[#1C1917]">{statusSub}</p>
                    <button
                      type="button"
                      onClick={() => { setDueDateValue(dueYmd || new Date().toISOString().slice(0, 10)); setDueDateReason(""); setDueDateModalOpen(true); }}
                      className="shrink-0 rounded border border-border bg-white px-1 py-0.5 text-[9px] font-medium text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
                      title="Edit due date"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular-nums text-[13px] font-semibold text-[#1C1917]">{formatCurrency(sheetDue)}</p>
                  <p className="text-[10px] text-text-tertiary">No VAT · Partner payout</p>
                </div>
              </div>
            </div>

            {/* Labour / Materials / Net Payout breakdown */}
            <div>
              <div className="rounded-t-[10px] border border-border border-b-0 bg-card">
                <div className="grid grid-cols-3 divide-x divide-border">
                  <div className="px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Labour</p>
                    <p className="mt-1 text-[22px] font-semibold text-text-primary">{formatCurrency(sb.job_value)}</p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Materials</p>
                    <p className="mt-1 text-[22px] font-semibold text-text-primary">{formatCurrency(sb.materials)}</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Net Payout</p>
                    <p className="mt-1 text-[22px] font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(sb.net_payout)}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-b-[10px] border border-border bg-surface-hover/50 px-3 py-[7px] text-[11px]">
                <span className="text-text-secondary">
                  {sb.week_label ? `Week ${sb.week_label}` : ""}
                  {dueYmd ? ` · Due ${formatDate(dueYmd)}` : ""}
                </span>
                <button type="button" className="font-semibold text-primary">View Pay Run ↗</button>
              </div>
            </div>

            {/* Jobs preview — accordion, shows 3 then expand */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary">Jobs ({jobs.length})</p>
                <button type="button" className="text-[12px] font-semibold text-primary">+ Link job</button>
              </div>
              <div className="rounded-[10px] border border-border bg-surface-hover/50 overflow-hidden">
                {loadingJobs ? (
                  <div className="space-y-1.5 p-3">
                    <div className="h-10 rounded-lg bg-surface-hover animate-pulse" />
                    <div className="h-10 rounded-lg bg-surface-hover animate-pulse" />
                    <div className="h-10 rounded-lg bg-surface-hover animate-pulse" />
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-[13px] text-text-secondary">No jobs linked yet</p>
                    <p className="mt-1 text-[11px] text-text-tertiary">Jobs completed this week will appear automatically.</p>
                  </div>
                ) : (() => {
                  const invByRef = new Map(linkedInvoices.map((inv) => [inv.job_reference, inv]));
                  const visible = jobsExpanded ? jobs : jobs.slice(0, 3);
                  const hidden = jobs.length - 3;
                  return (
                    <>
                      <div className="divide-y divide-border-light">
                        {visible.map((j) => (
                          <div key={j.id} className="px-3 py-2">
                            <CompactJobCard j={j} partnerPaid={partnerPaidByJobId[j.id] ?? 0} matchedInvoice={invByRef.get(j.reference) ?? null} />
                          </div>
                        ))}
                      </div>
                      {hidden > 0 ? (
                        <button
                          type="button"
                          className="w-full border-t border-border-light py-2 text-center text-[11px] font-semibold text-primary hover:bg-surface-hover/60 transition-colors"
                          onClick={() => jobsExpanded ? setTab("jobs") : setJobsExpanded(true)}
                        >
                          {jobsExpanded ? `See all ${jobs.length} in Jobs tab →` : `+ ${hidden} more job${hidden !== 1 ? "s" : ""}`}
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>


            {/* Self-bill breakdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary">Self-bill Breakdown</p>
                {canTransition ? (
                  <button type="button" className="text-[11px] text-text-tertiary hover:text-primary" onClick={onEditTotals}>
                    <Pencil className="inline h-3 w-3 mr-1" />Edit
                  </button>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-[10px] border border-border bg-surface-hover/50">
                <div className="flex items-center justify-between border-b border-border px-3 py-3">
                  <p className="text-[13px] font-semibold text-text-primary">• Labour</p>
                  <p className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(sb.job_value)}</p>
                </div>
                <div className="flex items-center justify-between border-b border-border px-3 py-3">
                  <p className="text-[13px] font-semibold text-text-primary">• Materials</p>
                  <p className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(sb.materials)}</p>
                </div>
                {Number(sb.commission) > 0 ? (
                  <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                    <p className="text-[12px] text-text-secondary">• Commission deduction</p>
                    <p className="text-[12px] text-red-600 tabular-nums">−{formatCurrency(sb.commission)}</p>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2.5">
                  <p className="text-[12px] text-text-secondary">Gross total</p>
                  <p className="text-[12px] text-text-primary tabular-nums">{formatCurrency(grossTotal)}</p>
                </div>
                <div className="flex items-center justify-between bg-[#020040] px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-white">Net payout to partner</p>
                  <p className="text-[15px] font-semibold text-white tabular-nums">{formatCurrency(sb.net_payout)}</p>
                </div>
              </div>
            </div>

            {/* Payment status */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary">Payment Status</p>
              <div className="rounded-[10px] border border-border bg-surface-hover/50 px-3 py-2">
                <div className="space-y-1 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">Net payout</span>
                    <span className="tabular-nums text-text-primary">{formatCurrency(sb.net_payout)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">Paid to date</span>
                    <span className="tabular-nums text-text-primary">{formatCurrency(totalPaidToDate)}</span>
                  </div>
                  {origSnap != null ? (
                    <div className="flex items-center justify-between">
                      <span className="text-text-secondary">Original amount</span>
                      <span className="tabular-nums text-text-secondary">{formatCurrency(origSnap)}</span>
                    </div>
                  ) : null}
                  <div className="my-1 border-t border-border" />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary">Due to partner</span>
                    <span className={cn("font-semibold tabular-nums", sheetDue > 0.02 ? "text-[#ED4B00]" : "text-emerald-700 dark:text-emerald-400")}>
                      {formatCurrency(sheetDue)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Void info */}
            {voided ? (
              <div className="rounded-[10px] border border-amber-200 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-950/20 px-3 py-3 text-[12px] space-y-1">
                <p className="font-semibold text-amber-800 dark:text-amber-300">{SELF_BILL_FINANCE_VOID_LABEL}</p>
                <p className="text-text-secondary">{selfBillPartnerStatusLine(sb)}</p>
                {sb.payout_void_reason ? <p className="text-text-tertiary">{sb.payout_void_reason}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Jobs tab ── */}
        {tab === "jobs" ? (
          <div className="space-y-3 p-[22px]">
            {/* P&L inline in Jobs tab */}
            {(() => {
              const revenue = linkedInvoices.reduce((s, inv) => s + Number(inv.amount ?? 0), 0);
              const cost = Number(sb.net_payout ?? 0);
              const profit = revenue - cost;
              const margin = revenue > 0.01 ? Math.round((profit / revenue) * 100) : null;
              if (revenue < 0.01) return null;
              return (
                <div>
                  <div className="rounded-t-[10px] border border-border border-b-0 bg-card">
                    <div className="grid grid-cols-3 divide-x divide-border">
                      <div className="px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-text-tertiary">Revenue</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-text-primary">{formatCurrency(revenue)}</p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-text-tertiary">Cost</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-text-primary">{formatCurrency(cost)}</p>
                      </div>
                      <div className={cn("px-3 py-2", profit > 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/20")}>
                        <p className="text-[10px] font-semibold uppercase text-text-tertiary">Profit</p>
                        <p className={cn("mt-0.5 text-[13px] font-semibold", profit > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{formatCurrency(profit)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-b-[10px] border border-border bg-surface-hover/50 px-3 py-[6px] text-[11px]">
                    <span className="text-text-tertiary">{linkedInvoices.length} invoice{linkedInvoices.length !== 1 ? "s" : ""} · invoiced revenue</span>
                    {margin !== null ? (
                      <span className={cn("font-semibold tabular-nums", margin >= 20 ? "text-emerald-700" : margin >= 0 ? "text-amber-700" : "text-red-600")}>
                        {margin}% margin
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })()}
            {loadingJobs ? (
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
                <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="rounded-[10px] border border-border bg-surface-hover/50 px-4 py-6 text-center">
                <p className="text-sm text-text-tertiary">No jobs linked to this self-bill.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((j) => <JobRow key={j.id} j={j} partnerPaid={partnerPaidByJobId[j.id] ?? 0} />)}
              </div>
            )}
          </div>
        ) : null}

        {/* ── Invoices tab ── */}
        {tab === "invoices" ? (
          <div className="space-y-3 p-[22px]">
            {linkedInvoices.length === 0 ? (
              <div className="rounded-[10px] border border-border bg-surface-hover/50 px-4 py-6 text-center">
                <Receipt className="mx-auto h-5 w-5 text-text-tertiary mb-2" />
                <p className="text-sm text-text-tertiary">No invoices linked to this self-bill yet.</p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {linkedInvoices.map((inv) => {
                    const isPaidInv = inv.status === "paid";
                    return (
                      <div key={inv.id} className="flex items-center justify-between rounded-[10px] border border-border bg-card px-3 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", isPaidInv ? "bg-emerald-500" : inv.status === "overdue" ? "bg-red-500" : "bg-amber-400")} />
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-text-primary truncate">{inv.reference}</p>
                            {inv.job_reference ? <p className="text-[11px] text-text-tertiary">{inv.job_reference}</p> : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[13px] font-semibold tabular-nums text-text-primary">{formatCurrency(inv.amount)}</p>
                          <p className="text-[11px] text-text-tertiary capitalize">{isPaidInv ? "Paid" : inv.status.replace("_", " ")}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between rounded-[8px] bg-surface-hover/50 px-3 py-2 text-[11px]">
                  <span className="text-text-secondary">{linkedInvoices.length} invoice{linkedInvoices.length !== 1 ? "s" : ""} total</span>
                  <span className="font-semibold tabular-nums text-text-primary">
                    {formatCurrency(linkedInvoices.reduce((s, inv) => s + Number(inv.amount ?? 0), 0))}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* ── Payment tab ── */}
        {tab === "payment" ? (
          <div className="space-y-4 p-[22px]">
            <div className="rounded-[10px] border border-border bg-surface-hover/50 p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Payment Summary</p>
              <div className="space-y-2 text-[13px]">
                {[
                  { label: "Net payout", value: formatCurrency(sb.net_payout) },
                  { label: "Paid to date", value: formatCurrency(totalPaidToDate) },
                  { label: "Outstanding", value: formatCurrency(sheetDue), highlight: sheetDue > 0.02 },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-text-secondary">{label}</span>
                    <span className={cn("font-semibold tabular-nums", highlight ? "text-[#ED4B00]" : "text-text-primary")}>{value}</span>
                  </div>
                ))}
              </div>
              {dueYmd ? (
                <p className="text-[11px] text-text-secondary">
                  Payment due: <span className={cn("font-semibold", overdue ? "text-red-600" : "text-text-primary")}>{formatDate(dueYmd)}</span>
                  {overdue ? " · Overdue" : ""}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ── Activity tab ── */}
        {tab === "activity" ? (
          <div className="rounded-[10px] border border-border bg-surface-hover/50 m-[22px] p-4 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Activity</p>
            {[
              `Created ${formatDate(sb.created_at)}`,
              dueYmd ? `Due date: ${formatDate(dueYmd)}` : "Due date pending",
              `Current status: ${disp.label}`,
              voided && origSnap != null ? `Original amount: ${formatCurrency(origSnap)}` : null,
              voided ? `Void reason: ${selfBillPartnerStatusLine(sb)}` : null,
              sb.payout_void_reason ? `Note: ${sb.payout_void_reason}` : null,
            ].filter(Boolean).map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" />
                <p className="text-[13px] text-text-primary">{item}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Edit due date modal ── */}
      <Modal
        open={dueDateModalOpen}
        onClose={() => setDueDateModalOpen(false)}
        title="Edit due date"
        subtitle="Any status. Audit trail is recorded."
        size="sm"
      >
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">New due date</label>
            <Input type="date" value={dueDateValue} onChange={(e) => setDueDateValue(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Reason <span className="text-text-tertiary">(min 10 chars)</span></label>
            <Input
              placeholder="e.g. Partner requested extension"
              value={dueDateReason}
              onChange={(e) => setDueDateReason(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setDueDateModalOpen(false)}>Cancel</Button>
            <Button size="sm" loading={savingDueDate} onClick={() => void handleSaveDueDate()}>Save due date</Button>
          </div>
        </div>
      </Modal>

      {/* ── Cancel self-bill modal ── */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancel self-bill"
        subtitle="The linked job and invoice will not be affected."
        size="sm"
      >
        <div className="p-5 space-y-4">
          <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
            This will mark the self-bill as <strong>cancelled</strong>. It can be reopened later.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCancelModalOpen(false)}>Keep it</Button>
            <Button variant="danger" size="sm" loading={cancelSaving} onClick={() => void handleCancelSelfBill()}>
              <span className="inline-flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Cancel self-bill</span>
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}

// ── Card view ──────────────────────────────────────────────────────────────────

function SelfBillCard({
  sb,
  jobs,
  partnerPaidByJobId,
  todayYmd,
  onOpenDrawer,
  onMarkReadyToPay,
  onMarkPaid,
  onEdit,
}: {
  sb: SelfBill;
  jobs: JobLine[];
  partnerPaidByJobId: Record<string, number>;
  todayYmd: string;
  onOpenDrawer: () => void;
  onMarkReadyToPay: () => void;
  onMarkPaid: () => void;
  onEdit: () => void;
}) {
  const voided = isSelfBillPayoutVoided(sb);
  const disp = getSelfBillDisplayStatus(sb, todayYmd);
  const dueYmd = selfBillDueYmd(sb);
  const amountDue = voided ? 0 : computeSelfBillAmountDue(sb, jobs, partnerPaidByJobId);

  return (
    <div
      className="rounded-2xl border border-border-light bg-card shadow-sm overflow-hidden flex flex-col cursor-pointer hover:border-border transition-colors"
      onClick={onOpenDrawer}
    >
      <div className="p-4 border-b border-border-light bg-surface-hover/40 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={sb.partner_name} size="md" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-text-primary truncate">{sb.partner_name}</p>
              {sb.bill_origin === "internal" && <Badge variant="info" size="sm" className="text-[10px]">Internal</Badge>}
            </div>
            <p className="text-[11px] text-text-tertiary font-mono truncate">{sb.reference} · {sb.week_label ?? sb.period}</p>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Created {formatDate(sb.created_at)}{dueYmd ? ` · Due ${formatDate(dueYmd)}` : ""}
            </p>
          </div>
        </div>
        <Badge variant={disp.variant} dot size="sm">{disp.label}</Badge>
      </div>

      <div className="px-4 py-3 grid grid-cols-4 gap-3 text-center border-b border-border-light/80 bg-background/50">
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Labour</p>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(sb.job_value)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Materials</p>
          <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(sb.materials)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Net Payout</p>
          <p className="text-sm font-bold tabular-nums text-text-primary">{formatCurrency(sb.net_payout)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Amount Due</p>
          <p className={cn("text-sm font-bold tabular-nums", amountDue > 0.02 ? "text-amber-600" : "text-emerald-600")}>
            {formatCurrency(amountDue)}
          </p>
        </div>
      </div>

      <div className="p-3 border-t border-border-light flex flex-wrap items-center gap-2 justify-between bg-surface-hover/30 mt-auto">
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {DRAFT_DB_STATUSES.has(sb.status) ? (
            <Button size="sm" variant="primary" className="h-8 text-xs" onClick={onMarkReadyToPay}>
              Mark Ready to Pay
            </Button>
          ) : READY_DB_STATUSES.has(sb.status) ? (
            <Button size="sm" variant="primary" className="h-8 text-xs" onClick={onMarkPaid}>
              Mark as Paid
            </Button>
          ) : null}
          {!isSelfBillPayoutVoided(sb) && sb.status !== "paid" && sb.status !== "rejected" ? (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onEdit}>
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          ) : null}
        </div>
        <a
          href={`/api/self-bills/${encodeURIComponent(sb.id)}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
        </a>
      </div>
    </div>
  );
}

// ── Compact job card (preview grid) ──────────────────────────────────────────

function CompactJobCard({
  j,
  partnerPaid,
  matchedInvoice,
}: {
  j: Pick<Job, "id" | "reference" | "title" | "partner_cost" | "partner_agreed_value" | "materials_cost" | "status" | "property_address" | "deleted_at" | "partner_cancelled_at">;
  partnerPaid: number;
  matchedInvoice?: { reference: string; status: string; amount: number } | null;
}) {
  const cap = jobContributesToSelfBillPayout(j) ? jobLinePartnerGross(j) : 0;
  const due = jobContributesToSelfBillPayout(j) ? Math.max(0, Math.round((cap - partnerPaid) * 100) / 100) : 0;
  const invPaid = matchedInvoice?.status === "paid";
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-border-light bg-surface-hover/80 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Link href={`/jobs/${j.id}`} className="text-[12px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5">
            {j.reference}
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          </Link>
          {matchedInvoice ? (
            <span className={cn("text-[10px] font-medium truncate", invPaid ? "text-emerald-600" : "text-text-tertiary")}>
              · {matchedInvoice.reference}
            </span>
          ) : null}
        </div>
        <p className="text-[10px] text-text-tertiary truncate">{j.title}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[12px] font-semibold tabular-nums text-text-primary">{formatCurrency(Number(j.partner_cost) || 0)}</p>
        {due > 0.02 ? (
          <span className="text-[10px] font-semibold text-amber-600 tabular-nums">due {formatCurrency(due)}</span>
        ) : (
          <Badge variant="default" size="sm" className="text-[9px] px-1 py-0">{j.status}</Badge>
        )}
      </div>
    </div>
  );
}

// ── Job row ────────────────────────────────────────────────────────────────────

function JobRow({
  j,
  partnerPaid,
}: {
  j: Pick<
    Job,
    | "id"
    | "reference"
    | "title"
    | "partner_cost"
    | "partner_agreed_value"
    | "materials_cost"
    | "status"
    | "property_address"
    | "deleted_at"
    | "partner_cancelled_at"
  >;
  partnerPaid: number;
}) {
  const payoutNote = selfBillJobPayoutStateLabel(j);
  const cap = jobContributesToSelfBillPayout(j) ? jobLinePartnerGross(j) : 0;
  const due = jobContributesToSelfBillPayout(j) ? Math.max(0, Math.round((cap - partnerPaid) * 100) / 100) : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-border-light bg-surface-hover/80">
      <div className="min-w-0">
        <Link href={`/jobs/${j.id}`} className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
          {j.reference}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </Link>
        <p className="text-xs text-text-secondary truncate">{j.title}</p>
        <p className="text-[11px] text-text-tertiary truncate">{j.property_address}</p>
        {payoutNote ? <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{payoutNote}</p> : null}
      </div>
      <div className="text-right text-xs space-y-0.5">
        <p>Labour <span className="font-semibold tabular-nums">{formatCurrency(Number(j.partner_cost) || 0)}</span></p>
        <p>Mat. <span className="font-semibold tabular-nums">{formatCurrency(Number(j.materials_cost) || 0)}</span></p>
        {jobContributesToSelfBillPayout(j) ? (
          <>
            <p className="text-text-tertiary">Paid <span className="font-semibold tabular-nums text-text-secondary">{formatCurrency(partnerPaid)}</span></p>
            <p className={due > 0.02 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
              Due <span className="tabular-nums">{formatCurrency(due)}</span>
            </p>
          </>
        ) : null}
        <Badge variant="default" size="sm">{j.status}</Badge>
      </div>
    </div>
  );
}

// ── Week-grouped table (Ready to Pay) ─────────────────────────────────────────

function WeekGroupedTable({
  columns,
  filtered,
  loading,
  selectedIds,
  onSelectionChange,
  onRowClick,
  handleBulkStatusChange,
}: {
  columns: Column<SelfBill>[];
  filtered: SelfBill[];
  loading: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onRowClick: (item: SelfBill) => void;
  handleBulkStatusChange: (status: string) => Promise<void>;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, SelfBill[]>();
    for (const sb of filtered) {
      const key = sb.week_label ?? sb.period ?? "Unknown";
      const list = map.get(key) ?? [];
      list.push(sb);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  if (loading) {
    return (
      <DataTable columns={columns} data={[]} getRowId={(i) => i.id} loading page={1} totalPages={1} totalItems={0} tableClassName="min-w-[900px]" />
    );
  }

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-text-tertiary">No self-bills in this view.</div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(([weekLabel, rows]) => {
        const weekTotal = rows.reduce((s, sb) => s + Number(sb.net_payout ?? 0), 0);
        const groupIds = new Set(rows.map((r) => r.id));
        const groupSelected = new Set([...selectedIds].filter((id) => groupIds.has(id)));
        const allSelected = groupIds.size > 0 && groupSelected.size === groupIds.size;
        const someSelected = groupSelected.size > 0 && !allSelected;

        function toggleWeek() {
          const next = new Set(selectedIds);
          if (allSelected) {
            groupIds.forEach((id) => next.delete(id));
          } else {
            groupIds.forEach((id) => next.add(id));
          }
          onSelectionChange(next);
        }

        return (
          <div key={weekLabel}>
            <div className="flex items-center justify-between px-1 pb-2">
              <button
                type="button"
                className="flex items-center gap-2.5 group"
                onClick={toggleWeek}
                title={allSelected ? "Deselect week" : "Select week"}
              >
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  allSelected ? "border-primary bg-primary" : someSelected ? "border-primary bg-primary/20" : "border-border bg-white group-hover:border-primary/60",
                )}>
                  {allSelected ? (
                    <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : someSelected ? (
                    <span className="h-0.5 w-2 rounded bg-primary block" />
                  ) : null}
                </span>
                <span className="text-[12px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                  {weekLabel}
                </span>
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-semibold text-text-tertiary">{rows.length}</span>
              </button>
              <div className="flex items-center gap-3">
                {groupSelected.size > 0 && (
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                    onClick={() => void handleBulkStatusChange("paid")}
                  >
                    Mark {groupSelected.size} paid ✓
                  </button>
                )}
                <span className="text-[13px] font-semibold tabular-nums text-text-primary">{formatCurrency(weekTotal)}</span>
              </div>
            </div>
            <DataTable
              columns={columns}
              data={rows}
              getRowId={(item) => item.id}
              loading={false}
              page={1}
              totalPages={1}
              totalItems={rows.length}
              onRowClick={onRowClick}
              selectable
              selectedIds={groupSelected}
              onSelectionChange={(ids) => {
                const next = new Set(selectedIds);
                groupIds.forEach((id) => next.delete(id));
                ids.forEach((id) => next.add(id));
                onSelectionChange(next);
              }}
              tableClassName="min-w-[900px]"
              bulkActions={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{groupSelected.size} selected</span>
                  <BulkBtn label="Ready to pay" onClick={() => void handleBulkStatusChange("ready_to_pay")} variant="info" />
                  <BulkBtn label="Mark paid" onClick={() => void handleBulkStatusChange("paid")} variant="success" />
                </div>
              }
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Bulk action button ─────────────────────────────────────────────────────────

function BulkBtn({
  label,
  onClick,
  variant,
  icon,
}: {
  label: string;
  onClick: () => void;
  variant: "success" | "danger" | "warning" | "info" | "default";
  icon?: ReactNode;
}) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border-amber-200",
    info: "text-blue-700 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 border-blue-200",
    default: "text-text-primary bg-surface-hover hover:bg-surface-tertiary border-border",
  };
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {icon}
      {label}
    </button>
  );
}
