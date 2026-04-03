"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
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
import { Drawer } from "@/components/ui/drawer";
import { Tabs } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, Building, DollarSign, Briefcase, TrendingUp, Mail, User, Calendar,
  Receipt, Users, Loader2, Save, ExternalLink, Upload, Trash2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Account, Client, Job, Invoice } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import {
  listAccounts,
  createAccount,
  getAccount,
  updateAccount,
  listJobsLinkedToAccount,
  listClientsLinkedToAccountPaged,
  listInvoicesForJobReferences,
} from "@/services/accounts";
import { uploadAccountLogo, removeAccountLogoFromStorage } from "@/services/account-logo-storage";
import { uploadAccountContract, removeAccountContractFromStorage } from "@/services/account-contract-storage";
import { getSupabase } from "@/services/base";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";

const INDUSTRY_OPTIONS = [
  { value: "General", label: "General" },
  { value: "Real Estate", label: "Real Estate" },
  { value: "Financial Services", label: "Financial Services" },
  { value: "Technology", label: "Technology" },
  { value: "Hospitality", label: "Hospitality" },
  { value: "Manufacturing", label: "Manufacturing" },
  { value: "Healthcare", label: "Healthcare" },
];

const PAYMENT_TERMS_OPTIONS = [
  { value: "Net 7", label: "Net 7" },
  { value: "Net 15", label: "Net 15" },
  { value: "Net 30", label: "Net 30" },
  { value: "Net 60", label: "Net 60" },
  { value: "Due on Receipt", label: "Due on Receipt" },
  { value: "Every 7 days", label: "Every 7 days (weekly invoice)" },
  { value: "Every 15 days", label: "Every 15 days (weekly invoice)" },
  { value: "Every 30 days", label: "Every 30 days (weekly invoice)" },
  { value: "Every Friday", label: "Every Friday (weekly invoice)" },
  { value: "Every 2 weeks on Friday", label: "Every 2 weeks on Friday" },
  { value: "45 days", label: "45 days" },
];

const statusConfig: Record<string, { label: string; variant: "success" | "info" | "default" }> = {
  active: { label: "Active", variant: "success" },
  onboarding: { label: "Onboarding", variant: "info" },
  inactive: { label: "Inactive", variant: "default" },
};

const ACCOUNT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "inactive", label: "Inactive" },
];

function jobStatusBadge(status: string) {
  const variants: Record<string, "success" | "info" | "warning" | "danger" | "default" | "primary"> = {
    completed: "success",
    unassigned: "warning",
    scheduled: "info",
    in_progress_phase1: "primary",
    in_progress_phase2: "primary",
    in_progress_phase3: "primary",
    awaiting_payment: "danger",
    need_attention: "warning",
    final_check: "warning",
  };
  const v = variants[status] ?? "default";
  const label = status.replace(/_/g, " ");
  return (
    <Badge variant={v} size="sm" className="capitalize">
      {label}
    </Badge>
  );
}

function invoiceStatusBadge(status: string) {
  const v =
    status === "paid" ? "success" :
    status === "overdue" ? "danger" :
    status === "cancelled" ? "default" : "warning";
  return <Badge variant={v} size="sm">{status}</Badge>;
}

const emptyForm = {
  company_name: "",
  contact_name: "",
  email: "",
  address: "",
  crn: "",
  contact_number: "",
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
  useProfile();

  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalAccounts, setTotalAccounts] = useState(0);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
        address: form.address.trim() || null,
        crn: form.crn.trim() || null,
        contact_number: form.contact_number.trim() || null,
        industry: form.industry,
        status: "onboarding",
        credit_limit: Number(form.credit_limit) || 0,
        payment_terms: form.payment_terms,
        contract_url: null,
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

  const openAccountDetail = useCallback((row: Account) => {
    setSelectedAccount(row);
    setDetailLoading(true);
    getAccount(row.id)
      .then((fresh) => {
        if (fresh) setSelectedAccount(fresh);
        else {
          toast.error("Account not found");
          setSelectedAccount(null);
        }
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load account"))
      .finally(() => setDetailLoading(false));
  }, []);

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
          <Avatar name={item.company_name} size="md" src={item.logo_url ?? undefined} />
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
            onRowClick={openAccountDetail}
            selectedId={selectedAccount?.id}
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

      <AccountDetailDrawer
        account={selectedAccount}
        loading={detailLoading}
        onClose={() => setSelectedAccount(null)}
        statusConfig={statusConfig}
        onAccountUpdated={(a) => {
          setSelectedAccount(a);
          refresh();
          loadKpis();
        }}
      />

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

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Address</label>
            <Input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="123 High Street, London"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">CRN</label>
              <Input
                value={form.crn}
                onChange={(e) => setForm((f) => ({ ...f, crn: e.target.value }))}
                placeholder="Company registration number"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Contact Number</label>
              <Input
                value={form.contact_number}
                onChange={(e) => setForm((f) => ({ ...f, contact_number: e.target.value }))}
                placeholder="+44 7700 900123"
              />
            </div>
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
          <p className="text-xs text-text-tertiary">
            Contract upload is available after creating the account (inside the account drawer).
          </p>

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

function AccountDetailDrawer({
  account,
  loading,
  onClose,
  statusConfig: cfg,
  onAccountUpdated,
}: {
  account: Account | null;
  loading: boolean;
  onClose: () => void;
  statusConfig: typeof statusConfig;
  onAccountUpdated: (a: Account) => void;
}) {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState("overview");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(false);
  // Clients tab — paginated independently
  const [clientsRows, setClientsRows] = useState<Client[]>([]);
  const [clientsTotal, setClientsTotal] = useState(0);
  const [clientsPage, setClientsPage] = useState(0);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsUsedFallback, setClientsUsedFallback] = useState(false);
  const CLIENTS_PAGE_SIZE = 20;
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingContract, setUploadingContract] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const contractFileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    address: "",
    crn: "",
    contact_number: "",
    industry: "",
    status: "onboarding" as Account["status"],
    credit_limit: "",
    payment_terms: "",
    logo_url: "",
    contract_url: "",
  });

  useEffect(() => {
    if (!account) return;
    setEdit({
      company_name: account.company_name,
      contact_name: account.contact_name,
      email: account.email,
      address: account.address ?? "",
      crn: account.crn ?? "",
      contact_number: account.contact_number ?? "",
      industry: account.industry,
      status: account.status,
      credit_limit: String(account.credit_limit ?? 0),
      payment_terms: account.payment_terms,
      logo_url: account.logo_url ?? "",
      contract_url: account.contract_url ?? "",
    });
  }, [account]);

  useEffect(() => {
    if (!account?.id) return;
    setTab("overview");
  }, [account?.id]);

  // Load jobs & invoices independently
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setLoadingExtras(true);
    setJobs([]);
    setInvoices([]);
    (async () => {
      try {
        const jobList = await listJobsLinkedToAccount(account.id, account.company_name);
        if (cancelled) return;
        setJobs(jobList);
        const refs = jobList.map((j) => j.reference).filter(Boolean);
        if (refs.length > 0) {
          const inv = await listInvoicesForJobReferences(refs);
          if (!cancelled) setInvoices(inv);
        }
      } catch {
        // silent — jobs tab will show empty state
      } finally {
        if (!cancelled) setLoadingExtras(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load clients page (triggered by tab activation or page change)
  const loadClientsPage = useCallback(async (acct: Account, page: number) => {
    setClientsLoading(true);
    try {
      const { rows, total, usedFallback } = await listClientsLinkedToAccountPaged(
        acct.id,
        acct.company_name,
        page,
        CLIENTS_PAGE_SIZE,
      );
      setClientsRows(rows);
      setClientsTotal(total);
      setClientsUsedFallback(usedFallback);
      setClientsPage(page);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load clients");
    } finally {
      setClientsLoading(false);
    }
  }, []); // CLIENTS_PAGE_SIZE is a module-level constant, no runtime dep needed // eslint-disable-line react-hooks/exhaustive-deps

  // Load clients page eagerly when account opens (so count shows in header/tab badge immediately)
  // Also triggered when clients tab is activated for subsequent pages
  useEffect(() => {
    if (!account) {
      setClientsRows([]);
      setClientsTotal(0);
      setClientsPage(0);
      return;
    }
    loadClientsPage(account, 0);
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When clicking clients tab after already loaded, no extra fetch needed —
  // pagination controls inside the tab trigger loadClientsPage directly

  if (!account) {
    return <Drawer open={false} onClose={onClose}><div /></Drawer>;
  }

  const st = cfg[account.status] ?? cfg.onboarding;
  const outstandingInvoices = invoices
    .filter((i) => i.status !== "paid" && i.status !== "cancelled")
    .reduce((s, i) => s + Number(i.amount), 0);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !account || !isAdmin) return;
    setUploadingLogo(true);
    try {
      const url = await uploadAccountLogo(account.id, file);
      const updated = await updateAccount(account.id, { logo_url: url });
      const fresh = await getAccount(account.id);
      const next = fresh ?? updated;
      onAccountUpdated(next);
      setEdit((p) => ({ ...p, logo_url: url }));
      toast.success("Logo uploaded and saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!account || !isAdmin) return;
    setUploadingLogo(true);
    try {
      try {
        await removeAccountLogoFromStorage(account.id);
      } catch {
        /* folder may be empty or bucket missing */
      }
      const updated = await updateAccount(account.id, { logo_url: null });
      const fresh = await getAccount(account.id);
      const next = fresh ?? updated;
      onAccountUpdated(next);
      setEdit((p) => ({ ...p, logo_url: "" }));
      toast.success("Logo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    if (!edit.company_name.trim() || !edit.contact_name.trim() || !edit.email.trim()) {
      toast.error("Company, contact and email are required.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateAccount(account.id, {
        company_name: edit.company_name.trim(),
        contact_name: edit.contact_name.trim(),
        email: edit.email.trim(),
        address: edit.address.trim() || null,
        crn: edit.crn.trim() || null,
        contact_number: edit.contact_number.trim() || null,
        industry: edit.industry,
        status: edit.status,
        credit_limit: Number(edit.credit_limit) || 0,
        payment_terms: edit.payment_terms,
        logo_url: edit.logo_url.trim() || null,
        contract_url: edit.contract_url.trim() || null,
      });
      const fresh = await getAccount(account.id);
      const next = fresh ?? updated;
      onAccountUpdated(next);
      toast.success("Account updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={account.company_name}
      subtitle="Corporate account"
      width="w-[min(560px,calc(100vw-1rem))]"
    >
      <div className="px-4 sm:px-6 py-4 space-y-4">
        <div className="flex items-start gap-3">
          <Avatar name={account.company_name} size="lg" src={account.logo_url ?? undefined} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary truncate">{account.company_name}</p>
            <p className="text-xs text-text-tertiary truncate">{account.contact_name}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-text-tertiary">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {clientsTotal > 0 ? `${clientsTotal} client${clientsTotal !== 1 ? "s" : ""} linked` : "0 clients linked"}
              </span>
              <span className="text-border">·</span>
              <span>{jobs.length} job{jobs.length !== 1 ? "s" : ""}</span>
            </div>
            {(loading || loadingExtras) && (
              <p className="text-[11px] text-primary mt-1 inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Updating…
              </p>
            )}
          </div>
        </div>

        <Tabs
          variant="pills"
          className="w-full"
          activeTab={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "clients", label: "Clients", count: clientsTotal || undefined },
            { id: "jobs", label: "Jobs", count: jobs.length || undefined },
            { id: "finance", label: "Finance", count: invoices.length || undefined },
          ]}
        />

        {/* ── Clients tab ─────────────────────────────────────────── */}
        {tab === "clients" && (
          <div className="space-y-3">
            {clientsUsedFallback && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-400 flex items-center gap-2">
                <span>⚠</span>
                <span>These clients were matched by company name — link them properly by setting their Account field to <strong>{account.company_name}</strong>.</span>
              </div>
            )}
            {clientsLoading ? (
              <div className="flex items-center justify-center py-12 text-text-tertiary">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm">Loading clients…</span>
              </div>
            ) : clientsRows.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No clients linked to this account yet.</p>
                <p className="text-xs text-text-tertiary mt-1">Go to Clients and set their Account field to <strong>{account.company_name}</strong>.</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <div className="px-3 py-2 border-b border-border-light bg-surface-hover/40 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                      {clientsTotal} client{clientsTotal !== 1 ? "s" : ""}
                    </p>
                    <p className="text-[10px] text-text-tertiary">
                      Page {clientsPage + 1} of {Math.ceil(clientsTotal / CLIENTS_PAGE_SIZE)}
                    </p>
                  </div>
                  <ul className="divide-y divide-border-light">
                    {clientsRows.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/clients?clientId=${encodeURIComponent(c.id)}`}
                          className="flex items-center gap-3 px-3 py-3 hover:bg-surface-hover/60 transition-colors"
                        >
                          <Avatar name={c.full_name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text-primary truncate">{c.full_name}</p>
                            <p className="text-[11px] text-text-tertiary truncate">
                              {c.email || c.phone || c.address || "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {c.status && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                c.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-surface-hover text-text-tertiary"
                              }`}>
                                {c.status}
                              </span>
                            )}
                            <ExternalLink className="h-3.5 w-3.5 text-text-tertiary" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Pagination controls */}
                {Math.ceil(clientsTotal / CLIENTS_PAGE_SIZE) > 1 && (
                  <div className="flex items-center justify-between pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={clientsPage === 0 || clientsLoading}
                      onClick={() => loadClientsPage(account, clientsPage - 1)}
                    >
                      ← Previous
                    </Button>
                    <span className="text-xs text-text-tertiary">
                      {clientsPage * CLIENTS_PAGE_SIZE + 1}–{Math.min((clientsPage + 1) * CLIENTS_PAGE_SIZE, clientsTotal)} of {clientsTotal}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(clientsPage + 1) * CLIENTS_PAGE_SIZE >= clientsTotal || clientsLoading}
                      onClick={() => loadClientsPage(account, clientsPage + 1)}
                    >
                      Next →
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "overview" && (
          <div className="space-y-4">
            {isAdmin ? (
              <div className="rounded-xl border border-border-light bg-surface-hover/50 p-4 space-y-3">
                <p className="text-xs font-semibold text-text-secondary">Edit account</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Company</label>
                    <Input value={edit.company_name} onChange={(e) => setEdit((p) => ({ ...p, company_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Contact</label>
                    <Input value={edit.contact_name} onChange={(e) => setEdit((p) => ({ ...p, contact_name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Contract</label>
                  <input
                    ref={contractFileRef}
                    type="file"
                    accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={async (ev) => {
                      const file = ev.target.files?.[0];
                      ev.target.value = "";
                      if (!file || !account || !isAdmin) return;
                      setUploadingContract(true);
                      try {
                        const url = await uploadAccountContract(account.id, file);
                        const updated = await updateAccount(account.id, { contract_url: url });
                        const fresh = await getAccount(account.id);
                        const next = fresh ?? updated;
                        onAccountUpdated(next);
                        setEdit((p) => ({ ...p, contract_url: url }));
                        toast.success("Contract uploaded and saved");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Contract upload failed");
                      } finally {
                        setUploadingContract(false);
                      }
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingContract || saving}
                      onClick={() => contractFileRef.current?.click()}
                      icon={
                        uploadingContract ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )
                      }
                    >
                      {uploadingContract ? "Uploading…" : "Upload contract"}
                    </Button>
                    {edit.contract_url.trim() && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(edit.contract_url, "_blank", "noopener,noreferrer")}
                          icon={<ExternalLink className="h-3.5 w-3.5" />}
                        >
                          Preview
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={uploadingContract || saving}
                          onClick={async () => {
                            if (!account || !isAdmin) return;
                            setUploadingContract(true);
                            try {
                              try {
                                await removeAccountContractFromStorage(account.id);
                              } catch {
                                /* ignore storage cleanup issue, still clear DB value */
                              }
                              const updated = await updateAccount(account.id, { contract_url: null });
                              const fresh = await getAccount(account.id);
                              const next = fresh ?? updated;
                              onAccountUpdated(next);
                              setEdit((p) => ({ ...p, contract_url: "" }));
                              toast.success("Contract removed");
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed to remove contract");
                            } finally {
                              setUploadingContract(false);
                            }
                          }}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1.5">
                    Saves to bucket <code className="text-[10px]">company-assets</code> at <code className="text-[10px]">accounts/&lt;id&gt;/contract.*</code> (PDF/DOC/DOCX, max 10 MB).
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Email</label>
                  <Input type="email" value={edit.email} onChange={(e) => setEdit((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Address</label>
                  <Input value={edit.address} onChange={(e) => setEdit((p) => ({ ...p, address: e.target.value }))} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">CRN</label>
                    <Input value={edit.crn} onChange={(e) => setEdit((p) => ({ ...p, crn: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Contact number</label>
                    <Input value={edit.contact_number} onChange={(e) => setEdit((p) => ({ ...p, contact_number: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Logo</label>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    onChange={(ev) => void handleLogoUpload(ev)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingLogo || saving}
                      onClick={() => logoFileRef.current?.click()}
                      icon={
                        uploadingLogo ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )
                      }
                    >
                      {uploadingLogo ? "Uploading…" : "Upload to bucket"}
                    </Button>
                    {(edit.logo_url.trim() || account.logo_url) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingLogo || saving}
                        onClick={() => void handleRemoveLogo()}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1.5 mb-2">
                    Saves to bucket <code className="text-[10px]">company-assets</code> at{" "}
                    <code className="text-[10px]">accounts/&lt;id&gt;/logo.*</code> and updates this account. Max 5&nbsp;MB. You can also paste an external URL below.
                  </p>
                  <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Logo image URL (optional)</label>
                  <Input
                    value={edit.logo_url}
                    onChange={(e) => setEdit((p) => ({ ...p, logo_url: e.target.value }))}
                    placeholder="https://example.com/logo.png"
                  />
                  {(edit.logo_url.trim() || account.logo_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(edit.logo_url.trim() || account.logo_url) ?? ""}
                      alt=""
                      className="mt-2 h-14 max-w-full object-contain rounded-lg border border-border-light bg-card p-1"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select
                    label="Industry"
                    options={INDUSTRY_OPTIONS}
                    value={edit.industry}
                    onChange={(e) => setEdit((p) => ({ ...p, industry: e.target.value }))}
                  />
                  <Select
                    label="Status"
                    options={ACCOUNT_STATUS_OPTIONS}
                    value={edit.status}
                    onChange={(e) => setEdit((p) => ({ ...p, status: e.target.value as Account["status"] }))}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select
                    label="Payment terms"
                    options={PAYMENT_TERMS_OPTIONS}
                    value={edit.payment_terms}
                    onChange={(e) => setEdit((p) => ({ ...p, payment_terms: e.target.value }))}
                  />
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Credit limit</label>
                    <Input
                      type="number"
                      min={0}
                      value={edit.credit_limit}
                      onChange={(e) => setEdit((p) => ({ ...p, credit_limit: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void handleSave()}
                    icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border-light bg-surface-hover/50 divide-y divide-border-light">
                <DetailRow icon={User} label="Contact">{account.contact_name}</DetailRow>
                <DetailRow icon={Mail} label="Email">
                  <a href={`mailto:${account.email}`} className="text-primary hover:underline break-all">{account.email}</a>
                </DetailRow>
                <DetailRow label="Contact number">{account.contact_number || "—"}</DetailRow>
                <DetailRow label="CRN">{account.crn || "—"}</DetailRow>
                <DetailRow label="Address">{account.address || "—"}</DetailRow>
                <DetailRow icon={Building} label="Industry">{account.industry}</DetailRow>
                <DetailRow label="Status"><Badge variant={st.variant} dot>{st.label}</Badge></DetailRow>
              </div>
            )}

            <div className="rounded-xl border border-border-light bg-surface-hover/30 p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Read-only (from system)</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] text-text-tertiary uppercase">Active jobs</p>
                  <p className="font-semibold tabular-nums">{account.active_jobs}</p>
                </div>
                <div>
                  <p className="text-[10px] text-text-tertiary uppercase">Total revenue</p>
                  <p className="font-bold tabular-nums text-text-primary">{formatCurrency(account.total_revenue)}</p>
                </div>
              </div>
              <DetailRow icon={Calendar} label="Created">
                {new Date(account.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </DetailRow>
            </div>
          </div>
        )}

        {tab === "jobs" && (
          <div className="space-y-2">
            {loadingExtras ? (
              <div className="flex justify-center py-10 text-text-tertiary text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-8">No jobs linked yet. Link clients to this account under Clients, then create jobs for those clients.</p>
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden max-h-[50vh] overflow-y-auto">
                {jobs.map((j) => {
                  const schedLine = formatJobScheduleLine(j);
                  return (
                  <Link
                    key={j.id}
                    href={`/jobs/${j.id}`}
                    className="flex items-start gap-3 px-3 py-3 border-b border-border-light last:border-0 hover:bg-surface-hover transition-colors"
                  >
                    <Briefcase className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">{j.reference}</span>
                        {jobStatusBadge(j.status)}
                        <Badge variant="outline" size="sm">{j.finance_status}</Badge>
                      </div>
                      <p className="text-xs text-text-secondary truncate">{j.title}</p>
                      <p className="text-[11px] text-text-tertiary truncate">{j.client_name} · {j.property_address}</p>
                      {schedLine ? (
                        <p className="text-[10px] text-text-secondary mt-1 leading-snug line-clamp-2">{schedLine}</p>
                      ) : (
                        <p className="text-[10px] text-text-tertiary mt-1">No schedule set</p>
                      )}
                      <p className="text-xs font-medium text-text-primary mt-1">{formatCurrency(j.client_price)}</p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-text-tertiary shrink-0" />
                  </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "finance" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Credit limit</p>
                <p className="text-lg font-bold tabular-nums">{formatCurrency(account.credit_limit)}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Terms</p>
                <p className="text-sm font-semibold mt-1">{account.payment_terms}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Total revenue (account)</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(account.total_revenue)}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Open invoices</p>
                <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(outstandingInvoices)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-secondary flex items-center gap-2">
                <Receipt className="h-3.5 w-3.5" />
                Invoices linked to jobs above
              </p>
              <Link href="/finance/invoices" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                All invoices <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            {loadingExtras ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-text-tertiary" /></div>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-6">No invoices found for jobs under this account.</p>
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden max-h-[40vh] overflow-y-auto">
                {invoices.map((inv) => (
                  <div key={inv.id} className="px-3 py-3 border-b border-border-light last:border-0 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">{inv.reference}</span>
                        {invoiceStatusBadge(inv.status)}
                      </div>
                      <p className="text-[11px] text-text-tertiary">{inv.client_name}{inv.job_reference ? ` · ${inv.job_reference}` : ""}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">Due {new Date(inv.due_date).toLocaleDateString()}</p>
                    </div>
                    <p className="text-sm font-bold tabular-nums shrink-0">{formatCurrency(inv.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-4 py-3">
      {Icon ? <Icon className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" /> : <span className="w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
        <div className="text-sm text-text-primary mt-1">{children}</div>
      </div>
    </div>
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
