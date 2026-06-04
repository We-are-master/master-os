"use client";

import type { ListResult } from "@/services/base";
import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";
import {
  UserPlus, Filter, Users, Star, Briefcase, ShieldCheck, MapPin,
  ArrowRight, Mail, Phone, Calendar, DollarSign, Landmark,
  FileText, Upload, CheckCircle2, XCircle, Clock, AlertTriangle,
  MessageSquare, Send, Trash2, Download, Eye, Copy,
  Play, KeyRound, MailPlus,
  Home, Link2, Info, LayoutList, LayoutGrid, Columns3, ChevronLeft, ChevronRight, Minus,
} from "lucide-react";

import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import { formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CatalogService, Partner, PartnerLegalType, PartnerStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listPartners, listPartnersAll, createPartner, updatePartner } from "@/services/partners";
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
import {
  PartnerCoverageEditor,
  PartnerCoverageTab,
} from "@/components/partners/partner-coverage-tab";
import {
  COVERAGE_CITY_LONDON_ID,
  defaultLondonIncludedPostcodes,
} from "@/lib/coverage-cities";
import {
  clearedCoverageFieldsForMode,
  formatPartnerCoverageSummary,
} from "@/lib/partner-coverage";
import type { PartnerCoverageMode } from "@/types/database";
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
  buildFullMandatoryDocsForComplianceScore,
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
import { GENERAL_MAINTENANCE_LABEL, typeOfWorkLabelsFromCatalog, normalizeTypeOfWork } from "@/lib/type-of-work";
import { catalogServiceIdsForTradeLabels } from "@/lib/catalog-trade-ids";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
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
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import type { PartnerDocRuleRow } from "@/lib/partner-required-docs";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";
import {
  PartnerServiceRatesTabSection,
  PartnerServiceRatesCreateStep,
  buildPartnerServicePriceInputFromDraft,
  type RowDraft as PartnerServiceRateRowDraft,
} from "./service-rates-tab";
import { upsertPartnerServicePrice } from "@/services/partner-service-prices";
import { PartnerTradesIconStrip } from "@/services/partner-trade-icons";
import { CatalogTradesSkillsTab } from "@/components/partners/catalog-trades-skills-tab";
import { displayPartnerRating, PARTNER_RATING_MAX } from "@/lib/partner-rating";
import { refreshLegacyZeroPartnerRatings, refreshPartnerRating } from "@/services/partner-rating";

const PARTNERS_PAGE_SIZE = 10;
const PARTNERS_DIR_VIEW_STORAGE_KEY = "master-os-partners-directory-view";

/** Directory stage filters — same pill pattern as People → Workforce sub-filters */
const PARTNER_DIRECTORY_STAGE_FILTERS = [
  { id: "all", label: "All" },
  { id: "onboarding", label: "Onboarding" },
  { id: "active", label: "Active" },
  { id: "needs_attention", label: "Needs attention" },
  { id: "inactive", label: "Inactive" },
] as const;

type PartnersDirectoryDisplayMode = "list" | "grid" | "kanban";

const KANBAN_TRADE_COLUMN_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-indigo-500",
] as const;

const KANBAN_OTHER_TRADE_COLUMN = "Other";

function PartnersDirectoryGridCheckbox({
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

function PartnersDirectoryGridView({
  data,
  loading,
  page,
  totalPages,
  totalItems,
  onPageChange,
  selectedIds,
  onSelectionChange,
  selectedPartnerId,
  onOpenPartner,
  isAdmin,
  bulkActionsSlot,
  catalogServices,
}: {
  data: Partner[];
  loading: boolean;
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (p: number) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  selectedPartnerId?: string | null;
  onOpenPartner: (p: Partner) => void;
  isAdmin: boolean;
  bulkActionsSlot: ReactNode;
  catalogServices: readonly CatalogService[];
}) {
  const allIds = data.map((p) => p.id);
  const allSelected = isAdmin && data.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = isAdmin && allIds.some((id) => selectedIds.has(id));
  const selectionCount = selectedIds.size;

  const toggleAll = () => {
    if (!isAdmin || !onSelectionChange) return;
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
    if (!isAdmin || !onSelectionChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div className="relative overflow-hidden">
      {isAdmin ? (
        <AnimatePresence>
          {selectionCount > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 sm:px-6 py-2.5 bg-primary/[0.04] border-b border-border-light"
            >
              <div className="flex items-center gap-2">
                <PartnersDirectoryGridCheckbox
                  checked={!!allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={toggleAll}
                />
                <span className="text-sm font-medium text-primary">{selectionCount} selected</span>
              </div>
              <div className="h-4 w-px bg-border shrink-0" />
              <div className="flex items-center gap-1.5 flex-wrap">{bulkActionsSlot}</div>
              <button
                type="button"
                onClick={() => onSelectionChange(new Set())}
                className="ml-auto text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Clear selection
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}

      {loading ? (
        <div className="p-4 sm:p-6 grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[12.5rem] rounded-2xl border border-border-light bg-surface-secondary animate-shimmer"
            />
          ))}
        </div>
      ) : data.length === 0 ? (
        <motion.div
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
          className="text-center px-6 py-16 space-y-2"
        >
          <div className="inline-flex items-center justify-center rounded-full bg-surface-hover p-3 mb-2">
            <Users className="h-8 w-8 text-text-tertiary" aria-hidden />
          </div>
          <p className="text-sm font-medium text-text-secondary">No partners found.</p>
          <p className="text-xs text-text-tertiary max-w-xs mx-auto">Try another stage filter or clear search.</p>
        </motion.div>
      ) : (
        <StaggerContainer className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((item) => {
            const id = item.id;
            const isChecked = selectedIds.has(id);
            const isOpen = selectedPartnerId === id;
            const cfg = statusConfig[item.status] ?? statusConfig.active;
            const raw = item.compliance_score;
            const comp =
              typeof raw === "number" && !Number.isNaN(raw) ? raw : Number(raw ?? 0);
            const compClass =
              comp >= 97 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
            const tradesShown = partnerTradesForDisplay(item, catalogServices);
            return (
              <motion.div
                key={id}
                role="button"
                tabIndex={0}
                variants={staggerItem}
                onClick={() => onOpenPartner(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenPartner(item);
                  }
                }}
                className={cn(
                  "relative cursor-pointer text-left rounded-2xl border border-border-light bg-surface-hover/20 shadow-sm outline-none transition-all",
                  "hover:bg-surface-hover/50 hover:border-primary/20 focus-visible:ring-2 focus-visible:ring-primary/35 flex flex-col gap-3",
                  isChecked ? "border-primary bg-primary/[0.06]" : "",
                  isOpen ? "border-primary/40 bg-primary/[0.04]" : "",
                )}
              >
                {isAdmin ? (
                  <div
                    className="absolute left-3 top-3 z-[1]"
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <PartnersDirectoryGridCheckbox checked={isChecked} onChange={() => toggleOne(id)} />
                  </div>
                ) : null}

                <div className={cn("p-4 flex flex-col gap-3", isAdmin && "pt-11")}>
                  <div className="flex gap-3 min-w-0">
                    <Avatar name={item.company_name} size="md" src={item.avatar_url ?? undefined} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-text-primary truncate">{item.company_name}</p>
                        {item.verified ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : null}
                      </div>
                      <p className="text-[11px] text-text-tertiary truncate">{item.contact_name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <Badge variant={cfg.variant} size="sm" dot>
                          {item.status === "on_break" ? "Inactive" : cfg.label}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Trades</p>
                    <PartnerTradesIconStrip trades={tradesShown} catalogServices={catalogServices} />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
                    <MapPin className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                    <span className="truncate" title={formatPartnerCoverageSummary(item)}>
                      {formatPartnerCoverageSummary(item) || "—"}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-xs border-t border-border-light pt-3">
                    <div>
                      <dt className="text-text-tertiary uppercase tracking-wide mb-0.5">Compliance</dt>
                      <dd className={cn("font-semibold tabular-nums text-sm", compClass)}>
                        {Math.round(comp)}
                        <span className="text-[10px] ml-px">%</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary uppercase tracking-wide mb-0.5">Rating</dt>
                      <dd className="flex items-center gap-1 font-semibold text-sm text-text-primary">
                        <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" aria-hidden />
                        {displayPartnerRating(item.rating)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary uppercase tracking-wide mb-0.5">Jobs</dt>
                      <dd className="font-semibold text-sm text-text-primary tabular-nums">{item.jobs_completed}</dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary uppercase tracking-wide mb-0.5">Earnings</dt>
                      <dd className="font-semibold text-sm text-text-primary tabular-nums truncate">{formatCurrency(item.total_earnings)}</dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-end text-sm text-text-tertiary pt-1">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
                      Open partner
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </StaggerContainer>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 border-t border-border-light">
          <p className="text-xs text-text-tertiary">
            Showing {(page - 1) * PARTNERS_PAGE_SIZE + 1}-{Math.min(page * PARTNERS_PAGE_SIZE, totalItems)} of {totalItems}
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
                    page === pageNum ? "bg-primary text-white" : "text-text-secondary hover:bg-surface-tertiary",
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

function PartnersDirectoryKanbanView({
  partners,
  columnLabels,
  loading,
  totalItems,
  catalogServices,
  selectedPartnerId,
  onOpenPartner,
}: {
  partners: Partner[];
  columnLabels: readonly string[];
  loading: boolean;
  totalItems: number;
  catalogServices: readonly CatalogService[];
  selectedPartnerId?: string | null;
  onOpenPartner: (p: Partner) => void;
}) {
  const columns = useMemo(
    () =>
      buildPartnersTradeKanbanColumns(
        partners,
        columnLabels,
        catalogServices,
        columnLabels.length > 1,
      ),
    [partners, columnLabels, catalogServices],
  );

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-72 space-y-2">
              <div className="h-5 w-32 rounded-md bg-surface-secondary animate-shimmer" />
              {Array.from({ length: 3 }).map((__, j) => (
                <div
                  key={j}
                  className="h-24 rounded-xl border border-border-light bg-surface-secondary animate-shimmer"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <motion.div
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        className="text-center px-6 py-16 space-y-2"
      >
        <div className="inline-flex items-center justify-center rounded-full bg-surface-hover p-3 mb-2">
          <Users className="h-8 w-8 text-text-tertiary" aria-hidden />
        </div>
        <p className="text-sm font-medium text-text-secondary">No partners found.</p>
        <p className="text-xs text-text-tertiary max-w-xs mx-auto">
          Try another stage filter or clear search.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-3">
      <p className="text-xs text-text-tertiary">
        {totalItems} partner{totalItems === 1 ? "" : "s"} · grouped by type of work (a partner can
        appear in more than one column)
      </p>
      <KanbanBoard
        columns={columns}
        getCardId={(p) => p.id}
        onCardClick={onOpenPartner}
        className="min-h-[320px]"
        renderCard={(item) => {
          const cfg = statusConfig[item.status] ?? statusConfig.active;
          const raw = item.compliance_score;
          const comp =
            typeof raw === "number" && !Number.isNaN(raw) ? raw : Number(raw ?? 0);
          const compClass =
            comp >= 97
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400";
          const isOpen = selectedPartnerId === item.id;
          return (
            <div
              className={cn(
                "rounded-xl border border-border-light bg-card shadow-sm p-3 transition-colors",
                "hover:border-primary/30",
                isOpen ? "border-primary/40 ring-1 ring-primary/20" : "",
              )}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <Avatar
                  name={item.company_name}
                  size="sm"
                  src={item.avatar_url ?? undefined}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {item.company_name}
                    </p>
                    {item.verified ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : null}
                  </div>
                  <p className="text-[11px] text-text-tertiary truncate">{item.contact_name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <Badge variant={cfg.variant} size="sm" dot>
                      {item.status === "on_break" ? "Inactive" : cfg.label}
                    </Badge>
                    <span className={cn("text-[11px] font-semibold tabular-nums", compClass)}>
                      {Math.round(comp)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 text-[11px] text-text-secondary min-w-0">
                    <MapPin className="h-3 w-3 text-text-tertiary shrink-0" />
                    <span className="truncate">
                      {formatPartnerCoverageSummary(item) || "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; color: string }> = {
  active: { label: "Active", variant: "success", color: "bg-emerald-50 dark:bg-emerald-950/300" },
  needs_attention: { label: "Needs Attention", variant: "danger", color: "bg-red-50 dark:bg-red-950/300" },
  inactive: { label: "Inactive", variant: "default", color: "bg-stone-600 dark:bg-stone-800" },
  onboarding: { label: "Onboarding", variant: "warning", color: "bg-amber-50 dark:bg-amber-950/300" },
  /** @deprecated DB value — shown as Inactive + “On break” badge */
  on_break: { label: "Inactive", variant: "default", color: "bg-stone-600 dark:bg-stone-800" },
};

let partnersActiveTradeLabels: readonly string[] = [];

function syncPartnersTradePickLabels(labels: readonly string[]): void {
  partnersActiveTradeLabels = labels;
}

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
  for (const p of partnersActiveTradeLabels) {
    if (p.toLowerCase() === raw.toLowerCase()) return p;
  }
  const legacy = LEGACY_TRADE_ALIASES[raw.toLowerCase()];
  if (legacy) {
    for (const p of partnersActiveTradeLabels) {
      if (p.toLowerCase() === legacy.toLowerCase()) return p;
    }
  }
  const fromWork = normalizeTypeOfWork(raw);
  if (fromWork) {
    for (const p of partnersActiveTradeLabels) {
      if (p.toLowerCase() === fromWork.toLowerCase()) return p;
    }
  }
  return null;
}

function normalizeTrades(values: Array<string | null | undefined>): string[] {
  const byLower = new Map<string, string>();
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    const normalized = normalizeTradeName(trimmed);
    const label = normalized ?? trimmed;
    const key = label.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, label);
  }
  const fallback = partnersActiveTradeLabels[0] ?? GENERAL_MAINTENANCE_LABEL;
  return byLower.size > 0 ? Array.from(byLower.values()) : [fallback];
}

function getPartnerTrades(
  partner: Pick<Partner, "trade" | "trades" | "catalog_service_ids">,
  catalog?: readonly CatalogService[],
): string[] {
  const ids = partner.catalog_service_ids?.filter(Boolean) ?? [];
  if (ids.length && catalog?.length) {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const names: string[] = [];
    for (const id of ids) {
      const n = byId.get(id)?.name?.trim();
      if (n) names.push(n);
    }
    if (names.length) return normalizeTrades(names);
  }
  const tradeList = partner.trades?.length ? partner.trades : [partner.trade];
  return normalizeTrades(tradeList);
}

/** Legacy `partner.trade` / DB may still say "HVAC"; never show that label in UI. */
function isHiddenTradeLabel(t: string): boolean {
  return String(t).trim().toLowerCase() === "hvac";
}

/** Trades for UI (drops HVAC). Prefer `catalog_service_ids` names when catalogue is loaded. */
function partnerTradesForDisplay(
  partner: Pick<Partner, "trade" | "trades" | "catalog_service_ids">,
  catalog?: readonly CatalogService[],
): string[] {
  return getPartnerTrades(partner, catalog).filter((t) => !isHiddenTradeLabel(t));
}

function tradeMatchesColumnLabel(trade: string, columnLabel: string): boolean {
  const normalized =
    normalizeTradeName(trade) ?? normalizeTypeOfWork(trade) ?? trade.trim();
  return normalized.toLowerCase() === columnLabel.trim().toLowerCase();
}

function partnerMatchesKanbanColumn(
  partner: Partner,
  columnLabel: string,
  catalog: readonly CatalogService[],
): boolean {
  return partnerTradesForDisplay(partner, catalog).some((t) =>
    tradeMatchesColumnLabel(t, columnLabel),
  );
}

function buildPartnersTradeKanbanColumns(
  partners: Partner[],
  columnLabels: readonly string[],
  catalog: readonly CatalogService[],
  includeOtherColumn: boolean,
): KanbanColumn<Partner>[] {
  const cols: KanbanColumn<Partner>[] = columnLabels.map((label, i) => ({
    id: label,
    title: label,
    color: KANBAN_TRADE_COLUMN_COLORS[i % KANBAN_TRADE_COLUMN_COLORS.length],
    items: partners.filter((p) => partnerMatchesKanbanColumn(p, label, catalog)),
  }));
  if (!includeOtherColumn) return cols;
  const otherItems = partners.filter((p) => {
    const trades = partnerTradesForDisplay(p, catalog);
    if (trades.length === 0) return true;
    return !columnLabels.some((col) =>
      trades.some((t) => tradeMatchesColumnLabel(t, col)),
    );
  });
  if (otherItems.length === 0) return cols;
  return [
    ...cols,
    {
      id: KANBAN_OTHER_TRADE_COLUMN,
      title: KANBAN_OTHER_TRADE_COLUMN,
      color: "bg-slate-500",
      items: otherItems,
    },
  ];
}

function overviewTradesForDisplay(
  partner: Pick<Partner, "trade" | "trades" | "catalog_service_ids">,
  editing: boolean,
  overviewTrades: string[],
  catalog?: readonly CatalogService[],
): string[] {
  if (!editing) return partnerTradesForDisplay(partner, catalog);
  return normalizeTrades(overviewTrades).filter((t) => !isHiddenTradeLabel(t));
}

/** `https://wa.me/{digits}` — best-effort intl digits (e.g. UK 07… → 44…). */
function whatsAppHrefFromPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if ((d.length === 10 || d.length === 11) && d.startsWith("0")) {
    d = `44${d.slice(1)}`;
  }
  if (d.length < 8 || d.length > 15) return null;
  return `https://wa.me/${d}`;
}

function WhatsAppChatIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
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
  in_progress: { label: "In Progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress },
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
  trades: [] as string[],
  partner_address: "",
  /** New directory partners start in Onboarding until compliance + activation. */
  status: "onboarding" as PartnerStatus,
};

const CREATE_PARTNER_WIZARD_STEPS = [
  { id: "info", label: "Partner info" },
  { id: "documents", label: "Documents" },
  { id: "rates", label: "Rate card" },
] as const;

type CreatePartnerWizardStep = (typeof CREATE_PARTNER_WIZARD_STEPS)[number]["id"];

function formatPartnerCreateError(err: unknown): string {
  if (err && typeof err === "object") {
    const o = err as { message?: string; code?: string; details?: string; hint?: string };
    const msg = [o.message, o.details, o.hint].filter(Boolean).join(" — ");
    const code = o.code ?? "";
    const lower = msg.toLowerCase();
    if (code === "23505" || lower.includes("duplicate") || lower.includes("unique")) {
      if (lower.includes("email")) {
        return "A partner with this email already exists. Search Directory for that email.";
      }
      return "A partner with these details may already exist (duplicate record).";
    }
    if (code === "42501" || lower.includes("row-level security") || lower.includes("permission denied")) {
      return "You don't have permission to create partners. Ask an admin to add this partner.";
    }
    if (msg) return msg;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Failed to create partner. Check required fields and try again.";
}

function validateCreatePartnerWizardStep(
  step: CreatePartnerWizardStep,
  form: typeof emptyForm,
): string | null {
  if (step !== "info") return null;
  if (!form.company_name.trim() || !form.contact_name.trim() || !form.email.trim()) {
    return "Fill in company name, contact name, and email.";
  }
  if (form.partner_legal_type === "limited_company") {
    if (form.vat_registered === null) return "Select whether the company is VAT registered.";
    if (form.vat_registered === true && !form.vat_number.trim()) return "Enter the VAT number.";
  }
  if (!form.trades?.length) {
    return "Select at least one trade.";
  }
  return null;
}

function validateCreatePartnerCoverage(
  mode: PartnerCoverageMode,
  radiusMiles: number,
  lat: number | null,
  lng: number | null,
  outward: Set<string>,
): string | null {
  if (mode === "radius") {
    if (lat == null || lng == null || !(radiusMiles > 0)) {
      return "Set a base location on the map and choose a radius in miles.";
    }
    return null;
  }
  if (outward.size === 0) return "Select at least one postcode district for coverage.";
  return null;
}

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

interface PartnersClientProps {
  initialData?: ListResult<Partner> | null;
}

export function PartnersClient({ initialData }: PartnersClientProps = {}) {
  const { partnerDocumentRules } = useFrontendSetup();
  const [viewMode, setViewMode] = useState<ViewMode>("directory");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createWizardStep, setCreateWizardStep] = useState<CreatePartnerWizardStep>("info");
  const [pendingCreateRateDrafts, setPendingCreateRateDrafts] = useState<Record<string, PartnerServiceRateRowDraft>>({});
  const [pendingCreateDocs, setPendingCreateDocs] = useState<PendingCreatePartnerDoc[]>([]);
  const [createAvatarFile, setCreateAvatarFile] = useState<File | null>(null);
  const createAvatarInputRef = useRef<HTMLInputElement>(null);
  const [createQueueDocOpen, setCreateQueueDocOpen] = useState(false);
  const [createDocPreset, setCreateDocPreset] = useState<{ docType: string; name: string } | null>(null);
  const [createCustomCertName, setCreateCustomCertName] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [createCoverageMode, setCreateCoverageMode] = useState<PartnerCoverageMode>("postcodes");
  const [createRadiusMiles, setCreateRadiusMiles] = useState(15);
  const [createCoverageAddress, setCreateCoverageAddress] = useState("");
  const [createCoverageLat, setCreateCoverageLat] = useState<number | null>(null);
  const [createCoverageLng, setCreateCoverageLng] = useState<number | null>(null);
  const [createCoverageCityId, setCreateCoverageCityId] = useState(COVERAGE_CITY_LONDON_ID);
  const [createCoverageOutward, setCreateCoverageOutward] = useState(
    () => new Set(defaultLondonIncludedPostcodes()),
  );
  const [submitting, setSubmitting] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [complianceAvg, setComplianceAvg] = useState<number | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  /** When set (e.g. after Add Partner), drawer opens on this tab once. Cleared when picking another row or closing. */
  const [partnerDrawerInitialTab, setPartnerDrawerInitialTab] = useState<string | undefined>(undefined);
  const [selectedTeamMember, setSelectedTeamMember] = useState<TeamMember | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [directoryDisplayMode, setDirectoryDisplayMode] = useState<PartnersDirectoryDisplayMode>("list");

  useEffect(() => {
    try {
      const v = localStorage.getItem(PARTNERS_DIR_VIEW_STORAGE_KEY);
      if (v === "grid" || v === "list" || v === "kanban") setDirectoryDisplayMode(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PARTNERS_DIR_VIEW_STORAGE_KEY, directoryDisplayMode);
    } catch {
      /* ignore */
    }
  }, [directoryDisplayMode]);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const { profile } = useProfile();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const isAdmin = profile?.role === "admin";
  const router = useRouter();

  const [tradePickOptions, setTradePickOptions] = useState<readonly string[]>([]);
  const [partnerCatalogServices, setPartnerCatalogServices] = useState<CatalogService[]>([]);
  useEffect(() => {
    void listCatalogServicesForPicker()
      .then((c) => {
        setPartnerCatalogServices(c);
        const labels = typeOfWorkLabelsFromCatalog(c);
        setTradePickOptions(labels);
        syncPartnersTradePickLabels(labels);
      })
      .catch(() => {
        syncPartnersTradePickLabels([]);
      });
  }, []);

  const handleBulkOutreach = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).join(",");
    router.push(`/outreach?partnerIds=${encodeURIComponent(ids)}`);
  }, [selectedIds, router]);

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

  const {
    data: partners,
    loading,
    page,
    totalPages,
    totalItems,
    setPage,
    search,
    setSearch,
    status: statusFilter,
    setStatus: setStatusFilter,
    refresh: refreshList,
  } = useSupabaseList<Partner>({
    fetcher,
    pageSize: PARTNERS_PAGE_SIZE,
    realtimeTable: "partners",
    initialStatus: "active",
    initialData,
  });

  const partnerListIdsKey = partners.map((p) => p.id).join(",");
  useEffect(() => {
    if (loading || viewMode !== "directory" || directoryDisplayMode === "kanban") return;
    const legacyZeroIds = partners.filter((p) => p.rating === 0).map((p) => p.id);
    if (!legacyZeroIds.length) return;
    let cancelled = false;
    void refreshLegacyZeroPartnerRatings(legacyZeroIds).then(() => {
      if (!cancelled) refreshList();
    });
    return () => {
      cancelled = true;
    };
  }, [partnerListIdsKey, loading, viewMode, directoryDisplayMode, refreshList]);

  const [kanbanPartners, setKanbanPartners] = useState<Partner[]>([]);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [kanbanTotalItems, setKanbanTotalItems] = useState(0);

  const loadKanbanPartners = useCallback(async () => {
    setKanbanLoading(true);
    try {
      const rows = await listPartnersAll({
        status: statusFilter,
        search: search.trim() || undefined,
        trade: tradeFilter !== "all" ? tradeFilter : undefined,
      });
      setKanbanPartners(rows);
      setKanbanTotalItems(rows.length);
    } catch {
      toast.error("Failed to load partners for kanban");
      setKanbanPartners([]);
      setKanbanTotalItems(0);
    } finally {
      setKanbanLoading(false);
    }
  }, [statusFilter, search, tradeFilter]);

  useEffect(() => {
    if (viewMode !== "directory" || directoryDisplayMode !== "kanban") return;
    void loadKanbanPartners();
  }, [viewMode, directoryDisplayMode, loadKanbanPartners]);

  const kanbanPartnerIdsKey = kanbanPartners.map((p) => p.id).join(",");
  useEffect(() => {
    if (viewMode !== "directory" || directoryDisplayMode !== "kanban" || kanbanLoading) return;
    const legacyZeroIds = kanbanPartners.filter((p) => p.rating === 0).map((p) => p.id);
    if (!legacyZeroIds.length) return;
    let cancelled = false;
    void refreshLegacyZeroPartnerRatings(legacyZeroIds).then(() => {
      if (!cancelled) void loadKanbanPartners();
    });
    return () => {
      cancelled = true;
    };
  }, [kanbanPartnerIdsKey, kanbanLoading, viewMode, directoryDisplayMode, loadKanbanPartners]);

  const refresh = useCallback(() => {
    refreshList();
    if (directoryDisplayMode === "kanban") void loadKanbanPartners();
  }, [refreshList, directoryDisplayMode, loadKanbanPartners]);

  const kanbanColumnLabels = useMemo((): readonly string[] => {
    if (tradeFilter !== "all") return [tradeFilter];
    if (tradePickOptions.length > 0) return tradePickOptions;
    return [GENERAL_MAINTENANCE_LABEL];
  }, [tradeFilter, tradePickOptions]);

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
  useEffect(() => {
    refreshList();
    if (directoryDisplayMode === "kanban") void loadKanbanPartners();
  }, [tradeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setCreateWizardStep("info");
    setPendingCreateDocs([]);
    setPendingCreateRateDrafts({});
    setCreateQueueDocOpen(false);
    setCreateDocPreset(null);
    setCreateCustomCertName("");
    setCreateCoverageMode("postcodes");
    setCreateRadiusMiles(15);
    setCreateCoverageAddress("");
    setCreateCoverageLat(null);
    setCreateCoverageLng(null);
    setCreateCoverageCityId(COVERAGE_CITY_LONDON_ID);
    setCreateCoverageOutward(new Set(defaultLondonIncludedPostcodes()));
  }, [createOpen]);

  const partnerTradesForCreate = useMemo(
    () =>
      form.trades?.length
        ? form.trades
        : tradePickOptions[0]
          ? [tradePickOptions[0]]
          : [GENERAL_MAINTENANCE_LABEL],
    [form.trades, tradePickOptions],
  );
  const syntheticPartnerForCreateDocs = useMemo(
    (): Partner =>
      ({
        id: "__create__",
        partner_legal_type: form.partner_legal_type,
        trades: form.trades,
        trade: form.trades[0] ?? tradePickOptions[0] ?? GENERAL_MAINTENANCE_LABEL,
        crn: form.crn?.trim() || null,
      } as Partner),
    [form.partner_legal_type, form.trades, form.crn, tradePickOptions],
  );
  const mandatoryDocsCreate = useMemo(
    () => buildFullMandatoryDocsForComplianceScore(syntheticPartnerForCreateDocs, partnerTradesForCreate, partnerDocumentRules),
    [syntheticPartnerForCreateDocs, partnerTradesForCreate, partnerDocumentRules],
  );
  const tradeCertsDocsCreate = useMemo(
    () => buildTradeCertificateRequirements(partnerTradesForCreate, partnerDocumentRules),
    [partnerTradesForCreate, partnerDocumentRules],
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
  const inactiveStageCount = (statusCounts["inactive"] ?? 0) + (statusCounts["on_break"] ?? 0);

  const createWizardStepIndex = CREATE_PARTNER_WIZARD_STEPS.findIndex((s) => s.id === createWizardStep);
  const isLastCreateWizardStep = createWizardStepIndex === CREATE_PARTNER_WIZARD_STEPS.length - 1;

  const goCreateWizardNext = useCallback(() => {
    const err = validateCreatePartnerWizardStep(createWizardStep, form);
    if (err) {
      toast.error(err);
      return;
    }
    if (createWizardStep === "info") {
      const covErr = validateCreatePartnerCoverage(
        createCoverageMode,
        createRadiusMiles,
        createCoverageLat,
        createCoverageLng,
        createCoverageOutward,
      );
      if (covErr) {
        toast.error(covErr);
        return;
      }
    }
    const next = CREATE_PARTNER_WIZARD_STEPS[createWizardStepIndex + 1];
    if (next) setCreateWizardStep(next.id);
  }, [
    createWizardStep,
    createWizardStepIndex,
    form,
    createCoverageMode,
    createRadiusMiles,
    createCoverageLat,
    createCoverageLng,
    createCoverageOutward,
  ]);

  const goCreateWizardBack = useCallback(() => {
    const prev = CREATE_PARTNER_WIZARD_STEPS[createWizardStepIndex - 1];
    if (prev) setCreateWizardStep(prev.id);
  }, [createWizardStepIndex]);

  async function handleCreate() {
    const err = validateCreatePartnerWizardStep("info", form);
    if (err) {
      toast.error(err);
      setCreateWizardStep("info");
      return;
    }
    const covErr = validateCreatePartnerCoverage(
      createCoverageMode,
      createRadiusMiles,
      createCoverageLat,
      createCoverageLng,
      createCoverageOutward,
    );
    if (covErr) {
      toast.error(covErr);
      setCreateWizardStep("info");
      return;
    }
    const dupP = await findDuplicatePartners({
      email: form.email.trim(),
      companyName: form.company_name.trim(),
    });
    if (!(await confirmDespiteDuplicates(formatPartnerDuplicateLines(dupP)))) return;

    setSubmitting(true);
    try {
      const primaryTrade = form.trades[0] ?? tradePickOptions[0] ?? GENERAL_MAINTENANCE_LABEL;
      const coveragePatch =
        createCoverageMode === "radius"
          ? {
              ...clearedCoverageFieldsForMode("radius"),
              service_radius_miles: createRadiusMiles,
              coverage_latitude: createCoverageLat,
              coverage_longitude: createCoverageLng,
              coverage_base_postcode: createCoverageAddress.trim() || null,
              location: createCoverageAddress.trim() || "UK",
            }
          : {
              ...clearedCoverageFieldsForMode("postcodes"),
              included_postcodes: [...createCoverageOutward],
              coverage_cities: [createCoverageCityId],
              location: "London",
            };
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
        partner_address: form.partner_address.trim() || null,
        verified: false,
        catalog_service_ids: catalogServiceIdsForTradeLabels(form.trades, partnerCatalogServices),
        ...coveragePatch,
      });

      // Mirror the new partner into Zendesk (Organisation + User) fire-and-
      // forget so future job side conversations target their zendesk_user_id.
      void fetch("/api/admin/partner/zendesk-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: created.id }),
      }).catch(() => { /* non-blocking */ });

      let partnerToShow: Partner = created;
      if (createAvatarFile) {
        try {
          const url = await uploadPartnerAvatar(created.id, createAvatarFile);
          partnerToShow = await updatePartner(created.id, { avatar_url: url });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Photo upload failed");
        }
      }
      let rateSaveFailed = 0;
      let rateSaveCount = 0;
      for (const [serviceId, draft] of Object.entries(pendingCreateRateDrafts)) {
        const payload = buildPartnerServicePriceInputFromDraft(created.id, serviceId, draft);
        if (!payload) continue;
        try {
          await upsertPartnerServicePrice(payload);
          rateSaveCount += 1;
        } catch {
          rateSaveFailed += 1;
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
      setPendingCreateRateDrafts({});
      refresh();
      await loadCounts();
      if (viewMode === "team") loadTeam();
      const parts: string[] = ["Partner created."];
      if (pendingCreateDocs.length > 0) {
        parts.push(
          docUploadFailed > 0
            ? `${pendingCreateDocs.length - docUploadFailed}/${pendingCreateDocs.length} document(s) uploaded.`
            : `${pendingCreateDocs.length} document(s) uploaded.`,
        );
      }
      if (rateSaveCount > 0) {
        parts.push(
          rateSaveFailed > 0
            ? `${rateSaveCount} custom rate(s) saved; ${rateSaveFailed} failed.`
            : `${rateSaveCount} custom rate(s) saved.`,
        );
      }
      toast.success(parts.join(" "));
    } catch (err) {
      toast.error(formatPartnerCreateError(err));
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
      setCreateWizardStep("documents");
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
        <PartnerTradesIconStrip trades={partnerTradesForDisplay(item, partnerCatalogServices)} catalogServices={partnerCatalogServices} />
      ),
    },
    {
      key: "location", label: "Coverage",
      render: (item) => (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary max-w-[200px] truncate" title={formatPartnerCoverageSummary(item)}>
          <MapPin className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <span className="truncate">{formatPartnerCoverageSummary(item) || "—"}</span>
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
          <span className="text-sm font-semibold text-text-primary">{displayPartnerRating(item.rating)}</span>
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

  const tradeCatalogSelectOptions = useMemo(
    () => [{ value: "all", label: "All trades" }, ...tradePickOptions.map((t) => ({ value: t, label: t }))],
    [tradePickOptions],
  );

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader title="Partners" subtitle="Manage your partner network and performance.">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Tabs
              variant="pills"
              className="max-w-full"
              tabs={[
                { id: "directory", label: "Directory", count: totalPartners },
                { id: "team", label: "Team (App)", count: teamMembers.length },
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
              size="sm"
              className="shrink-0 whitespace-nowrap w-full sm:w-auto"
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
              <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {teamMembers.map((member) => (
                  <motion.button
                    key={member.id}
                    type="button"
                    variants={staggerItem}
                    onClick={() => setSelectedTeamMember(member)}
                    className="text-left rounded-2xl border border-border-light bg-surface-hover/20 hover:bg-surface-hover/50 hover:border-primary/20 transition-all p-4 flex flex-col gap-3 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={member.full_name} size="lg" src={member.avatar_url} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-text-primary truncate">{member.full_name}</p>
                        <p className="text-xs text-text-tertiary truncate">{member.email}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                          <span>{member.jobs_count} jobs</span>
                          <span className="font-medium text-emerald-600">{formatCurrency(member.total_earnings)}</span>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-text-tertiary shrink-0 mt-1" aria-hidden />
                    </div>
                  </motion.button>
                ))}
              </StaggerContainer>
            )}
          </motion.div>
        )}

        {viewMode === "directory" && (
        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="rounded-2xl border border-border-light bg-card/80 backdrop-blur-sm overflow-hidden">
            <div className="px-4 pt-4 pb-2 border-b border-border-light flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end w-full lg:max-w-3xl lg:ml-auto">
                <div
                  className={cn(
                    "inline-flex self-end sm:self-auto rounded-xl border border-primary/25 bg-gradient-to-b from-card to-primary/[0.06]",
                    "p-[3px] gap-0.5 shadow-inner dark:border-primary/35 dark:to-primary/[0.08] shrink-0",
                  )}
                  role="group"
                  aria-label="Partners directory layout"
                >
                  <button
                    type="button"
                    aria-pressed={directoryDisplayMode === "list"}
                    onClick={() => setDirectoryDisplayMode("list")}
                    className={cn(
                      "relative rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                      directoryDisplayMode === "list"
                        ? "font-semibold text-text-primary shadow-sm bg-card ring-1 ring-primary/25 dark:ring-primary/40"
                        : "font-medium text-text-primary/72 hover:text-text-primary",
                    )}
                    title="List view"
                  >
                    <LayoutList className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-pressed={directoryDisplayMode === "grid"}
                    onClick={() => setDirectoryDisplayMode("grid")}
                    className={cn(
                      "relative rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                      directoryDisplayMode === "grid"
                        ? "font-semibold text-text-primary shadow-sm bg-card ring-1 ring-primary/25 dark:ring-primary/40"
                        : "font-medium text-text-primary/72 hover:text-text-primary",
                    )}
                    title="Grid view"
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-pressed={directoryDisplayMode === "kanban"}
                    onClick={() => setDirectoryDisplayMode("kanban")}
                    className={cn(
                      "relative rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                      directoryDisplayMode === "kanban"
                        ? "font-semibold text-text-primary shadow-sm bg-card ring-1 ring-primary/25 dark:ring-primary/40"
                        : "font-medium text-text-primary/72 hover:text-text-primary",
                    )}
                    title="Kanban by type of work"
                  >
                    <Columns3 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {directoryDisplayMode !== "kanban" ? (
                  <Select
                    value={tradeFilter}
                    onChange={(e) => {
                      setTradeFilter(e.target.value);
                      setPage(1);
                    }}
                    options={tradeCatalogSelectOptions}
                    className="min-w-[160px] shrink-0 w-full sm:w-auto"
                  />
                ) : null}
                <SearchInput
                  placeholder="Search partners…"
                  className="flex-1 w-full min-w-0 sm:min-w-[200px]"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} className="shrink-0 w-full sm:w-auto">
                  Filter
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PARTNER_DIRECTORY_STAGE_FILTERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatusFilter(s.id)}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
                      statusFilter === s.id
                        ? "bg-primary text-white"
                        : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {directoryDisplayMode === "kanban" ? (
              <PartnersDirectoryKanbanView
                partners={kanbanPartners}
                columnLabels={kanbanColumnLabels}
                loading={kanbanLoading}
                totalItems={kanbanTotalItems}
                catalogServices={partnerCatalogServices}
                selectedPartnerId={selectedPartner?.id}
                onOpenPartner={(p) => {
                  setPartnerDrawerInitialTab(undefined);
                  setSelectedPartner(p);
                }}
              />
            ) : directoryDisplayMode === "list" ? (
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
                pageSize={PARTNERS_PAGE_SIZE}
                onPageChange={setPage}
                loading={loading}
                selectable={isAdmin}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                className="rounded-none rounded-b-2xl border-0 border-t border-border-light shadow-none bg-transparent"
                bulkActions={
                  <>
                    <BulkActionBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                    <BulkActionBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="danger" />
                    <BulkActionBtn label="Needs attention" onClick={() => handleBulkStatusChange("needs_attention")} variant="warning" />
                    <div className="h-4 w-px bg-border" />
                    <BulkActionBtn label="Verify All" onClick={() => handleBulkVerify(true)} variant="success" />
                    <BulkActionBtn label="Unverify" onClick={() => handleBulkVerify(false)} variant="default" />
                    <div className="h-4 w-px bg-border" />
                    <BulkActionBtn label="Enviar e-mail" onClick={handleBulkOutreach} variant="default" />
                  </>
                }
              />
            ) : (
              <PartnersDirectoryGridView
                data={partners}
                loading={loading}
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                onPageChange={setPage}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                selectedPartnerId={selectedPartner?.id}
                onOpenPartner={(p) => {
                  setPartnerDrawerInitialTab(undefined);
                  setSelectedPartner(p);
                }}
                isAdmin={isAdmin}
                bulkActionsSlot={
                  <>
                    <BulkActionBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                    <BulkActionBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="danger" />
                    <BulkActionBtn label="Needs attention" onClick={() => handleBulkStatusChange("needs_attention")} variant="warning" />
                    <div className="h-4 w-px bg-border" />
                    <BulkActionBtn label="Verify All" onClick={() => handleBulkVerify(true)} variant="success" />
                    <BulkActionBtn label="Unverify" onClick={() => handleBulkVerify(false)} variant="default" />
                    <div className="h-4 w-px bg-border" />
                    <BulkActionBtn label="Enviar e-mail" onClick={handleBulkOutreach} variant="default" />
                  </>
                }
                catalogServices={partnerCatalogServices}
              />
            )}
          </div>
        </motion.div>
        )}
      </div>

      <PartnerDetailDrawer
        partner={selectedPartner}
        teamMember={selectedTeamMember}
        initialTab={partnerDrawerInitialTab}
        tradePickOptions={tradePickOptions}
        partnerCatalogForIds={partnerCatalogServices}
        partnerDocumentRules={partnerDocumentRules}
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
        <div className="px-4 sm:px-6 pt-3 pb-3 border-b border-border-light">
          <nav className="flex flex-wrap items-center gap-1.5 sm:gap-2" aria-label="Add partner steps">
            {CREATE_PARTNER_WIZARD_STEPS.map((step, i) => {
              const active = createWizardStep === step.id;
              const done = i < createWizardStepIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    if (i > createWizardStepIndex) {
                      const err = validateCreatePartnerWizardStep(createWizardStep, form);
                      if (err && createWizardStep === "info") {
                        toast.error(err);
                        return;
                      }
                      if (createWizardStep === "info" && step.id !== "info") {
                        const infoErr = validateCreatePartnerWizardStep("info", form);
                        if (infoErr) {
                          toast.error(infoErr);
                          return;
                        }
                      }
                    }
                    setCreateWizardStep(step.id);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary ring-1 ring-primary/25"
                      : done
                        ? "text-text-secondary hover:bg-surface-hover"
                        : "text-text-tertiary hover:text-text-secondary hover:bg-surface-hover",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                      active ? "bg-primary text-white" : done ? "bg-emerald-500/15 text-emerald-700" : "bg-surface-tertiary text-text-tertiary",
                    )}
                  >
                    {done && !active ? "✓" : i + 1}
                  </span>
                  {step.label}
                  {step.id === "documents" && pendingCreateDocs.length > 0 ? (
                    <span className="text-[10px] font-bold tabular-nums opacity-80">({pendingCreateDocs.length})</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="px-4 sm:px-6 py-4 space-y-3 max-h-[min(70vh,36rem)] overflow-y-auto overscroll-contain">
          {createWizardStep === "info" ? (
            <>
          <div className="flex items-center gap-3 pb-1">
            <Avatar
              name={form.company_name.trim() || "Partner"}
              size="md"
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
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => createAvatarInputRef.current?.click()}>
                Photo
              </Button>
              {createAvatarFile ? (
                <button type="button" className="text-[11px] text-text-tertiary hover:text-text-secondary underline" onClick={() => setCreateAvatarFile(null)}>
                  Remove
                </button>
              ) : null}
              <span className="text-[11px] text-text-tertiary">Optional · max 5 MB</span>
            </div>
          </div>
          <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 space-y-2">
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
            <PartnerCoverageEditor
              mode={createCoverageMode}
              onModeChange={(next) => {
                if (next === createCoverageMode) return;
                setCreateCoverageMode(next);
                if (next === "radius") {
                  setCreateCoverageOutward(new Set());
                } else {
                  setCreateCoverageAddress("");
                  setCreateCoverageLat(null);
                  setCreateCoverageLng(null);
                  setCreateCoverageOutward(new Set(defaultLondonIncludedPostcodes()));
                }
              }}
              radiusMiles={createRadiusMiles}
              onRadiusMilesChange={setCreateRadiusMiles}
              baseAddress={createCoverageAddress}
              onBaseLocationChange={(address, lat, lng) => {
                setCreateCoverageAddress(address);
                setCreateCoverageLat(lat);
                setCreateCoverageLng(lng);
              }}
              baseLat={createCoverageLat}
              baseLng={createCoverageLng}
              cityId={createCoverageCityId}
              onCityIdChange={setCreateCoverageCityId}
              selectedOutward={createCoverageOutward}
              onSelectedOutwardChange={setCreateCoverageOutward}
            />
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">Trades <span className="text-text-tertiary font-normal">(select all that apply)</span></label>
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto overscroll-contain rounded-lg border border-border-light bg-card/50 p-2">
                {tradePickOptions.map((t) => {
                  const active = form.trades.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, trades: active ? f.trades.filter((x) => x !== t) : [...f.trades, t] }))}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${active ? "border-primary bg-primary/10 text-primary" : "border-border-light bg-card text-text-secondary hover:border-border"}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            </>
          ) : createWizardStep === "documents" ? (
            <div className="space-y-3">
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
          ) : (
            <PartnerServiceRatesCreateStep
              trades={form.trades}
              catalogServices={partnerCatalogServices}
              drafts={pendingCreateRateDrafts}
              onDraftsChange={setPendingCreateRateDrafts}
            />
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 px-4 sm:px-6 py-3 border-t border-border-light">
          <p className="text-[11px] text-text-tertiary hidden sm:block">
            Step {createWizardStepIndex + 1} of {CREATE_PARTNER_WIZARD_STEPS.length}
            {createWizardStep === "documents" ? " · documents optional" : createWizardStep === "rates" ? " · rates optional" : ""}
          </p>
          <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            {createWizardStepIndex > 0 ? (
              <Button variant="outline" size="sm" icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={goCreateWizardBack}>
                Back
              </Button>
            ) : null}
            {!isLastCreateWizardStep ? (
              <Button size="sm" icon={<ChevronRight className="h-3.5 w-3.5" />} onClick={goCreateWizardNext}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={handleCreate} disabled={submitting}>
                {submitting ? "Creating…" : "Create Partner"}
              </Button>
            )}
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

/** Trim and fix common typos (e.g. trailing dot after TLD) so Postgres / validators accept the email. */
function normalizePartnerOverviewEmail(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  return t.replace(/\.+$/g, "");
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
    partner_address: partner.partner_address ?? "",
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

function ContractsTab({ partnerId }: { partnerId: string }) {
  const [signatures, setSignatures] = useState<
    { id: string; contract_type: string; signer_full_name: string; signer_email: string; signed_at: string; signature_image_url: string; signature_pdf_url: string | null; device_info: string | null; signer_ip: string | null; contract_version_id: string }[]
  >([]);
  const [versions, setVersions] = useState<
    { id: string; contract_type: string; version: string; title: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    const supabase = getSupabase();
    Promise.all([
      supabase
        .from("partner_contract_signatures")
        .select("id, contract_type, signer_full_name, signer_email, signed_at, signature_image_url, signature_pdf_url, device_info, signer_ip, contract_version_id")
        .eq("partner_id", partnerId)
        .order("signed_at", { ascending: false }),
      supabase
        .from("contract_versions")
        .select("id, contract_type, version, title")
        .eq("is_active", true),
    ]).then(([sigRes, verRes]) => {
      if (cancelled) return;
      setSignatures((sigRes.data ?? []) as typeof signatures);
      setVersions((verRes.data ?? []) as typeof versions);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [partnerId]);

  if (loading) {
    return <div className="p-6 text-sm text-text-tertiary">Carregando contratos...</div>;
  }

  const signedMap = new Map(signatures.map((s) => [s.contract_type, s]));

  return (
    <div className="p-6 space-y-4">
      <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
        Contratos do Partner
      </div>

      {versions.length === 0 && (
        <p className="text-sm text-text-tertiary">Nenhuma versão de contrato ativa no sistema.</p>
      )}

      {versions.map((v) => {
        const sig = signedMap.get(v.contract_type);
        return (
          <div
            key={v.id}
            className="rounded-xl border border-border-light p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-text-primary">{v.title}</div>
                <div className="text-[11px] text-text-tertiary">Versão {v.version}</div>
              </div>
              {sig ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/50 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Assinado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-md bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/50 dark:bg-amber-950/30 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Pendente
                </span>
              )}
            </div>

            {sig && (
              <div className="text-xs text-text-secondary space-y-1 pt-1 border-t border-border-light">
                <div><strong>Assinado por:</strong> {sig.signer_full_name} ({sig.signer_email})</div>
                <div><strong>Data:</strong> {new Date(sig.signed_at).toLocaleString("pt-BR")}</div>
                {sig.device_info && <div><strong>Dispositivo:</strong> {sig.device_info}</div>}
                {sig.signer_ip && <div><strong>IP:</strong> {sig.signer_ip}</div>}
                {sig.signature_image_url && (
                  <div className="pt-2">
                    <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Assinatura</div>
                    <div className="rounded-lg border border-border-light bg-white p-2 inline-block">
                      <img src={sig.signature_image_url} alt="Assinatura" className="h-12 object-contain" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
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
  tradePickOptions = [GENERAL_MAINTENANCE_LABEL],
  partnerCatalogForIds = [],
  partnerDocumentRules,
}: {
  partner: Partner | null;
  teamMember: TeamMember | null;
  /** When opening the drawer (e.g. after create), start on this tab. */
  initialTab?: string;
  tradePickOptions?: readonly string[];
  /** Services catalogue — used to sync `catalog_service_ids` when trades change. */
  partnerCatalogForIds?: CatalogService[];
  partnerDocumentRules: PartnerDocRuleRow[];
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
  const [actionPassword, setActionPassword] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [bankSortCodeInput, setBankSortCodeInput] = useState("");
  const [bankAccountNumberInput, setBankAccountNumberInput] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankSaving, setBankSaving] = useState(false);
  const [partnerPaymentTerms, setPartnerPaymentTerms] = useState("");
  const [partnerDefaultCancelFee, setPartnerDefaultCancelFee] = useState("");
  const [defaultFeeSaving, setDefaultFeeSaving] = useState(false);
  const [paymentTermsSaving, setPaymentTermsSaving] = useState(false);
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
    partner_address: "",
  });
  const [ratingMeta, setRatingMeta] = useState({ complaintCount: 0, pointsLost: 0 });
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
    () => (partner ? getPartnerPortalAllowlistOptions(partner, partnerDocumentRules) : []),
    [partner, partnerDocumentRules],
  );

  useEffect(() => {
    if (!portalLinkModalOpen || !partner) return;
    setPortalLinkSelectedIds(new Set(getPartnerPortalAllowlistIds(partner, partnerDocumentRules)));
  }, [portalLinkModalOpen, partner, partnerDocumentRules]);

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
    if (!partner?.id) return;
    let cancelled = false;
    void refreshPartnerRating(partner.id)
      .then((meta) => {
        if (cancelled) return;
        setRatingMeta({ complaintCount: meta.complaintCount, pointsLost: meta.pointsLost });
        const stored = partner.rating ?? PARTNER_RATING_MAX;
        if (Math.abs(stored - meta.rating) > 0.009) {
          onPartnerUpdate?.({ ...partner, rating: meta.rating });
        }
      })
      .catch(() => {
        if (!cancelled) setRatingMeta({ complaintCount: 0, pointsLost: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [partner?.id]);

  useEffect(() => {
    if (!partner) return;
    setBankSortCodeInput(formatUkSortCodeForDisplay(partner.bank_sort_code ?? ""));
    setBankAccountNumberInput(partner.bank_account_number ?? "");
    setBankAccountHolder(partner.bank_account_holder ?? "");
    setBankName(partner.bank_name ?? "");
    setPartnerPaymentTerms(partner.payment_terms ?? "");
    setPartnerDefaultCancelFee(
      partner.default_partner_cancel_fee_gbp != null && Number(partner.default_partner_cancel_fee_gbp) > 0
        ? String(partner.default_partner_cancel_fee_gbp)
        : "",
    );
  }, [
    partner?.id,
    partner?.bank_sort_code,
    partner?.bank_account_number,
    partner?.bank_account_holder,
    partner?.bank_name,
    partner?.payment_terms,
    partner?.default_partner_cancel_fee_gbp,
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

  const handleSavePaymentTerms = useCallback(async () => {
    if (!partner) return;
    setPaymentTermsSaving(true);
    try {
      await onPartnerPatch({ payment_terms: partnerPaymentTerms.trim() || null });
      toast.success("Payment terms saved.");
    } finally {
      setPaymentTermsSaving(false);
    }
  }, [partner, partnerPaymentTerms, onPartnerPatch]);

  const partnerDefaultFeeDirty =
    !!partner &&
    partnerDefaultCancelFee.trim() !==
      (partner.default_partner_cancel_fee_gbp != null && Number(partner.default_partner_cancel_fee_gbp) > 0
        ? String(partner.default_partner_cancel_fee_gbp)
        : "");

  const handleSaveDefaultPartnerCancelFee = useCallback(async () => {
    if (!partner) return;
    const n = Number(partnerDefaultCancelFee);
    const value =
      partnerDefaultCancelFee.trim() !== "" && Number.isFinite(n) && n > 0
        ? Math.round(n * 100) / 100
        : null;
    setDefaultFeeSaving(true);
    try {
      await onPartnerPatch({ default_partner_cancel_fee_gbp: value });
      toast.success(value != null ? "Default cancellation fee saved." : "Default cancellation fee cleared.");
    } finally {
      setDefaultFeeSaving(false);
    }
  }, [partner, partnerDefaultCancelFee, onPartnerPatch]);

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
        toast.error("No profile with that email. They need to register in the Fixfy app first.");
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
    const emailNorm = normalizePartnerOverviewEmail(overviewForm.email);
    if (!emailNorm || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*$/.test(emailNorm)) {
      toast.error("Enter a valid email address.");
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
        email: emailNorm,
        phone: overviewForm.phone.trim() || undefined,
        partner_address: overviewForm.partner_address.trim() || null,
      });
      onPartnerUpdate?.(updated);
      setEditingOverview(false);
      toast.success("Partner updated");
    } catch (err: unknown) {
      const e = err as { message?: string; details?: string; hint?: string };
      const parts = [e.message, e.details, e.hint].filter(Boolean);
      toast.error(parts.length ? parts.join(" — ") : "Failed to update");
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
    () => (partner ? partnerTradesForDisplay(partner, partnerCatalogForIds) : []),
    [partner, partnerCatalogForIds],
  );
  const mandatoryDocsForScore = partner
    ? buildFullMandatoryDocsForComplianceScore(partner, partnerTradesForCompliance, partnerDocumentRules)
    : [];
  const tradeCertificateDocs = partner
    ? buildTradeCertificateRequirements(partnerTradesForCompliance, partnerDocumentRules)
    : [];
  const requiredDocuments = useMemo(
    () =>
      partner
        ? buildRequiredDocumentChecklist(partnerTradesForCompliance, partner, partnerDocumentRules)
        : [],
    [partner, partnerTradesForCompliance, partnerDocumentRules],
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
      await onPartnerPatch({
        status: "active",
        partner_status_reasons: force ? ["force_activated"] : [],
      });
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
                    {appProfile.phone &&
                      (() => {
                        const wa = whatsAppHrefFromPhone(appProfile.phone);
                        return (
                          <div className="flex items-center gap-2 text-text-secondary">
                            <Phone className="h-4 w-4 shrink-0" />
                            <span>{appProfile.phone}</span>
                            {wa ? (
                              <a
                                href={wa}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 rounded-md text-emerald-600 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                                aria-label={`WhatsApp ${appProfile.phone}`}
                              >
                                <WhatsAppChatIcon className="h-4 w-4" />
                              </a>
                            ) : null}
                          </div>
                        );
                      })()}
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
                  <label className="block text-xs font-medium text-text-secondary mb-1">Set new password</label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={actionPassword}
                      onChange={(e) => setActionPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="flex-1"
                      autoComplete="new-password"
                    />
                    <Button
                      size="sm"
                      icon={<KeyRound className="h-3.5 w-3.5" />}
                      disabled={actionSubmitting || actionPassword.length < 8}
                      onClick={async () => {
                        setActionSubmitting(true);
                        try {
                          const res = await fetch("/api/admin/partner/reset-password", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: teamMember.id, new_password: actionPassword }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Failed");
                          toast.success("Password updated");
                          setActionPassword("");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setActionSubmitting(false);
                        }
                      }}
                    >
                      Set password
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Or send recovery link</label>
                  <Button size="sm" variant="outline" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={actionSubmitting} onClick={async () => {
                    setActionSubmitting(true);
                    try {
                      const res = await fetch("/api/admin/partner/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: teamMember.id }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success(data.reset_link ? "Link copied to clipboard" : data.message);
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
  const shownRating = displayPartnerRating(partner.rating);
  if (shownRating > 0 && shownRating < 3) {
    overviewAlerts.push({
      key: "low-rating",
      level: "warning",
      text: `Low rating (${shownRating}/${PARTNER_RATING_MAX}). Review complaints and service quality.`,
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
    { id: "trades", label: "Trades & skills" },
    { id: "coverage", label: "Coverage" },
    { id: "documents", label: "Documents", count: documents.length },
    { id: "financial", label: "Financial", count: selfBills.length },
    { id: "jobs", label: "Jobs", count: realJobsCount },
    {
      id: "compliance",
      label: "Compliance",
      count: complianceAttentionCount > 0 ? complianceAttentionCount : undefined,
    },
    { id: "rates" as const, label: "Rate card" },
    { id: "contracts" as const, label: "Contracts" },
    { id: "actions" as const, label: "Privacy & Permissions" },
    { id: "notes", label: "Notes", count: notes.length },
    ...(partner.auth_user_id ? [{ id: "location" as const, label: "Location" }] : []),
  ];

  return (
    <Drawer
      open={!!partner}
      onClose={onClose}
      title={partner.company_name}
      subtitle={formatPartnerCoverageSummary(partner) || "Coverage TBC"}
      headerExtra={
        <PartnerTradesIconStrip
          trades={partnerTradesForDisplay(partner, partnerCatalogForIds)}
          catalogServices={partnerCatalogForIds}
          className="max-w-full min-w-0"
        />
      }
      width="w-[min(100vw-1rem,40rem)]"
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
                  {!editingOverview ? (
                    <PartnerTradesIconStrip
                      trades={partnerTradesForDisplay(partner, partnerCatalogForIds)}
                      catalogServices={partnerCatalogForIds}
                      className="max-w-[min(100%,20rem)]"
                    />
                  ) : null}
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
                    (() => {
                      const wa = whatsAppHrefFromPhone(partner.phone);
                      return (
                        <span className="flex items-center gap-2 flex-wrap min-w-0">
                          <span>{partner.phone}</span>
                          {wa ? (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0 rounded-md text-emerald-600 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                              aria-label={`WhatsApp ${partner.phone}`}
                            >
                              <WhatsAppChatIcon className="h-4 w-4" />
                            </a>
                          ) : null}
                        </span>
                      );
                    })()
                  )}
                </div>
              )}
              {editingOverview ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">Home / business address</label>
                  <Input
                    value={overviewForm.partner_address}
                    onChange={(e) => setOverviewForm((p) => ({ ...p, partner_address: e.target.value }))}
                    placeholder="Street, city, postcode"
                    className="text-sm"
                  />
                </div>
              ) : (
                <>
                  {(formatPartnerCoverageSummary(partner) || "").trim() ? (
                    <div className="flex items-start gap-2 text-sm text-text-secondary">
                      <MapPin className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="text-[10px] font-medium text-text-tertiary block">Coverage</span>
                        {formatPartnerCoverageSummary(partner)}
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline mt-0.5 block"
                          onClick={() => setTab("coverage")}
                        >
                          Edit in Coverage tab
                        </button>
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
                  ) : null}
                </>
              )}
              <div className="flex items-center gap-2 text-sm text-text-tertiary pt-1 border-t border-border-light/60">
                <Calendar className="h-4 w-4 shrink-0" />
                Joined {new Date(partner.joined_at).toLocaleDateString()}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Jobs</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : realJobsCount}</p>
                <p className="text-[10px] text-text-tertiary">{completedJobs} completed, {activeJobs} active</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Earned</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : formatCurrency(realEarnings)}</p>
                <p className="text-[10px] text-text-tertiary">from partner cost</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job Value</p>
                <p className="text-xl font-bold text-text-primary mt-1">{loadingJobs ? "..." : formatCurrency(totalJobValue)}</p>
                <p className="text-[10px] text-text-tertiary">total client value</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Rating</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  <span className="text-xl font-bold text-text-primary">
                    {displayPartnerRating(partner.rating)}
                  </span>
                  <span className="text-xs text-text-tertiary">/{PARTNER_RATING_MAX.toFixed(1)}</span>
                </div>
                <p className="text-[10px] text-text-tertiary mt-1 leading-snug">
                  Starts at {PARTNER_RATING_MAX}. Each partner-fault complaint costs{" "}
                  {ratingMeta.pointsLost > 0 ? `${ratingMeta.pointsLost} pts` : "0.5 pts"} (half if job completed,
                  full if cancelled).
                  {ratingMeta.complaintCount > 0
                    ? ` ${ratingMeta.complaintCount} complaint job(s) on record.`
                    : " No complaint jobs on record."}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <div className="flex items-center gap-1">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Compliance</p>
                  <span title="Profile completeness, required documents, and expired docs (higher penalty)" className="text-text-tertiary cursor-help">
                    <Info className="h-3 w-3" />
                  </span>
                </div>
                <div className="mt-1">
                  <span className="text-xl font-bold text-text-primary">{computedCompliance}</span>
                  <span className="text-xs text-text-tertiary ml-0.5">/100</span>
                  <Progress
                    value={computedCompliance}
                    size="sm"
                    color={computedCompliance >= 90 ? "emerald" : computedCompliance >= 70 ? "primary" : "amber"}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>
            {isAdmin && editingOverview && (
              <div className="flex flex-col @sm:flex-row gap-2">
                <Button size="sm" className="flex-1 min-h-10" onClick={handleSaveOverview}>
                  Save changes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 min-h-10"
                  onClick={() => {
                    setEditingOverview(false);
                    setOverviewForm(partnerOverviewFormFromPartner(partner));
                  }}
                >
                  Discard
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

        {/* ========== TRADES & SKILLS ========== */}
        {tab === "trades" && onPartnerUpdate && (
          <CatalogTradesSkillsTab
            kind="partner"
            partner={partner}
            onPartnerUpdate={onPartnerUpdate}
            canEdit={isAdmin}
          />
        )}

        {tab === "coverage" && onPartnerUpdate && (
          <PartnerCoverageTab partner={partner} onPartnerUpdate={onPartnerUpdate} canEdit={isAdmin} />
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

            {/* Payout terms */}
            <div className="rounded-xl border border-border-light bg-card p-4 sm:p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-surface-hover p-2 shrink-0" aria-hidden>
                  <DollarSign className="h-5 w-5 text-text-secondary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">Payout terms</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Controls the due date on self-bills. Leave blank to use the default (Friday after week close).
                  </p>
                </div>
              </div>
              <div>
                <label htmlFor="partner-payment-terms" className="block text-xs font-medium text-text-secondary mb-1">
                  Payment terms
                </label>
                <select
                  id="partner-payment-terms"
                  value={partnerPaymentTerms}
                  onChange={(e) => setPartnerPaymentTerms(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Default (Friday after week close)</option>
                  <option value="Net 7">Net 7 — 7 days after week end</option>
                  <option value="Net 14">Net 14 — 14 days after week end</option>
                  <option value="Net 30">Net 30 — 30 days after week end</option>
                  <option value="Every Friday">Weekly — every Friday</option>
                  <option value="Every 2 weeks on Friday">Biweekly — every 2nd Friday</option>
                  <option value="Monthly cutoff 26 pay Friday">Monthly — cutoff 26th, pay Friday</option>
                  <option value="Monthly cutoff 15 pay Friday">Monthly — cutoff 15th, pay Friday</option>
                </select>
              </div>
              <div>
                <label htmlFor="partner-default-cancel-fee" className="block text-xs font-medium text-text-secondary mb-1">
                  Default cancellation fee (£) — partner owes
                </label>
                <Input
                  id="partner-default-cancel-fee"
                  type="number"
                  min={0}
                  step="0.01"
                  value={partnerDefaultCancelFee}
                  onChange={(e) => setPartnerDefaultCancelFee(e.target.value)}
                  placeholder="Optional — suggested in dashboard Cancel job"
                />
                <p className="text-[10px] text-text-tertiary mt-1">
                  Falls back to company partner cancellation fee in Settings if empty.
                </p>
                <div className="flex justify-end gap-2 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!partnerDefaultFeeDirty || defaultFeeSaving}
                    onClick={() =>
                      setPartnerDefaultCancelFee(
                        partner?.default_partner_cancel_fee_gbp != null &&
                          Number(partner.default_partner_cancel_fee_gbp) > 0
                          ? String(partner.default_partner_cancel_fee_gbp)
                          : "",
                      )
                    }
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!partnerDefaultFeeDirty || defaultFeeSaving}
                    loading={defaultFeeSaving}
                    onClick={() => void handleSaveDefaultPartnerCancelFee()}
                  >
                    Save fee default
                  </Button>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={partnerPaymentTerms === (partner?.payment_terms ?? "") || paymentTermsSaving}
                  onClick={() => setPartnerPaymentTerms(partner?.payment_terms ?? "")}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={partnerPaymentTerms === (partner?.payment_terms ?? "") || paymentTermsSaving}
                  loading={paymentTermsSaving}
                  onClick={() => void handleSavePaymentTerms()}
                >
                  Save terms
                </Button>
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

        {/* ========== RATE CARD ========== */}
        {tab === "rates" && (
          <div className="p-6">
            <PartnerServiceRatesTabSection
              partnerId={partner.id}
              partner={{
                catalog_service_ids: partner.catalog_service_ids,
                trades: partner.trades,
                trade: partner.trade,
              }}
            />
          </div>
        )}

        {/* ========== CONTRACTS ========== */}
        {tab === "contracts" && (
          <ContractsTab partnerId={partner.id} />
        )}

        {/* ========== PRIVACY & PERMISSIONS ========== */}
        {tab === "actions" && (
          <div className="p-6 space-y-5">
            <div className="rounded-xl border border-border-light bg-card p-4">
              <div className="flex flex-col @sm:flex-row @sm:items-center @sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Verification status</p>
                  <p className="text-sm text-text-secondary mt-0.5">{partner.verified ? "Verified and approved" : "Not verified yet"}</p>
                </div>
                <Button
                  size="sm"
                  variant={partner.verified ? "outline" : "primary"}
                  className="shrink-0 self-start @sm:self-auto"
                  icon={partner.verified ? <XCircle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  onClick={() => onVerify(partner)}
                >
                  {partner.verified ? "Revoke" : "Verify"}
                </Button>
              </div>
            </div>

            {isAdmin && (
              <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Mobile app account</p>
                  <span
                    title="Link this partner to their Fixfy app login so they show under Team (App) even before their first job"
                    className="text-text-tertiary cursor-help"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </div>
                {partner.auth_user_id ? (
                  <div className="space-y-2">
                    <p className="text-sm text-text-secondary">
                      Linked to{" "}
                      <span className="font-semibold text-text-primary">{linkedAppProfile?.full_name ?? "App user"}</span>
                      {linkedAppProfile?.email && <span className="text-text-tertiary"> · {linkedAppProfile.email}</span>}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
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
                        Sync app profile
                      </Button>
                      <span
                        title="The app reads public.users (not only profiles). Use sync if they still see a missing profile after linking."
                        className="text-text-tertiary cursor-help"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </span>
                      <Button size="sm" variant="outline" disabled={linkBusy} onClick={() => void handleUnlinkAppUser()}>
                        Remove app link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col @sm:flex-row gap-2">
                    <Input
                      type="email"
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      placeholder="Email they use in the app"
                      className="flex-1 min-w-0"
                    />
                    <Button size="sm" className="shrink-0" disabled={linkBusy || !linkEmail.trim()} onClick={() => void handleLinkAppUser()}>
                      {linkBusy ? "Linking…" : "Link account"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Partner upload portal</p>
                  <span
                    title="Generate a secure link so this partner can upload only the documents you choose — public page, no login required"
                    className="text-text-tertiary cursor-help"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
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

            <div className="pt-4 border-t border-border-light space-y-4">
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
                  <label className="block text-xs font-medium text-text-secondary mb-1">Set new password</label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={actionPassword}
                      onChange={(e) => setActionPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="flex-1"
                      autoComplete="new-password"
                    />
                    <Button
                      size="sm"
                      icon={<KeyRound className="h-3.5 w-3.5" />}
                      disabled={actionSubmitting || actionPassword.length < 8}
                      onClick={async () => {
                        setActionSubmitting(true);
                        try {
                          const res = await fetch("/api/admin/partner/reset-password", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: partner.auth_user_id, new_password: actionPassword }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Failed");
                          toast.success("Password updated");
                          setActionPassword("");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setActionSubmitting(false);
                        }
                      }}
                    >
                      Set password
                    </Button>
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-1">
                    Sets the password directly. Share it with the partner securely.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Or send a recovery link
                  </label>
                  <Button size="sm" variant="outline" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={actionSubmitting} onClick={async () => {
                    setActionSubmitting(true);
                    try {
                      const res = await fetch("/api/admin/partner/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: partner.auth_user_id }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success(data.reset_link ? "Link copied to clipboard" : data.message);
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
                    const waBase = whatsAppHrefFromPhone(partner?.phone) ?? "https://wa.me/";
                    window.open(`${waBase}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
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

