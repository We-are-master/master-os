"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Plus, Filter, Building, DollarSign, Briefcase, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Account } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import { listAccounts, createAccount } from "@/services/accounts";
import { getSupabase } from "@/services/base";

const INDUSTRY_OPTIONS = [
  { value: "Real Estate", label: "Real Estate" },
  { value: "Financial Services", label: "Financial Services" },
  { value: "Technology", label: "Technology" },
  { value: "Hospitality", label: "Hospitality" },
  { value: "Manufacturing", label: "Manufacturing" },
  { value: "Healthcare", label: "Healthcare" },
];

const PAYMENT_TERMS_OPTIONS = [
  { value: "Net 15", label: "Net 15" },
  { value: "Net 30", label: "Net 30" },
  { value: "Net 60", label: "Net 60" },
  { value: "Due on Receipt", label: "Due on Receipt" },
];

const statusConfig: Record<string, { label: string; variant: "success" | "info" | "default" }> = {
  active: { label: "Active", variant: "success" },
  onboarding: { label: "Onboarding", variant: "info" },
  inactive: { label: "Inactive", variant: "default" },
};

const emptyForm = {
  company_name: "",
  contact_name: "",
  email: "",
  industry: INDUSTRY_OPTIONS[0].value,
  credit_limit: "",
  payment_terms: PAYMENT_TERMS_OPTIONS[1].value,
};

export default function AccountsPage() {
  const {
    data,
    loading,
    page,
    totalPages,
    totalItems,
    setPage,
    search,
    setSearch,
    refresh,
  } = useSupabaseList<Account>({ fetcher: listAccounts, realtimeTable: "accounts" });

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();

  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalAccounts, setTotalAccounts] = useState(0);

  const loadKpis = useCallback(async () => {
    try {
      const { data: rows, error } = await getSupabase()
        .from("accounts")
        .select("total_revenue, active_jobs");
      if (error) throw error;
      const rows_ = rows ?? [];
      setTotalAccounts(rows_.length);
      setTotalRevenue(rows_.reduce((sum, r) => sum + (Number(r.total_revenue) || 0), 0));
      setTotalJobs(rows_.reduce((sum, r) => sum + (Number(r.active_jobs) || 0), 0));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load KPIs");
    }
  }, []);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  const avgDeal = totalAccounts > 0 ? Math.round(totalRevenue / totalAccounts) : 0;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    if (!form.company_name.trim() || !form.contact_name.trim() || !form.email.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAccount({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim(),
        industry: form.industry,
        status: "onboarding",
        credit_limit: Number(form.credit_limit) || 0,
        payment_terms: form.payment_terms,
      });
      setCreateOpen(false);
      setForm(emptyForm);
      toast.success(`Account "${created.company_name}" created.`);
      refresh();
      loadKpis();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSubmitting(false);
    }
  }

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("accounts").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} accounts updated to ${newStatus}`);
      setSelectedIds(new Set());
      refresh();
    } catch {
      toast.error("Failed to update accounts");
    }
  };

  const columns: Column<Account>[] = [
    {
      key: "company_name",
      label: "Company",
      render: (item) => (
        <div className="flex items-center gap-3">
          <Avatar name={item.company_name} size="md" />
          <div>
            <p className="text-sm font-semibold text-text-primary">{item.company_name}</p>
            <p className="text-[11px] text-text-tertiary">{item.contact_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: "industry",
      label: "Industry",
      render: (item) => (
        <span className="text-sm text-text-secondary">{item.industry}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (item) => {
        const config = statusConfig[item.status];
        return <Badge variant={config.variant} dot>{config.label}</Badge>;
      },
    },
    {
      key: "credit_limit",
      label: "Credit Limit",
      align: "right",
      render: (item) => (
        <span className="text-sm text-text-primary">{formatCurrency(item.credit_limit)}</span>
      ),
    },
    {
      key: "active_jobs",
      label: "Active Jobs",
      align: "center",
      render: (item) => (
        <span className="text-sm font-semibold text-text-primary">{item.active_jobs}</span>
      ),
    },
    {
      key: "total_revenue",
      label: "Total Revenue",
      align: "right",
      render: (item) => (
        <span className="text-sm font-bold text-text-primary">{formatCurrency(item.total_revenue)}</span>
      ),
    },
    {
      key: "payment_terms",
      label: "Terms",
      render: (item) => (
        <Badge variant="outline" size="sm">{item.payment_terms}</Badge>
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Accounts" subtitle="Manage corporate client accounts and billing.">
          <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Account</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Accounts" value={totalAccounts} format="number" change={8} changeLabel="this quarter" icon={Building} accent="blue" />
          <KpiCard title="Total Revenue" value={totalRevenue} format="currency" change={22.4} changeLabel="YoY growth" icon={DollarSign} accent="emerald" />
          <KpiCard title="Active Jobs" value={totalJobs} format="number" description="Across all accounts" icon={Briefcase} accent="primary" />
          <KpiCard title="Avg Deal Size" value={avgDeal} format="currency" change={14.2} changeLabel="vs last year" icon={TrendingUp} accent="purple" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-end mb-4">
            <SearchInput
              placeholder="Search accounts..."
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <DataTable
            columns={columns}
            data={data}
            getRowId={(item) => item.id}
            loading={loading}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={setPage}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            bulkActions={
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                <BulkBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                <BulkBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="danger" />
                <BulkBtn label="Onboarding" onClick={() => handleBulkStatusChange("onboarding")} variant="warning" />
              </div>
            }
          />
        </motion.div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Account" subtitle="Add a new corporate client account.">
        <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Company Name *</label>
              <Input
                value={form.company_name}
                onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Contact Name *</label>
              <Input
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Email *</label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="contact@company.com"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Industry"
              options={INDUSTRY_OPTIONS}
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
            />
            <Select
              label="Payment Terms"
              options={PAYMENT_TERMS_OPTIONS}
              value={form.payment_terms}
              onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Credit Limit</label>
            <Input
              type="number"
              value={form.credit_limit}
              onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))}
              placeholder="100000"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={submitting} icon={<Plus className="h-3.5 w-3.5" />}>
              {submitting ? "Creating…" : "Create Account"}
            </Button>
          </div>
        </form>
      </Modal>
    </PageTransition>
  );
}

function BulkBtn({ label, onClick, variant }: { label: string; onClick: () => void; variant: "success" | "danger" | "warning" | "default" }) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200",
    default: "text-text-primary bg-surface-hover hover:bg-surface-tertiary border-border",
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
