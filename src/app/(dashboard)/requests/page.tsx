"use client";

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
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, MapPin, Phone, Mail, CheckCircle2, XCircle,
  ArrowRight, Briefcase, FileText, Users, Send, PenLine,
  Inbox, Percent, CalendarRange, ImagePlus, X, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import type { ServiceRequest, Quote, Partner } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listRequests, createRequest, updateRequestStatus, updateRequest, getRequest } from "@/services/requests";
import { createQuote } from "@/services/quotes";
import { createJob } from "@/services/jobs";
import { logAudit, logBulkAction } from "@/services/audit";
import { getStatusCounts, getSupabase, softDeleteById } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { useRouter } from "next/navigation";
import { listPartners, listPartnersAll } from "@/services/partners";
import { listAssignableUsers, type AssignableUser } from "@/services/profiles";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { normalizeTotalPhases } from "@/lib/job-phases";
import { getPartnerAssignmentBlockReason } from "@/lib/job-partner-assign";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { lineItemDefaultsFromCatalog } from "@/lib/catalog-service-defaults";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { cn, isUuid } from "@/lib/utils";
import { TYPE_OF_WORK_OPTIONS, mergeTypeOfWorkOptions, normalizeTypeOfWork } from "@/lib/type-of-work";
import { resolveJobModalSchedule } from "@/lib/job-modal-schedule";
import { JobModalScheduleFields } from "@/components/shared/job-modal-schedule-fields";
import { safePartnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";
import { localYmdEndIso, localYmdStartIso } from "@/lib/date-range";
import { mergeImageUrlLists, normalizeJsonImageArray } from "@/lib/request-attachment-images";

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
  return r.catalog_service_id ? "work" : "quote";
}

const serviceColors: Record<string, string> = {
  "HVAC Installation": "bg-blue-50 dark:bg-blue-950/30 text-blue-700 ring-blue-200/50",
  "HVAC Maintenance": "bg-blue-50 dark:bg-blue-950/30 text-blue-700 ring-blue-200/50",
  Electrical: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 ring-purple-200/50",
  Plumbing: "bg-teal-50 dark:bg-teal-950/30 text-teal-700 ring-teal-200/50",
  Painting: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 ring-amber-200/50",
  Carpentry: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 ring-emerald-200/50",
  "General Maintenance": "bg-surface-tertiary text-text-primary ring-border/50",
};

export default function RequestsPage() {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);

  // Convert to Quote flow
  const [convertChoiceOpen, setConvertChoiceOpen] = useState<ServiceRequest | null>(null);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState<ServiceRequest | null>(null);
  const [manualQuoteOpen, setManualQuoteOpen] = useState<ServiceRequest | null>(null);
  const [convertToJobOpen, setConvertToJobOpen] = useState<ServiceRequest | null>(null);

  const { profile } = useProfile();
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
      return true;
    });
  }, [data, filterPriority, filterService]);

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

  useEffect(() => { setDrawerTab("details"); }, [selectedRequest?.id]);
  useEffect(() => {
    setPropertyAddressEditing(false);
  }, [selectedRequest?.id]);
  useEffect(() => {
    if (!selectedRequest) return;
    setDrawerFields({
      property_address: selectedRequest.property_address ?? "",
      service_type: selectedRequest.service_type ?? "",
      description: selectedRequest.description ?? "",
      catalog_service_id: selectedRequest.catalog_service_id ?? "",
    });
  }, [
    selectedRequest?.id,
    selectedRequest?.property_address,
    selectedRequest?.service_type,
    selectedRequest?.description,
    selectedRequest?.catalog_service_id,
  ]);

  useEffect(() => {
    if (!selectedRequest) {
      setRequestImageUrls([]);
      return;
    }
    setRequestImageUrls(normalizeJsonImageArray(selectedRequest.images));
  }, [selectedRequest?.id, selectedRequest?.updated_at, selectedRequest?.images]);

  const serviceFilterOptions = useMemo(() => {
    const legacy = [
      "HVAC Installation",
      "HVAC Maintenance",
      "Electrical",
      "Plumbing",
      "Painting",
      "Carpentry",
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
    } catch {
      toast.error("Failed to update request");
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

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${selectedIds.size} selected requests permanently?`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("service_requests").delete().in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} requests deleted`);
      setSelectedIds(new Set());
      refreshSilent();
      loadCounts();
    } catch {
      toast.error("Failed to delete requests");
    }
  }, [selectedIds, refreshSilent, loadCounts]);

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
      try {
        const isManualSource = (formData.source ?? "manual") === "manual";
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
        });
        await logAudit({
          entityType: "request", entityId: result.id, entityRef: result.reference,
          action: "created", userId: profile?.id, userName: profile?.full_name,
        });
        if (photoFiles?.length) {
          const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
          const urls = await uploadQuoteInviteImages(photoFiles, result.id);
          await updateRequest(result.id, { images: urls });
        }
        setCreateOpen(false);
        if (isManualSource) {
          setStatus("approved");
          const refreshed = await getRequest(result.id);
          setSelectedRequest(refreshed ?? result);
        }
        refresh();
        void loadCounts();
        toast.success("Request created successfully");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create request");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name, setStatus]
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

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Requests" subtitle="Manage incoming service requests and leads.">
          <div className="relative flex items-center gap-2" ref={filterRef}>
            <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>Filter</Button>
            {(filterPriority !== "all" || filterService !== "all" || dateFrom || dateTo) && (
              <span className="text-[10px] font-medium text-primary">Active</span>
            )}
            {filterOpen && (
              <div className="absolute top-full right-0 mt-1 w-[min(100vw-2rem,18rem)] rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                  <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                  Created date
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-text-tertiary mb-1">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-full h-8 rounded-lg border border-border bg-card text-xs text-text-primary px-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-text-tertiary mb-1">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="w-full h-8 rounded-lg border border-border bg-card text-xs text-text-primary px-2"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-text-tertiary leading-snug">Filters the list and KPI counts by request creation date (inclusive).</p>
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setFilterPriority("all");
                    setFilterService("all");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Request</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          <KpiCard
            className="min-h-[128px] h-full"
            title="New requests"
            value={requestKpis.newReq}
            format="number"
            icon={Inbox}
            accent="blue"
            description="Awaiting triage"
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
                <BulkBtn label="Delete" onClick={handleBulkDelete} variant="danger" />
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

      {/* Convert to Quote: Choice Modal - Invite Partner or Add Manually */}
      <Modal open={!!convertChoiceOpen} onClose={() => setConvertChoiceOpen(null)} title="Convert to Quote" subtitle="How would you like to create this quote?">
        <div className="p-6 space-y-4">
          <button
            onClick={() => {
              const req = convertChoiceOpen;
              setConvertChoiceOpen(null);
              setInvitePartnerOpen(req ? (data.find((r) => r.id === req.id) ?? req) : null);
            }}
            className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
                <Users className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary group-hover:text-primary">Invite Partner</p>
                <p className="text-xs text-text-tertiary mt-0.5">Partners matching the type of work are pre-selected. Send invite via email, app, or both.</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => {
              const req = convertChoiceOpen;
              setConvertChoiceOpen(null);
              setManualQuoteOpen(req ? (data.find((r) => r.id === req.id) ?? req) : null);
            }}
            className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                <PenLine className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary group-hover:text-primary">Manual Quote</p>
                <p className="text-xs text-text-tertiary mt-0.5">Enter quote lines (service, quantity, unit price, VAT). Opens the quote on Review &amp; send.</p>
              </div>
            </div>
          </button>
        </div>
      </Modal>

      {/* Invite Partner Modal */}
      <InvitePartnerToQuote
        request={invitePartnerOpen}
        onClose={() => setInvitePartnerOpen(null)}
        onDone={async (req, partnerIds, sendMethod, clientAddress, invitePhotoFiles) => {
          try {
            if (!clientAddress?.client_id || !clientAddress?.property_address?.trim()) {
              toast.error("Select a client from the list (click the name) and choose or add a property address.");
              return;
            }
            const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
            const freshReq = await getRequest(req.id).catch(() => null);
            const fromRequest = normalizeJsonImageArray(freshReq?.images ?? req.images);
            const uploaded = invitePhotoFiles?.length ? await uploadQuoteInviteImages(invitePhotoFiles, req.id) : [];
            const mergedQuoteImages = mergeImageUrlLists(fromRequest, uploaded);
            const scopeFromRequest = [req.description?.trim(), req.scope?.trim()].filter(Boolean).join("\n\n") || undefined;
            const quote = await createQuote({
              title: `${req.service_type} — ${clientAddress.client_name}`,
              client_id: clientAddress.client_id,
              client_address_id: clientAddress.client_address_id,
              client_name: clientAddress.client_name,
              client_email: clientAddress.client_email ?? req.client_email,
              request_id: req.id,
              service_type: normalizeTypeOfWork(req.service_type?.trim() || "") || null,
              catalog_service_id: req.catalog_service_id ?? null,
              status: "bidding",
              total_value: req.estimated_value ?? 0,
              partner_quotes_count: partnerIds.length,
              cost: 0,
              sell_price: req.estimated_value ?? 0,
              margin_percent: 0,
              quote_type: "partner",
              deposit_required: 0,
              customer_accepted: false,
              customer_deposit_paid: false,
              partner_cost: 0,
              property_address: clientAddress.property_address,
              scope: scopeFromRequest,
              email_attach_request_photos: false,
              ...(mergedQuoteImages.length > 0 ? { images: mergedQuoteImages } : {}),
              owner_id: profile?.id,
              owner_name: profile?.full_name,
            });
            const photoUrlsForPush = mergedQuoteImages;
            const inviteBody =
              `${req.service_type} — ${clientAddress.property_address ?? req.property_address ?? ""}`.trim() || quote.reference;
            if (sendMethod === "app" || sendMethod === "both") {
              await fetch("/api/push/notify-partner", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  partnerIds,
                  title: "New quote invitation",
                  body: inviteBody,
                  data: { type: "quote_invite", quoteId: quote.id, photoUrls: photoUrlsForPush },
                }),
              }).catch(() => {});
            }
            if (sendMethod === "email" || sendMethod === "both") {
              await fetch("/api/quotes/partner-invite-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quoteId: quote.id, partnerIds }),
              }).catch(() => {});
            }
            await updateRequestStatus(req.id, "converted_to_quote");
            await logAudit({
              entityType: "request", entityId: req.id, entityRef: req.reference,
              action: "status_changed", fieldName: "status",
              oldValue: req.status, newValue: "converted_to_quote",
              metadata: { converted_to_quote: quote.reference, partners_invited: partnerIds.length, send_method: sendMethod },
              userId: profile?.id, userName: profile?.full_name,
            });
            setInvitePartnerOpen(null);
            refreshSilent();
            loadCounts();
            toast.success(`Quote ${quote.reference} created. ${partnerIds.length} partner(s) invited via ${sendMethod}.`);
            router.push(`/quotes?quoteId=${encodeURIComponent(quote.id)}&drawerTab=bids`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to convert to quote");
          }
        }}
      />

      {/* Manual Quote Modal */}
      <ManualQuoteModal
        request={manualQuoteOpen}
        catalogServices={catalogServices}
        onClose={() => setManualQuoteOpen(null)}
        onDone={async (req, lineItems, clientAddress, catalogServiceId) => {
          try {
            if (!clientAddress?.client_id || !clientAddress?.property_address?.trim()) {
              toast.error("Select a client from the list (click the name) and choose or add a property address.");
              return;
            }
            const total = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
            const freshReq = await getRequest(req.id).catch(() => null);
            const fromRequest = normalizeJsonImageArray(freshReq?.images ?? req.images);
            const scopeFromRequest = [req.description?.trim(), req.scope?.trim()].filter(Boolean).join("\n\n") || undefined;
            const quote = await createQuote({
              title: `${req.service_type} — ${clientAddress.client_name}`,
              client_id: clientAddress.client_id,
              client_address_id: clientAddress.client_address_id,
              client_name: clientAddress.client_name,
              client_email: clientAddress.client_email ?? req.client_email,
              request_id: req.id,
              service_type: normalizeTypeOfWork(req.service_type?.trim() || "") || null,
              catalog_service_id: catalogServiceId ?? req.catalog_service_id ?? null,
              status: "draft",
              total_value: total,
              partner_quotes_count: 0,
              cost: total,
              sell_price: total,
              margin_percent: 0,
              quote_type: "internal",
              deposit_required: 0,
              customer_accepted: false,
              customer_deposit_paid: false,
              partner_cost: 0,
              property_address: clientAddress.property_address,
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
              updateRequestStatus(req.id, "converted_to_quote"),
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
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create quote");
          }
        }}
      />

      {/* Convert to Job Modal */}
      <ConvertToJobModal
        request={convertToJobOpen}
        onClose={() => setConvertToJobOpen(null)}
        onConvert={async (data) => {
          if (!convertToJobOpen) return;
          try {
            if (!data.client_id || !data.property_address?.trim()) {
              toast.error("Select a client from the list (click the name) and choose or add a property address.");
              return;
            }
            const clientPrice = data.client_price ?? 0;
            const partnerCost = data.partner_cost ?? 0;
            const margin = clientPrice > 0 ? Math.round(((clientPrice - partnerCost) / clientPrice) * 1000) / 10 : 0;
            const hasPartner = !!(data.partner_id?.trim() || data.partner_name?.trim());
            const job = await createJob({
              title: `${convertToJobOpen.service_type} — ${data.client_name}`,
              client_id: data.client_id,
              client_address_id: data.client_address_id,
              client_name: data.client_name,
              property_address: data.property_address,
              partner_name: data.partner_name,
              partner_id: data.partner_id,
              scheduled_date: data.scheduled_date,
              scheduled_start_at: data.scheduled_start_at,
              scheduled_end_at: data.scheduled_end_at,
              scheduled_finish_date: data.scheduled_finish_date ?? null,
              status: hasPartner ? "scheduled" : "unassigned",
              progress: 0,
              current_phase: 0,
              total_phases: normalizeTotalPhases(data.total_phases),
              client_price: clientPrice,
              extras_amount: 0,
              partner_cost: partnerCost,
              materials_cost: 0,
              margin_percent: margin,
              partner_agreed_value: partnerCost,
              scope: data.scope,
              internal_notes: data.internal_notes,
              cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
              finance_status: "unpaid",
              service_value: clientPrice,
              report_submitted: false,
              report_1_uploaded: false, report_1_approved: false,
              report_2_uploaded: false, report_2_approved: false,
              report_3_uploaded: false, report_3_approved: false,
              partner_payment_1: 0, partner_payment_1_paid: false,
              partner_payment_2: 0, partner_payment_2_paid: false,
              partner_payment_3: 0, partner_payment_3_paid: false,
              customer_deposit: 0, customer_deposit_paid: false,
              customer_final_payment: 0, customer_final_paid: false,
              owner_id: profile?.id,
              owner_name: profile?.full_name,
              job_type: data.job_type ?? "fixed",
            });
            await Promise.all([
              updateRequestStatus(convertToJobOpen.id, "converted_to_job"),
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

function InvitePartnerToQuote({
  request, onClose, onDone,
}: {
  request: ServiceRequest | null;
  onClose: () => void;
  onDone: (
    req: ServiceRequest,
    partnerIds: string[],
    sendMethod: string,
    clientAddress: ClientAndAddressValue,
    invitePhotoFiles: File[]
  ) => void;
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

  useEffect(() => {
    if (!request?.id) {
      setPartners([]);
      setPartnersLoading(false);
      return;
    }
    const serviceType = request.service_type;
    setSearchTerm("");
    setSummaryExpanded(true);
    setPartners([]);
    setClientAddress(serviceRequestToClientAddressValue(request));
    setInvitePhotos([]);
    setInvitePhotoPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    let cancelled = false;
    setPartnersLoading(true);
    listPartnersAll({ status: "all" })
      .then((list) => {
        if (cancelled) return;
        setPartners(list);
        const matched = list.filter((p) => safePartnerMatchesTypeOfWork(p, serviceType));
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
    return () => {
      cancelled = true;
    };
  }, [request?.id, request?.service_type]);

  const summaryImageUrls = useMemo(
    () => mergeImageUrlLists(normalizeJsonImageArray(request?.images)),
    [request?.images],
  );

  const filtered = useMemo(() => {
    if (!request) return [];
    const q = searchTerm.trim().toLowerCase();
    return partners.filter((p) => {
      if (!q) return true;
      const name = (p.company_name ?? "").toLowerCase();
      const trade = (p.trade ?? "").toLowerCase();
      const tradesFlat = (p.trades ?? []).filter((t): t is string => typeof t === "string").join(" ").toLowerCase();
      const loc = (p.location ?? "").toLowerCase();
      return name.includes(q) || trade.includes(q) || tradesFlat.includes(q) || loc.includes(q);
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
    <Modal open={!!request} onClose={onClose} title="Invite partners" subtitle={`${request.reference} — ${request.service_type}`} size="lg">
      <div className="p-6 flex flex-col max-h-[75vh] overflow-y-auto">
        <div className="mb-4">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Client and address *</p>
          <ClientAddressPicker
            value={clientAddress}
            onChange={setClientAddress}
            labelClient="Client *"
            labelAddress="Property address *"
            lockClient={!!request.client_id}
          />
        </div>

        <div className="mb-3">
          <Input
            placeholder="Search partners by name, trade, or location…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="text-sm"
          />
        </div>

        <div className="mb-4 rounded-xl border border-border-light bg-surface-hover/80 overflow-hidden">
          <button
            type="button"
            onClick={() => setSummaryExpanded((v) => !v)}
            aria-expanded={summaryExpanded}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-hover/90 transition-colors"
          >
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Invite summary</span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", summaryExpanded && "rotate-180")}
              aria-hidden
            />
          </button>
          {summaryExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-border-light pt-3">
              <p className="text-sm text-text-primary">
                <span className="text-text-tertiary text-xs font-medium">Type of work · </span>
                {request.service_type?.trim() || "—"}
              </p>
              <p className="text-sm text-text-primary break-words">
                <span className="text-text-tertiary text-xs font-medium">Address · </span>
                {request.property_address?.trim() || "—"}
              </p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">
                <span className="text-text-tertiary text-xs font-medium block mb-0.5">Service description</span>
                {request.description?.trim() || "—"}
              </p>
              <div>
                <span className="text-text-tertiary text-xs font-medium block mb-1.5">Photos (request + extra for invite)</span>
                {summaryImageUrls.length === 0 ? (
                  <p className="text-xs text-text-tertiary mb-2">No photos on the request yet — add below for this invite.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {summaryImageUrls.map((url, i) => (
                      <a
                        key={`${url}-${i}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block shrink-0 rounded-lg border border-border-light overflow-hidden bg-card hover:ring-2 hover:ring-primary/30 transition-shadow"
                        title="Open full size"
                      >
                        <img src={url} alt="" className="h-16 w-16 object-cover" loading="lazy" />
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
                  <div className="flex flex-wrap gap-2 mt-2">
                    {invitePhotoPreviews.map((src, i) => (
                      <div key={src} className="relative h-16 w-16 rounded-lg overflow-hidden border border-border-light bg-surface-hover shrink-0">
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

        {!partnersLoading && serviceRelated.length > 0 && (
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
            Matching “{request.service_type}” (trade / type of work) — {serviceRelated.length} partner(s)
          </p>
        )}

        <div className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1">
          {!partnersLoading &&
            [...serviceRelated, ...others].map((p) => {
            if (!p.id) return null;
            const isSelected = selectedIds.has(p.id);
            const isMatch = matchIdSet.has(p.id);
            return (
              <label key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? "border-primary bg-primary/5" : isMatch ? "border-amber-200 bg-amber-50/30 hover:border-primary/30" : "border-border hover:border-primary/30 hover:bg-surface-hover"}`}>
                <input type="checkbox" checked={isSelected} onChange={(e) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(p.id); else next.delete(p.id);
                    return next;
                  });
                }} className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20" />
                <Avatar name={p.company_name} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{p.company_name}</p>
                  <p className="text-xs text-text-tertiary">
                    {(p.trade ?? "—")} — {p.location ?? "—"}
                  </p>
                </div>
                {isMatch && <Badge variant="warning" size="sm">Match</Badge>}
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

        <div className="pt-4 mt-4 border-t border-border-light space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1 block">Send invite via</label>
            <div className="flex gap-2">
              {(["email", "app", "both"] as const).map((m) => (
                <button key={m} onClick={() => setSendMethod(m)} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${sendMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-text-tertiary hover:text-text-primary"}`}>
                  {m === "both" ? "Email + App" : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-tertiary">
              {selectedIds.size === 0 ? "Please select at least one partner" : `${selectedIds.size} partner(s) selected`}
            </p>
            <Button
              size="sm"
              icon={<Send className="h-3.5 w-3.5" />}
              disabled={selectedIds.size === 0 || !clientAddress.client_id || !clientAddress.property_address}
              onClick={() => onDone(request, Array.from(selectedIds), sendMethod, clientAddress, invitePhotos)}
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
    if (request) {
      setCatalogTemplateId(request.catalog_service_id ?? "");
      setLineItems([{ description: request.service_type, quantity: "1", unitPrice: String(request.estimated_value ?? 0), vat: false }]);
      setClientAddress(serviceRequestToClientAddressValue(request));
      void Promise.resolve(
        getSupabase().from("company_settings").select("vat_percent").limit(1).single(),
      ).then(({ data }) => {
        setVatPercent(data?.vat_percent != null ? Number(data.vat_percent) : 20);
      }).catch(() => setVatPercent(20));
    }
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
  request, onClose, onConvert,
}: {
  request: ServiceRequest | null;
  onClose: () => void;
  onConvert: (data: { client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; scope?: string; notes?: string; internal_notes?: string; client_price?: number; partner_cost?: number; total_phases?: number; job_type?: "fixed" | "hourly"; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null }) => void;
}) {
  const [form, setForm] = useState({
    partner_id: "", scope: "", notes: "", internal_notes: "", client_price: "", partner_cost: "", job_type: "fixed",
    scheduled_date: "", arrival_from: "", arrival_window_mins: "", expected_finish_date: "",
  });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    if (!request) {
      setPartners([]);
      return;
    }
    setForm({
      partner_id: "", scope: "", notes: "", internal_notes: "",
      client_price: String(request.estimated_value ?? 0), partner_cost: "", job_type: "fixed",
      scheduled_date: "", arrival_from: "", arrival_window_mins: "", expected_finish_date: "",
    });
    setClientAddress(serviceRequestToClientAddressValue(request));
    listPartnersAll({ status: "all" })
      .then(setPartners)
      .catch(() => {
        toast.error("Could not load partners");
        setPartners([]);
      });
  }, [request?.id]);

  if (!request) return null;
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const selectedPartner = partners.find((p) => p.id === form.partner_id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientAddress.client_id || !clientAddress.property_address?.trim()) {
      toast.error("Select a client from the list (click the name) and choose or add a property address.");
      return;
    }
    const sched = resolveJobModalSchedule({
      scheduled_date: form.scheduled_date,
      arrival_from: form.arrival_from,
      arrival_window_mins: form.arrival_window_mins,
      hasPartner: !!form.partner_id,
    });
    if (!sched.ok) {
      toast.error(sched.error);
      return;
    }
    const scheduled_date = sched.scheduled_date;
    const scheduled_start_at = sched.scheduled_start_at;
    const scheduled_end_at = sched.scheduled_end_at;
    const expected_finish = form.expected_finish_date?.trim() || undefined;
    if (expected_finish && scheduled_date && expected_finish < scheduled_date) {
      toast.error("Expected finish date must be on or after the scheduled date.");
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
    onConvert({
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      property_address: clientAddress.property_address,
      partner_id: form.partner_id || undefined,
      partner_name: selectedPartner?.company_name,
      scope: form.scope || undefined,
      notes: form.notes || undefined,
      internal_notes: form.internal_notes || undefined,
      client_price: Number(form.client_price) || 0,
      partner_cost: Number(form.partner_cost) || 0,
      total_phases: normalizeTotalPhases(2),
      job_type: form.job_type as "fixed" | "hourly",
      scheduled_date,
      scheduled_start_at,
      scheduled_end_at,
      scheduled_finish_date: expected_finish ?? null,
    });
  };

  return (
    <Modal open={!!request} onClose={onClose} title="Create Job" subtitle={`${request.reference} — Direct creation`} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Client &amp; address *</p>
          <ClientAddressPicker value={clientAddress} onChange={setClientAddress} lockClient={!!request.client_id} />
        </div>
        <Select
          label="Job type"
          value={form.job_type}
          onChange={(e) => update("job_type", e.target.value)}
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "hourly", label: "Hourly" },
          ]}
        />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client price</label>
            <Input type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} placeholder="0.00" min={0} step="0.01" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner cost</label>
            <Input type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} placeholder="0.00" min={0} step="0.01" />
          </div>
        </div>
        <JobModalScheduleFields
          scheduledDate={form.scheduled_date}
          arrivalFrom={form.arrival_from}
          arrivalWindowMins={form.arrival_window_mins}
          expectedFinishDate={form.expected_finish_date}
          onChange={(field, v) => update(field, v)}
          startDateRequired={!!form.partner_id}
        />
        <Select label="Partner" options={[{ value: "", label: "None" }, ...partners.map((p) => ({ value: p.id, label: p.company_name || p.contact_name }))]} value={form.partner_id} onChange={(e) => update("partner_id", e.target.value)} />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Scope</label>
          <textarea value={form.scope} onChange={(e) => update("scope", e.target.value)} rows={2} placeholder="Describe the work scope..." className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Internal notes</label>
          <textarea value={form.internal_notes} onChange={(e) => update("internal_notes", e.target.value)} rows={2} placeholder="Internal use only..." className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-none" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" icon={<Briefcase className="h-3.5 w-3.5" />}>Create Job</Button>
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
  const [form, setForm] = useState({
    client_phone: "",
    request_kind: "",
    source: "manual" as ServiceRequest["source"],
    catalog_service_id: "",
    service_type: "",
    description: "",
    priority: "medium",
  });
  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!open) return;
    setClientAddress({ client_name: "", property_address: "" });
    setPostcode("");
    setCreatePhotos([]);
    setCreatePhotoPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    setForm({
      client_phone: "",
      request_kind: "",
      source: "manual",
      catalog_service_id: "",
      service_type: "",
      description: "",
      priority: "medium",
    });
  }, [open]);

  const typeOfWorkOptions = useMemo(() => {
    const fromCatalog = catalogServices.map((c) => c.name);
    return mergeTypeOfWorkOptions([...TYPE_OF_WORK_OPTIONS, ...fromCatalog]).sort((a, b) => a.localeCompare(b));
  }, [catalogServices]);

  useEffect(() => {
    const ex = extractUkPostcode(clientAddress.property_address);
    if (ex) setPostcode(ex);
    else if (!clientAddress.property_address.trim()) setPostcode("");
  }, [clientAddress.property_address]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
    void onCreate(
      {
        client_id: clientAddress.client_id,
        client_address_id: clientAddress.client_address_id,
        client_name: clientAddress.client_name,
        client_email: clientAddress.client_email ?? "",
        client_phone: form.client_phone || undefined,
        property_address: clientAddress.property_address,
        postcode: pc,
        source: form.source,
        catalog_service_id: cid && isUuid(cid) ? cid : null,
        service_type: form.service_type.trim(),
        description: form.description,
        priority: form.priority as ServiceRequest["priority"],
        request_kind: form.request_kind as "quote" | "work",
      },
      createPhotos.length > 0 ? createPhotos : undefined
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Service Request"
      subtitle="Create a new incoming request"
      size="lg"
      scrollBody={false}
    >
      <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
        <div className="space-y-4 overflow-y-auto overscroll-contain px-6 pt-6 pb-2 max-h-[min(65vh,calc(100dvh-11rem))]">
        <Select
          label="Request type *"
          value={form.request_kind}
          onChange={(e) => {
            const next = e.target.value as "" | "quote" | "work";
            setForm((prev) => ({
              ...prev,
              request_kind: next,
              catalog_service_id: "",
              service_type: "",
            }));
          }}
          options={[
            { value: "", label: "Select request type…" },
            ...REQUEST_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          ]}
        />
        <div>
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Client &amp; property *</p>
          <p className="text-xs text-text-tertiary mb-3">Search for an existing client or create a new one. This link is kept when you convert to quote or job.</p>
          <ClientAddressPicker value={clientAddress} onChange={setClientAddress} labelClient="Client *" labelAddress="Property address *" />
          {!clientAddress.client_id && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
              First pick or create a client in the field above, then choose or add the property address. Both are required.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone (request)</label>
          <Input value={form.client_phone} onChange={(e) => update("client_phone", e.target.value)} placeholder="Optional — contact for this lead" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Postcode *</label>
            <Input value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} placeholder="e.g. SW1A 1AA — auto-filled from address" />
          </div>
          <Select label="Source" value={form.source ?? "manual"} onChange={(e) => update("source", e.target.value)} options={REQUEST_SOURCES.map((s) => ({ value: s.value!, label: s.label }))} />
        </div>
        <div className="space-y-3">
          {form.request_kind === "work" ? (
            <>
              <Select
                label="Call Out type"
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
                  { value: "", label: "Select call out type..." },
                  ...catalogServices.map((c) => ({
                    value: c.id,
                    label: c.name,
                  })),
                ]}
              />
              <p className="text-[10px] text-text-tertiary">Template text is loaded from Services; you can edit the issue description below.</p>
            </>
          ) : form.request_kind === "quote" ? (
            <Select
              label="Service name *"
              value={form.service_type}
              onChange={(e) => update("service_type", e.target.value)}
              options={[
                { value: "", label: "Select type of work..." },
                ...typeOfWorkOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
              Select Request type first.
            </p>
          )}
          <Select label="Priority" value={form.priority} onChange={(e) => update("priority", e.target.value)} options={[
            { value: "low", label: "Low" }, { value: "medium", label: "Medium" },
            { value: "high", label: "High" }, { value: "urgent", label: "Urgent" },
          ]} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Service description</label>
          <textarea value={form.description} onChange={(e) => update("description", e.target.value)} rows={3} placeholder="Describe the issue — what the client needs, access, urgency…" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 hover:border-border transition-all resize-none" />
        </div>
        <div className="rounded-xl border border-border-light bg-surface-hover/40 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Photos (optional)</p>
          <p className="text-[11px] text-text-tertiary">Up to 8 images — stored on the request and carried to quotes / partner app when you convert.</p>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-text-primary cursor-pointer hover:border-primary/30">
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
          {createPhotoPreviews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {createPhotoPreviews.map((src, i) => (
                <div key={src} className="relative h-14 w-14 rounded-lg overflow-hidden border border-border-light shrink-0">
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
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-light px-6 py-4">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Request</Button>
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
