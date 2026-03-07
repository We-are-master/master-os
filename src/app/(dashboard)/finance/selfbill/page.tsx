"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/input";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Download, Filter, Wallet, DollarSign, Users, Clock, Play } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { SelfBill } from "@/types/database";
import { getSupabase } from "@/services/base";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  payment_sent: { label: "Payment Sent", variant: "success" },
  generated: { label: "Generated", variant: "info" },
  audit_required: { label: "Audit Required", variant: "warning" },
};

export default function SelfBillPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    try {
      const { data, error } = await supabase.from("self_bills").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setSelfBills((data ?? []) as SelfBill[]);
    } catch { toast.error("Failed to load self-bills"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let result = selfBills;
    if (activeTab !== "all") result = result.filter((sb) => sb.status === activeTab);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((sb) => sb.partner_name.toLowerCase().includes(q) || sb.reference.toLowerCase().includes(q));
    }
    return result;
  }, [selfBills, activeTab, search]);

  const totals = useMemo(() => {
    const all = selfBills;
    return {
      totalPayouts: all.reduce((s, sb) => s + Number(sb.net_payout), 0),
      totalCommission: all.reduce((s, sb) => s + Number(sb.commission), 0),
      totalJobValue: all.reduce((s, sb) => s + Number(sb.job_value), 0),
      totalMaterials: all.reduce((s, sb) => s + Number(sb.materials), 0),
      paidCount: all.filter((sb) => sb.status === "payment_sent").length,
      pendingCount: all.filter((sb) => sb.status === "generated").length,
      auditCount: all.filter((sb) => sb.status === "audit_required").length,
    };
  }, [selfBills]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("self_bills").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} self-bills updated to ${newStatus.replace("_", " ")}`);
      setSelectedIds(new Set());
      loadData();
    } catch { toast.error("Failed to update self-bills"); }
  };

  const tabs = [
    { id: "all", label: "All", count: selfBills.length },
    { id: "payment_sent", label: "Paid", count: selfBills.filter((sb) => sb.status === "payment_sent").length },
    { id: "generated", label: "Generated", count: selfBills.filter((sb) => sb.status === "generated").length },
    { id: "audit_required", label: "Audit Required", count: selfBills.filter((sb) => sb.status === "audit_required").length },
  ];

  const columns: Column<SelfBill>[] = [
    {
      key: "partner_name", label: "Partner",
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={item.partner_name} size="sm" />
          <div>
            <p className="text-sm font-medium text-text-primary">{item.partner_name}</p>
            <p className="text-[11px] text-text-tertiary">{item.reference} — {item.period}</p>
          </div>
        </div>
      ),
    },
    {
      key: "jobs_count", label: "Jobs", align: "center",
      render: (item) => <span className="text-sm font-semibold text-text-primary">{item.jobs_count}</span>,
    },
    {
      key: "job_value", label: "Job Value", align: "right",
      render: (item) => <span className="text-sm text-text-primary">{formatCurrency(item.job_value)}</span>,
    },
    {
      key: "materials", label: "Materials", align: "right",
      render: (item) => <span className="text-sm text-text-secondary">{formatCurrency(item.materials)}</span>,
    },
    {
      key: "commission", label: "Commission", align: "right",
      render: (item) => <span className="text-sm text-red-500 font-medium">-{formatCurrency(item.commission)}</span>,
    },
    {
      key: "net_payout", label: "Net Payout", align: "right",
      render: (item) => <span className="text-sm font-bold text-text-primary">{formatCurrency(item.net_payout)}</span>,
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const config = statusConfig[item.status];
        return <Badge variant={config?.variant ?? "default"} dot>{config?.label ?? item.status}</Badge>;
      },
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Partner Self-billing" subtitle="Weekly partner payouts and commission management.">
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />}>Export CSV</Button>
          <Button size="sm" icon={<Play className="h-3.5 w-3.5" />}>Generate Weekly Batch</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Payouts" value={totals.totalPayouts} format="currency" icon={Wallet} accent="primary" />
          <KpiCard title="Commissions Earned" value={totals.totalCommission} format="currency" icon={DollarSign} accent="emerald" />
          <KpiCard title="Partners Paid" value={totals.paidCount} format="number" description={`of ${selfBills.length} total`} icon={Users} accent="blue" />
          <KpiCard title="Pending Bills" value={totals.pendingCount} format="number" description={`${totals.auditCount} require audit`} icon={Clock} accent="amber" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            <div className="flex items-center gap-2">
              <SearchInput placeholder="Search self-bills..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
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
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                <BulkBtn label="Mark Paid" onClick={() => handleBulkStatusChange("payment_sent")} variant="success" />
                <BulkBtn label="Require Audit" onClick={() => handleBulkStatusChange("audit_required")} variant="warning" />
                <BulkBtn label="Reset to Generated" onClick={() => handleBulkStatusChange("generated")} variant="default" />
              </div>
            }
          />

          <div className="mt-4 p-4 bg-card rounded-xl border border-border-light shadow-soft">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Total Job Value</p>
                  <p className="text-lg font-bold text-text-primary">{formatCurrency(totals.totalJobValue)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Total Materials</p>
                  <p className="text-lg font-bold text-text-primary">{formatCurrency(totals.totalMaterials)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Total Commission</p>
                  <p className="text-lg font-bold text-emerald-600">{formatCurrency(totals.totalCommission)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Total Net Payouts</p>
                  <p className="text-lg font-bold text-text-primary">{formatCurrency(totals.totalPayouts)}</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </PageTransition>
  );
}

function BulkBtn({ label, onClick, variant }: { label: string; onClick: () => void; variant: "success" | "danger" | "warning" | "default" }) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border-amber-200",
    default: "text-text-primary bg-surface-hover hover:bg-surface-tertiary border-border",
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
