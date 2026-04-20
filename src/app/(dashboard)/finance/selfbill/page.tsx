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
  Users,
  ShieldAlert,
  CalendarRange,
  RefreshCw,
  FileText,
  CheckCircle2,
  ExternalLink,
  LayoutGrid,
  List,
  Pencil,
  XCircle,
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
  SELF_BILL_PAYOUT_VOID_STATUSES,
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

/** Partner amount still owed for this weekly self-bill (labour+mat per job − partner payouts recorded on each job). */
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

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Draft", variant: "default" },
  accumulating: { label: "Ongoing", variant: "primary" },
  pending_review: { label: "Review and Approve", variant: "warning" },
  needs_attention: { label: "Needs attention", variant: "danger" },
  awaiting_payment: { label: "Awaiting payment", variant: "warning" },
  ready_to_pay: { label: "Ready to Pay", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  audit_required: { label: "Audit required", variant: "danger" },
  rejected: { label: "Rejected", variant: "default" },
  payout_archived: { label: "Void · Archived", variant: "default" },
  payout_cancelled: { label: "Void · Cancelled", variant: "default" },
  payout_lost: { label: "Void · Lost", variant: "default" },
};

const TAB_ORDER = [
  "all",
  "draft",
  "audit_required",
  "accumulating",
  "ready_to_pay",
  "paid",
  "rejected",
  "no_payout",
] as const;

type SelfBillTab = (typeof TAB_ORDER)[number];

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

function isPartnerFieldBill(sb: SelfBill): boolean {
  return sb.bill_origin !== "internal";
}

function countByStatus(rows: SelfBill[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const sb of rows) {
    m[sb.status] = (m[sb.status] ?? 0) + 1;
  }
  return m;
}

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
  const [jobsModal, setJobsModal] = useState<{ selfBill: SelfBill; jobs: Awaited<ReturnType<typeof listJobsForSelfBill>> } | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsBySelfBillId, setJobsBySelfBillId] = useState<Record<string, JobLine[]>>({});
  const [partnerPaidByJobId, setPartnerPaidByJobId] = useState<Record<string, number>>({});
  const [editSelfBill, setEditSelfBill] = useState<SelfBill | null>(null);
  const [editForm, setEditForm] = useState({ job_value: "", materials: "", commission: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [originFilter, setOriginFilter] = useState<"all" | "partner" | "internal">("all");

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
        const range = parseDateRangeOrWeek({
          from: rangeFrom.trim() || undefined,
          to: rangeTo.trim() || undefined,
        });
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

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel("self_bills_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "self_bills" }, () => {
        loadData();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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

  const statusCounts = useMemo(() => countByStatus(selfBills), [selfBills]);

  const filtered = useMemo(() => {
    let result = selfBills;
    if (activeTab !== "all") {
      if (activeTab === "no_payout") {
        result = result.filter((sb) => isSelfBillPayoutVoided(sb));
      } else if (activeTab === "ready_to_pay") {
        // Consolidate payout view: includes items still pending review plus already ready.
        result = result.filter((sb) => sb.status === "ready_to_pay" || sb.status === "pending_review");
      } else {
        result = result.filter((sb) => sb.status === activeTab);
      }
    }
    if (originFilter === "partner") {
      result = result.filter((sb) => isPartnerFieldBill(sb));
    } else if (originFilter === "internal") {
      result = result.filter((sb) => sb.bill_origin === "internal");
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (sb) =>
          (sb.partner_name ?? "").toLowerCase().includes(q) ||
          (sb.reference ?? "").toLowerCase().includes(q) ||
          (sb.week_label ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [selfBills, activeTab, search, originFilter]);
  const hasPendingReviewInFiltered = useMemo(
    () => filtered.some((sb) => sb.status === "pending_review"),
    [filtered],
  );

  const handleExportCsv = useCallback(() => {
    const headers = [
      "Reference",
      "Partner",
      "Origin",
      "Week label",
      "Week start",
      "Status",
      "Net payout",
      "Amount due",
      "Jobs count",
      "Created at",
    ];
    const rows = filtered.map((sb) => {
      const due = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
      return [
        sb.reference,
        sb.partner_name,
        sb.bill_origin ?? "",
        sb.week_label ?? "",
        sb.week_start ?? "",
        sb.status,
        String(sb.net_payout ?? ""),
        String(due),
        String(sb.jobs_count ?? ""),
        sb.created_at ?? "",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
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

  useEffect(() => {
    let cancelled = false;
    const ids = selfBills.map((sb) => sb.id);
    if (ids.length === 0) {
      setJobsBySelfBillId({});
      setPartnerPaidByJobId({});
      return;
    }
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
        if (!cancelled) {
          setJobsBySelfBillId({});
          setPartnerPaidByJobId({});
          toast.error(e instanceof Error ? e.message : "Failed to load jobs linked to self-bills");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfBills]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor),
    [periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor]
  );

  const totals = useMemo(() => {
    const all = selfBills;
    let amountDueSum = 0;
    for (const sb of all) {
      if (isSelfBillPayoutVoided(sb)) continue;
      amountDueSum += computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
    }
    const partnerRows = all.filter((sb) => isPartnerFieldBill(sb) && !isSelfBillPayoutVoided(sb));
    return {
      totalPayouts: partnerRows.reduce((s, sb) => s + Number(sb.net_payout), 0),
      paidCount: all.filter((sb) => sb.status === "paid").length,
      readyCount: all.filter((sb) => sb.status === "ready_to_pay").length,
      ongoingCount: all.filter((sb) => sb.status === "accumulating").length,
      auditCount: all.filter((sb) => sb.status === "audit_required").length,
      amountDueSum,
      readyPaidCount: all.filter((sb) => sb.status === "ready_to_pay" || sb.status === "pending_review" || sb.status === "paid").length,
    };
  }, [selfBills, jobsBySelfBillId, partnerPaidByJobId]);

  const updateSelfBillStatus = async (id: string, newStatus: string) => {
    const supabase = getSupabase();
    const { error } = await supabase.from("self_bills").update({ status: newStatus }).eq("id", id);
    if (error) throw error;
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const eligible = Array.from(selectedIds).filter((id) => {
      const sb = selfBills.find((s) => s.id === id);
      return sb && !isSelfBillPayoutVoided(sb);
    });
    if (eligible.length === 0) {
      toast.error("Selected self-bills include closed-out (void) records — remove them from the selection.");
      return;
    }
    if (eligible.length < selectedIds.size) {
      toast.message(`${selectedIds.size - eligible.length} void self-bill(s) skipped`);
    }
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("self_bills").update({ status: newStatus }).in("id", eligible);
      if (error) throw error;
      toast.success(`${eligible.length} self-bill(s) updated`);
      setSelectedIds(new Set());
      loadData();
    } catch {
      toast.error("Failed to update self-bills");
    }
  };

  const handleApprove = async (sb: SelfBill) => {
    try {
      await updateSelfBillStatus(sb.id, "ready_to_pay");
      toast.success("Marked ready to pay");
      loadData();
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async (sb: SelfBill) => {
    try {
      await updateSelfBillStatus(sb.id, "rejected");
      toast.success("Self-bill rejected");
      loadData();
    } catch {
      toast.error("Failed to reject");
    }
  };

  const openEdit = (sb: SelfBill) => {
    setEditSelfBill(sb);
    setEditForm({
      job_value: String(sb.job_value ?? 0),
      materials: String(sb.materials ?? 0),
      commission: String(sb.commission ?? 0),
    });
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
      const { error } = await supabase
        .from("self_bills")
        .update({
          job_value: jv,
          materials: mat,
          commission: comm,
          net_payout: net,
        })
        .eq("id", editSelfBill.id);
      if (error) throw error;
      toast.success("Totals updated");
      setEditSelfBill(null);
      loadData();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  const openJobsModal = async (sb: SelfBill) => {
    setLoadingJobs(true);
    setJobsModal({ selfBill: sb, jobs: [] });
    try {
      const jobs = await listJobsForSelfBill(sb.id);
      setJobsModal({ selfBill: sb, jobs });
    } catch {
      toast.error("Failed to load jobs");
      setJobsModal(null);
    } finally {
      setLoadingJobs(false);
    }
  };

  /** Auto-open the SB drawer when the page is reached via ?open={selfBillId} */
  useEffect(() => {
    if (!autoOpenSbId || autoOpenFiredRef.current || selfBills.length === 0) return;
    const match = selfBills.find((sb) => sb.id === autoOpenSbId);
    if (!match) return;
    autoOpenFiredRef.current = true;
    void openJobsModal(match);
  // openJobsModal is stable enough; autoOpenSbId comes from URL so doesn't change
  }, [autoOpenSbId, selfBills]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = useMemo(
    () =>
      TAB_ORDER.map((id) => ({
        id,
        label:
          id === "all"
            ? "All"
            : id === "draft"
              ? "Draft"
              : id === "audit_required"
                ? "Audit required"
                : id === "accumulating"
                  ? "Ongoing"
                  : id === "ready_to_pay"
                      ? "Ready to Pay"
                      : id === "paid"
                        ? "Paid"
                        : id === "rejected"
                          ? "Rejected"
                          : "No payout",
        count:
          id === "all"
            ? selfBills.length
            : id === "no_payout"
              ? SELF_BILL_PAYOUT_VOID_STATUSES.reduce((acc, st) => acc + (statusCounts[st] ?? 0), 0)
              : id === "ready_to_pay"
                ? (statusCounts.ready_to_pay ?? 0) + (statusCounts.pending_review ?? 0)
              : statusCounts[id] ?? 0,
      })),
    [selfBills.length, statusCounts]
  );

  const columns: Column<SelfBill>[] = [
    {
      key: "reference",
      label: "Self bill",
      minWidth: "200px",
      cellClassName: "!whitespace-nowrap max-w-[min(260px,36vw)] overflow-hidden align-top",
      render: (item) => (
        <p
          className="text-sm font-semibold text-text-primary font-mono truncate min-w-0 max-w-full"
          title={item.reference}
        >
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
              {item.bill_origin === "internal" && (
                <Badge variant="info" size="sm" className="shrink-0 text-[10px]">
                  Internal
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary truncate">
              {item.week_label ?? item.period}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      width: "108px",
      render: (item) => <span className="text-sm text-text-secondary whitespace-nowrap">{formatDate(item.created_at)}</span>,
    },
    {
      key: "payment_due",
      label: "Due date",
      width: "108px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) {
          return <span className="text-sm text-text-tertiary whitespace-nowrap">—</span>;
        }
        const we = item.week_end?.trim() ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(we)) {
          return <span className="text-sm text-text-tertiary whitespace-nowrap">—</span>;
        }
        const dueYmd = partnerFieldSelfBillPaymentDueDate(we);
        return (
          <span
            className="text-sm text-text-secondary whitespace-nowrap"
            title="Payment due (Friday after the Monday–Sunday week ends)"
          >
            {formatDate(dueYmd)}
          </span>
        );
      },
    },
    {
      key: "job_value",
      label: "Labour / gross",
      align: "right",
      minWidth: "128px",
      render: (item) => (
        <span className="text-sm tabular-nums text-text-primary">
          {formatCurrency(item.job_value)}
          {item.bill_origin === "internal" && Number(item.commission) > 0 ? (
            <span className="block text-[10px] text-text-tertiary font-normal">−{formatCurrency(item.commission)} ded.</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "materials",
      label: "Materials / extras",
      align: "right",
      minWidth: "140px",
      render: (item) => (
        <span className="text-sm tabular-nums text-text-secondary">
          {formatCurrency(item.materials)}
          {item.bill_origin === "internal" && item.materials > 0 ? (
            <span className="block text-[10px] text-text-tertiary font-normal">extras</span>
          ) : null}
        </span>
      ),
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
          <button
            type="button"
            className="text-sm font-semibold text-primary hover:underline tabular-nums"
            onClick={(e) => {
              e.stopPropagation();
              void openJobsModal(item);
            }}
          >
            {n}
          </button>
        );
      },
    },
    {
      key: "net_payout",
      label: "Net payout",
      align: "right",
      minWidth: "108px",
      render: (item) => (
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(item.net_payout)}</span>
          {isSelfBillPayoutVoided(item) &&
          item.original_net_payout != null &&
          Number(item.original_net_payout) > 0.02 ? (
            <span className="block text-[10px] text-text-tertiary tabular-nums">
              Orig. {formatCurrency(Number(item.original_net_payout))}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "amount_due",
      label: "Amount due",
      align: "right",
      minWidth: "112px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) {
          return <span className="text-sm text-text-tertiary">—</span>;
        }
        const due = computeSelfBillAmountDue(item, jobsBySelfBillId[item.id], partnerPaidByJobId);
        return (
          <span
            className={`text-sm font-semibold tabular-nums ${due > 0.02 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {formatCurrency(due)}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      minWidth: "160px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) {
          const orig =
            item.original_net_payout != null && Number(item.original_net_payout) > 0.02
              ? Number(item.original_net_payout)
              : null;
          return (
            <div className="space-y-1 min-w-0">
              <Badge variant="default" size="sm" className="text-[10px]">
                {SELF_BILL_FINANCE_VOID_LABEL}
              </Badge>
              <p className="text-[11px] font-medium text-text-primary truncate" title={selfBillPartnerStatusLine(item)}>
                Status: {selfBillPartnerStatusLine(item)}
              </p>
              {orig != null ? (
                <p className="text-[10px] text-text-tertiary tabular-nums">Original: {formatCurrency(orig)}</p>
              ) : null}
              <p className="text-[10px] text-text-tertiary tabular-nums">Payable: {formatCurrency(item.net_payout)}</p>
              {item.payout_void_reason ? (
                <p className="text-[10px] text-text-tertiary line-clamp-2" title={item.payout_void_reason}>
                  Reason: {item.payout_void_reason}
                </p>
              ) : null}
            </div>
          );
        }
        const config = statusConfig[item.status] ?? { label: item.status, variant: "default" as const };
        return (
          <Badge variant={config.variant} dot size="sm">
            {config.label}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "",
      width: "200px",
      cellClassName: "!align-middle",
      render: (item) => (
        <div
          className="flex flex-wrap items-center gap-1.5 justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          {item.status === "pending_review" ? (
            <>
              <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => void handleApprove(item)}>
                Approve
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 text-[11px] text-red-600" onClick={() => void handleReject(item)}>
                Reject
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(item)} title="Edit totals">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
          <a
            href={`/api/self-bills/${encodeURIComponent(item.id)}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
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
          infoTooltip={`Partner field jobs and internal People (contractors). Period: All · Month · Week · Date range (default: current month). Weekly buckets feed payout; reviewed items appear under Ready to Pay. ${weekPeriodHelpText()} ${partnerFieldSelfBillPaymentDueHelpText()}`}
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
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCsv}>
              Export
            </Button>
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Total payouts</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.totalPayouts)}</p>
              <p className="text-[11px] text-text-secondary">Partner field self-bills · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#ED4B00]/12 text-[#ED4B00]">
              <Wallet className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Ongoing</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{totals.ongoingCount}</p>
              <p className="text-[11px] text-text-secondary">Accumulating · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <Users className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Amount due</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.amountDueSum)}</p>
              <p className="text-[11px] text-text-secondary">After partner payouts on jobs · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-700 dark:text-purple-300">
              <DollarSign className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Ready / paid</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{totals.readyPaidCount}</p>
              <p className="text-[11px] text-text-secondary">Ready to pay + paid · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            </div>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3"
          style={{ backgroundColor: "#FFF8F3", borderWidth: 0.5, borderColor: "#F5CFB8" }}
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ED4B00]/12 text-[#ED4B00]">
              <ShieldAlert className="h-4 w-4" aria-hidden />
            </div>
            <p className="text-sm text-text-secondary flex-1 min-w-0">
              <span className="font-semibold text-text-primary">Audit required</span> only when a complaint is logged (e.g. email).{" "}
              <span className="text-text-tertiary">({totals.auditCount} in period)</span>
            </p>
          </div>
          <Link href="/finance/pay-run" className="text-sm font-semibold text-primary hover:underline shrink-0">
            Open pay run →
          </Link>
        </div>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as SelfBillTab)} />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCsv}>
                Export
              </Button>
              <SearchInput
                placeholder="Search name, ref, week…"
                className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Source">
                {(
                  [
                    { id: "all" as const, label: "All" },
                    { id: "partner" as const, label: "Partners" },
                    { id: "internal" as const, label: "Internal" },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                      originFilter === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"
                    }`}
                    onClick={() => setOriginFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Layout">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${layoutMode === "cards" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`}
                  onClick={() => setLayoutMode("cards")}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Cards
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${layoutMode === "table" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`}
                  onClick={() => setLayoutMode("table")}
                >
                  <List className="h-3.5 w-3.5" />
                  Table
                </button>
              </div>
            </div>
          </div>

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
                    onApprove={() => void handleApprove(sb)}
                    onReject={() => void handleReject(sb)}
                    onEdit={() => openEdit(sb)}
                    onOpenJobs={() => void openJobsModal(sb)}
                  />
                ))
              )}
            </div>
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
              onRowClick={(item) => void openJobsModal(item)}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
              tableClassName="min-w-[1220px]"
            bulkActions={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  {activeTab === "ready_to_pay" && hasPendingReviewInFiltered && (
                  <>
                    <BulkBtn label="Approve → Ready to pay" onClick={() => handleBulkStatusChange("ready_to_pay")} variant="success" icon={<CheckCircle2 className="h-3 w-3" />} />
                      <BulkBtn label="Reject" onClick={() => handleBulkStatusChange("rejected")} variant="danger" icon={<XCircle className="h-3 w-3" />} />
                  </>
                )}
                <BulkBtn label="Ready to pay" onClick={() => handleBulkStatusChange("ready_to_pay")} variant="info" />
                <BulkBtn label="Mark paid" onClick={() => handleBulkStatusChange("paid")} variant="success" />
                <BulkBtn label="Audit required" onClick={() => handleBulkStatusChange("audit_required")} variant="warning" />
              </div>
            }
          />
          )}
        </motion.div>
      </div>

      <Drawer
        open={!!jobsModal}
        onClose={() => setJobsModal(null)}
        title={jobsModal?.selfBill.reference ?? ""}
        subtitle={
          jobsModal
            ? `${jobsModal.selfBill.partner_name} · ${jobsModal.selfBill.week_label ?? jobsModal.selfBill.period}`
            : undefined
        }
        width="w-[580px]"
      >
        {jobsModal ? (
          <SelfBillLinkedJobsPanel
            sb={jobsModal.selfBill}
            jobs={jobsModal.jobs}
            loadingJobs={loadingJobs}
            partnerPaidByJobId={partnerPaidByJobId}
          />
        ) : null}
      </Drawer>

      <Modal
        open={!!editSelfBill}
        onClose={() => setEditSelfBill(null)}
        title="Edit self-bill totals"
        subtitle="Adjust labour, materials, or commission if figures need correction before approval."
        size="md"
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Labour (job value)</label>
              <Input
                type="number"
                step="0.01"
                value={editForm.job_value}
                onChange={(e) => setEditForm((f) => ({ ...f, job_value: e.target.value }))}
              />
          </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Materials</label>
              <Input
                type="number"
                step="0.01"
                value={editForm.materials}
                onChange={(e) => setEditForm((f) => ({ ...f, materials: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Commission</label>
              <Input
                type="number"
                step="0.01"
                value={editForm.commission}
                onChange={(e) => setEditForm((f) => ({ ...f, commission: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-xs text-text-tertiary">
            Net payout = labour + materials − commission:{" "}
            <strong className="text-text-primary tabular-nums">
              {formatCurrency(
                (Number(editForm.job_value) || 0) + (Number(editForm.materials) || 0) - (Number(editForm.commission) || 0)
              )}
            </strong>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setEditSelfBill(null)}>
              Cancel
            </Button>
            <Button type="button" loading={savingEdit} onClick={() => void saveEdit()}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}

function SelfBillCard({
  sb,
  jobs,
  partnerPaidByJobId,
  onApprove,
  onReject,
  onEdit,
  onOpenJobs,
}: {
  sb: SelfBill;
  jobs: Pick<
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
  >[];
  partnerPaidByJobId: Record<string, number>;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onOpenJobs: () => void;
}) {
  const cfg = statusConfig[sb.status] ?? { label: sb.status, variant: "default" as const };
  const review = sb.status === "pending_review";
  const internal = sb.bill_origin === "internal";
  const voided = isSelfBillPayoutVoided(sb);
  const origSnap =
    sb.original_net_payout != null && Number(sb.original_net_payout) > 0.02 ? Number(sb.original_net_payout) : null;
  const amountDue = voided ? 0 : computeSelfBillAmountDue(sb, jobs, partnerPaidByJobId);
  const cardDueYmd =
    !voided && /^\d{4}-\d{2}-\d{2}$/.test(sb.week_end?.trim() ?? "")
      ? partnerFieldSelfBillPaymentDueDate(sb.week_end!.trim())
      : null;

  return (
    <div className="rounded-2xl border border-border-light bg-card shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border-light bg-surface-hover/40 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={sb.partner_name} size="md" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-text-primary truncate">{sb.partner_name}</p>
              {internal && (
                <Badge variant="info" size="sm" className="text-[10px]">
                  Internal
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary font-mono truncate">
              {sb.reference} · {sb.week_label ?? sb.period}
            </p>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Created {formatDate(sb.created_at)}
              {cardDueYmd ? ` · Due ${formatDate(cardDueYmd)}` : null}
            </p>
          </div>
        </div>
        {voided ? (
          <div className="flex flex-col items-end gap-1 text-right max-w-[12rem]">
            <Badge variant="default" size="sm" className="text-[10px]">
              {SELF_BILL_FINANCE_VOID_LABEL}
            </Badge>
            <p className="text-[11px] font-medium text-text-primary leading-snug">
              Status: {selfBillPartnerStatusLine(sb)}
            </p>
            {sb.payout_void_reason ? (
              <p className="text-[10px] text-text-tertiary line-clamp-3">{sb.payout_void_reason}</p>
            ) : null}
          </div>
        ) : (
          <Badge variant={cfg.variant} dot size="sm">
            {cfg.label}
          </Badge>
        )}
      </div>

      {voided ? (
        <div className="px-4 py-2.5 border-b border-border-light/80 bg-amber-50/40 dark:bg-amber-950/20 text-[11px] text-text-secondary space-y-0.5">
          {origSnap != null ? (
            <p>
              <span className="font-semibold text-text-primary">Original amount:</span> {formatCurrency(origSnap)}
            </p>
          ) : null}
          <p>
            <span className="font-semibold text-text-primary">Payable amount:</span> {formatCurrency(sb.net_payout)}
          </p>
        </div>
      ) : null}

      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-center border-b border-border-light/80 bg-background/50">
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">{internal ? "Gross" : "Labour"}</p>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(sb.job_value)}</p>
          {internal && Number(sb.commission) > 0 ? (
            <p className="text-[10px] text-text-tertiary">−{formatCurrency(sb.commission)} ded.</p>
          ) : null}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">{internal ? "Extras" : "Materials"}</p>
          <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(sb.materials)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Jobs</p>
          <button type="button" onClick={onOpenJobs} className="text-sm font-bold text-primary hover:underline tabular-nums">
            {sb.jobs_count}
          </button>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Net payout</p>
          <p className="text-sm font-bold tabular-nums text-text-primary">{formatCurrency(sb.net_payout)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Amount due</p>
          <p
            className={`text-sm font-bold tabular-nums ${voided ? "text-text-tertiary" : amountDue > 0.02 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {voided ? "—" : formatCurrency(amountDue)}
          </p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-0.5 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Linked jobs</p>
        {internal ? (
          <p className="text-xs text-text-tertiary py-2">Internal self-bill — no field jobs. Created from People → Contractors.</p>
        ) : jobs.length === 0 ? (
          <p className="text-xs text-text-tertiary py-2">No jobs linked yet.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {jobs.map((j) => {
              const payoutNote = selfBillJobPayoutStateLabel(j);
              const paid = partnerPaidByJobId[j.id] ?? 0;
              const cap = jobContributesToSelfBillPayout(j) ? jobLinePartnerGross(j) : 0;
              const lineDue = jobContributesToSelfBillPayout(j) ? Math.max(0, Math.round((cap - paid) * 100) / 100) : 0;
              return (
                <div
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-light/80 bg-surface-hover/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
                      {j.reference}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </Link>
                    <p className="text-[10px] text-text-tertiary font-mono truncate" title={j.id}>
                      Job ID: {j.id}
                    </p>
                    <p className="text-[11px] text-text-secondary truncate">{j.title}</p>
                    {payoutNote ? <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">{payoutNote}</p> : null}
                  </div>
                  <div className="text-right text-[11px] tabular-nums space-y-0.5">
                    <p>
                      L {formatCurrency(Number(j.partner_cost) || 0)} · M {formatCurrency(Number(j.materials_cost) || 0)}
                    </p>
                    {jobContributesToSelfBillPayout(j) ? (
                      <p className="text-text-tertiary">
                        Paid {formatCurrency(paid)} ·{" "}
                        <span className={lineDue > 0.02 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
                          Due {formatCurrency(lineDue)}
                        </span>
                      </p>
                    ) : null}
                    <Badge variant="default" size="sm" className="text-[9px]">
                      {j.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border-light flex flex-wrap items-center gap-2 justify-between bg-surface-hover/30">
        <div className="flex flex-wrap gap-2">
          {review ? (
            <>
              <Button size="sm" variant="primary" className="h-8 text-xs" onClick={onApprove}>
                Approve
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200" onClick={onReject}>
                Reject
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onEdit}>
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            </>
          ) : null}
        </div>
        <a
          href={`/api/self-bills/${encodeURIComponent(sb.id)}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
        </a>
      </div>
    </div>
  );
}

function SelfBillLinkedJobsPanel({
  sb,
  jobs,
  loadingJobs,
  partnerPaidByJobId,
}: {
  sb: SelfBill;
  jobs: Awaited<ReturnType<typeof listJobsForSelfBill>>;
  loadingJobs: boolean;
  partnerPaidByJobId: Record<string, number>;
}) {
  const cfg = statusConfig[sb.status] ?? { label: sb.status, variant: "default" as const };
  const voided = isSelfBillPayoutVoided(sb);
  const origSnap =
    sb.original_net_payout != null && Number(sb.original_net_payout) > 0.02 ? Number(sb.original_net_payout) : null;
  const sheetDue = voided ? 0 : computeSelfBillAmountDue(sb, jobs, partnerPaidByJobId);
  const dueYmd =
    !voided && /^\d{4}-\d{2}-\d{2}$/.test(sb.week_end?.trim() ?? "")
      ? partnerFieldSelfBillPaymentDueDate(sb.week_end!.trim())
      : null;
  const [tab, setTab] = useState<"details" | "linked-jobs" | "payment" | "activity">("details");
  const totalPaidToDate = jobs.reduce((sum, j) => sum + Number(partnerPaidByJobId[j.id] ?? 0), 0);
  const grossTotal = Math.round((Number(sb.job_value ?? 0) + Number(sb.materials ?? 0)) * 100) / 100;
  const activityItems = [
    `Created ${formatDate(sb.created_at)}`,
    dueYmd ? `Due ${formatDate(dueYmd)}` : "Due date pending",
    `Status ${cfg.label}`,
  ];
  const selfBillTabs: Array<{ id: "details" | "linked-jobs" | "payment" | "activity"; label: string; count?: number }> = [
    { id: "details", label: "Details" },
    { id: "linked-jobs", label: "Linked Jobs", count: jobs.length },
    { id: "payment", label: "Payment" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="min-h-full bg-[var(--fixfy-cream)]">
      <div className="p-[22px] space-y-4">
        <div
          className="rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] px-4 py-[14px]"
          style={{ boxShadow: "0 1px 3px rgba(10,13,46,0.04)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Avatar name={sb.partner_name} size="md" className="shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[var(--fixfy-text)]">{sb.partner_name}</p>
                <p className="text-[11px] text-[var(--fixfy-text-muted)]">
                  {sb.bill_origin === "internal" ? "Internal partner" : "Carpenter · Partner since Jan 2026"}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--fixfy-text-muted)]">
                  VAT: {sb.bill_origin === "internal" ? "N/A" : "Not registered"} · {sb.bill_origin === "internal" ? "Internal" : "Sole trader"}
                </p>
              </div>
            </div>
            <button type="button" className="text-[11px] font-semibold text-[var(--link-text)]">View ↗</button>
          </div>
        </div>

        <div className="border-b border-[var(--fixfy-border)]">
          <div className="inline-flex items-stretch gap-0">
            {selfBillTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "relative px-4 py-2.5 text-sm",
                  tab === item.id ? "font-semibold text-[#ED4B00]" : "font-medium text-[var(--fixfy-text-muted)]",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {item.label}
                  {item.count !== undefined ? (
                    <span className="rounded-md bg-[#F0F2F7] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--fixfy-text-tertiary)]">
                      {item.count}
                    </span>
                  ) : null}
                </span>
                {tab === item.id ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ED4B00]" /> : null}
              </button>
            ))}
          </div>
        </div>

        {tab === "details" ? (
          <>
            <div className="rounded-[10px] border border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--status-pending-text)]">• {cfg.label} · Due in</p>
                  <p className="text-[11px] text-[var(--fixfy-text-muted)]">
                    {dueYmd ? `Due ${formatDate(dueYmd)}` : `Created ${formatDate(sb.created_at)}`} · Next Pay Run
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[22px] font-semibold text-[var(--fixfy-text)] tabular-nums">{formatCurrency(sheetDue)}</p>
                  <p className="text-[11px] text-[var(--fixfy-text-muted)]">No VAT · Partner payout</p>
                </div>
              </div>
            </div>

            <div>
              <div className="rounded-t-[10px] border border-[var(--fixfy-border)] border-b-0 bg-[var(--fixfy-white)]">
                <div className="grid grid-cols-3 divide-x divide-[var(--fixfy-border)]">
                  <div className="px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-[#6B7280]">LABOUR</p>
                    <p className="mt-1 text-[22px] font-semibold text-[var(--fixfy-text)]">{formatCurrency(sb.job_value)}</p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-[#6B7280]">MATERIALS</p>
                    <p className="mt-1 text-[22px] font-semibold text-[var(--fixfy-text)]">{formatCurrency(sb.materials)}</p>
                  </div>
                  <div className="bg-emerald-50 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-[#6B7280]">NET PAYOUT</p>
                    <p className="mt-1 text-[22px] font-semibold text-[var(--margin-text)]">{formatCurrency(sb.net_payout)}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-b-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] px-3 py-2.5 text-[11px]">
                <span className="text-[var(--fixfy-text-muted)]">
                  {sb.week_label ? `Awaiting Pay Run ${sb.week_label}` : "Awaiting pay run"}
                  {dueYmd ? ` · Scheduled ${formatDate(dueYmd)}` : ""}
                </span>
                <button type="button" className="font-semibold text-[var(--link-text)]">View Pay Run ↗</button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--fixfy-text-muted)]">Linked Jobs</p>
                <button type="button" className="text-[12px] font-semibold text-[var(--link-text)]">+ Link job</button>
              </div>
              <div className="rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] px-3 py-4 text-center">
                {loadingJobs ? (
                  <div className="space-y-2">
                    <div className="h-12 rounded-lg bg-surface-hover animate-pulse" />
                    <div className="h-12 rounded-lg bg-surface-hover animate-pulse" />
                  </div>
                ) : jobs.length === 0 ? (
                  <>
                    <p className="text-[13px] text-[var(--fixfy-text-muted)]">No jobs linked yet</p>
                    <p className="mt-1 text-[11px] text-[var(--fixfy-text-tertiary)]">Jobs completed this week will appear automatically.</p>
                  </>
                ) : (
                  <div className="space-y-2 text-left">
                    {jobs.map((j) => <JobRow key={j.id} j={j} partnerPaid={partnerPaidByJobId[j.id] ?? 0} />)}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--fixfy-text-muted)]">Self-bill Breakdown</p>
              <div className="overflow-hidden rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)]">
                <div className="flex items-center justify-between border-b border-[var(--fixfy-border)] px-3 py-3">
                  <p className="text-[13px] font-semibold text-[var(--fixfy-text)]">• Labour</p>
                  <p className="text-[13px] font-semibold text-[var(--fixfy-text)] tabular-nums">{formatCurrency(sb.job_value)}</p>
                </div>
                <div className="flex items-center justify-between border-b border-[var(--fixfy-border)] px-3 py-3">
                  <p className="text-[13px] font-semibold text-[var(--fixfy-text)]">• Materials</p>
                  <p className="text-[13px] font-semibold text-[var(--fixfy-text)] tabular-nums">{formatCurrency(sb.materials)}</p>
                </div>
                <div className="flex items-center justify-between border-b border-[var(--fixfy-border)] bg-[var(--fixfy-white)] px-3 py-2.5">
                  <p className="text-[12px] text-[var(--fixfy-text-muted)]">Gross total</p>
                  <p className="text-[12px] text-[var(--fixfy-text)] tabular-nums">{formatCurrency(grossTotal)}</p>
                </div>
                <div className="flex items-center justify-between bg-[var(--fixfy-navy)] px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-white">Net payout to partner</p>
                  <p className="text-[15px] font-semibold text-white tabular-nums">{formatCurrency(sb.net_payout)}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--fixfy-text-muted)]">Payment Status</p>
              <div className="rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] px-3 py-2">
                <div className="space-y-1 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--fixfy-text-muted)]">Net payout</span>
                    <span className="tabular-nums text-[var(--fixfy-text)]">{formatCurrency(sb.net_payout)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--fixfy-text-muted)]">Paid to date</span>
                    <span className="tabular-nums text-[var(--fixfy-text)]">{formatCurrency(totalPaidToDate)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--fixfy-text-muted)]">Adjustments</span>
                    <span className="tabular-nums text-[var(--fixfy-text-muted)]">—</span>
                  </div>
                  <div className="my-1 border-t border-[var(--fixfy-border)]" />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--fixfy-text)]">Due to partner</span>
                    <span className={cn("font-semibold tabular-nums", sheetDue > 0.02 ? "text-[var(--danger-text)]" : "text-[var(--reconciled-text)]")}>
                      {formatCurrency(sheetDue)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--fixfy-text-muted)]">Quick Actions</p>
              <div className="grid grid-cols-2 gap-2">
                {["📄 Open PDF", "🧾 Add deduction", "⚠ Dispute", "✉ Send to partner"].map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="rounded-[10px] border border-[var(--fixfy-border-strong)] bg-[var(--fixfy-white)] px-3 py-3 text-[13px] font-semibold text-[var(--fixfy-text)]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {tab === "linked-jobs" ? (
          <div className="rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] p-3">
            {loadingJobs ? (
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
                <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-[var(--fixfy-text-tertiary)] py-2">No jobs linked to this self-bill.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((j) => <JobRow key={j.id} j={j} partnerPaid={partnerPaidByJobId[j.id] ?? 0} />)}
              </div>
            )}
          </div>
        ) : null}

        {tab === "payment" ? (
          <div className="rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] p-4 space-y-2">
            <p className="text-[13px] text-[var(--fixfy-text-muted)]">Payment summary for this self-bill.</p>
            <p className="text-[13px] text-[var(--fixfy-text)]">Net payout: <span className="font-semibold tabular-nums">{formatCurrency(sb.net_payout)}</span></p>
            <p className="text-[13px] text-[var(--fixfy-text)]">Paid to date: <span className="font-semibold tabular-nums">{formatCurrency(totalPaidToDate)}</span></p>
            <p className="text-[13px] text-[var(--fixfy-text)]">Due: <span className="font-semibold tabular-nums">{formatCurrency(sheetDue)}</span></p>
          </div>
        ) : null}

        {tab === "activity" ? (
          <div className="rounded-[10px] border border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] p-4 space-y-2">
            {activityItems.map((item) => (
              <p key={item} className="text-[13px] text-[var(--fixfy-text)]">• {item}</p>
            ))}
            {voided && origSnap != null ? (
              <p className="text-[13px] text-[var(--fixfy-text)]">• Original amount: {formatCurrency(origSnap)}</p>
            ) : null}
            {voided ? (
              <p className="text-[13px] text-[var(--fixfy-text)]">• {selfBillPartnerStatusLine(sb)}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-[var(--fixfy-border)] bg-[var(--fixfy-surface)] px-[14px] py-[14px]">
        <div className="grid grid-cols-2 gap-[10px]">
          <button
            type="button"
            onClick={() => toast.success("Payout recording flow coming next.")}
            className="rounded-[10px] border border-[var(--fixfy-border-strong)] bg-[var(--fixfy-white)] px-3 py-[12px] text-[14px] font-semibold text-[var(--fixfy-text)]"
          >
            + Record payout
          </button>
          <button
            type="button"
            onClick={() => toast.success("Marked as paid")}
            className="rounded-[10px] border border-[var(--fixfy-orange)] bg-[var(--fixfy-orange)] px-3 py-[12px] text-[14px] font-semibold text-white"
          >
            ✓ Mark as paid
          </button>
        </div>
      </div>
    </div>
  );
}

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
        <p className="text-[10px] text-text-tertiary font-mono truncate" title={j.id}>
          Job ID: {j.id}
        </p>
        <p className="text-xs text-text-secondary truncate">{j.title}</p>
        <p className="text-[11px] text-text-tertiary truncate">{j.property_address}</p>
        {payoutNote ? <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{payoutNote}</p> : null}
      </div>
      <div className="text-right text-xs space-y-0.5">
        <p>
          Labour <span className="font-semibold tabular-nums">{formatCurrency(Number(j.partner_cost) || 0)}</span>
        </p>
        <p>
          Mat. <span className="font-semibold tabular-nums">{formatCurrency(Number(j.materials_cost) || 0)}</span>
        </p>
        {jobContributesToSelfBillPayout(j) ? (
          <>
            <p className="text-text-tertiary">
              Paid <span className="font-semibold tabular-nums text-text-secondary">{formatCurrency(partnerPaid)}</span>
            </p>
            <p className={due > 0.02 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
              Due <span className="tabular-nums">{formatCurrency(due)}</span>
            </p>
          </>
        ) : null}
        <Badge variant="default" size="sm">
          {j.status}
        </Badge>
      </div>
    </div>
  );
}

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
