"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";
import {
  UserPlus, Filter, Users, Star, Briefcase, ShieldCheck, MapPin,
  ArrowRight, Mail, Phone, Calendar, DollarSign,
  FileText, Upload, CheckCircle2, XCircle, Clock, AlertTriangle,
  MessageSquare, Send, Trash2, Download, Eye,
  Play, Pause, RotateCcw, KeyRound, MailPlus,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Partner, PartnerStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listPartners, createPartner, updatePartner } from "@/services/partners";
import {
  uploadPartnerDocumentFile,
  uploadPartnerDocumentPreview,
  removeStorageObjects,
  getPartnerDocumentSignedUrl,
} from "@/services/partner-documents-storage";
import { uploadPartnerAvatar } from "@/services/partner-avatar-storage";
import { getStatusCounts } from "@/services/base";
import { getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import type { ListParams } from "@/services/base";
import {
  getTeamMembers,
  getProfileById,
  getJobsByPartnerUserId,
  getLatestLocation,
  getPartnerFinancial,
  type TeamMember,
} from "@/services/partner-detail";
import { LocationMiniMapByCoords } from "@/components/ui/location-picker";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; color: string }> = {
  active: { label: "Active", variant: "success", color: "bg-emerald-50 dark:bg-emerald-950/300" },
  on_break: { label: "On Break", variant: "warning", color: "bg-amber-50 dark:bg-amber-950/300" },
  inactive: { label: "Inactive", variant: "default", color: "bg-stone-400" },
  onboarding: { label: "Onboarding", variant: "info", color: "bg-blue-50 dark:bg-blue-950/300" },
};

const tradeColors: Record<string, string> = {
  HVAC: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 ring-blue-200/50",
  Electrical: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 ring-purple-200/50",
  Plumbing: "bg-teal-50 dark:bg-teal-950/30 text-teal-700 ring-teal-200/50",
  Painting: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 ring-amber-200/50",
  Carpentry: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 ring-emerald-200/50",
  Handyman: "bg-orange-50 dark:bg-orange-950/30 text-orange-700 ring-orange-200/50",
  Cleaning: "bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 ring-cyan-200/50",
  Builder: "bg-stone-50 dark:bg-stone-950/30 text-stone-700 ring-stone-200/50",
  Painter: "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 ring-yellow-200/50",
};

const TRADES = [
  "HVAC", "Electrical", "Plumbing", "Painting", "Carpentry",
  "Handyman", "Cleaning", "Builder", "Painter",
];

interface PartnerJobRow {
  id: string;
  reference: string;
  title: string;
  client_name: string;
  property_address: string;
  status: string;
  progress: number;
  current_phase: number;
  total_phases: number;
  client_price: number;
  partner_cost: number;
  materials_cost: number;
  scheduled_date?: string;
  created_at: string;
}

interface PartnerSelfBill {
  id: string;
  reference: string;
  period: string;
  jobs_count: number;
  job_value: number;
  materials: number;
  commission: number;
  net_payout: number;
  status: string;
  created_at: string;
}

const jobStatusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Draft", variant: "default" },
  scheduled: { label: "Scheduled", variant: "info" },
  in_progress: { label: "In Progress", variant: "primary" },
  on_hold: { label: "On Hold", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

const emptyForm = {
  company_name: "", contact_name: "", email: "", phone: "",
  trades: ["HVAC"] as string[], location: "", status: "active" as PartnerStatus,
};

type ViewMode = "directory" | "team";

export default function PartnersPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("directory");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [selectedTeamMember, setSelectedTeamMember] = useState<TeamMember | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (viewMode === "team") {
      setTeamLoading(true);
      getTeamMembers()
        .then(setTeamMembers)
        .catch(() => toast.error("Failed to load team"))
        .finally(() => setTeamLoading(false));
    }
  }, [viewMode]);

  const fetcher = useCallback(
    (params: ListParams) => listPartners({ ...params, trade: tradeFilter !== "all" ? tradeFilter : undefined }),
    [tradeFilter]
  );

  const { data: partners, loading, page, totalPages, totalItems, setPage, search, setSearch, status: statusFilter, setStatus: setStatusFilter, refresh } =
    useSupabaseList<Partner>({ fetcher, realtimeTable: "partners" });

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("partners", ["active", "inactive", "on_break", "onboarding"]);
      setStatusCounts(counts);
    } catch { /* cosmetic */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { refresh(); }, [tradeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPartners = statusCounts["all"] ?? 0;
  const activeCount = statusCounts["active"] ?? 0;

  async function handleCreate() {
    if (!form.company_name.trim() || !form.contact_name.trim() || !form.email.trim()) {
      toast.error("Please fill in company name, contact name, and email.");
      return;
    }
    setSubmitting(true);
    try {
      const primaryTrade = form.trades[0] ?? TRADES[0];
      await createPartner({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        trade: primaryTrade,
        trades: form.trades,
        status: form.status,
        location: form.location.trim(),
        verified: false,
      });
      setCreateOpen(false);
      setForm(emptyForm);
      refresh();
      await loadCounts();
      toast.success("Partner created successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create partner.");
    } finally {
      setSubmitting(false);
    }
  }

  const handleStatusChange = useCallback(async (partner: Partner, newStatus: PartnerStatus) => {
    try {
      const updated = await updatePartner(partner.id, { status: newStatus });
      setSelectedPartner(updated);
      toast.success(`Partner moved to ${statusConfig[newStatus].label}`);
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }, [refresh, loadCounts]);

  const handleVerify = useCallback(async (partner: Partner) => {
    try {
      const updated = await updatePartner(partner.id, { verified: !partner.verified });
      setSelectedPartner(updated);
      toast.success(updated.verified ? "Partner verified" : "Verification removed");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }, [refresh]);

  const handleBulkStatusChange = useCallback(async (newStatus: PartnerStatus) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("partners")
        .update({ status: newStatus })
        .in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} partners updated to ${statusConfig[newStatus].label}`);
      setSelectedIds(new Set());
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk update failed");
    }
  }, [selectedIds, refresh, loadCounts]);

  const handleBulkVerify = useCallback(async (verified: boolean) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("partners")
        .update({ verified })
        .in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} partners ${verified ? "verified" : "unverified"}`);
      setSelectedIds(new Set());
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk update failed");
    }
  }, [selectedIds, refresh]);

  const columns: Column<Partner>[] = [
    {
      key: "company_name", label: "Partner",
      render: (item) => (
        <div className="flex items-center gap-3">
          <Avatar name={item.company_name} size="md" src={item.avatar_url ?? undefined} />
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-text-primary">{item.company_name}</p>
              {item.verified && <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
            </div>
            <p className="text-[11px] text-text-tertiary">{item.contact_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: "trade", label: "Trade",
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          {(item.trades?.length ? item.trades : [item.trade]).map((t) => (
            <span key={t} className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${tradeColors[t] || "bg-surface-tertiary text-text-primary ring-border"}`}>
              {t}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "location", label: "Location",
      render: (item) => (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary">
          <MapPin className="h-3.5 w-3.5 text-text-tertiary" />{item.location}
        </div>
      ),
    },
    {
      key: "status", label: "Status",
      render: (item) => <Badge variant={statusConfig[item.status].variant} dot>{statusConfig[item.status].label}</Badge>,
    },
    {
      key: "jobs_completed", label: "Jobs", align: "center",
      render: (item) => <span className="text-sm font-semibold text-text-primary">{item.jobs_completed}</span>,
    },
    {
      key: "rating", label: "Rating",
      render: (item) => (
        <div className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
          <span className="text-sm font-semibold text-text-primary">{item.rating}</span>
        </div>
      ),
    },
    {
      key: "total_earnings", label: "Total Earnings", align: "right",
      render: (item) => <span className="text-sm font-semibold text-text-primary">{formatCurrency(item.total_earnings)}</span>,
    },
    {
      key: "actions", label: "", width: "40px",
      render: () => <ArrowRight className="h-4 w-4 text-text-tertiary hover:text-primary transition-colors" />,
    },
  ];

  const selectClasses = "h-9 px-3 rounded-lg border border-border text-sm text-text-secondary bg-card focus:outline-none focus:ring-2 focus:ring-primary/15";

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Partners" subtitle="Manage your partner network and performance.">
          <div className="flex items-center gap-2">
            <Tabs
              tabs={[
                { id: "directory", label: "Directory" },
                { id: "team", label: "Team (App)" },
              ]}
              activeTab={viewMode}
              onChange={(id) => { setViewMode(id as ViewMode); setSelectedPartner(null); setSelectedTeamMember(null); }}
            />
            <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
            <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>Add Partner</Button>
          </div>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Partners" value={totalPartners} format="number" icon={Users} accent="blue" />
          <KpiCard title="Active Partners" value={activeCount} format="number" icon={Briefcase} accent="emerald" />
          <KpiCard title="Team (App)" value={viewMode === "team" ? teamMembers.length : "-"} format="number" icon={Users} accent="primary" />
          <KpiCard title="Compliance Score" value="-" icon={ShieldCheck} accent="primary" />
        </StaggerContainer>

        {viewMode === "team" && (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
            {teamLoading && <div className="text-sm text-text-tertiary">Loading team...</div>}
            {!teamLoading && teamMembers.length === 0 && (
              <div className="py-12 text-center text-text-tertiary">No app partners with jobs yet.</div>
            )}
            {!teamLoading && teamMembers.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {teamMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setSelectedTeamMember(member)}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border-light hover:border-primary/30 hover:bg-surface-hover text-left transition-all"
                  >
                    <Avatar name={member.full_name} size="lg" src={member.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-text-primary truncate">{member.full_name}</p>
                      <p className="text-xs text-text-tertiary truncate">{member.email}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs">
                        <span className="text-text-secondary">{member.jobs_count} jobs</span>
                        <span className="font-medium text-emerald-600">{formatCurrency(member.total_earnings)}</span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-text-tertiary shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {viewMode === "directory" && (
        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClasses}>
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="on_break">On Break</option>
                <option value="inactive">Inactive</option>
                <option value="onboarding">Onboarding</option>
              </select>
              <select value={tradeFilter} onChange={(e) => { setTradeFilter(e.target.value); setPage(1); }} className={selectClasses}>
                <option value="all">All Trades</option>
                {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <SearchInput placeholder="Search partners..." className="w-56" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <DataTable
            columns={columns}
            data={partners}
            getRowId={(item) => item.id}
            selectedId={selectedPartner?.id}
            onRowClick={setSelectedPartner}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={setPage}
            loading={loading}
            selectable={isAdmin}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            bulkActions={
              <>
                <BulkActionBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                <BulkActionBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="danger" />
                <BulkActionBtn label="On Break" onClick={() => handleBulkStatusChange("on_break")} variant="warning" />
                <div className="h-4 w-px bg-border" />
                <BulkActionBtn label="Verify All" onClick={() => handleBulkVerify(true)} variant="success" />
                <BulkActionBtn label="Unverify" onClick={() => handleBulkVerify(false)} variant="default" />
              </>
            }
          />
        </motion.div>
        )}
      </div>

      <PartnerDetailDrawer
        partner={selectedPartner}
        teamMember={selectedTeamMember}
        onClose={() => { setSelectedPartner(null); setSelectedTeamMember(null); }}
        onStatusChange={handleStatusChange}
        onVerify={handleVerify}
        onPartnerUpdate={setSelectedPartner}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Partner" subtitle="Create a new partner in your network.">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Company Name *</label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Acme Corp" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Contact Name *</label>
              <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder="John Doe" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Email *</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@acme.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Phone</label>
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555-000-0000" />
            </div>
          </div>
            <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Trades <span className="text-text-tertiary font-normal">(select all that apply)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {TRADES.map((t) => {
                  const active = form.trades.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, trades: active ? f.trades.filter((x) => x !== t) : [...f.trades, t] }))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${active ? "border-primary bg-primary/10 text-primary" : "border-border-light bg-card text-text-secondary hover:border-border"}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Location</label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Manhattan, NY" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={submitting}>{submitting ? "Creating…" : "Create Partner"}</Button>
        </div>
      </Modal>
    </PageTransition>
  );
}

function BulkActionBtn({ label, onClick, variant }: {
  label: string;
  onClick: () => void;
  variant: "success" | "danger" | "warning" | "default";
}) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border-amber-200",
    default: "text-text-primary bg-surface-hover hover:bg-surface-tertiary border-border",
  };
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}
    >
      {label}
    </button>
  );
}

// ============================================
// Partner Detail Drawer
// ============================================

interface PartnerDoc {
  id: string;
  name: string;
  doc_type: string;
  status: string;
  uploaded_by?: string;
  file_name?: string;
  /** Path inside `partner-documents` bucket */
  file_path?: string | null;
  preview_image_path?: string | null;
  expires_at?: string;
  notes?: string;
  created_at: string;
}

interface PartnerNote {
  id: string;
  content: string;
  author_name?: string;
  created_at: string;
}

const docTypeLabels: Record<string, { label: string; icon: typeof FileText }> = {
  insurance: { label: "Insurance", icon: ShieldCheck },
  certification: { label: "Certification", icon: CheckCircle2 },
  license: { label: "License", icon: FileText },
  contract: { label: "Contract", icon: FileText },
  tax: { label: "Tax Document", icon: DollarSign },
  id_proof: { label: "ID Proof", icon: Users },
  other: { label: "Other", icon: FileText },
};

const docStatusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" | "danger" }> = {
  pending: { label: "Pending Review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  expired: { label: "Expired", variant: "default" },
};

function PartnerDocPreviewThumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPartnerDocumentSignedUrl(path, 3600)
      .then((u) => {
        if (!cancelled) setSrc(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) {
    return <div className="h-10 w-10 rounded-xl bg-surface-tertiary animate-pulse shrink-0" />;
  }
  return (
    <img src={src} alt="" className="h-10 w-10 rounded-xl object-cover border border-border shrink-0" />
  );
}

function AddPartnerDocumentModal({
  open,
  onClose,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (docType: string, name: string, file: File, preview: File | null, expiresAt?: string) => Promise<void>;
}) {
  const [docType, setDocType] = useState("insurance");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setFile(null);
      setPreview(null);
      setExpiresAt("");
      setDocType("insurance");
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a document name");
      return;
    }
    if (!file) {
      toast.error("Choose a document file");
      return;
    }
    void onSubmit(docType, name.trim(), file, preview, expiresAt.trim() ? expiresAt.trim() : undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title="Add document" subtitle="Stored in partner-documents — optional preview image" size="md">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
          >
            {Object.entries(docTypeLabels).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Name *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Public liability 2025" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Expiration date (optional)</label>
          <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <p className="text-[10px] text-text-tertiary mt-1">Used to mark documents as Expired automatically.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Document file *</label>
          <input
            type="file"
            accept=".pdf,.doc,.docx,image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-hover file:text-text-primary"
          />
          <p className="text-[10px] text-text-tertiary mt-1">PDF, Word, or image — max 10 MB.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Preview image (optional)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => setPreview(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-hover file:text-text-primary"
          />
          <p className="text-[10px] text-text-tertiary mt-1">Thumbnail shown in the list — JPEG, PNG, WebP, GIF.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PartnerDocumentDetailModal({
  doc,
  onClose,
}: {
  doc: PartnerDoc | null;
  onClose: () => void;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingUrls, setLoadingUrls] = useState(false);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setLoadingUrls(true);
    Promise.all([
      doc.file_path ? getPartnerDocumentSignedUrl(doc.file_path) : Promise.resolve(null),
      doc.preview_image_path ? getPartnerDocumentSignedUrl(doc.preview_image_path) : Promise.resolve(null),
    ])
      .then(([f, p]) => {
        if (cancelled) return;
        setFileUrl(f);
        setPreviewUrl(p);
      })
      .catch(() => {
        if (cancelled) return;
        setFileUrl(null);
        setPreviewUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingUrls(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc?.id, doc?.file_path, doc?.preview_image_path]);

  if (!doc) return null;
  const typeConfig = docTypeLabels[doc.doc_type] || docTypeLabels.other;
  const statusCfg = docStatusConfig[doc.status] || docStatusConfig.pending;
  const isExpired = !!(doc.expires_at && new Date(doc.expires_at) < new Date());

  return (
    <Modal open={!!doc} onClose={onClose} title={doc.name} subtitle="Document details" size="md">
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant={statusCfg.variant} size="sm">{statusCfg.label}</Badge>
          {isExpired && <Badge variant="danger" size="sm">Expired</Badge>}
          <span className="text-xs text-text-tertiary">{typeConfig.label}</span>
        </div>

        {previewUrl && (
          <div className="rounded-xl border border-border-light overflow-hidden">
            <img src={previewUrl} alt={doc.name} className="w-full max-h-64 object-contain bg-surface-hover" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-surface-hover p-3">
            <p className="text-text-tertiary">File</p>
            <p className="text-text-primary font-medium truncate mt-0.5">{doc.file_name ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-surface-hover p-3">
            <p className="text-text-tertiary">Uploaded</p>
            <p className="text-text-primary font-medium mt-0.5">{new Date(doc.created_at).toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-surface-hover p-3">
            <p className="text-text-tertiary">Expiration date</p>
            <p className={`font-medium mt-0.5 ${isExpired ? "text-red-500" : "text-text-primary"}`}>
              {doc.expires_at ? new Date(doc.expires_at).toLocaleDateString() : "No expiry"}
            </p>
          </div>
          <div className="rounded-lg bg-surface-hover p-3">
            <p className="text-text-tertiary">Uploaded by</p>
            <p className="text-text-primary font-medium mt-0.5">{doc.uploaded_by ?? "—"}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
          {doc.file_path && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingUrls || !fileUrl}
                onClick={() => {
                  if (!fileUrl) return;
                  window.open(fileUrl, "_blank", "noopener,noreferrer");
                }}
                icon={<Eye className="h-3.5 w-3.5" />}
              >
                Open file
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loadingUrls || !fileUrl}
                onClick={() => {
                  if (!fileUrl) return;
                  const a = document.createElement("a");
                  a.href = fileUrl;
                  a.download = doc.file_name || "document";
                  a.target = "_blank";
                  a.rel = "noopener noreferrer";
                  a.click();
                }}
                icon={<Download className="h-3.5 w-3.5" />}
              >
                Download
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PartnerDetailDrawer({
  partner,
  teamMember,
  onClose,
  onStatusChange,
  onVerify,
  onPartnerUpdate,
}: {
  partner: Partner | null;
  teamMember: TeamMember | null;
  onClose: () => void;
  onStatusChange: (partner: Partner, status: PartnerStatus) => void;
  onVerify: (partner: Partner) => void;
  onPartnerUpdate?: (updated: Partner) => void;
}) {
  const [tab, setTab] = useState("overview");
  const [documents, setDocuments] = useState<PartnerDoc[]>([]);
  const [notes, setNotes] = useState<PartnerNote[]>([]);
  const [partnerJobs, setPartnerJobs] = useState<PartnerJobRow[]>([]);
  const [selfBills, setSelfBills] = useState<PartnerSelfBill[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [newNote, setNewNote] = useState("");
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const isAppUserMode = !!teamMember;

  const [appProfile, setAppProfile] = useState<Awaited<ReturnType<typeof getProfileById>>>(null);
  const [appJobs, setAppJobs] = useState<Awaited<ReturnType<typeof getJobsByPartnerUserId>>>([]);
  const [appLocation, setAppLocation] = useState<Awaited<ReturnType<typeof getLatestLocation>>>(null);
  const [appFinancial, setAppFinancial] = useState<Awaited<ReturnType<typeof getPartnerFinancial>> | null>(null);
  const [loadingApp, setLoadingApp] = useState(false);
  const [actionEmail, setActionEmail] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [partnerLocation, setPartnerLocation] = useState<Awaited<ReturnType<typeof getLatestLocation>>>(null);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [addDocSubmitting, setAddDocSubmitting] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const partnerAvatarInputRef = useRef<HTMLInputElement>(null);
  const [selectedDoc, setSelectedDoc] = useState<PartnerDoc | null>(null);
  const [editingOverview, setEditingOverview] = useState(false);
  const [overviewForm, setOverviewForm] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    trades: [TRADES[0]] as string[],
    location: "",
    rating: "",
    compliance_score: "",
  });

  useEffect(() => {
    if (teamMember) {
      setLoadingApp(true);
      Promise.all([
        getProfileById(teamMember.id),
        getJobsByPartnerUserId(teamMember.id),
        getLatestLocation(teamMember.id),
        getPartnerFinancial(teamMember.id),
      ]).then(([prof, jobs, loc, fin]) => {
        setAppProfile(prof);
        setAppJobs(jobs);
        setAppLocation(loc);
        setAppFinancial(fin);
      }).finally(() => setLoadingApp(false));
    }
  }, [teamMember?.id]);

  const loadAll = useCallback(async (p: Partner) => {
    const supabase = getSupabase();
    const partnerIdOrUser = p.auth_user_id ?? p.id;

    setLoadingJobs(true);
    supabase.from("jobs").select("*")
      .or(`partner_id.eq.${partnerIdOrUser},partner_name.eq.${p.company_name}`)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setPartnerJobs((data ?? []) as PartnerJobRow[]); setLoadingJobs(false); }, () => setLoadingJobs(false));

    setLoadingFinance(true);
    supabase.from("self_bills").select("*")
      .eq("partner_name", p.company_name)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setSelfBills((data ?? []) as PartnerSelfBill[]); setLoadingFinance(false); }, () => setLoadingFinance(false));

    setLoadingDocs(true);
    supabase.from("partner_documents").select("*")
      .eq("partner_id", p.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setDocuments((data ?? []) as PartnerDoc[]); setLoadingDocs(false); }, () => setLoadingDocs(false));

    setLoadingNotes(true);
    supabase.from("partner_notes").select("*")
      .eq("partner_id", p.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setNotes((data ?? []) as PartnerNote[]); setLoadingNotes(false); }, () => setLoadingNotes(false));

    if (p.auth_user_id) {
      getLatestLocation(p.auth_user_id).then(setPartnerLocation);
    } else {
      setPartnerLocation(null);
    }
  }, []);

  useEffect(() => {
    if (partner) {
      setTab("overview");
      setSelectedDoc(null);
      loadAll(partner);
      setEditingOverview(false);
      setOverviewForm({
        company_name: partner.company_name ?? "",
        contact_name: partner.contact_name ?? "",
        email: partner.email ?? "",
        phone: partner.phone ?? "",
        trades: partner.trades?.length ? partner.trades : [partner.trade ?? TRADES[0]],
        location: partner.location ?? "",
        rating: String(partner.rating ?? 0),
        compliance_score: String(partner.compliance_score ?? 0),
      });
    }
  }, [partner, loadAll]);

  const handleSaveOverview = useCallback(async () => {
    if (!partner) return;
    if (!overviewForm.company_name.trim() || !overviewForm.contact_name.trim() || !overviewForm.email.trim()) {
      toast.error("Company name, contact name and email are required.");
      return;
    }
    const rating = Number(overviewForm.rating || "0");
    const compliance = Number(overviewForm.compliance_score || "0");
    if (Number.isNaN(rating) || rating < 0 || rating > 5) {
      toast.error("Rating must be between 0 and 5.");
      return;
    }
    if (Number.isNaN(compliance) || compliance < 0 || compliance > 100) {
      toast.error("Compliance must be between 0 and 100.");
      return;
    }
    try {
      const primaryTrade = overviewForm.trades[0] ?? TRADES[0];
      const updated = await updatePartner(partner.id, {
        company_name: overviewForm.company_name.trim(),
        contact_name: overviewForm.contact_name.trim(),
        email: overviewForm.email.trim(),
        phone: overviewForm.phone.trim() || undefined,
        trade: primaryTrade,
        trades: overviewForm.trades,
        location: overviewForm.location.trim(),
        rating,
        compliance_score: compliance,
      });
      onPartnerUpdate?.(updated);
      setEditingOverview(false);
      toast.success("Partner updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }, [partner, overviewForm, onPartnerUpdate]);

  const handleAddDocument = async (docType: string, name: string, file: File, previewFile: File | null, expiresAt?: string) => {
    if (!partner) return;
    const supabase = getSupabase();
    setAddDocSubmitting(true);
    try {
      const expiresIso = expiresAt && expiresAt.trim() ? new Date(expiresAt).toISOString() : null;
      const { data: row, error: insErr } = await supabase
        .from("partner_documents")
        .insert({
          partner_id: partner.id,
          name,
          doc_type: docType,
          status: "pending",
          uploaded_by: profile?.full_name,
          expires_at: expiresIso,
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      if (!row?.id) throw new Error("No document row");

      try {
        const main = await uploadPartnerDocumentFile(partner.id, row.id, file);
        let previewPath: string | null = null;
        if (previewFile) {
          const prev = await uploadPartnerDocumentPreview(partner.id, row.id, previewFile);
          previewPath = prev.path;
        }
        const { error: upErr } = await supabase
          .from("partner_documents")
          .update({
            file_path: main.path,
            file_name: main.fileName,
            preview_image_path: previewPath,
          })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
      } catch (uploadErr) {
        try {
          const folder = `${partner.id}/${row.id}`;
          const { data: list } = await supabase.storage.from("partner-documents").list(folder);
          const paths = (list ?? []).map((f) => `${folder}/${f.name}`);
          if (paths.length > 0) await removeStorageObjects(paths);
        } catch {
          /* ignore */
        }
        await supabase.from("partner_documents").delete().eq("id", row.id);
        throw uploadErr;
      }

      toast.success("Document uploaded");
      setAddDocOpen(false);
      supabase.from("partner_documents").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }).then(({ data }) => setDocuments((data ?? []) as PartnerDoc[]));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setAddDocSubmitting(false);
    }
  };

  const handleDocStatusChange = async (docId: string, newStatus: string) => {
    if (!partner) return;
    const supabase = getSupabase();
    try {
      await supabase.from("partner_documents").update({ status: newStatus }).eq("id", docId);
      toast.success(`Document ${newStatus}`);
      supabase.from("partner_documents").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }).then(({ data }) => setDocuments((data ?? []) as PartnerDoc[]));
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!partner) return;
    const doc = documents.find((d) => d.id === docId);
    const supabase = getSupabase();
    try {
      const paths = [doc?.file_path, doc?.preview_image_path].filter(Boolean) as string[];
      if (paths.length > 0) {
        try {
          await removeStorageObjects(paths);
        } catch {
          /* still remove DB row */
        }
      }
      await supabase.from("partner_documents").delete().eq("id", docId);
      toast.success("Document removed");
      supabase.from("partner_documents").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }).then(({ data }) => setDocuments((data ?? []) as PartnerDoc[]));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleAddNote = async () => {
    if (!partner || !newNote.trim()) return;
    const supabase = getSupabase();
    try {
      await supabase.from("partner_notes").insert({ partner_id: partner.id, content: newNote.trim(), author_name: profile?.full_name, author_id: profile?.id });
      setNewNote("");
      toast.success("Note added");
      supabase.from("partner_notes").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }).then(({ data }) => setNotes((data ?? []) as PartnerNote[]));
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  if (!partner && !teamMember) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  if (teamMember) {
    const appTabs = [
      { id: "profile", label: "Profile" },
      { id: "jobs", label: "Jobs", count: appJobs.length },
      { id: "location", label: "Location" },
      { id: "financial", label: "Financial" },
      { id: "actions", label: "Actions" },
    ];
    return (
      <Drawer open={true} onClose={onClose} title={teamMember.full_name} subtitle={teamMember.email} width="w-[620px]">
        <div className="px-6 pt-3 pb-0 border-b border-border-light">
          <Tabs tabs={appTabs} activeTab={tab} onChange={setTab} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {tab === "profile" && (
            <div className="p-6 space-y-4">
              {loadingApp && !appProfile ? <div className="animate-pulse h-24 bg-surface-hover rounded-xl" /> : appProfile && (
                <>
                  <div className="flex items-center gap-4">
                    <Avatar name={appProfile.full_name} size="xl" src={appProfile.avatar_url} />
                    <div>
                      <p className="font-semibold text-text-primary">{appProfile.full_name}</p>
                      <p className="text-sm text-text-tertiary">{appProfile.email}</p>
                      <Badge variant="default" size="sm">{appProfile.role}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2 text-text-secondary"><Mail className="h-4 w-4" />{appProfile.email}</div>
                    {appProfile.phone && <div className="flex items-center gap-2 text-text-secondary"><Phone className="h-4 w-4" />{appProfile.phone}</div>}
                  </div>
                </>
              )}
            </div>
          )}
          {tab === "jobs" && (
            <div className="p-6 space-y-4">
              <p className="text-sm font-semibold text-text-primary">{appJobs.length} jobs</p>
              {loadingApp ? <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="animate-pulse h-20 bg-surface-hover rounded-xl" />)}</div> : appJobs.length === 0 ? (
                <p className="text-sm text-text-tertiary">No jobs</p>
              ) : appJobs.slice(0, 20).map((job) => {
                const jConfig = jobStatusConfig[job.status] ?? { label: job.status, variant: "default" as const };
                return (
                  <div key={job.id} className="p-4 rounded-xl border border-border-light">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">{job.reference}</span>
                      <Badge variant={jConfig.variant} size="sm">{jConfig.label}</Badge>
                    </div>
                    <p className="text-xs text-text-tertiary mt-0.5">{job.title} — {job.client_name}</p>
                    <p className="text-xs text-emerald-600 mt-1">{formatCurrency(Number(job.partner_cost))}</p>
                  </div>
                );
              })}
            </div>
          )}
          {tab === "location" && (
            <div className="p-6 space-y-4">
              <p className="text-sm font-semibold text-text-primary">Live location (from app)</p>
              {loadingApp && !appLocation ? <div className="animate-pulse h-48 bg-surface-hover rounded-xl" /> : appLocation ? (
                <>
                  <LocationMiniMapByCoords
                    latitude={Number(appLocation.latitude)}
                    longitude={Number(appLocation.longitude)}
                    label={`Last update: ${new Date(appLocation.created_at).toLocaleString()}`}
                  />
                </>
              ) : <p className="text-sm text-text-tertiary">No recent location</p>}
            </div>
          )}
          {tab === "financial" && appFinancial && (
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-surface-hover">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase">Earned (jobs)</p>
                  <p className="text-lg font-bold text-text-primary mt-1">{formatCurrency(appFinancial.total_earned)}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100">
                  <p className="text-[10px] font-semibold text-emerald-700 uppercase">Paid</p>
                  <p className="text-lg font-bold text-emerald-700 mt-1">{formatCurrency(appFinancial.total_paid)}</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-100">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase">Pending</p>
                  <p className="text-lg font-bold text-amber-700 mt-1">{formatCurrency(appFinancial.pending_payout)}</p>
                </div>
              </div>
              <p className="text-xs text-text-tertiary">{appFinancial.jobs_count} jobs, {appFinancial.completed_count} completed · {appFinancial.self_bills_count} self-bills</p>
            </div>
          )}
          {tab === "actions" && isAdmin && (
            <div className="p-6 space-y-5">
              <p className="text-sm font-semibold text-text-primary">Admin actions</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Change email</label>
                  <div className="flex gap-2">
                    <Input value={actionEmail} onChange={(e) => setActionEmail(e.target.value)} placeholder="New email" type="email" className="flex-1" />
                    <Button size="sm" disabled={actionSubmitting || !actionEmail.trim()} onClick={async () => {
                      setActionSubmitting(true);
                      try {
                        const res = await fetch("/api/admin/partner/update-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: teamMember.id, newEmail: actionEmail.trim() }) });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Failed");
                        toast.success("Email updated");
                        setActionEmail("");
                      } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setActionSubmitting(false); }
                    }}>Update</Button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Reset password</label>
                  <Button size="sm" variant="outline" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={actionSubmitting} onClick={async () => {
                    setActionSubmitting(true);
                    try {
                      const res = await fetch("/api/admin/partner/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: teamMember.id }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success(data.reset_link ? "Link generated" : data.message);
                      if (data.reset_link) navigator.clipboard?.writeText(data.reset_link);
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setActionSubmitting(false); }
                  }}>Generate reset link</Button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Send email</label>
                  <Button size="sm" variant="outline" icon={<MailPlus className="h-3.5 w-3.5" />} disabled={actionSubmitting} onClick={async () => {
                    setActionSubmitting(true);
                    try {
                      const res = await fetch("/api/admin/partner/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: teamMember.id }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      if (data.mailto) window.location.href = data.mailto;
                      else toast.success("Email: " + data.email);
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setActionSubmitting(false); }
                  }}>Open mail client</Button>
                </div>
              </div>
            </div>
          )}
          {tab === "actions" && !isAdmin && <div className="p-6 text-sm text-text-tertiary">Admin only</div>}
        </div>
      </Drawer>
    );
  }

  if (!partner) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[partner.status];
  const statusActions = getPartnerStatusActions(partner.status);

  const realJobsCount = partnerJobs.length;
  const completedJobs = partnerJobs.filter((j) => j.status === "completed").length;
  const activeJobs = partnerJobs.filter((j) => j.status === "in_progress").length;
  const realEarnings = partnerJobs.reduce((s, j) => s + Number(j.partner_cost || 0), 0);
  const totalJobValue = partnerJobs.reduce((s, j) => s + Number(j.client_price || 0), 0);
  const totalPaidOut = selfBills.filter((s) => s.status === "paid").reduce((s, sb) => s + Number(sb.net_payout), 0);
  const pendingPayout = selfBills.filter((s) => s.status === "awaiting_payment" || s.status === "ready_to_pay").reduce((s, sb) => s + Number(sb.net_payout), 0);
  const now = new Date();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const expiredDocs = documents.filter((d) => d.expires_at && new Date(d.expires_at) < now);
  const expiringSoonDocs = documents.filter((d) => d.expires_at && new Date(d.expires_at) >= now && new Date(d.expires_at) <= in30Days);
  const auditRequiredBills = selfBills.filter((s) => s.status === "audit_required");
  const pendingBills = selfBills.filter((s) => s.status === "awaiting_payment" || s.status === "ready_to_pay");
  const overduePendingBills = pendingBills.filter((s) => {
    const created = new Date(s.created_at);
    const ageMs = now.getTime() - created.getTime();
    return ageMs > 14 * 24 * 60 * 60 * 1000;
  });
  const overviewAlerts: { key: string; level: "danger" | "warning"; text: string }[] = [];
  if (expiredDocs.length > 0) {
    overviewAlerts.push({
      key: "docs-expired",
      level: "danger",
      text: `${expiredDocs.length} document(s) expired and require renewal.`,
    });
  }
  if (expiringSoonDocs.length > 0) {
    overviewAlerts.push({
      key: "docs-expiring",
      level: "warning",
      text: `${expiringSoonDocs.length} document(s) will expire in the next 30 days.`,
    });
  }
  if (Number(partner.rating ?? 0) > 0 && Number(partner.rating ?? 0) < 3) {
    overviewAlerts.push({
      key: "low-rating",
      level: "warning",
      text: `Low rating (${partner.rating}/5). Review service quality and feedback.`,
    });
  }
  if (Number(partner.compliance_score ?? 0) < 70) {
    overviewAlerts.push({
      key: "low-compliance",
      level: "warning",
      text: `Compliance score is ${partner.compliance_score}%. Follow up on missing requirements.`,
    });
  }
  if (overduePendingBills.length > 0) {
    overviewAlerts.push({
      key: "overdue-payments",
      level: "danger",
      text: `${overduePendingBills.length} payment(s) overdue (>14 days) in self-bills.`,
    });
  } else if (pendingBills.length > 0) {
    overviewAlerts.push({
      key: "pending-payments",
      level: "warning",
      text: `${pendingBills.length} payment(s) pending in self-bills.`,
    });
  }
  if (auditRequiredBills.length > 0) {
    overviewAlerts.push({
      key: "audit-required",
      level: "danger",
      text: `${auditRequiredBills.length} self-bill(s) require audit.`,
    });
  }

  const drawerTabs = [
    { id: "overview", label: "Overview" },
    { id: "internal", label: "Internal" },
    { id: "jobs", label: "Jobs", count: realJobsCount },
    ...(partner.auth_user_id ? [{ id: "location" as const, label: "Location" }] : []),
    { id: "financial", label: "Financial", count: selfBills.length },
    ...(partner.auth_user_id ? [{ id: "actions" as const, label: "Actions" }] : []),
    { id: "documents", label: "Documents", count: documents.length },
    { id: "notes", label: "Notes", count: notes.length },
  ];

  return (
    <Drawer open={!!partner} onClose={onClose} title={partner.company_name} subtitle={partner.trade + " — " + partner.location} width="w-[580px]">
      <div className="px-6 pt-3 pb-0 border-b border-border-light">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ========== OVERVIEW ========== */}
        {tab === "overview" && (
          <div className="p-6 space-y-5">
            {overviewAlerts.length > 0 && (
              <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <p className="text-sm font-semibold text-text-primary">Attention alerts</p>
                </div>
                <div className="space-y-1.5">
                  {overviewAlerts.map((a) => (
                    <div key={a.key} className="flex items-start gap-2">
                      <span className={`mt-1 h-1.5 w-1.5 rounded-full ${a.level === "danger" ? "bg-red-500" : "bg-amber-500"}`} />
                      <p className={`text-xs ${a.level === "danger" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>{a.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-2 shrink-0">
                <Avatar name={partner.company_name} size="xl" src={partner.avatar_url ?? undefined} />
                <input
                  ref={partnerAvatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f || !partner) return;
                    setUploadingAvatar(true);
                    try {
                      const url = await uploadPartnerAvatar(partner.id, f);
                      const updated = await updatePartner(partner.id, { avatar_url: url });
                      onPartnerUpdate?.(updated);
                      toast.success("Photo saved");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Upload failed");
                    } finally {
                      setUploadingAvatar(false);
                      e.target.value = "";
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-[11px] h-8"
                  disabled={uploadingAvatar}
                  onClick={() => partnerAvatarInputRef.current?.click()}
                >
                  {uploadingAvatar ? "…" : "Photo"}
                </Button>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  {editingOverview ? (
                    <Input
                      value={overviewForm.company_name}
                      onChange={(e) => setOverviewForm((p) => ({ ...p, company_name: e.target.value }))}
                      className="h-9"
                    />
                  ) : (
                    <h3 className="text-lg font-bold text-text-primary">{partner.company_name}</h3>
                  )}
                  {partner.verified && <ShieldCheck className="h-4 w-4 text-emerald-500" />}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant={editingOverview ? "outline" : "ghost"}
                      onClick={() => {
                        if (editingOverview) {
                          setEditingOverview(false);
                          setOverviewForm({
                            company_name: partner.company_name ?? "",
                            contact_name: partner.contact_name ?? "",
                            email: partner.email ?? "",
                            phone: partner.phone ?? "",
                            trades: partner.trades?.length ? partner.trades : [partner.trade ?? TRADES[0]],
                            location: partner.location ?? "",
                            rating: String(partner.rating ?? 0),
                            compliance_score: String(partner.compliance_score ?? 0),
                          });
                        } else {
                          setEditingOverview(true);
                        }
                      }}
                    >
                      {editingOverview ? "Cancel" : "Edit"}
                    </Button>
                  )}
                </div>
                {editingOverview ? (
                  <div className="mt-2 space-y-2">
                    <Input
                      value={overviewForm.contact_name}
                      onChange={(e) => setOverviewForm((p) => ({ ...p, contact_name: e.target.value }))}
                      placeholder="Contact name"
                    />
                    <div>
                      <p className="text-[10px] font-medium text-text-tertiary mb-1.5">Trades (select all that apply)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {TRADES.map((t) => {
                          const active = overviewForm.trades.includes(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setOverviewForm((p) => ({ ...p, trades: active ? p.trades.filter((x) => x !== t) : [...p.trades, t] }))}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${active ? "border-primary bg-primary/10 text-primary" : "border-border-light bg-card text-text-secondary hover:border-border"}`}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary">{partner.contact_name}</p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant={config.variant} dot size="md">{config.label}</Badge>
                  {(editingOverview ? overviewForm.trades : (partner.trades?.length ? partner.trades : [partner.trade])).map((t) => (
                    <span key={t} className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${tradeColors[t] || "bg-surface-tertiary text-text-primary ring-border"}`}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Mail className="h-4 w-4 text-text-tertiary" />
                {editingOverview ? (
                  <Input
                    type="email"
                    value={overviewForm.email}
                    onChange={(e) => setOverviewForm((p) => ({ ...p, email: e.target.value }))}
                    className="h-8"
                  />
                ) : partner.email}
              </div>
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Phone className="h-4 w-4 text-text-tertiary" />
                {editingOverview ? (
                  <Input
                    type="tel"
                    value={overviewForm.phone}
                    onChange={(e) => setOverviewForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Phone"
                    className="h-8"
                  />
                ) : (partner.phone || "—")}
              </div>
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <MapPin className="h-4 w-4 text-text-tertiary" />
                {editingOverview ? (
                  <Input
                    value={overviewForm.location}
                    onChange={(e) => setOverviewForm((p) => ({ ...p, location: e.target.value }))}
                    className="h-8"
                  />
                ) : partner.location}
              </div>
              <div className="flex items-center gap-2 text-sm text-text-secondary"><Calendar className="h-4 w-4 text-text-tertiary" />Joined {new Date(partner.joined_at).toLocaleDateString()}</div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Jobs</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : realJobsCount}</p>
                <p className="text-[10px] text-text-tertiary">{completedJobs} completed, {activeJobs} active</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Earned</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : formatCurrency(realEarnings)}</p>
                <p className="text-[10px] text-text-tertiary">from partner cost</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job Value</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : formatCurrency(totalJobValue)}</p>
                <p className="text-[10px] text-text-tertiary">total client value</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Rating</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  {editingOverview ? (
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      step="0.1"
                      value={overviewForm.rating}
                      onChange={(e) => setOverviewForm((p) => ({ ...p, rating: e.target.value }))}
                      className="h-8 w-24"
                    />
                  ) : (
                    <span className="text-xl font-bold text-text-primary">{partner.rating}</span>
                  )}
                  <span className="text-xs text-text-tertiary">/5.0</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Compliance</p>
                <div className="mt-1">
                  {editingOverview ? (
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={overviewForm.compliance_score}
                      onChange={(e) => setOverviewForm((p) => ({ ...p, compliance_score: e.target.value }))}
                      className="h-8 w-24"
                    />
                  ) : (
                    <span className="text-xl font-bold text-text-primary">{partner.compliance_score}%</span>
                  )}
                  <Progress
                    value={editingOverview ? Number(overviewForm.compliance_score || 0) : partner.compliance_score}
                    size="sm"
                    color={(editingOverview ? Number(overviewForm.compliance_score || 0) : partner.compliance_score) >= 90 ? "emerald" : (editingOverview ? Number(overviewForm.compliance_score || 0) : partner.compliance_score) >= 70 ? "primary" : "amber"}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
            {isAdmin && editingOverview && (
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleSaveOverview}>Save changes</Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setEditingOverview(false);
                    setOverviewForm({
                      company_name: partner.company_name ?? "",
                      contact_name: partner.contact_name ?? "",
                      email: partner.email ?? "",
                      phone: partner.phone ?? "",
                      trades: partner.trades?.length ? partner.trades : [partner.trade ?? TRADES[0]],
                      location: partner.location ?? "",
                      rating: String(partner.rating ?? 0),
                      compliance_score: String(partner.compliance_score ?? 0),
                    });
                  }}
                >
                  Discard
                </Button>
              </div>
            )}

            <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-border-light">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Verification Status</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{partner.verified ? "Verified and approved" : "Not verified yet"}</p>
                </div>
                <Button size="sm" variant={partner.verified ? "outline" : "primary"} icon={partner.verified ? <XCircle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} onClick={() => onVerify(partner)}>
                  {partner.verified ? "Revoke" : "Verify"}
                </Button>
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-border-light">
              {statusActions.map((action) => (
                <Button key={action.status} variant={action.primary ? "primary" : "outline"} className="flex-1" size="sm" icon={<action.icon className="h-3.5 w-3.5" />} onClick={() => onStatusChange(partner, action.status)}>
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* ========== INTERNAL PROFILE ========== */}
        {tab === "internal" && (
          <InternalProfileTab partner={partner} onUpdate={async (updates) => {
            try {
              const updated = await updatePartner(partner.id, updates);
              onPartnerUpdate?.(updated);
              toast.success("Internal profile updated");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to update");
            }
          }} />
        )}

        {/* ========== JOBS ========== */}
        {tab === "jobs" && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">{realJobsCount} Jobs</p>
                <p className="text-xs text-text-tertiary">{completedJobs} completed, {activeJobs} in progress</p>
              </div>
            </div>

            {loadingJobs && (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="animate-pulse h-20 bg-surface-hover rounded-xl" />)}
              </div>
            )}

            {!loadingJobs && partnerJobs.length === 0 && (
              <div className="py-12 text-center">
                <Briefcase className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No jobs found for this partner</p>
              </div>
            )}

            {!loadingJobs && partnerJobs.map((job) => {
              const jConfig = jobStatusConfig[job.status] || { label: job.status, variant: "default" as const };
              const profit = Number(job.client_price) - Number(job.partner_cost) - Number(job.materials_cost);
              return (
                <motion.div key={job.id} variants={staggerItem} className="p-4 rounded-xl border border-border-light hover:border-border transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-text-primary">{job.reference}</p>
                        <Badge variant={jConfig.variant} dot size="sm">{jConfig.label}</Badge>
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">{job.title}</p>
                      <p className="text-xs text-text-tertiary">{job.client_name} — {job.property_address}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Client Price</p>
                      <p className="text-sm font-semibold text-text-primary">{formatCurrency(Number(job.client_price))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Partner Cost</p>
                      <p className="text-sm font-semibold text-emerald-600">{formatCurrency(Number(job.partner_cost))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Materials</p>
                      <p className="text-sm font-semibold text-text-primary">{formatCurrency(Number(job.materials_cost))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Profit</p>
                      <p className={`text-sm font-semibold ${profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatCurrency(profit)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <Progress value={job.progress} size="sm" color={job.progress === 100 ? "emerald" : "primary"} className="flex-1" />
                    <span className="text-xs font-medium text-text-tertiary">{job.progress}%</span>
                    <span className="text-[10px] text-text-tertiary">
                      Phase {job.current_phase}/{Math.max(job.total_phases, 1)}
                    </span>
                  </div>
                  {job.scheduled_date && <p className="text-[10px] text-text-tertiary mt-2">Scheduled: {new Date(job.scheduled_date).toLocaleDateString()}</p>}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ========== FINANCIAL ========== */}
        {tab === "financial" && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100">
                <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Total Paid</p>
                <p className="text-lg font-bold text-emerald-700 mt-1">{formatCurrency(totalPaidOut)}</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-100">
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Pending</p>
                <p className="text-lg font-bold text-amber-700 mt-1">{formatCurrency(pendingPayout)}</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100">
                <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Earned (Jobs)</p>
                <p className="text-lg font-bold text-blue-700 mt-1">{formatCurrency(realEarnings)}</p>
              </div>
            </div>

            <p className="text-sm font-semibold text-text-primary">{selfBills.length} Self-Bills</p>

            {loadingFinance && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-surface-hover rounded-xl" />)}
              </div>
            )}

            {!loadingFinance && selfBills.length === 0 && (
              <div className="py-10 text-center">
                <DollarSign className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No self-bills found</p>
              </div>
            )}

            {!loadingFinance && selfBills.map((sb) => (
              <motion.div key={sb.id} variants={staggerItem} className="p-4 rounded-xl border border-border-light hover:border-border transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-text-primary">{sb.reference}</p>
                    <Badge variant={sb.status === "paid" ? "success" : sb.status === "audit_required" ? "danger" : sb.status === "ready_to_pay" ? "info" : "warning"} size="sm" dot>
                      {sb.status === "paid" ? "Paid" : sb.status === "audit_required" ? "Audit Required" : sb.status === "ready_to_pay" ? "Ready to Pay" : "Awaiting Payment"}
                    </Badge>
                  </div>
                  <span className="text-xs text-text-tertiary">{sb.period}</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Jobs</p>
                    <p className="text-sm font-semibold text-text-primary">{sb.jobs_count}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Job Value</p>
                    <p className="text-sm font-semibold text-text-primary">{formatCurrency(Number(sb.job_value))}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Commission</p>
                    <p className="text-sm font-semibold text-red-500">-{formatCurrency(Number(sb.commission))}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Net Payout</p>
                    <p className="text-sm font-bold text-emerald-600">{formatCurrency(Number(sb.net_payout))}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* ========== LOCATION (directory partner with app user link) ========== */}
        {tab === "location" && partner.auth_user_id && (
          <div className="p-6 space-y-4">
            <p className="text-sm font-semibold text-text-primary">Live location (from app)</p>
            {partnerLocation ? (
              <LocationMiniMapByCoords
                latitude={Number(partnerLocation.latitude)}
                longitude={Number(partnerLocation.longitude)}
                label={`Last update: ${new Date(partnerLocation.created_at).toLocaleString()}`}
              />
            ) : <p className="text-sm text-text-tertiary">No recent location</p>}
          </div>
        )}

        {/* ========== ACTIONS (directory partner with app user link) ========== */}
        {tab === "actions" && partner.auth_user_id && isAdmin && (
          <div className="p-6 space-y-5">
            <p className="text-sm font-semibold text-text-primary">Admin actions</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Change email</label>
                <div className="flex gap-2">
                  <Input value={actionEmail} onChange={(e) => setActionEmail(e.target.value)} placeholder="New email" type="email" className="flex-1" />
                  <Button size="sm" disabled={actionSubmitting || !actionEmail.trim()} onClick={async () => {
                    setActionSubmitting(true);
                    try {
                      const res = await fetch("/api/admin/partner/update-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: partner.auth_user_id, newEmail: actionEmail.trim() }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success("Email updated");
                      setActionEmail("");
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setActionSubmitting(false); }
                  }}>Update</Button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Reset password</label>
                <Button size="sm" variant="outline" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={actionSubmitting} onClick={async () => {
                  setActionSubmitting(true);
                  try {
                    const res = await fetch("/api/admin/partner/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: partner.auth_user_id }) });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed");
                    toast.success(data.reset_link ? "Link generated" : data.message);
                    if (data.reset_link) navigator.clipboard?.writeText(data.reset_link);
                  } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setActionSubmitting(false); }
                }}>Generate reset link</Button>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Send email</label>
                <Button size="sm" variant="outline" icon={<MailPlus className="h-3.5 w-3.5" />} disabled={actionSubmitting} onClick={async () => {
                  setActionSubmitting(true);
                  try {
                    const res = await fetch("/api/admin/partner/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: partner.auth_user_id }) });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed");
                    if (data.mailto) window.location.href = data.mailto;
                    else toast.success("Email: " + data.email);
                  } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setActionSubmitting(false); }
                }}>Open mail client</Button>
              </div>
            </div>
          </div>
        )}

        {/* ========== DOCUMENTS ========== */}
        {tab === "documents" && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{documents.length} Documents</p>
              <Button size="sm" variant="outline" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setAddDocOpen(true)}>
                Add document
              </Button>
            </div>
            <AddPartnerDocumentModal
              open={addDocOpen}
              onClose={() => setAddDocOpen(false)}
              submitting={addDocSubmitting}
              onSubmit={handleAddDocument}
            />
            <PartnerDocumentDetailModal doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
            {loadingDocs && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-surface-hover rounded-xl" />)}</div>}
            {!loadingDocs && documents.length === 0 && (
              <div className="py-12 text-center">
                <FileText className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No documents uploaded yet</p>
                <p className="text-xs text-text-tertiary mt-1">Add insurance, certifications, licenses and more</p>
              </div>
            )}
            {!loadingDocs && documents.map((doc) => {
              const typeConfig = docTypeLabels[doc.doc_type] || docTypeLabels.other;
              const sConfig = docStatusConfig[doc.status] || docStatusConfig.pending;
              const Icon = typeConfig.icon;
              const isExpired = doc.expires_at && new Date(doc.expires_at) < new Date();
              return (
                <motion.div
                  key={doc.id}
                  variants={staggerItem}
                  className="p-4 rounded-xl border border-border-light hover:border-border transition-colors cursor-pointer"
                  onClick={() => setSelectedDoc(doc)}
                >
                  <div className="flex items-start gap-3">
                    {doc.preview_image_path ? (
                      <PartnerDocPreviewThumb path={doc.preview_image_path} />
                    ) : (
                      <div className="h-10 w-10 rounded-xl bg-surface-tertiary flex items-center justify-center shrink-0">
                        <Icon className="h-5 w-5 text-text-secondary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{doc.name}</p>
                        <Badge variant={sConfig.variant} size="sm">{sConfig.label}</Badge>
                        {isExpired && <Badge variant="danger" size="sm">Expired</Badge>}
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">{typeConfig.label}</p>
                      {doc.file_name && <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{doc.file_name}</p>}
                      {doc.expires_at && <p className={`text-xs mt-0.5 ${isExpired ? "text-red-500" : "text-text-tertiary"}`}>Expires: {new Date(doc.expires_at).toLocaleDateString()}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {doc.file_path && (
                        <>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const u = await getPartnerDocumentSignedUrl(doc.file_path!);
                                window.open(u, "_blank", "noopener,noreferrer");
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Could not open file");
                              }
                            }}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-primary transition-colors"
                            title="Open file"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const u = await getPartnerDocumentSignedUrl(doc.file_path!);
                                const a = document.createElement("a");
                                a.href = u;
                                a.download = doc.file_name || "document";
                                a.target = "_blank";
                                a.rel = "noopener noreferrer";
                                a.click();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Download failed");
                              }
                            }}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-primary transition-colors"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {doc.status === "pending" && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); handleDocStatusChange(doc.id, "approved"); }} className="h-7 w-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:bg-emerald-950/30 transition-colors" title="Approve"><CheckCircle2 className="h-4 w-4" /></button>
                          <button onClick={(e) => { e.stopPropagation(); handleDocStatusChange(doc.id, "rejected"); }} className="h-7 w-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 dark:bg-red-950/30 transition-colors" title="Reject"><XCircle className="h-4 w-4" /></button>
                        </>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }} className="h-7 w-7 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-red-500 transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ========== NOTES ========== */}
        {tab === "notes" && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2">
              <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note about this partner..."
                className="flex-1 h-9 px-3 rounded-lg border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 hover:border-border transition-all"
                onKeyDown={(e) => { if (e.key === "Enter" && newNote.trim()) handleAddNote(); }} />
              <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={handleAddNote} disabled={!newNote.trim()}>Add</Button>
            </div>
            {loadingNotes && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-12 bg-surface-hover rounded-xl" />)}</div>}
            {!loadingNotes && notes.length === 0 && (
              <div className="py-12 text-center">
                <MessageSquare className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No notes yet</p>
              </div>
            )}
            {!loadingNotes && notes.map((note) => (
              <motion.div key={note.id} variants={staggerItem} className="p-3 rounded-xl bg-surface-hover">
                <p className="text-sm text-text-primary">{note.content}</p>
                <div className="flex items-center gap-2 mt-2 text-[11px] text-text-tertiary">
                  {note.author_name && <span className="font-medium">{note.author_name}</span>}
                  <span>{new Date(note.created_at).toLocaleString()}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function InternalProfileTab({ partner, onUpdate }: { partner: Partner; onUpdate: (updates: Partial<Partner>) => void }) {
  const [internalNotes, setInternalNotes] = useState(partner.internal_notes ?? "");
  const [role, setRole] = useState(partner.role ?? "");
  const [permission, setPermission] = useState(partner.permission ?? "");

  useEffect(() => {
    setInternalNotes(partner.internal_notes ?? "");
    setRole(partner.role ?? "");
    setPermission(partner.permission ?? "");
  }, [partner.id, partner.internal_notes, partner.role, partner.permission]);

  return (
    <div className="p-6 space-y-5">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Role</label>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Subcontractor, Lead Partner..." />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Permission Level</label>
        <select
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
          className="w-full h-9 px-3 rounded-lg border border-border text-sm text-text-secondary bg-card focus:outline-none focus:ring-2 focus:ring-primary/15"
        >
          <option value="">No permission set</option>
          <option value="view_only">View Only</option>
          <option value="submit_reports">Submit Reports</option>
          <option value="submit_quotes">Submit Quotes</option>
          <option value="full_access">Full Access</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Internal Notes</label>
        <textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          rows={5}
          placeholder="Internal information about this partner..."
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-none"
        />
      </div>
      <div className="p-4 rounded-xl bg-surface-hover">
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Partner History</p>
        <div className="space-y-2 text-xs text-text-secondary">
          <div className="flex justify-between">
            <span>Joined</span>
            <span className="font-medium text-text-primary">{new Date(partner.joined_at).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Status</span>
            <Badge variant={statusConfig[partner.status]?.variant ?? "default"} size="sm">{statusConfig[partner.status]?.label ?? partner.status}</Badge>
          </div>
          <div className="flex justify-between">
            <span>Verified</span>
            <span className={`font-medium ${partner.verified ? "text-emerald-600" : "text-text-tertiary"}`}>{partner.verified ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>
      <Button onClick={() => onUpdate({ internal_notes: internalNotes, role, permission })} className="w-full">
        Save Internal Profile
      </Button>
    </div>
  );
}

function getPartnerStatusActions(currentStatus: string) {
  switch (currentStatus) {
    case "onboarding":
      return [
        { label: "Activate", status: "active" as PartnerStatus, icon: Play, primary: true },
        { label: "Deactivate", status: "inactive" as PartnerStatus, icon: XCircle, primary: false },
      ];
    case "active":
      return [
        { label: "Put On Break", status: "on_break" as PartnerStatus, icon: Pause, primary: false },
        { label: "Deactivate", status: "inactive" as PartnerStatus, icon: XCircle, primary: false },
      ];
    case "on_break":
      return [
        { label: "Reactivate", status: "active" as PartnerStatus, icon: Play, primary: true },
        { label: "Deactivate", status: "inactive" as PartnerStatus, icon: XCircle, primary: false },
      ];
    case "inactive":
      return [
        { label: "Reactivate", status: "active" as PartnerStatus, icon: RotateCcw, primary: true },
      ];
    default:
      return [];
  }
}
