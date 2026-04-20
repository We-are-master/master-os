"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  Plus, Building, DollarSign, Briefcase, TrendingUp, Mail, User, Calendar,
  Receipt, Users, Loader2, Save, ExternalLink, Upload, Trash2, Archive,
  Info,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";
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
import { getSupabase, getStatusCounts } from "@/services/base";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";
import { findDuplicateAccountHints, formatAccountDuplicateLines } from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { BusinessUnitSelect } from "@/components/ui/business-unit-select";
import { listActiveAssignableUsers, type AssignableUser } from "@/services/profiles";
import { jobStatusBadgeVariant, type JobsManagementTabAccent } from "@/lib/job-status-ui";

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
  { value: "Due on Receipt",          label: "Due on Receipt" },
  { value: "Net 7",                   label: "Net 7" },
  { value: "Net 15",                  label: "Net 15" },
  { value: "Net 30",                  label: "Net 30" },
  { value: "Net 45",                  label: "Net 45" },
  { value: "Net 60",                  label: "Net 60" },
  { value: "Every 7 days",            label: "Every 7 days" },
  { value: "Every 15 days",           label: "Every 15 days" },
  { value: "Every 30 days",           label: "Every 30 days" },
  { value: "Every Friday",            label: "Every Friday" },
  { value: "Every 2 weeks on Friday", label: "Every 2 weeks on Friday" },
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

/** Display name for account owner: resolve `account_owner_id` → profiles list; optional legacy `owner_name` if present. */
function accountOwnerLabel(
  accountOwnerId: string | null | undefined,
  legacyOwnerName: string | null | undefined,
  users: AssignableUser[],
): string {
  const id = accountOwnerId?.trim();
  if (id) {
    const u = users.find((x) => x.id === id);
    if (u?.full_name?.trim()) return u.full_name.trim();
    if (u?.email?.trim()) return u.email.trim();
  }
  const leg = legacyOwnerName?.trim();
  if (leg) return leg;
  return "—";
}

function jobStatusBadge(status: string) {
  const v = jobStatusBadgeVariant(status);
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
  account_owner_id: "",
  email: "",
  finance_email: "",
  address: "",
  crn: "",
  contact_number: "",
  industry: INDUSTRY_OPTIONS[0].value,
  credit_limit: "",
  payment_terms: PAYMENT_TERMS_OPTIONS[1].value,
  bu_id: "" as string,
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
    status,
    setStatus,
    refresh,
  } = useSupabaseList<Account>({
    fetcher: listAccounts,
    realtimeTable: "accounts",
    initialStatus: "active",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [createAssignableUsers, setCreateAssignableUsers] = useState<AssignableUser[]>([]);
  /** Resolve account_owner_id → name in the main table (same directory as job/account owner pickers). */
  const [accountOwnerDirectory, setAccountOwnerDirectory] = useState<AssignableUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const { confirmDespiteDuplicates } = useDuplicateConfirm();

  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [accountStatusCounts, setAccountStatusCounts] = useState<Record<string, number>>({});

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadKpis = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [{ data: rows, error }, counts] = await Promise.all([
        supabase.from("accounts").select("total_revenue, active_jobs").is("deleted_at", null),
        getStatusCounts("accounts", ["active", "onboarding", "inactive"], "status"),
      ]);
      if (error) throw error;
      const rows_ = rows ?? [];
      setTotalAccounts(rows_.length);
      setTotalRevenue(rows_.reduce((sum, r) => sum + (Number(r.total_revenue) || 0), 0));
      setTotalJobs(rows_.reduce((sum, r) => sum + (Number(r.active_jobs) || 0), 0));
      setAccountStatusCounts(counts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load KPIs");
    }
  }, []);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    void listActiveAssignableUsers().then(setAccountOwnerDirectory).catch(() => setAccountOwnerDirectory([]));
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    void listActiveAssignableUsers().then(setCreateAssignableUsers).catch(() => setCreateAssignableUsers([]));
  }, [createOpen]);

  const avgDeal = totalAccounts > 0 ? Math.round(totalRevenue / totalAccounts) : 0;

  const handleSyncDueDates = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/invoices/recalculate-due-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await res.json().catch(() => ({})) as { updated?: number; sameDate?: number; noAccount?: number; error?: string; debug?: Record<string, number> };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      console.info("[sync-due-dates] result:", json.debug);
      const parts = [];
      if ((json.sameDate ?? 0) > 0) parts.push(`${json.sameDate} already correct`);
      if ((json.noAccount ?? 0) > 0) parts.push(`${json.noAccount} no account/terms`);
      const detail = parts.length ? ` · ${parts.join(" · ")}` : "";
      toast.success(`Updated ${json.updated ?? 0} invoice${(json.updated ?? 0) !== 1 ? "s" : ""}${detail}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      setSyncOpen(false);
    }
  };

  const accountListTabs = useMemo(
    () =>
      [
        {
          id: "all",
          label: "All",
          count: accountStatusCounts.all ?? 0,
          accent: "neutral" as JobsManagementTabAccent,
        },
        {
          id: "onboarding",
          label: "Onboarding",
          count: accountStatusCounts.onboarding ?? 0,
          accent: "amber" as JobsManagementTabAccent,
        },
        {
          id: "active",
          label: "Active",
          count: accountStatusCounts.active ?? 0,
          accent: "green" as JobsManagementTabAccent,
        },
        {
          id: "inactive",
          label: "Inactive",
          count: accountStatusCounts.inactive ?? 0,
          accent: "slate" as JobsManagementTabAccent,
        },
      ] as const,
    [accountStatusCounts],
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    if (!form.company_name.trim() || !form.contact_name.trim() || !form.email.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    const accHints = await findDuplicateAccountHints({
      companyName: form.company_name.trim(),
      email: form.email.trim(),
    });
    if (!(await confirmDespiteDuplicates(formatAccountDuplicateLines(accHints)))) return;

    setSubmitting(true);
    try {
      const ownerId = form.account_owner_id.trim();
      const created = await createAccount({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        account_owner_id: ownerId || null,
        email: form.email.trim(),
        finance_email: form.finance_email.trim() || null,
        address: form.address.trim() || null,
        crn: form.crn.trim() || null,
        contact_number: form.contact_number.trim() || null,
        industry: form.industry,
        status: "onboarding",
        credit_limit: Number(form.credit_limit) || 0,
        payment_terms: form.payment_terms,
        bu_id: form.bu_id || null,
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
      void loadKpis();
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
      key: "owner_name",
      label: "Account owner",
      render: (item) => (
        <span className="text-sm text-text-secondary">
          {accountOwnerLabel(item.account_owner_id, item.owner_name, accountOwnerDirectory)}
        </span>
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
        const config = statusConfig[item.status] ?? statusConfig.inactive;
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
      render: (item) => {
        const label = shortenPaymentTerms(item.payment_terms);
        return <Badge variant="outline" size="sm" className="max-w-[7rem] truncate block">{label}</Badge>;
      },
    },
    {
      key: "next_payment",
      label: "Next payment",
      render: (item) => {
        if (!item.payment_terms) return <span className="text-text-tertiary text-xs">—</span>;
        const iso = dueDateIsoFromPaymentTerms(new Date(), item.payment_terms);
        const d = new Date(iso + "T12:00:00");
        const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        const isOverdue = d < new Date();
        return (
          <span className={cn("text-xs font-medium tabular-nums", isOverdue ? "text-red-500" : "text-text-primary")}>
            {label}
          </span>
        );
      },
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Accounts" subtitle="Manage corporate client accounts and billing.">
          {isAdmin && (
            <Button size="sm" variant="outline" icon={<Receipt className="h-3.5 w-3.5" />} onClick={() => setSyncOpen(true)}>
              Sync due dates
            </Button>
          )}
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Account</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Accounts" value={totalAccounts} format="number" change={8} changeLabel="this quarter" icon={Building} accent="blue" />
          <KpiCard title="Total Revenue" value={totalRevenue} format="currency" change={22.4} changeLabel="YoY growth" icon={DollarSign} accent="emerald" />
          <KpiCard title="Active Jobs" value={totalJobs} format="number" description="Across all accounts" icon={Briefcase} accent="primary" />
          <KpiCard title="Avg Deal Size" value={avgDeal} format="currency" change={14.2} changeLabel="vs last year" icon={TrendingUp} accent="purple" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 pb-1 -mb-1 overflow-x-auto">
              <Tabs
                tabs={accountListTabs.map(({ id, label, count, accent }) => ({ id, label, count, accent }))}
                activeTab={status}
                onChange={setStatus}
              />
            </div>
            <SearchInput
              placeholder="Search accounts..."
              className="w-full min-w-[10rem] sm:w-56 shrink-0"
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

      {/* ── Sync due dates confirmation ───────────────────────────── */}
      <Modal open={syncOpen} onClose={() => !syncing && setSyncOpen(false)} title="Sync invoice due dates" size="sm">
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-text-secondary">
            This will recalculate the <strong>due date</strong> of all unpaid invoices using each job&apos;s scheduled date + the linked account&apos;s payment terms.
          </p>
          <ul className="text-xs text-text-tertiary space-y-1 pl-3 list-disc">
            <li>Only affects invoices with status <strong>draft, pending, overdue</strong></li>
            <li>Invoices with no linked job or no payment terms are skipped</li>
            <li>Paid and cancelled invoices are never touched</li>
          </ul>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setSyncOpen(false)} disabled={syncing}>Cancel</Button>
            <Button size="sm" disabled={syncing} onClick={() => void handleSyncDueDates()}
              icon={syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            >
              {syncing ? "Updating…" : "Update all invoices"}
            </Button>
          </div>
        </div>
      </Modal>

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
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Account owner</label>
            <JobOwnerSelect
              value={form.account_owner_id || undefined}
              users={createAssignableUsers}
              emptyLabel="Select internal owner (optional)"
              onChange={(id) =>
                setForm((f) => ({
                  ...f,
                  account_owner_id: id ?? "",
                }))
              }
            />
            <p className="text-[10px] text-text-tertiary mt-1">
              Active users on the platform (sales / AM) — same idea as job owner, used for dashboards.
            </p>
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
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Finance Email (Invoices)</label>
            <Input
              type="email"
              value={form.finance_email}
              onChange={(e) => setForm((f) => ({ ...f, finance_email: e.target.value }))}
              placeholder="finance@company.com"
            />
            <p className="text-[10px] text-text-tertiary mt-1">
              Optional. Used when billing/invoice contact differs from the main account email.
            </p>
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

          <div>
            <Select
              label="Industry"
              options={INDUSTRY_OPTIONS}
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Payment Terms</label>
            <PaymentTermsBuilder
              value={form.payment_terms}
              onChange={(v) => setForm((f) => ({ ...f, payment_terms: v }))}
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
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Business Unit</label>
            <BusinessUnitSelect
              value={form.bu_id || null}
              onChange={(id) => setForm((f) => ({ ...f, bu_id: id ?? "" }))}
              placeholder="— No BU —"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              Assign this account to a Business Unit so Requests, Quotes, and Jobs can be filtered accordingly.
            </p>
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
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingContract, setUploadingContract] = useState(false);
  const [drawerAssignableUsers, setDrawerAssignableUsers] = useState<AssignableUser[]>([]);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const contractFileRef = useRef<HTMLInputElement>(null);
  /** Frontend-only until backend adds billing_type column. */
  const [billingType, setBillingType] = useState<"end_client" | "account">("end_client");
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [edit, setEdit] = useState({
    company_name: "",
    contact_name: "",
    account_owner_id: "",
    email: "",
    finance_email: "",
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
    setBillingType(((account as unknown as Record<string, unknown>).billing_type as "end_client" | "account") ?? "end_client");
    setEdit({
      company_name: account.company_name,
      contact_name: account.contact_name,
      account_owner_id: account.account_owner_id ?? "",
      email: account.email,
      finance_email: account.finance_email ?? "",
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
    if (!account) return;
    void listActiveAssignableUsers().then(setDrawerAssignableUsers).catch(() => setDrawerAssignableUsers([]));
  }, [account?.id]);

  const editOwnerLabel = useMemo(
    () => accountOwnerLabel(edit.account_owner_id, account?.owner_name, drawerAssignableUsers),
    [account?.owner_name, edit.account_owner_id, drawerAssignableUsers],
  );

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
    return null;
  }

  const st = cfg[account.status] ?? cfg.onboarding;
  const outstandingInvoices = invoices
    .filter((i) => i.status !== "paid" && i.status !== "cancelled")
    .reduce((s, i) => s + Number(i.amount), 0);

  const handleSyncAccount = async () => {
    if (!isAdmin) return;
    setSyncingAccount(true);
    try {
      const res = await fetch("/api/admin/invoices/recalculate-due-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, accountId: account.id }),
      });
      const json = await res.json().catch(() => ({})) as { updated?: number; sameDate?: number; noAccount?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      const parts = [];
      if ((json.sameDate ?? 0) > 0) parts.push(`${json.sameDate} already correct`);
      if ((json.noAccount ?? 0) > 0) parts.push(`${json.noAccount} skipped`);
      const detail = parts.length ? ` · ${parts.join(" · ")}` : "";
      toast.success(`Updated ${json.updated ?? 0} invoice${(json.updated ?? 0) !== 1 ? "s" : ""} for ${account.company_name}${detail}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingAccount(false);
    }
  };

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
        account_owner_id: edit.account_owner_id.trim() || null,
        email: edit.email.trim(),
        finance_email: edit.finance_email.trim() || null,
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
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : "Failed to update account";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // Invoice breakdown for account value hero
  const invoicedAmt = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const awaitingAmt = invoices.filter((i) => ["draft", "pending", "partially_paid"].includes(i.status)).reduce((s, i) => s + Number(i.amount), 0);
  const overdueAmt  = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <>
    <Drawer
      open
      onClose={onClose}
      title={account.company_name}
      subtitle={`Corporate account · ${clientsTotal} clients · ${jobs.length} jobs`}
      width="w-[min(580px,calc(100vw-1rem))]"
      footer={
        isAdmin && tab === "overview" ? (
          <div className="flex items-center justify-between px-5 py-4">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-[#ED4B00] hover:text-[#ED4B00]/80 transition-colors"
              onClick={() => toast.info("Archive not yet implemented")}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive account
            </button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
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
        ) : undefined
      }
    >
      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-surface border-b border-border-light px-4 sm:px-5 pt-1 pb-0">
        <Tabs
          variant="default"
          className="w-full"
          activeTab={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "clients",  label: "Clients",  count: clientsTotal || undefined },
            { id: "jobs",     label: "Jobs",      count: jobs.length || undefined },
            { id: "finance",  label: "Finance",   count: invoices.length || undefined },
            { id: "portal",   label: "Portal users" },
          ]}
        />
      </div>

      <div className="px-4 sm:px-5 py-4 space-y-4">

        {/* ── Overview tab ─────────────────────────────────────────── */}
        {tab === "overview" && (
          <>
            {/* Account value hero */}
            <div className="rounded-2xl border border-border-light bg-white p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">
                Account value · All time
              </p>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-3xl font-bold tabular-nums text-text-primary">
                  {formatCurrency(account.total_revenue)}
                </span>
                {(loading || loadingExtras) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
                )}
              </div>
              <div className="h-[2px] rounded-full bg-[#ED4B00] mb-3" />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="h-2 w-2 rounded-full bg-[#020040] shrink-0" />
                  Invoiced <strong className="tabular-nums">{formatCurrency(invoicedAmt)}</strong>
                </span>
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  Awaiting <strong className="tabular-nums">{formatCurrency(awaitingAmt)}</strong>
                </span>
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                  Overdue <strong className="tabular-nums">{formatCurrency(overdueAmt)}</strong>
                </span>
                <span className="ml-auto text-text-tertiary text-xs tabular-nums">
                  Total <strong className="text-text-primary">{formatCurrency(account.total_revenue)}</strong>
                </span>
              </div>
            </div>

            {/* ── BILLING card ─────────────────────────────────────── */}
            <div className="rounded-2xl border border-border-light bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold text-[#020040] uppercase tracking-wider">Billing</p>
                  <span title="Changes apply to new invoices only" className="text-text-tertiary cursor-help">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="text-[10px] text-text-tertiary">Changes apply to new invoices only</p>
              </div>

              {/* Bill invoices to */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">
                  Bill invoices to <span className="text-[#ED4B00]">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {(["end_client", "account"] as const).map((bt) => {
                    const selected = billingType === bt;
                    return (
                      <button
                        key={bt}
                        type="button"
                        onClick={() => setBillingType(bt)}
                        className={cn(
                          "rounded-xl border-2 p-3.5 text-left transition-all",
                          selected ? "border-[#020040] bg-[#020040]/[0.04]" : "border-border-light bg-white hover:border-border",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={cn(
                            "mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0",
                            selected ? "border-[#020040]" : "border-border",
                          )}>
                            {selected && <div className="h-2 w-2 rounded-full bg-[#020040]" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-text-primary leading-tight">
                              {bt === "end_client" ? "End client" : "This account"}
                            </p>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary mt-0.5">
                              {bt === "end_client" ? "B2C" : "B2B2C"}
                            </p>
                            <p className="text-[11px] text-text-secondary mt-1 leading-snug">
                              {bt === "end_client"
                                ? "Invoice goes to the final customer. Ex: Checkatrade"
                                : "Invoice goes to this account. Ex: Housekeep"}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Terms + Billing Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                    Payment Terms <span className="text-[#ED4B00]">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setTermsModalOpen(true)}
                    className="w-full flex items-center justify-between rounded-xl border border-border-light bg-surface-hover px-3 py-2.5 hover:bg-surface-tertiary transition-colors text-left"
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {edit.payment_terms ? shortenPaymentTerms(edit.payment_terms) : <span className="text-text-tertiary">Set payment terms…</span>}
                    </span>
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Edit</span>
                  </button>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                    Billing Email <span className="text-[#ED4B00]">*</span>
                  </label>
                  <Input
                    type="email"
                    value={edit.finance_email}
                    onChange={(e) => setEdit((p) => ({ ...p, finance_email: e.target.value }))}
                    placeholder="billing@company.com"
                  />
                  <p className="text-[10px] text-text-tertiary mt-1">
                    {billingType === "account"
                      ? "Required for account-direct billing"
                      : "Optional — overrides client email on invoices"}
                  </p>
                </div>
              </div>

              {/* Next payment cycle preview */}
              {(() => {
                const terms = edit.payment_terms;
                if (!terms) return null;
                const iso = dueDateIsoFromPaymentTerms(new Date(), terms);
                const label = new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                });
                const isDor = /due\s+on\s+receipt/i.test(terms);
                return (
                  <div className="flex items-center gap-2.5 rounded-xl bg-[#020040]/[0.04] border border-[#020040]/10 px-4 py-3">
                    <Calendar className="h-4 w-4 text-[#020040]/50 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#020040]/50">
                        Next payment date
                      </p>
                      <p className="text-sm font-semibold text-[#020040]">{label}</p>
                      {isDor && (
                        <p className="text-[10px] text-text-tertiary mt-0.5">Due on receipt — same day as job completion</p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── ACCOUNT DETAILS card ─────────────────────────────── */}
            <div className="rounded-2xl border border-border-light bg-white p-5 space-y-4">
              <p className="text-xs font-bold text-[#020040] uppercase tracking-wider">Account details</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Company</label>
                  <Input value={edit.company_name} onChange={(e) => setEdit((p) => ({ ...p, company_name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Contact</label>
                  <Input value={edit.contact_name} onChange={(e) => setEdit((p) => ({ ...p, contact_name: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Account owner</label>
                <JobOwnerSelect
                  value={edit.account_owner_id || undefined}
                  fallbackName={editOwnerLabel === "—" ? undefined : editOwnerLabel}
                  users={drawerAssignableUsers}
                  emptyLabel="No internal owner"
                  disabled={saving}
                  onChange={(id) => setEdit((p) => ({ ...p, account_owner_id: id ?? "" }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Email</label>
                  <Input type="email" value={edit.email} onChange={(e) => setEdit((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Contact number</label>
                  <Input value={edit.contact_number} onChange={(e) => setEdit((p) => ({ ...p, contact_number: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">CRN</label>
                  <Input value={edit.crn} onChange={(e) => setEdit((p) => ({ ...p, crn: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Credit limit</label>
                  <Input
                    type="number"
                    min={0}
                    value={edit.credit_limit}
                    onChange={(e) => setEdit((p) => ({ ...p, credit_limit: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Address</label>
                <Input value={edit.address} onChange={(e) => setEdit((p) => ({ ...p, address: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
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
            </div>

            {/* ── ASSETS card ─────────────────────────────────────── */}
            <div className="rounded-2xl border border-border-light bg-white p-5 space-y-4">
              <p className="text-xs font-bold text-[#020040] uppercase tracking-wider">Assets</p>

              <div className="grid grid-cols-2 gap-5">
                {/* Contract */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">Contract</label>
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
                        onAccountUpdated(fresh ?? updated);
                        setEdit((p) => ({ ...p, contract_url: url }));
                        toast.success("Contract uploaded");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Upload failed");
                      } finally {
                        setUploadingContract(false);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center"
                    disabled={uploadingContract || saving}
                    onClick={() => contractFileRef.current?.click()}
                    icon={uploadingContract ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  >
                    {uploadingContract ? "Uploading…" : "Upload contract"}
                  </Button>
                  {edit.contract_url.trim() && (
                    <div className="flex gap-2 mt-2">
                      <Button type="button" variant="outline" size="sm" className="flex-1 justify-center"
                        onClick={() => window.open(edit.contract_url, "_blank", "noopener,noreferrer")}
                        icon={<ExternalLink className="h-3.5 w-3.5" />}>
                        Preview
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={uploadingContract}
                        onClick={async () => {
                          if (!account || !isAdmin) return;
                          setUploadingContract(true);
                          try {
                            try { await removeAccountContractFromStorage(account.id); } catch { /* ok */ }
                            const updated = await updateAccount(account.id, { contract_url: null });
                            const fresh = await getAccount(account.id);
                            onAccountUpdated(fresh ?? updated);
                            setEdit((p) => ({ ...p, contract_url: "" }));
                            toast.success("Contract removed");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed");
                          } finally {
                            setUploadingContract(false);
                          }
                        }}
                        icon={<Trash2 className="h-3.5 w-3.5" />}>
                      </Button>
                    </div>
                  )}
                  <p className="text-[10px] text-text-tertiary mt-1.5">PDF · DOC · DOCX · max 10MB</p>
                </div>

                {/* Logo */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">Logo</label>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    onChange={(ev) => void handleLogoUpload(ev)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center"
                    disabled={uploadingLogo || saving}
                    onClick={() => logoFileRef.current?.click()}
                    icon={uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  >
                    {uploadingLogo ? "Uploading…" : "Upload logo"}
                  </Button>
                  {(edit.logo_url.trim() || account.logo_url) && (
                    <div className="mt-2 flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={(edit.logo_url.trim() || account.logo_url) ?? ""}
                        alt=""
                        className="h-10 w-10 object-contain rounded-lg border border-border-light bg-card p-0.5 shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <Button type="button" variant="outline" size="sm" disabled={uploadingLogo}
                        onClick={() => void handleRemoveLogo()}
                        icon={<Trash2 className="h-3.5 w-3.5" />}>
                        Remove
                      </Button>
                    </div>
                  )}
                  <p className="text-[10px] text-text-tertiary mt-1.5">PNG · SVG · max 5MB</p>
                </div>
              </div>
            </div>
          </>
        )}

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
                            <p className="text-[11px] text-text-tertiary truncate">{c.email || c.phone || c.address || "—"}</p>
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
                {Math.ceil(clientsTotal / CLIENTS_PAGE_SIZE) > 1 && (
                  <div className="flex items-center justify-between pt-1">
                    <Button variant="outline" size="sm" disabled={clientsPage === 0 || clientsLoading}
                      onClick={() => loadClientsPage(account, clientsPage - 1)}>← Previous</Button>
                    <span className="text-xs text-text-tertiary">
                      {clientsPage * CLIENTS_PAGE_SIZE + 1}–{Math.min((clientsPage + 1) * CLIENTS_PAGE_SIZE, clientsTotal)} of {clientsTotal}
                    </span>
                    <Button variant="outline" size="sm" disabled={(clientsPage + 1) * CLIENTS_PAGE_SIZE >= clientsTotal || clientsLoading}
                      onClick={() => loadClientsPage(account, clientsPage + 1)}>Next →</Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Jobs tab ─────────────────────────────────────────────── */}
        {tab === "jobs" && (
          <div className="space-y-2">
            {loadingExtras ? (
              <div className="flex justify-center py-10 text-text-tertiary text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-8">No jobs linked yet.</p>
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden max-h-[50vh] overflow-y-auto">
                {jobs.map((j) => {
                  const schedLine = formatJobScheduleLine(j);
                  return (
                    <Link key={j.id} href={`/jobs/${j.id}`}
                      className="flex items-start gap-3 px-3 py-3 border-b border-border-light last:border-0 hover:bg-surface-hover transition-colors">
                      <Briefcase className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-text-primary">{j.reference}</span>
                          {jobStatusBadge(j.status)}
                          <Badge variant="outline" size="sm">{j.finance_status}</Badge>
                        </div>
                        <p className="text-xs text-text-secondary truncate">{j.title}</p>
                        <p className="text-[11px] text-text-tertiary truncate">{j.client_name} · {j.property_address}</p>
                        {schedLine
                          ? <p className="text-[10px] text-text-secondary mt-1 leading-snug line-clamp-2">{schedLine}</p>
                          : <p className="text-[10px] text-text-tertiary mt-1">No schedule set</p>}
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

        {/* ── Finance tab ──────────────────────────────────────────── */}
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
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Total revenue</p>
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
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    disabled={syncingAccount}
                    onClick={() => void handleSyncAccount()}
                    className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
                  >
                    {syncingAccount
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Receipt className="h-3 w-3" />}
                    {syncingAccount ? "Syncing…" : "Sync due dates"}
                  </button>
                )}
                <Link href="/finance/invoices" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  All invoices <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
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

        {/* ── Portal users tab ─────────────────────────────────────── */}
        {tab === "portal" && account && (
          <PortalUsersTabSection accountId={account.id} accountName={account.company_name} />
        )}

      </div>
    </Drawer>

    {/* ── Payment Terms Modal ───────────────────────────────────────── */}
    <PaymentTermsModal
      open={termsModalOpen}
      value={edit.payment_terms}
      onClose={() => setTermsModalOpen(false)}
      onSave={(v) => { setEdit((p) => ({ ...p, payment_terms: v })); setTermsModalOpen(false); }}
    />
    </>
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

// ─── Portal users tab content ──────────────────────────────────────────────
function PortalUsersTabSection({ accountId, accountName }: { accountId: string; accountName: string }) {
  type PortalUserRow = {
    id:                string;
    email:             string;
    full_name:         string | null;
    is_active:         boolean;
    created_at:        string;
    last_signed_in_at: string | null;
  };

  const [users, setUsers]         = useState<PortalUserRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName,  setInviteName]  = useState("");
  const [error, setError]         = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("account_portal_users")
        .select("id, email, full_name, is_active, created_at, last_signed_in_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });
      setUsers((data ?? []) as PortalUserRow[]);
    } catch (err) {
      console.error("[PortalUsersTab] load failed:", err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!inviteEmail.trim() || !inviteName.trim()) {
      setError("Email and name are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/account/invite-portal-user", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          accountId,
          email:     inviteEmail.trim().toLowerCase(),
          full_name: inviteName.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Could not send the invite.");
        setSubmitting(false);
        return;
      }
      toast.success(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      setInviteName("");
      // Give the trigger a moment to insert the row
      setTimeout(() => void loadUsers(), 500);
    } catch (err) {
      console.error("[PortalUsersTab] invite failed:", err);
      setError("Could not send the invite. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-secondary p-4">
        <h4 className="text-sm font-bold text-text-primary mb-1">Invite a portal user</h4>
        <p className="text-xs text-text-tertiary mb-3">
          Portal users for <strong>{accountName}</strong> can sign in to /portal to open
          requests, view quotes, jobs and invoices. We&rsquo;ll send a magic-link invite via email.
        </p>
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
        <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="Full name"
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            disabled={submitting}
          />
          <input
            type="text"
            placeholder="Email address"
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={submitting}
            autoCapitalize="none"
          />
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 disabled:opacity-60"
          >
            {submitting ? "Sending..." : "Send invite"}
          </button>
        </form>
      </div>

      <div>
        <h4 className="text-sm font-bold text-text-primary mb-2">Existing portal users</h4>
        {loading ? (
          <div className="text-xs text-text-tertiary py-4">Loading...</div>
        ) : users.length === 0 ? (
          <div className="text-xs text-text-tertiary py-4">No portal users yet.</div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {users.map((u) => (
              <div key={u.id} className="px-4 py-3 border-b border-border last:border-b-0 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{u.full_name || u.email}</p>
                  <p className="text-xs text-text-tertiary truncate">{u.email}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-semibold ${u.is_active ? "text-emerald-600" : "text-slate-400"}`}>
                    {u.is_active ? "Active" : "Disabled"}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">
                    {u.last_signed_in_at
                      ? `Last signed in ${new Date(u.last_signed_in_at).toLocaleDateString()}`
                      : "Never signed in"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function shortenPaymentTerms(t: string | null | undefined): string {
  if (!t) return "—";
  const s = t.trim();
  if (/due\s+on\s+receipt/i.test(s)) return "Due on receipt";
  if (/monthly\s+cutoff/i.test(s)) return "Monthly cycle";
  if (/every\s+2\s+weeks?\s+cutoff/i.test(s)) return "Biweekly cycle";
  if (/every\s+2\s*weeks\s+on\s+friday/i.test(s)) return "Biweekly Fri";
  if (/every\s+friday/i.test(s)) return "Every Friday";
  const evN = s.match(/every\s+(\d+)\s+days/i);
  if (evN) return `Every ${evN[1]}d`;
  const net = s.match(/net\s+(\d+)/i);
  if (net) return `Net ${net[1]}`;
  if (/45\s*days/i.test(s)) return "Net 45";
  return s.length > 14 ? s.slice(0, 12) + "…" : s;
}

// ─── PaymentTermsModal ────────────────────────────────────────────────────
function PaymentTermsModal({
  open, value, onClose, onSave,
}: { open: boolean; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { if (open) setLocal(value); }, [open, value]);

  const iso = local ? dueDateIsoFromPaymentTerms(new Date(), local) : null;
  const nextLabel = iso
    ? new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <Modal open={open} onClose={onClose} title="Payment Terms" size="md" rootClassName="z-[60]">
      <div className="px-5 py-4 space-y-4">
        <PaymentTermsBuilder value={local} onChange={setLocal} />

        {nextLabel && (
          <div className="flex items-center gap-2.5 rounded-xl bg-[#020040]/[0.04] border border-[#020040]/10 px-4 py-3">
            <Calendar className="h-4 w-4 text-[#020040]/50 shrink-0" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#020040]/50">Next payment date</p>
              <p className="text-sm font-semibold text-[#020040]">{nextLabel}</p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(local)}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── PaymentTermsBuilder ───────────────────────────────────────────────────
const WEEKDAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildCycleString(
  freq: "monthly" | "biweekly",
  cutoffDay: string,
  cutoffWeekday: string,
  payWeekday: string,
  refDate?: string,
): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (freq === "monthly") return `Monthly cutoff ${cutoffDay} pay ${cap(payWeekday)}`;
  const base = `Every 2 weeks cutoff ${cap(cutoffWeekday)} pay ${cap(payWeekday)}`;
  return refDate ? `${base} ref ${refDate}` : base;
}

function parseCycleValue(value: string) {
  const isCycle = /monthly\s+cutoff/i.test(value) || /every\s+2\s+weeks?\s+cutoff/i.test(value);
  if (!isCycle) return null;
  const isbi   = /every\s+2\s+weeks/i.test(value);
  const dMatch = value.match(/monthly\s+cutoff\s+(\d+)/i);
  const wMatch = value.match(/every\s+2\s+weeks?\s+cutoff\s+(\w+)/i);
  const pMatch = value.match(/pay\s+(\w+)/i);
  const rMatch = value.match(/ref\s+(\d{4}-\d{2}-\d{2})/i);
  return {
    freq: (isbi ? "biweekly" : "monthly") as "monthly" | "biweekly",
    cutoffDay:     dMatch ? dMatch[1] : "26",
    cutoffWeekday: wMatch ? wMatch[1].toLowerCase() : "wednesday",
    payWeekday:    pMatch ? pMatch[1].toLowerCase() : "friday",
    refDate:       rMatch ? rMatch[1] : undefined,
  };
}

function PaymentTermsBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = parseCycleValue(value);
  const [mode,          setMode]          = useState<"standard" | "cycle">(parsed ? "cycle" : "standard");
  const [freq,          setFreq]          = useState<"monthly" | "biweekly">(parsed?.freq ?? "monthly");
  const [cutoffDay,     setCutoffDay]     = useState(parsed?.cutoffDay ?? "26");
  const [cutoffWeekday, setCutoffWeekday] = useState(parsed?.cutoffWeekday ?? "wednesday");
  const [payWeekday,    setPayWeekday]    = useState(parsed?.payWeekday ?? "friday");
  const [refDate,       setRefDate]       = useState(parsed?.refDate ?? "");

  useEffect(() => {
    const p = parseCycleValue(value);
    if (p) {
      setMode("cycle");
      setFreq(p.freq);
      setCutoffDay(p.cutoffDay);
      setCutoffWeekday(p.cutoffWeekday);
      setPayWeekday(p.payWeekday);
      if (p.refDate) setRefDate(p.refDate);
    } else {
      setMode("standard");
    }
  }, [value]);

  const emit = (
    f = freq, cd = cutoffDay, cw = cutoffWeekday, pw = payWeekday, rd = refDate,
  ) => onChange(buildCycleString(f, cd, cw, pw, rd || undefined));

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {(["standard", "cycle"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              if (m === "standard") onChange("Net 30");
              else emit();
            }}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors",
              mode === m
                ? "bg-[#020040] text-white border-[#020040]"
                : "bg-white text-text-secondary border-border-light hover:bg-surface-hover",
            )}
          >
            {m === "standard" ? "Standard" : "Cycle-based"}
          </button>
        ))}
      </div>

      {mode === "standard" ? (
        <Select
          options={PAYMENT_TERMS_OPTIONS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="rounded-xl border border-border-light bg-white p-3.5 space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Billing cycle</label>
            <Select
              options={[
                { value: "monthly",   label: "Monthly" },
                { value: "biweekly",  label: "Every 2 weeks" },
              ]}
              value={freq}
              onChange={(e) => {
                const f = e.target.value as "monthly" | "biweekly";
                setFreq(f);
                emit(f);
              }}
            />
          </div>

          {freq === "monthly" ? (
            <div>
              <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Cut-off day of month</label>
              <Select
                options={Array.from({ length: 28 }, (_, i) => ({
                  value: String(i + 1),
                  label: `Day ${i + 1}`,
                }))}
                value={cutoffDay}
                onChange={(e) => { setCutoffDay(e.target.value); emit(freq, e.target.value); }}
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Cut-off weekday</label>
                <Select
                  options={WEEKDAYS.map((w) => ({ value: w, label: WEEKDAY_LABELS[w] }))}
                  value={cutoffWeekday}
                  onChange={(e) => { setCutoffWeekday(e.target.value); emit(freq, cutoffDay, e.target.value); }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">
                  Last cutoff date
                  <span className="ml-1 normal-case font-normal text-text-tertiary">(sets the exact 2-week rhythm)</span>
                </label>
                <Input
                  type="date"
                  value={refDate}
                  onChange={(e) => { setRefDate(e.target.value); emit(freq, cutoffDay, cutoffWeekday, payWeekday, e.target.value); }}
                  className={cn(!refDate && "border-amber-400")}
                />
                {!refDate && (
                  <p className="text-[10px] text-amber-600 mt-1">
                    Without a reference date the cycle rhythm may be off by a week — enter the last {WEEKDAY_LABELS[cutoffWeekday]} when this client was billed.
                  </p>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">Pay on weekday</label>
            <Select
              options={WEEKDAYS.map((w) => ({ value: w, label: WEEKDAY_LABELS[w] }))}
              value={payWeekday}
              onChange={(e) => { setPayWeekday(e.target.value); emit(freq, cutoffDay, cutoffWeekday, e.target.value); }}
            />
          </div>

          <div className="rounded-lg bg-[#020040]/5 border border-[#020040]/15 px-3 py-2">
            <p className="text-[10px] font-medium text-[#020040]/60 uppercase mb-0.5">Encoded as</p>
            <p className="text-xs font-mono font-semibold text-[#020040]">
              {buildCycleString(freq, cutoffDay, cutoffWeekday, payWeekday, refDate || undefined)}
            </p>
          </div>
        </div>
      )}
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
