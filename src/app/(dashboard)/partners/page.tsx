"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  ArrowRight, Mail, Phone, Calendar, DollarSign, Landmark,
  FileText, Upload, CheckCircle2, XCircle, Clock, AlertTriangle,
  MessageSquare, Send, Trash2, Download, Eye, Copy,
  Play, KeyRound, MailPlus,
  Home, Sparkles, Link2,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Partner, PartnerLegalType, PartnerStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listPartners, createPartner, updatePartner } from "@/services/partners";
import { findDuplicatePartners, formatPartnerDuplicateLines } from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import {
  uploadPartnerDocumentFile,
  uploadPartnerDocumentPreview,
  removeStorageObjects,
  getPartnerDocumentSignedUrl,
} from "@/services/partner-documents-storage";
import { uploadPartnerAvatar } from "@/services/partner-avatar-storage";
import { getStatusCounts, getAggregates } from "@/services/base";
import { getSupabase } from "@/services/base";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";
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
import { UkCoveragePicker } from "@/components/partners/uk-coverage-picker";
import {
  defaultUkCoverage,
  formatUkCoverageLabel,
  normalizeUkCoverageRegions,
  partnerCoverageToForm,
} from "@/lib/partner-uk-coverage";
import {
  computeProfileCompletenessScore,
  countExpiredDocuments,
  getProfileCompletenessItems,
  inferPartnerLegal,
  mergePartnerComplianceScore,
} from "@/lib/partner-compliance";
import {
  pickRequiredDocMatches,
  pickRequiredDocMatch,
  buildRequiredDocumentChecklist,
  buildMandatoryDocsForComplianceScore,
  buildTradeCertificateRequirements,
  computeComplianceScore,
  getRequiredDocComplianceStatus,
  getOptionalDbsStatus,
  resolvePartnerDocExpiresAt,
  partnerDocExpiryPolicy,
  extractCertificateNumber,
  OPTIONAL_TRADE_CERTS_BY_TRADE,
  type RequiredDocDef,
  type PartnerDocExpiryPolicy,
} from "@/lib/partner-required-docs";
import {
  computeAutoReasonCodes,
  deriveAutoStatusAndReasons,
  isPartnerInactiveStage,
  mergeUniqueReasons,
  partnerReasonLabel,
  shouldForceActivateAck,
} from "@/lib/partner-status";
import { TYPE_OF_WORK_OPTIONS, normalizeTypeOfWork } from "@/lib/type-of-work";
import {
  formatUkSortCodeForDisplay,
  normalizeUkAccountNumberInput,
  normalizeUkSortCodeInput,
  validatePartnerBankDetails,
} from "@/lib/uk-bank-details";
import {
  getPartnerPortalAllowlistIds,
  getPartnerPortalAllowlistOptions,
} from "@/lib/partner-portal-allowlist";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; color: string }> = {
  active: { label: "Active", variant: "success", color: "bg-emerald-50 dark:bg-emerald-950/300" },
  needs_attention: { label: "Needs Attention", variant: "danger", color: "bg-red-50 dark:bg-red-950/300" },
  inactive: { label: "Inactive", variant: "default", color: "bg-stone-600 dark:bg-stone-800" },
  onboarding: { label: "Onboarding", variant: "warning", color: "bg-amber-50 dark:bg-amber-950/300" },
  /** @deprecated DB value — shown as Inactive + “On break” badge */
  on_break: { label: "Inactive", variant: "default", color: "bg-stone-600 dark:bg-stone-800" },
};

const PARTNER_STAGE_PILLS: { id: string; label: string; icon: typeof Clock }[] = [
  { id: "onboarding", label: "Onboarding", icon: Clock },
  { id: "needs_attention", label: "Needs Attention", icon: AlertTriangle },
  { id: "active", label: "Active", icon: CheckCircle2 },
  { id: "inactive", label: "Inactive", icon: XCircle },
];

const tradeColors: Record<string, string> = {
  HVAC: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 ring-blue-200/50",
  Electrical: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 ring-purple-200/50",
  Plumbing: "bg-teal-50 dark:bg-teal-950/30 text-teal-700 ring-teal-200/50",
  Painting: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 ring-amber-200/50",
  Carpentry: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 ring-emerald-200/50",
  "General Maintenance": "bg-orange-50 dark:bg-orange-950/30 text-orange-700 ring-orange-200/50",
  Cleaning: "bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 ring-cyan-200/50",
  Gardener: "bg-green-50 dark:bg-green-950/30 text-green-800 ring-green-200/50",
  "Boiler Service": "bg-rose-50 dark:bg-rose-950/30 text-rose-800 ring-rose-200/50",
  Builder: "bg-stone-50 dark:bg-stone-950/30 text-stone-700 ring-stone-200/50",
  Painter: "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 ring-yellow-200/50",
};

const TRADES = [...TYPE_OF_WORK_OPTIONS];
const KNOWN_TRADES = new Set<string>(TRADES);

/** Minimum blended compliance score (0–100) to activate without explicit authorization. */
const ACTIVATION_COMPLIANCE_MIN_SCORE = 95;

const LEGACY_TRADE_ALIASES: Record<string, string> = {
  electrical: "Electrician",
  plumbing: "Plumber",
  painting: "Painter",
  carpentry: "Carpenter",
  hvac: "General Maintenance",
  handyman: "General Maintenance",
};

function normalizeTradeName(value?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (KNOWN_TRADES.has(raw)) return raw;
  const legacy = LEGACY_TRADE_ALIASES[raw.toLowerCase()];
  if (legacy && KNOWN_TRADES.has(legacy)) return legacy;
  const fromWork = normalizeTypeOfWork(raw);
  if (fromWork && KNOWN_TRADES.has(fromWork)) return fromWork;
  return null;
}

function normalizeTrades(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTradeName(value);
    if (normalized) seen.add(normalized);
  }
  return seen.size > 0 ? Array.from(seen) : [TRADES[0]];
}

function getPartnerTrades(partner: Pick<Partner, "trade" | "trades">): string[] {
  return normalizeTrades(partner.trades?.length ? partner.trades : [partner.trade]);
}

/** Legacy `partner.trade` / DB may still say "HVAC"; never show that label in UI. */
function isHiddenTradeLabel(t: string): boolean {
  return String(t).trim().toLowerCase() === "hvac";
}

/** Normalized trades for chips / subtitles (drops HVAC). */
function partnerTradesForDisplay(partner: Pick<Partner, "trade" | "trades">): string[] {
  return getPartnerTrades(partner).filter((t) => !isHiddenTradeLabel(t));
}

function overviewTradesForDisplay(
  partner: Pick<Partner, "trade" | "trades">,
  editing: boolean,
  overviewTrades: string[],
): string[] {
  const raw = editing ? overviewTrades : partner.trades?.length ? partner.trades : [partner.trade];
  const normalized = normalizeTrades(raw);
  return normalized.filter((t) => !isHiddenTradeLabel(t));
}

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
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  scheduled_finish_date?: string | null;
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

const jobStatusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "default" },
  unassigned: { label: "Unassigned", variant: JOB_STATUS_BADGE_VARIANT.unassigned },
  scheduled: { label: "Scheduled", variant: JOB_STATUS_BADGE_VARIANT.scheduled },
  in_progress: { label: "In Progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase1 },
  on_hold: { label: "On Hold", variant: "warning" },
  completed: { label: "Completed", variant: JOB_STATUS_BADGE_VARIANT.completed },
  cancelled: { label: "Cancelled", variant: JOB_STATUS_BADGE_VARIANT.cancelled },
};

const emptyForm = {
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  vat_number: "",
  /** Limited company only: null until Yes/No chosen */
  vat_registered: null as boolean | null,
  crn: "",
  utr: "",
  partner_legal_type: "self_employed" as PartnerLegalType,
  trades: [TRADES[0]] as string[],
  uk_coverage_regions: defaultUkCoverage(),
  partner_address: "",
  /** New directory partners start in Onboarding until compliance + activation. */
  status: "onboarding" as PartnerStatus,
};

type PendingCreatePartnerDoc = {
  id: string;
  docType: string;
  name: string;
  file: File;
  previewFile: File | null;
  expiresAt?: string;
  certificateNumber?: string;
};

type ViewMode = "directory" | "team";

export default function PartnersPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("directory");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createModalTab, setCreateModalTab] = useState<"info" | "documents">("info");
  const [pendingCreateDocs, setPendingCreateDocs] = useState<PendingCreatePartnerDoc[]>([]);
  const [createAvatarFile, setCreateAvatarFile] = useState<File | null>(null);
  const createAvatarInputRef = useRef<HTMLInputElement>(null);
  const [createQueueDocOpen, setCreateQueueDocOpen] = useState(false);
  const [createDocPreset, setCreateDocPreset] = useState<{ docType: string; name: string } | null>(null);
  const [createCustomCertName, setCreateCustomCertName] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [complianceAvg, setComplianceAvg] = useState<number | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  /** When set (e.g. after Add Partner), drawer opens on this tab once. Cleared when picking another row or closing. */
  const [partnerDrawerInitialTab, setPartnerDrawerInitialTab] = useState<string | undefined>(undefined);
  const [selectedTeamMember, setSelectedTeamMember] = useState<TeamMember | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const { profile } = useProfile();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const isAdmin = profile?.role === "admin";

  const loadTeam = useCallback(() => {
    setTeamLoading(true);
    getTeamMembers()
      .then(setTeamMembers)
      .catch(() => toast.error("Failed to load team"))
      .finally(() => setTeamLoading(false));
  }, []);

  useEffect(() => {
    if (viewMode === "team") loadTeam();
  }, [viewMode, loadTeam]);

  const fetcher = useCallback(
    (params: ListParams) => listPartners({ ...params, trade: tradeFilter !== "all" ? tradeFilter : undefined }),
    [tradeFilter]
  );

  const { data: partners, loading, page, totalPages, totalItems, setPage, search, setSearch, status: statusFilter, setStatus: setStatusFilter, refresh } =
    useSupabaseList<Partner>({ fetcher, realtimeTable: "partners" });

  const loadCounts = useCallback(async () => {
    try {
      const [counts, complianceAgg] = await Promise.all([
        getStatusCounts("partners", ["active", "inactive", "onboarding", "needs_attention", "on_break"]),
        getAggregates("partners", "compliance_score"),
      ]);
      setStatusCounts(counts);
      const avg = complianceAgg.count > 0 ? complianceAgg.sum / complianceAgg.count : null;
      setComplianceAvg(avg == null ? null : Math.round(avg * 10) / 10);
    } catch { /* cosmetic */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { refresh(); }, [tradeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const createAvatarPreviewUrl = useMemo(
    () => (createAvatarFile ? URL.createObjectURL(createAvatarFile) : null),
    [createAvatarFile],
  );
  useEffect(() => {
    return () => {
      if (createAvatarPreviewUrl) URL.revokeObjectURL(createAvatarPreviewUrl);
    };
  }, [createAvatarPreviewUrl]);

  useEffect(() => {
    if (!createOpen) {
      setCreateAvatarFile(null);
      return;
    }
    setCreateModalTab("info");
    setPendingCreateDocs([]);
    setCreateQueueDocOpen(false);
    setCreateDocPreset(null);
    setCreateCustomCertName("");
  }, [createOpen]);

  const partnerTradesForCreate = useMemo(
    () => (form.trades?.length ? form.trades : [TRADES[0]]),
    [form.trades],
  );
  const syntheticPartnerForCreateDocs = useMemo(
    (): Partner =>
      ({
        id: "__create__",
        partner_legal_type: form.partner_legal_type,
        trades: form.trades,
        trade: form.trades[0] ?? TRADES[0],
        crn: form.crn?.trim() || null,
      } as Partner),
    [form.partner_legal_type, form.trades, form.crn],
  );
  const mandatoryDocsCreate = useMemo(
    () => buildMandatoryDocsForComplianceScore(syntheticPartnerForCreateDocs),
    [syntheticPartnerForCreateDocs],
  );
  const tradeCertsDocsCreate = useMemo(
    () => buildTradeCertificateRequirements(partnerTradesForCreate),
    [partnerTradesForCreate],
  );
  const pendingDocsForCompliancePreview = useMemo(
    () => pendingCreateDocsAsPartnerDocs(pendingCreateDocs),
    [pendingCreateDocs],
  );
  const documentCompliancePreviewCreate = useMemo(
    () => computeComplianceScore(pendingDocsForCompliancePreview, mandatoryDocsCreate),
    [pendingDocsForCompliancePreview, mandatoryDocsCreate],
  );
  const missingRequiredDocsCreate = useMemo(
    () =>
      mandatoryDocsCreate.filter(
        (req) => getRequiredDocComplianceStatus(pendingDocsForCompliancePreview, req) !== "valid",
      ),
    [mandatoryDocsCreate, pendingDocsForCompliancePreview],
  );

  const totalPartners = statusCounts["all"] ?? 0;
  const activeCount = statusCounts["active"] ?? 0;
  const onboardingCount = statusCounts["onboarding"] ?? 0;
  const needsAttentionCount = statusCounts["needs_attention"] ?? 0;
  const inactiveStageCount = (statusCounts["inactive"] ?? 0) + (statusCounts["on_break"] ?? 0);

  async function handleCreate() {
    if (!form.company_name.trim() || !form.contact_name.trim() || !form.email.trim()) {
      toast.error("Please fill in company name, contact name, and email.");
      return;
    }
    if (form.partner_legal_type === "limited_company") {
      if (form.vat_registered === null) {
        toast.error("Select whether the company is VAT registered.");
        return;
      }
      if (form.vat_registered === true && !form.vat_number.trim()) {
        toast.error("Enter the VAT number.");
        return;
      }
    }
    const dupP = await findDuplicatePartners({
      email: form.email.trim(),
      companyName: form.company_name.trim(),
    });
    if (!(await confirmDespiteDuplicates(formatPartnerDuplicateLines(dupP)))) return;

    setSubmitting(true);
    try {
      const primaryTrade = form.trades[0] ?? TRADES[0];
      const regions = normalizeUkCoverageRegions(form.uk_coverage_regions);
      const created = await createPartner({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        vat_number:
          form.partner_legal_type === "limited_company"
            ? form.vat_registered === true
              ? form.vat_number.trim() || null
              : null
            : form.vat_number.trim() || undefined,
        vat_registered: form.partner_legal_type === "limited_company" ? form.vat_registered : null,
        partner_legal_type: form.partner_legal_type,
        crn: form.partner_legal_type === "limited_company" ? (form.crn.trim() || null) : null,
        utr: form.partner_legal_type === "self_employed" ? (form.utr.trim() || null) : null,
        trade: primaryTrade,
        trades: form.trades,
        status: form.status,
        location: formatUkCoverageLabel(regions, null),
        uk_coverage_regions: regions,
        partner_address: form.partner_address.trim() || null,
        verified: false,
      });
      let partnerToShow: Partner = created;
      if (createAvatarFile) {
        try {
          const url = await uploadPartnerAvatar(created.id, createAvatarFile);
          partnerToShow = await updatePartner(created.id, { avatar_url: url });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Photo upload failed");
        }
      }
      let docUploadFailed = 0;
      for (const d of pendingCreateDocs) {
        try {
          await insertAndUploadPartnerDocument({
            partnerId: created.id,
            uploadedByName: profile?.full_name,
            docType: d.docType,
            name: d.name,
            file: d.file,
            previewFile: d.previewFile,
            expiresAt: d.expiresAt,
            certificateNumber: d.certificateNumber,
          });
        } catch {
          docUploadFailed += 1;
        }
      }
      setPartnerDrawerInitialTab(undefined);
      setSelectedPartner(partnerToShow);
      setCreateOpen(false);
      setForm(emptyForm);
      setPendingCreateDocs([]);
      refresh();
      await loadCounts();
      if (viewMode === "team") loadTeam();
      if (docUploadFailed > 0) {
        toast.success(
          `Partner created. ${pendingCreateDocs.length - docUploadFailed} document(s) uploaded; ${docUploadFailed} failed — add them from the Documents tab.`,
        );
      } else {
        toast.success(
          pendingCreateDocs.length > 0
            ? `Partner created with ${pendingCreateDocs.length} document(s).`
            : "Partner created successfully.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create partner.");
    } finally {
      setSubmitting(false);
    }
  }

  const handleQueueDocForCreate = useCallback(
    async (
      docType: string,
      name: string,
      file: File,
      preview: File | null,
      expiresAt?: string,
      certificateNumber?: string,
    ) => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPendingCreateDocs((prev) => [
        ...prev,
        { id, docType, name, file, previewFile: preview, expiresAt, certificateNumber },
      ]);
      setCreateQueueDocOpen(false);
      setCreateModalTab("documents");
      toast.success("Added to queue — uploads when you create the partner.");
    },
    [],
  );

  const handlePartnerPatch = useCallback(async (patch: Partial<Partner>) => {
    if (!selectedPartner) return;
    try {
      const updated = await updatePartner(selectedPartner.id, patch);
      setSelectedPartner(updated);
      toast.success("Partner updated");
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }, [selectedPartner, refresh, loadCounts]);

  const handleStatusChange = useCallback(async (partner: Partner, newStatus: PartnerStatus) => {
    try {
      const updated = await updatePartner(partner.id, { status: newStatus });
      setSelectedPartner(updated);
      toast.success(`Partner moved to ${statusConfig[newStatus]?.label ?? newStatus}`);
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
          {partnerTradesForDisplay(item).map((t) => (
            <span key={t} className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${tradeColors[t] || "bg-surface-tertiary text-text-primary ring-border"}`}>
              {t}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "location", label: "Coverage",
      render: (item) => (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary max-w-[200px] truncate" title={formatUkCoverageLabel(item.uk_coverage_regions, item.location)}>
          <MapPin className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <span className="truncate">{formatUkCoverageLabel(item.uk_coverage_regions, item.location) || "—"}</span>
        </div>
      ),
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const cfg = statusConfig[item.status] ?? statusConfig.active;
        const reasons = item.partner_status_reasons ?? [];
        const reasonRows =
          item.status === "on_break"
            ? reasons.filter((r) => r !== "on_break")
            : reasons;
        const showReasons =
          (item.status === "needs_attention" && reasonRows.length > 0) ||
          (item.status === "on_break" && reasonRows.length > 0);
        return (
          <div className="flex flex-col gap-1 min-w-[8rem]">
            <Badge variant={cfg.variant} dot>
              {item.status === "on_break" ? "Inactive" : cfg.label}
            </Badge>
            {item.status === "on_break" ? (
              <span className="inline-flex w-fit items-center rounded-md border border-stone-400/50 bg-stone-500/10 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                On break
              </span>
            ) : null}
            {showReasons ? (
              <div className="flex flex-wrap gap-0.5">
                {reasonRows.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center rounded-md border border-border-light bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                  >
                    {partnerReasonLabel(r)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "compliance_score",
      label: "Compliance",
      align: "center",
      render: (item) => {
        const raw = item.compliance_score;
        const s = typeof raw === "number" && !Number.isNaN(raw) ? raw : Number(raw ?? 0);
        const colorClass =
          s >= 97 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
        return (
          <div className="flex flex-col items-center min-w-[3.25rem]" title="Blended score (documents + profile), 0–100">
            <span className={cn("text-sm font-bold tabular-nums", colorClass)}>
              {Math.round(s)}
              <span className="text-[10px] font-semibold text-text-tertiary ml-0.5">%</span>
            </span>
          </div>
        );
      },
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
          <div className="flex min-w-0 flex-nowrap items-center gap-2">
            <Tabs
              tabs={[
                { id: "directory", label: "Directory" },
                { id: "team", label: "Team (App)" },
              ]}
              activeTab={viewMode}
              onChange={(id) => {
                setViewMode(id as ViewMode);
                setSelectedPartner(null);
                setSelectedTeamMember(null);
                setPartnerDrawerInitialTab(undefined);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              icon={<Filter className="h-3.5 w-3.5 shrink-0" />}
            >
              Filter
            </Button>
            <Button
              size="sm"
              className="shrink-0 whitespace-nowrap"
              icon={<UserPlus className="h-3.5 w-3.5 shrink-0" />}
              onClick={() => setCreateOpen(true)}
            >
              Add Partner
            </Button>
          </div>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Active" value={activeCount} format="number" icon={Briefcase} accent="emerald" />
          <KpiCard title="Inactive" value={inactiveStageCount} format="number" icon={XCircle} accent="stone" />
          <KpiCard title="Total" value={totalPartners} format="number" icon={Users} accent="blue" />
          <KpiCard
            title="Avg compliance"
            value={complianceAvg == null ? "—" : Math.round(complianceAvg)}
            format={complianceAvg == null ? "none" : "percent"}
            description="0–100 scale · profile & documents (directory)"
            icon={ShieldCheck}
            accent="primary"
          />
        </StaggerContainer>

        {viewMode === "team" && (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
            {teamLoading && <div className="text-sm text-text-tertiary">Loading team...</div>}
            {!teamLoading && teamMembers.length === 0 && (
              <div className="py-12 text-center space-y-2 text-text-tertiary max-w-md mx-auto">
                <p className="text-sm text-text-secondary">No field partners in the app yet.</p>
                <p className="text-xs">
                  Open a partner in <span className="font-medium text-text-primary">Directory</span>, then use{" "}
                  <span className="font-medium text-text-primary">Mobile app account</span> to link their login email. You can also assign them on a job — they appear here once they have work.
                </p>
              </div>
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
          <div className="rounded-2xl border border-border-light bg-card/70 p-4 mb-4 space-y-3">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-text-primary">Pick a stage to focus the list</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  Only <strong className="text-text-secondary">Active</strong> partners can be invited or assigned on jobs and quotes.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {PARTNER_STAGE_PILLS.map((s) => {
                const c =
                  s.id === "onboarding"
                    ? onboardingCount
                    : s.id === "needs_attention"
                      ? needsAttentionCount
                      : s.id === "active"
                        ? activeCount
                        : inactiveStageCount;
                const active = statusFilter === s.id;
                const Icon = s.icon;
                const selectedRing =
                  s.id === "onboarding"
                    ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                    : s.id === "needs_attention"
                      ? "border-red-500 bg-red-500/10 text-red-800 dark:text-red-200"
                      : s.id === "active"
                        ? "border-emerald-500 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200"
                        : "border-stone-700 bg-stone-800/20 text-stone-900 dark:text-stone-100";
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStatusFilter(s.id);
                      setPage(1);
                    }}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl border px-3 py-2 transition-all min-w-[7rem]",
                      active
                        ? selectedRing
                        : "border-border-light bg-card hover:border-primary/30 text-text-secondary",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                    <span className="text-xs font-semibold truncate">{s.label}</span>
                    <span
                      className={cn(
                        "ml-auto text-[11px] font-bold tabular-nums",
                        active ? "opacity-90" : "text-text-tertiary",
                      )}
                    >
                      {c}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-border-light/80">
              <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">More</span>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("all");
                  setPage(1);
                }}
                className={cn(
                  "text-xs font-medium rounded-lg px-2 py-1 transition-colors",
                  statusFilter === "all" ? "bg-surface-tertiary text-text-primary" : "text-text-tertiary hover:text-primary",
                )}
              >
                All partners
                <span className="text-[10px] text-text-tertiary ml-1 tabular-nums">({totalPartners})</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <select value={tradeFilter} onChange={(e) => { setTradeFilter(e.target.value); setPage(1); }} className={selectClasses}>
              <option value="all">All Trades</option>
              {TRADES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <SearchInput placeholder="Search partners..." className="w-56" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <DataTable
            columns={columns}
            data={partners}
            getRowId={(item) => item.id}
            selectedId={selectedPartner?.id}
            onRowClick={(p) => {
              setPartnerDrawerInitialTab(undefined);
              setSelectedPartner(p);
            }}
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
                <BulkActionBtn label="Needs attention" onClick={() => handleBulkStatusChange("needs_attention")} variant="warning" />
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
        initialTab={partnerDrawerInitialTab}
        onClose={() => {
          setSelectedPartner(null);
          setSelectedTeamMember(null);
          setPartnerDrawerInitialTab(undefined);
        }}
        onPartnerPatch={handlePartnerPatch}
        onVerify={handleVerify}
        onPartnerUpdate={setSelectedPartner}
        onTeamChanged={loadTeam}
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Partner"
        subtitle={
          viewMode === "team"
            ? "Saves to Directory. To show them under Team (App), open the partner and link their app login email, or assign them on a job."
            : "Create a new partner in your network."
        }
        size="lg"
        className="max-w-3xl"
      >
        <div className="px-6 pt-3 pb-3 border-b border-border-light">
          <Tabs
            variant="pills"
            tabs={[
              { id: "info", label: "Partner info" },
              { id: "documents", label: "Documents", count: pendingCreateDocs.length },
            ]}
            activeTab={createModalTab}
            onChange={(id) => setCreateModalTab(id as "info" | "documents")}
            className="w-full sm:w-auto"
          />
        </div>
        <div className="p-6 space-y-4">
          {createModalTab === "info" ? (
            <>
          <div className="flex flex-col sm:flex-row items-start gap-4 pb-1">
            <div className="flex flex-col items-center gap-2 shrink-0">
              <Avatar
                name={form.company_name.trim() || "Partner"}
                size="xl"
                src={createAvatarPreviewUrl ?? undefined}
              />
              <input
                ref={createAvatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const type = (f.type || "").toLowerCase();
                  if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(type)) {
                    toast.error("Use JPEG, PNG, WebP or GIF.");
                    return;
                  }
                  if (f.size > 5 * 1024 * 1024) {
                    toast.error("Image must be 5 MB or less.");
                    return;
                  }
                  setCreateAvatarFile(f);
                }}
              />
              <div className="flex flex-col items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-[11px] h-8"
                  onClick={() => createAvatarInputRef.current?.click()}
                >
                  Photo
                </Button>
                {createAvatarFile ? (
                  <button
                    type="button"
                    className="text-[10px] text-text-tertiary hover:text-text-secondary underline"
                    onClick={() => setCreateAvatarFile(null)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-text-tertiary pt-1 sm:pt-0">
              Optional profile photo. JPEG, PNG, WebP or GIF, up to 5 MB. Saved when you create the partner.
            </p>
          </div>
          <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2.5 space-y-2">
            <label className="text-xs font-medium text-text-secondary">Partner type *</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "self_employed" as const, label: "Self-employed" },
                  { value: "limited_company" as const, label: "Limited company" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                  setForm((f) => ({
                    ...f,
                    partner_legal_type: opt.value,
                    ...(opt.value === "limited_company"
                      ? { utr: "", vat_registered: null, vat_number: "" }
                      : { crn: "", vat_registered: null }),
                  }))
                }
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    form.partner_legal_type === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border-light bg-card text-text-secondary hover:border-border"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="pt-1">
              {form.partner_legal_type === "limited_company" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">CRN (Companies House)</label>
                  <Input
                    value={form.crn}
                    onChange={(e) => setForm({ ...form, crn: e.target.value })}
                    placeholder="Optional — e.g. 12345678"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">UTR (HMRC)</label>
                  <Input
                    value={form.utr}
                    onChange={(e) => setForm({ ...form, utr: e.target.value })}
                    placeholder="Optional — 10-digit UTR"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
            <p className="text-[10px] text-text-tertiary pt-0.5">
              {form.partner_legal_type === "limited_company"
                ? "Optional. You can add proof under Documents."
                : "Optional. Upload UTR proof under Documents when ready."}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Company / trading name *</label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Acme Corp" />
            </div>
            {form.partner_legal_type === "self_employed" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">VAT number (optional)</label>
                <Input
                  value={form.vat_number}
                  onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
                  placeholder="GB123456789"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-xs font-medium text-text-secondary">VAT registered? *</span>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { v: true as const, label: "Yes" },
                      { v: false as const, label: "No" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={String(opt.v)}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          vat_registered: opt.v,
                          vat_number: opt.v === false ? "" : f.vat_number,
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        form.vat_registered === opt.v
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border-light bg-card text-text-secondary hover:border-border"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.vat_registered === true && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-xs font-medium text-text-secondary">VAT number *</label>
                    <Input
                      value={form.vat_number}
                      onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
                      placeholder="GB123456789"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">Contact Name *</label>
            <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder="John Doe" />
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
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Home / business address</label>
              <Input
                value={form.partner_address}
                onChange={(e) => setForm({ ...form, partner_address: e.target.value })}
                placeholder="Street, city, postcode"
                className="text-sm"
              />
            </div>
            <UkCoveragePicker
              value={form.uk_coverage_regions}
              onChange={(next) => setForm((f) => ({ ...f, uk_coverage_regions: next }))}
              idPrefix="create-partner"
            />
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
            </>
          ) : (
            <div className="space-y-4 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain pr-1 -mr-1">
              <p className="text-xs text-text-tertiary leading-relaxed">
                Same checklist and document types as <span className="font-medium text-text-secondary">Partner profile → Documents</span>. Files upload when you create the partner. You can skip and add later.
              </p>
              <div className="rounded-xl border border-border-light bg-surface-hover/40 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text-secondary">Checklist preview</p>
                  <span className="text-xs font-bold tabular-nums text-text-primary">{documentCompliancePreviewCreate}%</span>
                </div>
                <Progress
                  value={documentCompliancePreviewCreate}
                  size="sm"
                  color={documentCompliancePreviewCreate >= 90 ? "emerald" : documentCompliancePreviewCreate >= 50 ? "primary" : "amber"}
                />
              </div>
              {missingRequiredDocsCreate.length > 0 && (
                <div
                  role="alert"
                  className="flex gap-3 rounded-xl border border-amber-300/80 bg-amber-50/60 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/25"
                >
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">Still missing for full checklist</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {missingRequiredDocsCreate.length} requirement{missingRequiredDocsCreate.length === 1 ? "" : "s"} not yet satisfied in your queue — add below or after creating.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-text-primary">{pendingCreateDocs.length} in queue</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  icon={<Upload className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setCreateDocPreset(null);
                    setCreateQueueDocOpen(true);
                  }}
                >
                  Add document
                </Button>
              </div>
              <div className="rounded-xl border border-border-light bg-card/60 p-3 space-y-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Agreements</p>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  No expiry date required. In-app submission can be wired later; upload files here for the record.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCreateDocPreset({ docType: "service_agreement", name: "Service Agreement" });
                      setCreateQueueDocOpen(true);
                    }}
                  >
                    Service Agreement
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCreateDocPreset({ docType: "self_bill_agreement", name: "Self Bill Agreement" });
                      setCreateQueueDocOpen(true);
                    }}
                  >
                    Self Bill Agreement
                  </Button>
                </div>
              </div>
              {partnerTradesForCreate.length > 0 &&
                partnerTradesForCreate.some((t) => (OPTIONAL_TRADE_CERTS_BY_TRADE[t] ?? []).length > 0) && (
                <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Optional certificates</p>
                  <p className="text-[11px] text-text-tertiary leading-snug">
                    CSCS etc. — shown only for selected trades; not part of the compliance score.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {partnerTradesForCreate.flatMap((t) =>
                      (OPTIONAL_TRADE_CERTS_BY_TRADE[t] ?? []).map((certName) => (
                        <Button
                          key={`create-opt-${t}-${certName}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-dashed"
                          onClick={() => {
                            setCreateDocPreset({ docType: "certification", name: certName });
                            setCreateQueueDocOpen(true);
                          }}
                        >
                          {certName}
                          <span className="ml-1 text-[10px] font-normal text-text-tertiary">({t})</span>
                        </Button>
                      )),
                    )}
                  </div>
                </div>
              )}
              {partnerTradesForCreate.length > 0 && (
              <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Other optional</p>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  DBS — optional; not part of the compliance score. Shown when at least one trade is selected.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-dashed"
                  onClick={() => {
                    setCreateDocPreset({ docType: "dbs", name: "DBS certificate" });
                    setCreateQueueDocOpen(true);
                  }}
                >
                  DBS
                </Button>
              </div>
              )}
              <div className="rounded-xl border border-border-light bg-surface-hover/30 p-3 space-y-3">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Mandatory documents</p>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  Included in the compliance score preview (plus agreements). Trade-specific certificates are listed below.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {mandatoryDocsCreate.map((req) => {
                    const matchedDocs = pickRequiredDocMatches(pendingDocsForCompliancePreview, req);
                    const doc = matchedDocs[0] ?? null;
                    const expiresAt = doc?.expires_at ? new Date(doc.expires_at) : null;
                    const now = new Date();
                    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                    const isExpired = !!(expiresAt && expiresAt < now);
                    const isExpiringSoon = !!(expiresAt && expiresAt >= now && expiresAt <= in30Days);
                    const certDocs = req.docType === "certification" ? matchedDocs : [];
                    const certValidCount = certDocs.filter((d) => {
                      if (!d.expires_at) return true;
                      return new Date(d.expires_at) >= now;
                    }).length;
                    const certExpiringSoonCount = certDocs.filter((d) => {
                      if (!d.expires_at) return false;
                      const dt = new Date(d.expires_at);
                      return dt >= now && dt <= in30Days;
                    }).length;
                    const certExpiredCount = certDocs.filter((d) => !!(d.expires_at && new Date(d.expires_at) < now)).length;
                    const statusLabel = req.docType === "certification"
                      ? certDocs.length === 0
                        ? "Missing"
                        : certValidCount > 0
                          ? certExpiringSoonCount > 0 ? "Valid (some expiring soon)" : "Valid"
                          : certExpiredCount > 0 ? "Expired" : "Pending"
                      : !doc
                        ? "Missing"
                        : isExpired ? "Expired" : isExpiringSoon ? "Expiring soon" : "Valid";
                    const statusVariant = req.docType === "certification"
                      ? certDocs.length === 0
                        ? "default"
                        : certValidCount > 0
                          ? certExpiringSoonCount > 0 ? "warning" : "success"
                          : certExpiredCount > 0 ? "danger" : "default"
                      : !doc
                        ? "default"
                        : isExpired ? "danger" : isExpiringSoon ? "warning" : "success";

                    return (
                      <div key={req.id} className="rounded-lg border border-border-light bg-card p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-text-primary">{req.name}</p>
                            <p className="text-[11px] text-text-tertiary">{req.description}</p>
                          </div>
                          <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
                        </div>
                        {doc?.expires_at && (
                          <p className={`text-[11px] ${isExpired ? "text-red-500" : "text-text-tertiary"}`}>
                            Expires: {new Date(doc.expires_at).toLocaleDateString()}
                          </p>
                        )}
                        {req.docType === "certification" && matchedDocs.length > 0 && (
                          <p className="text-[11px] text-text-tertiary">
                            In queue: {matchedDocs.length}
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setCreateDocPreset({ docType: req.docType, name: req.name });
                            setCreateQueueDocOpen(true);
                          }}
                        >
                          {req.docType === "certification" ? "Add another certificate" : doc ? "Replace / update" : "Add document"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                {tradeCertsDocsCreate.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide pt-1">Trade certificates</p>
                    <p className="text-[11px] text-text-tertiary leading-snug">
                      Only for the types of work you selected above — not included in the compliance score preview.
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                        <Input
                          value={createCustomCertName}
                          onChange={(e) => setCreateCustomCertName(e.target.value)}
                          placeholder="Add custom certificate requirement"
                          className="h-8 w-full min-[420px]:w-64"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!createCustomCertName.trim()}
                          onClick={() => {
                            setCreateDocPreset({ docType: "certification", name: createCustomCertName.trim() });
                            setCreateQueueDocOpen(true);
                          }}
                        >
                          Add cert
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {tradeCertsDocsCreate.map((req) => {
                        const matchedDocs = pickRequiredDocMatches(pendingDocsForCompliancePreview, req);
                        const doc = matchedDocs[0] ?? null;
                        const expiresAt = doc?.expires_at ? new Date(doc.expires_at) : null;
                        const now = new Date();
                        const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                        const isExpired = !!(expiresAt && expiresAt < now);
                        const isExpiringSoon = !!(expiresAt && expiresAt >= now && expiresAt <= in30Days);
                        const certDocs = req.docType === "certification" ? matchedDocs : [];
                        const certValidCount = certDocs.filter((d) => {
                          if (!d.expires_at) return true;
                          return new Date(d.expires_at) >= now;
                        }).length;
                        const certExpiringSoonCount = certDocs.filter((d) => {
                          if (!d.expires_at) return false;
                          const dt = new Date(d.expires_at);
                          return dt >= now && dt <= in30Days;
                        }).length;
                        const certExpiredCount = certDocs.filter((d) => !!(d.expires_at && new Date(d.expires_at) < now)).length;
                        const statusLabel = certDocs.length === 0
                          ? "Missing"
                          : certValidCount > 0
                            ? certExpiringSoonCount > 0 ? "Valid (some expiring soon)" : "Valid"
                            : certExpiredCount > 0 ? "Expired" : "Pending";
                        const statusVariant = certDocs.length === 0
                          ? "default"
                          : certValidCount > 0
                            ? certExpiringSoonCount > 0 ? "warning" : "success"
                            : certExpiredCount > 0 ? "danger" : "default";

                        return (
                          <div key={req.id} className="rounded-lg border border-border-light bg-card p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-text-primary">{req.name}</p>
                                <p className="text-[11px] text-text-tertiary">{req.description}</p>
                              </div>
                              <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
                            </div>
                            {doc?.expires_at && (
                              <p className={`text-[11px] ${isExpired ? "text-red-500" : "text-text-tertiary"}`}>
                                Expires: {new Date(doc.expires_at).toLocaleDateString()}
                              </p>
                            )}
                            {matchedDocs.length > 0 && (
                              <p className="text-[11px] text-text-tertiary">
                                In queue: {matchedDocs.length}
                              </p>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => {
                                setCreateDocPreset({ docType: req.docType, name: req.name });
                                setCreateQueueDocOpen(true);
                              }}
                            >
                              {matchedDocs.length ? "Add another certificate" : "Add certificate"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              {pendingCreateDocs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-light bg-card/50 px-4 py-8 text-center">
                  <FileText className="h-8 w-8 text-text-tertiary mx-auto mb-2 opacity-80" />
                  <p className="text-sm text-text-secondary">Nothing in queue yet</p>
                  <p className="text-xs text-text-tertiary mt-1 max-w-sm mx-auto">Use the checklist above or Add document.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Queued uploads</p>
                  <ul className="space-y-2">
                    {pendingCreateDocs.map((d) => {
                      const tl = docTypeLabels[d.docType] || docTypeLabels.other;
                      const TypeIcon = tl.icon;
                      return (
                        <li
                          key={d.id}
                          className="flex items-start gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5"
                        >
                          <div className="h-9 w-9 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
                            <TypeIcon className="h-4 w-4 text-text-secondary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate">{d.name}</p>
                            <p className="text-[11px] text-text-tertiary">{tl.label} · {d.file.name}</p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 p-1.5 rounded-lg text-text-tertiary hover:text-red-600 hover:bg-red-500/10"
                            aria-label="Remove from queue"
                            onClick={() => setPendingCreateDocs((prev) => prev.filter((x) => x.id !== d.id))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-border-light">
          <p className="text-[11px] text-text-tertiary hidden sm:block">
            {createModalTab === "documents" ? "Switch to Partner info to edit details, or create when ready." : null}
          </p>
          <div className="flex items-center justify-end gap-3 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={submitting}>{submitting ? "Creating…" : "Create Partner"}</Button>
          </div>
        </div>
      </Modal>

      <AddPartnerDocumentModal
        open={createQueueDocOpen}
        onClose={() => {
          setCreateQueueDocOpen(false);
          setCreateDocPreset(null);
          setCreateCustomCertName("");
        }}
        submitting={false}
        onSubmit={handleQueueDocForCreate}
        initialDocType={createDocPreset?.docType}
        initialName={createDocPreset?.name}
      />
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

function inferVatRegisteredForForm(partner: Partner): boolean | null {
  if (inferPartnerLegal(partner) !== "limited_company") return null;
  if (partner.vat_registered === true || partner.vat_registered === false) return partner.vat_registered;
  return partner.vat_number?.trim() ? true : null;
}

function partnerOverviewFormFromPartner(partner: Partner) {
  return {
    company_name: partner.company_name ?? "",
    vat_number: partner.vat_number ?? "",
    vat_registered: inferVatRegisteredForForm(partner),
    crn: partner.crn ?? "",
    utr: partner.utr ?? "",
    partner_legal_type: partner.partner_legal_type ?? "self_employed",
    contact_name: partner.contact_name ?? "",
    email: partner.email ?? "",
    phone: partner.phone ?? "",
    trades: partner.trades?.length ? partner.trades : [partner.trade ?? TRADES[0]],
    uk_coverage_regions: partnerCoverageToForm(partner),
    partner_address: partner.partner_address ?? "",
    rating: String(partner.rating ?? 0),
  };
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

/** Shared insert + storage upload for partner_documents (drawer upload + create-partner queue). */
async function insertAndUploadPartnerDocument(opts: {
  partnerId: string;
  uploadedByName?: string | null;
  docType: string;
  name: string;
  file: File;
  previewFile: File | null;
  expiresAt?: string;
  certificateNumber?: string;
}): Promise<void> {
  const supabase = getSupabase();
  const { partnerId, uploadedByName, docType, name, file, previewFile, expiresAt, certificateNumber } = opts;
  const expiresIso = resolvePartnerDocExpiresAt(docType, expiresAt);
  const { data: row, error: insErr } = await supabase
    .from("partner_documents")
    .insert({
      partner_id: partnerId,
      name,
      doc_type: docType,
      status: "pending",
      uploaded_by: uploadedByName ?? undefined,
      expires_at: expiresIso,
      notes: docType === "certification" && certificateNumber ? `certificate_number: ${certificateNumber}` : null,
    })
    .select()
    .single();
  if (insErr) throw new Error(insErr.message);
  if (!row?.id) throw new Error("No document row");

  try {
    const main = await uploadPartnerDocumentFile(partnerId, row.id, file);
    let previewPath: string | null = null;
    if (previewFile) {
      const prev = await uploadPartnerDocumentPreview(partnerId, row.id, previewFile);
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
      const folder = `${partnerId}/${row.id}`;
      const { data: list } = await supabase.storage.from("partner-documents").list(folder);
      const paths = (list ?? []).map((f) => `${folder}/${f.name}`);
      if (paths.length > 0) await removeStorageObjects(paths);
    } catch {
      /* ignore */
    }
    await supabase.from("partner_documents").delete().eq("id", row.id);
    throw uploadErr;
  }
}

const docTypeLabels: Record<string, { label: string; icon: typeof FileText }> = {
  insurance: { label: "Insurance", icon: ShieldCheck },
  certification: { label: "Certification", icon: CheckCircle2 },
  license: { label: "License", icon: FileText },
  contract: { label: "Contract", icon: FileText },
  tax: { label: "Tax Document", icon: DollarSign },
  utr: { label: "UTR / HMRC", icon: DollarSign },
  service_agreement: { label: "Service Agreement", icon: FileText },
  self_bill_agreement: { label: "Self Bill Agreement", icon: FileText },
  id_proof: { label: "ID Proof", icon: Users },
  proof_of_address: { label: "Proof of Address", icon: FileText },
  right_to_work: { label: "Right to Work", icon: FileText },
  poa: { label: "Power of Attorney (POA)", icon: FileText },
  dbs: { label: "DBS (Disclosure & Barring)", icon: ShieldCheck },
  other: { label: "Other", icon: FileText },
};

const docStatusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" | "danger" }> = {
  pending: { label: "Pending Review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  expired: { label: "Expired", variant: "default" },
};

/** Map create-partner queue to PartnerDoc shape for the same compliance matching as the profile Documents tab. */
function pendingCreateDocsAsPartnerDocs(queue: PendingCreatePartnerDoc[]): PartnerDoc[] {
  return queue.map((d) => ({
    id: d.id,
    name: d.name,
    doc_type: d.docType,
    status: "pending",
    created_at: new Date().toISOString(),
    expires_at: resolvePartnerDocExpiresAt(d.docType, d.expiresAt) ?? undefined,
    notes: d.certificateNumber ? `certificate_number: ${d.certificateNumber}` : undefined,
  }));
}

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
  initialDocType,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (
    docType: string,
    name: string,
    file: File,
    preview: File | null,
    expiresAt?: string,
    certificateNumber?: string,
  ) => Promise<void>;
  initialDocType?: string;
  initialName?: string;
}) {
  const [docType, setDocType] = useState("insurance");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [certificateNumber, setCertificateNumber] = useState("");
  const [aiExpiryLoading, setAiExpiryLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setName(initialName ?? "");
      setFile(null);
      setPreview(null);
      setExpiresAt("");
      setCertificateNumber("");
      setDocType(initialDocType ?? "insurance");
      setAiExpiryLoading(false);
    });
  }, [open, initialDocType, initialName]);

  const expiryPol = partnerDocExpiryPolicy(docType);

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
    if (docType === "certification" && !certificateNumber.trim()) {
      toast.error("Enter certificate number");
      return;
    }
    if (expiryPol === "manual" && !expiresAt.trim()) {
      toast.error("Enter the expiry date (required), or use Detect expiry (AI) on an image.");
      return;
    }
    void onSubmit(
      docType,
      name.trim(),
      file,
      preview,
      expiryPol === "manual" && expiresAt.trim() ? expiresAt.trim() : undefined,
      certificateNumber.trim() || undefined,
    );
  };

  async function handleDetectExpiryAi() {
    if (!file) {
      toast.error("Choose a document file first");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("AI reads images only — use a photo or screenshot of the document, or type the expiry date.");
      return;
    }
    setAiExpiryLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/partner-documents/suggest-expiry", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { expiry_date?: string | null; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not detect expiry");
      }
      if (data.expiry_date) {
        setExpiresAt(data.expiry_date);
        toast.success("Expiry date filled — review and confirm.");
      } else {
        toast.info("Could not read an expiry date — enter it manually below.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI detection failed — enter expiry manually.");
    } finally {
      setAiExpiryLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add document"
      subtitle="Insurance & certificates need an expiry date. Agreements, UTR, proof of address & right to work skip it. POA: valid 1 year from upload."
      size="md"
    >
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
        {docType === "certification" && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Certificate number *</label>
            <Input
              value={certificateNumber}
              onChange={(e) => setCertificateNumber(e.target.value)}
              placeholder="e.g. GS-123456 / FGAS-9981"
            />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Document file *</label>
          <input
            type="file"
            accept=".pdf,.doc,.docx,image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-hover file:text-text-primary"
          />
          <p className="text-[10px] text-text-tertiary mt-1">PDF, Word, or image — max 10 MB. For AI expiry detection, use an image.</p>
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
        {expiryPol === "none" && (
          <p className="text-[11px] text-text-tertiary rounded-lg border border-border-light bg-surface-hover/30 px-3 py-2">
            No expiry date for this document type.
          </p>
        )}
        {expiryPol === "one_year_from_upload" && (
          <div className="rounded-lg border border-blue-200/60 bg-blue-50/60 dark:bg-blue-950/25 px-3 py-2.5 text-xs text-text-secondary">
            <span className="font-semibold text-text-primary">Expiry:</span> automatically set to{" "}
            <strong>one year from the upload date</strong> (when you save).
          </div>
        )}
        {expiryPol === "manual" && (
          <div className="rounded-xl border border-border-light bg-surface-hover/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-xs font-medium text-text-secondary">Expiry date *</label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiExpiryLoading || submitting || !file || !file.type.startsWith("image/")}
                onClick={() => void handleDetectExpiryAi()}
              >
                {aiExpiryLoading ? "Detecting…" : "Detect expiry (AI)"}
              </Button>
            </div>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required />
            <p className="text-[10px] text-text-tertiary">
              Required for compliance tracking. AI works on <span className="font-medium text-text-secondary">images</span> only — for PDFs, type the date. If
              OPENAI_API_KEY is not set, enter the date manually.
            </p>
          </div>
        )}
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
    queueMicrotask(() => setLoadingUrls(true));
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
  initialTab,
  onClose,
  onPartnerPatch,
  onVerify,
  onPartnerUpdate,
  onTeamChanged,
}: {
  partner: Partner | null;
  teamMember: TeamMember | null;
  /** When opening the drawer (e.g. after create), start on this tab. */
  initialTab?: string;
  onClose: () => void;
  onPartnerPatch: (patch: Partial<Partner>) => Promise<void>;
  onVerify: (partner: Partner) => void;
  onPartnerUpdate?: (updated: Partner) => void;
  onTeamChanged?: () => void;
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
  const [bankSortCodeInput, setBankSortCodeInput] = useState("");
  const [bankAccountNumberInput, setBankAccountNumberInput] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankSaving, setBankSaving] = useState(false);
  const [partnerLocation, setPartnerLocation] = useState<Awaited<ReturnType<typeof getLatestLocation>>>(null);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [addDocSubmitting, setAddDocSubmitting] = useState(false);
  const [requestLinkOpen, setRequestLinkOpen] = useState(false);
  const [requestLinkSubmitting, setRequestLinkSubmitting] = useState(false);
  const [requestLinkDocTypes, setRequestLinkDocTypes] = useState<string[]>([]);
  const [requestLinkMessage, setRequestLinkMessage] = useState("");
  const [requestLinkResult, setRequestLinkResult] = useState<{
    uploadUrl: string;
    sentTo: string;
    expiresAt: string;
    emailSent: boolean;
    emailError: string | null;
  } | null>(null);
  const [requestLinkError, setRequestLinkError] = useState<string | null>(null);
  const [docPreset, setDocPreset] = useState<{ docType: string; name: string } | null>(null);
  const [customCertName, setCustomCertName] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const partnerAvatarInputRef = useRef<HTMLInputElement>(null);
  const [selectedDoc, setSelectedDoc] = useState<PartnerDoc | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkedAppProfile, setLinkedAppProfile] = useState<Awaited<ReturnType<typeof getProfileById>>>(null);
  const [editingOverview, setEditingOverview] = useState(false);
  const [overviewForm, setOverviewForm] = useState({
    company_name: "",
    vat_number: "",
    vat_registered: null as boolean | null,
    crn: "",
    utr: "",
    partner_legal_type: "self_employed" as PartnerLegalType,
    contact_name: "",
    email: "",
    phone: "",
    trades: [TRADES[0]] as string[],
    uk_coverage_regions: defaultUkCoverage(),
    partner_address: "",
    rating: "",
  });
  /** Only apply initialTab when switching to a different partner (avoid resetting tab on realtime updates). */
  const lastPartnerIdForTabRef = useRef<string | null>(null);

  const [activateForceOpen, setActivateForceOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivatePreset, setDeactivatePreset] = useState<"" | "missing_docs" | "low_score" | "on_break" | "other">("");
  const [deactivateOtherText, setDeactivateOtherText] = useState("");
  const [deactivateOtherStage, setDeactivateOtherStage] = useState<PartnerStatus>("needs_attention");

  const [portalLinkModalOpen, setPortalLinkModalOpen] = useState(false);
  const [portalLinkSelectedIds, setPortalLinkSelectedIds] = useState<Set<string>>(() => new Set());
  const [portalLinkSubmitting, setPortalLinkSubmitting] = useState(false);
  const [portalExpiresDays, setPortalExpiresDays] = useState(14);
  const [portalLinkResult, setPortalLinkResult] = useState<{
    shortUrl: string;
    fullUrl?: string;
    expiresAt: string;
  } | null>(null);

  const portalAllowlistOptions = useMemo(
    () => (partner ? getPartnerPortalAllowlistOptions(partner) : []),
    [partner],
  );

  useEffect(() => {
    if (!portalLinkModalOpen || !partner) return;
    setPortalLinkSelectedIds(new Set(getPartnerPortalAllowlistIds(partner)));
  }, [portalLinkModalOpen, partner]);

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
    if (!partner?.auth_user_id) {
      setLinkedAppProfile(null);
      return;
    }
    let cancelled = false;
    getProfileById(partner.auth_user_id).then((p) => {
      if (!cancelled) setLinkedAppProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [partner?.auth_user_id, partner?.id]);

  useEffect(() => {
    if (!partner) {
      lastPartnerIdForTabRef.current = null;
      return;
    }
    const idChanged = lastPartnerIdForTabRef.current !== partner.id;
    if (idChanged) {
      lastPartnerIdForTabRef.current = partner.id;
      setTab(initialTab ?? "overview");
    }
    setSelectedDoc(null);
    setLinkEmail(partner.email ?? "");
    loadAll(partner);
    setEditingOverview(false);
    setOverviewForm(partnerOverviewFormFromPartner(partner));
  }, [partner, loadAll, initialTab]);

  useEffect(() => {
    if (!partner) return;
    setBankSortCodeInput(formatUkSortCodeForDisplay(partner.bank_sort_code ?? ""));
    setBankAccountNumberInput(partner.bank_account_number ?? "");
    setBankAccountHolder(partner.bank_account_holder ?? "");
    setBankName(partner.bank_name ?? "");
  }, [
    partner?.id,
    partner?.bank_sort_code,
    partner?.bank_account_number,
    partner?.bank_account_holder,
    partner?.bank_name,
  ]);

  const bankDirty = useMemo(() => {
    if (!partner) return false;
    const s = normalizeUkSortCodeInput(bankSortCodeInput);
    const a = normalizeUkAccountNumberInput(bankAccountNumberInput);
    return (
      s !== (partner.bank_sort_code ?? "") ||
      a !== (partner.bank_account_number ?? "") ||
      bankAccountHolder.trim() !== (partner.bank_account_holder ?? "").trim() ||
      bankName.trim() !== (partner.bank_name ?? "").trim()
    );
  }, [partner, bankSortCodeInput, bankAccountNumberInput, bankAccountHolder, bankName]);

  const resetBankForm = useCallback(() => {
    if (!partner) return;
    setBankSortCodeInput(formatUkSortCodeForDisplay(partner.bank_sort_code ?? ""));
    setBankAccountNumberInput(partner.bank_account_number ?? "");
    setBankAccountHolder(partner.bank_account_holder ?? "");
    setBankName(partner.bank_name ?? "");
  }, [partner]);

  const handleSaveBankDetails = useCallback(async () => {
    if (!partner) return;
    const sortDigits = normalizeUkSortCodeInput(bankSortCodeInput);
    const acctDigits = normalizeUkAccountNumberInput(bankAccountNumberInput);
    const v = validatePartnerBankDetails({
      sortDigits,
      accountDigits: acctDigits,
      accountHolder: bankAccountHolder,
      bankName,
    });
    if (!v.ok) {
      toast.error(v.message);
      return;
    }
    setBankSaving(true);
    try {
      await onPartnerPatch({
        bank_sort_code: sortDigits || null,
        bank_account_number: acctDigits || null,
        bank_account_holder: bankAccountHolder.trim() || null,
        bank_name: bankName.trim() || null,
      });
    } finally {
      setBankSaving(false);
    }
  }, [partner, bankSortCodeInput, bankAccountNumberInput, bankAccountHolder, bankName, onPartnerPatch]);

  const syncAppUserRow = useCallback(async (userId: string, partnerRowId: string) => {
    const res = await fetch("/api/admin/partner/sync-app-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, partnerId: partnerRowId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      hint?: string;
    };
    if (!res.ok) {
      const msg = [data.error, data.hint].filter(Boolean).join(" — ") || "Could not sync public.users";
      throw new Error(msg);
    }
    return data;
  }, []);

  const handleLinkAppUser = async () => {
    if (!partner) return;
    const raw = linkEmail.trim();
    if (!raw) {
      toast.error("Enter the email they use to log into the app.");
      return;
    }
    setLinkBusy(true);
    try {
      const supabase = getSupabase();
      const { data: found, error: qErr } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .ilike("email", raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_"))
        .limit(8);
      if (qErr) throw new Error(qErr.message);
      const match =
        (found ?? []).find((r) => (r.email ?? "").toLowerCase() === raw.toLowerCase()) ?? (found ?? [])[0];
      if (!match?.id) {
        toast.error("No profile with that email. They need to register in the Master Services app first.");
        return;
      }
      const { data: clash } = await supabase
        .from("partners")
        .select("id, company_name")
        .eq("auth_user_id", match.id)
        .neq("id", partner.id)
        .maybeSingle();
      if (clash) {
        toast.error(
          `That app account is already linked to “${(clash as { company_name: string }).company_name}”.`
        );
        return;
      }
      const updated = await updatePartner(partner.id, { auth_user_id: match.id });
      onPartnerUpdate?.(updated);
      setLinkedAppProfile(await getProfileById(match.id));
      try {
        await syncAppUserRow(match.id, partner.id);
        toast.success("Linked — Team (App) + mobile app profile (users) ready.");
      } catch (syncErr) {
        toast.success("Linked in OS — they appear under Team (App).");
        toast.error(
          syncErr instanceof Error
            ? `${syncErr.message} Add SUPABASE_SERVICE_ROLE_KEY to the server env, or run docs/SQL_APP_SETUP.sql if users is missing.`
            : "Could not create row in public.users for the app."
        );
      }
      onTeamChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to link");
    } finally {
      setLinkBusy(false);
    }
  };

  const handleUnlinkAppUser = async () => {
    if (!partner?.auth_user_id) return;
    setLinkBusy(true);
    try {
      const updated = await updatePartner(partner.id, { auth_user_id: null });
      onPartnerUpdate?.(updated);
      setLinkedAppProfile(null);
      toast.success("App link removed.");
      onTeamChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove link");
    } finally {
      setLinkBusy(false);
    }
  };

  const handleSaveOverview = useCallback(async () => {
    if (!partner) return;
    if (!overviewForm.company_name.trim() || !overviewForm.contact_name.trim() || !overviewForm.email.trim()) {
      toast.error("Company name, contact name and email are required.");
      return;
    }
    const rating = Number(overviewForm.rating || "0");
    if (Number.isNaN(rating) || rating < 0 || rating > 5) {
      toast.error("Rating must be between 0 and 5.");
      return;
    }
    if (overviewForm.partner_legal_type === "limited_company") {
      if (overviewForm.vat_registered === null) {
        toast.error("Select whether the company is VAT registered.");
        return;
      }
      if (overviewForm.vat_registered === true && !overviewForm.vat_number.trim()) {
        toast.error("Enter the VAT number.");
        return;
      }
    }
    try {
      const primaryTrade = overviewForm.trades[0] ?? TRADES[0];
      const regions = normalizeUkCoverageRegions(overviewForm.uk_coverage_regions);
      const updated = await updatePartner(partner.id, {
        company_name: overviewForm.company_name.trim(),
        vat_number:
          overviewForm.partner_legal_type === "limited_company"
            ? overviewForm.vat_registered === true
              ? overviewForm.vat_number.trim() || null
              : null
            : overviewForm.vat_number.trim() || null,
        vat_registered:
          overviewForm.partner_legal_type === "limited_company" ? overviewForm.vat_registered : null,
        partner_legal_type: overviewForm.partner_legal_type,
        crn:
          overviewForm.partner_legal_type === "limited_company"
            ? (overviewForm.crn.trim() || null)
            : null,
        utr:
          overviewForm.partner_legal_type === "self_employed"
            ? (overviewForm.utr.trim() || null)
            : null,
        contact_name: overviewForm.contact_name.trim(),
        email: overviewForm.email.trim(),
        phone: overviewForm.phone.trim() || undefined,
        trade: primaryTrade,
        trades: overviewForm.trades,
        location: formatUkCoverageLabel(regions, null),
        uk_coverage_regions: regions,
        partner_address: overviewForm.partner_address.trim() || null,
        rating,
      });
      onPartnerUpdate?.(updated);
      setEditingOverview(false);
      toast.success("Partner updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }, [partner, overviewForm, onPartnerUpdate]);

  const handleAddDocument = async (
    docType: string,
    name: string,
    file: File,
    previewFile: File | null,
    expiresAt?: string,
    certificateNumber?: string,
  ) => {
    if (!partner) return;
    setAddDocSubmitting(true);
    try {
      await insertAndUploadPartnerDocument({
        partnerId: partner.id,
        uploadedByName: profile?.full_name,
        docType,
        name,
        file,
        previewFile,
        expiresAt,
        certificateNumber,
      });
      toast.success("Document uploaded");
      setAddDocOpen(false);
      const supabase = getSupabase();
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

  const partnerTradesForCompliance = useMemo(
    () => (partner ? partnerTradesForDisplay(partner) : []),
    [partner],
  );
  const mandatoryDocsForScore = partner ? buildMandatoryDocsForComplianceScore(partner) : [];
  const tradeCertificateDocs = partner ? buildTradeCertificateRequirements(partnerTradesForCompliance) : [];
  const requiredDocuments = useMemo(
    () => (partner ? buildRequiredDocumentChecklist(partnerTradesForCompliance, partner) : []),
    [partner, partnerTradesForCompliance],
  );
  const documentComplianceScore = partner ? computeComplianceScore(documents, mandatoryDocsForScore) : 0;
  const profileCompletenessScore = partner ? computeProfileCompletenessScore(partner) : 0;
  const expiredDocCount = countExpiredDocuments(documents);
  const computedCompliance = partner
    ? mergePartnerComplianceScore(documentComplianceScore, profileCompletenessScore, expiredDocCount)
    : 0;

  const profileCompletenessItems = partner ? getProfileCompletenessItems(partner) : [];
  const complianceAttentionCount =
    partner
      ? profileCompletenessItems.filter((i) => !i.done).length +
        mandatoryDocsForScore.filter((req) => getRequiredDocComplianceStatus(documents, req) !== "valid").length
      : 0;

  const missingRequiredDocs =
    partner
      ? mandatoryDocsForScore.filter((req) => getRequiredDocComplianceStatus(documents, req) !== "valid")
      : [];

  const dbsOptionalStatus = getOptionalDbsStatus(documents);

  useEffect(() => {
    if (!partner || teamMember) return;
    if (Number(partner.compliance_score ?? 0) === computedCompliance) return;
    void updatePartner(partner.id, { compliance_score: computedCompliance })
      .then((updated) => onPartnerUpdate?.(updated))
      .catch(() => {});
  }, [partner, teamMember, computedCompliance, onPartnerUpdate]);

  const runActivate = useCallback(
    async (force: boolean) => {
      if (!partner) return;
      if (!force && shouldForceActivateAck(computedCompliance)) {
        setActivateForceOpen(true);
        return;
      }
      await onPartnerPatch({ status: "active", partner_status_reasons: [] });
      setActivateForceOpen(false);
    },
    [partner, computedCompliance, onPartnerPatch],
  );

  const submitDeactivate = useCallback(async () => {
    if (!partner || !deactivatePreset) return;
    try {
      if (deactivatePreset === "missing_docs") {
        await onPartnerPatch({
          status: "needs_attention",
          partner_status_reasons: mergeUniqueReasons(partner.partner_status_reasons, ["missing_documents"]),
        });
      } else if (deactivatePreset === "low_score") {
        await onPartnerPatch({
          status: "needs_attention",
          partner_status_reasons: mergeUniqueReasons(partner.partner_status_reasons, ["low_compliance_score"]),
        });
      } else if (deactivatePreset === "on_break") {
        await onPartnerPatch({
          status: "inactive",
          partner_status_reasons: mergeUniqueReasons(partner.partner_status_reasons, ["on_break"]),
        });
      } else if (deactivatePreset === "other") {
        const tail = deactivateOtherText.trim();
        const reason = tail ? `other:${tail}` : "other:";
        await onPartnerPatch({
          status: deactivateOtherStage,
          partner_status_reasons: mergeUniqueReasons(partner.partner_status_reasons, [reason]),
        });
      }
      setDeactivateOpen(false);
      setDeactivatePreset("");
      setDeactivateOtherText("");
    } catch {
      /* toast handled by parent */
    }
  }, [partner, deactivatePreset, deactivateOtherText, deactivateOtherStage, onPartnerPatch]);

  useEffect(() => {
    if (!partner || teamMember) return;
    if (isPartnerInactiveStage(partner)) return;
    const auto = computeAutoReasonCodes({
      missingMandatoryDocs: missingRequiredDocs.length > 0,
      hasExpiredDocs: expiredDocCount > 0,
      complianceBelowThreshold: computedCompliance < ACTIVATION_COMPLIANCE_MIN_SCORE,
    });
    const { status: nextStatus, partner_status_reasons: nextReasons } = deriveAutoStatusAndReasons(partner, auto);
    const curR = [...(partner.partner_status_reasons ?? [])].sort().join("|");
    const nextR = [...nextReasons].sort().join("|");
    if (nextStatus === partner.status && curR === nextR) return;
    const t = window.setTimeout(() => {
      void onPartnerPatch({ status: nextStatus, partner_status_reasons: nextReasons });
    }, 800);
    return () => window.clearTimeout(t);
  }, [
    partner?.id,
    partner?.status,
    partner?.partner_status_reasons,
    teamMember,
    missingRequiredDocs.length,
    expiredDocCount,
    computedCompliance,
    onPartnerPatch,
  ]);

  const togglePortalDocId = useCallback((id: string) => {
    setPortalLinkSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const handleGeneratePortalLink = useCallback(async () => {
    if (!partner) return;
    const ids = [...portalLinkSelectedIds];
    if (ids.length === 0) {
      toast.error("Select at least one document type.");
      return;
    }
    setPortalLinkSubmitting(true);
    try {
      const res = await fetch("/api/admin/partner/portal-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: partner.id,
          expiresInDays: portalExpiresDays,
          requestedDocIds: ids,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        url?: string;
        shortUrl?: string;
        expiresAt?: string;
        message?: string;
        emailSent?: boolean;
        emailTo?: string;
        emailNotice?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed");
      const shortUrl = (data.shortUrl ?? data.url ?? "").trim();
      const fullUrl = (data.url ?? "").trim();
      if (!shortUrl) throw new Error("No URL returned.");
      setPortalLinkResult({
        shortUrl,
        fullUrl: fullUrl !== shortUrl ? fullUrl : undefined,
        expiresAt: data.expiresAt ?? "",
      });
      if (data.emailSent) {
        toast.success(
          data.emailTo
            ? `Link created and email sent to ${data.emailTo}.`
            : "Link created and email sent to the partner.",
        );
      } else {
        toast.success("Link ready — copy or send manually.");
        if (data.emailNotice) {
          toast.info(data.emailNotice);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setPortalLinkSubmitting(false);
    }
  }, [partner, portalLinkSelectedIds, portalExpiresDays]);

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

  const config = statusConfig[partner.status] ?? statusConfig.active;

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
  if (computedCompliance < 70) {
    overviewAlerts.push({
      key: "low-compliance",
      level: "warning",
      text: `Compliance score is ${computedCompliance}%. Follow up on missing or expired requirements.`,
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
    { id: "documents", label: "Documents", count: documents.length },
    { id: "financial", label: "Financial", count: selfBills.length },
    { id: "jobs", label: "Jobs", count: realJobsCount },
    {
      id: "compliance",
      label: "Compliance",
      count: complianceAttentionCount > 0 ? complianceAttentionCount : undefined,
    },
    { id: "actions" as const, label: "Privacy & Permissions" },
    { id: "notes", label: "Notes", count: notes.length },
    ...(partner.auth_user_id ? [{ id: "location" as const, label: "Location" }] : []),
  ];

  return (
    <Drawer
      open={!!partner}
      onClose={onClose}
      title={partner.company_name}
      subtitle={
        (partnerTradesForDisplay(partner).join(" · ") || "Trade TBC") +
        " · " +
        (formatUkCoverageLabel(partner.uk_coverage_regions, partner.location) || "Coverage TBC")
      }
      width="w-[min(100vw-1rem,580px)]"
    >
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
                          setOverviewForm(partnerOverviewFormFromPartner(partner));
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
                  <Badge variant={config.variant} dot size="md">
                    {partner.status === "on_break" ? "Inactive" : config.label}
                  </Badge>
                  {partner.status === "on_break" ? (
                    <span className="inline-flex items-center rounded-md border border-stone-400/60 bg-stone-500/10 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                      On break
                    </span>
                  ) : null}
                  {(() => {
                    const raw = partner.partner_status_reasons ?? [];
                    const reasonsForDisplay =
                      partner.status === "on_break" ? raw.filter((r) => r !== "on_break") : raw;
                    if (reasonsForDisplay.length === 0) return null;
                    if (partner.status !== "needs_attention" && partner.status !== "on_break") return null;
                    const chip =
                      partner.status === "needs_attention"
                        ? "border-red-200/80 bg-red-50/80 dark:bg-red-950/40 text-red-800 dark:text-red-200"
                        : "border-stone-400/60 bg-stone-500/10 text-text-secondary";
                    return reasonsForDisplay.map((r) => (
                      <span
                        key={r}
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${chip}`}
                      >
                        {partnerReasonLabel(r)}
                      </span>
                    ));
                  })()}
                  {overviewTradesForDisplay(partner, editingOverview, overviewForm.trades).map((t) => (
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
              {editingOverview ? (
                <div className="rounded-xl border border-border-light bg-surface-hover/40 px-3 py-3 space-y-3">
                  <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">Partner type</p>
                  <div className="flex flex-wrap gap-2">
                    {(["self_employed", "limited_company"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          setOverviewForm((p) => ({
                            ...p,
                            partner_legal_type: opt,
                            ...(opt === "limited_company"
                              ? { utr: "", vat_registered: null, vat_number: "" }
                              : { crn: "", vat_registered: null }),
                          }))
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                          overviewForm.partner_legal_type === opt
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border-light bg-card text-text-secondary hover:border-border"
                        }`}
                      >
                        {opt === "self_employed" ? "Self-employed" : "Limited company"}
                      </button>
                    ))}
                  </div>
                  {overviewForm.partner_legal_type === "limited_company" ? (
                    <>
                      <Input
                        value={overviewForm.crn}
                        onChange={(e) => setOverviewForm((p) => ({ ...p, crn: e.target.value }))}
                        placeholder="CRN (optional)"
                        className="h-9"
                      />
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">VAT registered</p>
                        <div className="flex flex-wrap gap-2">
                          {(
                            [
                              { v: true as const, label: "Yes" },
                              { v: false as const, label: "No" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={String(opt.v)}
                              type="button"
                              onClick={() =>
                                setOverviewForm((p) => ({
                                  ...p,
                                  vat_registered: opt.v,
                                  vat_number: opt.v === false ? "" : p.vat_number,
                                }))
                              }
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                overviewForm.vat_registered === opt.v
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border-light bg-card text-text-secondary hover:border-border"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {overviewForm.vat_registered === true && (
                          <Input
                            value={overviewForm.vat_number}
                            onChange={(e) => setOverviewForm((p) => ({ ...p, vat_number: e.target.value }))}
                            placeholder="VAT number *"
                            className="h-9"
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <Input
                        value={overviewForm.utr}
                        onChange={(e) => setOverviewForm((p) => ({ ...p, utr: e.target.value }))}
                        placeholder="UTR (optional)"
                        className="h-9"
                        autoComplete="off"
                      />
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-medium text-text-tertiary">VAT number (optional)</label>
                        <Input
                          value={overviewForm.vat_number}
                          onChange={(e) => setOverviewForm((p) => ({ ...p, vat_number: e.target.value }))}
                          placeholder="GB123456789"
                          className="h-9"
                        />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Briefcase className="h-4 w-4 text-text-tertiary shrink-0" />
                    <span>{inferPartnerLegal(partner) === "limited_company" ? "Limited company" : "Self-employed"}</span>
                  </div>
                  {inferPartnerLegal(partner) === "limited_company" && partner.crn?.trim() ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <FileText className="h-4 w-4 text-text-tertiary shrink-0" />
                      <span>CRN: {partner.crn.trim()}</span>
                    </div>
                  ) : null}
                  {inferPartnerLegal(partner) === "self_employed" && partner.utr?.trim() ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <FileText className="h-4 w-4 text-text-tertiary shrink-0" />
                      <span>UTR: {partner.utr.trim()}</span>
                    </div>
                  ) : null}
                  {inferPartnerLegal(partner) === "limited_company" && partner.vat_registered === false ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <FileText className="h-4 w-4 text-text-tertiary shrink-0" />
                      <span>Not VAT registered</span>
                    </div>
                  ) : null}
                  {inferPartnerLegal(partner) === "limited_company" &&
                  partner.vat_number?.trim() &&
                  partner.vat_registered !== false ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <FileText className="h-4 w-4 text-text-tertiary shrink-0" />
                      <span>VAT: {partner.vat_number.trim()}</span>
                    </div>
                  ) : null}
                  {inferPartnerLegal(partner) === "self_employed" && partner.vat_number?.trim() ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <FileText className="h-4 w-4 text-text-tertiary shrink-0" />
                      <span>VAT: {partner.vat_number.trim()}</span>
                    </div>
                  ) : null}
                </>
              )}
              {(editingOverview || partner.phone?.trim()) && (
                <div className="flex items-start gap-2 text-sm text-text-secondary">
                  <Phone className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                  {editingOverview ? (
                    <Input
                      type="tel"
                      value={overviewForm.phone}
                      onChange={(e) => setOverviewForm((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="Phone"
                      className="h-8 flex-1 min-w-0"
                    />
                  ) : (
                    <span>{partner.phone}</span>
                  )}
                </div>
              )}
              {editingOverview ? (
                <>
                  <UkCoveragePicker
                    value={overviewForm.uk_coverage_regions}
                    onChange={(next) => setOverviewForm((p) => ({ ...p, uk_coverage_regions: next }))}
                    idPrefix="drawer-partner"
                  />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary">Home / business address</label>
                    <Input
                      value={overviewForm.partner_address}
                      onChange={(e) => setOverviewForm((p) => ({ ...p, partner_address: e.target.value }))}
                      placeholder="Street, city, postcode"
                      className="text-sm"
                    />
                  </div>
                </>
              ) : (
                <>
                  {(formatUkCoverageLabel(partner.uk_coverage_regions, partner.location) || "").trim() ? (
                    <div className="flex items-start gap-2 text-sm text-text-secondary">
                      <MapPin className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="text-[10px] font-medium text-text-tertiary block">Area coverage</span>
                        {formatUkCoverageLabel(partner.uk_coverage_regions, partner.location)}
                      </span>
                    </div>
                  ) : null}
                  {partner.partner_address?.trim() ? (
                    <div className="flex items-start gap-2 text-sm text-text-secondary">
                      <Home className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="text-[10px] font-medium text-text-tertiary block">Address</span>
                        {partner.partner_address}
                      </span>
                    </div>
                  ) : !partner.uk_coverage_regions?.length && partner.location?.trim() ? (
                    <div className="flex items-start gap-2 text-sm text-text-secondary">
                      <Home className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="text-[10px] font-medium text-text-tertiary block">Address (legacy)</span>
                        {partner.location}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
              <div className="flex items-center gap-2 text-sm text-text-tertiary pt-1 border-t border-border-light/60">
                <Calendar className="h-4 w-4 shrink-0" />
                Joined {new Date(partner.joined_at).toLocaleDateString()}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <span className="text-xl font-bold text-text-primary">{computedCompliance}</span>
                  <span className="text-xs text-text-tertiary ml-0.5">/100</span>
                  <p className="text-[10px] text-text-tertiary mt-1">
                    Profile completeness, required documents, and expired docs (higher penalty).
                  </p>
                  <Progress
                    value={computedCompliance}
                    size="sm"
                    color={computedCompliance >= 90 ? "emerald" : computedCompliance >= 70 ? "primary" : "amber"}
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
                    setOverviewForm(partnerOverviewFormFromPartner(partner));
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

            {isAdmin && (
              <div className="p-4 rounded-xl border border-border-light bg-card space-y-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Mobile app account</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Link this directory partner to their Master Services app login so they show under{" "}
                    <span className="font-medium text-text-secondary">Team (App)</span> even before the first job.
                  </p>
                </div>
                {partner.auth_user_id ? (
                  <div className="space-y-2">
                    <p className="text-sm text-text-secondary">
                      Linked to{" "}
                      <span className="font-semibold text-text-primary">
                        {linkedAppProfile?.full_name ?? "App user"}
                      </span>
                      {linkedAppProfile?.email && (
                        <span className="text-text-tertiary"> · {linkedAppProfile.email}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-text-tertiary">
                      The mobile app reads <span className="font-medium text-text-secondary">public.users</span> (not
                      only profiles). Use sync if they still see missing profile after linking.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={linkBusy}
                        onClick={() => {
                          void (async () => {
                            if (!partner.auth_user_id) return;
                            setLinkBusy(true);
                            try {
                              await syncAppUserRow(partner.auth_user_id, partner.id);
                              toast.success("App profile row updated in public.users.");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Sync failed");
                            } finally {
                              setLinkBusy(false);
                            }
                          })();
                        }}
                      >
                        Sync app profile (users)
                      </Button>
                      <Button size="sm" variant="outline" disabled={linkBusy} onClick={() => void handleUnlinkAppUser()}>
                        Remove app link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="email"
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      placeholder="Email they use in the app"
                      className="flex-1 min-w-0"
                    />
                    <Button size="sm" disabled={linkBusy || !linkEmail.trim()} onClick={() => void handleLinkAppUser()}>
                      {linkBusy ? "Linking…" : "Link account"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="p-4 rounded-xl border border-border-light bg-card space-y-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Partner upload portal</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Generate a secure link so this partner can upload only the documents you choose (public page, no login).
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Link2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setPortalLinkResult(null);
                    setPortalLinkModalOpen(true);
                  }}
                >
                  Generate upload link…
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-4 border-t border-border-light">
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  {partner.status !== "active" && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Play className="h-3.5 w-3.5" />}
                      onClick={() => void runActivate(false)}
                    >
                      Activate
                    </Button>
                  )}
                  {!isPartnerInactiveStage(partner) && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<XCircle className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setDeactivatePreset("");
                        setDeactivateOtherText("");
                        setDeactivateOtherStage("needs_attention");
                        setDeactivateOpen(true);
                      }}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              )}
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
              const partnerSchedLine = formatJobScheduleLine(job);
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
                  {partnerSchedLine ? (
                    <p className="text-[10px] text-text-secondary mt-2 leading-snug">{partnerSchedLine}</p>
                  ) : null}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ========== COMPLIANCE ========== */}
        {tab === "compliance" && (
          <div className="p-6 space-y-5">
            <div className="rounded-2xl border border-border-light bg-gradient-to-br from-card via-card to-primary/[0.03] p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Overall score</p>
                  <p className="mt-1 text-4xl font-bold tabular-nums text-text-primary">
                    {computedCompliance}
                    <span className="text-lg font-semibold text-text-tertiary">/100</span>
                  </p>
                  {computedCompliance < 100 ? (
                    <p className="mt-2 max-w-md text-xs text-text-secondary">
                      About <span className="font-semibold text-text-primary">{100 - computedCompliance}</span> points to go.
                      The score blends required documents (~52%), profile fields (~33%), and expired files (extra penalty).
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">Fully compliant on current rules.</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTab("overview")}>
                    Overview
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTab("overview");
                        setEditingOverview(true);
                      }}
                    >
                      Edit profile
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setTab("documents")}>
                    Documents
                  </Button>
                </div>
              </div>
              <Progress
                value={computedCompliance}
                size="sm"
                color={computedCompliance >= 90 ? "emerald" : computedCompliance >= 70 ? "primary" : "amber"}
                className="mt-4"
              />
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-border-light bg-card/90 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-text-tertiary">Mandatory + agreements</p>
                  <p className="text-xl font-bold text-text-primary">{documentComplianceScore}%</p>
                  <p className="text-[10px] text-text-tertiary">Excludes trade-only certificates</p>
                </div>
                <div className="rounded-xl border border-border-light bg-card/90 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-text-tertiary">Profile</p>
                  <p className="text-xl font-bold text-text-primary">{profileCompletenessScore}%</p>
                  <p className="text-[10px] text-text-tertiary">Contact, coverage, address, tax IDs</p>
                </div>
                <div className="rounded-xl border border-border-light bg-card/90 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-text-tertiary">Expired files</p>
                  <p className="text-xl font-bold text-text-primary">{expiredDocCount}</p>
                  <p className="text-[10px] text-text-tertiary">Each one hurts the blended score</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">Profile checklist</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => {
                    setTab("overview");
                    if (isAdmin) setEditingOverview(true);
                  }}
                >
                  {isAdmin ? "Fix in Overview" : "View Overview"}
                </Button>
              </div>
              <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-card">
                {profileCompletenessItems.map((item) => (
                  <li key={item.id} className="flex gap-3 px-3 py-2.5 first:rounded-t-xl last:rounded-b-xl">
                    <span className="mt-0.5 shrink-0">
                      {item.done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${item.done ? "text-text-secondary" : "font-medium text-text-primary"}`}>
                        {item.label}
                        {!item.done && <span className="text-text-tertiary font-normal"> · +{item.weight} pts</span>}
                      </p>
                      {!item.done && <p className="text-[11px] text-text-tertiary mt-0.5">{item.hint}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">Mandatory documents (score)</h3>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setTab("documents")}>
                  Upload / replace
                </Button>
              </div>
              <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-card">
                {mandatoryDocsForScore.map((req) => {
                  const st = getRequiredDocComplianceStatus(documents, req);
                  return (
                    <li key={req.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex items-start gap-2">
                        {st === "valid" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                        ) : st === "expired" ? (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                        )}
                        <div>
                          <p className="text-sm font-medium text-text-primary">{req.name}</p>
                          <p className="text-[11px] text-text-tertiary">{req.description}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
                        <Badge
                          variant={st === "valid" ? "success" : st === "expired" ? "danger" : "warning"}
                          size="sm"
                        >
                          {st === "valid" ? "Valid" : st === "expired" ? "Expired" : "Missing"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="whitespace-nowrap"
                          onClick={() => {
                            setDocPreset({ docType: req.docType, name: req.name });
                            setAddDocOpen(true);
                            setTab("documents");
                          }}
                        >
                          {st === "valid" ? "Update" : "Add"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {tradeCertificateDocs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">Trade certificates (not in score)</h3>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setTab("documents")}>
                  Upload / replace
                </Button>
              </div>
              <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-card">
                {tradeCertificateDocs.map((req) => {
                  const st = getRequiredDocComplianceStatus(documents, req);
                  return (
                    <li key={req.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex items-start gap-2">
                        {st === "valid" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                        ) : st === "expired" ? (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                        )}
                        <div>
                          <p className="text-sm font-medium text-text-primary">{req.name}</p>
                          <p className="text-[11px] text-text-tertiary">{req.description}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
                        <Badge
                          variant={st === "valid" ? "success" : st === "expired" ? "danger" : "warning"}
                          size="sm"
                        >
                          {st === "valid" ? "Valid" : st === "expired" ? "Expired" : "Missing"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="whitespace-nowrap"
                          onClick={() => {
                            setDocPreset({ docType: req.docType, name: req.name });
                            setAddDocOpen(true);
                            setTab("documents");
                          }}
                        >
                          {st === "valid" ? "Update" : "Add"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">Optional documents</h3>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setTab("documents")}>
                  Upload / replace
                </Button>
              </div>
              <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-card">
                <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex items-start gap-2">
                    {dbsOptionalStatus === "valid" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                    ) : dbsOptionalStatus === "expired" ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                    )}
                    <div>
                      <p className="text-sm font-medium text-text-primary">DBS (Disclosure &amp; Barring)</p>
                      <p className="text-[11px] text-text-tertiary">Optional — not included in compliance score</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
                    <Badge
                      variant={
                        dbsOptionalStatus === "valid"
                          ? "success"
                          : dbsOptionalStatus === "expired"
                            ? "danger"
                            : "warning"
                      }
                      size="sm"
                    >
                      {dbsOptionalStatus === "valid"
                        ? "On file"
                        : dbsOptionalStatus === "expired"
                          ? "Expired"
                          : "Not uploaded"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="whitespace-nowrap"
                      onClick={() => {
                        setDocPreset({ docType: "dbs", name: "DBS certificate" });
                        setAddDocOpen(true);
                        setTab("documents");
                      }}
                    >
                      {dbsOptionalStatus === "valid" ? "Update" : "Add"}
                    </Button>
                  </div>
                </li>
              </ul>
            </div>

            {expiredDocCount > 0 && (
              <div className="rounded-xl border border-red-200/60 bg-red-50/50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Expired uploads ({expiredDocCount})</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Replace these in Documents — expired dates reduce the compliance score.
                    </p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {documents
                    .filter((d) => d.expires_at && new Date(d.expires_at) < new Date())
                    .map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg border border-border-light bg-card px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover"
                          onClick={() => {
                            setTab("documents");
                            setSelectedDoc(d);
                          }}
                        >
                          <span className="font-medium">{d.name}</span>
                          <span className="text-text-tertiary"> · expired {new Date(d.expires_at!).toLocaleDateString()}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ========== FINANCIAL ========== */}
        {tab === "financial" && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

            <div className="rounded-xl border border-border-light bg-card p-4 sm:p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-surface-hover p-2 shrink-0" aria-hidden>
                    <Landmark className="h-5 w-5 text-text-secondary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">Bank details for payouts</p>
                    <p id="partner-bank-hint" className="text-xs text-text-tertiary mt-0.5">
                      UK sort code and account (digits only). If you start entering details, all four fields must be complete.
                      Leave everything blank if you do not have them yet.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="partner-bank-sort" className="block text-xs font-medium text-text-secondary mb-1">
                      Sort code
                    </label>
                    <Input
                      id="partner-bank-sort"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="12-34-56"
                      aria-describedby="partner-bank-hint"
                      value={bankSortCodeInput}
                      onChange={(e) => {
                        const d = normalizeUkSortCodeInput(e.target.value);
                        setBankSortCodeInput(formatUkSortCodeForDisplay(d));
                      }}
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="partner-bank-acct" className="block text-xs font-medium text-text-secondary mb-1">
                      Account number
                    </label>
                    <Input
                      id="partner-bank-acct"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="8 digits typical"
                      aria-describedby="partner-bank-hint"
                      value={bankAccountNumberInput}
                      onChange={(e) => setBankAccountNumberInput(normalizeUkAccountNumberInput(e.target.value))}
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="partner-bank-holder" className="block text-xs font-medium text-text-secondary mb-1">
                      Account holder
                    </label>
                    <Input
                      id="partner-bank-holder"
                      autoComplete="name"
                      placeholder="Name as on the bank account"
                      aria-describedby="partner-bank-hint"
                      value={bankAccountHolder}
                      onChange={(e) => setBankAccountHolder(e.target.value)}
                      maxLength={120}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="partner-bank-name" className="block text-xs font-medium text-text-secondary mb-1">
                      Bank name
                    </label>
                    <Input
                      id="partner-bank-name"
                      autoComplete="organization"
                      placeholder="e.g. Barclays, Monzo"
                      aria-describedby="partner-bank-hint"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      maxLength={120}
                    />
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={!bankDirty || bankSaving}
                    onClick={resetBankForm}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={!bankDirty || bankSaving}
                    onClick={() => void handleSaveBankDetails()}
                  >
                    {bankSaving ? "Saving…" : "Save bank details"}
                  </Button>
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

        {/* ========== PRIVACY & PERMISSIONS ========== */}
        {tab === "actions" && (
          <div className="p-6 space-y-5">
            <InternalProfileTab
              partner={partner}
              onUpdate={async (updates) => {
                try {
                  const updated = await updatePartner(partner.id, updates);
                  onPartnerUpdate?.(updated);
                  toast.success("Internal profile updated");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to update");
                }
              }}
            />

            {partner.auth_user_id && isAdmin && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-text-primary">Admin actions</p>
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
            )}

            {!partner.auth_user_id && (
              <p className="text-xs text-text-tertiary">No linked app user yet — admin account actions are unavailable.</p>
            )}
          </div>
        )}

        {/* ========== DOCUMENTS ========== */}
        {tab === "documents" && (
          <div className="p-6 space-y-4">
            {missingRequiredDocs.length > 0 && (
              <div
                role="alert"
                className="flex gap-3 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 dark:border-red-800/60 dark:bg-red-950/40"
              >
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-900 dark:text-red-100">Missing required documents</p>
                  <p className="mt-0.5 text-xs text-red-800/95 dark:text-red-200/90">
                    {missingRequiredDocs.length} requirement{missingRequiredDocs.length === 1 ? "" : "s"} still need a
                    valid file (upload or replace expired items) to reach full document compliance.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-text-primary">{documents.length} Documents</p>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Send className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setPortalLinkResult(null);
                      setPortalLinkModalOpen(true);
                    }}
                  >
                    Request documents
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Upload className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setDocPreset(null);
                    setAddDocOpen(true);
                  }}
                >
                  Add document
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-border-light bg-card/60 p-3 space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Agreements</p>
              <p className="text-[11px] text-text-tertiary leading-snug">
                No expiry date required. In-app submission can be wired later; upload files here for the record.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDocPreset({ docType: "service_agreement", name: "Service Agreement" });
                    setAddDocOpen(true);
                  }}
                >
                  Service Agreement
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDocPreset({ docType: "self_bill_agreement", name: "Self Bill Agreement" });
                    setAddDocOpen(true);
                  }}
                >
                  Self Bill Agreement
                </Button>
              </div>
            </div>
            {partnerTradesForCompliance.length > 0 &&
              partnerTradesForCompliance.some((t) => (OPTIONAL_TRADE_CERTS_BY_TRADE[t] ?? []).length > 0) && (
              <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Optional certificates</p>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  CSCS etc. — only for selected trades; not part of the compliance score.
                </p>
                <div className="flex flex-wrap gap-2">
                  {partnerTradesForCompliance.flatMap((t) =>
                    (OPTIONAL_TRADE_CERTS_BY_TRADE[t] ?? []).map((certName) => (
                      <Button
                        key={`${t}-${certName}`}
                        size="sm"
                        variant="outline"
                        className="border-dashed"
                        onClick={() => {
                          setDocPreset({ docType: "certification", name: certName });
                          setAddDocOpen(true);
                        }}
                      >
                        {certName}
                        <span className="ml-1 text-[10px] font-normal text-text-tertiary">({t})</span>
                      </Button>
                    )),
                  )}
                </div>
              </div>
            )}
            {partnerTradesForCompliance.length > 0 && (
            <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Other optional</p>
              <p className="text-[11px] text-text-tertiary leading-snug">
                DBS — optional; not part of the compliance score (shown when at least one trade is selected).
              </p>
              <Button
                size="sm"
                variant="outline"
                className="border-dashed"
                onClick={() => {
                  setDocPreset({ docType: "dbs", name: "DBS certificate" });
                  setAddDocOpen(true);
                }}
              >
                DBS
              </Button>
            </div>
            )}
            <div className="rounded-xl border border-border-light bg-surface-hover/30 p-3 space-y-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Mandatory documents</p>
              <p className="text-[11px] text-text-tertiary leading-snug">
                Core IDs, insurance, UTR (if self-employed), and agreements — these drive the compliance score. Trade certificates are listed separately.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mandatoryDocsForScore.map((req) => {
                  const matchedDocs = pickRequiredDocMatches(documents, req);
                  const doc = matchedDocs[0] ?? null;
                  const expiresAt = doc?.expires_at ? new Date(doc.expires_at) : null;
                  const now = new Date();
                  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                  const isExpired = !!(expiresAt && expiresAt < now);
                  const isExpiringSoon = !!(expiresAt && expiresAt >= now && expiresAt <= in30Days);
                  const certDocs = req.docType === "certification" ? matchedDocs : [];
                  const certValidCount = certDocs.filter((d) => {
                    if (!d.expires_at) return true;
                    return new Date(d.expires_at) >= now;
                  }).length;
                  const certExpiringSoonCount = certDocs.filter((d) => {
                    if (!d.expires_at) return false;
                    const dt = new Date(d.expires_at);
                    return dt >= now && dt <= in30Days;
                  }).length;
                  const certExpiredCount = certDocs.filter((d) => !!(d.expires_at && new Date(d.expires_at) < now)).length;
                  const statusLabel = req.docType === "certification"
                    ? certDocs.length === 0
                      ? "Missing"
                      : certValidCount > 0
                        ? certExpiringSoonCount > 0 ? "Valid (some expiring soon)" : "Valid"
                        : certExpiredCount > 0 ? "Expired" : "Pending"
                    : !doc
                      ? "Missing"
                      : isExpired ? "Expired" : isExpiringSoon ? "Expiring soon" : "Valid";
                  const statusVariant = req.docType === "certification"
                    ? certDocs.length === 0
                      ? "default"
                      : certValidCount > 0
                        ? certExpiringSoonCount > 0 ? "warning" : "success"
                        : certExpiredCount > 0 ? "danger" : "default"
                    : !doc
                      ? "default"
                      : isExpired ? "danger" : isExpiringSoon ? "warning" : "success";

                  return (
                    <div key={req.id} className="rounded-lg border border-border-light bg-card p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary">{req.name}</p>
                          <p className="text-[11px] text-text-tertiary">{req.description}</p>
                        </div>
                        <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
                      </div>
                      {doc?.expires_at && (
                        <p className={`text-[11px] ${isExpired ? "text-red-500" : "text-text-tertiary"}`}>
                          Expires: {new Date(doc.expires_at).toLocaleDateString()}
                        </p>
                      )}
                      {req.docType === "certification" && matchedDocs.length > 0 && (
                        <p className="text-[11px] text-text-tertiary">
                          Uploaded: {matchedDocs.length}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setDocPreset({ docType: req.docType, name: req.name });
                          setAddDocOpen(true);
                        }}
                      >
                        {req.docType === "certification" ? "Add another certificate" : doc ? "Replace / update" : "Add document"}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {tradeCertificateDocs.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide pt-1">Trade certificates</p>
                  <p className="text-[11px] text-text-tertiary leading-snug">
                    Only for the types of work this partner selected — not included in the compliance score.
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <Input
                        value={customCertName}
                        onChange={(e) => setCustomCertName(e.target.value)}
                        placeholder="Add custom certificate requirement"
                        className="h-8 w-full min-[420px]:w-64"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!customCertName.trim()}
                        onClick={() => {
                          setDocPreset({ docType: "certification", name: customCertName.trim() });
                          setAddDocOpen(true);
                        }}
                      >
                        Add cert
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {tradeCertificateDocs.map((req) => {
                      const matchedDocs = pickRequiredDocMatches(documents, req);
                      const doc = matchedDocs[0] ?? null;
                      const expiresAt = doc?.expires_at ? new Date(doc.expires_at) : null;
                      const now = new Date();
                      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                      const isExpired = !!(expiresAt && expiresAt < now);
                      const isExpiringSoon = !!(expiresAt && expiresAt >= now && expiresAt <= in30Days);
                      const certDocs = matchedDocs;
                      const certValidCount = certDocs.filter((d) => {
                        if (!d.expires_at) return true;
                        return new Date(d.expires_at) >= now;
                      }).length;
                      const certExpiringSoonCount = certDocs.filter((d) => {
                        if (!d.expires_at) return false;
                        const dt = new Date(d.expires_at);
                        return dt >= now && dt <= in30Days;
                      }).length;
                      const certExpiredCount = certDocs.filter((d) => !!(d.expires_at && new Date(d.expires_at) < now)).length;
                      const statusLabel =
                        certDocs.length === 0
                          ? "Missing"
                          : certValidCount > 0
                            ? certExpiringSoonCount > 0
                              ? "Valid (some expiring soon)"
                              : "Valid"
                            : certExpiredCount > 0
                              ? "Expired"
                              : "Pending";
                      const statusVariant =
                        certDocs.length === 0
                          ? "default"
                          : certValidCount > 0
                            ? certExpiringSoonCount > 0
                              ? "warning"
                              : "success"
                            : certExpiredCount > 0
                              ? "danger"
                              : "default";

                      return (
                        <div key={req.id} className="rounded-lg border border-border-light bg-card p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-text-primary">{req.name}</p>
                              <p className="text-[11px] text-text-tertiary">{req.description}</p>
                            </div>
                            <Badge variant={statusVariant} size="sm">
                              {statusLabel}
                            </Badge>
                          </div>
                          {doc?.expires_at && (
                            <p className={`text-[11px] ${isExpired ? "text-red-500" : "text-text-tertiary"}`}>
                              Expires: {new Date(doc.expires_at).toLocaleDateString()}
                            </p>
                          )}
                          {matchedDocs.length > 0 && (
                            <p className="text-[11px] text-text-tertiary">Uploaded: {matchedDocs.length}</p>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                              setDocPreset({ docType: req.docType, name: req.name });
                              setAddDocOpen(true);
                            }}
                          >
                            {matchedDocs.length ? "Add another certificate" : "Add certificate"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <AddPartnerDocumentModal
              open={addDocOpen}
              onClose={() => {
                setAddDocOpen(false);
                setDocPreset(null);
                setCustomCertName("");
              }}
              submitting={addDocSubmitting}
              onSubmit={handleAddDocument}
              initialDocType={docPreset?.docType}
              initialName={docPreset?.name}
            />
            <PartnerDocumentDetailModal doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
            <Modal
              open={requestLinkOpen}
              onClose={() => setRequestLinkOpen(false)}
              title="Request documents from partner"
              subtitle="Sends a secure link by email so the partner can upload documents and update their details without logging in."
              size="md"
            >
              <div className="px-6 py-5 space-y-4">
                {requestLinkResult ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                      {requestLinkResult.emailSent
                        ? `Link sent to ${requestLinkResult.sentTo}.`
                        : `Link generated, but email failed${requestLinkResult.emailError ? `: ${requestLinkResult.emailError}` : ""}. Copy it manually below.`}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Upload link</label>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={requestLinkResult.uploadUrl}
                          className="flex-1 h-9 px-3 rounded-lg border border-border bg-surface-tertiary text-xs font-mono"
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void navigator.clipboard.writeText(requestLinkResult.uploadUrl);
                            toast.success("Link copied");
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(
                            `Hi${partner?.contact_name ? ` ${partner.contact_name.split(" ")[0]}` : ""}, please upload your documents here: ${requestLinkResult.uploadUrl}`,
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          Share on WhatsApp
                        </a>
                        <a
                          href={`sms:?body=${encodeURIComponent(
                            `Please upload your documents: ${requestLinkResult.uploadUrl}`,
                          )}`}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-xs font-medium text-text-primary hover:bg-surface-hover"
                        >
                          Share via SMS
                        </a>
                      </div>
                    </div>
                    <p className="text-xs text-text-tertiary">
                      Expires {new Date(requestLinkResult.expiresAt).toLocaleDateString()} (7 business days).
                    </p>
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => setRequestLinkOpen(false)}>
                        Close
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        Documents to request (optional)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {requiredDocuments.map((req) => {
                          /** Use the required-doc id as the checkbox key — multiple items can share
                           *  the same docType (e.g. trade certifications), so id keeps them distinct. */
                          const checked = requestLinkDocTypes.includes(req.id);
                          const opt = { value: req.id, label: req.name };
                          return (
                            <label
                              key={opt.value}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border cursor-pointer hover:bg-surface-hover"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setRequestLinkDocTypes((prev) =>
                                    e.target.checked
                                      ? [...prev, opt.value]
                                      : prev.filter((v) => v !== opt.value),
                                  );
                                }}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                              />
                              <span className="text-sm text-text-primary">{opt.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-text-tertiary mt-1.5">
                        Leave all unchecked to ask for any updated documents.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        Custom message (optional)
                      </label>
                      <textarea
                        value={requestLinkMessage}
                        onChange={(e) => setRequestLinkMessage(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        placeholder="e.g. Your insurance certificate expired last month — please upload the renewed copy."
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
                      />
                    </div>
                    {requestLinkError && (
                      <p className="text-sm text-red-600">{requestLinkError}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRequestLinkOpen(false)}
                        disabled={requestLinkSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          if (!partner) return;
                          setRequestLinkSubmitting(true);
                          setRequestLinkError(null);
                          try {
                            /** Build the structured payload the partner page renders into upload cards. */
                            const selectedDocs = requiredDocuments
                              .filter((r) => requestLinkDocTypes.includes(r.id))
                              .map((r) => ({
                                id: r.id,
                                name: r.name,
                                description: r.description,
                                docType: r.docType,
                              }));
                            const selectedDocTypes = Array.from(
                              new Set(selectedDocs.map((r) => r.docType)),
                            );
                            const selectedNames = selectedDocs.map((r) => r.name);
                            const res = await fetch(
                              `/api/partners/${partner.id}/request-documents`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  docTypes: selectedDocTypes,
                                  docNames: selectedNames,
                                  requestedDocs: selectedDocs,
                                  customMessage: requestLinkMessage.trim() || undefined,
                                }),
                              },
                            );
                            const data = await res.json();
                            if (!res.ok) {
                              setRequestLinkError(data.error ?? "Failed to send request.");
                              return;
                            }
                            setRequestLinkResult({
                              uploadUrl: data.uploadUrl,
                              sentTo: data.sentTo,
                              expiresAt: data.expiresAt,
                              emailSent: Boolean(data.emailSent),
                              emailError: data.emailError ?? null,
                            });
                          } catch {
                            setRequestLinkError("Network error. Please try again.");
                          } finally {
                            setRequestLinkSubmitting(false);
                          }
                        }}
                        disabled={requestLinkSubmitting}
                      >
                        {requestLinkSubmitting ? "Sending..." : "Send link"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Modal>
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
                      {doc.doc_type === "certification" && extractCertificateNumber(doc) && (
                        <p className="text-[10px] text-text-tertiary mt-0.5">
                          Certificate no: {extractCertificateNumber(doc)}
                        </p>
                      )}
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

      <Modal
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title="Why are you deactivating this partner?"
        subtitle="This records the reason and stage for compliance and reporting."
        size="md"
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason</label>
            <select
              value={deactivatePreset}
              onChange={(e) => setDeactivatePreset(e.target.value as typeof deactivatePreset)}
              className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3 text-text-primary"
            >
              <option value="">Select…</option>
              <option value="missing_docs">Missing Documents</option>
              <option value="low_score">Low Score</option>
              <option value="on_break">On Break</option>
              <option value="other">Other</option>
            </select>
          </div>
          {deactivatePreset === "other" && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Details</label>
                <textarea
                  value={deactivateOtherText}
                  onChange={(e) => setDeactivateOtherText(e.target.value)}
                  rows={3}
                  placeholder="Describe the reason…"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Set stage</label>
                <select
                  value={deactivateOtherStage}
                  onChange={(e) => setDeactivateOtherStage(e.target.value as PartnerStatus)}
                  className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3"
                >
                  <option value="needs_attention">Needs attention</option>
                  <option value="inactive">Inactive</option>
                  <option value="onboarding">Onboarding</option>
                </select>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setDeactivateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!deactivatePreset} onClick={() => void submitDeactivate()}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={portalLinkModalOpen}
        onClose={() => {
          if (portalLinkSubmitting) return;
          setPortalLinkModalOpen(false);
          setPortalLinkResult(null);
        }}
        title={portalLinkResult ? "Your upload link" : "Generate partner upload link"}
        subtitle={
          portalLinkResult
            ? "Short link for WhatsApp — partner opens the same upload page."
            : "Only the document types you tick will appear on the partner’s upload page."
        }
        size="lg"
        className="max-w-lg"
      >
        <div className="p-6 space-y-4 max-h-[min(70vh,520px)] overflow-y-auto">
          {portalLinkResult ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Copy the short link below, or open WhatsApp with a pre-filled message.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  readOnly
                  value={portalLinkResult.shortUrl}
                  className="font-mono text-xs flex-1 min-w-0"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  icon={<Copy className="h-3.5 w-3.5" />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(portalLinkResult.shortUrl).then(() => {
                      toast.success("Link copied.");
                    });
                  }}
                >
                  Copy
                </Button>
              </div>
              {portalLinkResult.fullUrl ? (
                <details className="text-xs text-text-tertiary">
                  <summary className="cursor-pointer font-medium text-text-secondary">Full link (fallback)</summary>
                  <p className="mt-2 break-all font-mono text-[11px]">{portalLinkResult.fullUrl}</p>
                </details>
              ) : null}
              {portalLinkResult.expiresAt ? (
                <p className="text-xs text-text-tertiary">
                  Expires on{" "}
                  <time dateTime={portalLinkResult.expiresAt}>
                    {new Date(portalLinkResult.expiresAt).toLocaleDateString("en-GB", {
                      dateStyle: "medium",
                    })}
                  </time>
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border-light">
                <Button
                  type="button"
                  variant="outline"
                  icon={<MessageSquare className="h-3.5 w-3.5" />}
                  onClick={() => {
                    const text = `Please upload your documents here: ${portalLinkResult.shortUrl}`;
                    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
                  }}
                >
                  WhatsApp
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPortalLinkResult(null);
                  }}
                >
                  Generate another
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setPortalLinkModalOpen(false);
                    setPortalLinkResult(null);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Link expires in</label>
                <select
                  value={portalExpiresDays}
                  onChange={(e) => setPortalExpiresDays(Number(e.target.value))}
                  className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3 text-text-primary"
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Requested documents</p>
                {["core", "extra"].map((group) => {
                  const opts = portalAllowlistOptions.filter((o) => o.kind === group);
                  if (opts.length === 0) return null;
                  return (
                    <div key={group} className="space-y-2">
                      <p className="text-[11px] font-medium text-text-tertiary">
                        {group === "core" ? "Compliance" : "Optional / other"}
                      </p>
                      <div className="space-y-2">
                        {opts.map((o) => (
                          <label
                            key={o.id}
                            className="flex items-start gap-3 rounded-lg border border-border-light bg-surface-hover/50 px-3 py-2.5 cursor-pointer hover:bg-surface-hover"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-border"
                              checked={portalLinkSelectedIds.has(o.id)}
                              onChange={() => togglePortalDocId(o.id)}
                            />
                            <span>
                              <span className="text-sm font-medium text-text-primary block">{o.name}</span>
                              <span className="text-xs text-text-tertiary">{o.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
                <Button
                  variant="outline"
                  type="button"
                  disabled={portalLinkSubmitting}
                  onClick={() => {
                    setPortalLinkModalOpen(false);
                    setPortalLinkResult(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={portalLinkSubmitting || portalLinkSelectedIds.size === 0}
                  onClick={() => void handleGeneratePortalLink()}
                >
                  {portalLinkSubmitting ? "Generating…" : "Generate link"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={activateForceOpen}
        onClose={() => setActivateForceOpen(false)}
        title="Compliance below minimum"
        subtitle="Activation usually requires 95% compliance."
        size="sm"
      >
        <div className="p-6 space-y-4">
          <p className="text-sm text-text-secondary">
            This partner does not meet the minimum compliance score ({ACTIVATION_COMPLIANCE_MIN_SCORE}%). Current score:{" "}
            <span className="font-semibold tabular-nums text-text-primary">{computedCompliance}%</span>. Do you want to force
            activation?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setActivateForceOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={() => void runActivate(true)}>
              Force activate
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}

function InternalProfileTab({ partner, onUpdate }: { partner: Partner; onUpdate: (updates: Partial<Partner>) => void }) {
  const [internalNotes, setInternalNotes] = useState(partner.internal_notes ?? "");
  const [role, setRole] = useState(partner.role ?? "");
  const [permission, setPermission] = useState(partner.permission ?? "");

  useEffect(() => {
    queueMicrotask(() => {
      setInternalNotes(partner.internal_notes ?? "");
      setRole(partner.role ?? "");
      setPermission(partner.permission ?? "");
    });
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

