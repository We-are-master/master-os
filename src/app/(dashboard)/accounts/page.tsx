"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
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
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Building, DollarSign, Briefcase, TrendingUp, Calendar,
  Receipt, Users, Loader2, Save, ExternalLink, Upload, Trash2,   Archive,
  LayoutList, LayoutGrid, ChevronLeft, ChevronRight, Minus, ArrowRight, Share2,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import {
  dueDateIsoFromAccountPaymentTerms,
  isAccountOrgBiweeklyGridTerms,
  type AccountPaymentOrgContext,
} from "@/lib/account-payment-due-date";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { toast } from "sonner";
import type { Account, CatalogService, Client, Job, Invoice } from "@/types/database";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { catalogServiceLabelsForIds } from "@/lib/catalog-trade-ids";
import { PartnerTradesIconStrip } from "@/services/partner-trade-icons";
import { CatalogTradesSkillsTab } from "@/components/partners/catalog-trades-skills-tab";
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
import { getSupabase, getStatusCounts, getAggregates } from "@/services/base";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";
import { findDuplicateAccountHints, formatAccountDuplicateLines } from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { BusinessUnitSelect } from "@/components/ui/business-unit-select";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { listActiveAssignableUsers, type AssignableUser } from "@/services/profiles";
import { jobStatusBadgeVariant, type JobsManagementTabAccent } from "@/lib/job-status-ui";
import { AccountServiceRatesTabSection } from "./service-rates-tab";
import { PartnerAvatarCropModal } from "@/components/partners/partner-avatar-crop-modal";
import { CatalogShareModal } from "@/components/catalog/catalog-share-modal";
import { useAdminConfig } from "@/hooks/use-admin-config";

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

const ACCOUNTS_VIEW_STORAGE_KEY = "master-os-accounts-view";

const ACCOUNTS_LIST_PAGE_SIZE = 10;

type AccountsDisplayMode = "list" | "grid";

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
  return "";
}

function formatCreditLimitCompact(amount: number): string {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `£${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 10_000) {
    const k = n / 1_000;
    return `£${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return formatCurrency(n);
}

function AccountOwnerCell({
  accountOwnerId,
  legacyOwnerName,
  users,
}: {
  accountOwnerId: string | null | undefined;
  legacyOwnerName: string | null | undefined;
  users: AssignableUser[];
}) {
  const label = accountOwnerLabel(accountOwnerId, legacyOwnerName, users);
  if (!label) {
    return <span className="text-sm text-text-tertiary italic">Unassigned</span>;
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar name={label} size="sm" className="shrink-0" />
      <span className="text-sm text-text-secondary truncate">{label}</span>
    </div>
  );
}

function renderAccountNextPayment(item: Account, orgCtx: AccountPaymentOrgContext) {
  if (!item.payment_terms) return <span className="text-text-tertiary text-xs">—</span>;
  const iso = dueDateIsoFromAccountPaymentTerms(new Date(), item.payment_terms, orgCtx);
  const d = new Date(iso + "T12:00:00");
  const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const isOverdue = d < new Date();
  return (
    <span className={cn("text-xs font-medium tabular-nums", isOverdue ? "text-red-500" : "text-text-primary")}>
      {label}
    </span>
  );
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
  default_client_cancel_fee_gbp: "",
};

export default function AccountsPage() {
  const { partnerPayoutStandardTerms, partnerPayoutReferenceYmd } = useFrontendSetup();
  const paymentOrgCtx = useMemo<AccountPaymentOrgContext>(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

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
  const [accountsDisplayMode, setAccountsDisplayMode] = useState<AccountsDisplayMode>("list");
  const [listSortKey, setListSortKey] = useState<string | null>("total_revenue");
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("desc");

  /** Avoid SSR/localStorage mismatch — restore saved view after mount. */
  useEffect(() => {
    try {
      const v = localStorage.getItem(ACCOUNTS_VIEW_STORAGE_KEY);
      if (v === "grid" || v === "list") setAccountsDisplayMode(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ACCOUNTS_VIEW_STORAGE_KEY, accountsDisplayMode);
    } catch {
      /* ignore */
    }
  }, [accountsDisplayMode]);

  const { profile } = useProfile();
  const { can, loading: configLoading } = useAdminConfig();
  const canCatalog = can("service_catalog");
  const isAdmin = profile?.role === "admin";
  const { confirmDespiteDuplicates } = useDuplicateConfirm();

  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [accountStatusCounts, setAccountStatusCounts] = useState<Record<string, number>>({});

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const loadKpis = useCallback(async () => {
    try {
      const [revenueAgg, jobsAgg, counts] = await Promise.all([
        getAggregates("accounts", "total_revenue"),
        getAggregates("accounts", "active_jobs"),
        getStatusCounts("accounts", ["active", "onboarding", "inactive"], "status"),
      ]);
      setTotalAccounts(revenueAgg.count);
      setTotalRevenue(revenueAgg.sum);
      setTotalJobs(jobsAgg.sum);
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
    void listCatalogServicesForPicker()
      .then(setCatalogServices)
      .catch(() => setCatalogServices([]));
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    void listActiveAssignableUsers().then(setCreateAssignableUsers).catch(() => setCreateAssignableUsers([]));
  }, [createOpen]);

  const avgDeal = totalAccounts > 0 ? Math.round(totalRevenue / totalAccounts) : 0;
  const activeAccountCount = accountStatusCounts.active ?? 0;
  const inactiveAccountCount = accountStatusCounts.inactive ?? 0;

  const sortedListData = useMemo(() => {
    const sortKey = listSortKey ?? "total_revenue";
    const rows = [...data];
    const dir = listSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = sortKey === "active_jobs" ? Number(a.active_jobs) || 0 : Number(a.total_revenue) || 0;
      const bv = sortKey === "active_jobs" ? Number(b.active_jobs) || 0 : Number(b.total_revenue) || 0;
      return (av - bv) * dir;
    });
    return rows;
  }, [data, listSortKey, listSortDir]);

  const maxRevenueInView = useMemo(
    () => Math.max(1, ...sortedListData.map((a) => Number(a.total_revenue) || 0)),
    [sortedListData],
  );

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
        default_client_cancel_fee_gbp:
          Number(form.default_client_cancel_fee_gbp) > 0 ? Math.round(Number(form.default_client_cancel_fee_gbp) * 100) / 100 : null,
      });

      // Mirror the new account into Zendesk (🏢 + os_type=account). Fire-and-
      // forget so a slow Zendesk doesn't block the UI.
      void fetch("/api/admin/account/zendesk-sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accountId: created.id }),
      }).catch(() => { /* non-blocking */ });

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

  const accountsTableCell = "px-4 py-3";
  const accountsTableHeader = "px-4 py-3";

  const columns: Column<Account>[] = useMemo(
    () => [
    {
      key: "company_name",
      label: "Account",
      width: "28%",
      headerClassName: accountsTableHeader,
      cellClassName: accountsTableCell,
      render: (item) => {
        const isActive = item.status === "active";
        const serviceLabels = catalogServiceLabelsForIds(item.catalog_service_ids, catalogServices);
        const industry = item.industry?.trim();
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={item.company_name} size="md" src={item.logo_url ?? undefined} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{item.company_name}</p>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    isActive ? "bg-emerald-500" : item.status === "onboarding" ? "bg-amber-400" : "bg-stone-300",
                  )}
                  title={statusConfig[item.status]?.label ?? item.status}
                />
              </div>
              {serviceLabels.length > 0 ? (
                <div className="mt-1 min-w-0">
                  <PartnerTradesIconStrip
                    trades={serviceLabels}
                    catalogServices={catalogServices}
                    maxVisible={5}
                  />
                </div>
              ) : industry ? (
                <p className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary truncate mt-0.5">
                  {industry}
                </p>
              ) : (
                <p className="text-[11px] text-text-tertiary truncate">{item.contact_name}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "active_jobs",
      label: "Jobs",
      width: "14%",
      align: "center",
      headerClassName: accountsTableHeader,
      cellClassName: accountsTableCell,
      sortable: true,
      render: (item) => (
        <span
          className={cn(
            "inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums",
            item.active_jobs > 0 ? "bg-primary/10 text-primary" : "bg-surface-tertiary/80 text-text-tertiary",
          )}
        >
          {item.active_jobs}
        </span>
      ),
    },
    {
      key: "total_revenue",
      label: "Revenue",
      width: "22%",
      align: "center",
      headerClassName: accountsTableHeader,
      cellClassName: accountsTableCell,
      sortable: true,
      render: (item) => {
        const rev = Number(item.total_revenue) || 0;
        const pct = Math.round((rev / maxRevenueInView) * 100);
        return (
          <div className="mx-auto w-full max-w-[9rem] space-y-1.5 text-center">
            <span className="block text-sm font-bold tabular-nums text-text-primary">
              {formatCurrency(rev)}
            </span>
            <div className="h-1 w-full rounded-full bg-surface-tertiary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/75 transition-all"
                style={{ width: `${Math.max(pct, rev > 0 ? 4 : 0)}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "billing",
      label: "Billing",
      width: "22%",
      align: "center",
      headerClassName: accountsTableHeader,
      cellClassName: accountsTableCell,
      render: (item) => {
        const termsLabel = shortenPaymentTerms(item.payment_terms);
        return (
          <div className="mx-auto min-w-0 max-w-[10rem] space-y-1 text-center">
            <div className="flex justify-center">
              <Badge variant="outline" size="sm" className="max-w-full truncate">
                {termsLabel}
              </Badge>
            </div>
            <div className="text-[11px]">{renderAccountNextPayment(item, paymentOrgCtx)}</div>
          </div>
        );
      },
    },
    {
      key: "credit_limit",
      label: "Credit",
      width: "10%",
      align: "center",
      headerClassName: cn(accountsTableHeader, "hidden 2xl:table-cell"),
      cellClassName: cn(accountsTableCell, "hidden 2xl:table-cell"),
      render: (item) => (
        <span
          className="text-sm tabular-nums text-text-secondary"
          title={formatCurrency(item.credit_limit)}
        >
          {formatCreditLimitCompact(item.credit_limit)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      width: "48px",
      align: "center",
      headerClassName: accountsTableHeader,
      cellClassName: accountsTableCell,
      render: () => <ArrowRight className="h-4 w-4 text-text-tertiary mx-auto" aria-hidden />,
    },
  ],
    [accountsTableCell, accountsTableHeader, catalogServices, maxRevenueInView, paymentOrgCtx],
  );


  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Accounts" subtitle="Corporate clients — billing, jobs, and rate cards in one place.">
          {!configLoading && canCatalog ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 className="h-3.5 w-3.5" />}
              onClick={() => setShareOpen(true)}
            >
              Share rate card
            </Button>
          ) : null}
          {isAdmin && (
            <Button size="sm" variant="outline" icon={<Receipt className="h-3.5 w-3.5" />} onClick={() => setSyncOpen(true)}>
              Sync due dates
            </Button>
          )}
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Account</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Accounts"
            value={totalAccounts}
            format="number"
            description={`${activeAccountCount} active · ${inactiveAccountCount} inactive`}
            icon={Building}
            accent="blue"
          />
          <KpiCard
            title="Total Revenue"
            value={totalRevenue}
            format="currency"
            description="All-time across accounts"
            icon={DollarSign}
            accent="emerald"
          />
          <KpiCard title="Active Jobs" value={totalJobs} format="number" description="Open jobs in pipeline" icon={Briefcase} accent="primary" />
          <KpiCard
            title="Avg Deal Size"
            value={avgDeal}
            format="currency"
            description="Revenue per account"
            icon={TrendingUp}
            accent="purple"
          />
        </StaggerContainer>

        <motion.div
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
          className="rounded-xl border border-border-light bg-card shadow-soft overflow-hidden"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between px-4 sm:px-5 py-3 border-b border-border-light bg-surface/40 min-w-0">
            <div className="w-full min-w-0 md:flex-1 md:pr-4">
              <Tabs
                tabs={accountListTabs.map(({ id, label, count, accent }) => ({ id, label, count, accent }))}
                activeTab={status}
                onChange={setStatus}
                className="border-b-0"
              />
            </div>
            <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:min-w-[18rem] md:max-w-[34rem] shrink-0">
              <p className="text-[11px] text-text-tertiary tabular-nums whitespace-nowrap md:hidden">
                {totalItems} {totalItems === 1 ? "account" : "accounts"}
              </p>
              <div className="flex items-center gap-2 w-full min-w-0">
                <div
                  className="inline-flex shrink-0 rounded-lg border border-border-light bg-card p-[3px] gap-0.5"
                  role="group"
                  aria-label="Accounts view mode"
                >
                  <button
                    type="button"
                    aria-pressed={accountsDisplayMode === "list"}
                    onClick={() => setAccountsDisplayMode("list")}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      accountsDisplayMode === "list"
                        ? "bg-surface-secondary text-text-primary shadow-sm ring-1 ring-border/70"
                        : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover",
                    )}
                    title="List view"
                  >
                    <LayoutList className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-pressed={accountsDisplayMode === "grid"}
                    onClick={() => setAccountsDisplayMode("grid")}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      accountsDisplayMode === "grid"
                        ? "bg-surface-secondary text-text-primary shadow-sm ring-1 ring-border/70"
                        : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover",
                    )}
                    title="Grid view"
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <SearchInput
                  placeholder="Search accounts…"
                  className="min-w-0 flex-1"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          {accountsDisplayMode === "list" ? (
          <>
          <DataTable
            columns={columns}
            data={sortedListData}
            columnConfigKey="accounts-columns"
            columnConfigScope={status}
            tableClassName="w-full table-fixed"
            className="border-0 shadow-none rounded-none"
            getRowId={(item) => item.id}
            loading={loading}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={ACCOUNTS_LIST_PAGE_SIZE}
            onPageChange={setPage}
            onRowClick={openAccountDetail}
            selectedId={selectedAccount?.id}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            sortColumnKey={listSortKey}
            sortDirection={listSortDir}
            onSortChange={(key, direction) => {
              setListSortKey(key);
              setListSortDir(direction);
            }}
            emptyMessage={search.trim() ? "No accounts match your search." : "No accounts in this view yet."}
            bulkActions={
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                <BulkBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                <BulkBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="danger" />
                <BulkBtn label="Onboarding" onClick={() => handleBulkStatusChange("onboarding")} variant="warning" />
              </div>
            }
          />
          {accountsDisplayMode === "list" && totalItems > 0 ? (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-5 py-3 border-t border-border-light bg-surface/30 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              <span>
                Showing {(page - 1) * ACCOUNTS_LIST_PAGE_SIZE + 1}–{Math.min(page * ACCOUNTS_LIST_PAGE_SIZE, totalItems)} of {totalItems} accounts
              </span>
              <span className="tabular-nums">
                Total revenue {formatCurrency(totalRevenue)} · Active jobs {totalJobs}
              </span>
            </div>
          ) : null}
          </>
          ) : (
            <AccountsGridView
              embedded
              data={sortedListData}
              loading={loading}
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              onPageChange={setPage}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              selectedDetailId={selectedAccount?.id}
              onOpenAccount={openAccountDetail}
              accountOwnerDirectory={accountOwnerDirectory}
              catalogServices={catalogServices}
              paymentOrgCtx={paymentOrgCtx}
              bulkActionButtons={
                <>
                  <BulkBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                  <BulkBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="danger" />
                  <BulkBtn label="Onboarding" onClick={() => handleBulkStatusChange("onboarding")} variant="warning" />
                </>
              }
            />
          )}
        </motion.div>
      </div>

      {selectedAccount ? (
        <AccountDetailDrawer
          account={selectedAccount}
          loading={detailLoading}
          paymentOrgCtx={paymentOrgCtx}
          onClose={() => setSelectedAccount(null)}
          onAccountUpdated={(a) => {
            setSelectedAccount(a);
            refresh();
            loadKpis();
          }}
        />
      ) : null}

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

      <CatalogShareModal open={shareOpen} onClose={() => setShareOpen(false)} />

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
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Default client cancellation fee (£)</label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.default_client_cancel_fee_gbp}
              onChange={(e) => setForm((f) => ({ ...f, default_client_cancel_fee_gbp: e.target.value }))}
              placeholder="Optional — suggested when cancelling jobs"
            />
            <p className="text-[10px] text-text-tertiary mt-1">Shown in Cancel job modal; office can override.</p>
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

function AccountsGridCheckbox({
  checked,
  indeterminate,
  onChange,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "h-[18px] w-[18px] rounded-md border-2 flex items-center justify-center transition-all shrink-0",
        checked || indeterminate
          ? "bg-primary border-primary text-white"
          : "border-border hover:border-text-tertiary bg-card",
        className,
      )}
    >
      {checked && !indeterminate ? (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {indeterminate && !checked ? <Minus className="h-3 w-3" aria-hidden /> : null}
    </button>
  );
}

const ACCOUNT_STATUS_ACCENT: Record<string, string> = {
  active: "border-l-emerald-500",
  onboarding: "border-l-amber-400",
  inactive: "border-l-border",
};

function AccountsGridView({
  data,
  loading,
  page,
  totalPages,
  totalItems,
  onPageChange,
  selectedIds,
  onSelectionChange,
  selectedDetailId,
  onOpenAccount,
  accountOwnerDirectory,
  catalogServices,
  paymentOrgCtx,
  bulkActionButtons,
  embedded = false,
}: {
  data: Account[];
  loading: boolean;
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (p: number) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  selectedDetailId?: string | null;
  onOpenAccount: (a: Account) => void;
  accountOwnerDirectory: AssignableUser[];
  catalogServices: CatalogService[];
  paymentOrgCtx: AccountPaymentOrgContext;
  bulkActionButtons: ReactNode;
  embedded?: boolean;
}) {
  const allIds = data.map((a) => a.id);
  const allSelected = data.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selectedIds);
      for (const id of allIds) next.delete(id);
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      for (const id of allIds) next.add(id);
      onSelectionChange(next);
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectionCount = selectedIds.size;

  return (
    <div
      className={cn(
        "overflow-hidden relative",
        embedded ? "bg-transparent" : "bg-card rounded-xl border border-card-border shadow-soft",
      )}
    >
      <AnimatePresence>
        {selectionCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="sticky top-0 z-10 flex items-center gap-3 px-5 py-2.5 bg-primary/[0.04] border-b border-primary/10"
          >
            <div className="flex items-center gap-2">
              <AccountsGridCheckbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={toggleAll}
              />
              <span className="text-sm font-medium text-primary">{selectionCount} selected</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5 flex-wrap">{bulkActionButtons}</div>
            <button
              type="button"
              onClick={() => onSelectionChange(new Set())}
              className="ml-auto text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Clear selection
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="p-5 grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[14.5rem] rounded-xl border border-border-light bg-surface-secondary animate-shimmer"
            />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-12 w-12 rounded-xl bg-surface-tertiary flex items-center justify-center">
              <Building className="h-6 w-6 text-text-tertiary" />
            </div>
            <p className="text-sm font-medium text-text-secondary">No accounts found</p>
            <p className="text-xs text-text-tertiary max-w-xs">Try another status tab or clear your search.</p>
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((item) => {
            const id = item.id;
            const isChecked = selectedIds.has(id);
            const isOpen = selectedDetailId === id;
            const cfg = statusConfig[item.status] ?? statusConfig.inactive;
            const termsLabel = shortenPaymentTerms(item.payment_terms);
            const statusAccent = ACCOUNT_STATUS_ACCENT[item.status] ?? ACCOUNT_STATUS_ACCENT.inactive;
            const serviceLabels = catalogServiceLabelsForIds(item.catalog_service_ids, catalogServices);
            const industry = item.industry?.trim();
            return (
              <div
                key={id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenAccount(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenAccount(item);
                  }
                }}
                className={cn(
                  "relative rounded-xl border border-l-[3px] text-left outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                  statusAccent,
                  isChecked
                    ? "border-primary bg-primary/[0.04]"
                    : isOpen
                      ? "border-primary/45 bg-primary/[0.02] shadow-sm"
                      : "border-border-light hover:border-primary/30 hover:bg-surface-hover/70 hover:shadow-sm",
                )}
              >
                <div
                  className="absolute left-3 top-3 z-[1]"
                  role="presentation"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <AccountsGridCheckbox checked={isChecked} onChange={() => toggleOne(id)} />
                </div>

                <div className="absolute right-3 top-3 flex items-center gap-2 max-w-[calc(100%-5.5rem)]">
                  <Badge variant={cfg.variant} size="sm" dot className="shrink truncate max-w-full">
                    {cfg.label}
                  </Badge>
                </div>

                <div className="p-4 pt-11 sm:pr-4">
                  <div className="flex gap-3 min-w-0">
                    <Avatar name={item.company_name} size="md" src={item.logo_url ?? undefined} className="shrink-0" />
                    <div className="min-w-0 flex-1 pr-1">
                      <p className="text-sm font-semibold text-text-primary leading-snug truncate">{item.company_name}</p>
                      <p className="text-[11px] text-text-tertiary truncate mt-0.5">{item.contact_name}</p>
                      {serviceLabels.length === 0 && industry ? (
                        <p className="text-[10px] text-text-tertiary truncate mt-1">{industry}</p>
                      ) : null}
                    </div>
                  </div>

                  {serviceLabels.length > 0 ? (
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
                        Services
                      </p>
                      <PartnerTradesIconStrip
                        trades={serviceLabels}
                        catalogServices={catalogServices}
                        maxVisible={6}
                      />
                    </div>
                  ) : null}

                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-light/80 pt-4">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Jobs</dt>
                      <dd
                        className={cn(
                          "text-lg font-semibold tabular-nums",
                          item.active_jobs > 0 ? "text-primary" : "text-text-tertiary",
                        )}
                      >
                        {item.active_jobs}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Revenue</dt>
                      <dd className="text-lg font-bold tabular-nums text-text-primary">{formatCurrency(item.total_revenue)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Credit</dt>
                      <dd
                        className="text-sm font-medium tabular-nums text-text-secondary"
                        title={formatCurrency(item.credit_limit)}
                      >
                        {formatCreditLimitCompact(item.credit_limit)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 pt-3 border-t border-border-light/80 flex flex-wrap items-start justify-between gap-2">
                    <Badge variant="outline" size="sm" className="max-w-[65%] truncate">
                      {termsLabel}
                    </Badge>
                    <div className="text-right min-w-0">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Next payment
                      </span>
                      <span className="inline-block mt-0.5">{renderAccountNextPayment(item, paymentOrgCtx)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-5 py-3 border-t border-border-light">
          <p className="text-xs text-text-tertiary">
            Showing {(page - 1) * ACCOUNTS_LIST_PAGE_SIZE + 1}-{Math.min(page * ACCOUNTS_LIST_PAGE_SIZE, totalItems)} of{" "}
            {totalItems}
          </p>
          <div className="flex items-center gap-1 shrink-0 justify-end">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => onPageChange(pageNum)}
                  className={cn(
                    "h-8 w-8 rounded-lg text-xs font-medium transition-colors shrink-0",
                    page === pageNum
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:bg-surface-tertiary",
                  )}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccountDetailDrawer({
  account,
  loading,
  paymentOrgCtx,
  onClose,
  onAccountUpdated,
}: {
  account: Account | null;
  loading: boolean;
  paymentOrgCtx: AccountPaymentOrgContext;
  onClose: () => void;
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
  const [clientsSearchInput, setClientsSearchInput] = useState("");
  const clientsQueryRef = useRef("");
  const CLIENTS_PAGE_SIZE = 20;
  const [saving, setSaving] = useState(false);
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoCropOpen, setLogoCropOpen] = useState(false);
  const [logoCropFile, setLogoCropFile] = useState<File | null>(null);
  const [uploadingContract, setUploadingContract] = useState(false);
  const [drawerAssignableUsers, setDrawerAssignableUsers] = useState<AssignableUser[]>([]);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [editCatalogServiceIds, setEditCatalogServiceIds] = useState<string[]>([]);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const contractFileRef = useRef<HTMLInputElement>(null);
  const [billingType, setBillingType] = useState<"end_client" | "account">("end_client");
  const [emailIncludeInvoiceOnFinal, setEmailIncludeInvoiceOnFinal] = useState(true);
  const [emailIncludeReportOnFinal, setEmailIncludeReportOnFinal] = useState(true);
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
    default_client_cancel_fee_gbp: "",
  });

  useEffect(() => {
    if (!account) return;
    setBillingType(((account as unknown as Record<string, unknown>).billing_type as "end_client" | "account") ?? "end_client");
    const a = account as unknown as Record<string, unknown>;
    setEmailIncludeInvoiceOnFinal(a.email_include_invoice_on_final !== false);
    setEmailIncludeReportOnFinal(a.email_include_report_on_final !== false);
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
      default_client_cancel_fee_gbp:
        account.default_client_cancel_fee_gbp != null && Number(account.default_client_cancel_fee_gbp) > 0
          ? String(account.default_client_cancel_fee_gbp)
          : "",
    });
    setEditCatalogServiceIds(account.catalog_service_ids ?? []);
  }, [account]);

  useEffect(() => {
    if (!account) return;
    void listActiveAssignableUsers().then(setDrawerAssignableUsers).catch(() => setDrawerAssignableUsers([]));
  }, [account?.id]);

  useEffect(() => {
    if (!account) return;
    void listCatalogServicesForPicker()
      .then(setCatalogServices)
      .catch(() => setCatalogServices([]));
  }, [account?.id]);

  const accountServiceLabels = useMemo(
    () => catalogServiceLabelsForIds(editCatalogServiceIds, catalogServices),
    [editCatalogServiceIds, catalogServices],
  );

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

  /** `searchNorm` omit → use applied `clientsQuery` (pagination). Explicit string for account switch / programmatic loads. */
  const fetchClientsPage = useCallback(async (acct: Account, page: number, searchNorm?: string) => {
    setClientsLoading(true);
    try {
      const searchParam =
        searchNorm !== undefined ? (searchNorm.trim() || undefined) : (clientsQueryRef.current.trim() || undefined);
      const { rows, total, usedFallback } = await listClientsLinkedToAccountPaged(
        acct.id,
        acct.company_name,
        page,
        CLIENTS_PAGE_SIZE,
        searchParam,
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
  }, []);

  // Reset list + search when drawer account changes (or clears)
  useEffect(() => {
    if (!account) {
      setClientsRows([]);
      setClientsTotal(0);
      setClientsPage(0);
      setClientsSearchInput("");
      clientsQueryRef.current = "";
      return;
    }
    setClientsSearchInput("");
    clientsQueryRef.current = "";
    void fetchClientsPage(account, 0, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap only when account identity changes
  }, [account?.id]);

  // Debounced server search from input
  useEffect(() => {
    if (!account) return;
    const delayMs = clientsSearchInput.trim().length > 0 ? 300 : 0;
    const t = window.setTimeout(() => {
      const trimmed = clientsSearchInput.trim();
      clientsQueryRef.current = trimmed;
      void fetchClientsPage(account, 0, trimmed);
    }, delayMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce clientsSearchInput; fetchClientsPage stable
  }, [clientsSearchInput, account?.id]);

  if (!account) {
    return null;
  }

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
    if (editCatalogServiceIds.length === 0) {
      toast.error("Enable at least one trade in Trades & skills.");
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
        billing_type: billingType,
        email_include_invoice_on_final: emailIncludeInvoiceOnFinal,
        email_include_report_on_final: emailIncludeReportOnFinal,
        default_client_cancel_fee_gbp:
          Number(edit.default_client_cancel_fee_gbp) > 0
            ? Math.round(Number(edit.default_client_cancel_fee_gbp) * 100) / 100
            : null,
        catalog_service_ids: editCatalogServiceIds,
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
      headerExtra={
        accountServiceLabels.length > 0 ? (
          <PartnerTradesIconStrip
            trades={accountServiceLabels}
            catalogServices={catalogServices}
            className="max-w-full min-w-0"
          />
        ) : (
          <p className="text-xs text-text-tertiary">No services selected — choose them in Trades &amp; Skills.</p>
        )
      }
      width="w-[min(580px,calc(100vw-1rem))]"
      footer={
        isAdmin && (tab === "overview" || tab === "finance") ? (
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
            { id: "trades", label: "Services" },
            { id: "rates", label: "Rates" },
            { id: "jobs", label: "Jobs", count: jobs.length || undefined },
            { id: "clients", label: "Clients", count: clientsTotal || undefined },
            { id: "finance", label: "Finance", count: invoices.length || undefined },
            { id: "portal", label: "Portal User" },
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
                <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">Default client cancel fee (£)</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={edit.default_client_cancel_fee_gbp}
                  onChange={(e) => setEdit((p) => ({ ...p, default_client_cancel_fee_gbp: e.target.value }))}
                  placeholder="Optional"
                  disabled={saving}
                />
                <p className="text-[10px] text-text-tertiary mt-1">Suggested in Cancel job for clients linked to this account.</p>
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

                {/* Logo — centered like partner avatar */}
                <div className="flex flex-col items-center text-center">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">
                    Logo
                  </label>
                  <Avatar
                    name={account.company_name}
                    size="lg"
                    src={(edit.logo_url.trim() || account.logo_url) ?? undefined}
                    className="shrink-0"
                  />
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    onChange={(ev) => void handleLogoUpload(ev)}
                  />
                  <div className="mt-2 flex flex-col items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-7 px-3"
                      disabled={uploadingLogo || saving}
                      onClick={() => logoFileRef.current?.click()}
                    >
                      {uploadingLogo
                        ? "Uploading…"
                        : (edit.logo_url.trim() || account.logo_url)
                          ? "Change"
                          : "Upload logo"}
                    </Button>
                    {(edit.logo_url.trim() || account.logo_url) ? (
                      <button
                        type="button"
                        disabled={uploadingLogo}
                        onClick={() => void handleRemoveLogo()}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-text-tertiary transition-colors hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1.5">PNG · SVG · max 5MB</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Clients tab ─────────────────────────────────────────── */}
        {tab === "clients" && (
          <div className="space-y-3">
            <SearchInput
              placeholder="Search clients by name, email, phone, address…"
              className="w-full"
              value={clientsSearchInput}
              onChange={(e) => setClientsSearchInput(e.target.value)}
              aria-label="Search clients linked to this account"
            />
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
                {clientsSearchInput.trim() ? (
                  <>
                    <p className="text-sm text-text-tertiary">No clients match your search.</p>
                    <p className="text-xs text-text-tertiary mt-1">Try another name, email or phone fragment.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-text-tertiary">No clients linked to this account yet.</p>
                    <p className="text-xs text-text-tertiary mt-1">Go to Clients and set their Account field to <strong>{account.company_name}</strong>.</p>
                  </>
                )}
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
                      onClick={() => fetchClientsPage(account, clientsPage - 1)}>← Previous</Button>
                    <span className="text-xs text-text-tertiary">
                      {clientsPage * CLIENTS_PAGE_SIZE + 1}–{Math.min((clientsPage + 1) * CLIENTS_PAGE_SIZE, clientsTotal)} of {clientsTotal}
                    </span>
                    <Button variant="outline" size="sm" disabled={(clientsPage + 1) * CLIENTS_PAGE_SIZE >= clientsTotal || clientsLoading}
                      onClick={() => fetchClientsPage(account, clientsPage + 1)}>Next →</Button>
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
            <div className="rounded-2xl border border-border-light bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-text-primary">Billing</p>
                <FixfyHintIcon text="Governs who receives quotes, job confirmations and invoices for this account." placement="bottom-end" />
              </div>

              <div>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                    Send customer emails to
                  </span>
                  <span className="text-[#ED4B00]" aria-hidden>*</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(["end_client", "account"] as const).map((bt) => {
                    const selected = billingType === bt;
                    return (
                      <button
                        key={bt}
                        type="button"
                        onClick={() => setBillingType(bt)}
                        className={cn(
                          "rounded-xl border-2 p-3.5 text-left transition-all bg-card",
                          selected ? "border-[#020040] bg-[#020040]/[0.04]" : "border-border-light hover:border-border",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={cn(
                              "mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0",
                              selected ? "border-[#020040]" : "border-border",
                            )}
                          >
                            {selected ? <div className="h-2 w-2 rounded-full bg-[#020040]" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-text-primary leading-tight">
                                {bt === "end_client" ? "End customer" : "This account"}
                              </p>
                              <FixfyHintIcon
                                placement="bottom-end"
                                label={bt === "end_client" ? "B2C" : "B2B2C"}
                                text={
                                  bt === "end_client"
                                    ? "Quotes, job updates & invoices go to the final customer (their own email). Example: Checkatrade."
                                    : "Quotes, job updates & invoices go to this account (finance/main email). Example: Housekeep."
                                }
                              />
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary mt-1">
                              {bt === "end_client" ? "B2C" : "B2B2C"}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                    When a job is finalised (client email)
                  </span>
                  <FixfyHintIcon
                    text="Controls what the team can put in the completion email on the job. If you handle your own self-bill, you can turn off invoice lines but still receive final report PDFs."
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-start gap-2.5 text-[13px] text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-border"
                      checked={emailIncludeInvoiceOnFinal}
                      onChange={(e) => setEmailIncludeInvoiceOnFinal(e.target.checked)}
                    />
                    <span className="font-medium inline-flex items-center gap-1.5 flex-wrap leading-snug">
                      Include invoice / payment in the email
                      <FixfyHintIcon text="Uncheck if you generate your own self-bill and do not want our invoice copy in the message." />
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 text-[13px] text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-border"
                      checked={emailIncludeReportOnFinal}
                      onChange={(e) => setEmailIncludeReportOnFinal(e.target.checked)}
                    />
                    <span className="font-medium inline-flex items-center gap-1.5 flex-wrap leading-snug">
                      Attach final report PDFs
                      <FixfyHintIcon text="Uncheck to send a notice without report attachments (rare)." />
                    </span>
                  </label>
                </div>
                {!emailIncludeInvoiceOnFinal && !emailIncludeReportOnFinal ? (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 border border-amber-200/80 dark:border-amber-800/60">
                    With both off, final review can only move the job internally (no client email until you re-enable at least one).
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                    Payment Terms
                    <span className="text-[#ED4B00]" aria-hidden>*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setTermsModalOpen(true)}
                    className="w-full flex items-center justify-between rounded-xl border border-border-light bg-surface-hover px-3 py-2.5 hover:bg-surface-tertiary transition-colors text-left"
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {edit.payment_terms ? (
                        shortenPaymentTerms(edit.payment_terms)
                      ) : (
                        <span className="text-text-tertiary">Set payment terms…</span>
                      )}
                    </span>
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Edit</span>
                  </button>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                      Billing Email
                    </span>
                    <span className="text-[#ED4B00]" aria-hidden>*</span>
                    <FixfyHintIcon
                      text={
                        billingType === "account"
                          ? "With \"This account\", quotes, job confirmations and invoices all go here (falls back to the main account email if empty)."
                          : "With \"End customer\", quotes, job confirmations and invoices go to each contact's own email on the client record — not this field."
                      }
                    />
                  </div>
                  <Input
                    type="email"
                    value={edit.finance_email}
                    onChange={(e) => setEdit((p) => ({ ...p, finance_email: e.target.value }))}
                    placeholder="billing@company.com"
                  />
                </div>
              </div>

              {(() => {
                const terms = edit.payment_terms;
                if (!terms) return null;
                const iso = dueDateIsoFromAccountPaymentTerms(new Date(), terms, paymentOrgCtx);
                const label = new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                });
                const isDor = /due\s+on\s+receipt/i.test(terms);
                return (
                  <div className="flex items-start gap-2.5 rounded-xl bg-[#020040]/[0.04] border border-[#020040]/10 px-4 py-3">
                    <Calendar className="h-4 w-4 text-[#020040]/50 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#020040]/50">
                          Next payment date
                        </p>
                        {isDor ? (
                          <FixfyHintIcon text="Due on receipt — same day as job completion." placement="bottom-start" />
                        ) : null}
                      </div>
                      <p className="text-sm font-semibold text-[#020040]">{label}</p>
                    </div>
                  </div>
                );
              })()}
            </div>

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
                <Link href="/finance/billing" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
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

        {/* ── Trades & skills tab ──────────────────────────────────── */}
        {tab === "trades" && account && (
          <CatalogTradesSkillsTab
            kind="account"
            account={account}
            canEdit={isAdmin}
            onAccountUpdate={(a) => {
              onAccountUpdated(a);
              setEditCatalogServiceIds(a.catalog_service_ids ?? []);
            }}
          />
        )}

        {/* ── Rate card tab ────────────────────────────────────────── */}
        {tab === "rates" && account && (
          <AccountServiceRatesTabSection
            accountId={account.id}
            account={{ catalog_service_ids: editCatalogServiceIds }}
          />
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
      paymentOrgCtx={paymentOrgCtx}
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
  open, value, paymentOrgCtx, onClose, onSave,
}: {
  open: boolean;
  value: string;
  paymentOrgCtx: AccountPaymentOrgContext;
  onClose: () => void;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => setLocal(value));
  }, [open, value]);

  const iso = local ? dueDateIsoFromAccountPaymentTerms(new Date(), local, paymentOrgCtx) : null;
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
  const { partnerPayoutStandardTerms, partnerPayoutReferenceYmd } = useFrontendSetup();
  const parsed = parseCycleValue(value);
  const [mode,          setMode]          = useState<"standard" | "cycle">(parsed ? "cycle" : "standard");
  const [freq,          setFreq]          = useState<"monthly" | "biweekly">(parsed?.freq ?? "monthly");
  const [cutoffDay,     setCutoffDay]     = useState(parsed?.cutoffDay ?? "26");
  const [cutoffWeekday, setCutoffWeekday] = useState(parsed?.cutoffWeekday ?? "wednesday");
  const [payWeekday,    setPayWeekday]    = useState(parsed?.payWeekday ?? "friday");
  const [refDate,       setRefDate]       = useState(parsed?.refDate ?? "");

  useEffect(() => {
    const p = parseCycleValue(value);
    queueMicrotask(() => {
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
    });
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
        <div className="space-y-2">
          <Select
            options={PAYMENT_TERMS_OPTIONS}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {isAccountOrgBiweeklyGridTerms(value, partnerPayoutStandardTerms) ? (
            <p className="text-[11px] text-text-secondary leading-snug rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2">
              Uses the same biweekly pay grid as partner self-bills in Setup
              {partnerPayoutReferenceYmd ? ` (reference Friday ${partnerPayoutReferenceYmd})` : ""}.
            </p>
          ) : null}
        </div>
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
