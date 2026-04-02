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
  FileText,
  CheckCircle2,
  ExternalLink,
  LayoutGrid,
  List,
  Pencil,
  XCircle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
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
  accumulating: { label: "Ongoing", variant: "primary" },
  pending_review: { label: "Review and Approve", variant: "warning" },
  needs_attention: { label: "Needs attention", variant: "danger" },
  awaiting_payment: { label: "Awaiting payment", variant: "warning" },
  ready_to_pay: { label: "Ready to Pay", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  audit_required: { label: "Audit required", variant: "danger" },
  rejected: { label: "Rejected", variant: "default" },
};

const TAB_ORDER = [
  "all",
  "audit_required",
  "accumulating",
  "pending_review",
  "ready_to_pay",
  "paid",
  "rejected",
] as const;

type SelfBillTab = (typeof TAB_ORDER)[number];

type JobLine = Pick<Job, "id" | "reference" | "title" | "partner_cost" | "materials_cost" | "status" | "property_address" | "self_bill_id">;

function countByStatus(rows: SelfBill[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const sb of rows) {
    m[sb.status] = (m[sb.status] ?? 0) + 1;
  }
  return m;
}

export default function SelfBillPage() {
  const [activeTab, setActiveTab] = useState<SelfBillTab>("accumulating");
  const [layoutMode, setLayoutMode] = useState<"cards" | "table">("table");
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("all");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [jobsModal, setJobsModal] = useState<{ selfBill: SelfBill; jobs: Awaited<ReturnType<typeof listJobsForSelfBill>> } | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsBySelfBillId, setJobsBySelfBillId] = useState<Record<string, JobLine[]>>({});
  const [editSelfBill, setEditSelfBill] = useState<SelfBill | null>(null);
  const [editForm, setEditForm] = useState({ job_value: "", materials: "", commission: "" });
  const [savingEdit, setSavingEdit] = useState(false);

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

  const statusCounts = useMemo(() => countByStatus(selfBills), [selfBills]);

  const filtered = useMemo(() => {
    let result = selfBills;
    if (activeTab !== "all") {
      result = result.filter((sb) => sb.status === activeTab);
    }
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

  useEffect(() => {
    let cancelled = false;
    const ids = filtered.map((sb) => sb.id);
    if (ids.length === 0) {
      setJobsBySelfBillId({});
      return;
    }
    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("jobs")
        .select("id, reference, title, partner_cost, materials_cost, status, property_address, self_bill_id")
        .in("self_bill_id", ids)
        .is("deleted_at", null)
        .order("reference", { ascending: true });
      if (cancelled || error) return;
      const map: Record<string, JobLine[]> = {};
      for (const j of (data ?? []) as JobLine[]) {
        const sid = j.self_bill_id as string;
        if (!map[sid]) map[sid] = [];
        map[sid].push(j);
      }
      setJobsBySelfBillId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );

  const totals = useMemo(() => {
    const all = selfBills;
    return {
      totalPayouts: all.reduce((s, sb) => s + Number(sb.net_payout), 0),
      paidCount: all.filter((sb) => sb.status === "paid").length,
      readyCount: all.filter((sb) => sb.status === "ready_to_pay").length,
      reviewCount: all.filter((sb) => sb.status === "pending_review").length,
      ongoingCount: all.filter((sb) => sb.status === "accumulating").length,
      auditCount: all.filter((sb) => sb.status === "audit_required").length,
    };
  }, [selfBills]);

  const updateSelfBillStatus = async (id: string, newStatus: string) => {
    const supabase = getSupabase();
    const { error } = await supabase.from("self_bills").update({ status: newStatus }).eq("id", id);
    if (error) throw error;
  };

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

  const tabs = useMemo(
    () =>
      TAB_ORDER.map((id) => ({
        id,
        label:
          id === "all"
            ? "All"
            : id === "audit_required"
              ? "Audit required"
              : id === "accumulating"
                ? "Ongoing"
                : id === "pending_review"
                  ? "Review and Approve"
                  : id === "ready_to_pay"
                    ? "Ready to Pay"
                    : id === "paid"
                      ? "Paid"
                      : "Rejected",
        count: id === "all" ? selfBills.length : statusCounts[id] ?? 0,
      })),
    [selfBills.length, statusCounts]
  );

  const columns: Column<SelfBill>[] = [
    {
      key: "reference",
      label: "Self fill",
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
            <p className="text-sm font-medium text-text-primary truncate">{item.partner_name}</p>
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
      key: "job_value",
      label: "Labour",
      align: "right",
      render: (item) => <span className="text-sm tabular-nums text-text-primary">{formatCurrency(item.job_value)}</span>,
    },
    {
      key: "materials",
      label: "Materials",
      align: "right",
      render: (item) => <span className="text-sm tabular-nums text-text-secondary">{formatCurrency(item.materials)}</span>,
    },
    {
      key: "jobs_count",
      label: "Jobs",
      align: "center",
      width: "72px",
      render: (item) => (
        <button
          type="button"
          className="text-sm font-semibold text-primary hover:underline tabular-nums"
          onClick={(e) => {
            e.stopPropagation();
            void openJobsModal(item);
          }}
        >
          {item.jobs_count}
        </button>
      ),
    },
    {
      key: "net_payout",
      label: "Net payout",
      align: "right",
      width: "100px",
      render: (item) => <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(item.net_payout)}</span>,
    },
    {
      key: "status",
      label: "Status",
      minWidth: "140px",
      render: (item) => {
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
          title="Partner self-billing"
          subtitle={`Weekly partner payouts. Current week stays in Ongoing until Sunday 23:59; then it moves to Review and Approve. ${weekPeriodHelpText()}`}
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
            title="Ongoing (this week open)"
            value={totals.ongoingCount}
            format="number"
            description={`Mon–Sun bucket · ${kpiPeriodDesc}`}
            icon={Users}
            accent="amber"
          />
          <KpiCard
            title="Review and Approve"
            value={totals.reviewCount}
            format="number"
            description={`After week closes · ${kpiPeriodDesc}`}
            icon={Users}
            accent="purple"
          />
          <KpiCard
            title="Ready / paid"
            value={totals.readyCount + totals.paidCount}
            format="number"
            description={`Pay run marks paid here too · ${kpiPeriodDesc}`}
            icon={DollarSign}
            accent="emerald"
          />
        </StaggerContainer>

        <div className="rounded-xl border border-border-light bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong className="text-text-primary">Audit required</strong> only when a complaint is logged (e.g. email).{" "}
              <span className="text-text-tertiary">({totals.auditCount} in period)</span>
            </span>
          </div>
          <Link href="/finance/pay-run" className="text-xs font-semibold text-primary hover:underline">
            Open pay run →
          </Link>
        </div>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as SelfBillTab)} />
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <SearchInput placeholder="Search partner, ref, week…" className="w-52 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-hover" title="Layout">
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
              tableClassName="min-w-[1100px]"
              bulkActions={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  {activeTab === "pending_review" && (
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
  onApprove,
  onReject,
  onEdit,
  onOpenJobs,
}: {
  sb: SelfBill;
  jobs: Pick<Job, "id" | "reference" | "title" | "partner_cost" | "materials_cost" | "status" | "property_address">[];
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onOpenJobs: () => void;
}) {
  const cfg = statusConfig[sb.status] ?? { label: sb.status, variant: "default" as const };
  const review = sb.status === "pending_review";

  return (
    <div className="rounded-2xl border border-border-light bg-card shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border-light bg-surface-hover/40 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={sb.partner_name} size="md" className="shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{sb.partner_name}</p>
            <p className="text-[11px] text-text-tertiary font-mono truncate">
              {sb.reference} · {sb.week_label ?? sb.period}
            </p>
          </div>
        </div>
        <Badge variant={cfg.variant} dot size="sm">
          {cfg.label}
        </Badge>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center border-b border-border-light/80 bg-background/50">
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Labour</p>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(sb.job_value)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Materials</p>
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
      </div>

      <div className="px-4 py-3 space-y-0.5 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Linked jobs</p>
        {jobs.length === 0 ? (
          <p className="text-xs text-text-tertiary py-2">No jobs linked yet.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-light/80 bg-surface-hover/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
                    {j.reference}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </Link>
                  <p className="text-[11px] text-text-secondary truncate">{j.title}</p>
                </div>
                <div className="text-right text-[11px] tabular-nums space-y-0.5">
                  <p>
                    L {formatCurrency(Number(j.partner_cost) || 0)} · M {formatCurrency(Number(j.materials_cost) || 0)}
                  </p>
                  <Badge variant="default" size="sm" className="text-[9px]">
                    {j.status}
                  </Badge>
                </div>
              </div>
            ))}
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
}: {
  sb: SelfBill;
  jobs: Awaited<ReturnType<typeof listJobsForSelfBill>>;
  loadingJobs: boolean;
}) {
  const cfg = statusConfig[sb.status] ?? { label: sb.status, variant: "default" as const };

  return (
    <div className="p-6">
      <div className="rounded-xl border border-border-light bg-card shadow-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-border-light bg-surface-hover/50 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={sb.partner_name} size="md" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{sb.partner_name}</p>
              <p className="text-[11px] text-text-tertiary">
                Created {formatDate(sb.created_at)}
                {sb.week_label ? ` · ${sb.week_label}` : null}
              </p>
            </div>
          </div>
          <Badge variant={cfg.variant} dot size="sm">
            {cfg.label}
          </Badge>
        </div>

        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-border-light/80 text-center sm:text-left">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Labour</p>
            <p className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(sb.job_value)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Materials</p>
            <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(sb.materials)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Jobs</p>
            <p className="text-sm font-semibold tabular-nums text-text-primary">{sb.jobs_count}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Net payout</p>
            <p className="text-sm font-bold tabular-nums text-text-primary">{formatCurrency(sb.net_payout)}</p>
          </div>
        </div>

        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Linked jobs</p>
          {loadingJobs ? (
            <div className="space-y-2">
              <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
              <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-text-tertiary py-2">No jobs linked to this self-bill.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <JobRow key={j.id} j={j} />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-light bg-surface-hover/30 flex justify-end">
          <a
            href={`/api/self-bills/${encodeURIComponent(sb.id)}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            Open PDF
          </a>
        </div>
      </div>
    </div>
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
