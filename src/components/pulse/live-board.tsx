"use client";

import { pulseMoney } from "@/lib/pulse-money-display";
import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { getSupabase } from "@/services/base";
import { JOB_LIST_ALL_TAB_STATUSES } from "@/services/jobs";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import { LiveIndicator, MicroLabel, Pill, SectionCard } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { cn } from "@/lib/utils";
import type { LeadUrgency, QuoteStatus } from "@/types/database";

export type LiveBoardMode = "jobs" | "quotes" | "leads";

const MODES: { id: LiveBoardMode; label: string }[] = [
  { id: "jobs", label: "Jobs" },
  { id: "quotes", label: "Quotes" },
  { id: "leads", label: "Leads" },
];

type LiveJob = {
  id: string;
  reference: string;
  title: string;
  client_name: string;
  property_address: string | null;
  partner_name: string | null;
  status: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  client_price: number;
  extras_amount: number | null;
};

type LiveQuote = {
  id: string;
  reference: string;
  title: string;
  client_name: string;
  property_address?: string | null;
  status: QuoteStatus;
  total_value: number;
  source_account_name?: string | null;
  created_at: string;
};

type LiveLead = {
  id: string;
  reference: string;
  name: string;
  address: string;
  urgency: LeadUrgency;
  scope: string;
  status: string;
  created_at: string;
};

const LIVE_QUOTE_STATUSES: QuoteStatus[] = ["draft", "bidding"];

const MODE_META: Record<
  LiveBoardMode,
  { title: string; href: string; linkLabel: string; empty: string; loading: string }
> = {
  jobs: {
    title: "Live Jobs",
    href: "/schedule",
    linkLabel: "Open Live View →",
    empty: "No active jobs right now.",
    loading: "Loading live jobs…",
  },
  quotes: {
    title: "Live Quotes",
    href: "/quotes",
    linkLabel: "Open Quotes →",
    empty: "No new or bidding quotes.",
    loading: "Loading live quotes…",
  },
  leads: {
    title: "Live Leads",
    href: "/crm?side=b2c",
    linkLabel: "Open Leads →",
    empty: "No new leads.",
    loading: "Loading live leads…",
  },
};

export function LiveBoard() {
  const [mode, setMode] = useState<LiveBoardMode>("jobs");
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [quotes, setQuotes] = useState<LiveQuote[]>([]);
  const [leads, setLeads] = useState<LiveLead[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const supabase = getSupabase();

      if (mode === "jobs") {
        const statuses = [...JOB_LIST_ALL_TAB_STATUSES];
        const [listRes, countRes] = await Promise.all([
          supabase
            .from("jobs")
            .select(
              "id, reference, title, client_name, property_address, partner_name, status, scheduled_start_at, scheduled_end_at, client_price, extras_amount",
            )
            .in("status", statuses)
            .is("deleted_at", null)
            .order("scheduled_start_at", { ascending: true, nullsFirst: false })
            .limit(50),
          supabase
            .from("jobs")
            .select("id", { count: "exact", head: true })
            .in("status", statuses)
            .is("deleted_at", null),
        ]);
        if (cancelled) return;
        setJobs(((listRes.data ?? []) as LiveJob[]).slice(0, 5));
        setActiveCount(countRes.count ?? 0);
      } else if (mode === "quotes") {
        const [listRes, countRes] = await Promise.all([
          supabase
            .from("quotes")
            .select(
              "id, reference, title, client_name, client_id, source_account_id, property_address, status, total_value, created_at",
            )
            .in("status", LIVE_QUOTE_STATUSES)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("quotes")
            .select("id", { count: "exact", head: true })
            .in("status", LIVE_QUOTE_STATUSES)
            .is("deleted_at", null),
        ]);
        if (cancelled) return;
        const raw = (listRes.data ?? []) as Array<
          Omit<LiveQuote, "source_account_name"> & {
            client_id?: string | null;
            source_account_id?: string | null;
          }
        >;
        const clientIds = [...new Set(raw.map((q) => q.client_id?.trim()).filter(Boolean))] as string[];
        const labels = clientIds.length > 0 ? await batchResolveLinkedAccountLabels(supabase, clientIds) : new Map();
        const accountIds = [
          ...new Set(
            raw
              .map((q) => q.source_account_id?.trim())
              .filter((x): x is string => Boolean(x)),
          ),
        ];
        const accountNameById = new Map<string, string>();
        if (accountIds.length > 0) {
          const { data: accs } = await supabase
            .from("accounts")
            .select("id, company_name")
            .in("id", accountIds)
            .is("deleted_at", null);
          for (const a of accs ?? []) {
            const row = a as { id: string; company_name?: string | null };
            accountNameById.set(row.id, row.company_name?.trim() || "Account");
          }
        }
        const enriched: LiveQuote[] = raw.map((q) => {
          const fromClient = q.client_id ? labels.get(q.client_id) ?? null : null;
          const fromStored = q.source_account_id
            ? accountNameById.get(q.source_account_id.trim()) ?? null
            : null;
          return {
            id: q.id,
            reference: q.reference,
            title: q.title,
            client_name: q.client_name,
            property_address: q.property_address,
            status: q.status,
            total_value: q.total_value,
            created_at: q.created_at,
            source_account_name: fromStored ?? fromClient,
          };
        });
        setQuotes(enriched);
        setActiveCount(countRes.count ?? 0);
      } else {
        // Os leads de verdade (site, WhatsApp, lançados à mão), os mesmos da tela Leads.
        // A tabela `leads` antiga é de jobs oferecidos a parceiros (11/10/2026).
        const ABERTOS = ["new", "hot", "contacted"];
        const [listRes, countRes] = await Promise.all([
          supabase
            .from("site_leads")
            .select("id, full_name, email, phone, postcode, channel, status, service_label, created_at, last_activity_at")
            .in("status", ABERTOS)
            .order("last_activity_at", { ascending: false })
            .limit(5),
          supabase.from("site_leads").select("id", { count: "exact", head: true }).in("status", ABERTOS),
        ]);
        if (cancelled) return;
        type SiteLead = { id: string; full_name: string | null; email: string | null; phone: string | null; postcode: string | null; channel: string | null; status: string; service_label: string | null; created_at: string };
        setLeads(
          ((listRes.data ?? []) as SiteLead[]).map((l) => ({
            id: l.id,
            reference: (l.channel ?? "website").replace(/_/g, " "),
            name: l.full_name || l.email || l.phone || "Lead",
            address: l.postcode ?? "",
            urgency: (l.status === "hot" ? "high" : l.status === "contacted" ? "low" : "medium") as LeadUrgency,
            scope: l.service_label ?? "",
            status: l.status,
            created_at: l.created_at,
          })),
        );
        setActiveCount(countRes.count ?? 0);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const meta = MODE_META[mode];
  const countLabel =
    mode === "jobs"
      ? `${activeCount} active`
      : mode === "quotes"
        ? `${activeCount} open`
        : `${activeCount} new`;

  return (
    <SectionCard
      title={
        <div className="flex items-center gap-3 flex-wrap">
          <span>{meta.title}</span>
          <LiveIndicator label={countLabel} />
        </div>
      }
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <LiveModeToggle mode={mode} onChange={setMode} />
          <Link
            href={meta.href}
            className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors whitespace-nowrap"
          >
            {meta.linkLabel}
          </Link>
        </div>
      }
      bodyClassName="p-0 overflow-x-auto"
    >
      {mode === "jobs" && (
        <JobsTable jobs={jobs} loading={loading} empty={meta.empty} loadingLabel={meta.loading} />
      )}
      {mode === "quotes" && (
        <QuotesTable quotes={quotes} loading={loading} empty={meta.empty} loadingLabel={meta.loading} />
      )}
      {mode === "leads" && (
        <LeadsTable leads={leads} loading={loading} empty={meta.empty} loadingLabel={meta.loading} />
      )}
    </SectionCard>
  );
}

function LiveModeToggle({
  mode,
  onChange,
}: {
  mode: LiveBoardMode;
  onChange: (m: LiveBoardMode) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-fx-line bg-fx-paper p-0.5"
      role="tablist"
      aria-label="Live feed"
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          onClick={() => onChange(m.id)}
          className={cn(
            "px-2.5 py-1 rounded text-[12px] font-medium transition-colors",
            mode === m.id
              ? "bg-card text-text-primary shadow-sm"
              : "text-fx-mute hover:text-text-primary",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Uma linha do Live Board que cabe em qualquer largura (dono, 12/10/2026): em meia tela a
 * tabela de 7 colunas quebrava cada célula em 4 linhas. Agora são duas linhas por item:
 * título + valor, e embaixo o resumo cortado com reticências. O texto inteiro fica no
 * `title` (aparece ao passar o mouse) e a linha toda abre o item.
 */
function LinhaViva({
  href,
  titulo,
  referencia,
  resumo,
  completo,
  selo,
  valor,
}: {
  href: string;
  titulo: string;
  referencia: string;
  /** Os pedaços do resumo, do mais importante para o menos: os últimos somem primeiro. */
  resumo: Array<string | null | undefined>;
  /** Tudo, sem corte, para o tooltip. */
  completo: string;
  selo?: React.ReactNode;
  valor?: string | null;
}) {
  const partes = resumo.map((r) => r?.trim()).filter(Boolean) as string[];
  return (
    <Link
      href={href}
      title={completo}
      className="flex min-w-0 items-center gap-3 border-b border-fx-line px-4 py-2.5 transition-colors last:border-0 hover:bg-fx-paper"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-text-primary">{titulo}</span>
          <MicroLabel className="shrink-0">{referencia}</MicroLabel>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-fx-mute">{partes.join(" · ") || "—"}</div>
      </div>
      {selo ? <div className="shrink-0">{selo}</div> : null}
      {valor ? <span className="w-[72px] shrink-0 text-right text-[13px] font-medium tabular-nums text-text-primary">{valor}</span> : null}
    </Link>
  );
}

function ListaVazia({ message }: { message: string }) {
  return <p className="m-0 px-4 py-8 text-center text-[13px] text-fx-mute">{message}</p>;
}

function JobsTable({ jobs, loading, empty, loadingLabel }: { jobs: LiveJob[]; loading: boolean; empty: string; loadingLabel: string }) {
  if (loading) return <ListaVazia message={loadingLabel} />;
  if (jobs.length === 0) return <ListaVazia message={empty} />;
  return (
    <div className="flex flex-col">
      {jobs.map((j) => {
        const pc = extractUkPostcode(j.property_address ?? "");
        const janela = formatWindow(j.scheduled_start_at, j.scheduled_end_at);
        const valor = formatGbp(Number(j.client_price) + (Number(j.extras_amount) || 0));
        return (
          <LinhaViva
            key={j.id}
            href={`/jobs/${j.id}`}
            titulo={j.title}
            referencia={j.reference}
            resumo={[j.client_name, j.partner_name || "Unassigned", janela, pc]}
            completo={[`${j.title} (${j.reference})`, `Client: ${j.client_name}`, j.property_address ? `Address: ${j.property_address}` : null, `Partner: ${j.partner_name || "Unassigned"}`, `Window: ${janela}`, `Value: ${valor}`].filter(Boolean).join("\n")}
            selo={<JobStatusPill status={j.status} />}
            valor={valor}
          />
        );
      })}
    </div>
  );
}

function QuotesTable({ quotes, loading, empty, loadingLabel }: { quotes: LiveQuote[]; loading: boolean; empty: string; loadingLabel: string }) {
  if (loading) return <ListaVazia message={loadingLabel} />;
  if (quotes.length === 0) return <ListaVazia message={empty} />;
  return (
    <div className="flex flex-col">
      {quotes.map((q) => {
        const valor = formatGbp(Number(q.total_value) || 0);
        const endereco = q.property_address?.trim() ? shortAddress(q.property_address) : null;
        return (
          <LinhaViva
            key={q.id}
            href={`/quotes?search=${encodeURIComponent(q.reference)}`}
            titulo={q.title}
            referencia={q.reference}
            resumo={[q.client_name, q.source_account_name, endereco]}
            completo={[`${q.title} (${q.reference})`, `Client: ${q.client_name}`, q.source_account_name?.trim() ? `Account: ${q.source_account_name}` : null, q.property_address?.trim() ? `Address: ${q.property_address}` : null, `Value: ${valor}`].filter(Boolean).join("\n")}
            selo={<QuoteStatusPill status={q.status} />}
            valor={valor}
          />
        );
      })}
    </div>
  );
}

function LeadsTable({ leads, loading, empty, loadingLabel }: { leads: LiveLead[]; loading: boolean; empty: string; loadingLabel: string }) {
  if (loading) return <ListaVazia message={loadingLabel} />;
  if (leads.length === 0) return <ListaVazia message={empty} />;
  return (
    <div className="flex flex-col">
      {leads.map((l) => (
        <LinhaViva
          key={l.id}
          href="/crm?side=b2c"
          titulo={l.name}
          referencia={l.reference}
          resumo={[l.scope, l.address]}
          completo={[`${l.name} (${l.reference})`, l.scope?.trim() ? `Wants: ${l.scope}` : null, l.address?.trim() ? `Postcode: ${l.address}` : null].filter(Boolean).join("\n")}
          selo={<LeadUrgencyPill urgency={l.urgency} />}
        />
      ))}
    </div>
  );
}

function JobStatusPill({ status }: { status: string }) {
  const label = jobStatusLabel(status);
  switch (status) {
    case "in_progress":
      return <Pill tone="info">{label}</Pill>;
    case "final_check":
      return <Pill tone="violet">{label}</Pill>;
    case "late":
      return <Pill tone="coral">{label}</Pill>;
    case "scheduled":
      return <Pill tone="ok">{label}</Pill>;
    case "awaiting_payment":
      return <Pill tone="warn">{label}</Pill>;
    case "need_attention":
      return <Pill tone="bad">{label}</Pill>;
    case "on_hold":
      return <Pill tone="warn">{label}</Pill>;
    case "unassigned":
    case "auto_assigning":
      return <Pill tone="bad">{label}</Pill>;
    default:
      return <Pill tone="ghost">{label}</Pill>;
  }
}

function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  if (status === "draft") return <Pill tone="info">New</Pill>;
  if (status === "bidding") return <Pill tone="coral">Bidding</Pill>;
  return <Pill tone="ghost">{status.replace(/_/g, " ")}</Pill>;
}

function LeadUrgencyPill({ urgency }: { urgency: LeadUrgency }) {
  switch (urgency) {
    case "urgent":
      return <Pill tone="bad">Urgent</Pill>;
    case "high":
      return <Pill tone="warn">High</Pill>;
    case "medium":
      return <Pill tone="info">Medium</Pill>;
    default:
      return <Pill tone="ghost">Low</Pill>;
  }
}

function shortAddress(addr: string): string {
  return addr.split(",").slice(0, 2).join(",").trim();
}

function formatWindow(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  return e ? `${format(s, "HH:mm")} — ${format(e, "HH:mm")}` : format(s, "HH:mm");
}

/** Segue a lente de moeda do Pulse (GBP por padrão, BRL quando o usuário troca). */
function formatGbp(n: number): string {
  return pulseMoney(n);
}
