"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, Trash2, Loader2, X, Save, Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { ArrivalSlotPicker } from "@/components/shared/arrival-slot-picker";
import { canonicalArrivalSlotValues } from "@/lib/job-arrival-window";
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
import { jobStatusRank } from "@/lib/job-phases";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";
import { cn, formatCurrency } from "@/lib/utils";
import { formatArrivalTimeRange } from "@/lib/schedule-calendar";
import { toast } from "sonner";
import type { CatalogService, Job, JobVisit, JobVisitStatus, Partner } from "@/types/database";

const STATUS_BADGE: Record<JobVisitStatus, { label: string; variant: "info" | "warning" | "success" | "default" }> = {
  scheduled:   { label: "Scheduled",   variant: "info" },
  in_progress: { label: "In progress", variant: "warning" },
  completed:   { label: "Completed",   variant: "success" },
  cancelled:   { label: "Cancelled",   variant: "default" },
};

/** Timestamps guardados -> par (from, mins) que o slot picker entende. */
function arrivalFromStored(startAt?: string | null, endAt?: string | null): {
  arrival_from: string;
  arrival_window_mins: string;
} {
  const from = startAt ? startAt.slice(11, 16) : "09:00";
  const mins = startAt && endAt
    ? Math.max(30, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000))
    : 180;
  const slot = canonicalArrivalSlotValues(from, mins);
  return { arrival_from: slot.from, arrival_window_mins: slot.mins };
}

/**
 * Modal da seção de visitas vai para o `body`.
 *
 * A seção agora mora dentro do card de Details, e algum ancestral carrega
 * `transform` (a animação de página). Com isso, `position: fixed` passa a se
 * ancorar nesse ancestral em vez da janela, e o modal abria mil pixels abaixo
 * da tela. O portal tira a árvore do modal de baixo do transform.
 */
function SectionPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  // Microtask como no resto do arquivo: setState direto no efeito é recusado
  // pela regra de render em cascata.
  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

type EditTarget = { mode: "create" } | { mode: "edit"; visit: JobVisit } | null;

/**
 * "Visits" tab — additional visits booked under one job (mig 161).
 *
 *   • Visit 1 (primary): linha de leitura montada a partir do job
 *     fields. To edit, the operator goes to the Details tab.
 *   • Visit 2+: CRUD em `job_visits`. Cada uma com seu parceiro,
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
  onVisitsChanged,
  onCompletePrimary,
  completePrimaryLabel,
  onFinishJob,
  onJobChanged,
}: {
  job: Job;
  /** Called by the tab when changes to visits should trigger a status review on the parent job. */
  onJobStatusBumpRequested?: (suggestedStatus: Job["status"]) => void;
  openCreateSignal?: number;
  /** Avisa o card para recarregar a próxima visita do topo. */
  onVisitsChanged?: () => void;
  /**
   * Fecha a VISITA 1, que é o próprio job. Vem do card porque quem sabe
   * avançar status é ele (`handleStatusChange` + as regras de `canAdvanceJob`).
   * `undefined` quando o job não está num estágio que aceite fechar.
   */
  onCompletePrimary?: () => Promise<boolean>;
  /** Rótulo da ação da visita 1, para a linha dizer o que o botão faz. */
  completePrimaryLabel?: string;
  /**
   * Fecha o trabalho: leva o job para Final checks quando ainda não está lá e
   * abre a revisão. Vem do card, que é quem tem o modal e as regras.
   */
  onFinishJob?: () => void;
  /** O job mudou no servidor (seguiu para a próxima visita): o card recarrega. */
  onJobChanged?: () => void;
}) {
  const [visits, setVisits] = useState<JobVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  /** Índice da visita recém-fechada: abre o "e agora?" logo depois do Done. */
  const [justCompleted, setJustCompleted] = useState<number | null>(null);
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

  // Visita extra começou: o job vai junto para In progress. O fim não sobe sozinho:
  // quem decide é o Done de cada visita, pela rota `advance` (19/10/2026).
  useEffect(() => {
    if (!onJobStatusBumpRequested) return;
    const live = visits.filter((v) => !v.deleted_at && v.status !== "cancelled");
    if (live.some((v) => v.status === "in_progress") && job.status === "scheduled") {
      onJobStatusBumpRequested("in_progress");
    }
  }, [visits, job.status, onJobStatusBumpRequested]);

  /** Depois de um Done: segue para a próxima visita ou, se era a última, oferece fechar. */
  async function avancar(index: number, primary: boolean) {
    const res = await fetch(`/api/jobs/${job.id}/visits/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primary }),
    });
    const r = (await res.json().catch(() => ({}))) as {
      kind?: "primary_pending" | "next_visit" | "finish";
      visit?: { visit_index: number; scheduled_date?: string | null };
      error?: string;
    };
    if (!res.ok) throw new Error(r.error || "Could not move the job on");
    if (r.kind === "next_visit" && r.visit) {
      toast.success(`Visit ${index} done · job back to Scheduled for visit ${r.visit.visit_index} on ${diaCurto(r.visit.scheduled_date)}`);
      onJobChanged?.();
      return "next" as const;
    }
    if (r.kind === "primary_pending") {
      toast.success(`Visit ${index} done · visit 1 is still open`);
      return "pending" as const;
    }
    // Última visita: o servidor pode ter voltado o job para In progress, então o card recarrega.
    onJobChanged?.();
    return "finish" as const;
  }

  async function handleComplete(visit: JobVisit) {
    try {
      const updated = await apiUpdateJobVisit(job.id, visit.id, { status: "completed" });
      setVisits((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      onVisitsChanged?.();
      const passo = await avancar(visit.visit_index, false);
      if (passo === "finish") setJustCompleted(visit.visit_index);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to complete visit");
    }
  }

  async function handleCompletePrimary() {
    try {
      const pendentes = visits.some((v) => !v.deleted_at && (v.status === "scheduled" || v.status === "in_progress"));
      if (pendentes) {
        await avancar(1, true);
        return;
      }
      // Sem outra visita: o caminho de sempre, que leva para Final review com as regras do job.
      if (!onCompletePrimary) return;
      const ok = await onCompletePrimary();
      if (ok) setJustCompleted(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to complete visit 1");
    }
  }

  async function handleCreate(input: CreateJobVisitInput) {
    try {
      const { visit: created, partnerNotified, clientNotified } = await apiCreateJobVisit(input);
      // O carimbo da confirmação sai depois do insert: a linha local já nasce com ele.
      setVisits((rows) => [
        ...rows,
        clientNotified?.ok ? { ...created, client_confirmation_sent_at: new Date().toISOString() } : created,
      ]);
      setEditTarget(null);
      const quem = [partnerNotified?.ok ? "partner" : null, clientNotified?.ok ? "client" : null].filter(Boolean);
      toast.success(
        `Visit ${created.visit_index} created${quem.length ? ` · ${quem.join(" and ")} notified on the ticket` : ""}`,
      );
      if (clientNotified && !clientNotified.ok) {
        toast.message(`Client not notified: ${clientNotified.skipped ?? clientNotified.error ?? "unknown"}`);
      }
      onVisitsChanged?.();
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
      onVisitsChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update visit");
    }
  }

  async function handleDelete(visit: JobVisit) {
    if (!confirm(`Remove visit ${visit.visit_index}? It comes off the partner self-bill too.`)) return;
    try {
      await apiDeleteJobVisit(job.id, visit.id);
      setVisits((rows) => rows.filter((r) => r.id !== visit.id));
      toast.success("Visit removed");
      onVisitsChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove visit");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading visits…</span>
      </div>
    );
  }

  const primary = jobToPrimaryVisit(job);
  /**
   * Sem parceiro na visita 1 não nasce visita 2: a visita 1 é o job, e sem
   * dono não há a quem pagar nem documento onde pendurar o resto. O servidor
   * repete a regra com 409.
   */
  const jobHasPartner = Boolean(job.partner_id?.trim());
  /**
   * A visita 1 é o job: feita quando ficou registrada (`primary_visit_done`) ou
   * quando o job já passou de campo (Final review em diante).
   */
  const primaryDone = Boolean(job.primary_visit_done) || jobStatusRank(job.status) >= 40;
  const primaryStatus: { label: string; variant: "info" | "warning" | "success" | "default" | "primary" } =
    job.status === "cancelled"
      ? { label: "Cancelled", variant: "default" }
      : primaryDone
        ? { label: "Completed", variant: "success" }
        : job.status === "in_progress"
          ? { label: "In progress", variant: "warning" }
          : { label: "Scheduled", variant: "info" };
  const vivas = visits.filter((v) => !v.deleted_at).sort((a, b) => a.visit_index - b.visit_index);
  const botaoAdd = (
    <Button
      size="sm"
      variant="outline"
      icon={<Plus className="h-3.5 w-3.5" />}
      disabled={!jobHasPartner}
      title={jobHasPartner ? "Book another visit for this job" : "Assign a partner to visit 1 first"}
      onClick={() => setEditTarget({ mode: "create" })}
    >
      Add visit
    </Button>
  );

  return (
    <div className="space-y-2.5">
      {vivas.length === 0 ? (
        // Quase todo job tem uma visita só: aqui fica uma linha, nada de tabela.
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border-light px-3 py-2">
          <p className="m-0 text-[12px] text-text-secondary">
            <span className="font-semibold text-text-primary">1 visit.</span>{" "}
            {jobHasPartner ? "Need to go back? Add another visit." : "Assign a partner to visit 1 before adding another."}
          </p>
          {botaoAdd}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[12px] text-text-secondary">
              <span className="font-semibold text-text-primary">{summary.count} visits</span>
              {" · "}client {formatCurrency(summary.totalClientPrice)}
              {" · "}partner {formatCurrency(summary.totalPartnerCost)}
            </p>
            {botaoAdd}
          </div>
          <div className="space-y-1.5">
            <VisitCard
              index={1}
              partner={primary.partner_name ?? "No partner"}
              service={job.title ?? null}
              date={primary.scheduled_date}
              startAt={primary.scheduled_start_at}
              endAt={primary.scheduled_end_at}
              clientPrice={primary.client_price}
              partnerCost={primary.partner_cost}
              statusLabel={primaryStatus.label}
              statusVariant={primaryStatus.variant}
              done={primaryDone}
              notified="Client and partner got the job confirmation"
              onComplete={!primaryDone && job.status !== "cancelled" && (onCompletePrimary || vivas.length) ? () => void handleCompletePrimary() : undefined}
              completeTitle={completePrimaryLabel ?? "Mark visit 1 done"}
            />
            {vivas.map((v) => (
              <VisitCard
                key={v.id}
                index={v.visit_index}
                partner={v.partner_name ?? "No partner"}
                service={v.catalog_service_name ?? null}
                date={v.scheduled_date ?? null}
                startAt={v.scheduled_start_at ?? null}
                endAt={v.scheduled_end_at ?? null}
                clientPrice={v.client_price}
                partnerCost={v.partner_cost}
                statusLabel={STATUS_BADGE[v.status].label}
                statusVariant={STATUS_BADGE[v.status].variant}
                done={v.status === "completed"}
                notified={
                  v.client_confirmation_sent_at
                    ? `Client notified ${new Date(v.client_confirmation_sent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : null
                }
                onEdit={() => setEditTarget({ mode: "edit", visit: v })}
                onDelete={() => handleDelete(v)}
                onComplete={v.status === "completed" || v.status === "cancelled" ? undefined : () => handleComplete(v)}
              />
            ))}
          </div>
        </>
      )}

      {justCompleted != null ? (
        <SectionPortal>
        <Modal open onClose={() => setJustCompleted(null)} title={`Visit ${justCompleted} done`} size="sm">
          <div className="space-y-4 p-4">
            <p className="text-sm text-text-secondary">That was the last visit booked. What happens next?</p>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => { setJustCompleted(null); setEditTarget({ mode: "create" }); }}
              >
                Add another visit
              </Button>
              <Button
                icon={<Check className="h-3.5 w-3.5" />}
                disabled={!onFinishJob}
                onClick={() => { setJustCompleted(null); onFinishJob?.(); }}
              >
                Finish the job
              </Button>
            </div>
            <p className="text-[11px] text-text-tertiary">
              Finishing moves the job to Final review and opens the review.
            </p>
          </div>
        </Modal>
        </SectionPortal>
      ) : null}

      {editTarget ? (
        <SectionPortal>
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
        </SectionPortal>
      ) : null}
    </div>
  );
}

function diaCurto(ymd: string | null | undefined): string {
  if (!ymd) return "the next date";
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Uma visita = um cartão. Feita fica riscada e apagada, mas fica: é o histórico do job. */
function VisitCard({
  index, partner, service, date, startAt, endAt, clientPrice, partnerCost,
  statusLabel, statusVariant, done, notified, onEdit, onDelete, onComplete, completeTitle,
}: {
  index: number;
  partner: string;
  service: string | null;
  date: string | null;
  startAt: string | null;
  endAt: string | null;
  clientPrice: number;
  partnerCost: number;
  statusLabel: string;
  statusVariant: "info" | "warning" | "success" | "default" | "primary";
  done: boolean;
  notified?: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onComplete?: () => void;
  completeTitle?: string;
}) {
  const janela = startAt && endAt ? formatArrivalTimeRange(startAt, endAt) : startAt ? startAt.slice(11, 16) : null;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border-light bg-card px-3 py-2", done && "bg-surface-hover/40")}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          done ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-primary/10 text-primary",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : `V${index}`}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("m-0 text-[13px] font-semibold tabular-nums text-text-primary", done && "text-text-tertiary line-through")}>
          {date ? diaCurto(date) : "No date"}
          {janela ? <span className="font-normal text-text-tertiary"> · {janela}</span> : null}
        </p>
        <p className="m-0 truncate text-[12px] text-text-secondary">
          <span className="text-text-tertiary">V{index} · </span>
          {partner}
          {service ? <span className="text-text-tertiary"> · {service}</span> : null}
        </p>
      </div>
      <div className="hidden shrink-0 text-right text-[11px] leading-tight tabular-nums sm:block">
        <p className="m-0 text-emerald-700 dark:text-emerald-400">{formatCurrency(clientPrice)} <span className="text-text-tertiary">client</span></p>
        <p className="m-0 text-rose-700 dark:text-rose-300">{formatCurrency(partnerCost)} <span className="text-text-tertiary">partner</span></p>
      </div>
      {notified ? (
        <span title={notified} aria-label={notified} className="shrink-0 text-text-tertiary">
          <Mail className="h-3.5 w-3.5" />
        </span>
      ) : null}
      <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
      <span className="flex shrink-0 items-center gap-1.5">
        {onComplete ? (
          <button
            type="button"
            onClick={onComplete}
            title={completeTitle ?? "Mark this visit done"}
            className="inline-flex items-center gap-1 rounded-md border border-border-light px-2 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:border-emerald-500/50 hover:text-emerald-600"
          >
            <Check className="h-3 w-3" />
            Done
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
  arrival_from: string;
  arrival_window_mins: string;
  client_price: string;
  partner_cost: string;
  scope: string;
}

const EMPTY_FORM: FormState = {
  catalog_service_id: "",
  partner_id: "",
  partner_name: "",
  scheduled_date: "",
  arrival_from: "09:00",
  arrival_window_mins: "180",
  client_price: "",
  partner_cost: "",
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
        ...arrivalFromStored(v.scheduled_start_at, v.scheduled_end_at),
        client_price: v.client_price?.toString() ?? "",
        partner_cost: v.partner_cost?.toString() ?? "",
        scope: v.scope ?? "",
      };
    }
    // Visita nova herda o serviço do job: quase sempre é o mesmo trabalho, e
    // já vindo escolhido o resolver de preço tem a tripla completa assim que
    // o parceiro entrar. Trocar é um clique.
    return { ...EMPTY_FORM, catalog_service_id: parentCatalogServiceId ?? "" };
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
      const startIso = ukWallClockToUtcIso(form.scheduled_date, form.arrival_from);
      const endIso = startIso
        ? new Date(new Date(startIso).getTime() + (Number(form.arrival_window_mins) || 180) * 60_000).toISOString()
        : null;
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
        // Materiais não são campo da visita: entram como extra no job, onde o
        // ledger já sabe alocá-los.
        materials_cost: target.mode === "edit" ? target.visit.materials_cost : 0,
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Date *</label>
            <Input type="date" value={form.scheduled_date} onChange={(e) => setForm((p) => ({ ...p, scheduled_date: e.target.value }))} />
          </div>
          <ArrivalSlotPicker
            arrivalFrom={form.arrival_from}
            arrivalWindowMins={form.arrival_window_mins}
            onPick={(from, mins) => setForm((p) => ({ ...p, arrival_from: from, arrival_window_mins: mins }))}
            rowLayout
          />
        </div>

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
            <option value="">No partner yet</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.company_name?.trim() || p.contact_name}{p.trade ? ` · ${p.trade}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1">Scope (optional)</label>
          <textarea
            value={form.scope}
            onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-border-light bg-surface px-3 py-2 text-sm"
            placeholder="What this visit covers. The partner sees this."
          />
        </div>

        {target.mode === "create" ? (
          <p className="m-0 text-[11px] text-text-tertiary">
            The client and the partner get a confirmation for this visit on the job&apos;s ticket.
          </p>
        ) : null}

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
