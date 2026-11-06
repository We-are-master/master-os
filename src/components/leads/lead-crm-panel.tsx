"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ExternalLink, FileText, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { LOST_REASON_LABEL, isOpenStage } from "@/lib/crm/etapas";
import { useStageLabels } from "./use-stage-labels";
import { checklistDoJob, prontoParaJob } from "@/lib/crm/pronto-para-job";
import { guardarPrefill, janelaDoTexto } from "@/lib/inbox/prefill";
import { changeLeadStage, getLead, recordLeadEvent } from "@/services/leads";
import {
  accountSkipsDeposit,
  findJobForLead,
  getLatestLeadQuote,
  leadValue,
  type LeadQuote,
} from "@/services/crm-leads";
import type { CatalogService, Lead, LeadStage } from "@/types/database";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { getBidsByQuoteId, type QuoteBid } from "@/services/quote-bids";
import { getQuoteProposalRecipientEmail } from "@/lib/account-billing-addressee";
import { LeadJobFieldsEditor } from "./lead-job-fields";
import { LeadReadyPanel } from "./lead-ready-panel";
import { QUOTE_STATUS_CHIP, SEGMENT_LABEL, STAGE_VARIANT, formatAgo, gbp, zendeskTicketUrl } from "./crm-ui";

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

/** As etapas na barra do drawer, na ordem do funil. Lost fica à parte. */
const PASSOS: LeadStage[] = ["new", "qualified", "quoting", "quoted", "won"];

/**
 * Aba Overview do drawer (06/11/2026, dono: mudar de etapa e resolver com um
 * clique). Em cima, a barra de etapas: clicar numa etapa move o card com as
 * mesmas regras de arrastar no board (Quoting pergunta Partners bid ou
 * Internal, Lost pede o motivo, Won só com o job). Embaixo, um botão
 * principal: o próximo passo da etapa em que o card está.
 */
export function LeadCrmPanel({
  lead,
  onLeadChange,
  onMove,
  onLose,
  details,
}: {
  lead: Lead;
  /** Não usado aqui desde que Quoting abre o modal da tela; fica para quem já passa. */
  catalog?: CatalogService[];
  onLeadChange: (l: Lead) => void;
  /** Move o card com as regras do board (a tela abre os modais). */
  onMove: (to: LeadStage) => void;
  /** Abre o modal de Lost. */
  onLose: () => void;
  /** Contato, endereço, scope e fotos (ex-aba Details), entre o próximo passo e os dados do job. */
  details?: ReactNode;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<LeadQuote | null>(null);
  const [semEntrada, setSemEntrada] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"quote" | "won" | "send" | null>(null);
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

  const openQuote = () => liveQuote && router.push(`/quotes?quoteId=${liveQuote.id}`);
  // Lances da quote: o escolhido (quotes.partner_id) em cima, os outros pelo preço.
  const [bids, setBids] = useState<QuoteBid[]>([]);
  const [chosenPartner, setChosenPartner] = useState<string | null>(null);
  const [showBids, setShowBids] = useState(true);
  const liveQuoteId = liveQuote?.id ?? null;
  useEffect(() => {
    if (!liveQuoteId) {
      setBids([]);
      setChosenPartner(null);
      return;
    }
    let active = true;
    Promise.all([
      getBidsByQuoteId(liveQuoteId).catch(() => [] as QuoteBid[]),
      getSupabase().from("quotes").select("partner_id").eq("id", liveQuoteId).maybeSingle(),
    ]).then(([list, { data }]) => {
      if (!active) return;
      const chosen = (data as { partner_id?: string | null } | null)?.partner_id ?? null;
      setChosenPartner(chosen);
      setBids(
        list
          .filter((b) => b.status !== "rejected" || b.partner_id === chosen)
          .sort((a, b) => Number(b.partner_id === chosen) - Number(a.partner_id === chosen) || a.bid_amount - b.bid_amount),
      );
    });
    return () => {
      active = false;
    };
  }, [liveQuoteId, liveQuote?.status]);

  const previewQuote = () =>
    liveQuote && window.open(`/api/quotes/send-pdf?quoteId=${encodeURIComponent(liveQuote.id)}`, "_blank", "noopener,noreferrer");

  // Quote pronta (parceiro cotou): envia daqui, com os valores salvos na quote.
  // Mesmo destinatário da tela de Quotes (conta B2B segue o billing da conta) e
  // mesmo ticket da conversa: sem ticket na quote, liga ao ticket do lead antes.
  // O envio leva o card para Quoted (persistQuoteSentToCustomer sincroniza o lead).
  const sendQuote = async () => {
    if (!liveQuote) return;
    const sb = getSupabase();
    const { data: q } = await sb
      .from("quotes")
      .select("client_id, property_id, source_account_id, client_name, client_email, external_source, external_ref")
      .eq("id", liveQuote.id)
      .maybeSingle();
    const row = (q ?? {}) as Record<string, string | null>;
    const clientId = row.client_id?.trim() || null;
    const propertyId = clientId ? null : row.property_id?.trim() || null;
    const email = (
      (await getQuoteProposalRecipientEmail(sb, {
        clientId,
        propertyId,
        accountId: clientId || propertyId ? null : row.source_account_id?.trim() || null,
        fallbackName: row.client_name ?? lead.name ?? null,
        fallbackEmail: row.client_email ?? lead.email ?? null,
      }).catch(() => null)) ||
      row.client_email ||
      lead.email ||
      ""
    ).trim();
    if (!email.includes("@")) {
      toast.info("No customer email on this quote. Opening it to add the email and send.");
      openQuote();
      return;
    }
    const leadTicket = lead.external_source === "zendesk" || !lead.external_source ? lead.external_ref?.trim() || null : null;
    const quoteTicket = row.external_source === "zendesk" ? row.external_ref?.trim() || null : null;
    const ticket = quoteTicket ?? (row.external_source ? null : leadTicket);
    const onde = ticket ? `on Zendesk ticket #${ticket}` : "by email (no Zendesk ticket linked)";
    if (!window.confirm(`Send ${liveQuote.reference} to ${email} ${onde}?`)) return;
    setBusy("send");
    try {
      if (!quoteTicket && ticket) {
        await sb.from("quotes").update({ external_source: "zendesk", external_ref: ticket }).eq("id", liveQuote.id).is("external_source", null);
      }
      const res = await fetch("/api/quotes/send-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: liveQuote.id,
          recipientEmail: email,
          recipientName: row.client_name ?? lead.name ?? undefined,
          accountId: row.source_account_id ?? undefined,
        }),
      });
      const j = (await res.json().catch(() => null)) as { emailSent?: boolean; error?: string; detail?: string; reason?: string } | null;
      if (!res.ok) throw new Error(j?.detail ? `${j.error ?? "Could not send"}: ${j.detail}` : (j?.error ?? "Could not send the quote"));
      if (j?.emailSent === false) toast.warning(j.reason ?? "Quote updated but the email was not sent");
      else toast.success(`${liveQuote.reference} sent to ${email}`);
      const updated = await getLead(lead.id);
      if (updated) onLeadChange(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the quote");
    } finally {
      setBusy(null);
    }
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

  const STAGE_LABEL = useStageLabels();
  const atual = PASSOS.indexOf(stage);

  const clicarPasso = (to: LeadStage) => {
    if (to === stage || stage === "won") return;
    // Won só com o Ready for job verde: diz o que falta em vez de não fazer nada.
    if (to === "won") return void (ready.pronto ? onMarkWon() : toast.info(wonTitle));
    onMove(to);
  };

  return (
    <div className="space-y-4">
      {/* Barra de etapas: clicar move o card. */}
      <div className="flex items-stretch gap-1.5">
        <ol className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-xl border border-border-light">
          {PASSOS.map((p, i) => {
            const feito = atual >= 0 && i < atual;
            const aqui = p === stage;
            return (
              <li key={p} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => clicarPasso(p)}
                  disabled={stage === "won" || aqui || busy !== null}
                  title={aqui ? `In ${STAGE_LABEL[p]}` : p === "won" ? wonTitle : `Move to ${STAGE_LABEL[p]}`}
                  className={cn(
                    "flex h-9 w-full items-center justify-center gap-1 truncate border-r border-border-light px-1.5 text-[11px] font-semibold transition last:border-r-0",
                    aqui
                      ? "bg-primary text-white"
                      : feito
                        ? "bg-primary-light text-primary hover:bg-primary/15"
                        : "bg-surface text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
                    "disabled:cursor-default",
                  )}
                >
                  {feito ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                  <span className="truncate">{STAGE_LABEL[p]}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={onLose}
          disabled={stage === "won" || stage === "lost"}
          title={stage === "lost" ? "Lost" : "Mark lost"}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition",
            stage === "lost" ? "border-danger bg-danger-light text-danger" : "border-border-light text-text-secondary hover:border-danger hover:text-danger",
            "disabled:cursor-default",
          )}
        >
          <X className="h-3 w-3" aria-hidden />
          {STAGE_LABEL.lost}
        </button>
      </div>

      {/* A quote do card: linha com estado, valor e ações; abaixo os lances numerados. */}
      {liveQuote ? (
        <div className="overflow-hidden rounded-lg border border-border-light bg-surface-secondary/60">
          <div className="flex h-10 items-center gap-2 pl-2.5 pr-1">
            <button
              type="button"
              onClick={() => setShowBids((v) => !v)}
              disabled={!bids.length}
              aria-expanded={showBids}
              title={bids.length ? (showBids ? "Hide the partner bids" : "Show the partner bids") : "No partner bids"}
              className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
              <span className="shrink-0 text-xs font-medium text-text-primary">{liveQuote.reference}</span>
              {QUOTE_STATUS_CHIP[liveQuote.status] ? (
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none", QUOTE_STATUS_CHIP[liveQuote.status].cls)}>
                  {QUOTE_STATUS_CHIP[liveQuote.status].label}
                </span>
              ) : null}
              {value ? <span className="shrink-0 text-xs font-semibold tabular-nums text-text-primary">{gbp(value)}</span> : null}
              {bids.length ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-text-tertiary">
                  {bids.length} {bids.length === 1 ? "bid" : "bids"}
                  <ChevronDown className={cn("h-3 w-3 transition-transform", showBids && "rotate-180")} aria-hidden />
                </span>
              ) : null}
            </button>
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <button type="button" onClick={previewQuote} title="Preview the PDF" className="h-7 rounded-md px-2 text-xs font-medium text-text-secondary hover:bg-surface hover:text-text-primary">
                PDF
              </button>
              <button type="button" onClick={openQuote} title="Open the quote" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-surface">
                Open
                <ExternalLink className="h-3 w-3" aria-hidden />
              </button>
              {liveQuote.status === "quote_ready" ? (
                <button
                  type="button"
                  onClick={sendQuote}
                  disabled={busy === "send"}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-success px-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {busy === "send" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Send className="h-3 w-3" aria-hidden />}
                  Send
                </button>
              ) : null}
            </span>
          </div>
          {showBids && bids.length ? (
            <div className="border-t border-border-light bg-surface">
              <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_4.5rem_5.5rem] items-center gap-2 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                <span>#</span>
                <span>Partner</span>
                <span className="text-right">Partner</span>
                <span className="text-right">Our price</span>
                <span className="text-right">Margin</span>
              </div>
              {bids.map((b, i) => {
                const chosen = b.partner_id === chosenPartner;
                const hourly = b.job_type === "hourly";
                const margem = value && !hourly ? value - b.bid_amount : null;
                const pct = margem != null && value ? Math.round((margem / value) * 100) : null;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_4.5rem_5.5rem] items-center gap-2 border-t border-border-light px-2.5 py-1.5 text-xs",
                      chosen && "bg-success-light/50",
                    )}
                  >
                    <span className="tabular-nums text-text-tertiary">{i + 1}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-text-primary">{b.partner_name || "Partner"}</span>
                      {chosen ? (
                        <span className="shrink-0 rounded bg-success px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-white">Chosen</span>
                      ) : null}
                    </span>
                    <span className="text-right tabular-nums text-text-secondary">
                      {gbp(b.bid_amount)}
                      {hourly ? "/h" : ""}
                    </span>
                    <span className="text-right tabular-nums text-text-secondary">{chosen && value ? gbp(value) : "·"}</span>
                    <span
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        margem == null ? "text-text-tertiary" : margem < 0 ? "text-danger" : "text-success",
                      )}
                    >
                      {margem == null ? "·" : `${gbp(margem)}${pct != null ? ` · ${pct}%` : ""}`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {stage === "lost" && lead.lost_reason ? (
        <p className="text-xs text-text-secondary">
          Lost · {LOST_REASON_LABEL[lead.lost_reason]}
          {lead.lost_note ? ` · ${lead.lost_note}` : ""}
        </p>
      ) : null}
      {stage === "lost" && lead.nurture_until ? (
        <p className="text-xs text-text-secondary">Comes back on {lead.nurture_until.split("-").reverse().join("/")}. It goes back to New lead on that day.</p>
      ) : null}

      {details}
      <LeadJobFieldsEditor lead={lead} hasQuote={!!liveQuote} onSaved={onLeadChange} />
      <LeadReadyPanel items={items} />

    </div>
  );
}
