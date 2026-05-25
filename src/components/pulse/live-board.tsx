"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { getSupabase } from "@/services/base";
import { JOB_LIST_ALL_TAB_STATUSES } from "@/services/jobs";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import { FxAvatar, LiveIndicator, MicroLabel, Pill, SectionCard } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";
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
    href: "/leads",
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
        const [listRes, countRes] = await Promise.all([
          supabase
            .from("leads")
            .select("id, reference, name, address, urgency, scope, status, created_at")
            .eq("status", "new")
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("status", "new")
            .is("deleted_at", null),
        ]);
        if (cancelled) return;
        setLeads((listRes.data ?? []) as LiveLead[]);
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

function JobsTable({
  jobs,
  loading,
  empty,
  loadingLabel,
}: {
  jobs: LiveJob[];
  loading: boolean;
  empty: string;
  loadingLabel: string;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {["Job", "Client", "Partner", "Stage", "Window", "Value", ""].map((h) => (
            <th
              key={h}
              className="text-left px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fx-mute bg-fx-paper border-b border-fx-line whitespace-nowrap last:text-right"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <EmptyRow colSpan={7} message={loadingLabel} />
        ) : jobs.length === 0 ? (
          <EmptyRow colSpan={7} message={empty} />
        ) : (
          jobs.map((j) => (
            <tr key={j.id} className="border-b border-fx-line last:border-0 hover:bg-fx-paper transition-colors">
              <td className="px-4 py-3 align-middle">
                <div className="font-medium text-text-primary">{j.title}</div>
                <MicroLabel className="block mt-0.5">{j.reference}</MicroLabel>
              </td>
              <td className="px-4 py-3 align-middle">
                <div className="font-medium text-text-primary">{j.client_name}</div>
                {j.property_address && (
                  <MicroLabel className="block mt-0.5">{shortAddress(j.property_address)}</MicroLabel>
                )}
              </td>
              <td className="px-4 py-3 align-middle">
                {j.partner_name ? (
                  <div className="flex items-center gap-2">
                    <FxAvatar initials={initials(j.partner_name)} tone="coral" size="sm" />
                    <span className="text-text-primary">{j.partner_name}</span>
                  </div>
                ) : (
                  <span className="text-fx-mute italic">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-3 align-middle">
                <JobStatusPill status={j.status} />
              </td>
              <td className="px-4 py-3 align-middle font-mono text-[11.5px] text-fx-mute">
                {formatWindow(j.scheduled_start_at, j.scheduled_end_at)}
              </td>
              <td className="px-4 py-3 align-middle font-medium text-text-primary tabular-nums">
                {formatGbp(Number(j.client_price) + (Number(j.extras_amount) || 0))}
              </td>
              <td className="px-4 py-3 align-middle text-right">
                <OpenLink href={`/jobs/${j.id}`} />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function QuotesTable({
  quotes,
  loading,
  empty,
  loadingLabel,
}: {
  quotes: LiveQuote[];
  loading: boolean;
  empty: string;
  loadingLabel: string;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {["Quote", "Client", "Account", "Stage", "Value", ""].map((h) => (
            <th
              key={h}
              className="text-left px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fx-mute bg-fx-paper border-b border-fx-line whitespace-nowrap last:text-right"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <EmptyRow colSpan={6} message={loadingLabel} />
        ) : quotes.length === 0 ? (
          <EmptyRow colSpan={6} message={empty} />
        ) : (
          quotes.map((q) => (
            <tr key={q.id} className="border-b border-fx-line last:border-0 hover:bg-fx-paper transition-colors">
              <td className="px-4 py-3 align-middle">
                <div className="font-medium text-text-primary">{q.title}</div>
                <MicroLabel className="block mt-0.5">{q.reference}</MicroLabel>
              </td>
              <td className="px-4 py-3 align-middle">
                <div className="font-medium text-text-primary">{q.client_name}</div>
                {q.property_address?.trim() && (
                  <MicroLabel className="block mt-0.5">{shortAddress(q.property_address)}</MicroLabel>
                )}
              </td>
              <td className="px-4 py-3 align-middle text-text-primary">
                {q.source_account_name?.trim() || <span className="text-fx-mute italic">—</span>}
              </td>
              <td className="px-4 py-3 align-middle">
                <QuoteStatusPill status={q.status} />
              </td>
              <td className="px-4 py-3 align-middle font-medium text-text-primary tabular-nums">
                {formatGbp(Number(q.total_value) || 0)}
              </td>
              <td className="px-4 py-3 align-middle text-right">
                <OpenLink href="/quotes" />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function LeadsTable({
  leads,
  loading,
  empty,
  loadingLabel,
}: {
  leads: LiveLead[];
  loading: boolean;
  empty: string;
  loadingLabel: string;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {["Lead", "Address", "Urgency", "Scope", ""].map((h) => (
            <th
              key={h}
              className="text-left px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fx-mute bg-fx-paper border-b border-fx-line whitespace-nowrap last:text-right"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <EmptyRow colSpan={5} message={loadingLabel} />
        ) : leads.length === 0 ? (
          <EmptyRow colSpan={5} message={empty} />
        ) : (
          leads.map((l) => (
            <tr key={l.id} className="border-b border-fx-line last:border-0 hover:bg-fx-paper transition-colors">
              <td className="px-4 py-3 align-middle">
                <div className="font-medium text-text-primary">{l.name}</div>
                <MicroLabel className="block mt-0.5">{l.reference}</MicroLabel>
              </td>
              <td className="px-4 py-3 align-middle max-w-[200px]">
                <span className="text-text-primary line-clamp-2">{l.address?.trim() || "—"}</span>
              </td>
              <td className="px-4 py-3 align-middle">
                <LeadUrgencyPill urgency={l.urgency} />
              </td>
              <td className="px-4 py-3 align-middle max-w-xs">
                <span className="text-fx-mute line-clamp-2 text-[12px]">{l.scope?.trim() || "—"}</span>
              </td>
              <td className="px-4 py-3 align-middle text-right">
                <OpenLink href="/leads" />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-fx-mute">
        {message}
      </td>
    </tr>
  );
}

function OpenLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors"
    >
      Open
    </Link>
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
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

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
