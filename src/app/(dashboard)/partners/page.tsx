"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { SearchInput, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";
import {
  UserPlus, Filter, Users, Star, Briefcase, ShieldCheck, MapPin,
  ArrowRight, Mail, Phone, Calendar, DollarSign,
  FileText, Upload, CheckCircle2, XCircle, Clock, AlertTriangle,
  MessageSquare, Send, Trash2, Download, Eye,
  Play, Pause, RotateCcw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Partner, PartnerStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listPartners, createPartner, updatePartner } from "@/services/partners";
import { getStatusCounts } from "@/services/base";
import { getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import type { ListParams } from "@/services/base";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; color: string }> = {
  active: { label: "Active", variant: "success", color: "bg-emerald-500" },
  on_break: { label: "On Break", variant: "warning", color: "bg-amber-500" },
  inactive: { label: "Inactive", variant: "default", color: "bg-stone-400" },
  onboarding: { label: "Onboarding", variant: "info", color: "bg-blue-500" },
};

const tradeColors: Record<string, string> = {
  HVAC: "bg-blue-50 text-blue-700 ring-blue-200/50",
  Electrical: "bg-purple-50 text-purple-700 ring-purple-200/50",
  Plumbing: "bg-teal-50 text-teal-700 ring-teal-200/50",
  Painting: "bg-amber-50 text-amber-700 ring-amber-200/50",
  Carpentry: "bg-emerald-50 text-emerald-700 ring-emerald-200/50",
};

const TRADES = ["HVAC", "Electrical", "Plumbing", "Painting", "Carpentry"];

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
  trade: "HVAC", location: "", status: "active" as PartnerStatus,
};

export default function PartnersPage() {
  const [tradeFilter, setTradeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const fetcher = useCallback(
    (params: ListParams) => listPartners({ ...params, trade: tradeFilter !== "all" ? tradeFilter : undefined }),
    [tradeFilter]
  );

  const { data: partners, loading, page, totalPages, totalItems, setPage, search, setSearch, status: statusFilter, setStatus: setStatusFilter, refresh } =
    useSupabaseList<Partner>({ fetcher });

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
      await createPartner({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        trade: form.trade,
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
          <Avatar name={item.company_name} size="md" />
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
        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${tradeColors[item.trade] || "bg-stone-100 text-stone-700"}`}>
          {item.trade}
        </span>
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
      render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors" />,
    },
  ];

  const selectClasses = "h-9 px-3 rounded-lg border border-stone-200 text-sm text-text-secondary bg-white focus:outline-none focus:ring-2 focus:ring-primary/15";

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Partners" subtitle="Manage your partner network and performance.">
          <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
          <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>Add Partner</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Partners" value={totalPartners} format="number" icon={Users} accent="blue" />
          <KpiCard title="Active Partners" value={activeCount} format="number" icon={Briefcase} accent="emerald" />
          <KpiCard title="Avg Rating" value="-" icon={Star} accent="amber" />
          <KpiCard title="Compliance Score" value="-" icon={ShieldCheck} accent="primary" />
        </StaggerContainer>

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
                <div className="h-4 w-px bg-stone-200" />
                <BulkActionBtn label="Verify All" onClick={() => handleBulkVerify(true)} variant="success" />
                <BulkActionBtn label="Unverify" onClick={() => handleBulkVerify(false)} variant="default" />
              </>
            }
          />
        </motion.div>
      </div>

      <PartnerDetailDrawer
        partner={selectedPartner}
        onClose={() => setSelectedPartner(null)}
        onStatusChange={handleStatusChange}
        onVerify={handleVerify}
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
              <label className="text-xs font-medium text-text-secondary">Trade</label>
              <select value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} className={selectClasses + " w-full"}>
                {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Location</label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Manhattan, NY" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-stone-100">
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
    success: "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200",
    default: "text-stone-700 bg-stone-50 hover:bg-stone-100 border-stone-200",
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
  file_name?: string;
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

function PartnerDetailDrawer({
  partner,
  onClose,
  onStatusChange,
  onVerify,
}: {
  partner: Partner | null;
  onClose: () => void;
  onStatusChange: (partner: Partner, status: PartnerStatus) => void;
  onVerify: (partner: Partner) => void;
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

  const loadAll = useCallback(async (p: Partner) => {
    const supabase = getSupabase();

    setLoadingJobs(true);
    supabase.from("jobs").select("*")
      .or(`partner_id.eq.${p.id},partner_name.eq.${p.company_name}`)
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
  }, []);

  useEffect(() => {
    if (partner) {
      setTab("overview");
      loadAll(partner);
    }
  }, [partner, loadAll]);

  const handleAddDocument = async (docType: string, name: string) => {
    if (!partner) return;
    const supabase = getSupabase();
    try {
      await supabase.from("partner_documents").insert({ partner_id: partner.id, name, doc_type: docType, status: "pending", uploaded_by: profile?.full_name });
      toast.success("Document added");
      supabase.from("partner_documents").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }).then(({ data }) => setDocuments((data ?? []) as PartnerDoc[]));
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
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
    const supabase = getSupabase();
    try {
      await supabase.from("partner_documents").delete().eq("id", docId);
      toast.success("Document removed");
      supabase.from("partner_documents").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }).then(({ data }) => setDocuments((data ?? []) as PartnerDoc[]));
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
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

  if (!partner) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[partner.status];
  const statusActions = getPartnerStatusActions(partner.status);

  const realJobsCount = partnerJobs.length;
  const completedJobs = partnerJobs.filter((j) => j.status === "completed").length;
  const activeJobs = partnerJobs.filter((j) => j.status === "in_progress").length;
  const realEarnings = partnerJobs.reduce((s, j) => s + Number(j.partner_cost || 0), 0);
  const totalJobValue = partnerJobs.reduce((s, j) => s + Number(j.client_price || 0), 0);
  const totalPaidOut = selfBills.filter((s) => s.status === "payment_sent").reduce((s, sb) => s + Number(sb.net_payout), 0);
  const pendingPayout = selfBills.filter((s) => s.status === "generated").reduce((s, sb) => s + Number(sb.net_payout), 0);

  const drawerTabs = [
    { id: "overview", label: "Overview" },
    { id: "jobs", label: "Jobs", count: realJobsCount },
    { id: "financial", label: "Financial", count: selfBills.length },
    { id: "documents", label: "Documents", count: documents.length },
    { id: "notes", label: "Notes", count: notes.length },
  ];

  return (
    <Drawer open={!!partner} onClose={onClose} title={partner.company_name} subtitle={partner.trade + " — " + partner.location} width="w-[580px]">
      <div className="px-6 pt-3 pb-0 border-b border-stone-100">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ========== OVERVIEW ========== */}
        {tab === "overview" && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-4">
              <Avatar name={partner.company_name} size="xl" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-text-primary">{partner.company_name}</h3>
                  {partner.verified && <ShieldCheck className="h-4 w-4 text-emerald-500" />}
                </div>
                <p className="text-sm text-text-tertiary">{partner.contact_name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={config.variant} dot size="md">{config.label}</Badge>
                  <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${tradeColors[partner.trade] || "bg-stone-100 text-stone-700"}`}>{partner.trade}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-text-secondary"><Mail className="h-4 w-4 text-text-tertiary" />{partner.email}</div>
              {partner.phone && <div className="flex items-center gap-2 text-sm text-text-secondary"><Phone className="h-4 w-4 text-text-tertiary" />{partner.phone}</div>}
              <div className="flex items-center gap-2 text-sm text-text-secondary"><MapPin className="h-4 w-4 text-text-tertiary" />{partner.location}</div>
              <div className="flex items-center gap-2 text-sm text-text-secondary"><Calendar className="h-4 w-4 text-text-tertiary" />Joined {new Date(partner.joined_at).toLocaleDateString()}</div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-stone-50">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Jobs</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : realJobsCount}</p>
                <p className="text-[10px] text-text-tertiary">{completedJobs} completed, {activeJobs} active</p>
              </div>
              <div className="p-3 rounded-xl bg-stone-50">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Earned</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : formatCurrency(realEarnings)}</p>
                <p className="text-[10px] text-text-tertiary">from partner cost</p>
              </div>
              <div className="p-3 rounded-xl bg-stone-50">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job Value</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : formatCurrency(totalJobValue)}</p>
                <p className="text-[10px] text-text-tertiary">total client value</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-stone-50">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Rating</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  <span className="text-xl font-bold text-text-primary">{partner.rating}</span>
                  <span className="text-xs text-text-tertiary">/5.0</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-stone-50">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Compliance</p>
                <div className="mt-1">
                  <span className="text-xl font-bold text-text-primary">{partner.compliance_score}%</span>
                  <Progress value={partner.compliance_score} size="sm" color={partner.compliance_score >= 90 ? "emerald" : partner.compliance_score >= 70 ? "primary" : "amber"} className="mt-1" />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-stone-100">
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

            <div className="flex gap-2 pt-4 border-t border-stone-100">
              {statusActions.map((action) => (
                <Button key={action.status} variant={action.primary ? "primary" : "outline"} className="flex-1" size="sm" icon={<action.icon className="h-3.5 w-3.5" />} onClick={() => onStatusChange(partner, action.status)}>
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
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
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="animate-pulse h-20 bg-stone-50 rounded-xl" />)}
              </div>
            )}

            {!loadingJobs && partnerJobs.length === 0 && (
              <div className="py-12 text-center">
                <Briefcase className="h-8 w-8 text-stone-300 mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No jobs found for this partner</p>
              </div>
            )}

            {!loadingJobs && partnerJobs.map((job) => {
              const jConfig = jobStatusConfig[job.status] || { label: job.status, variant: "default" as const };
              const profit = Number(job.client_price) - Number(job.partner_cost) - Number(job.materials_cost);
              return (
                <motion.div key={job.id} variants={staggerItem} className="p-4 rounded-xl border border-stone-100 hover:border-stone-200 transition-colors">
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
                    <span className="text-[10px] text-text-tertiary">Phase {job.current_phase}/{job.total_phases}</span>
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
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Total Paid</p>
                <p className="text-lg font-bold text-emerald-700 mt-1">{formatCurrency(totalPaidOut)}</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Pending</p>
                <p className="text-lg font-bold text-amber-700 mt-1">{formatCurrency(pendingPayout)}</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
                <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Earned (Jobs)</p>
                <p className="text-lg font-bold text-blue-700 mt-1">{formatCurrency(realEarnings)}</p>
              </div>
            </div>

            <p className="text-sm font-semibold text-text-primary">{selfBills.length} Self-Bills</p>

            {loadingFinance && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-stone-50 rounded-xl" />)}
              </div>
            )}

            {!loadingFinance && selfBills.length === 0 && (
              <div className="py-10 text-center">
                <DollarSign className="h-8 w-8 text-stone-300 mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No self-bills found</p>
              </div>
            )}

            {!loadingFinance && selfBills.map((sb) => (
              <motion.div key={sb.id} variants={staggerItem} className="p-4 rounded-xl border border-stone-100 hover:border-stone-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-text-primary">{sb.reference}</p>
                    <Badge variant={sb.status === "payment_sent" ? "success" : sb.status === "audit_required" ? "danger" : "warning"} size="sm" dot>
                      {sb.status === "payment_sent" ? "Paid" : sb.status === "audit_required" ? "Audit Required" : "Pending"}
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

        {/* ========== DOCUMENTS ========== */}
        {tab === "documents" && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{documents.length} Documents</p>
              <AddDocumentButton onAdd={handleAddDocument} />
            </div>
            {loadingDocs && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-stone-50 rounded-xl" />)}</div>}
            {!loadingDocs && documents.length === 0 && (
              <div className="py-12 text-center">
                <FileText className="h-8 w-8 text-stone-300 mx-auto mb-2" />
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
                <motion.div key={doc.id} variants={staggerItem} className="p-4 rounded-xl border border-stone-100 hover:border-stone-200 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0"><Icon className="h-5 w-5 text-stone-500" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{doc.name}</p>
                        <Badge variant={sConfig.variant} size="sm">{sConfig.label}</Badge>
                        {isExpired && <Badge variant="danger" size="sm">Expired</Badge>}
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">{typeConfig.label}</p>
                      {doc.expires_at && <p className={`text-xs mt-0.5 ${isExpired ? "text-red-500" : "text-text-tertiary"}`}>Expires: {new Date(doc.expires_at).toLocaleDateString()}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {doc.status === "pending" && (
                        <>
                          <button onClick={() => handleDocStatusChange(doc.id, "approved")} className="h-7 w-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors" title="Approve"><CheckCircle2 className="h-4 w-4" /></button>
                          <button onClick={() => handleDocStatusChange(doc.id, "rejected")} className="h-7 w-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors" title="Reject"><XCircle className="h-4 w-4" /></button>
                        </>
                      )}
                      <button onClick={() => handleDeleteDoc(doc.id)} className="h-7 w-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-stone-100 hover:text-red-500 transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
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
                className="flex-1 h-9 px-3 rounded-lg border border-stone-200 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 hover:border-stone-300 transition-all"
                onKeyDown={(e) => { if (e.key === "Enter" && newNote.trim()) handleAddNote(); }} />
              <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={handleAddNote} disabled={!newNote.trim()}>Add</Button>
            </div>
            {loadingNotes && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-12 bg-stone-50 rounded-xl" />)}</div>}
            {!loadingNotes && notes.length === 0 && (
              <div className="py-12 text-center">
                <MessageSquare className="h-8 w-8 text-stone-300 mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No notes yet</p>
              </div>
            )}
            {!loadingNotes && notes.map((note) => (
              <motion.div key={note.id} variants={staggerItem} className="p-3 rounded-xl bg-stone-50">
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

function AddDocumentButton({ onAdd }: { onAdd: (type: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState("insurance");
  const [name, setName] = useState("");

  const handleAdd = () => {
    if (!name.trim()) { toast.error("Enter a document name"); return; }
    onAdd(docType, name.trim());
    setName("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Add Document
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={docType}
        onChange={(e) => setDocType(e.target.value)}
        className="h-8 px-2 text-xs rounded-lg border border-stone-200 bg-white focus:outline-none"
      >
        {Object.entries(docTypeLabels).map(([key, { label }]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Document name"
        className="h-8 px-2 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-primary/15 w-36"
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        autoFocus
      />
      <button onClick={handleAdd} className="h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary-hover transition-colors">
        <CheckCircle2 className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg text-stone-400 hover:bg-stone-100 flex items-center justify-center transition-colors">
        <XCircle className="h-3.5 w-3.5" />
      </button>
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
