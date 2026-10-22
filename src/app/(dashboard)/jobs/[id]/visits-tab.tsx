"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { VisitDoneModal } from "@/components/jobs/visit-done-modal";
import type { VisitDoneAmounts } from "@/lib/visit-done-billing";
import { Plus, Pencil, Trash2, Loader2, X, Save, Check, Mail, Link2, FileText } from "lucide-react";
import { JobReportV2Card } from "@/components/jobs/job-report-v2-card";
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
  apiUpdateJobVisit,
  confirmAndRemoveJobVisit,
  type JobFollowedVisit,
} from "@/services/job-visits-api";
import { getSupabase } from "@/services/base";
import { jobStatusRank } from "@/lib/job-phases";
import { effectiveJobStatusForDisplay } from "@/lib/job-partner-assign";
import { ukWallClockToUtcIso, utcIsoToUkWallClock } from "@/lib/utils/uk-time";
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
  // Hora de Londres, não o recorte do ISO em UTC: no BST ele dava 1h a menos
  // (job das 9h abria a visita às 8h, 19/10/2026).
  const from = startAt ? utcIsoToUkWallClock(startAt).hm || "09:00" : "09:00";
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
  /** Linha de visita da lista de Jobs abre aqui com `?visit=<id>`: a visita fica em destaque. */
  const visitaEmFoco = useSearchParams()?.get("visit") ?? null;
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  /** Índice da visita recém-fechada: abre o "e agora?" logo depois do Done. */
  const [justCompleted, setJustCompleted] = useState<number | null>(null);
  /** Visita cujo Done está sendo confirmado no modal do custo. */
  const [doneTarget, setDoneTarget] = useState<JobVisit | null>(null);
  /** Relatório de visita aberto para leitura (19/10/2026). */
  const [relatorioAberto, setRelatorioAberto] = useState<JobVisit | null>(null);
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

  /**
   * Done numa visita extra abre o modal do custo (22/10/2026): só o Confirm fecha
   * a visita, grava os valores finais e a põe no self-bill do parceiro dela.
   * Cancelar deixa a visita aberta.
   */
  function handleComplete(visit: JobVisit) {
    setDoneTarget(visit);
  }

  async function aposConfirmarDone(r: { visit: JobVisit; amounts: VisitDoneAmounts; payoutError: string | null }) {
    setDoneTarget(null);
    setVisits((rows) => rows.map((x) => (x.id === r.visit.id ? { ...x, ...r.visit } : x)));
    toast.success(
      `Visit ${r.visit.visit_index} done · client ${formatCurrency(r.amounts.clientToCharge)} · partner ${formatCurrency(r.amounts.partnerToPay)}`,
    );
    if (r.payoutError) toast.message(`Self-bill: ${r.payoutError}`);
    onVisitsChanged?.();
    try {
      const passo = await avancar(r.visit.visit_index, false);
      if (passo === "finish") setJustCompleted(r.visit.visit_index);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move the job on");
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

  async function copiarLinkDoRelatorio(visit: JobVisit) {
    try {
      const res = await fetch(`/api/jobs/${job.id}/visits/report?visitId=${encodeURIComponent(visit.id)}`);
      const r = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !r.url) throw new Error(r.error || "Could not build the report link");
      await navigator.clipboard.writeText(r.url);
      toast.success(`Visit ${visit.visit_index} report link copied`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not copy the link");
    }
  }

  async function aprovarRelatorio(visit: JobVisit, approve: boolean) {
    try {
      const res = await fetch(`/api/jobs/${job.id}/visits/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId: visit.id, approve }),
      });
      const r = (await res.json().catch(() => ({}))) as { visit?: JobVisit; error?: string };
      if (!res.ok || !r.visit) throw new Error(r.error || "Could not update the report");
      setVisits((rows) => rows.map((x) => (x.id === visit.id ? { ...x, ...r.visit } : x)));
      setRelatorioAberto((v) => (v && v.id === visit.id ? { ...v, ...r.visit } : v));
      toast.success(approve ? `Visit ${visit.visit_index} report approved` : "Approval removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the report");
    }
  }

  /** O job seguiu a visita (voltou para Scheduled, ou foi para In progress): diz e recarrega o card. */
  function avisarJobSeguiu(followed: JobFollowedVisit | undefined) {
    if (!followed?.ok || !followed.followed || !followed.visit) return;
    const rotulo = followed.status === "in_progress" ? "In progress" : "Scheduled";
    toast.success(`Job moved to ${rotulo} for visit ${followed.visit.visit_index}`);
    onJobChanged?.();
  }

  async function handleCreate(input: CreateJobVisitInput) {
    try {
      const { visit: created, partnerNotified, clientNotified, closedVisitIndex, advanced, followed } = await apiCreateJobVisit(input);
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
      if (closedVisitIndex != null && advanced?.ok && advanced.kind === "next_visit" && advanced.visit) {
        // A visita em andamento fechou junto: o job foi para a próxima, Scheduled.
        if (closedVisitIndex > 1) {
          setVisits((rows) => rows.map((r) => (r.visit_index === closedVisitIndex ? { ...r, status: "completed" } : r)));
        }
        toast.success(
          `Visit ${closedVisitIndex} marked done · job back to Scheduled for visit ${advanced.visit.visit_index} on ${diaCurto(advanced.visit.scheduled_date)}`,
        );
        onJobChanged?.();
      }
      avisarJobSeguiu(followed);
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
      const { followed, ...updated } = await apiUpdateJobVisit(job.id, id, patch);
      setVisits((rows) => rows.map((r) => r.id === id ? { ...r, ...updated } : r));
      setEditTarget(null);
      toast.success("Visit updated");
      avisarJobSeguiu(followed);
      onVisitsChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update visit");
    }
  }

  async function handleDelete(visit: JobVisit) {
    try {
      // Pergunta sempre; tira do self-bill, do total do job e da fatura na hora.
      if (!(await confirmAndRemoveJobVisit(job.id, visit))) return;
      setVisits((rows) => rows.filter((r) => r.id !== visit.id));
      toast.success(`Visit ${visit.visit_index} removed · self-bill and invoice updated`);
      onVisitsChanged?.();
      onJobChanged?.();
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
          : effectiveJobStatusForDisplay(job) === "late"
            ? { label: "Late", variant: "warning" }
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
      {/* Mesmo desenho com uma visita ou várias (dono, 20/10/2026): cabeçalho com o
          resumo e um cartão por visita. */}
      {(
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[12px] text-text-secondary">
              <span className="font-semibold text-text-primary">
                {summary.count} {summary.count === 1 ? "visit" : "visits"}
              </span>
              {" · "}client {formatCurrency(summary.totalClientPrice)}
              {" · "}partner {formatCurrency(summary.totalPartnerCost)}
            </p>
            {botaoAdd}
          </div>
          {!jobHasPartner ? (
            <p className="m-0 text-[11px] text-text-tertiary">Assign a partner to visit 1 before adding another visit.</p>
          ) : null}
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
              notified={jobHasPartner ? "Client and partner got the job confirmation" : null}
              onComplete={!primaryDone && job.status !== "cancelled" && (onCompletePrimary || vivas.length) ? () => void handleCompletePrimary() : undefined}
              completeTitle={completePrimaryLabel ?? "Mark visit 1 done"}
            />
            {vivas.map((v) => (
              <VisitCard
                key={v.id}
                domId={`visit-${v.id}`}
                focused={visitaEmFoco === v.id}
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
                report={{
                  submittedAt: v.report_submitted_at ?? null,
                  approvedAt: v.report_approved_at ?? null,
                  onView: () => setRelatorioAberto(v),
                  onCopyLink: v.partner_id ? () => void copiarLinkDoRelatorio(v) : undefined,
                  onApprove: () => void aprovarRelatorio(v, true),
                }}
                onEdit={() => setEditTarget({ mode: "edit", visit: v })}
                onDelete={() => handleDelete(v)}
                onComplete={v.status === "completed" || v.status === "cancelled" ? undefined : () => handleComplete(v)}
              />
            ))}
          </div>
        </>
      )}

      {relatorioAberto ? (
        <SectionPortal>
        <Modal
          open
          onClose={() => setRelatorioAberto(null)}
          title={`Visit ${relatorioAberto.visit_index} report`}
          size="lg"
          scrollBody
        >
          <div className="space-y-3 p-4">
            <JobReportV2Card
              jobId={job.id}
              kind="final"
              rawReport={relatorioAberto.final_report}
              rawStartReport={relatorioAberto.start_report}
              approvedAt={relatorioAberto.report_approved_at ?? null}
              readOnly
            />
            <div className="flex justify-end gap-2">
              {relatorioAberto.report_approved_at ? (
                <Button variant="outline" size="sm" onClick={() => void aprovarRelatorio(relatorioAberto, false)}>
                  Remove approval
                </Button>
              ) : (
                <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => void aprovarRelatorio(relatorioAberto, true)}>
                  Approve report
                </Button>
              )}
            </div>
          </div>
        </Modal>
        </SectionPortal>
      ) : null}

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

      {doneTarget ? (
        <VisitDoneModal job={job} visit={doneTarget} onClose={() => setDoneTarget(null)} onDone={(r) => void aposConfirmarDone(r)} />
      ) : null}
      {editTarget ? (
        <SectionPortal>
        <VisitEditModal
          target={editTarget}
          jobId={job.id}
          accountId={accountId}
          parentCatalogServiceId={job.catalog_service_id ?? null}
          parentCatalogPricingPresetId={job.catalog_pricing_preset_id ?? null}
          primaryPartner={job.partner_id ? { id: job.partner_id, name: job.partner_name ?? "" } : null}
          jobSlot={{ startAt: job.scheduled_start_at ?? null, endAt: job.scheduled_end_at ?? null }}
          nextIndex={Math.max(1, ...visits.filter((v) => !v.deleted_at).map((v) => v.visit_index)) + 1}
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
  domId, focused, index, partner, service, date, startAt, endAt, clientPrice, partnerCost,
  statusLabel, statusVariant, done, notified, report, onEdit, onDelete, onComplete, completeTitle,
}: {
  domId?: string;
  focused?: boolean;
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
  /** Relatório da visita extra (a V1 fica na aba Reports). */
  report?: {
    submittedAt: string | null;
    approvedAt: string | null;
    onView: () => void;
    onCopyLink?: () => void;
    onApprove: () => void;
  };
  onEdit?: () => void;
  onDelete?: () => void;
  onComplete?: () => void;
  completeTitle?: string;
}) {
  const janela = startAt && endAt ? formatArrivalTimeRange(startAt, endAt) : startAt ? startAt.slice(11, 16) : null;
  useEffect(() => {
    if (!focused || !domId) return;
    document.getElementById(domId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused, domId]);
  return (
    <div
      id={domId}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border-light bg-card px-3 py-2",
        done && "bg-surface-hover/40",
        focused && "ring-2 ring-primary/60",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          done ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-primary/10 text-primary",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : `V${index}`}
      </span>
      <div className="min-w-0 flex-1">
        {/* Uma linha só, na altura dos preços (dono, 20/10/2026): dia e janela, parceiro e
            tipo de trabalho. O número da visita já está no círculo. */}
        <p className="m-0 truncate text-[13px] tabular-nums">
          <span className={cn("font-semibold text-text-primary", done && "text-text-tertiary line-through")}>
            {date ? diaCurto(date) : "No date"}
          </span>
          {janela ? <span className="text-text-tertiary"> · {janela}</span> : null}
          <span className="text-text-secondary"> · {partner}</span>
          {service ? <span className="text-text-tertiary"> · {service}</span> : null}
        </p>
        {report ? (
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
            <FileText className="h-3 w-3 text-text-tertiary" />
            {report.approvedAt ? (
              <button type="button" onClick={report.onView} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                Report approved
              </button>
            ) : report.submittedAt ? (
              <>
                <button type="button" onClick={report.onView} className="font-medium text-primary hover:underline">
                  Report in · view
                </button>
                <button type="button" onClick={report.onApprove} className="font-medium text-text-secondary hover:text-emerald-600">
                  Approve
                </button>
              </>
            ) : (
              <span className="text-text-tertiary">No report yet</span>
            )}
            {!report.submittedAt && report.onCopyLink ? (
              <button type="button" onClick={report.onCopyLink} className="inline-flex items-center gap-1 font-medium text-text-secondary hover:text-primary">
                <Link2 className="h-3 w-3" />
                Copy report link
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
      {/* Cliente e parceiro lado a lado, na mesma linha; o rótulo aparece só no hover. */}
      <div className="hidden shrink-0 items-center gap-3 text-[12px] font-medium tabular-nums sm:flex">
        <span className="text-emerald-700 dark:text-emerald-400" title="Client pays">{formatCurrency(clientPrice)}</span>
        <span className="text-rose-700 dark:text-rose-300" title="Partner gets">{formatCurrency(partnerCost)}</span>
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
  /**
   * O cliente paga esta visita? (dono, 21/10/2026, JOB-9705). "" = ainda não respondido:
   * a limpeza já estava na fatura e o resolver preenchia o preço sozinho, cobrando duas vezes.
   */
  billing: "" | "included" | "extra";
  /** Por hora ou fixa (dono, 22/10/2026): perguntado sempre, "" = ainda não escolhido. */
  rate_type: "" | "fixed" | "hourly";
  hourly_client_rate: string;
  hourly_partner_rate: string;
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
  billing: "",
  rate_type: "",
  hourly_client_rate: "",
  hourly_partner_rate: "",
};

function VisitEditModal({
  target, jobId, accountId,
  parentCatalogServiceId,
  parentCatalogPricingPresetId,
  primaryPartner, jobSlot, nextIndex,
  onClose, onCreate, onUpdate,
}: {
  target: NonNullable<EditTarget>;
  jobId: string;
  accountId: string | null;
  parentCatalogServiceId?: string | null;
  parentCatalogPricingPresetId?: string | null;
  /** Parceiro da visita 1: quase sempre é quem volta, então vem marcado e no topo. */
  primaryPartner: { id: string; name: string } | null;
  /** Janela do job: a visita nova nasce com o mesmo horário. */
  jobSlot: { startAt: string | null; endAt: string | null };
  nextIndex: number;
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
        billing: Number(v.client_price) > 0 ? "extra" : "included",
        rate_type: v.job_type === "hourly" || v.job_type === "fixed" ? v.job_type : "",
        hourly_client_rate: v.hourly_client_rate != null ? String(v.hourly_client_rate) : "",
        hourly_partner_rate: v.hourly_partner_rate != null ? String(v.hourly_partner_rate) : "",
      };
    }
    // Visita nova herda o serviço do job: quase sempre é o mesmo trabalho, e
    // já vindo escolhido o resolver de preço tem a tripla completa assim que
    // o parceiro entrar. Trocar é um clique.
    return {
      ...EMPTY_FORM,
      catalog_service_id: parentCatalogServiceId ?? "",
      // Padrões do que quase sempre acontece (19/10/2026): mesmo parceiro, mesma
      // janela, próximo dia útil.
      partner_id: primaryPartner?.id ?? "",
      partner_name: primaryPartner?.name ?? "",
      scheduled_date: proximoDiaUtil(),
      ...(jobSlot.startAt ? arrivalFromStored(jobSlot.startAt, jobSlot.endAt) : {}),
    };
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
      // Taxas por hora do serviço e do parceiro (ex.: General Maintenance £72/h), para o Hourly.
      hourly_client_rate: p.hourly_client_rate || (pricing.client.hourly_rate != null ? String(pricing.client.hourly_rate) : ""),
      hourly_partner_rate: p.hourly_partner_rate || (pricing.partner.hourly_partner_rate != null ? String(pricing.partner.hourly_partner_rate) : ""),
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
    if (!form.rate_type) {
      toast.error("Choose how this visit is charged: Hourly or Fixed");
      return;
    }
    const porHora = form.rate_type === "hourly";
    if (porHora && (Number(form.hourly_client_rate) < 0 || Number(form.hourly_partner_rate) < 0)) {
      toast.error("Rates cannot be negative");
      return;
    }
    if (!porHora && !form.billing) {
      toast.error("Choose whether the client pays extra for this visit");
      return;
    }
    if (!porHora && form.billing === "extra" && !(Number(form.client_price) > 0)) {
      toast.error("Set how much the client pays for this visit");
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
        // Hourly: estimativa de 1 hora (mínimo); o valor final sai do Done, com chegada e saída.
        client_price: porHora
          ? Math.round((Number(form.hourly_client_rate) || 0) * 100) / 100
          : form.billing === "extra" ? Number(form.client_price) || 0 : 0,
        partner_cost: porHora
          ? Math.round((Number(form.hourly_partner_rate) || 0) * 100) / 100
          : Number(form.partner_cost) || 0,
        job_type: form.rate_type,
        hourly_client_rate: porHora ? Number(form.hourly_client_rate) || 0 : null,
        hourly_partner_rate: porHora ? Number(form.hourly_partner_rate) || 0 : null,
        billed_hours: porHora ? 1 : null,
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

  const parceirosOrdenados = useMemo(() => {
    const lista = [...partners].sort((a, b) => nomeDoParceiro(a).localeCompare(nomeDoParceiro(b)));
    const i = lista.findIndex((p) => p.id === primaryPartner?.id);
    if (i > 0) lista.unshift(...lista.splice(i, 1));
    return lista;
  }, [partners, primaryPartner?.id]);
  // Chip só quando o preço veio de um acordo da conta ou do parceiro: "Standard" nos dois era ruído.
  const fonteDoCliente = pricing
    ? pricing.pricing_mode === "hourly" ? pricing.client.hourly_rate_source : pricing.client.fixed_price_source
    : null;
  const fonteDoParceiro = pricing
    ? pricing.pricing_mode === "hourly" ? pricing.partner.hourly_partner_rate_source : pricing.partner.fixed_partner_cost_source
    : null;
  const margem = (() => {
    if (form.billing !== "extra") return null;
    const c = Number(form.client_price) || 0;
    const p = Number(form.partner_cost) || 0;
    if (!c && !p) return null;
    return { valor: Math.round((c - p) * 100) / 100, pct: c > 0 ? Math.round(((c - p) / c) * 100) : null };
  })();

  return (
    <Modal
      open
      onClose={onClose}
      title={target.mode === "edit" ? `Edit visit ${target.visit.visit_index}` : `Book visit ${nextIndex}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-3 p-1">
        <section className={BLOCO}>
          <p className={SECAO}>When</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className={ROTULO}>Date *</label>
              <Input type="date" value={form.scheduled_date} onChange={(e) => setForm((p) => ({ ...p, scheduled_date: e.target.value }))} />
            </div>
            <ArrivalSlotPicker
              arrivalFrom={form.arrival_from}
              arrivalWindowMins={form.arrival_window_mins}
              onPick={(from, mins) => setForm((p) => ({ ...p, arrival_from: from, arrival_window_mins: mins }))}
              rowLayout
            />
          </div>
        </section>

        <section className={BLOCO}>
          <p className={SECAO}>Who and what</p>
          <div>
            <label className={ROTULO}>Partner</label>
            <select
              className={CAMPO}
              value={form.partner_id}
              onChange={(e) => pickPartner(e.target.value)}
            >
              <option value="">No partner yet</option>
              {parceirosOrdenados.map((p) => (
                <option key={p.id} value={p.id}>
                  {nomeDoParceiro(p)}
                  {p.id === primaryPartner?.id ? " (visit 1)" : ""}
                </option>
              ))}
            </select>
          </div>
          <ServiceCatalogSelect
            label="Service"
            catalog={catalog}
            value={form.catalog_service_id}
            onChange={(id) => setForm((p) => ({ ...p, catalog_service_id: id }))}
            compactOptionLabels
          />
          <div>
            <label className={ROTULO}>Scope for the partner (in English)</label>
            <textarea
              value={form.scope}
              onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}
              rows={3}
              className={cn(CAMPO, "h-auto resize-y py-2 leading-snug")}
              placeholder="What the partner does on this visit. They see this."
            />
          </div>
        </section>

        <section className={BLOCO}>
          <p className={SECAO}>How is this visit charged?</p>
          <div role="radiogroup" aria-label="Rate type for this visit" className="grid grid-cols-2 gap-2">
            {([
              { v: "hourly", titulo: "Hourly", texto: "Rate per hour. Hours are set when the visit is marked Done." },
              { v: "fixed", titulo: "Fixed", texto: "Agreed price. Client or partner can be £0." },
            ] as const).map((o) => {
              const ativo = form.rate_type === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setForm((p) => ({ ...p, rate_type: o.v }))}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    ativo ? "border-primary bg-primary/5" : "border-border-light bg-surface hover:border-text-tertiary",
                  )}
                >
                  <span className="block text-[13px] font-semibold text-text-primary">{o.titulo}</span>
                  <span className="block text-[11px] leading-snug text-text-tertiary">{o.texto}</span>
                </button>
              );
            })}
          </div>
          {form.rate_type === "hourly" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={ROTULO}>Client rate (£/h)</label>
                  <Input type="number" step="0.01" min={0} value={form.hourly_client_rate} placeholder="0.00"
                    onChange={(e) => setForm((p) => ({ ...p, hourly_client_rate: e.target.value }))} />
                </div>
                <div>
                  <label className={ROTULO}>Partner rate (£/h)</label>
                  <Input type="number" step="0.01" min={0} value={form.hourly_partner_rate} placeholder="0.00"
                    onChange={(e) => setForm((p) => ({ ...p, hourly_partner_rate: e.target.value }))} />
                </div>
              </div>
              <p className="m-0 text-[11px] text-text-tertiary tabular-nums">
                Minimum 1 hour, then by the half hour. Booked as 1 hour for now: client {formatCurrency(Number(form.hourly_client_rate) || 0)} · partner {formatCurrency(Number(form.hourly_partner_rate) || 0)}.
              </p>
            </>
          ) : null}
        </section>

        {form.rate_type === "fixed" ? (
        <section className={BLOCO}>
          <p className={SECAO}>Does the client pay for this visit?</p>
          <div role="radiogroup" aria-label="Client billing for this visit" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([
              { v: "included", titulo: "Already included", texto: "Part of the job price. Nothing new on the invoice." },
              { v: "extra", titulo: "Charge extra", texto: "Adds to the client's invoice for this job." },
            ] as const).map((o) => {
              const ativo = form.billing === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setForm((p) => ({ ...p, billing: o.v }))}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    ativo ? "border-primary bg-primary/5" : "border-border-light bg-surface hover:border-text-tertiary",
                  )}
                >
                  <span className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    ativo ? "border-primary bg-primary" : "border-border",
                  )}>
                    {ativo ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-text-primary">{o.titulo}</span>
                    <span className="block text-[11px] leading-snug text-text-tertiary">{o.texto}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {form.billing === "extra" ? (
              <div>
                <label className={ROTULO}>
                  Client pays (£)
                  {pricing && fonteDoCliente === "custom" ? <PricingSourceChip source="custom" /> : null}
                </label>
                <Input type="number" step="0.01" min={0} value={form.client_price}
                  onChange={(e) => setForm((p) => ({ ...p, client_price: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            ) : null}
            <div className={form.billing === "extra" ? "" : "sm:col-span-2"}>
              <label className={ROTULO}>
                Partner gets (£)
                {pricing && fonteDoParceiro === "custom" ? <PricingSourceChip source="custom" /> : null}
              </label>
              <Input type="number" step="0.01" min={0} value={form.partner_cost}
                onChange={(e) => setForm((p) => ({ ...p, partner_cost: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>

          {form.billing === "included" ? (
            <p className="m-0 text-[11px] text-text-tertiary">
              The client is not charged again. The partner&apos;s {formatCurrency(Number(form.partner_cost) || 0)} comes out of the job&apos;s margin.
            </p>
          ) : margem ? (
            <p className={cn("m-0 text-[11px] tabular-nums", margem.valor < 0 ? "text-red-600" : "text-text-tertiary")}>
              Margin on this visit {formatCurrency(margem.valor)}
              {margem.pct != null ? ` · ${margem.pct}%` : ""}
            </p>
          ) : null}
        </section>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="m-0 max-w-[18rem] text-[11px] leading-snug text-text-tertiary">
            {target.mode === "create" ? "The partner gets the job by email on the job's ticket. The client gets a confirmation there too." : ""}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={saving || !form.rate_type || (form.rate_type === "fixed" && !form.billing)}>
              {saving ? "Saving…" : target.mode === "edit" ? "Save changes" : `Book visit ${nextIndex}`}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

const SECAO = "m-0 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary";
/** Cada parte do modal num bloco, para ler de cima a baixo: quando, quem, quanto. */
const BLOCO = "space-y-3 rounded-xl border border-border-light bg-surface-secondary/40 p-3";
const ROTULO = "mb-1 flex items-center gap-1.5 text-xs font-semibold text-text-secondary";
/** Mesmo campo do `Input` (VOS UNO): o select e o textarea destoavam do resto. */
const CAMPO = "w-full h-[var(--field-h,38px)] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-[11px] text-[13px] text-text-primary placeholder:text-text-tertiary transition-colors hover:border-text-tertiary focus:outline-none focus:border-text-tertiary focus:ring-[3px] focus:ring-text-primary/10";

function nomeDoParceiro(p: Partner): string {
  return (p.company_name?.trim() || p.contact_name || "Partner").trim();
}

/** Próximo dia útil em Londres (segunda a sexta), como YYYY-MM-DD. */
function proximoDiaUtil(): string {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const [y, m, d] = hoje.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  do dt.setUTCDate(dt.getUTCDate() + 1);
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
  return dt.toISOString().slice(0, 10);
}
