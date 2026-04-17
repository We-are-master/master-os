"use client";

import type { ListResult } from "@/services/base";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp, modalTransition, overlayTransition } from "@/lib/motion";
import {
  Plus, Filter, MapPin, Phone, Mail, CheckCircle2, XCircle,
  ArrowRight, Briefcase, FileText, Users, Send, PenLine,
  Inbox, Percent, CalendarRange, ImagePlus, X, ChevronDown, Download,
  Check, Wrench, MessageSquarePlus, UserPlus, Edit3,
} from "lucide-react";
import { toast } from "sonner";
import type { ServiceRequest, Quote, Partner } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listRequests, createRequest, updateRequestStatus, updateRequest, getRequest } from "@/services/requests";
import {
  findDuplicateJobs,
  findDuplicateQuotes,
  findDuplicateRequests,
  formatJobDuplicateLines,
  formatQuoteDuplicateLines,
  formatRequestDuplicateLines,
} from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { createQuote } from "@/services/quotes";
import { createJob } from "@/services/jobs";
import { logAudit, logBulkAction } from "@/services/audit";
import { getStatusCounts, getSupabase, softDeleteById } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { useRouter } from "next/navigation";
import { useBuFilter } from "@/hooks/use-bu-filter";
import { listPartners, listPartnersAll } from "@/services/partners";
import { isPartnerEligibleForWork } from "@/lib/partner-status";
import { createClientAddress, listAddressesByClient } from "@/services/client-addresses";
import { listAssignableUsers, type AssignableUser } from "@/services/profiles";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { normalizeTotalPhases } from "@/lib/job-phases";
import { getPartnerAssignmentBlockReason } from "@/lib/job-partner-assign";
import { capJobImagesArray, coerceJobImagesArray } from "@/lib/job-images";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { lineItemDefaultsFromCatalog } from "@/lib/catalog-service-defaults";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { cn, formatCurrency, isUuid, parseIsoDateOnly } from "@/lib/utils";
import { TYPE_OF_WORK_OPTIONS, mergeTypeOfWorkOptions, normalizeTypeOfWork } from "@/lib/type-of-work";
import { computeHourlyTotals, partnerHourlyRateFromCatalogBundle } from "@/lib/job-hourly-billing";
import { computeAccessSurcharge, effectiveInCczForAddress, isLikelyCczAddress } from "@/lib/ccz";
import { resolveJobModalSchedule } from "@/lib/job-modal-schedule";
import { JobModalScheduleFields } from "@/components/shared/job-modal-schedule-fields";
import { safePartnerMatchesTypeOfWork, partnerMatchTypeLabel } from "@/lib/partner-type-of-work-match";
import { localYmdEndIso, localYmdStartIso } from "@/lib/date-range";
import { mergeImageUrlLists, normalizeJsonImageArray } from "@/lib/request-attachment-images";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import { ExportCsvModal } from "@/components/shared/export-csv-modal";
import { buildCsvFromRows, downloadCsvFile } from "@/lib/csv-export";
import {
  DEFAULT_FINANCE_PERIOD_MODE,
  getFinancePeriodClosedBounds,
  type FinancePeriodMode,
} from "@/lib/finance-period";

const UI_PERF_EVENT = "master-ui-perf";

function trackUiPerf(metric: string, ms: number, meta?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const payload = { metric, ms: Math.round(ms), ts: Date.now(), ...(meta ?? {}) };
  window.dispatchEvent(new CustomEvent(UI_PERF_EVENT, { detail: payload }));
  if (process.env.NODE_ENV !== "production") {
    console.info(`[ui-perf] ${metric}: ${payload.ms}ms`, meta ?? {});
  }
}

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  new: { label: "New", variant: "primary" },
  approved: { label: "Approved", variant: "success" },
  declined: { label: "Declined", variant: "danger" },
  converted_to_quote: { label: "Converted to Quote", variant: "info" },
  converted_to_job: { label: "Converted to Job", variant: "success" },
};

const priorityConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  low: { label: "Low", variant: "default" },
  medium: { label: "Medium", variant: "info" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "danger" },
};

/** Show linked account name only (no "Account:" prefix); strips accidental prefix from legacy text. */
function linkedAccountDisplay(name: string | null | undefined): string {
  const t = name?.trim() ?? "";
  if (!t) return "";
  return t.replace(/^account:\s*/i, "").trim();
}

/** Quote vs work UI: prefer stored `request_kind`, else infer from catalog link (legacy). */
function resolveRequestKind(r: ServiceRequest): "quote" | "work" {
  if (r.request_kind === "quote" || r.request_kind === "work") return r.request_kind;
  const cid = typeof r.catalog_service_id === "string" ? r.catalog_service_id.trim() : "";
  return cid && isUuid(cid) ? "work" : "quote";
}

const serviceColors: Record<string, string> = {
  "HVAC Installation": "bg-blue-50 dark:bg-blue-950/30 text-blue-700 ring-blue-200/50",
  "HVAC Maintenance": "bg-blue-50 dark:bg-blue-950/30 text-blue-700 ring-blue-200/50",
  Electrical: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 ring-purple-200/50",
  Plumbing: "bg-teal-50 dark:bg-teal-950/30 text-teal-700 ring-teal-200/50",
  Painting: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 ring-amber-200/50",
  Carpentry: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 ring-emerald-200/50",
  Gardener: "bg-green-50 dark:bg-green-950/30 text-green-800 ring-green-200/50",
  "Boiler Service": "bg-rose-50 dark:bg-rose-950/30 text-rose-800 ring-rose-200/50",
  "General Maintenance": "bg-surface-tertiary text-text-primary ring-border/50",
};

interface RequestsClientProps {
  /**
   * Server-rendered first page (Phase 3 server-shell). When provided, the
   * useSupabaseList hook hydrates from this payload and skips its initial
   * fetch — the table is interactive on first paint instead of after a
   * client-side waterfall.
   */
  initialData?: ListResult<ServiceRequest> | null;
}

export function RequestsClient({ initialData }: RequestsClientProps = {}) {
  const router = useRouter();
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [periodRangeFrom, setPeriodRangeFrom] = useState("");
  const [periodRangeTo, setPeriodRangeTo] = useState("");
  /** Empty until `periodMode` sync runs — must match default "all" (no range) on first paint. */
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const bounds = getFinancePeriodClosedBounds(
      periodMode,
      weekAnchor,
      periodRangeFrom,
      periodRangeTo,
      monthAnchor,
    );
    if (!bounds) {
      setDateFrom("");
      setDateTo("");
    } else {
      setDateFrom(bounds.from);
      setDateTo(bounds.to);
    }
  }, [periodMode, weekAnchor, monthAnchor, periodRangeFrom, periodRangeTo]);

  const createdAtRangeFilter = useMemo(() => {
    let fromY = dateFrom.trim();
    let toY = dateTo.trim();
    if (fromY && toY && fromY > toY) {
      const t = fromY;
      fromY = toY;
      toY = t;
    }
    if (!fromY && !toY) return undefined;
    return {
      dateColumn: "created_at" as const,
      dateFrom: fromY ? localYmdStartIso(fromY) : undefined,
      dateTo: toY ? localYmdEndIso(toY) : undefined,
    };
  }, [dateFrom, dateTo]);

  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refresh, refreshSilent,
  } = useSupabaseList<ServiceRequest>({
    fetcher: listRequests,
    realtimeTable: "service_requests",
    listParams: createdAtRangeFilter ?? {},
    initialData,
    initialStatus: "new",
  });

  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [drawerFields, setDrawerFields] = useState({
    property_address: "",
    service_type: "",
    description: "",
    catalog_service_id: "",
  });
  const [propertyAddressEditing, setPropertyAddressEditing] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [requestImageUrls, setRequestImageUrls] = useState<string[]>([]);
  const [requestPhotosSaving, setRequestPhotosSaving] = useState(false);
  const [drawerTab, setDrawerTab] = useState("details");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterPriority, setFilterPriority] = useState<"all" | "high" | "urgent">("all");
  const [filterService, setFilterService] = useState<string>("all");
  const buFilter = useBuFilter();
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);
  const allPartnersCacheRef = useRef<Partner[] | null>(null);

  const getPartnersAllCached = useCallback(async (): Promise<Partner[]> => {
    if (allPartnersCacheRef.current) return allPartnersCacheRef.current;
    const t0 = performance.now();
    const list = await listPartnersAll({ status: "all" });
    allPartnersCacheRef.current = list;
    trackUiPerf("requests.partners_cache_fill_ms", performance.now() - t0, { count: list.length });
    return list;
  }, []);

  // Convert to Quote flow
  const [convertChoiceOpen, setConvertChoiceOpen] = useState<ServiceRequest | null>(null);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState<ServiceRequest | null>(null);
  const [manualQuoteOpen, setManualQuoteOpen] = useState<ServiceRequest | null>(null);
  const [convertToJobOpen, setConvertToJobOpen] = useState<ServiceRequest | null>(null);

  const { profile } = useProfile();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const isAdmin = profile?.role === "admin";

  const selectedAccountLabel = linkedAccountDisplay(selectedRequest?.source_account_name);

  useEffect(() => {
    if (!isAdmin) return;
    listAssignableUsers().then(setAssignableUsers).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const filteredRequests = useMemo(() => {
    return data.filter((r) => {
      if (filterPriority === "high" && r.priority !== "high" && r.priority !== "urgent") return false;
      if (filterPriority === "urgent" && r.priority !== "urgent") return false;
      if (filterService !== "all" && normalizeTypeOfWork(r.service_type) !== normalizeTypeOfWork(filterService)) return false;
      if (buFilter.selectedBuId) {
        // clientIdsInBu undefined = still loading → don't filter yet
        if (!buFilter.clientIdsInBu) return true;
        if (!r.client_id || !buFilter.clientIdsInBu.has(r.client_id)) return false;
      }
      return true;
    });
  }, [data, filterPriority, filterService, buFilter.selectedBuId, buFilter.clientIdsInBu]);

  const requestKpis = useMemo(() => {
    const c = statusCounts;
    const total = c.all ?? 0;
    const newReq = c.new ?? 0;
    const approved = c.approved ?? 0;
    const declined = c.declined ?? 0;
    const toQuote = c.converted_to_quote ?? 0;
    const toJob = c.converted_to_job ?? 0;
    const decided = approved + declined;
    const approvalPct = decided > 0 ? Math.round((approved / decided) * 1000) / 10 : null;
    const quotePct = total > 0 ? Math.round((toQuote / total) * 1000) / 10 : null;
    const jobPct = total > 0 ? Math.round((toJob / total) * 1000) / 10 : null;
    return { total, newReq, approvalPct, quotePct, jobPct, toQuote, toJob, approved, declined, decided };
  }, [statusCounts]);

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts(
        "service_requests",
        ["new", "approved", "declined", "converted_to_quote", "converted_to_job"],
        "status",
        createdAtRangeFilter
      );
      setStatusCounts(counts);
    } catch { /* cosmetic */ }
  }, [createdAtRangeFilter]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => {
    listCatalogServicesForPicker().then(setCatalogServices).catch(() => setCatalogServices([]));
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    void import("@/services/quote-invite-images");
  }, [createOpen]);

  useEffect(() => {
    queueMicrotask(() => setDrawerTab("details"));
  }, [selectedRequest?.id]);
  useEffect(() => {
    queueMicrotask(() => setPropertyAddressEditing(false));
  }, [selectedRequest?.id]);
  useEffect(() => {
    if (!selectedRequest) return;
    queueMicrotask(() =>
      setDrawerFields({
        property_address: selectedRequest.property_address ?? "",
        service_type: selectedRequest.service_type ?? "",
        description: selectedRequest.description ?? "",
        catalog_service_id: selectedRequest.catalog_service_id ?? "",
      }),
    );
  }, [
    selectedRequest?.id,
    selectedRequest?.property_address,
    selectedRequest?.service_type,
    selectedRequest?.description,
    selectedRequest?.catalog_service_id,
  ]);

  useEffect(() => {
    if (!selectedRequest) {
      queueMicrotask(() => setRequestImageUrls([]));
      return;
    }
    queueMicrotask(() => setRequestImageUrls(normalizeJsonImageArray(selectedRequest.images)));
  }, [selectedRequest?.id, selectedRequest?.updated_at, selectedRequest?.images]);

  const serviceFilterOptions = useMemo(() => {
    const legacy = [
      "HVAC Installation",
      "HVAC Maintenance",
      "Electrical",
      "Plumbing",
      "Painting",
      "Carpentry",
      "Gardener",
      "Boiler Service",
      "General Maintenance",
    ];
    const fromCatalog = catalogServices.map((c) => c.name);
    const fromRows = [...new Set(data.map((r) => r.service_type).filter(Boolean))] as string[];
    return mergeTypeOfWorkOptions([...legacy, ...fromCatalog, ...fromRows]).sort((a, b) => a.localeCompare(b));
  }, [catalogServices, data]);

  const handleSaveRequestDetails = useCallback(async () => {
    if (!selectedRequest) return;
    const kind = resolveRequestKind(selectedRequest);
    const cid = drawerFields.catalog_service_id.trim();
    if (kind === "work" && (!cid || !isUuid(cid))) {
      toast.error("Work requests need a Call Out type from Services.");
      return;
    }
    setDrawerSaving(true);
    try {
      const addr = drawerFields.property_address.trim();
      const pc = extractUkPostcode(addr);
      const updated = await updateRequest(selectedRequest.id, {
        property_address: addr,
        postcode: pc || undefined,
        service_type: normalizeTypeOfWork(drawerFields.service_type.trim()),
        description: drawerFields.description,
        catalog_service_id: cid && isUuid(cid) ? cid : null,
        request_kind: kind,
      });
      setSelectedRequest(updated);
      setPropertyAddressEditing(false);
      refreshSilent();
      toast.success("Request updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update request");
    } finally {
      setDrawerSaving(false);
    }
  }, [selectedRequest, drawerFields, refreshSilent]);

  const tabs = [
    { id: "all", label: "All Requests", count: statusCounts.all ?? 0 },
    { id: "new", label: "New", count: statusCounts.new ?? 0 },
    { id: "approved", label: "Approved", count: statusCounts.approved ?? 0 },
    { id: "converted_to_quote", label: "Converted to Quote", count: statusCounts.converted_to_quote ?? 0 },
    { id: "converted_to_job", label: "Converted to Job", count: statusCounts.converted_to_job ?? 0 },
    { id: "declined", label: "Not Qualified", count: statusCounts.declined ?? 0 },
  ];

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("service_requests").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("request", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} requests updated to ${newStatus}`);
      setSelectedIds(new Set());
      refreshSilent();
      void loadCounts();
    } catch { toast.error("Failed to update requests"); }
  };

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => softDeleteById("service_requests", id, profile?.id)));
      toast.success(`${selectedIds.size} requests archived`);
      setSelectedIds(new Set());
      refreshSilent();
      loadCounts();
    } catch {
      toast.error("Failed to archive requests");
    }
  }, [selectedIds, profile?.id, refreshSilent, loadCounts]);

  const handleStatusChange = useCallback(
    async (id: string, newStatus: string, oldStatus?: string) => {
      try {
        const updated = await updateRequestStatus(id, newStatus);
        await logAudit({
          entityType: "request", entityId: id, action: "status_changed",
          fieldName: "status", oldValue: oldStatus, newValue: newStatus,
          userId: profile?.id, userName: profile?.full_name,
        });
        setSelectedRequest((prev) => (prev?.id === id ? updated : prev));
        refreshSilent();
        await loadCounts();
        toast.success(`Request updated to ${statusConfig[newStatus]?.label ?? newStatus}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update request status";
        toast.error(message);
        console.error("Request status update failed:", err);
      }
    },
    [refreshSilent, loadCounts, profile?.id, profile?.full_name]
  );

  const handleAccept = useCallback(
    async (req: ServiceRequest) => {
      await handleStatusChange(req.id, "approved", req.status);
    },
    [handleStatusChange]
  );

  const handleDecline = useCallback(
    async (req: ServiceRequest) => {
      await handleStatusChange(req.id, "declined", req.status);
    },
    [handleStatusChange]
  );

  const canConvertToQuote = useCallback((req: ServiceRequest) => {
    const hasClient = !!req.client_name?.trim();
    const hasService = !!req.service_type?.trim();
    const hasPostcode = !!req.postcode?.trim();
    return hasClient && hasService && hasPostcode;
  }, []);

  const handleConvertToQuoteChoice = useCallback((req: ServiceRequest) => {
    if (!canConvertToQuote(req)) {
      const missing: string[] = [];
      if (!req.client_name?.trim()) missing.push("Client name");
      if (!req.service_type?.trim()) missing.push("Service type");
      if (!req.postcode?.trim()) missing.push("Postcode");
      toast.error(`Complete required fields before converting to Quote: ${missing.join(", ")}`);
      return;
    }
    setSelectedRequest(null);
    setConvertChoiceOpen(req);
  }, [canConvertToQuote]);

  const handleConvertToJob = useCallback((req: ServiceRequest) => {
    setSelectedRequest(null);
    setConvertToJobOpen(req);
  }, []);

  const handleRequestPhotosAdd = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      e.target.value = "";
      if (!selectedRequest || !list?.length) return;
      const remain = 8 - requestImageUrls.length;
      if (remain <= 0) {
        toast.error("Maximum 8 photos per request.");
        return;
      }
      setRequestPhotosSaving(true);
      try {
        const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
        const toUpload = Array.from(list).slice(0, remain);
        const urls = await uploadQuoteInviteImages(toUpload, selectedRequest.id);
        const merged = mergeImageUrlLists(requestImageUrls, urls);
        const updated = await updateRequest(selectedRequest.id, { images: merged });
        setSelectedRequest(updated);
        setRequestImageUrls(normalizeJsonImageArray(updated.images));
        refreshSilent();
        toast.success("Photos saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setRequestPhotosSaving(false);
      }
    },
    [selectedRequest, requestImageUrls, refreshSilent]
  );

  const handleRequestPhotoRemove = useCallback(
    async (url: string) => {
      if (!selectedRequest) return;
      setRequestPhotosSaving(true);
      try {
        const merged = requestImageUrls.filter((u) => u !== url);
        const updated = await updateRequest(selectedRequest.id, { images: merged });
        setSelectedRequest(updated);
        setRequestImageUrls(normalizeJsonImageArray(updated.images));
        refreshSilent();
        toast.success("Photo removed");
      } catch {
        toast.error("Failed to remove photo");
      } finally {
        setRequestPhotosSaving(false);
      }
    },
    [selectedRequest, requestImageUrls, refreshSilent]
  );

  const handleCreate = useCallback(
    async (formData: Partial<ServiceRequest>, photoFiles?: File[]) => {
      const perfStart = performance.now();
      let dupMs = 0;
      let insertMs = 0;
      let photoMs = 0;
      try {
        const isManualSource = (formData.source ?? "manual") === "manual";
        const tDup = performance.now();
        const dupReq = await findDuplicateRequests({
          clientId: formData.client_id,
          clientEmail: formData.client_email ?? "",
          propertyAddress: formData.property_address ?? "",
          serviceType: normalizeTypeOfWork(formData.service_type ?? ""),
          description: formData.description ?? "",
        });
        dupMs = performance.now() - tDup;
        if (!(await confirmDespiteDuplicates(formatRequestDuplicateLines(dupReq)))) return;

        const tIns = performance.now();
        const result = await createRequest({
          client_id: formData.client_id,
          client_address_id: formData.client_address_id,
          client_name: formData.client_name ?? "",
          client_email: formData.client_email ?? "",
          client_phone: formData.client_phone,
          property_address: formData.property_address ?? "",
          postcode: formData.postcode,
          source: formData.source ?? "manual",
              service_type: normalizeTypeOfWork(formData.service_type ?? ""),
          description: formData.description ?? "",
          status: isManualSource ? "approved" : "new",
          priority: formData.priority ?? "medium",
          owner_id: profile?.id,
          owner_name: profile?.full_name ?? "",
          assigned_to: formData.assigned_to,
          catalog_service_id: formData.catalog_service_id && isUuid(String(formData.catalog_service_id).trim())
            ? String(formData.catalog_service_id).trim()
            : null,
          request_kind:
            formData.request_kind === "quote" || formData.request_kind === "work" ? formData.request_kind : "quote",
          in_ccz: formData.in_ccz ?? null,
          has_free_parking: formData.has_free_parking ?? null,
        });
        insertMs = performance.now() - tIns;

        void logAudit({
          entityType: "request", entityId: result.id, entityRef: result.reference,
          action: "created", userId: profile?.id, userName: profile?.full_name,
        });

        let rowAfterPhotos: ServiceRequest | null = null;
        if (photoFiles?.length) {
          const tPh = performance.now();
          const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
          const urls = await uploadQuoteInviteImages(photoFiles, result.id);
          rowAfterPhotos = await updateRequest(result.id, { images: urls }, { enrich: false });
          photoMs = performance.now() - tPh;
        }
        setCreateOpen(false);
        if (isManualSource) {
          setStatus("approved");
          const r = rowAfterPhotos ?? result;
          setSelectedRequest(r);
          const kind =
            r.request_kind === "work" || r.request_kind === "quote"
              ? r.request_kind
              : formData.request_kind === "work" || formData.request_kind === "quote"
                ? formData.request_kind
                : "quote";
          if (kind === "work") {
            setConvertToJobOpen(r);
          } else {
            setConvertChoiceOpen(r);
          }
        }
        toast.success("Request created successfully");
        trackUiPerf("requests.create_request_ms", performance.now() - perfStart, {
          photos: photoFiles?.length ?? 0,
          dup_ms: Math.round(dupMs),
          insert_ms: Math.round(insertMs),
          photo_ms: Math.round(photoMs),
          dup_path: formData.client_id && isUuid(String(formData.client_id).trim()) ? "client_id" : "email",
        });
        queueMicrotask(() => {
          refreshSilent();
          void loadCounts();
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create request");
      }
    },
    [refreshSilent, loadCounts, profile?.id, profile?.full_name, setStatus, confirmDespiteDuplicates]
  );

  const columns: Column<ServiceRequest>[] = [
    {
      key: "reference",
      label: "Request ID",
      minWidth: "132px",
      cellClassName: "min-w-[8rem] max-w-[14rem] sm:max-w-[16rem]",
      render: (item) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{item.reference}</p>
          <p className="text-[11px] text-text-tertiary line-clamp-2 break-words">{item.description}</p>
        </div>
      ),
    },
    {
      key: "client_name", label: "Client",
      render: (item) => {
        const acct = linkedAccountDisplay(item.source_account_name);
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={item.client_name} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{item.client_name}</p>
              <p className="text-[11px] text-text-tertiary truncate" title={acct || undefined}>
                {acct ? (
                  <span className="font-medium text-text-secondary">{acct}</span>
                ) : (
                  <span className="italic">No linked account</span>
                )}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "property_address", label: "Property",
      render: (item) => (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary max-w-[200px]">
          <MapPin className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <span className="truncate">{item.property_address}</span>
        </div>
      ),
    },
    {
      key: "service_type", label: "Service",
      render: (item) => {
        const label = normalizeTypeOfWork(item.service_type) || item.service_type;
        const colorKey = normalizeTypeOfWork(item.service_type) || item.service_type;
        return (
          <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${serviceColors[colorKey] || serviceColors[item.service_type] || "bg-surface-tertiary text-text-primary ring-border/50"}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const config = statusConfig[item.status] ?? { label: item.status, variant: "default" as const };
        return <Badge variant={config.variant} dot>{config.label}</Badge>;
      },
    },
    {
      key: "priority", label: "Priority",
      render: (item) => {
        const config = priorityConfig[item.priority];
        return <Badge variant={config.variant} size="sm">{config.label}</Badge>;
      },
    },
    {
      key: "owner_name", label: "Owner",
      render: (item) =>
        item.owner_name ? (
          <div className="flex items-center gap-1.5">
            <Avatar name={item.owner_name} size="xs" />
            <span className="text-xs font-medium text-text-primary">{item.owner_name}</span>
          </div>
        ) : (
          <span className="text-xs text-text-tertiary italic">No owner</span>
        ),
    },
  ];

  const [exportOpen, setExportOpen] = useState(false);
  const requestVisibleFields = ["reference", "client_name", "service_type", "property_address", "status", "priority", "owner_name"];
  const requestAllFields = useMemo(
    () => [...new Set(data.flatMap((row) => Object.keys(row as unknown as Record<string, unknown>)))],
    [data],
  );

  const handleExportFullCsv = useCallback(async (fields: string[]) => {
    try {
      const allRows: ServiceRequest[] = [];
      let p = 1;
      const pageSize = 500;
      while (true) {
        const res = await listRequests({
          page: p,
          pageSize,
          search: search.trim() ? search : undefined,
          status: status !== "all" ? status : undefined,
          ...(createdAtRangeFilter ?? {}),
        });
        allRows.push(...res.data);
        if (p >= res.totalPages) break;
        p += 1;
      }
      const filtered = allRows.filter((r) => {
        if (filterPriority === "high" && r.priority !== "high" && r.priority !== "urgent") return false;
        if (filterPriority === "urgent" && r.priority !== "urgent") return false;
        if (filterService !== "all" && normalizeTypeOfWork(r.service_type) !== normalizeTypeOfWork(filterService)) return false;
        if (buFilter.selectedBuId) {
          if (!buFilter.clientIdsInBu) return true;
          if (!r.client_id || !buFilter.clientIdsInBu.has(r.client_id)) return false;
        }
        return true;
      });
      if (filtered.length === 0) {
        toast.info("No requests to export");
        return;
      }
      const rows = filtered as unknown as Array<Record<string, unknown>>;
      const finalFields = fields.length > 0 ? fields : [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const csv = buildCsvFromRows(rows, finalFields);
      downloadCsvFile(`requests-${status}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${filtered.length} requests with full fields`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export requests");
    }
  }, [
    search,
    status,
    createdAtRangeFilter,
    filterPriority,
    filterService,
    buFilter.selectedBuId,
    buFilter.clientIdsInBu,
  ]);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Requests" infoTooltip="Manage incoming service requests and leads.">
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setExportOpen(true)}>
            Export
          </Button>
          <div className="relative flex items-center gap-2" ref={filterRef}>
            <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>Filter</Button>
            {(filterPriority !== "all" || filterService !== "all" || periodMode !== DEFAULT_FINANCE_PERIOD_MODE || buFilter.selectedBuId) && (
              <span className="text-[10px] font-medium text-primary">Active</span>
            )}
            {filterOpen && (
              <div className="absolute top-full right-0 mt-1 w-[min(100vw-2rem,18rem)] rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                  <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                  Created date
                </p>
                <p className="text-[10px] text-text-tertiary leading-snug">
                  Use the <strong className="text-text-secondary">Period</strong> bar above (All · Monthly · Week · Date range). List and KPIs follow creation date in that window (inclusive).
                </p>
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Priority</p>
                <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as "all" | "high" | "urgent")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                  <option value="all">All</option>
                  <option value="high">High & Urgent</option>
                  <option value="urgent">Urgent only</option>
                </select>
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Service type</p>
                <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                  <option value="all">All</option>
                  {serviceFilterOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {buFilter.visible && (
                  <>
                    <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Business Unit</p>
                    <select
                      value={buFilter.selectedBuId ?? ""}
                      onChange={(e) => buFilter.setSelectedBuId(e.target.value || null)}
                      className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2"
                    >
                      <option value="">All BUs</option>
                      {buFilter.bus.map((bu) => (
                        <option key={bu.id} value={bu.id}>{bu.name}</option>
                      ))}
                    </select>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setFilterPriority("all");
                    setFilterService("all");
                    buFilter.setSelectedBuId(null);
                    setPeriodMode(DEFAULT_FINANCE_PERIOD_MODE);
                    setWeekAnchor(new Date());
                    setMonthAnchor(new Date());
                    setPeriodRangeFrom("");
                    setPeriodRangeTo("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Request</Button>
        </PageHeader>

        <div className="rounded-xl border border-border-light bg-surface-hover/60 p-4 space-y-3">
          <FinanceWeekRangeBar
            mode={periodMode}
            onModeChange={setPeriodMode}
            weekAnchor={weekAnchor}
            onWeekAnchorChange={setWeekAnchor}
            monthAnchor={monthAnchor}
            onMonthAnchorChange={setMonthAnchor}
            rangeFrom={periodRangeFrom}
            rangeTo={periodRangeTo}
            onRangeFromChange={setPeriodRangeFrom}
            onRangeToChange={setPeriodRangeTo}
            hideAllDescription
          />
        </div>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          <KpiCard
            className="min-h-[128px] h-full"
            title="New requests"
            value={requestKpis.newReq}
            format="number"
            icon={Inbox}
            accent="blue"
            description="Awaiting triage"
            descriptionAsTooltip
          />
          <KpiCard
            className="min-h-[128px] h-full"
            title="Approval rate"
            value={requestKpis.approvalPct ?? "—"}
            format={requestKpis.approvalPct != null ? "percent" : "none"}
            icon={Percent}
            accent="emerald"
            description={
              requestKpis.decided === 0
                ? "No approved / declined yet"
                : `${requestKpis.approved} approved · ${requestKpis.declined} declined`
            }
            descriptionAsTooltip
          />
          <KpiCard
            className="min-h-[128px] h-full"
            title="Request → quote"
            value={requestKpis.quotePct ?? "—"}
            format={requestKpis.quotePct != null ? "percent" : "none"}
            icon={FileText}
            accent="purple"
            description={
              requestKpis.total === 0
                ? "No requests yet"
                : `${requestKpis.toQuote} converted · ${requestKpis.total} total`
            }
            descriptionAsTooltip
          />
          <KpiCard
            className="min-h-[128px] h-full"
            title="Request → job"
            value={requestKpis.jobPct ?? "—"}
            format={requestKpis.jobPct != null ? "percent" : "none"}
            icon={Briefcase}
            accent="amber"
            description={
              requestKpis.total === 0
                ? "No requests yet"
                : `${requestKpis.toJob} direct jobs · ${requestKpis.total} total`
            }
            descriptionAsTooltip
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <SearchInput
              placeholder="Search requests..."
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <DataTable
            columns={columns}
            data={filteredRequests}
            columnConfigKey="requests-columns"
            columnConfigScope={status}
            loading={loading}
            getRowId={(item) => item.id}
            selectedId={selectedRequest?.id}
            onRowClick={setSelectedRequest}
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
                <BulkBtn label="Accept" onClick={() => handleBulkStatusChange("approved")} variant="success" />
                <BulkBtn label="Decline" onClick={() => handleBulkStatusChange("declined")} variant="danger" />
                <BulkBtn label="Archive" onClick={handleBulkArchive} variant="warning" />
              </div>
            }
          />
        </motion.div>
      </div>

      {/* Request Detail Drawer */}
      <Drawer
        open={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title={selectedRequest?.reference}
        subtitle={selectedRequest?.service_type}
      >
        {selectedRequest && (
          <div className="flex flex-col h-full">
            <Tabs
              tabs={[{ id: "details", label: "Details" }, { id: "history", label: "History" }]}
              activeTab={drawerTab}
              onChange={setDrawerTab}
              className="px-6 pt-2"
            />
            {drawerTab === "details" && (
              <div className="p-6 space-y-6 flex-1 overflow-auto">
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
                    <div className="flex items-center gap-3 mt-2">
                      <Avatar name={selectedRequest.client_name} size="lg" />
                      <div>
                        <p className="text-base font-semibold text-text-primary">{selectedRequest.client_name}</p>
                        <p className="text-sm text-text-secondary">
                          {selectedAccountLabel ? (
                            selectedAccountLabel
                          ) : (
                            <span className="text-text-tertiary italic">No linked account</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-surface-hover">
                      <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
                      <div className="mt-1">
                        <Badge variant={(statusConfig[selectedRequest.status] ?? { variant: "default" as const }).variant} dot size="md">
                          {(statusConfig[selectedRequest.status] ?? { label: selectedRequest.status }).label}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-surface-hover">
                      <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Priority</label>
                      <div className="mt-1">
                        <Badge variant={priorityConfig[selectedRequest.priority].variant} size="md">
                          {priorityConfig[selectedRequest.priority].label}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-hover">
                    <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job Owner (Commission)</label>
                    {isAdmin ? (
                      <div className="mt-2">
                        <JobOwnerSelect
                          value={selectedRequest.owner_id}
                          fallbackName={selectedRequest.owner_name}
                          users={assignableUsers}
                          disabled={savingOwner}
                          onChange={async (ownerId) => {
                            const owner = assignableUsers.find((u) => u.id === ownerId);
                            setSavingOwner(true);
                            try {
                              const updated = await updateRequest(selectedRequest.id, {
                                owner_id: ownerId,
                                owner_name: owner?.full_name,
                              });
                              setSelectedRequest(updated);
                              refreshSilent();
                              toast.success("Owner updated");
                            } catch {
                              toast.error("Failed to update owner");
                            } finally {
                              setSavingOwner(false);
                            }
                          }}
                        />
                      </div>
                    ) : selectedRequest.owner_name ? (
                      <div className="flex items-center gap-2.5 mt-2">
                        <Avatar name={selectedRequest.owner_name} size="sm" />
                        <p className="text-sm font-semibold text-text-primary">{selectedRequest.owner_name}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-text-tertiary italic mt-2">No owner</p>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Property</label>
                      {!propertyAddressEditing ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs shrink-0"
                          icon={<PenLine className="h-3 w-3" />}
                          onClick={() => setPropertyAddressEditing(true)}
                        >
                          Edit address
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs shrink-0"
                          onClick={() => {
                            setDrawerFields((f) => ({ ...f, property_address: selectedRequest.property_address ?? "" }));
                            setPropertyAddressEditing(false);
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                    {!propertyAddressEditing ? (
                      <div className="flex items-start gap-2 mt-1.5">
                        <MapPin className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
                        <p className="text-sm text-text-primary break-words">{selectedRequest.property_address?.trim() || "—"}</p>
                      </div>
                    ) : (
                      <div className="mt-1.5 space-y-1.5">
                        <textarea
                          value={drawerFields.property_address}
                          onChange={(e) => setDrawerFields((f) => ({ ...f, property_address: e.target.value }))}
                          rows={3}
                          placeholder="Full property address (include UK postcode if possible)…"
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-none"
                        />
                        <p className="text-[10px] text-text-tertiary leading-snug">
                          Use when the client asks to change the property. Postcode is taken from the address text when you save. Click <strong className="text-text-secondary">Save &amp; Update</strong> below to apply.
                        </p>
                      </div>
                    )}
                    <LocationMiniMap
                      address={drawerFields.property_address.trim() || selectedRequest.property_address || ""}
                      className="mt-2"
                    />
                  </div>

                  <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Service &amp; pricing</p>
                    {resolveRequestKind(selectedRequest) === "work" ? (
                      <ServiceCatalogSelect
                        label="Call Out type"
                        emptyOptionLabel="Select call out type..."
                        catalog={catalogServices}
                        value={drawerFields.catalog_service_id}
                        onChange={(id, svc) => {
                          setDrawerFields((f) => ({
                            ...f,
                            catalog_service_id: id,
                            ...(svc
                              ? {
                                  service_type: normalizeTypeOfWork(svc.name),
                                  description: (svc.default_description?.trim() || f.description) ?? "",
                                }
                              : {}),
                          }));
                        }}
                      />
                    ) : (
                      <Select
                        label="Type of work"
                        value={drawerFields.service_type}
                        onChange={(e) => setDrawerFields((f) => ({ ...f, service_type: e.target.value }))}
                        options={[
                          { value: "", label: "Select type of work..." },
                          ...mergeTypeOfWorkOptions([...TYPE_OF_WORK_OPTIONS, ...catalogServices.map((c) => c.name)])
                            .sort((a, b) => a.localeCompare(b))
                            .map((name) => ({ value: name, label: name })),
                        ]}
                      />
                    )}
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Service description</label>
                      <textarea
                        value={drawerFields.description}
                        onChange={(e) => setDrawerFields((f) => ({ ...f, description: e.target.value }))}
                        rows={4}
                        placeholder="Describe the issue — what the client needs, access, urgency…"
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-none"
                      />
                    </div>
                    <div className="rounded-lg border border-border-light bg-surface-hover/50 p-3 space-y-2">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Photos</p>
                      <p className="text-[11px] text-text-tertiary">Saved on this request and copied to the quote when you convert to bidding — shown in the partner app.</p>
                      <div className="flex flex-wrap gap-2 items-center">
                        <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-text-primary cursor-pointer hover:border-primary/30 disabled:opacity-50">
                          <ImagePlus className="h-3.5 w-3.5" />
                          Add photos
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            multiple
                            className="sr-only"
                            disabled={requestPhotosSaving || requestImageUrls.length >= 8}
                            onChange={handleRequestPhotosAdd}
                          />
                        </label>
                        {requestPhotosSaving && <span className="text-[11px] text-text-tertiary">Saving…</span>}
                      </div>
                      {requestImageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {requestImageUrls.map((src) => (
                            <div key={src} className="relative h-16 w-16 rounded-lg overflow-hidden border border-border-light bg-surface-hover shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt="" className="h-full w-full object-cover" />
                              <button
                                type="button"
                                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 disabled:opacity-50"
                                disabled={requestPhotosSaving}
                                onClick={() => void handleRequestPhotoRemove(src)}
                                aria-label="Remove photo"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button variant="primary" size="sm" onClick={handleSaveRequestDetails} disabled={drawerSaving}>
                      {drawerSaving ? "Updating…" : "Save & Update"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Mail className="h-4 w-4" />
                    {selectedRequest.client_email}
                  </div>
                  {selectedRequest.client_phone && (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <Phone className="h-4 w-4" />
                      {selectedRequest.client_phone}
                    </div>
                  )}
                </div>

                {/* NEW: Accept / Decline for new requests only */}
                {selectedRequest.status === "new" && (
                  <div className="flex gap-2 pt-4 border-t border-border-light">
                    <Button variant="primary" className="flex-1" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => handleAccept(selectedRequest)}>
                      Accept
                    </Button>
                    <Button variant="outline" className="flex-1" size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => handleDecline(selectedRequest)}>
                      Decline
                    </Button>
                  </div>
                )}

                {/* APPROVED: show Convert to Quote / Create Job */}
                {selectedRequest.status === "approved" && (
                  <div className="flex gap-2 pt-4 border-t border-border-light">
                    {!canConvertToQuote(selectedRequest) && (
                      <p className="text-xs text-amber-600 mb-2 w-full">Fill client name, service type and postcode to unlock Convert to Quote.</p>
                    )}
                    <Button variant="primary" className="flex-1" size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => handleConvertToQuoteChoice(selectedRequest)} disabled={!canConvertToQuote(selectedRequest)}>
                      Convert to Quote
                    </Button>
                    <Button variant="outline" className="flex-1" size="sm" icon={<Briefcase className="h-3.5 w-3.5" />} onClick={() => handleConvertToJob(selectedRequest)}>
                      Create Job
                    </Button>
                  </div>
                )}

                {/* Converted to Quote indicator */}
                {selectedRequest.status === "converted_to_quote" && (
                  <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <p className="text-sm font-medium text-blue-700">Converted to Quote</p>
                    </div>
                  </div>
                )}

                {/* Converted to Job indicator */}
                {selectedRequest.status === "converted_to_job" && (
                  <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-emerald-600" />
                      <p className="text-sm font-medium text-emerald-700">Converted to Job</p>
                    </div>
                  </div>
                )}

                {/* Declined indicator */}
                {selectedRequest.status === "declined" && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <p className="text-sm font-medium text-red-700">Not Qualified / Declined</p>
                    </div>
                    <p className="text-xs text-red-600">This request was declined but is kept for records.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => handleStatusChange(selectedRequest.id, "new", selectedRequest.status)}>
                      Reopen Request
                    </Button>
                  </div>
                )}
              </div>
            )}
            {drawerTab === "history" && (
              <div className="p-6 flex-1 overflow-auto">
                <AuditTimeline entityType="request" entityId={selectedRequest.id} />
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Convert to Quote: Choice Modal — Invite Partner or Manual Quote */}
      <AnimatePresence>
        {convertChoiceOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain py-6 px-3">
            <motion.div
              variants={overlayTransition}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={() => setConvertChoiceOpen(null)}
              className="absolute inset-0"
              style={{ background: "rgba(15,15,20,0.08)", backdropFilter: "blur(4px)" }}
            />
            <motion.div
              variants={modalTransition}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full bg-white overflow-hidden my-auto"
              style={{
                maxWidth: "480px",
                borderRadius: "12px",
                border: "0.5px solid #E4E4E8",
                boxShadow: "0 20px 50px -20px rgba(2,0,64,0.12), 0 4px 12px -4px rgba(0,0,0,0.04)",
              }}
            >
              {/* Header */}
              <div
                className="flex items-start justify-between gap-3 px-[20px] py-[16px]"
                style={{ background: "#FAFAFB", borderBottom: "0.5px solid #E4E4E8" }}
              >
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold leading-tight" style={{ color: "#020040" }}>
                    Convert to Quote
                  </h2>
                  <p className="text-[12px] mt-[2px]" style={{ color: "#6B6B70" }}>
                    Pick how you want to create this quote
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConvertChoiceOpen(null)}
                  className="p-1 leading-none bg-transparent border-none cursor-pointer shrink-0"
                  style={{ color: "#9A9AA0" }}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body: 2 option cards */}
              <div className="p-[16px] space-y-[10px]">
                {/* Invite Partner — navy avatar, Recommended pill */}
                <button
                  type="button"
                  onClick={() => {
                    const req = convertChoiceOpen;
                    setConvertChoiceOpen(null);
                    setInvitePartnerOpen(req ? (data.find((r) => r.id === req.id) ?? req) : null);
                  }}
                  className="w-full text-left rounded-[10px] bg-white flex items-center gap-[14px] transition-colors"
                  style={{ border: "0.5px solid #D8D8DD", padding: "12px 14px" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = "#020040")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = "#D8D8DD")}
                >
                  <div
                    className="w-[36px] h-[36px] rounded-[8px] flex items-center justify-center shrink-0"
                    style={{ background: "#020040" }}
                  >
                    <UserPlus className="h-[18px] w-[18px] text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[8px] flex-wrap">
                      <span className="text-[14px] font-semibold" style={{ color: "#020040" }}>
                        Invite Partner
                      </span>
                      <span
                        className="text-[9px] font-semibold uppercase px-[6px] py-[2px] rounded"
                        style={{ background: "#FFF1EB", color: "#ED4B00", letterSpacing: "0.5px" }}
                      >
                        Recommended
                      </span>
                    </div>
                    <p className="text-[12px] mt-[3px] leading-snug" style={{ color: "#6B6B70" }}>
                      Matched partners get invited by email, app or both. Fastest path to a quote.
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0" style={{ color: "#9A9AA0" }} />
                </button>

                {/* Manual Quote — coral avatar */}
                <button
                  type="button"
                  onClick={() => {
                    const req = convertChoiceOpen;
                    setConvertChoiceOpen(null);
                    setManualQuoteOpen(req ? (data.find((r) => r.id === req.id) ?? req) : null);
                  }}
                  className="w-full text-left rounded-[10px] bg-white flex items-center gap-[14px] transition-colors"
                  style={{ border: "0.5px solid #D8D8DD", padding: "12px 14px" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = "#020040")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = "#D8D8DD")}
                >
                  <div
                    className="w-[36px] h-[36px] rounded-[8px] flex items-center justify-center shrink-0"
                    style={{ background: "#FFF1EB" }}
                  >
                    <Edit3 className="h-[18px] w-[18px]" style={{ color: "#ED4B00" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold" style={{ color: "#020040" }}>
                      Manual Quote
                    </p>
                    <p className="text-[12px] mt-[3px] leading-snug" style={{ color: "#6B6B70" }}>
                      Enter quote lines (service, qty, unit price, VAT). Opens Review &amp; send.
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0" style={{ color: "#9A9AA0" }} />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Invite Partner Modal */}
      <InvitePartnerToQuote
        request={invitePartnerOpen}
        loadPartners={getPartnersAllCached}
        onClose={() => setInvitePartnerOpen(null)}
        onDone={async (req, partnerIds, sendMethod, clientAddress, invitePhotoFiles) => {
          const perfStart = performance.now();
          try {
            if (!clientAddress?.client_id || !clientAddress?.property_address?.trim()) {
              toast.error("Select a client from the list (click the name) and choose or add a property address.");
              return;
            }
            const [resolvedAddr, freshReq, quoteInviteMod] = await Promise.all([
              ensureClientAddressForQuote(clientAddress),
              getRequest(req.id, { enrich: false }).catch(() => null),
              import("@/services/quote-invite-images"),
            ]);
            const { uploadQuoteInviteImages } = quoteInviteMod;
            const fromRequest = normalizeJsonImageArray(freshReq?.images ?? req.images);
            let uploaded: string[] = [];
            if (invitePhotoFiles?.length) {
              try {
                uploaded = await uploadQuoteInviteImages(invitePhotoFiles, req.id);
              } catch (imgErr) {
                toast.error(
                  imgErr instanceof Error
                    ? `${imgErr.message} Continuing without invite photos.`
                    : "Could not upload invite photos. Continuing without photos."
                );
                uploaded = [];
              }
            }
            const mergedQuoteImages = mergeImageUrlLists(fromRequest, uploaded);
            const scopeFromRequest = [req.description?.trim(), req.scope?.trim()].filter(Boolean).join("\n\n") || undefined;
            const catalogId =
              req.catalog_service_id && isUuid(String(req.catalog_service_id).trim())
                ? String(req.catalog_service_id).trim()
                : null;
            const quoteTitle = `${req.service_type} — ${resolvedAddr.client_name}`;
            const dupQ = await findDuplicateQuotes({
              clientEmail: resolvedAddr.client_email ?? req.client_email ?? "",
              title: quoteTitle,
              propertyAddress: resolvedAddr.property_address,
            });
            if (!(await confirmDespiteDuplicates(formatQuoteDuplicateLines(dupQ)))) return;

            const quote = await createQuote({
              title: quoteTitle,
              client_id: resolvedAddr.client_id,
              client_address_id: resolvedAddr.client_address_id,
              client_name: resolvedAddr.client_name,
              client_email: resolvedAddr.client_email ?? req.client_email ?? "",
              request_id: req.id,
              property_id: freshReq?.property_id ?? req.property_id ?? undefined,
              service_type: normalizeTypeOfWork(req.service_type?.trim() || "") || null,
              catalog_service_id: catalogId,
              status: "bidding",
              total_value: req.estimated_value ?? 0,
              partner_quotes_count: partnerIds.length,
              cost: 0,
              sell_price: req.estimated_value ?? 0,
              margin_percent: 0,
              quote_type: "partner",
              deposit_percent: 50,
              deposit_required: 0,
              customer_accepted: false,
              customer_deposit_paid: false,
              partner_cost: 0,
              property_address: resolvedAddr.property_address,
              scope: scopeFromRequest,
              email_attach_request_photos: false,
              ...(mergedQuoteImages.length > 0 ? { images: mergedQuoteImages } : {}),
              owner_id: profile?.id,
              owner_name: profile?.full_name,
            });
            const photoUrlsForPush = mergedQuoteImages;
            const inviteBody =
              `${req.service_type} — ${resolvedAddr.property_address ?? req.property_address ?? ""}`.trim() || quote.reference;

            const pushTask =
              sendMethod === "app" || sendMethod === "both"
                ? (async () => {
                    const pushRes = await fetch("/api/push/notify-partner", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        partnerIds,
                        title: "New quote invitation",
                        body: inviteBody,
                        data: { type: "quote_invite", quoteId: quote.id, photoUrls: photoUrlsForPush },
                      }),
                    }).catch(() => null);
                    if (pushRes?.ok) {
                      const pushBody = (await pushRes.json().catch(() => ({}))) as {
                        sent?: number;
                        tokensFound?: number;
                      };
                      if (Number(pushBody.sent ?? 0) <= 0) {
                        toast.error(
                          Number(pushBody.tokensFound ?? 0) <= 0
                            ? "No valid push token found for selected partner(s)."
                            : "Push accepted but not delivered."
                        );
                      }
                    }
                  })()
                : Promise.resolve();

            const emailTask =
              sendMethod === "email" || sendMethod === "both"
                ? fetch("/api/quotes/partner-invite-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ quoteId: quote.id, partnerIds }),
                  })
                    .then(() => {})
                    .catch(() => {})
                : Promise.resolve();

            await Promise.all([
              pushTask,
              emailTask,
              updateRequestStatus(req.id, "converted_to_quote", { enrich: false }),
              logAudit({
                entityType: "request", entityId: req.id, entityRef: req.reference,
                action: "status_changed", fieldName: "status",
                oldValue: req.status, newValue: "converted_to_quote",
                metadata: { converted_to_quote: quote.reference, partners_invited: partnerIds.length, send_method: sendMethod },
                userId: profile?.id, userName: profile?.full_name,
              }),
            ]);

            setInvitePartnerOpen(null);
            toast.success(`Quote ${quote.reference} created. ${partnerIds.length} partner(s) invited via ${sendMethod}.`);
            router.push(`/quotes?quoteId=${encodeURIComponent(quote.id)}&drawerTab=bids`);
            queueMicrotask(() => {
              void refreshSilent();
              void loadCounts();
            });
            trackUiPerf("requests.invite_partner_convert_ms", performance.now() - perfStart, {
              partners: partnerIds.length,
              photos: invitePhotoFiles?.length ?? 0,
            });
          } catch (err) {
            const msg =
              err &&
              typeof err === "object" &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
                ? (err as { message: string }).message
                : err instanceof Error
                  ? err.message
                  : "Failed to convert to quote";
            toast.error(msg);
          }
        }}
      />

      {/* Manual Quote Modal */}
      <ManualQuoteModal
        request={manualQuoteOpen}
        catalogServices={catalogServices}
        onClose={() => setManualQuoteOpen(null)}
        onDone={async (req, lineItems, clientAddress, catalogServiceId) => {
          const perfStart = performance.now();
          try {
            if (!clientAddress?.client_id || !clientAddress?.property_address?.trim()) {
              toast.error("Select a client from the list (click the name) and choose or add a property address.");
              return;
            }
            const [resolvedAddr, freshReq] = await Promise.all([
              ensureClientAddressForQuote(clientAddress),
              getRequest(req.id, { enrich: false }).catch(() => null),
            ]);
            const total = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
            const fromRequest = normalizeJsonImageArray(freshReq?.images ?? req.images);
            const scopeFromRequest = [req.description?.trim(), req.scope?.trim()].filter(Boolean).join("\n\n") || undefined;
            const manualCatalogId = (() => {
              const cid = catalogServiceId ?? req.catalog_service_id;
              if (!cid) return null;
              const s = String(cid).trim();
              return isUuid(s) ? s : null;
            })();
            const manualQuoteTitle = `${req.service_type} — ${resolvedAddr.client_name}`;
            const dupManualQ = await findDuplicateQuotes({
              clientEmail: resolvedAddr.client_email ?? req.client_email ?? "",
              title: manualQuoteTitle,
              propertyAddress: resolvedAddr.property_address,
            });
            if (!(await confirmDespiteDuplicates(formatQuoteDuplicateLines(dupManualQ)))) return;

            const quote = await createQuote({
              title: manualQuoteTitle,
              client_id: resolvedAddr.client_id,
              client_address_id: resolvedAddr.client_address_id,
              client_name: resolvedAddr.client_name,
              client_email: resolvedAddr.client_email ?? req.client_email ?? "",
              request_id: req.id,
              property_id: freshReq?.property_id ?? req.property_id ?? undefined,
              service_type: normalizeTypeOfWork(req.service_type?.trim() || "") || null,
              catalog_service_id: manualCatalogId,
              status: "draft",
              total_value: total,
              partner_quotes_count: 0,
              cost: total,
              sell_price: total,
              margin_percent: 0,
              quote_type: "internal",
              deposit_percent: 50,
              deposit_required: 0,
              customer_accepted: false,
              customer_deposit_paid: false,
              partner_cost: 0,
              property_address: resolvedAddr.property_address,
              scope: scopeFromRequest,
              email_attach_request_photos: false,
              ...(fromRequest.length > 0 ? { images: fromRequest } : {}),
              owner_id: profile?.id,
              owner_name: profile?.full_name,
            });
            const supabase = getSupabase();
            const items = lineItems.map((li, i) => ({
              quote_id: quote.id,
              description: li.description,
              quantity: li.quantity,
              unit_price: li.unitPrice,
              sort_order: i,
            }));
            if (items.length > 0) await supabase.from("quote_line_items").insert(items);
            await Promise.all([
              updateRequestStatus(req.id, "converted_to_quote", { enrich: false }),
              logAudit({
                entityType: "request", entityId: req.id, entityRef: req.reference,
                action: "status_changed", fieldName: "status",
                oldValue: req.status, newValue: "converted_to_quote",
                metadata: { converted_to_quote: quote.reference, type: "manual" },
                userId: profile?.id, userName: profile?.full_name,
              }),
            ]);
            setManualQuoteOpen(null);
            refreshSilent();
            void loadCounts();
            toast.success(`Quote ${quote.reference} created with ${lineItems.length} line items.`);
            router.push(`/quotes?quoteId=${encodeURIComponent(quote.id)}&drawerTab=overview`);
            trackUiPerf("requests.manual_quote_convert_ms", performance.now() - perfStart, { items: lineItems.length });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create quote");
          }
        }}
      />

      {/* Convert to Job Modal */}
      <ConvertToJobModal
        request={convertToJobOpen}
        catalogServices={catalogServices}
        loadPartners={getPartnersAllCached}
        onClose={() => setConvertToJobOpen(null)}
        onConvert={async (data) => {
          const perfStart = performance.now();
          if (!convertToJobOpen) return;
          try {
            if (!data.client_id || !data.property_address?.trim()) {
              toast.error("Select a client from the list (click the name) and choose or add a property address.");
              return;
            }
            const clientPrice = data.client_price ?? 0;
            const partnerCost = data.partner_cost ?? 0;
            const isAutoAssign = data.assignment_mode === "auto";
            const inCczEff = effectiveInCczForAddress(data.in_ccz, data.property_address);
            const accessSurcharge = computeAccessSurcharge({
              inCcz: inCczEff,
              hasFreeParking: data.has_free_parking,
            });
            const margin = clientPrice > 0 ? Math.round(((clientPrice - partnerCost) / clientPrice) * 1000) / 10 : 0;
            const hasPartner = !isAutoAssign && !!(data.partner_id?.trim() || data.partner_name?.trim());
            const dupJ = await findDuplicateJobs({
              clientId: data.client_id,
              propertyAddress: data.property_address,
              title: `${convertToJobOpen.service_type} — ${data.client_name}`,
              scheduled_date: data.scheduled_date ?? null,
              scheduled_start_at: data.scheduled_start_at ?? null,
              scheduled_end_at: data.scheduled_end_at ?? null,
            });
            if (!(await confirmDespiteDuplicates(formatJobDuplicateLines(dupJ)))) return;

            const job = await createJob({
              title: `${convertToJobOpen.service_type} — ${data.client_name}`,
              catalog_service_id: data.catalog_service_id ?? null,
              in_ccz: inCczEff,
              has_free_parking: data.has_free_parking ?? null,
              client_id: data.client_id,
              client_address_id: data.client_address_id,
              property_id: convertToJobOpen.property_id ?? undefined,
              client_name: data.client_name,
              property_address: data.property_address,
              partner_name: isAutoAssign ? null : data.partner_name,
              partner_id: isAutoAssign ? null : data.partner_id,
              scheduled_date: data.scheduled_date,
              scheduled_start_at: data.scheduled_start_at,
              scheduled_end_at: data.scheduled_end_at,
              scheduled_finish_date: data.scheduled_finish_date ?? null,
              status: isAutoAssign ? "auto_assigning" : hasPartner ? "scheduled" : "unassigned",
              progress: 0,
              current_phase: 0,
              total_phases: normalizeTotalPhases(data.total_phases),
              client_price: clientPrice,
              extras_amount: accessSurcharge,
              partner_cost: partnerCost,
              materials_cost: 0,
              margin_percent: margin,
              partner_agreed_value: partnerCost,
              scope: data.scope,
              internal_notes: data.internal_notes,
              images: capJobImagesArray(coerceJobImagesArray(convertToJobOpen.images)),
              cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
              finance_status: "unpaid",
              service_value: clientPrice + accessSurcharge,
              report_submitted: false,
              report_1_uploaded: false, report_1_approved: false,
              report_2_uploaded: false, report_2_approved: false,
              report_3_uploaded: false, report_3_approved: false,
              partner_payment_1: 0, partner_payment_1_paid: false,
              partner_payment_2: 0, partner_payment_2_paid: false,
              partner_payment_3: 0, partner_payment_3_paid: false,
              customer_deposit: 0, customer_deposit_paid: false,
              customer_final_payment: clientPrice + accessSurcharge, customer_final_paid: false,
              owner_id: profile?.id,
              owner_name: profile?.full_name,
              job_type: data.job_type ?? "fixed",
              hourly_client_rate: data.hourly_client_rate ?? null,
              hourly_partner_rate: data.hourly_partner_rate ?? null,
              billed_hours: data.billed_hours ?? null,
            });
            await Promise.all([
              updateRequestStatus(convertToJobOpen.id, "converted_to_job", { enrich: false }),
              logAudit({
                entityType: "job", entityId: job.id, entityRef: job.reference,
                action: "created", metadata: { from_request: convertToJobOpen.reference },
                userId: profile?.id, userName: profile?.full_name,
              }),
            ]);
            setConvertToJobOpen(null);
            refreshSilent();
            void loadCounts();
            toast.success(`Job ${job.reference} created`);
            router.push(`/jobs?jobId=${job.id}`);
            trackUiPerf("requests.convert_to_job_ms", performance.now() - perfStart, { hasPartner: Boolean(data.partner_id) });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to convert to job");
          }
        }}
      />

      <CreateRequestModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        catalogServices={catalogServices}
      />
      <ExportCsvModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        allFields={requestAllFields}
        visibleFields={requestVisibleFields}
        onConfirm={handleExportFullCsv}
      />
    </PageTransition>
  );
}

function serviceRequestToClientAddressValue(req: ServiceRequest): ClientAndAddressValue {
  return {
    client_id: req.client_id,
    client_address_id: req.client_address_id,
    client_name: req.client_name ?? "",
    client_email: req.client_email ?? undefined,
    property_address: req.property_address ?? "",
  };
}

/** Single line for invite list: primary `trade`, else first `trades[]` entry. */
function partnerPrimaryTradeDisplay(p: Partner): string {
  const single = (p.trade ?? "").trim();
  if (single) return single;
  const first = (p.trades ?? []).find((t): t is string => typeof t === "string" && t.trim().length > 0);
  return first?.trim() || "—";
}

/** Persist a typed-only address (no saved row yet) so quote insert gets a valid client_address_id. */
async function ensureClientAddressForQuote(ca: ClientAndAddressValue): Promise<ClientAndAddressValue> {
  const cid = ca.client_id;
  const line = ca.property_address?.trim();
  if (!cid || !line) return ca;
  if (ca.client_address_id && isUuid(String(ca.client_address_id))) return ca;
  const existing = await listAddressesByClient(cid);
  const created = await createClientAddress({
    client_id: cid,
    address: line,
    country: "gb",
    is_default: existing.length === 0,
  });
  return { ...ca, client_address_id: created.id, property_address: line };
}

function InvitePartnerToQuote({
  request, onClose, onDone, loadPartners,
}: {
  request: ServiceRequest | null;
  onClose: () => void;
  loadPartners: () => Promise<Partner[]>;
  onDone: (
    req: ServiceRequest,
    partnerIds: string[],
    sendMethod: string,
    clientAddress: ClientAndAddressValue,
    invitePhotoFiles: File[]
  ) => void | Promise<void>;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendMethod, setSendMethod] = useState<"email" | "app" | "both">("both");
  const [searchTerm, setSearchTerm] = useState("");
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [invitePhotos, setInvitePhotos] = useState<File[]>([]);
  const [invitePhotoPreviews, setInvitePhotoPreviews] = useState<string[]>([]);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!request?.id) return;
    void import("@/services/quote-invite-images");
  }, [request?.id]);

  useEffect(() => {
    if (!request?.id) {
      queueMicrotask(() => {
        setPartners([]);
        setPartnersLoading(false);
      });
      return;
    }
    const serviceType = request.service_type;
    let cancelled = false;
    queueMicrotask(() => {
      setSearchTerm("");
      setSummaryExpanded(true);
      setPartners([]);
      setClientAddress(serviceRequestToClientAddressValue(request));
      setInvitePhotos([]);
      setInvitePhotoPreviews((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
      setPartnersLoading(true);
      loadPartners()
        .then((list) => {
          if (cancelled) return;
          setPartners(list);
          const matched = list.filter(
            (p) => isPartnerEligibleForWork(p) && safePartnerMatchesTypeOfWork(p, serviceType),
          );
          setSelectedIds(new Set(matched.map((p) => p.id)));
        })
        .catch((err) => {
          console.error("[InvitePartnerToQuote] listPartnersAll", err);
          if (!cancelled) {
            toast.error("Could not load partners. Try again.");
            setPartners([]);
          }
        })
        .finally(() => {
          if (!cancelled) setPartnersLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [request?.id, request?.service_type, loadPartners]);

  const summaryImageUrls = useMemo(
    () => mergeImageUrlLists(normalizeJsonImageArray(request?.images)),
    [request?.images],
  );

  const filtered = useMemo(() => {
    if (!request) return [];
    const q = searchTerm.trim().toLowerCase();
    const base = partners.filter((p) => {
      if (!isPartnerEligibleForWork(p)) return false;
      if (!q) return true;
      const name = (p.company_name ?? "").toLowerCase();
      const trade = (p.trade ?? "").toLowerCase();
      const tradesFlat = (p.trades ?? []).filter((t): t is string => typeof t === "string").join(" ").toLowerCase();
      const loc = (p.location ?? "").toLowerCase();
      return name.includes(q) || trade.includes(q) || tradesFlat.includes(q) || loc.includes(q);
    });
    return [...base].sort((a, b) => {
      const aMatch = safePartnerMatchesTypeOfWork(a, request.service_type);
      const bMatch = safePartnerMatchesTypeOfWork(b, request.service_type);
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      return (a.company_name ?? "").localeCompare(b.company_name ?? "");
    });
  }, [request, partners, searchTerm]);

  const serviceRelated = useMemo(() => {
    if (!request) return [];
    return filtered.filter((p) => safePartnerMatchesTypeOfWork(p, request.service_type));
  }, [request, filtered]);

  const others = useMemo(() => {
    if (!request) return [];
    return filtered.filter((p) => !safePartnerMatchesTypeOfWork(p, request.service_type));
  }, [request, filtered]);

  const matchIdSet = useMemo(() => new Set(serviceRelated.map((p) => p.id)), [serviceRelated]);

  if (!request) return null;

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Invite partners"
      subtitle={`${request.reference} — ${request.service_type}`}
      size="lg"
      className="w-[min(100%,calc(100vw-1.5rem))] max-w-3xl"
    >
      <div className="p-3 sm:p-6 flex flex-col gap-3 sm:gap-4 min-h-0">
        <div className="shrink-0 space-y-2">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Client and address *</p>
          <ClientAddressPicker
            value={clientAddress}
            onChange={setClientAddress}
            labelClient="Client *"
            labelAddress="Property address *"
            lockClient={!!request.client_id}
          />
        </div>

        <div className="shrink-0 rounded-xl border border-border-light bg-surface-hover/80 overflow-hidden">
          <button
            type="button"
            onClick={() => setSummaryExpanded((v) => !v)}
            aria-expanded={summaryExpanded}
            className="flex w-full shrink-0 items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3 text-left hover:bg-surface-hover/90 transition-colors"
          >
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Invite summary</span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", summaryExpanded && "rotate-180")}
              aria-hidden
            />
          </button>
          {summaryExpanded && (
            <div className="px-3 pb-3 pt-2 sm:px-5 sm:pb-4 sm:pt-3 space-y-3 border-t border-border-light">
              <p className="text-sm text-text-primary break-words">
                <span className="text-text-tertiary text-xs font-medium">Type of work · </span>
                {request.service_type?.trim() || "—"}
              </p>
              <p className="text-sm text-text-primary break-words">
                <span className="text-text-tertiary text-xs font-medium">Address · </span>
                {request.property_address?.trim() || "—"}
              </p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap break-words max-w-full">
                <span className="text-text-tertiary text-xs font-medium block mb-0.5">Service description</span>
                {request.description?.trim() || "—"}
              </p>
              <div className="min-w-0">
                <span className="text-text-tertiary text-xs font-medium block mb-1.5">Photos (request + extra for invite)</span>
                {summaryImageUrls.length === 0 ? (
                  <p className="text-xs text-text-tertiary mb-2">No photos on the request yet — add below for this invite.</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-3">
                    {summaryImageUrls.map((url, i) => (
                      <a
                        key={`${url}-${i}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square rounded-lg border border-border-light overflow-hidden bg-card hover:ring-2 hover:ring-primary/30 transition-shadow min-w-0"
                        title="Open full size"
                      >
                        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-text-tertiary mb-2">Up to 8 extra images (5 MB each) — merged with request photos for the partner app.</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-text-primary cursor-pointer hover:border-primary/30">
                    <ImagePlus className="h-3.5 w-3.5" />
                    Add photos
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      className="sr-only"
                      disabled={invitePhotos.length >= 8}
                      onChange={(e) => {
                        const list = e.target.files;
                        if (!list?.length) return;
                        const next = [...invitePhotos, ...Array.from(list)].slice(0, 8);
                        setInvitePhotos(next);
                        setInvitePhotoPreviews((prev) => {
                          prev.forEach((u) => URL.revokeObjectURL(u));
                          return next.map((f) => URL.createObjectURL(f));
                        });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {invitePhotoPreviews.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2">
                    {invitePhotoPreviews.map((src, i) => (
                      <div key={src} className="relative aspect-square rounded-lg overflow-hidden border border-border-light bg-surface-hover min-w-0">
                        <img src={src} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                          onClick={() => {
                            const idx = i;
                            setInvitePhotoPreviews((prev) => {
                              const u = prev[idx];
                              if (u) URL.revokeObjectURL(u);
                              return prev.filter((_, j) => j !== idx);
                            });
                            setInvitePhotos((prev) => prev.filter((_, j) => j !== idx));
                          }}
                          aria-label="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0">
          <Input
            placeholder="Search partners by name, trade, or location…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="text-sm"
          />
        </div>

        {!partnersLoading && partners.length > 0 && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <button
              type="button"
              className="font-medium text-primary hover:underline disabled:opacity-40 disabled:pointer-events-none"
              disabled={serviceRelated.length === 0}
              onClick={() => setSelectedIds(new Set(serviceRelated.map((p) => p.id)))}
            >
              Select matched
            </button>
            <button
              type="button"
              className="font-medium text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-40 disabled:pointer-events-none"
              disabled={serviceRelated.length === 0}
              onClick={() =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  serviceRelated.forEach((p) => next.delete(p.id));
                  return next;
                })
              }
            >
              Deselect matched
            </button>
            <button type="button" className="font-medium text-text-tertiary hover:underline" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        {!partnersLoading && serviceRelated.length > 0 && (
          <p className="shrink-0 text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
            Matching “{request.service_type}” (trade / type of work) — {serviceRelated.length} partner(s)
          </p>
        )}

        <div className="space-y-2 rounded-xl border border-border-light/60 bg-surface-hover/30 p-2 sm:p-3 min-h-0">
          {!partnersLoading &&
            [...serviceRelated, ...others].map((p) => {
            if (!p.id) return null;
            const isSelected = selectedIds.has(p.id);
            const isMatch = matchIdSet.has(p.id);
            const loc = (p.location ?? "").trim() || "—";
            const requestType = (request.service_type ?? "").trim() || "—";
            const typeLine = isMatch ? partnerMatchTypeLabel(p, requestType) : partnerPrimaryTradeDisplay(p);
            return (
              <label
                key={p.id}
                className={cn(
                  "flex items-start sm:items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border cursor-pointer transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 dark:bg-primary/15 dark:border-primary/60"
                    : isMatch
                      ? "border-amber-200 bg-amber-50/40 hover:border-primary/30 dark:border-amber-500/45 dark:bg-amber-950/30 dark:hover:border-amber-400/50 dark:hover:bg-amber-950/40"
                      : "border-border hover:border-primary/30 hover:bg-surface-hover dark:border-border dark:hover:bg-surface-tertiary/80",
                )}
              >
                <input type="checkbox" checked={isSelected} onChange={(e) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(p.id); else next.delete(p.id);
                    return next;
                  });
                }} className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20" />
                <Avatar name={p.company_name} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary break-words">{p.company_name}</p>
                  <p className="text-xs font-medium text-text-secondary dark:text-neutral-200 break-words">
                    {typeLine}
                    <span className="font-normal text-text-tertiary dark:text-neutral-400"> · {loc}</span>
                  </p>
                </div>
                {isMatch && <Badge variant="warning" size="sm" className="shrink-0 self-start sm:self-center">Match</Badge>}
              </label>
            );
          })}
          {partnersLoading && (
            <p className="text-sm text-text-tertiary text-center py-6">Loading partners…</p>
          )}
          {!partnersLoading && partners.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-6">No partners returned — check your connection or try again.</p>
          )}
          {!partnersLoading && partners.length > 0 && filtered.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-6">No partners match this search — clear the search to see all.</p>
          )}
        </div>

        <div className="shrink-0 pt-3 sm:pt-4 border-t border-border-light space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1 block">Send invite via</label>
            <div className="flex flex-wrap gap-2">
              {(["email", "app", "both"] as const).map((m) => (
                <button key={m} onClick={() => setSendMethod(m)} className={`flex-1 min-w-[5.5rem] sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${sendMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-text-tertiary hover:text-text-primary"}`}>
                  {m === "both" ? "Email + App" : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-tertiary">
              {selectedIds.size === 0 ? "Please select at least one partner" : `${selectedIds.size} partner(s) selected`}
            </p>
            <Button
              size="sm"
              className="w-full sm:w-auto shrink-0"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={inviting}
              disabled={
                inviting || selectedIds.size === 0 || !clientAddress.client_id || !clientAddress.property_address
              }
              onClick={async () => {
                setInviting(true);
                try {
                  await Promise.resolve(
                    onDone(request, Array.from(selectedIds), sendMethod, clientAddress, invitePhotos),
                  );
                } finally {
                  setInviting(false);
                }
              }}
            >
              Invite partners
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ManualQuoteModal({
  request,
  catalogServices,
  onClose,
  onDone,
}: {
  request: ServiceRequest | null;
  catalogServices: CatalogService[];
  onClose: () => void;
  onDone: (
    req: ServiceRequest,
    lineItems: { description: string; quantity: number; unitPrice: number; vat: boolean }[],
    clientAddress: ClientAndAddressValue,
    catalogServiceId?: string | null
  ) => void;
}) {
  const [lineItems, setLineItems] = useState([{ description: "", quantity: "1", unitPrice: "0", vat: false }]);
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [vatPercent, setVatPercent] = useState(20);
  const [catalogTemplateId, setCatalogTemplateId] = useState("");

  useEffect(() => {
    if (!request) return;
    queueMicrotask(() => {
      setCatalogTemplateId(request.catalog_service_id ?? "");
      setLineItems([{ description: request.service_type, quantity: "1", unitPrice: String(request.estimated_value ?? 0), vat: false }]);
      setClientAddress(serviceRequestToClientAddressValue(request));
    });
    void Promise.resolve(
      getSupabase().from("company_settings").select("vat_percent").limit(1).single(),
    ).then(({ data }) => {
      setVatPercent(data?.vat_percent != null ? Number(data.vat_percent) : 20);
    }).catch(() => setVatPercent(20));
  }, [request]);

  if (!request) return null;

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lineSubtotal = (li: { quantity: string; unitPrice: string }) => (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0);
  const lineVat = (li: { quantity: string; unitPrice: string; vat: boolean }) => li.vat ? lineSubtotal(li) * (vatPercent / 100) : 0;
  const lineTotal = (li: { quantity: string; unitPrice: string; vat: boolean }) => lineSubtotal(li) + lineVat(li);

  const subtotalAll = lineItems.reduce((s, li) => s + lineSubtotal(li), 0);
  const vatAll = lineItems.reduce((s, li) => s + lineVat(li), 0);
  const totalAll = subtotalAll + vatAll;

  return (
    <Modal open={!!request} onClose={onClose} title="Manual quote" subtitle={`${request.reference} — ${request.service_type}`} size="lg">
      <div className="p-6 space-y-4">
        <div>
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Client and address *</p>
          <ClientAddressPicker
            value={clientAddress}
            onChange={setClientAddress}
            labelClient="Client *"
            labelAddress="Property address *"
            lockClient={!!request.client_id}
          />
        </div>
        <ServiceCatalogSelect
          label="Apply catalog template to first line (optional)"
          catalog={catalogServices}
          value={catalogTemplateId}
          onChange={(id, svc) => {
            setCatalogTemplateId(id);
            if (!svc) return;
            const line = lineItemDefaultsFromCatalog(svc);
            setLineItems((prev) => {
              const rest = prev.slice(1);
              return [{ description: line.description, quantity: String(line.quantity), unitPrice: String(line.unitPrice), vat: prev[0]?.vat ?? false }, ...rest];
            });
          }}
        />
        <p className="text-[10px] text-text-tertiary -mt-2">Edit quantities and prices below — template is only a starting point.</p>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Quote items</label>
            <button type="button" onClick={() => setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0", vat: false }])} className="text-[11px] font-medium text-primary hover:underline">+ Add Item</button>
          </div>
          <div className="space-y-2">
            {lineItems.map((item, idx) => (
              <div key={idx} className="p-3 bg-surface-hover rounded-xl">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1.5">
                    <Input placeholder="Service / Description" value={item.description} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], description: e.target.value }; setLineItems(n); }} className="text-xs" />
                    <div className="flex gap-2 items-center">
                      <Input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], quantity: e.target.value }; setLineItems(n); }} className="text-xs w-20" />
                      <Input type="number" placeholder="Unit price" value={item.unitPrice} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], unitPrice: e.target.value }; setLineItems(n); }} className="text-xs flex-1" />
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <input type="checkbox" checked={item.vat} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], vat: e.target.checked }; setLineItems(n); }} className="h-3.5 w-3.5 rounded border-border" />
                        VAT ({vatPercent}%)
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 pt-1 text-right">
                    <span className="text-xs text-text-secondary">Subtotal: £{fmt(lineSubtotal(item))}</span>
                    {item.vat && <span className="text-xs text-text-secondary">VAT: £{fmt(lineVat(item))}</span>}
                    <span className="text-xs font-semibold text-text-primary">Line total: £{fmt(lineTotal(item))}</span>
                    {lineItems.length > 1 && (
                      <button onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-red-500 text-xs mt-1">Remove</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border-light space-y-1 flex flex-col items-end">
            <span className="text-xs text-text-secondary">Subtotal: £{fmt(subtotalAll)}</span>
            {vatAll > 0 && <span className="text-xs text-text-secondary">VAT: £{fmt(vatAll)}</span>}
            <span className="text-sm font-bold text-text-primary">Total: £{fmt(totalAll)}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!clientAddress.client_id || !clientAddress.property_address?.trim()) {
                toast.error("Select a client from the list (click the name) and choose or add a property address.");
                return;
              }
              const items = lineItems.map((li) => {
                const qty = Number(li.quantity) || 1;
                const baseUnit = Number(li.unitPrice) || 0;
                const unitPriceInclVat = li.vat ? baseUnit * (1 + vatPercent / 100) : baseUnit;
                return { description: li.description, quantity: qty, unitPrice: unitPriceInclVat, vat: li.vat };
              });
              const cid = catalogTemplateId.trim();
              onDone(request, items, clientAddress, cid && isUuid(cid) ? cid : null);
            }}
          >
            Create quote
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConvertToJobModal({
  request, catalogServices, onClose, onConvert, loadPartners,
}: {
  request: ServiceRequest | null;
  catalogServices: CatalogService[];
  onClose: () => void;
  loadPartners: () => Promise<Partner[]>;
  onConvert: (data: {
    client_id?: string; client_address_id?: string; client_name: string; property_address: string;
    partner_id?: string; partner_name?: string; scope?: string; notes?: string; internal_notes?: string;
    assignment_mode?: "manual" | "auto";
    catalog_service_id?: string | null;
    in_ccz?: boolean | null;
    has_free_parking?: boolean | null;
    client_price?: number; partner_cost?: number; total_phases?: number; job_type?: "fixed" | "hourly";
    hourly_client_rate?: number | null; hourly_partner_rate?: number | null; billed_hours?: number | null;
    scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null
  }) => void;
}) {
  const [form, setForm] = useState({
    partner_id: "", scope: "", notes: "", internal_notes: "", client_price: "", partner_cost: "", job_type: "fixed",
    catalog_service_id: "", hourly_client_rate: "", hourly_partner_rate: "", billed_hours: "1",
    assignment_mode: "manual",
    in_ccz: false, has_free_parking: true,
    scheduled_date: "", arrival_from: "09:00", arrival_window_mins: "180", expected_finish_date: "",
  });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerSearch, setPartnerSearch] = useState("");

  useEffect(() => {
    if (!request) {
      queueMicrotask(() => setPartners([]));
      return;
    }
    queueMicrotask(() => {
      const addrVal = serviceRequestToClientAddressValue(request);
      const cczOk = isLikelyCczAddress(addrVal.property_address);
      setForm({
        partner_id: "", scope: "", notes: "", internal_notes: "",
        client_price: String(request.estimated_value ?? 0), partner_cost: "", job_type: "fixed",
        catalog_service_id: request.catalog_service_id ?? "",
        hourly_client_rate: "",
        hourly_partner_rate: "",
        billed_hours: "1",
        assignment_mode: "manual",
        in_ccz: Boolean(request.in_ccz) && cczOk,
        has_free_parking: request.has_free_parking ?? true,
        scheduled_date: "", arrival_from: "09:00", arrival_window_mins: "180", expected_finish_date: "",
      });
      setClientAddress(addrVal);
    });
    loadPartners()
      .then(setPartners)
      .catch(() => {
        toast.error("Could not load partners");
        setPartners([]);
      });
  }, [request?.id, loadPartners]);

  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const selectedPartner = partners.find((p) => p.id === form.partner_id);
  const selectedCatalogService = catalogServices.find((s) => s.id === form.catalog_service_id);
  const targetWorkType = (selectedCatalogService?.name ?? request?.service_type ?? "").trim();
  const filteredPartners = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    const base = partners.filter((p) => {
      if (!isPartnerEligibleForWork(p)) return false;
      if (!q) return true;
      const name = (p.company_name ?? p.contact_name ?? "").toLowerCase();
      const trade = (p.trade ?? "").toLowerCase();
      const location = (p.location ?? "").toLowerCase();
      const tradesFlat = (p.trades ?? []).join(" ").toLowerCase();
      return name.includes(q) || trade.includes(q) || location.includes(q) || tradesFlat.includes(q);
    });
    return [...base].sort((a, b) => {
      const aMatch = targetWorkType ? safePartnerMatchesTypeOfWork(a, targetWorkType) : false;
      const bMatch = targetWorkType ? safePartnerMatchesTypeOfWork(b, targetWorkType) : false;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      return (a.company_name ?? a.contact_name ?? "").localeCompare(b.company_name ?? b.contact_name ?? "");
    });
  }, [partnerSearch, partners, targetWorkType]);

  useEffect(() => {
    const eligible = isLikelyCczAddress(clientAddress.property_address);
    queueMicrotask(() => {
      setForm((prev) => {
        if (!eligible && prev.in_ccz) return { ...prev, in_ccz: false };
        return prev;
      });
    });
  }, [clientAddress.property_address]);

  useEffect(() => {
    if (!request || form.job_type !== "hourly" || !selectedCatalogService) return;
    const hrs = Math.max(1, Number(form.billed_hours) || Number(selectedCatalogService.default_hours) || 1);
    const clientRate = Number(form.hourly_client_rate) || Number(selectedCatalogService.hourly_rate) || 0;
    const partnerRate = Number(form.hourly_partner_rate) || partnerHourlyRateFromCatalogBundle(selectedCatalogService.partner_cost, selectedCatalogService.default_hours);
    const totals = computeHourlyTotals({
      elapsedSeconds: hrs * 3600,
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
    queueMicrotask(() =>
      setForm((prev) => ({
        ...prev,
        client_price: String(totals.clientTotal),
        partner_cost: String(totals.partnerTotal),
        hourly_client_rate: String(clientRate || ""),
        hourly_partner_rate: String(partnerRate || ""),
        billed_hours: String(hrs),
      })),
    );
  }, [request?.id, form.job_type, form.catalog_service_id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    if (!clientAddress.client_id || !clientAddress.property_address?.trim()) {
      toast.error("Select a client from the list (click the name) and choose or add a property address.");
      return;
    }
    const isAutoAssign = form.assignment_mode === "auto";
    const sched = resolveJobModalSchedule({
      scheduled_date: form.scheduled_date,
      arrival_from: form.arrival_from,
      arrival_window_mins: form.arrival_window_mins,
      hasPartner: !isAutoAssign && !!form.partner_id,
    });
    if (!sched.ok) {
      toast.error(sched.error);
      return;
    }
    const scheduled_date = sched.scheduled_date;
    const scheduled_start_at = sched.scheduled_start_at;
    const scheduled_end_at = sched.scheduled_end_at;
    let scheduled_finish_date: string | null = null;
    if (scheduled_date) {
      const efRaw = form.expected_finish_date?.trim() ?? "";
      const expected_finish = parseIsoDateOnly(efRaw);
      if (efRaw && !expected_finish) {
        toast.error("Expected finish must be a complete date (YYYY-MM-DD).");
        return;
      }
      if (!expected_finish) {
        toast.error("Expected finish date is required when a start date is set.");
        return;
      }
      if (expected_finish < scheduled_date) {
        toast.error("Expected finish date must be on or after the scheduled date.");
        return;
      }
      scheduled_finish_date = expected_finish;
    } else if (form.expected_finish_date?.trim()) {
      toast.error("Clear expected finish or set a scheduled date.");
      return;
    }
    if (form.partner_id) {
      const block = getPartnerAssignmentBlockReason({
        property_address: clientAddress.property_address ?? "",
        scope: form.scope,
        scheduled_date,
        scheduled_start_at,
        partner_id: form.partner_id,
        partner_ids: [],
      });
      if (block) {
        toast.error(block);
        return;
      }
    }
    if (form.job_type === "hourly" && !form.catalog_service_id) {
      toast.error("For hourly jobs, select a Call Out type from Services.");
      return;
    }
    onConvert({
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      property_address: clientAddress.property_address,
      assignment_mode: form.assignment_mode as "manual" | "auto",
      partner_id: isAutoAssign ? undefined : (form.partner_id || undefined),
      partner_name: isAutoAssign ? undefined : selectedPartner?.company_name,
      scope: form.scope || undefined,
      notes: form.notes || undefined,
      internal_notes: form.internal_notes || undefined,
      catalog_service_id: form.catalog_service_id || null,
      in_ccz: effectiveInCczForAddress(form.in_ccz, clientAddress.property_address),
      has_free_parking: form.has_free_parking,
      client_price: Number(form.client_price) || 0,
      partner_cost: Number(form.partner_cost) || 0,
      total_phases: normalizeTotalPhases(2),
      job_type: form.job_type as "fixed" | "hourly",
      hourly_client_rate: form.job_type === "hourly" ? (Number(form.hourly_client_rate) || 0) : null,
      hourly_partner_rate: form.job_type === "hourly" ? (Number(form.hourly_partner_rate) || 0) : null,
      billed_hours: form.job_type === "hourly" ? (Math.max(1, Number(form.billed_hours) || 1)) : null,
      scheduled_date,
      scheduled_start_at,
      scheduled_end_at,
      scheduled_finish_date,
    });
  };

  if (!request) return null;
  const requiredFieldClass = "border-red-300 focus:border-red-400 focus:ring-red-100 hover:border-red-300";
  const cczEligibleConvert = isLikelyCczAddress(clientAddress.property_address);
  const inCczPreviewConvert = cczEligibleConvert && form.in_ccz;
  const accessSurchargePreview = computeAccessSurcharge({ inCcz: inCczPreviewConvert, hasFreeParking: form.has_free_parking });
  const hourlyPreview = computeHourlyTotals({
    elapsedSeconds: Math.max(1, Number(form.billed_hours) || 1) * 3600,
    clientHourlyRate: Math.max(0, Number(form.hourly_client_rate) || 0),
    partnerHourlyRate: Math.max(0, Number(form.hourly_partner_rate) || 0),
  });
  const hourlyMarginPct = hourlyPreview.clientTotal > 0
    ? Math.round(((hourlyPreview.clientTotal - hourlyPreview.partnerTotal) / hourlyPreview.clientTotal) * 1000) / 10
    : 0;

  const hint = (text: string) => (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label={text}
        className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full text-[9px] font-bold leading-none cursor-help outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        style={{ background: "#F1F1F3", color: "#6B6B70" }}
      >
        !
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute top-full left-0 z-[60] mt-1 w-60 whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1.5 text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
  const labelNavy = "flex items-center gap-[6px] text-[10px] font-medium uppercase";
  const labelStyle = { color: "#020040", letterSpacing: "0.6px" } as const;

  return (
    <Modal open={!!request} onClose={onClose} title="Create job" subtitle={`${request.reference} · Direct creation`} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="px-5 sm:px-6 pt-5 pb-4 space-y-[14px]">
          {/* Job type */}
          <div>
            <label className={labelNavy} style={labelStyle}>Job type</label>
            <Select
              value={form.job_type}
              onChange={(e) => update("job_type", e.target.value)}
              className={cn("mt-[6px]", requiredFieldClass)}
              options={[
                { value: "fixed", label: "Fixed" },
                { value: "hourly", label: "Hourly" },
              ]}
            />
          </div>

          {form.job_type === "hourly" && (
            <div>
              <label className={labelNavy} style={labelStyle}>
                Call-out type <span style={{ color: "#ED4B00" }}>*</span>
                {hint("Loads default hours, client rate and partner rate from the Services catalog. You can still tweak the partner rate and billed hours below.")}
              </label>
              <ServiceCatalogSelect
                emptyOptionLabel="Select from Services…"
                catalog={catalogServices}
                value={form.catalog_service_id}
                className={cn("mt-[6px]", requiredFieldClass)}
                onChange={(id, service) => {
                  const hrs = Math.max(1, Number(service?.default_hours) || 1);
                  const clientRate = Number(service?.hourly_rate) || 0;
                  const partnerRate = partnerHourlyRateFromCatalogBundle(service?.partner_cost, service?.default_hours);
                  const totals = computeHourlyTotals({
                    elapsedSeconds: hrs * 3600,
                    clientHourlyRate: clientRate,
                    partnerHourlyRate: partnerRate,
                  });
                  setForm((prev) => ({
                    ...prev,
                    catalog_service_id: id,
                    scope: service?.default_description?.trim() || prev.scope,
                    hourly_client_rate: String(clientRate || ""),
                    hourly_partner_rate: String(partnerRate || ""),
                    billed_hours: String(hrs),
                    client_price: String(totals.clientTotal),
                    partner_cost: String(totals.partnerTotal),
                  }));
                }}
              />
            </div>
          )}

          {/* Client & address */}
          <div
            className="rounded-[10px] p-[14px]"
            style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
          >
            <p className={labelNavy + " mb-[8px]"} style={labelStyle}>
              Client &amp; address <span style={{ color: "#ED4B00" }}>*</span>
            </p>
            <ClientAddressPicker value={clientAddress} onChange={setClientAddress} lockClient={!!request.client_id} />
          </div>

          {/* Schedule */}
          <JobModalScheduleFields
            scheduledDate={form.scheduled_date}
            arrivalFrom={form.arrival_from}
            arrivalWindowMins={form.arrival_window_mins}
            expectedFinishDate={form.expected_finish_date}
            onChange={(field, v) => update(field, v)}
            startDateRequired={form.assignment_mode === "manual" && !!form.partner_id}
            expectedFinishRequired={!!form.scheduled_date?.trim()}
            requiredFieldClassName={requiredFieldClass}
          />

          {/* Scope */}
          <div>
            <label className={labelNavy} style={labelStyle}>
              Scope of work
              {form.assignment_mode === "manual" && form.partner_id ? (
                <span style={{ color: "#ED4B00" }}>*</span>
              ) : null}
              {hint("Required when you assign a partner. Tells them exactly what the job covers.")}
            </label>
            <textarea
              value={form.scope}
              onChange={(e) => update("scope", e.target.value)}
              rows={3}
              placeholder="Describe the work the partner will do…"
              className="mt-[6px] w-full rounded-[8px] px-3 py-[10px] text-[13px] outline-none resize-y min-h-[72px] focus:ring-[3px] focus:ring-[rgba(2,0,64,0.08)]"
              style={{
                border: "0.5px solid #D8D8DD",
                background: "#FFFFFF",
                color: "#020040",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
          </div>

          {request.request_kind === "work" && (
            <div
              className="rounded-[10px] p-[14px] space-y-[10px]"
              style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
            >
              <p className={labelNavy} style={labelStyle}>
                Access &amp; parking
                {hint("CCZ is only available for central London postcodes (EC1–4, WC1–2, W1, SW1, SE1). Parking fee applies when no free parking is available.")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
                <button
                  type="button"
                  disabled={!cczEligibleConvert}
                  onClick={() => cczEligibleConvert && setForm((prev) => ({ ...prev, in_ccz: !prev.in_ccz }))}
                  className={cn(
                    "text-left rounded-[8px] px-[12px] py-[10px] text-[12px] transition-colors",
                    !cczEligibleConvert && "opacity-50 cursor-not-allowed",
                  )}
                  style={
                    form.in_ccz && cczEligibleConvert
                      ? { background: "#ECFDF5", border: "0.5px solid #10B981", color: "#0F6E56" }
                      : { background: "#FFFFFF", border: "0.5px solid #D8D8DD", color: "#020040" }
                  }
                >
                  <p className="font-medium text-[12px]">
                    {inCczPreviewConvert ? "CCZ applied · +£15" : "Apply CCZ"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, has_free_parking: !prev.has_free_parking }))}
                  className="text-left rounded-[8px] px-[12px] py-[10px] text-[12px] transition-colors"
                  style={
                    !form.has_free_parking
                      ? { background: "#ECFDF5", border: "0.5px solid #10B981", color: "#0F6E56" }
                      : { background: "#FFFFFF", border: "0.5px solid #D8D8DD", color: "#020040" }
                  }
                >
                  <p className="font-medium text-[12px]">
                    {form.has_free_parking ? "Add parking fee" : "Parking fee applied · +£15"}
                  </p>
                </button>
              </div>
              <p className="text-[11px]" style={{ color: "#6B6B70" }}>
                Total access fee:{" "}
                <span className="font-semibold" style={{ color: "#020040" }}>
                  {formatCurrency(accessSurchargePreview)}
                </span>
              </p>
            </div>
          )}

          {/* Partner allocation */}
          <div
            className="rounded-[10px] p-[14px] space-y-[10px]"
            style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
          >
            <p className={labelNavy} style={labelStyle}>Partner allocation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, assignment_mode: "manual" }))}
                className="text-left rounded-[8px] px-[12px] py-[10px] text-[12px] transition-colors"
                style={
                  form.assignment_mode === "manual"
                    ? { background: "#F4F5FB", border: "0.5px solid #020040", color: "#020040" }
                    : { background: "#FFFFFF", border: "0.5px solid #D8D8DD", color: "#020040" }
                }
              >
                <p className="font-medium text-[12px]">Allocate partner</p>
                <p className="text-[11px] mt-[2px]" style={{ color: "#6B6B70" }}>Pick a specific partner now</p>
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, assignment_mode: "auto", partner_id: "" }))}
                className="text-left rounded-[8px] px-[12px] py-[10px] text-[12px] transition-colors"
                style={
                  form.assignment_mode === "auto"
                    ? { background: "#F4F5FB", border: "0.5px solid #020040", color: "#020040" }
                    : { background: "#FFFFFF", border: "0.5px solid #D8D8DD", color: "#020040" }
                }
              >
                <p className="font-medium text-[12px]">Auto assign</p>
                <p className="text-[11px] mt-[2px]" style={{ color: "#6B6B70" }}>System will assign after creation</p>
              </button>
            </div>
            {form.assignment_mode === "manual" && (
              <div className="space-y-2">
                <Input placeholder="Search partner by name, trade, or location…" value={partnerSearch} onChange={(e) => setPartnerSearch(e.target.value)} />
                <div
                  className="max-h-48 overflow-y-auto rounded-[8px] p-[6px] space-y-[6px] bg-white"
                  style={{ border: "0.5px solid #E4E4E8" }}
                >
                  <label
                    className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2 cursor-pointer transition-colors"
                    style={
                      !form.partner_id
                        ? { background: "#F4F5FB", border: "0.5px solid #020040" }
                        : { background: "#FFFFFF", border: "0.5px solid #D8D8DD" }
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium" style={{ color: "#020040" }}>No partner</p>
                      <p className="text-[11px]" style={{ color: "#6B6B70" }}>Create job without assignment</p>
                    </div>
                    <input type="radio" name="convert-partner-select" className="h-4 w-4" checked={!form.partner_id} onChange={() => update("partner_id", "")} />
                  </label>
                  {filteredPartners.map((p) => {
                    const pid = p.id;
                    if (!pid) return null;
                    const selected = form.partner_id === pid;
                    const match = targetWorkType ? safePartnerMatchesTypeOfWork(p, targetWorkType) : false;
                    const rowStyle = selected
                      ? { background: "#F4F5FB", border: "0.5px solid #020040" }
                      : match
                        ? { background: "#FFF8F3", border: "0.5px solid #F5CFB8" }
                        : { background: "#FFFFFF", border: "0.5px solid #D8D8DD" };
                    return (
                      <label
                        key={pid}
                        className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2 cursor-pointer transition-colors"
                        style={rowStyle}
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium truncate" style={{ color: "#020040" }}>
                            {p.company_name?.trim() || p.contact_name || "Partner"}
                          </p>
                          <p
                            className="text-[11px] truncate"
                            style={{ color: match && !selected ? "#993C1D" : "#6B6B70" }}
                          >
                            {(match ? partnerMatchTypeLabel(p, targetWorkType) : (p.trade ?? "—"))} · {p.location ?? "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {match ? (
                            <span
                              className="text-[10px] font-medium px-[7px] py-[2px] rounded"
                              style={{ background: "#FFF1EB", color: "#ED4B00" }}
                            >
                              Match
                            </span>
                          ) : null}
                          <input type="radio" name="convert-partner-select" className="h-4 w-4" checked={selected} onChange={() => update("partner_id", pid)} />
                        </div>
                      </label>
                    );
                  })}
                  {filteredPartners.length === 0 ? (
                    <p className="text-[11px] px-2 py-2" style={{ color: "#6B6B70" }}>
                      No partners match this search.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Pricing */}
          {form.job_type === "hourly" ? (
            <div className="space-y-[10px]">
              <div className="grid grid-cols-3 gap-[10px]">
                <div
                  className="rounded-[8px] px-3 py-2 bg-white"
                  style={{ border: "0.5px solid #E4E4E8" }}
                >
                  <p className="text-[10px] uppercase" style={{ color: "#020040", letterSpacing: "0.6px" }}>Price</p>
                  <p className="text-[14px] font-semibold" style={{ color: "#020040" }}>
                    {formatCurrency(hourlyPreview.clientTotal + accessSurchargePreview)}
                  </p>
                </div>
                <div
                  className="rounded-[8px] px-3 py-2 bg-white"
                  style={{ border: "0.5px solid #E4E4E8" }}
                >
                  <p className="text-[10px] uppercase" style={{ color: "#020040", letterSpacing: "0.6px" }}>Cost</p>
                  <p className="text-[14px] font-semibold" style={{ color: "#020040" }}>
                    {formatCurrency(hourlyPreview.partnerTotal)}
                  </p>
                </div>
                <div
                  className="rounded-[8px] px-3 py-2 bg-white"
                  style={{ border: "0.5px solid #E4E4E8" }}
                >
                  <p className="text-[10px] uppercase" style={{ color: "#020040", letterSpacing: "0.6px" }}>Margin</p>
                  <p className="text-[14px] font-semibold" style={{ color: "#020040" }}>{hourlyMarginPct}%</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelNavy} style={labelStyle}>
                    Partner hourly rate
                    {hint(`Client hourly rate is loaded from Call-out type: ${formatCurrency(Number(form.hourly_client_rate) || 0)}/h. Billing rounds up in 30-min increments from timer logs (1h minimum).`)}
                  </label>
                  <Input className="mt-[6px]" type="number" value={form.hourly_partner_rate} onChange={(e) => update("hourly_partner_rate", e.target.value)} min="0" step="0.01" />
                </div>
                <div>
                  <label className={labelNavy} style={labelStyle}>Initial billed hours</label>
                  <Input className="mt-[6px]" type="number" value={form.billed_hours} onChange={(e) => update("billed_hours", e.target.value)} min="1" step="0.5" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelNavy} style={labelStyle}>Client price</label>
                <Input className="mt-[6px]" type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} min="0" step="0.01" />
              </div>
              <div>
                <label className={labelNavy} style={labelStyle}>Partner cost</label>
                <Input className="mt-[6px]" type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} min="0" step="0.01" />
              </div>
              <div>
                <label className={labelNavy} style={labelStyle}>Materials cost</label>
                <Input className="mt-[6px]" type="number" value="0" disabled />
              </div>
            </div>
          )}

          {/* Internal notes */}
          <div>
            <label className={labelNavy} style={labelStyle}>Internal notes</label>
            <textarea
              value={form.internal_notes}
              onChange={(e) => update("internal_notes", e.target.value)}
              rows={2}
              placeholder="Not shown to the client"
              className="mt-[6px] w-full rounded-[8px] px-3 py-[10px] text-[13px] outline-none resize-none focus:ring-[3px] focus:ring-[rgba(2,0,64,0.08)]"
              style={{
                border: "0.5px solid #D8D8DD",
                background: "#FFFFFF",
                color: "#020040",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
          </div>
        </div>

        <div
          className="flex justify-end gap-[10px] px-6 py-[14px]"
          style={{ borderTop: "0.5px solid #E4E4E8", background: "#FFFFFF" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="bg-white rounded-[6px] px-[14px] py-[7px] text-[12px] font-medium cursor-pointer"
            style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#FAFAFB")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#FFFFFF")}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-[6px] text-white border-none rounded-[6px] px-[16px] py-[7px] text-[12px] font-medium cursor-pointer"
            style={{ background: "#020040" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#0a0860")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#020040")}
          >
            <Briefcase className="h-3.5 w-3.5" /> Create job
          </button>
        </div>
      </form>
    </Modal>
  );
}

const REQUEST_SOURCES: { value: ServiceRequest["source"]; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "checkatrade", label: "Checkatrade" },
  { value: "meta", label: "Meta" },
  { value: "website", label: "Website" },
  { value: "b2b", label: "B2B" },
];

const REQUEST_KIND_OPTIONS = [
  { value: "quote", label: "Quote Request" },
  { value: "work", label: "Work Request" },
] as const;

function CreateRequestModal({
  open,
  onClose,
  onCreate,
  catalogServices,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<ServiceRequest>, photoFiles?: File[]) => void | Promise<void>;
  catalogServices: CatalogService[];
}) {
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [postcode, setPostcode] = useState("");
  const [createPhotos, setCreatePhotos] = useState<File[]>([]);
  const [createPhotoPreviews, setCreatePhotoPreviews] = useState<string[]>([]);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [form, setForm] = useState({
    onsite_contact_name: "",
    client_phone: "",
    request_kind: "",
    source: "manual" as ServiceRequest["source"],
    catalog_service_id: "",
    service_type: "",
    description: "",
    priority: "medium",
    in_ccz: false,
    has_free_parking: true,
  });
  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setClientAddress({ client_name: "", property_address: "" });
      setPostcode("");
      setCreatePhotos([]);
      setCreatePhotoPreviews((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
      setForm({
        onsite_contact_name: "",
        client_phone: "",
        request_kind: "",
        source: "manual",
        catalog_service_id: "",
        service_type: "",
        description: "",
        priority: "medium",
        in_ccz: false,
        has_free_parking: true,
      });
    });
  }, [open]);

  const typeOfWorkOptions = useMemo(() => {
    const fromCatalog = catalogServices.map((c) => c.name);
    return mergeTypeOfWorkOptions([...TYPE_OF_WORK_OPTIONS, ...fromCatalog]).sort((a, b) => a.localeCompare(b));
  }, [catalogServices]);

  useEffect(() => {
    const ex = extractUkPostcode(clientAddress.property_address);
    queueMicrotask(() => {
      if (ex) setPostcode(ex);
      else if (!clientAddress.property_address.trim()) setPostcode("");
    });
  }, [clientAddress.property_address]);

  useEffect(() => {
    const eligible = isLikelyCczAddress(clientAddress.property_address);
    queueMicrotask(() => {
      setForm((prev) => {
        if (!eligible && prev.in_ccz) return { ...prev, in_ccz: false };
        return prev;
      });
    });
  }, [clientAddress.property_address]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createSubmitting) return;
    if (form.request_kind !== "work" && form.request_kind !== "quote") {
      toast.error("Request type is required.");
      return;
    }
    if (!clientAddress.client_id) {
      toast.error(
        "The client must be linked: click their name in the list, press Enter, or tab away after typing the exact name. If you only typed text without confirming, the system has no client ID."
      );
      return;
    }
    if (!clientAddress.property_address?.trim()) {
      toast.error("Select a saved address or add a full property address for this client.");
      return;
    }
    const pc = postcode.trim() || extractUkPostcode(clientAddress.property_address);
    if (!pc?.trim()) {
      toast.error("Postcode is required — include it in the property address or type it below.");
      return;
    }
    if (!form.service_type.trim()) {
      toast.error("Enter a service name (or pick a catalog template).");
      return;
    }
    if (form.request_kind === "work" && !form.catalog_service_id.trim()) {
      toast.error("For Work Request, select a Call Out type from Services.");
      return;
    }
    const cid = form.catalog_service_id.trim();
    setCreateSubmitting(true);
    try {
      await onCreate(
        {
          client_id: clientAddress.client_id,
          client_address_id: clientAddress.client_address_id,
          client_name: clientAddress.client_name,
          client_email: clientAddress.client_email ?? "",
          client_phone: form.client_phone || undefined,
          internal_info: form.onsite_contact_name.trim()
            ? `On-site contact: ${form.onsite_contact_name.trim()}${form.client_phone.trim() ? ` (${form.client_phone.trim()})` : ""}`
            : undefined,
          property_address: clientAddress.property_address,
          postcode: pc,
          source: form.source,
          catalog_service_id: cid && isUuid(cid) ? cid : null,
          service_type: form.service_type.trim(),
          description: form.description,
          priority: form.priority as ServiceRequest["priority"],
          request_kind: form.request_kind as "quote" | "work",
          in_ccz:
            form.request_kind === "work"
              ? effectiveInCczForAddress(form.in_ccz, clientAddress.property_address)
              : null,
          has_free_parking: form.request_kind === "work" ? form.has_free_parking : null,
        },
        createPhotos.length > 0 ? createPhotos : undefined,
      );
    } finally {
      setCreateSubmitting(false);
    }
  };

  const cczEligibleCreate = form.request_kind === "work" && isLikelyCczAddress(clientAddress.property_address);
  const inCczPreviewCreate = cczEligibleCreate && form.in_ccz;

  /** Small `!` hint — used to collapse explanatory copy into a tooltip beside labels. */
  const hint = (text: string) => (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label={text}
        className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full text-[9px] font-bold leading-none cursor-help outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        style={{ background: "#F1F1F3", color: "#6B6B70" }}
      >
        !
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute top-full left-0 z-[60] mt-1 w-56 whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1.5 text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );

  const labelNavy = "flex items-center gap-[6px] text-[10px] font-medium uppercase";
  const labelStyle = { color: "#020040", letterSpacing: "0.6px" } as const;
  const inputBoxStyle = {
    border: "0.5px solid #D8D8DD",
    borderRadius: "8px",
    background: "#FFFFFF",
    color: "#020040",
  } as const;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New service request"
      size="lg"
      scrollBody
    >
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="px-5 sm:px-6 pt-5 pb-4 space-y-[14px]">
          {/* 1. Request type — segmented card picker */}
          <div>
            <label className={labelNavy} style={labelStyle}>
              Request type <span style={{ color: "#ED4B00" }}>*</span>
              {hint("Work Request — fixed price / 60s confirm. Quote — survey first, same-day.")}
            </label>
            <div className="mt-[6px] grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
              {([
                { value: "work", title: "Work Request", sub: "Fixed price · 60s confirm", Icon: Wrench, accent: "#020040", bg: "#020040" },
                { value: "quote", title: "Quote", sub: "Survey first · same-day", Icon: MessageSquarePlus, accent: "#ED4B00", bg: "#FFF1EB" },
              ] as const).map(({ value, title, sub, Icon, accent, bg }) => {
                const active = form.request_kind === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({
                        ...prev,
                        request_kind: value,
                        catalog_service_id: "",
                        service_type: "",
                      }));
                    }}
                    className="text-left rounded-[10px] px-[14px] py-[12px] flex items-center gap-[12px] transition-colors"
                    style={
                      active
                        ? { background: "#FFFFFF", border: "1.5px solid #020040" }
                        : { background: "#FFFFFF", border: "0.5px solid #D8D8DD" }
                    }
                  >
                    <div
                      className="w-[36px] h-[36px] rounded-[8px] flex items-center justify-center shrink-0"
                      style={{ background: value === "work" ? bg : bg, color: value === "work" ? "#FFFFFF" : accent }}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium" style={{ color: "#020040" }}>{title}</p>
                      <p className="text-[11px]" style={{ color: "#6B6B70" }}>{sub}</p>
                    </div>
                    {active ? (
                      <span
                        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full shrink-0"
                        style={{ background: "#020040", color: "#FFFFFF" }}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Client & property — 2x2 grid inside inset */}
          <div
            className="rounded-[10px] p-[14px]"
            style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
          >
            <p className={labelNavy + " mb-[10px]"} style={labelStyle}>
              Client &amp; property <span style={{ color: "#ED4B00" }}>*</span>
              {hint("Search for an existing client or create a new one. This link is kept when you convert to quote or job.")}
            </p>
            <ClientAddressPicker
              value={clientAddress}
              onChange={setClientAddress}
              labelClient="Client *"
              labelAddress="Property address *"
              layout="grid-2"
            />
            <div className="mt-[10px] grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
              <div>
                <label className={labelNavy} style={labelStyle}>
                  Postcode <span style={{ color: "#ED4B00" }}>*</span>
                  {hint("Auto-filled from the property address — edit if needed.")}
                </label>
                <Input
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                  placeholder="SW1A 1AA"
                  className="mt-[6px]"
                />
              </div>
              <div>
                <label className={labelNavy} style={labelStyle}>Priority</label>
                <Select
                  value={form.priority}
                  onChange={(e) => update("priority", e.target.value)}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                  className="mt-[6px]"
                />
              </div>
            </div>
          </div>

          {/* 3. On-site contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div>
              <label className={labelNavy} style={labelStyle}>Name (on-site)</label>
              <Input
                value={form.onsite_contact_name}
                onChange={(e) => update("onsite_contact_name", e.target.value)}
                placeholder="Optional"
                className="mt-[6px]"
              />
            </div>
            <div>
              <label className={labelNavy} style={labelStyle}>Mobile (on-site)</label>
              <Input
                value={form.client_phone}
                onChange={(e) => update("client_phone", e.target.value)}
                placeholder="Optional"
                className="mt-[6px]"
              />
            </div>
          </div>

          {/* 4. Call-out type / Service name */}
          {form.request_kind === "work" ? (
            <div>
              <label className={labelNavy} style={labelStyle}>
                Call-out type
                {hint("Template text is loaded from Services — you can still edit the issue description below.")}
              </label>
              <Select
                value={form.catalog_service_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const svc = catalogServices.find((c) => c.id === id);
                  setForm((prev) => ({
                    ...prev,
                    catalog_service_id: id,
                    service_type: normalizeTypeOfWork(svc?.name ?? ""),
                    description: svc?.default_description?.trim() || prev.description,
                  }));
                }}
                options={[
                  { value: "", label: "Select call-out type…" },
                  ...catalogServices.map((c) => ({ value: c.id, label: c.name })),
                ]}
                className="mt-[6px]"
              />
            </div>
          ) : form.request_kind === "quote" ? (
            <div>
              <label className={labelNavy} style={labelStyle}>
                Service name <span style={{ color: "#ED4B00" }}>*</span>
              </label>
              <Select
                value={form.service_type}
                onChange={(e) => update("service_type", e.target.value)}
                options={[
                  { value: "", label: "Select type of work…" },
                  ...typeOfWorkOptions.map((name) => ({ value: name, label: name })),
                ]}
                className="mt-[6px]"
              />
            </div>
          ) : (
            <p
              className="text-[11px] leading-snug rounded-[8px] px-3 py-2 flex items-start gap-2"
              style={{ background: "#FFF8F3", border: "0.5px solid #F5CFB8", color: "#993C1D" }}
            >
              <span
                className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-full text-[9px] font-medium text-white shrink-0 mt-[1px]"
                style={{ background: "#ED4B00" }}
              >!</span>
              Select request type first.
            </p>
          )}

          {/* 5. Service description */}
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <label className={labelNavy} style={labelStyle}>
                Service description <span style={{ color: "#ED4B00" }}>*</span>
              </label>
              <span className="text-[10px]" style={{ color: "#6B6B70" }}>Visible to partner</span>
            </div>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              rows={3}
              placeholder="Describe the issue — what the client needs, access, urgency…"
              className="mt-[6px] w-full rounded-[8px] px-3 py-[10px] text-[13px] outline-none resize-none focus:ring-[3px] focus:ring-[rgba(2,0,64,0.08)]"
              style={{
                ...inputBoxStyle,
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* 6. Access & Parking — inline toggles with running total */}
          {form.request_kind === "work" && (
            <div
              className="rounded-[10px] p-[14px] flex flex-wrap items-center gap-x-[24px] gap-y-[10px]"
              style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
            >
              <button
                type="button"
                disabled={!cczEligibleCreate}
                onClick={() => cczEligibleCreate && setForm((prev) => ({ ...prev, in_ccz: !prev.in_ccz }))}
                className={cn(
                  "inline-flex items-center gap-[10px] text-[11px] font-medium uppercase",
                  !cczEligibleCreate && "opacity-50 cursor-not-allowed",
                )}
                style={{ color: "#020040", letterSpacing: "0.6px" }}
              >
                <span>CCZ</span>
                <span
                  className="relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors"
                  style={{ background: form.in_ccz && cczEligibleCreate ? "#10B981" : "#D8D8DD" }}
                >
                  <span
                    className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform"
                    style={{ transform: form.in_ccz && cczEligibleCreate ? "translateX(14px)" : "translateX(2px)" }}
                  />
                </span>
                {hint("CCZ is only available for central London postcodes (EC1–4, WC1–2, W1, SW1, SE1).")}
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, has_free_parking: !prev.has_free_parking }))}
                className="inline-flex items-center gap-[10px] text-[11px] font-medium uppercase"
                style={{ color: "#020040", letterSpacing: "0.6px" }}
              >
                <span>Parking</span>
                <span
                  className="relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors"
                  style={{ background: !form.has_free_parking ? "#10B981" : "#D8D8DD" }}
                >
                  <span
                    className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform"
                    style={{ transform: !form.has_free_parking ? "translateX(14px)" : "translateX(2px)" }}
                  />
                </span>
                {hint("Parking fee applies when the customer can't offer free parking.")}
              </button>
              <div className="ml-auto text-right">
                <p className="text-[10px] uppercase" style={{ color: "#6B6B70", letterSpacing: "0.6px" }}>
                  Total access fee
                </p>
                <p className="text-[14px] font-semibold" style={{ color: "#020040" }}>
                  {formatCurrency(computeAccessSurcharge({ inCcz: inCczPreviewCreate, hasFreeParking: form.has_free_parking }))}
                </p>
              </div>
            </div>
          )}

          {/* 7. Photos — single-line header */}
          <div
            className="rounded-[10px] p-[14px] space-y-[10px]"
            style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
          >
            <div className="flex items-center gap-[12px] flex-wrap">
              <p className={labelNavy + " flex-shrink-0"} style={labelStyle}>
                Photos
                {hint("Up to 8 images — stored on the request and carried to quotes / partner app when you convert.")}
              </p>
              <label
                className="inline-flex items-center gap-[6px] rounded-[6px] bg-white px-3 py-[6px] text-[12px] font-medium cursor-pointer"
                style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Add photos
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  disabled={createPhotos.length >= 8}
                  onChange={(e) => {
                    const list = e.target.files;
                    if (!list?.length) return;
                    const next = [...createPhotos, ...Array.from(list)].slice(0, 8);
                    setCreatePhotos(next);
                    setCreatePhotoPreviews((prev) => {
                      prev.forEach((u) => URL.revokeObjectURL(u));
                      return next.map((f) => URL.createObjectURL(f));
                    });
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="ml-auto text-[11px] tabular-nums" style={{ color: "#6B6B70" }}>
                {createPhotos.length}/8
              </span>
            </div>
            {createPhotoPreviews.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {createPhotoPreviews.map((src, i) => (
                  <div
                    key={`${src}-${i}`}
                    className="relative aspect-square rounded-[6px] overflow-hidden min-w-0"
                    style={{ border: "0.5px solid #D8D8DD" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white"
                      onClick={() => {
                        const idx = i;
                        setCreatePhotoPreviews((prev) => {
                          const u = prev[idx];
                          if (u) URL.revokeObjectURL(u);
                          return prev.filter((_, j) => j !== idx);
                        });
                        setCreatePhotos((prev) => prev.filter((_, j) => j !== idx));
                      }}
                      aria-label="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className="flex justify-end gap-[10px] px-6 py-[14px]"
          style={{ borderTop: "0.5px solid #E4E4E8", background: "#FFFFFF" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={createSubmitting}
            className="bg-white rounded-[6px] px-[14px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
            onMouseEnter={(e) => {
              if (!(e.currentTarget as HTMLButtonElement).disabled)
                (e.currentTarget as HTMLButtonElement).style.background = "#FAFAFB";
            }}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#FFFFFF")}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createSubmitting}
            className="text-white border-none rounded-[6px] px-[16px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#020040" }}
            onMouseEnter={(e) => {
              if (!(e.currentTarget as HTMLButtonElement).disabled)
                (e.currentTarget as HTMLButtonElement).style.background = "#0a0860";
            }}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#020040")}
          >
            {createSubmitting ? "Creating…" : "Create request"}
          </button>
        </div>
      </form>
    </Modal>
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
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>{label}</button>
  );
}
