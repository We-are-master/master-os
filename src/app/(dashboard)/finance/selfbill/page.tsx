"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Download,
  Wallet,
  DollarSign,
  Users,
  Clock,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { SelfBill } from "@/types/database";
import { getSupabase } from "@/services/base";
import { weekPeriodHelpText, parseDateRangeOrWeek, getWeekBoundsForDate } from "@/lib/self-bill-period";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { formatFinancePeriodKpiDescription } from "@/lib/finance-period";
import { listJobsForSelfBill } from "@/services/self-bills";
import type { Job } from "@/types/database";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  accumulating: { label: "Open week", variant: "default" },
  pending_review: { label: "Review & approve", variant: "primary" },
  needs_attention: { label: "Needs attention", variant: "danger" },
  awaiting_payment: { label: "Awaiting payment", variant: "warning" },
  ready_to_pay: { label: "Ready to pay", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  audit_required: { label: "Audit required", variant: "danger" },
  rejected: { label: "Rejected", variant: "default" },
};

export default function SelfBillPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("week");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [jobsModal, setJobsModal] = useState<{ selfBill: SelfBill; jobs: Awaited<ReturnType<typeof listJobsForSelfBill>> } | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    try {
      let q = supabase.from("self_bills").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false });
      if (periodMode === "week") {
        const { weekLabel } = getWeekBoundsForDate(weekAnchor);
        q = q.eq("week_label", weekLabel);
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
    } catch {
      toast.error("Failed to load self-bills");
    } finally {
      setLoading(false);
    }
  }, [periodMode, weekAnchor, rangeFrom, rangeTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    let result = selfBills;
    if (activeTab === "review") result = result.filter((sb) => sb.status === "pending_review");
    else if (activeTab === "needs_attention") result = result.filter((sb) => sb.status === "needs_attention");
    else if (activeTab !== "all") result = result.filter((sb) => sb.status === activeTab);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (sb) =>
          sb.partner_name.toLowerCase().includes(q) ||
          sb.reference.toLowerCase().includes(q) ||
          (sb.week_label ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [selfBills, activeTab, search]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );

  const totals = useMemo(() => {
    const all = selfBills;
    return {
      totalPayouts: all.reduce((s, sb) => s + Number(sb.net_payout), 0),
      totalCommission: all.reduce((s, sb) => s + Number(sb.commission), 0),
      totalJobValue: all.reduce((s, sb) => s + Number(sb.job_value), 0),
      totalMaterials: all.reduce((s, sb) => s + Number(sb.materials), 0),
      paidCount: all.filter((sb) => sb.status === "paid").length,
      readyCount: all.filter((sb) => sb.status === "ready_to_pay").length,
      reviewCount: all.filter((sb) => sb.status === "pending_review").length,
      attentionCount: all.filter((sb) => sb.status === "needs_attention").length,
      awaitingCount: all.filter((sb) => sb.status === "awaiting_payment").length,
      auditCount: all.filter((sb) => sb.status === "audit_required").length,
      openWeekCount: all.filter((sb) => sb.status === "accumulating").length,
    };
  }, [selfBills]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("self_bills").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} self-bill(s) updated`);
      setSelectedIds(new Set());
      loadData();
    } catch {
      toast.error("Failed to update self-bills");
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

  const tabs = [
    { id: "all", label: "All", count: selfBills.length },
    { id: "review", label: "Review & approve", count: totals.reviewCount },
    { id: "needs_attention", label: "Needs attention", count: totals.attentionCount },
    { id: "accumulating", label: "Open week", count: totals.openWeekCount },
    { id: "awaiting_payment", label: "Awaiting payment", count: totals.awaitingCount },
    { id: "ready_to_pay", label: "Ready to pay", count: totals.readyCount },
    { id: "paid", label: "Paid", count: totals.paidCount },
    { id: "audit_required", label: "Audit required", count: totals.auditCount },
  ];

  const columns: Column<SelfBill>[] = [
    {
      key: "partner_name",
      label: "Partner",
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={item.partner_name} size="sm" />
          <div>
            <p className="text-sm font-medium text-text-primary">{item.partner_name}</p>
            <p className="text-[11px] text-text-tertiary">
              {item.reference}
              {item.week_label ? ` · ${item.week_label}` : ` · ${item.period}`}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "jobs_count",
      label: "Jobs",
      align: "center",
      render: (item) => (
        <button
          type="button"
          className="text-sm font-semibold text-primary hover:underline"
          onClick={() => void openJobsModal(item)}
        >
          {item.jobs_count}
        </button>
      ),
    },
    {
      key: "job_value",
      label: "Labour",
      align: "right",
      render: (item) => <span className="text-sm text-text-primary">{formatCurrency(item.job_value)}</span>,
    },
    {
      key: "materials",
      label: "Materials",
      align: "right",
      render: (item) => <span className="text-sm text-text-secondary">{formatCurrency(item.materials)}</span>,
    },
    {
      key: "net_payout",
      label: "Net payout",
      align: "right",
      render: (item) => <span className="text-sm font-bold text-text-primary">{formatCurrency(item.net_payout)}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (item) => {
        const config = statusConfig[item.status] ?? { label: item.status, variant: "default" as const };
        return (
          <Badge variant={config.variant} dot>
            {config.label}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "",
      render: (item) => (
        <div className="flex items-center gap-2 justify-end">
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
          title="Partner self-billing"
          subtitle={`Weekly partner payouts. ${weekPeriodHelpText()}`}
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
            Export CSV
          </Button>
        </PageHeader>

        <div className="rounded-xl border border-border-light bg-surface-hover/60 p-4 space-y-3">
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
        </div>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total payouts (loaded)"
            value={totals.totalPayouts}
            format="currency"
            description={kpiPeriodDesc}
            icon={Wallet}
            accent="primary"
          />
          <KpiCard
            title="Review queue"
            value={totals.reviewCount}
            format="number"
            description={`Pending review · ${kpiPeriodDesc}`}
            icon={Users}
            accent="amber"
          />
          <KpiCard
            title="Ready / paid"
            value={totals.readyCount + totals.paidCount}
            format="number"
            description={`Ready + paid · ${kpiPeriodDesc}`}
            icon={DollarSign}
            accent="emerald"
          />
          <KpiCard
            title="Needs attention"
            value={totals.attentionCount}
            format="number"
            description={`${kpiPeriodDesc}`}
            icon={Clock}
            accent="blue"
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 mb-4">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            <div className="flex items-center gap-2 flex-wrap">
              <SearchInput placeholder="Search partner, ref, week…" className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            getRowId={(item) => item.id}
            loading={loading}
            page={1}
            totalPages={1}
            totalItems={filtered.length}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            bulkActions={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                {activeTab === "review" && (
                  <>
                    <BulkBtn label="Approve → Ready to pay" onClick={() => handleBulkStatusChange("ready_to_pay")} variant="success" icon={<CheckCircle2 className="h-3 w-3" />} />
                    <BulkBtn label="Flag → Needs attention" onClick={() => handleBulkStatusChange("needs_attention")} variant="warning" icon={<AlertTriangle className="h-3 w-3" />} />
                  </>
                )}
                {activeTab === "needs_attention" && (
                  <BulkBtn label="Approve → Ready to pay" onClick={() => handleBulkStatusChange("ready_to_pay")} variant="success" icon={<CheckCircle2 className="h-3 w-3" />} />
                )}
                <BulkBtn label="Ready to pay" onClick={() => handleBulkStatusChange("ready_to_pay")} variant="info" />
                <BulkBtn label="Mark paid" onClick={() => handleBulkStatusChange("paid")} variant="success" />
                <BulkBtn label="Audit required" onClick={() => handleBulkStatusChange("audit_required")} variant="warning" />
                <BulkBtn label="Reject" onClick={() => handleBulkStatusChange("rejected")} variant="danger" />
              </div>
            }
          />
        </motion.div>
      </div>

      <Modal
        open={!!jobsModal}
        onClose={() => setJobsModal(null)}
        title={jobsModal ? `Jobs — ${jobsModal.selfBill.reference}` : ""}
        subtitle={jobsModal ? `${jobsModal.selfBill.partner_name} · ${jobsModal.selfBill.week_label ?? jobsModal.selfBill.period}` : undefined}
        size="lg"
      >
        {jobsModal && (
          <div className="p-6 max-h-[70vh] overflow-y-auto space-y-2">
            {loadingJobs ? (
              <p className="text-sm text-text-tertiary">Loading…</p>
            ) : jobsModal.jobs.length === 0 ? (
              <p className="text-sm text-text-tertiary">No jobs linked.</p>
            ) : (
              jobsModal.jobs.map((j) => (
                <JobRow key={j.id} j={j} />
              ))
            )}
          </div>
        )}
      </Modal>
    </PageTransition>
  );
}

function JobRow({ j }: { j: Pick<Job, "id" | "reference" | "title" | "partner_cost" | "materials_cost" | "status" | "property_address"> }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-border-light bg-surface-hover/80">
      <div className="min-w-0">
        <Link href={`/jobs/${j.id}`} className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
          {j.reference}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </Link>
        <p className="text-xs text-text-secondary truncate">{j.title}</p>
        <p className="text-[11px] text-text-tertiary truncate">{j.property_address}</p>
      </div>
      <div className="text-right text-xs space-y-0.5">
        <p>
          Labour <span className="font-semibold tabular-nums">{formatCurrency(Number(j.partner_cost) || 0)}</span>
        </p>
        <p>
          Mat. <span className="font-semibold tabular-nums">{formatCurrency(Number(j.materials_cost) || 0)}</span>
        </p>
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
