"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Briefcase, AlertTriangle, ExternalLink, Layers, X, Save } from "lucide-react";
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
  createJobVisit,
  updateJobVisit,
  softDeleteJobVisit,
  setVisitStatus,
  jobToPrimaryVisit,
  summariseVisits,
  type CreateJobVisitInput,
} from "@/services/job-visits";
import { getSupabase } from "@/services/base";
import { formatCurrency, cn } from "@/lib/utils";
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
}: {
  job: Job;
  /** Called by the tab when changes to visits should trigger a status review on the parent job. */
  onJobStatusBumpRequested?: (suggestedStatus: Job["status"]) => void;
}) {
  const [visits, setVisits] = useState<JobVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  /** Account ID resolved from the job's client (clients.source_account_id). Used by the pricing resolver. */
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listJobVisits(job.id)
      .then((rows) => { if (!cancelled) setVisits(rows); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load visits"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [job.id]);

  useEffect(() => {
    const cid = job.client_id?.trim();
    if (!cid) { setAccountId(null); return; }
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

  async function handleCreate(input: CreateJobVisitInput) {
    try {
      const created = await createJobVisit(input);
      setVisits((rows) => [...rows, created]);
      setEditTarget(null);
      toast.success(`Visit ${created.visit_index} created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create visit");
    }
  }

  async function handleUpdate(id: string, patch: Partial<JobVisit>) {
    try {
      const updated = await updateJobVisit(id, patch);
      setVisits((rows) => rows.map((r) => r.id === id ? { ...r, ...updated } : r));
      setEditTarget(null);
      toast.success("Visit updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update visit");
    }
  }

  async function handleStatusChange(visit: JobVisit, status: JobVisitStatus) {
    try {
      const updated = await setVisitStatus(visit.id, status);
      setVisits((rows) => rows.map((r) => r.id === visit.id ? { ...r, ...updated } : r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  async function handleDelete(visit: JobVisit) {
    if (!confirm(`Remove visit ${visit.visit_index}? This soft-deletes the row.`)) return;
    try {
      await softDeleteJobVisit(visit.id);
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
    <div className="space-y-4 px-4 sm:px-5 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Layers className="h-4 w-4 text-text-tertiary" />
            All visits booked under this job
          </h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Visit 1 = the job itself. Add extra visits when more partners/services are needed.
          </p>
        </div>
        <Button
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setEditTarget({ mode: "create" })}
        >
          Add visit
        </Button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Visits" value={`${summary.count}`} />
        <SummaryTile label="Total client" value={formatCurrency(summary.totalClientPrice)} />
        <SummaryTile label="Total partner cost" value={formatCurrency(summary.totalPartnerCost)} />
      </div>

      <div className="space-y-2">
        {/* Primary card (read-only) */}
        <PrimaryVisitCard primary={primary} job={job} />

        {/* Extras */}
        {visits.map((v) => (
          <VisitCard
            key={v.id}
            visit={v}
            onEdit={() => setEditTarget({ mode: "edit", visit: v })}
            onDelete={() => handleDelete(v)}
            onStatusChange={(s) => handleStatusChange(v, s)}
          />
        ))}

        {visits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-light p-6 text-center text-xs text-text-tertiary">
            No extra visits yet. Click <strong>Add visit</strong> when you need another partner, service, or visit slot under this job.
          </div>
        ) : null}
      </div>

      {/* Self-bill caveat */}
      <div className="rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/15 p-3 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          <strong>Heads-up:</strong> partners on extra visits are NOT yet wired into self-bills.
          For now, track those payouts manually until the rollup ships next sprint.
        </p>
      </div>

      {editTarget ? (
        <VisitEditModal
          target={editTarget}
          jobId={job.id}
          accountId={accountId}
          onClose={() => setEditTarget(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-hover/30 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{label}</p>
      <p className="text-sm font-bold tabular-nums text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

function PrimaryVisitCard({ primary, job }: { primary: ReturnType<typeof jobToPrimaryVisit>; job: Job }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Briefcase className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-bold text-text-primary">Visit 1 — Primary</p>
            <Badge variant="primary" size="sm">From job</Badge>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {primary.partner_name ?? <span className="italic text-text-tertiary">No partner</span>}
            {" · "}
            {primary.scheduled_date ?? <span className="italic text-text-tertiary">No date</span>}
            {primary.scheduled_start_at ? ` · starts ${primary.scheduled_start_at.slice(11, 16)}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-text-tertiary">
            Client: <strong>{formatCurrency(primary.client_price)}</strong>
            {" · "}Partner: <strong>{formatCurrency(primary.partner_cost)}</strong>
            {primary.materials_cost > 0 ? ` · Materials: ${formatCurrency(primary.materials_cost)}` : ""}
          </p>
        </div>
        <span className="text-[10px] text-text-tertiary shrink-0 italic">
          Edit in <strong>Details</strong> tab
        </span>
      </div>
    </div>
  );
}

function VisitCard({
  visit, onEdit, onDelete, onStatusChange,
}: {
  visit: JobVisit;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (s: JobVisitStatus) => void;
}) {
  const cfg = STATUS_BADGE[visit.status];
  return (
    <div className={cn(
      "rounded-xl border bg-surface p-3",
      visit.status === "cancelled" ? "border-border-light opacity-60" : "border-border-light",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Layers className="h-4 w-4 text-text-tertiary shrink-0" />
            <p className="text-sm font-semibold text-text-primary">Visit {visit.visit_index}</p>
            <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
            {visit.catalog_service_name ? (
              <Badge variant="default" size="sm">{visit.catalog_service_name}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {visit.partner_name ?? <span className="italic text-text-tertiary">No partner</span>}
            {" · "}
            {visit.scheduled_date ?? <span className="italic text-text-tertiary">No date</span>}
            {visit.scheduled_start_at ? ` · starts ${visit.scheduled_start_at.slice(11, 16)}` : ""}
            {visit.scheduled_end_at ? ` · ends ${visit.scheduled_end_at.slice(11, 16)}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-text-tertiary">
            Client: <strong>{formatCurrency(visit.client_price)}</strong>
            {" · "}Partner: <strong>{formatCurrency(visit.partner_cost)}</strong>
            {visit.materials_cost > 0 ? ` · Materials: ${formatCurrency(visit.materials_cost)}` : ""}
          </p>
          {visit.scope ? <p className="mt-1 text-[11px] text-text-tertiary line-clamp-2">{visit.scope}</p> : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <select
            className="h-7 rounded-md border border-border-light bg-card px-2 text-[11px]"
            value={visit.status}
            onChange={(e) => onStatusChange(e.target.value as JobVisitStatus)}
          >
            {(Object.keys(STATUS_BADGE) as JobVisitStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_BADGE[s].label}</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>
          <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>Remove</Button>
        </div>
      </div>
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
  target, jobId, accountId, onClose, onCreate, onUpdate,
}: {
  target: NonNullable<EditTarget>;
  jobId: string;
  accountId: string | null;
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
      listPartners({ pageSize: 200, status: "all" }).then((r) => r.data ?? []).catch(() => []),
    ]).then(([cat, ps]) => {
      setCatalog(cat);
      setPartners(ps);
    });
  }, []);

  // Pricing resolver — auto-fill prices when partner+service+account triple is set.
  const { pricing } = useResolvedJobPricing({
    accountId,
    partnerId: form.partner_id,
    catalogServiceId: form.catalog_service_id,
  });

  // Track last-applied triple so we don't clobber operator edits.
  const lastAppliedTriple = useMemo(() => {
    return `${accountId ?? ""}|${form.partner_id}|${form.catalog_service_id}`;
  }, [accountId, form.partner_id, form.catalog_service_id]);
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
      const startIso = `${form.scheduled_date}T${form.scheduled_start_time}:00`;
      const endIso = `${form.scheduled_date}T${form.scheduled_end_time}:00`;
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
