"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LOST_REASON_LABEL, isOpenStage } from "@/lib/crm/etapas";
import { useStageLabels } from "./use-stage-labels";
import { checklistDoJob, prontoParaJob } from "@/lib/crm/pronto-para-job";
import { guardarPrefill, janelaDoTexto } from "@/lib/inbox/prefill";
import { changeLeadStage, recordLeadEvent } from "@/services/leads";
import {
  accountSkipsDeposit,
  findJobForLead,
  getLatestLeadQuote,
  leadValue,
  type LeadQuote,
} from "@/services/crm-leads";
import type { CatalogService, Lead } from "@/types/database";
import { LeadNextAction } from "./lead-next-action";
import { LeadJobFieldsEditor } from "./lead-job-fields";
import { LeadReadyPanel } from "./lead-ready-panel";
import { LeadLostModal } from "./lead-lost-modal";
import { LeadQuotingModal } from "./lead-quoting-modal";
import { SEGMENT_LABEL, STAGE_VARIANT, formatAgo, gbp, zendeskTicketUrl } from "./crm-ui";

const PENDING_WON_KEY = "fixfy:crm-pending-won";

/** Foi criar o job em outra tela: ao voltar para Leads, o lead reabre e vira Won se o job existir. */
function rememberPendingWon(leadId: string) {
  try {
    sessionStorage.setItem(PENDING_WON_KEY, leadId);
  } catch {
    /* sem storage, basta reabrir o lead */
  }
}

/** Lê e apaga o lead que saiu para virar job. */
export function takePendingWonLeadId(): string | null {
  try {
    const id = sessionStorage.getItem(PENDING_WON_KEY);
    sessionStorage.removeItem(PENDING_WON_KEY);
    return id;
  } catch {
    return null;
  }
}

/** Cabeçalho do lead no drawer: etapa, segmento, origem, ticket. */
export function LeadCrmHeader({ lead, sourceLabel }: { lead: Lead; sourceLabel?: string | null }) {
  const stage = lead.stage ?? "new";
  const STAGE_LABEL = useStageLabels();
  const url = zendeskTicketUrl(lead.external_ref);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={STAGE_VARIANT[stage]}>{STAGE_LABEL[stage]}</Badge>
      <Badge variant="default">{SEGMENT_LABEL[lead.segment ?? "b2c"]}</Badge>
      {sourceLabel || lead.source ? <Badge variant="default">{sourceLabel || lead.source}</Badge> : null}
      {lead.external_ref ? (
        url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Ticket #{lead.external_ref}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-xs text-text-secondary">Ticket #{lead.external_ref}</span>
        )
      ) : (
        <Badge variant="danger">No ticket linked</Badge>
      )}
      {lead.last_contact_at ? <span className="text-[11px] text-text-tertiary">Last contact {formatAgo(lead.last_contact_at)} ago</span> : null}
    </div>
  );
}

/**
 * Aba Overview do drawer: ações (Lost, Quote, Won), próximo passo, dados do
 * job e checklist Ready for job. Create quote abre a mesma pergunta do board
 * (Partners bid ou Internal).
 */
export function LeadCrmPanel({
  lead,
  catalog,
  onLeadChange,
  onQuoteCreated,
}: {
  lead: Lead;
  catalog: CatalogService[];
  onLeadChange: (l: Lead) => void;
  onQuoteCreated?: () => void;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<LeadQuote | null>(null);
  const [semEntrada, setSemEntrada] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"quote" | "won" | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [quotingOpen, setQuotingOpen] = useState(false);
  const reconciledFor = useRef<string | null>(null);

  const stage = lead.stage ?? "new";
  const open = isOpenStage(stage);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    Promise.all([getLatestLeadQuote(lead.id), accountSkipsDeposit(lead.account_id)])
      .then(([q, skip]) => {
        if (!active) return;
        setQuote(q);
        setSemEntrada(skip);
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [lead.id, lead.account_id, lead.stage]);

  const markWonWithJob = useCallback(
    async (job: { id: string; reference: string }) => {
      const updated = await changeLeadStage(lead.id, "won", {
        jobId: job.id,
        summary: job.reference ? `Job ${job.reference} created` : "Job created",
      });
      await recordLeadEvent({
        leadId: lead.id,
        kind: "job_created",
        channel: "os",
        summary: job.reference || null,
        payload: { job_id: job.id },
        idempotencyKey: `job_created:${lead.id}:${job.id}`,
      });
      onLeadChange(updated);
      return updated;
    },
    [lead.id, onLeadChange],
  );

  // Voltou da tela de Jobs/Quotes com o job criado: o lead fecha como Won.
  useEffect(() => {
    if (!open || reconciledFor.current === lead.id) return;
    reconciledFor.current = lead.id;
    const id = lead.id;
    findJobForLead(lead)
      .then(async (job) => {
        if (!job || reconciledFor.current !== id) return;
        await markWonWithJob(job);
        toast.success(job.reference ? `Lead won · ${job.reference}` : "Lead won");
      })
      .catch(() => {
        /* sem job ainda */
      });
  }, [lead, open, markWonWithJob]);

  const items = useMemo(() => checklistDoJob({ lead, quote, semEntrada }), [lead, quote, semEntrada]);
  const ready = prontoParaJob(items);
  const value = leadValue(lead, quote);
  const liveQuote = quote && quote.status !== "rejected" ? quote : null;

  const onCreateQuote = () => {
    if (liveQuote) {
      router.push(`/quotes?quoteId=${liveQuote.id}`);
      return;
    }
    setQuotingOpen(true);
  };

  const onMarkWon = async () => {
    if (!ready.pronto) return;
    setBusy("won");
    try {
      const job = await findJobForLead(lead);
      if (job) {
        await markWonWithJob(job);
        toast.success(job.reference ? `Lead won · ${job.reference}` : "Lead won");
        return;
      }
      rememberPendingWon(lead.id);
      if (liveQuote) {
        // O caminho de sempre: Convert to job no drawer da quote.
        toast.info("Convert the quote to a job. The lead turns Won as soon as the job exists.");
        router.push(`/quotes?quoteId=${liveQuote.id}`);
        return;
      }
      // Preço de handyman no chat, sem quote: o New Job de sempre, já preenchido.
      guardarPrefill("job", {
        cliente: {
          client_id: lead.client_id ?? undefined,
          client_address_id: lead.client_address_id ?? undefined,
          client_name: lead.name,
          client_email: lead.email ?? undefined,
          property_address: [lead.address, lead.city, lead.postcode].filter((s) => s && String(s).trim()).join(", "),
        },
        scope: lead.scope ?? "",
        ticketId: lead.external_ref ?? null,
        contaId: lead.account_id ?? null,
        job: (() => {
          const janela = janelaDoTexto(lead.preferred_window);
          const preco = lead.price_given != null ? Number(lead.price_given) : null;
          const modo = lead.price_mode ?? "fixed";
          return {
            leadId: lead.id,
            catalog_service_id: lead.catalog_service_id ?? null,
            scheduled_date: lead.preferred_date ?? null,
            arrival_from: janela?.from ?? null,
            arrival_window_mins: janela?.mins ?? null,
            job_kind: lead.job_kind ?? null,
            job_type: modo === "hourly" ? "hourly" : "fixed",
            rate_basis: modo === "half_day" || modo === "daily" ? modo : "fixed",
            client_price: modo === "hourly" ? null : preco,
            hourly_client_rate: modo === "hourly" ? preco : null,
            in_ccz: lead.in_ccz ?? null,
            has_free_parking: lead.has_free_parking ?? null,
          };
        })(),
      });
      toast.info("Create the job. Come back to the lead and it turns Won.");
      router.push("/jobs?new=inbox");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark the lead as won");
    } finally {
      setBusy(null);
    }
  };

  const wonTitle = !open
    ? "Only open leads can be won"
    : !loaded
      ? "Checking the lead"
      : ready.pronto
        ? liveQuote
          ? "Opens the quote to convert it into a job"
          : "Opens New job filled in from the lead"
        : `${ready.faltam} item${ready.faltam === 1 ? "" : "s"} missing in Ready for job`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {value ? (
          <span className="text-sm font-semibold tabular-nums text-text-primary mr-1">
            {gbp(value)}
            {liveQuote ? <span className="ml-1 text-[11px] font-normal text-text-tertiary">{liveQuote.reference}</span> : null}
          </span>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setLostOpen(true)} disabled={stage === "won" || stage === "lost"}>
          Mark lost
        </Button>
        <Button size="sm" variant="secondary" onClick={onCreateQuote} disabled={busy !== null || stage === "won" || !loaded}>
          {busy === "quote" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : liveQuote ? "Open quote" : "Create quote"}
        </Button>
        <span title={wonTitle} className="inline-flex sm:ml-auto">
          <Button size="sm" onClick={onMarkWon} disabled={!open || !loaded || !ready.pronto || busy !== null}>
            {busy === "won" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark won · create job"}
          </Button>
        </span>
      </div>

      {stage === "lost" && lead.lost_reason ? (
        <p className="text-xs text-text-secondary">
          Lost · {LOST_REASON_LABEL[lead.lost_reason]}
          {lead.lost_note ? ` · ${lead.lost_note}` : ""}
        </p>
      ) : null}
      {stage === "lost" && lead.nurture_until ? (
        <p className="text-xs text-text-secondary">Comes back on {lead.nurture_until.split("-").reverse().join("/")}. It goes back to New lead on that day.</p>
      ) : null}

      <LeadNextAction lead={lead} required={open} onSaved={onLeadChange} />
      <LeadJobFieldsEditor lead={lead} hasQuote={!!liveQuote} onSaved={onLeadChange} />
      <LeadReadyPanel items={items} />

      {quotingOpen ? (
        <LeadQuotingModal
          lead={lead}
          catalog={catalog}
          open
          onClose={() => setQuotingOpen(false)}
          onDone={() => {
            setQuotingOpen(false);
            onQuoteCreated?.();
          }}
        />
      ) : null}
      <LeadLostModal
        lead={lead}
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        onDone={(l) => {
          setLostOpen(false);
          onLeadChange(l);
        }}
      />
    </div>
  );
}
