"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, X, Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { TimeSelect } from "@/components/ui/time-select";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { PricingSourceChip } from "@/components/shared/pricing-source-chip";
import { useResolvedJobPricing } from "@/hooks/use-resolved-job-pricing";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { listPartners } from "@/services/partners";
import {
  listJobVisits,
  jobToPrimaryVisit,
  summariseVisits,
  type CreateJobVisitInput,
} from "@/services/job-visits";
import {
  apiCreateJobVisit,
  apiDeleteJobVisit,
  apiUpdateJobVisit,
} from "@/services/job-visits-api";
import { getSupabase } from "@/services/base";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { CatalogService, Job, JobVisit, JobVisitStatus, Partner } from "@/types/database";

const STATUS_BADGE: Record<JobVisitStatus, { label: string; variant: "info" | "warning" | "success" | "default" }> = {
  scheduled:   { label: "Scheduled",   variant: "info" },
  in_progress: { label: "In progress", variant: "warning" },
  completed:   { label: "Completed",   variant: "success" },
  cancelled:   { label: "Cancelled",   variant: "default" },
};

type EditTarget = { mode: "create" } | { mode: "edit"; visit: JobVisit } | null;

/**
 * "Visits" tab — additional visits booked under one job (mig 161).
 *
 *   • Visit 1 (primary) — read-only card synthesised from the parent job's
 *     fields. To edit, the operator goes to the Details tab.
 *   • Visit 2+ — CRUD on `job_visits` rows. Each can have its own partner,
 *     service, schedule, and prices (resolved via mig 159/160 overrides).
 *
 * Status of the parent job is auto-derived in Etapa 5 (this tab triggers it
 * when a visit's status changes).
 */
export function VisitsTab({
  job,
  onJobStatusBumpRequested,
  /** Increment (e.g. from job header ⋮ menu) to open the “Add visit” modal when this tab is shown. */
  openCreateSignal = 0,
}: {
  job: Job;
  /** Called by the tab when changes to visits should trigger a status review on the parent job. */
  onJobStatusBumpRequested?: (suggestedStatus: Job["status"]) => void;
  openCreateSignal?: number;
}) {
  const [visits, setVisits] = useState<JobVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  /** Account ID resolved from the job's client (clients.source_account_id). Used by the pricing resolver. */
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
    });
    listJobVisits(job.id)
      .then((rows) => { if (!cancelled) setVisits(rows); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load visits"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [job.id]);

  useEffect(() => {
    if (!openCreateSignal) return;
    queueMicrotask(() => setEditTarget({ mode: "create" }));
  }, [openCreateSignal]);

  useEffect(() => {
    const cid = job.client_id?.trim();
    if (!cid) {
      queueMicrotask(() => setAccountId(null));
      return;
    }
    let cancelled = false;
    getSupabase()
      .from("clients")
      .select("source_account_id")
      .eq("id", cid)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const aid = (data as { source_account_id?: string | null } | null)?.source_account_id?.trim() ?? null;
        setAccountId(aid);
      });
    return () => { cancelled = true; };
  }, [job.client_id]);

  const summary = useMemo(() => summariseVisits(job, visits), [job, visits]);

  // Auto-derive parent status hints (Etapa 5).
  useEffect(() => {
    if (!onJobStatusBumpRequested) return;
    if (visits.length === 0) return;
    const live = visits.filter((v) => !v.deleted_at && v.status !== "cancelled");
    if (live.length === 0) return;
    const anyInProgress = live.some((v) => v.status === "in_progress");
    if (anyInProgress && job.status === "scheduled") {
      onJobStatusBumpRequested("in_progress");
      return;
    }
    const allCompleted = live.every((v) => v.status === "completed");
    if (allCompleted && job.status === "in_progress") {
      onJobStatusBumpRequested("final_check");
    }
  }, [visits, job.status, onJobStatusBumpRequested]);

  async function handleComplete(visit: JobVisit) {
    try {
      const updated = await apiUpdateJobVisit(job.id, visit.id, { status: "completed" });
      setVisits((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      toast.success(`Visit ${visit.visit_index} completed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to complete visit");
    }
  }

  async function handleCreate(input: CreateJobVisitInput) {
    try {
      const created = await apiCreateJobVisit(input);
      setVisits((rows) => [...rows, created]);
      setEditTarget(null);
      toast.success(`Visit ${created.visit_index} created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create visit");
    }
  }

  async function handleUpdate(id: string, patch: Partial<JobVisit>) {
    try {
      const updated = await apiUpdateJobVisit(job.id, id, patch);
      setVisits((rows) => rows.map((r) => r.id === id ? { ...r, ...updated } : r));
      setEditTarget(null);
      toast.success("Visit updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update visit");
    }
  }

  async function handleDelete(visit: JobVisit) {
    if (!confirm(`Remove visit ${visit.visit_index}? This soft-deletes the row.`)) return;
    try {
      await apiDeleteJobVisit(job.id, visit.id);
      setVisits((rows) => rows.filter((r) => r.id !== visit.id));
      toast.success("Visit removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove visit");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading visits…</span>
      </div>
    );
  }

  const primary = jobToPrimaryVisit(job);

  return (
    <div className="space-y-3 px-4 sm:px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Visits</p>
          <p className="text-xs text-text-secondary">
            {summary.count} {summary.count === 1 ? "visit" : "visits"}
            {" · "}client {formatCurrency(summary.totalClientPrice)}
            {" · "}partner {formatCurrency(summary.totalPartnerCost)}
          </p>
        </div>
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditTarget({ mode: "create" })}>
          Add visit
        </Button>
      </div>

      <div className="divide-y divide-border-light rounded-lg border border-border-light">
        <VisitRow
          index={1}
          title={primary.partner_name ?? "No partner"}
          service={job.title ?? null}
          date={primary.scheduled_date}
          startAt={primary.scheduled_start_at}
          clientPrice={primary.client_price}
          partnerCost={primary.partner_cost}
          statusLabel="From job"
          statusVariant="primary"
          note="Edit in Details"
        />
        {visits.map((v) => (
          <VisitRow
            key={v.id}
            index={v.visit_index}
            title={v.partner_name ?? "No partner"}
            service={v.catalog_service_name ?? null}
            date={v.scheduled_date ?? null}
            startAt={v.scheduled_start_at ?? null}
            clientPrice={v.client_price}
            partnerCost={v.partner_cost}
            statusLabel={STATUS_BADGE[v.status].label}
            statusVariant={STATUS_BADGE[v.status].variant}
            onEdit={() => setEditTarget({ mode: "edit", visit: v })}
            onDelete={() => handleDelete(v)}
            onComplete={v.status === "completed" || v.status === "cancelled" ? undefined : () => handleComplete(v)}
          />
        ))}
      </div>

      <p className="text-[11px] text-text-tertiary">
        Each line is its own assignment: own partner, own price, own confirmation email. Payouts for extra
        visits are not in self-bills yet.
      </p>

      {editTarget ? (
        <VisitEditModal
          target={editTarget}
          jobId={job.id}
          accountId={accountId}
          parentCatalogServiceId={job.catalog_service_id ?? null}
          parentCatalogPricingPresetId={job.catalog_pricing_preset_id ?? null}
          onClose={() => setEditTarget(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      ) : null}
    </div>
  );
}

/** Uma visita = uma linha. Parceiro, quando, quanto entra, quanto sai. */
function VisitRow({
  index, title, service, date, startAt, clientPrice, partnerCost,
  statusLabel, statusVariant, note, onEdit, onDelete, onComplete,
}: {
  index: number;
  title: string;
  service: string | null;
  date: string | null;
  startAt: string | null;
  clientPrice: number;
  partnerCost: number;
  statusLabel: string;
  statusVariant: "info" | "warning" | "success" | "default" | "primary";
  note?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onComplete?: () => void;
}) {
  const when = [
    date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null,
    startAt ? startAt.slice(11, 16) : null,
  ].filter(Boolean).join(" ");

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
      <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">V{index}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
        {title}
        {service ? <span className="font-normal text-text-tertiary"> · {service}</span> : null}
      </span>
      <span className="w-24 shrink-0 whitespace-nowrap text-text-secondary tabular-nums">{when || "No date"}</span>
      <span className="w-32 shrink-0 whitespace-nowrap text-right tabular-nums">
        <span className="text-emerald-700 dark:text-emerald-400">{formatCurrency(clientPrice)}</span>
        <span className="text-text-tertiary"> / </span>
        <span className="text-rose-700 dark:text-rose-300">{formatCurrency(partnerCost)}</span>
      </span>
      <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
      <span className="flex w-20 shrink-0 items-center justify-end gap-1.5">
        {note ? <span className="text-[10px] italic text-text-tertiary">{note}</span> : null}
        {onComplete ? (
          <button type="button" onClick={onComplete} title="Mark this visit done" aria-label="Complete visit"
            className="text-text-tertiary transition-colors hover:text-emerald-600">
            <Check className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" onClick={onEdit} title="Edit visit" aria-label="Edit visit"
            className="text-text-tertiary transition-colors hover:text-text-primary">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" onClick={onDelete} title="Remove visit" aria-label="Remove visit"
            className="text-text-tertiary transition-colors hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

// ─── Modal: create / edit visit ────────────────────────────────────────────

interface FormState {
  catalog_service_id: string;
  partner_id: string;
  partner_name: string;
  scheduled_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  client_price: string;
  partner_cost: string;
  materials_cost: string;
  scope: string;
}

const EMPTY_FORM: FormState = {
  catalog_service_id: "",
  partner_id: "",
  partner_name: "",
  scheduled_date: "",
  scheduled_start_time: "09:00",
  scheduled_end_time: "12:00",
  client_price: "",
  partner_cost: "",
  materials_cost: "0",
  scope: "",
};

function VisitEditModal({
  target, jobId, accountId,
  parentCatalogServiceId,
  parentCatalogPricingPresetId,
  onClose, onCreate, onUpdate,
}: {
  target: NonNullable<EditTarget>;
  jobId: string;
  accountId: string | null;
  parentCatalogServiceId?: string | null;
  parentCatalogPricingPresetId?: string | null;
  onClose: () => void;
  onCreate: (input: CreateJobVisitInput) => void;
  onUpdate: (id: string, patch: Partial<JobVisit>) => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (target.mode === "edit") {
      const v = target.visit;
      return {
        catalog_service_id: v.catalog_service_id ?? "",
        partner_id: v.partner_id ?? "",
        partner_name: v.partner_name ?? "",
        scheduled_date: v.scheduled_date ?? "",
        scheduled_start_time: v.scheduled_start_at ? v.scheduled_start_at.slice(11, 16) : "09:00",
        scheduled_end_time: v.scheduled_end_at ? v.scheduled_end_at.slice(11, 16) : "12:00",
        client_price: v.client_price?.toString() ?? "",
        partner_cost: v.partner_cost?.toString() ?? "",
        materials_cost: v.materials_cost?.toString() ?? "0",
        scope: v.scope ?? "",
      };
    }
    return EMPTY_FORM;
  });
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      listCatalogServicesForPicker(),
      listPartners({ pageSize: 200, status: "active" }).then((r) => r.data ?? []).catch(() => []),
    ]).then(([cat, ps]) => {
      setCatalog(cat);
      setPartners(ps);
    });
  }, []);

  const pricingPresetIdForResolver = useMemo(() => {
    const sid = form.catalog_service_id?.trim();
    const parent = parentCatalogServiceId?.trim();
    if (!sid || !parent || sid !== parent) return null;
    return parentCatalogPricingPresetId?.trim() || null;
  }, [form.catalog_service_id, parentCatalogServiceId, parentCatalogPricingPresetId]);

  // Pricing resolver — auto-fill prices when partner+service+account triple is set.
  const { pricing } = useResolvedJobPricing({
    accountId,
    partnerId: form.partner_id,
    catalogServiceId: form.catalog_service_id,
    pricingPresetId: pricingPresetIdForResolver,
  });

  // Track last-applied triple so we don't clobber operator edits.
  const lastAppliedTriple = useMemo(() => {
    return `${accountId ?? ""}|${form.partner_id}|${form.catalog_service_id}|${pricingPresetIdForResolver ?? ""}`;
  }, [accountId, form.partner_id, form.catalog_service_id, pricingPresetIdForResolver]);
  const [appliedTripleKey, setAppliedTripleKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pricing) return;
    if (lastAppliedTriple === appliedTripleKey) return;
    setAppliedTripleKey(lastAppliedTriple);
    setForm((p) => ({
      ...p,
      // Only fill empty fields to respect operator edits — but on create,
      // most are empty so this fills naturally.
      client_price: p.client_price || (pricing.pricing_mode === "hourly"
        ? (pricing.client.hourly_rate != null && pricing.client.default_hours != null
          ? String(pricing.client.hourly_rate * pricing.client.default_hours)
          : p.client_price)
        : (pricing.client.fixed_price?.toString() ?? p.client_price)),
      partner_cost: p.partner_cost || (pricing.pricing_mode === "hourly"
        ? (pricing.partner.hourly_partner_rate != null && pricing.partner.default_hours != null
          ? String(pricing.partner.hourly_partner_rate * pricing.partner.default_hours)
          : p.partner_cost)
        : (pricing.partner.fixed_partner_cost?.toString() ?? p.partner_cost)),
    }));
  }, [pricing, lastAppliedTriple, appliedTripleKey]);

  function pickPartner(id: string) {
    const p = partners.find((x) => x.id === id);
    setForm((s) => ({
      ...s,
      partner_id: id,
      partner_name: p ? (p.company_name?.trim() || p.contact_name) : s.partner_name,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.scheduled_date) {
      toast.error("Set a scheduled date for the visit");
      return;
    }
    setSaving(true);
    try {
      // Hora de parede de Londres, não string crua: `scheduled_start_at` é
      // timestamptz, e sem fuso a visita nascia deslocada no BST.
      const startIso = ukWallClockToUtcIso(form.scheduled_date, form.scheduled_start_time);
      const endIso = ukWallClockToUtcIso(form.scheduled_date, form.scheduled_end_time);
      if (!startIso || !endIso) {
        toast.error("Invalid date or time for this visit");
        setSaving(false);
        return;
      }
      const payload: CreateJobVisitInput = {
        job_id: jobId,
        catalog_service_id: form.catalog_service_id || null,
        partner_id: form.partner_id || null,
        partner_name: form.partner_name.trim() || null,
        scheduled_date: form.scheduled_date,
        scheduled_start_at: startIso,
        scheduled_end_at: endIso,
        expected_finish_at: endIso,
        client_price: Number(form.client_price) || 0,
        partner_cost: Number(form.partner_cost) || 0,
        materials_cost: Number(form.materials_cost) || 0,
        status: target.mode === "edit" ? target.visit.status : "scheduled",
        scope: form.scope.trim() || null,
        notes: null,
      };
      if (target.mode === "edit") {
        onUpdate(target.visit.id, payload);
      } else {
        onCreate(payload);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={target.mode === "edit" ? "Edit visit" : "Add visit"} size="md">
      <form onSubmit={handleSubmit} className="space-y-4 p-2">
        <ServiceCatalogSelect
          label="Service"
          catalog={catalog}
          value={form.catalog_service_id}
          onChange={(id) => setForm((p) => ({ ...p, catalog_service_id: id }))}
          compactOptionLabels
        />

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1">Partner</label>
          <select
            className="h-10 w-full rounded-lg border border-border-light bg-surface px-3 text-sm"
            value={form.partner_id}
            onChange={(e) => pickPartner(e.target.value)}
          >
            <option value="">— No partner yet —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.company_name?.trim() || p.contact_name} · {p.trade ?? "—"}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Date *</label>
            <Input type="date" value={form.scheduled_date} onChange={(e) => setForm((p) => ({ ...p, scheduled_date: e.target.value }))} />
          </div>
          <TimeSelect
            label="Start time"
            value={form.scheduled_start_time}
            onChange={(v) => setForm((p) => ({ ...p, scheduled_start_time: v }))}
          />
          <TimeSelect
            label="End time"
            value={form.scheduled_end_time}
            onChange={(v) => setForm((p) => ({ ...p, scheduled_end_time: v }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Client price (£)
              {pricing ? (
                <span className="ml-1.5">
                  <PricingSourceChip
                    source={pricing.pricing_mode === "hourly" ? pricing.client.hourly_rate_source : pricing.client.fixed_price_source}
                  />
                </span>
              ) : null}
            </label>
            <Input type="number" step="0.01" min={0} value={form.client_price}
              onChange={(e) => setForm((p) => ({ ...p, client_price: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Partner cost (£)
              {pricing ? (
                <span className="ml-1.5">
                  <PricingSourceChip
                    source={pricing.pricing_mode === "hourly" ? pricing.partner.hourly_partner_rate_source : pricing.partner.fixed_partner_cost_source}
                  />
                </span>
              ) : null}
            </label>
            <Input type="number" step="0.01" min={0} value={form.partner_cost}
              onChange={(e) => setForm((p) => ({ ...p, partner_cost: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Materials (£)</label>
            <Input type="number" step="0.01" min={0} value={form.materials_cost}
              onChange={(e) => setForm((p) => ({ ...p, materials_cost: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1">Scope (optional)</label>
          <textarea
            value={form.scope}
            onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-border-light bg-surface px-3 py-2 text-sm"
            placeholder="What this visit covers — surfaced to the partner."
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
          <Button type="button" variant="outline" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={saving}>
            {saving ? "Saving…" : target.mode === "edit" ? "Save changes" : "Add visit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
