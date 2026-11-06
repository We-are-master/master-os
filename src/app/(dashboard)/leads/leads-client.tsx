"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { SearchExpand } from "@/components/ui/search-expand";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { LeadOffersCard } from "@/components/leads/lead-offers-card";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { Plus, Loader2, ExternalLink, Trash2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import type { CatalogService, Lead, LeadLostReason, LeadSegment, LeadStage, LeadStatus, LeadUrgency } from "@/types/database";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadQuotingModal } from "@/components/leads/lead-quoting-modal";
import { LeadLostModal } from "@/components/leads/lead-lost-modal";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { createLead, updateLead, deleteLead, countJobsForClient, getLead, changeLeadStage } from "@/services/leads";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { type ListResult } from "@/services/base";
import {
  decodeCrmFilter,
  encodeCrmFilter,
  getStageCounts,
  leadValue,
  listBoardLeads,
  listCrmLeads,
  listLatestQuotesForLeads,
  listAccountNames,
  listLeadChannels,
  listPlatformAccountIds,
  type CrmTab,
  type LeadChannel,
  type LeadQuote,
  type SegmentFilter,
} from "@/services/crm-leads";
import { isOpenStage } from "@/lib/crm/etapas";
import { useStageLabels } from "@/components/leads/use-stage-labels";
import { LeadStageTabs, SegmentToggle, ViewToggle, type LeadsView } from "@/components/leads/lead-stage-tabs";
import { LeadBoard } from "@/components/leads/lead-board";
import { LeadCrmHeader, LeadCrmPanel, takePendingWonLeadId } from "@/components/leads/lead-crm-panel";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import {
  SEGMENT_LABEL,
  STAGE_VARIANT,
  formatAgo,
  formatWhen,
  gbp,
  isOverdue,
  isoToLocalInput,
  zendeskTicketUrl,
} from "@/components/leads/crm-ui";
import { cn } from "@/lib/utils";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";
import { validateLeadForm, type LeadFieldErrors } from "@/lib/lead-validation";

function mapboxPartsToLeadFields(parts: AddressParts) {
  const address =
    parts.full_address?.trim() ||
    [parts.address, parts.city, parts.postcode].filter(Boolean).join(", ");
  return {
    address,
    city: parts.city?.trim() ?? "",
    postcode: parts.postcode?.trim() ?? "",
  };
}

/** Single line for Mapbox field — merges stored address / city / postcode when needed. */
function leadAddressDisplay(lead: { address: string; city?: string | null; postcode?: string | null }): string {
  const line = lead.address?.trim() ?? "";
  const city = lead.city?.trim();
  const pc = lead.postcode?.trim();
  if (!city && !pc) return line;
  const lower = line.toLowerCase();
  if (pc && lower.includes(pc.toLowerCase())) {
    if (!city || lower.includes(city.toLowerCase())) return line;
    return `${line}, ${city}`;
  }
  return [line, city, pc].filter(Boolean).join(", ");
}

type LeadFormState = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  urgency: LeadUrgency;
  scope: string;
  status: LeadStatus;
  /** service_catalog.id — required so the Trade Portal can target matching partners. */
  catalog_service_id: string;
  /** CRM (mig 356). Only used by the New lead modal. */
  segment: LeadSegment;
  source: string;
  zendesk_ticket_id: string;
  next_action: string;
  /** datetime-local value */
  next_action_at: string;
};

/** Próxima meia hora cheia, para o próximo passo já vir preenchido. */
function nextHalfHourLocal(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return isoToLocalInput(d.toISOString());
}

function emptyLeadForm(status: LeadStatus = "new"): LeadFormState {
  return {
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postcode: "",
    urgency: "medium",
    scope: "",
    status,
    catalog_service_id: "",
    segment: "b2c",
    source: "",
    zendesk_ticket_id: "",
    next_action: "Reply to the customer",
    next_action_at: nextHalfHourLocal(),
  };
}

type CreateLeadErrors = LeadFieldErrors & Partial<Record<"zendesk_ticket_id" | "next_action" | "next_action_at", string>>;

function FieldBlock({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label}</label>
      {children}
      {error ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

const urgencyConfig: Record<
  LeadUrgency,
  { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }
> = {
  low: { label: "Low", variant: "default" },
  medium: { label: "Medium", variant: "info" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "danger" },
};

interface LeadsClientProps {
  initialData?: ListResult<Lead> | null;
}

export function LeadsClient({ initialData }: LeadsClientProps = {}) {
  const { profile } = useProfile();
  const STAGE_LABEL = useStageLabels();
  const {
    data,
    loading,
    page,
    totalPages,
    totalItems,
    setPage,
    search,
    setSearch,
    status,
    setStatus,
    refresh,
    refreshSilent,
  } = useSupabaseList<Lead>({
    fetcher: listCrmLeads,
    realtimeTable: "leads",
    initialData,
    initialStatus: encodeCrmFilter("open", "all"),
  });
  const { tab, segment } = decodeCrmFilter(status);
  const setTab = useCallback((t: CrmTab) => setStatus(encodeCrmFilter(t, segment)), [setStatus, segment]);
  const setSegment = useCallback((sg: SegmentFilter) => setStatus(encodeCrmFilter(tab, sg)), [setStatus, tab]);

  const [view, setViewRaw] = useState<LeadsView>("board");
  useEffect(() => {
    try {
      const v = localStorage.getItem("fixfy:leads-view");
      if (v === "board" || v === "list") setViewRaw(v);
    } catch {
      /* sem storage fica no Board */
    }
  }, []);
  const setView = useCallback((v: LeadsView) => {
    setViewRaw(v);
    try {
      localStorage.setItem("fixfy:leads-view", v);
    } catch {
      /* ignore */
    }
  }, []);

  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  /** Card solto em Quoting: pergunta Partners bid ou Internal. */
  const [quotingLead, setQuotingLead] = useState<Lead | null>(null);
  /** Card solto em Lost: motivo e data de volta. */
  const [lostLead, setLostLead] = useState<Lead | null>(null);
  const [lostDefault, setLostDefault] = useState<LeadLostReason | undefined>(undefined);
  const router = useRouter();
  const [boardColumns, setBoardColumns] = useState<Record<string, Lead[]>>({});
  const [quotesByLead, setQuotesByLead] = useState<Record<string, LeadQuote>>({});
  const [platformAccounts, setPlatformAccounts] = useState<Set<string>>(new Set());
  const [sideLoading, setSideLoading] = useState(true);
  const [channels, setChannels] = useState<LeadChannel[]>([]);
  const [drawerTab, setDrawerTab] = useState<"overview" | "activity">("overview");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState(() => emptyLeadForm());
  const [createErrors, setCreateErrors] = useState<CreateLeadErrors>({});
  const [createPhotos, setCreatePhotos] = useState<File[]>([]);
  const [editForm, setEditForm] = useState(() => emptyLeadForm());
  const [editErrors, setEditErrors] = useState<LeadFieldErrors>({});
  const [linkedJobsCount, setLinkedJobsCount] = useState<number | null>(null);
  /** Photos on the currently open lead (drawer). */
  const [leadImages, setLeadImages] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  // Service catalog rows for the Type of Work picker. Loaded once on mount —
  // the list is small (canonical trade names + custom services) and the
  // picker is only used in the New Lead modal.
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  useEffect(() => {
    let active = true;
    listCatalogServicesForPicker()
      .then((rows) => {
        if (active) setCatalogServices(rows);
      })
      .catch((err) => {
        console.error("[leads] failed to load service_catalog:", err);
      });
    listLeadChannels().then((rows) => {
      if (active) setChannels(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  const channelLabel = useMemo(() => new Map(channels.map((c) => [c.key, c.label])), [channels]);
  /** Contagens, board, contas e as quotes dos leads na tela. */
  const sideSeq = useRef(0);
  const loadCounts = useCallback(async () => {
    const seq = ++sideSeq.current;
    setSideLoading(true);
    try {
      const [counts, board] = await Promise.all([
        getStageCounts(segment),
        view === "board" ? listBoardLeads(segment, search) : Promise.resolve<Record<string, Lead[]>>({}),
      ]);
      const boardLeads = Object.values(board).flat();
      const all = [...boardLeads, ...data];
      const [quotes, platforms, accounts] = await Promise.all([
        listLatestQuotesForLeads(all.map((l) => l.id)),
        listPlatformAccountIds((board.accepted ?? []).map((l) => l.account_id ?? "")),
        listAccountNames(all.map((l) => l.account_id ?? "")),
      ]);
      if (seq !== sideSeq.current) return;
      setStageCounts(counts);
      setBoardColumns(board);
      setQuotesByLead(quotes);
      setPlatformAccounts(platforms);
      setAccountNames(accounts);
    } catch (err) {
      console.error("[leads] side data failed:", err);
    } finally {
      if (seq === sideSeq.current) setSideLoading(false);
    }
  }, [segment, view, search, data]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  // Tempo real: lead ou quote nova (ou mudada) recarrega o board sem F5. O
  // canal de leads já vem do useSupabaseList; aqui entra o de quotes e uma
  // checagem a cada 20 s enquanto a aba está aberta, caso o websocket caia.
  const loadCountsRef = useRef(loadCounts);
  useEffect(() => {
    loadCountsRef.current = loadCounts;
  }, [loadCounts]);
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    try {
      channel = supabase
        .channel("leads-board:quotes")
        .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => void loadCountsRef.current(), 400);
        })
        .subscribe();
    } catch (err) {
      console.warn("[leads] realtime quotes failed:", err);
    }
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refreshSilent();
    }, 20000);
    return () => {
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refreshSilent]);

  const openLead = useCallback((lead: Lead) => {
    setDrawerTab("overview");
    setSelectedLead(lead);
  }, []);

  /**
   * Card arrastado para outra coluna. Até Qualified a equipe move livre. Dali
   * para frente quem move é a quote (o status dela decide Quoting e Quoted):
   * - Quoting pergunta Partners bid ou Internal e cria a quote;
   * - Quoted só acontece quando a quote é enviada ao cliente;
   * - Won só com o job criado; Lost pede motivo.
   */
  const onMove = useCallback(
    async (lead: Lead, to: LeadStage) => {
      const from = lead.stage ?? "new";
      const q = quotesByLead[lead.id];
      const liveQuote = q && q.status !== "rejected" && q.status !== "converted_to_job" ? q : null;
      if (from === to) return;
      if (from === "won") return void toast.info("This lead is already a job.");
      if (to === "lost") {
        setLostDefault(undefined);
        return setLostLead(lead);
      }
      if (to === "won") {
        toast.info("Won comes from the job. Use Mark won · create job on the lead.");
        openLead(lead);
        return;
      }
      if (to === "quoting") {
        if (liveQuote) return void toast.info(`${liveQuote.reference} already exists. Its status moves the card.`);
        return setQuotingLead(lead);
      }
      if (to === "quoted") {
        if (!liveQuote) return void toast.info("Move it to Quoting first. It becomes Quoted when the quote is sent.");
        if (liveQuote.status === "bidding" || liveQuote.status === "in_survey") {
          return void toast.info(`${liveQuote.reference} is still with partners (Sourcing). It shows Ready to send when one quotes.`);
        }
        if (liveQuote.status === "draft" || liveQuote.status === "quote_ready") {
          toast.info(`Send ${liveQuote.reference} to the customer. The card moves to Quoted when it is sent.`);
          router.push(`/quotes?quoteId=${liveQuote.id}`);
          return;
        }
        return;
      }
      // New lead, Qualified: livre, salvo se já existe quote andando.
      if (liveQuote && (from === "quoting" || from === "quoted")) {
        return void toast.info(`${liveQuote.reference} is in progress and moves this card. Reject the quote or mark the lead lost to take it out.`);
      }
      setBoardColumns((cols) => {
        const next: Record<string, Lead[]> = {};
        for (const [k, rows] of Object.entries(cols)) next[k] = rows.filter((l) => l.id !== lead.id);
        next[to] = [{ ...lead, stage: to }, ...(next[to] ?? [])];
        return next;
      });
      try {
        const updated = await changeLeadStage(lead.id, to, { summary: "Moved on the board" });
        // Moveu pelo drawer: o drawer aberto acompanha na hora.
        setSelectedLead((cur) => (cur?.id === updated.id ? updated : cur));
        toast.success(`${lead.name} · ${STAGE_LABEL[to]}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not move the lead");
      } finally {
        void loadCounts();
      }
    },
    [quotesByLead, openLead, router, loadCounts, STAGE_LABEL],
  );

  // Link de outra tela (quote, Atendimento): /leads?leadId=... abre o card.
  const searchParams = useSearchParams();
  const leadIdDoLink = searchParams.get("leadId");
  useEffect(() => {
    if (!leadIdDoLink) return;
    getLead(leadIdDoLink)
      .then((l) => l && openLead(l))
      .catch(() => {
        /* lead sumiu */
      });
  }, [leadIdDoLink, openLead]);

  // Voltou de Jobs/Quotes depois do Mark won: reabre o lead para ele fechar como Won.
  useEffect(() => {
    const id = takePendingWonLeadId();
    if (!id) return;
    getLead(id)
      .then((l) => l && openLead(l))
      .catch(() => {
        /* lead sumiu */
      });
  }, [openLead]);

  const handleDelete = useCallback(
    async (lead: Lead) => {
      const label = lead.reference?.trim() || lead.name?.trim() || "this lead";
      if (
        !confirm(
          `Delete ${label}? It will be removed from Partner offers, Overview and the Trade Portal. The linked Fixfy client contact is kept.`,
        )
      ) {
        return;
      }
      setDeletingId(lead.id);
      try {
        await deleteLead(lead.id, profile?.id);
        toast.success("Lead deleted");
        setSelectedLead((current) => (current?.id === lead.id ? null : current));
        await refresh();
        await loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not delete lead");
      } finally {
        setDeletingId(null);
      }
    },
    [loadCounts, profile?.id, refresh],
  );

  /** O formulário de Details só volta ao banco quando outro lead abre (salvar o próximo passo não apaga o que foi digitado). */
  const formLeadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedLead) {
      formLeadIdRef.current = null;
      setLinkedJobsCount(null);
      setLeadImages([]);
      return;
    }
    if (formLeadIdRef.current === selectedLead.id) return;
    formLeadIdRef.current = selectedLead.id;
    setEditErrors({});
    setLeadImages(normalizeJsonImageArray(selectedLead.images));
    setEditForm({
      name: selectedLead.name,
      email: selectedLead.email ?? "",
      phone: selectedLead.phone ?? "",
      address: leadAddressDisplay(selectedLead),
      city: selectedLead.city ?? "",
      postcode: selectedLead.postcode ?? "",
      urgency: selectedLead.urgency,
      scope: selectedLead.scope ?? "",
      status: selectedLead.status,
      catalog_service_id: selectedLead.catalog_service_id ?? "",
      segment: selectedLead.segment ?? "b2c",
      source: selectedLead.source ?? "",
      zendesk_ticket_id: selectedLead.external_ref ?? "",
      next_action: selectedLead.next_action ?? "",
      next_action_at: isoToLocalInput(selectedLead.next_action_at),
    });

    const clientId = selectedLead.client_id;
    if (!clientId) {
      setLinkedJobsCount(0);
      return;
    }
    setLinkedJobsCount(null);
    let cancelled = false;
    countJobsForClient(clientId).then((n) => {
      if (!cancelled) setLinkedJobsCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedLead]);

  const columns: Column<Lead>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Lead",
        sortable: true,
        minWidth: "10rem",
        cellClassName: "min-w-[9rem] max-w-[min(100vw-8rem,22rem)] sm:max-w-xs lg:max-w-sm",
        render: (item) => {
          const urgency = urgencyConfig[item.urgency] ?? urgencyConfig.medium;
          const value = leadValue(item, quotesByLead[item.id]);
          return (
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
              <p className="font-mono text-[10px] text-text-tertiary tabular-nums">
                {item.reference}
                {value ? <span className="ml-2 font-sans text-text-secondary">{gbp(value)}</span> : null}
              </p>
              {item.urgency === "high" || item.urgency === "urgent" ? (
                <Badge variant={urgency.variant} className="text-[10px] px-1.5 py-0">
                  {urgency.label}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "segment",
        label: "Segment",
        minWidth: "4.5rem",
        headerClassName: "hidden sm:table-cell",
        cellClassName: "hidden sm:table-cell",
        render: (item) => <span className="text-xs text-text-secondary">{SEGMENT_LABEL[item.segment ?? "b2c"]}</span>,
      },
      {
        key: "source",
        label: "Source",
        minWidth: "6rem",
        headerClassName: "hidden md:table-cell",
        cellClassName: "hidden md:table-cell",
        render: (item) => (
          <span className="text-xs text-text-secondary">{item.source ? channelLabel.get(item.source) ?? item.source : "·"}</span>
        ),
      },
      {
        key: "stage",
        label: "Stage",
        minWidth: "6rem",
        render: (item) => {
          const st = item.stage ?? "new";
          return (
            <Badge variant={STAGE_VARIANT[st]} marker={false}>
              {STAGE_LABEL[st]}
            </Badge>
          );
        },
      },
      {
        key: "next_action_at",
        label: "Next action",
        sortable: true,
        minWidth: "10rem",
        cellClassName: "max-w-[16rem]",
        render: (item) => {
          const open = isOpenStage(item.stage);
          if (!open) return <span className="text-xs text-text-tertiary">·</span>;
          if (!item.next_action_at) return <span className="text-xs text-text-tertiary">·</span>;
          const late = isOverdue(item.next_action_at);
          return (
            <div className={cn("text-xs min-w-0", late ? "text-[var(--bad-ink)] font-semibold" : "text-text-secondary")}>
              <p className="truncate">{item.next_action || "Next action"}</p>
              <p className="tabular-nums text-[11px]">{formatWhen(item.next_action_at)}</p>
            </div>
          );
        },
      },
      {
        key: "last_contact_at",
        label: "Last contact",
        minWidth: "6rem",
        headerClassName: "hidden lg:table-cell",
        cellClassName: "hidden lg:table-cell whitespace-nowrap",
        render: (item) => (
          <span className="text-xs text-text-tertiary tabular-nums">
            {item.last_contact_at ? `${formatAgo(item.last_contact_at)} ago` : "never"}
          </span>
        ),
      },
      {
        key: "external_ref",
        label: "Ticket",
        minWidth: "5rem",
        headerClassName: "hidden sm:table-cell",
        cellClassName: "hidden sm:table-cell whitespace-nowrap",
        render: (item) => {
          const url = zendeskTicketUrl(item.external_ref);
          if (!item.external_ref) return <span className="text-xs text-[var(--bad-ink)]">none</span>;
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium text-primary hover:underline tabular-nums"
            >
              #{item.external_ref}
            </a>
          ) : (
            <span className="text-xs tabular-nums">#{item.external_ref}</span>
          );
        },
      },
      {
        key: "actions",
        label: "",
        width: "2.75rem",
        align: "right",
        headerClassName: "w-11",
        cellClassName: "w-11",
        render: (item) => (
          <button
            type="button"
            title="Delete lead"
            aria-label={`Delete ${item.reference ?? item.name}`}
            disabled={deletingId === item.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(item);
            }}
            className="rounded-lg p-1.5 text-text-tertiary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {deletingId === item.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        ),
      },
    ],
    [deletingId, handleDelete, quotesByLead, channelLabel, STAGE_LABEL],
  );

  const handleCreate = async () => {
    const errors = validateLeadForm(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(Object.values(errors)[0] ?? "Check the form");
      return;
    }
    // Type of Work is required so the Trade Portal can target matching
    // partners. validateLeadForm doesn't cover it (catalog-aware fields aren't
    // in the validator's responsibility), so we gate it here.
    if (!createForm.catalog_service_id.trim()) {
      toast.error("Select a Type of Work");
      return;
    }
    const ticket = createForm.zendesk_ticket_id.trim().replace(/^#/, "");
    const crmErrors: CreateLeadErrors = {};
    if (!/^\d+$/.test(ticket)) crmErrors.zendesk_ticket_id = "Link the Zendesk ticket";
    if (Object.keys(crmErrors).length > 0) {
      setCreateErrors((e) => ({ ...e, ...crmErrors }));
      toast.error(Object.values(crmErrors)[0] ?? "Check the form");
      return;
    }
    setCreating(true);
    try {
      let lead = await createLead({
        name: createForm.name,
        email: createForm.email,
        phone: createForm.phone,
        address: createForm.address,
        city: createForm.city,
        postcode: createForm.postcode,
        urgency: createForm.urgency,
        scope: createForm.scope,
        status: "new",
        catalog_service_id: createForm.catalog_service_id,
        segment: createForm.segment,
        source: createForm.source || null,
        zendesk_ticket_id: ticket,
      });
      // Photos are uploaded after the lead exists (need its id for the folder),
      // then attached — same pattern as service requests.
      if (createPhotos.length > 0) {
        try {
          const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
          const urls = await uploadQuoteInviteImages(createPhotos, `leads/${lead.id}`);
          if (urls.length > 0) lead = await updateLead(lead.id, { images: urls });
        } catch (photoErr) {
          toast.error(
            photoErr instanceof Error ? `Lead created, photos failed: ${photoErr.message}` : "Lead created but photos failed to upload",
          );
        }
      }
      toast.success(`Lead ${lead.reference} created and linked to Fixfy clients`);
      setCreateOpen(false);
      setCreateForm(emptyLeadForm());
      setCreatePhotos([]);
      setCreateErrors({});
      setTab("new");
      await refresh();
      await loadCounts();
      openLead(lead);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create lead");
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedLead) return;
    const errors = validateLeadForm(editForm);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(Object.values(errors)[0] ?? "Check the form");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateLead(selectedLead.id, {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        address: editForm.address,
        city: editForm.city,
        postcode: editForm.postcode,
        urgency: editForm.urgency,
        scope: editForm.scope,
      });
      toast.success("Lead updated");
      setSelectedLead(updated);
      await refresh();
      await loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lead");
    } finally {
      setSaving(false);
    }
  };

  const addLeadPhotos = async (files: File[]) => {
    if (!selectedLead || files.length === 0) return;
    setUploadingPhotos(true);
    try {
      const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
      const urls = await uploadQuoteInviteImages(files, `leads/${selectedLead.id}`);
      const merged = [...leadImages, ...urls];
      const updated = await updateLead(selectedLead.id, { images: merged });
      setLeadImages(normalizeJsonImageArray(updated.images));
      setSelectedLead(updated);
      await refresh();
      toast.success(urls.length === 1 ? "Photo added" : `${urls.length} photos added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload photos");
    } finally {
      setUploadingPhotos(false);
    }
  };

  const removeLeadPhoto = async (url: string) => {
    if (!selectedLead) return;
    const next = leadImages.filter((u) => u !== url);
    setLeadImages(next); // optimistic
    try {
      const updated = await updateLead(selectedLead.id, { images: next });
      setLeadImages(normalizeJsonImageArray(updated.images));
      setSelectedLead(updated);
      await refresh();
    } catch (err) {
      setLeadImages(leadImages); // rollback
      toast.error(err instanceof Error ? err.message : "Could not remove photo");
    }
  };

  /** Mudança vinda do painel do CRM (próximo passo, etapa, dados do job). */
  const onLeadChange = useCallback(
    (l: Lead) => {
      setSelectedLead(l);
      refreshSilent();
      void loadCounts();
    },
    [refreshSilent, loadCounts],
  );

  const togglePublish = async () => {
    if (!selectedLead) return;
    const next = selectedLead.published_at ? null : new Date().toISOString();
    setSaving(true);
    try {
      const updated = await updateLead(selectedLead.id, { published_at: next });
      toast.success(next ? "Lead published. Now live in the Trade Portal" : "Lead unpublished");
      setSelectedLead(updated);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update publish state");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTransition>
      <div className="-mt-2 min-w-0 space-y-4">
        <PageHeader
          title="CRM"
          subtitle="Pipeline has every lead and quote on one board, newest first. Leads is the same list as a table. Updates live as tickets arrive."
          titleAddon={
            <div className="flex flex-wrap items-center gap-2">
              <ViewToggle value={view} onChange={setView} />
              <SegmentToggle value={segment} onChange={setSegment} />
            </div>
          }
        >
          <SearchExpand
            value={search}
            onChange={setSearch}
            label="Search leads"
            placeholder="Search name, ref, ticket, scope"
            width="w-60 sm:w-72"
          />
          <Button
            type="button"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            aria-label="New lead"
            title="New lead"
            onClick={() => {
              setCreateForm(emptyLeadForm());
              setCreateOpen(true);
            }}
            className="!flex-nowrap shrink-0 h-8 w-8 p-0 justify-center sm:w-auto sm:px-3 [&>span:last-child]:whitespace-nowrap"
          >
            <span className="hidden sm:inline">New lead</span>
          </Button>
        </PageHeader>

        {view === "board" ? (
          <LeadBoard
            columns={boardColumns}
            counts={stageCounts}
            quotes={quotesByLead}
            accountNames={accountNames}
            platformAccounts={platformAccounts}
            onMove={(l, to) => void onMove(l, to)}
            canRename={profile?.role === "admin"}
            onLose={(l) => {
              setLostDefault("no_reply");
              setLostLead(l);
            }}
            loading={sideLoading}
            onOpen={openLead}
          />
        ) : (
          <>
            <LeadStageTabs active={tab} counts={stageCounts} onChange={setTab} />
            <p className="text-xs text-text-tertiary tabular-nums">
              {totalItems} lead{totalItems === 1 ? "" : "s"}
              {" · newest first"}
            </p>
            <div className="min-w-0 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
              <DataTable
                className="min-w-[20rem]"
                columns={columns}
                data={data}
                loading={loading}
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                onRowClick={openLead}
                emptyMessage={tab === "open" ? "No open leads. Add one to get started." : `No leads in ${STAGE_LABEL[tab]}.`}
              />
            </div>
          </>
        )}
      </div>

      {quotingLead ? (
        <LeadQuotingModal
          lead={quotingLead}
          catalog={catalogServices}
          open
          onClose={() => setQuotingLead(null)}
          onDone={() => {
            const id = quotingLead.id;
            setQuotingLead(null);
            refreshSilent();
            void loadCounts();
            // A quote nasceu: o card já está em Quoting, o drawer aberto também.
            void getLead(id).then((l) => l && setSelectedLead((cur) => (cur?.id === l.id ? l : cur)));
          }}
        />
      ) : null}
      {lostLead ? (
        <LeadLostModal
          lead={lostLead}
          defaultReason={lostDefault}
          open
          onClose={() => setLostLead(null)}
          onDone={() => {
            const id = lostLead.id;
            setLostLead(null);
            refreshSilent();
            void loadCounts();
            void getLead(id).then((l) => l && setSelectedLead((cur) => (cur?.id === l.id ? l : cur)));
          }}
        />
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateErrors({});
        }}
        title="New lead"
        subtitle="Contact is saved under the Fixfy account in Clients. Link the Zendesk ticket that already exists."
        size="md"
        className="max-w-[min(100vw-1.5rem,32rem)] sm:max-w-lg"
      >
        <div className="px-4 pb-4 pt-4 space-y-3.5 sm:px-5 sm:pb-5 max-h-[min(75dvh,640px)] overflow-y-auto">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <FieldBlock label="Segment">
              <div role="radiogroup" aria-label="Segment" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
                {(["b2c", "b2b"] as LeadSegment[]).map((sg) => (
                  <button
                    key={sg}
                    type="button"
                    role="radio"
                    aria-checked={createForm.segment === sg}
                    onClick={() => setCreateForm((f) => ({ ...f, segment: sg }))}
                    className={cn(
                      "inline-flex h-7 items-center rounded-md px-3 text-[12px] font-semibold transition-colors",
                      createForm.segment === sg ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {SEGMENT_LABEL[sg]}
                  </button>
                ))}
              </div>
            </FieldBlock>
            <FieldBlock label="Source">
              <Select
                value={createForm.source}
                onChange={(e) => setCreateForm((f) => ({ ...f, source: e.target.value }))}
                options={[{ value: "", label: "Select a source…" }, ...channels.map((c) => ({ value: c.key, label: c.label }))]}
              />
            </FieldBlock>
          </div>
          <FieldBlock label="Name" error={createErrors.name}>
            <Input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Client or job title"
              autoFocus
              className={cn(createErrors.name && "border-red-400")}
            />
          </FieldBlock>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <FieldBlock label="Email" error={createErrors.email}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
                className={cn(createErrors.email && "border-red-400")}
              />
            </FieldBlock>
            <FieldBlock label="Phone" error={createErrors.phone}>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="07xxx xxxxxx"
                className={cn(createErrors.phone && "border-red-400")}
              />
            </FieldBlock>
          </div>
          <FieldBlock label="Address" error={createErrors.address}>
            <AddressAutocomplete
              placeholder="Start typing address or postcode…"
              value={createForm.address}
              onChange={(v) =>
                setCreateForm((f) => ({ ...f, address: v, city: "", postcode: "" }))
              }
              onSelect={(parts) => setCreateForm((f) => ({ ...f, ...mapboxPartsToLeadFields(parts) }))}
            />
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Choose a Mapbox suggestion: city and postcode are filled automatically.
            </p>
          </FieldBlock>
          <FieldBlock label="Type of work">
            <Select
              value={createForm.catalog_service_id}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, catalog_service_id: e.target.value }))
              }
              options={[
                { value: "", label: "Select a type of work…" },
                ...catalogServices.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Drives Trade Portal targeting: only partners covering this trade will see the lead.
            </p>
          </FieldBlock>
          <FieldBlock label="Urgency">
            <Select
              value={createForm.urgency}
              onChange={(e) => setCreateForm((f) => ({ ...f, urgency: e.target.value as LeadUrgency }))}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
            />
          </FieldBlock>
          <FieldBlock label="Scope" error={createErrors.scope}>
            <textarea
              value={createForm.scope}
              onChange={(e) => setCreateForm((f) => ({ ...f, scope: e.target.value }))}
              rows={4}
              placeholder="Describe the work, access, and any constraints…"
              className={cn(
                "w-full min-h-[5.5rem] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary",
                "placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30",
                createErrors.scope && "border-red-400",
              )}
            />
          </FieldBlock>
          <FieldBlock label="Zendesk ticket · required" error={createErrors.zendesk_ticket_id}>
            <Input
              inputMode="numeric"
              value={createForm.zendesk_ticket_id}
              onChange={(e) => setCreateForm((f) => ({ ...f, zendesk_ticket_id: e.target.value }))}
              placeholder="48230"
              className={cn(createErrors.zendesk_ticket_id && "border-red-400")}
            />
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              The ticket where the conversation already is. The job inherits it later.
            </p>
          </FieldBlock>
          <FieldBlock label="Photos (optional)">
            <div className="flex flex-wrap items-center gap-2">
              {createPhotos.map((file, i) => (
                <div key={`${file.name}-${i}`} className="relative h-16 w-16 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    className="h-16 w-16 rounded-lg object-cover border border-border-light"
                  />
                  <button
                    type="button"
                    onClick={() => setCreatePhotos((p) => p.filter((_, idx) => idx !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-surface border border-border-light p-0.5 text-text-tertiary hover:text-red-600 shadow-sm"
                    aria-label="Remove photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-text-tertiary hover:border-primary hover:text-primary transition-colors">
                <ImagePlus className="h-5 w-5" />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) setCreatePhotos((p) => [...p, ...files]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Site or reference photos. JPG/PNG/WebP, up to 5 MB each.
            </p>
          </FieldBlock>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating} className="w-full sm:w-auto">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create lead"}
            </Button>
          </div>
        </div>
      </Modal>

      <Drawer
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        title={selectedLead?.reference ?? "Lead"}
        subtitle={selectedLead?.name}
        width="w-full sm:w-[min(100vw-2rem,30rem)] lg:w-[min(100vw-3rem,38rem)]"
        footer={
          selectedLead ? (
            <div className="flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
              <Button
                variant={selectedLead.published_at ? "ghost" : "secondary"}
                onClick={togglePublish}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                {selectedLead.published_at ? "Unpublish" : "Publish to partners"}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="w-full sm:ml-auto sm:w-auto">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
              </Button>
            </div>
          ) : null
        }
      >
        {selectedLead ? (
          <div className="px-4 py-4 space-y-4 sm:px-5 sm:py-5">
            <LeadCrmHeader lead={selectedLead} sourceLabel={selectedLead.source ? channelLabel.get(selectedLead.source) : null} />
            <Tabs
              tabs={[
                { id: "overview", label: "Overview" },
                { id: "activity", label: "Activity" },
              ]}
              activeTab={drawerTab}
              onChange={(id) => setDrawerTab(id as typeof drawerTab)}
            />
            {drawerTab === "overview" ? (
              <LeadCrmPanel
                lead={selectedLead}
                catalog={catalogServices}
                onLeadChange={onLeadChange}
                onMove={(to) => void onMove(selectedLead, to)}
                onLose={() => {
                  setLostDefault(undefined);
                  setLostLead(selectedLead);
                }}
                details={
                  <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={urgencyConfig[selectedLead.urgency].variant}>
                {urgencyConfig[selectedLead.urgency].label} urgency
              </Badge>
              {selectedLead.client_id ? (
                <Badge variant="info">Fixfy client linked</Badge>
              ) : null}
              {linkedJobsCount === 0 ? (
                <span title="No job available yet · labour-only lead" className="inline-flex">
                  <Badge variant="warning">Lead only</Badge>
                </span>
              ) : linkedJobsCount && linkedJobsCount > 0 ? (
                <Badge variant="success">
                  {linkedJobsCount} job{linkedJobsCount === 1 ? "" : "s"} linked
                </Badge>
              ) : null}
              {selectedLead.published_at ? (
                <Badge variant="default">Offered to partners</Badge>
              ) : null}
            </div>

            <LeadOffersCard leadId={selectedLead.id} published={!!selectedLead.published_at} />

            {/* Photos */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Photos {leadImages.length > 0 ? `(${leadImages.length})` : ""}
                </p>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer">
                  {uploadingPhotos ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  Add photos
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploadingPhotos}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) void addLeadPhotos(files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {leadImages.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {leadImages.map((url) => (
                    <div key={url} className="relative group aspect-square">
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full rounded-lg object-cover border border-border-light"
                        />
                      </a>
                      <button
                        type="button"
                        onClick={() => void removeLeadPhoto(url)}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-surface border border-border-light p-0.5 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-red-600 shadow-sm transition-opacity"
                        aria-label="Remove photo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-tertiary">No photos yet.</p>
              )}
            </div>

            {selectedLead.client_id ? (
              <Link
                href="/clients"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                Open Clients directory
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : null}

            <FieldBlock label="Name" error={editErrors.name}>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(editErrors.name && "border-red-400")}
              />
            </FieldBlock>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <FieldBlock label="Email" error={editErrors.email}>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className={cn(editErrors.email && "border-red-400")}
                />
              </FieldBlock>
              <FieldBlock label="Phone" error={editErrors.phone}>
                <Input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className={cn(editErrors.phone && "border-red-400")}
                />
              </FieldBlock>
            </div>

            <FieldBlock label="Address" error={editErrors.address}>
              <AddressAutocomplete
                placeholder="Start typing address or postcode…"
                value={editForm.address}
                onChange={(v) =>
                  setEditForm((f) => ({ ...f, address: v, city: "", postcode: "" }))
                }
                onSelect={(parts) => setEditForm((f) => ({ ...f, ...mapboxPartsToLeadFields(parts) }))}
              />
              <p className="mt-1.5 text-[11px] text-text-tertiary">
                Choose a Mapbox suggestion: city and postcode are filled automatically.
              </p>
            </FieldBlock>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <FieldBlock label="Urgency">
                <Select
                  value={editForm.urgency}
                  onChange={(e) => setEditForm((f) => ({ ...f, urgency: e.target.value as LeadUrgency }))}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                />
              </FieldBlock>

            </div>

            <FieldBlock label="Scope" error={editErrors.scope}>
              <textarea
                value={editForm.scope}
                onChange={(e) => setEditForm((f) => ({ ...f, scope: e.target.value }))}
                rows={6}
                className={cn(
                  "w-full min-h-[6rem] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30",
                  editErrors.scope && "border-red-400",
                )}
              />
            </FieldBlock>

            <p className="text-[11px] text-text-tertiary leading-snug">
              Lead saved under the Fixfy account (matched by email). Interested leads can be offered to partners as
              labour-only when no job is available yet.
            </p>

            <div className="pt-4 mt-2 border-t border-dashed border-border-light">
              <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">
                Danger zone
              </p>
              <p className="text-xs text-text-tertiary mb-3">
                Permanently removes this lead from the OS and partner portal. Partner interest records stay in the audit
                trail but the lead no longer appears anywhere.
              </p>
              <Button
                type="button"
                variant="danger"
                className="w-full sm:w-auto"
                disabled={deletingId === selectedLead.id || saving}
                icon={
                  deletingId === selectedLead.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )
                }
                onClick={() => void handleDelete(selectedLead)}
              >
                Delete lead
              </Button>
            </div>
                  </div>
                }
              />
            ) : (
              <LeadTimeline leadId={selectedLead.id} reloadKey={Date.parse(selectedLead.updated_at) || 0} />
            )}
          </div>
        ) : null}
      </Drawer>
    </PageTransition>
  );
}
