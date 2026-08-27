"use client";

import { useEffect, useMemo, useState } from "react";
import { formatBritishDate } from "@/lib/utils/date";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { ExpandingSearch } from "@/components/shared/page-toolbar";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { resolveDateFilter, type DateFilterValue } from "@/lib/date-range-filter";
import { getSupabase } from "@/services/base";
import { listAssignablePartners, type AssignablePartner } from "@/services/partners";
import { formatCurrency } from "@/lib/utils";

/**
 * Settled self-bills, kept where they can be found again.
 *
 * Billing only ever shows the ones still in flight, so a paid self-bill left
 * the screen the moment it was paid — and the answer to "what did we pay this
 * partner in July, and against which reference" lived nowhere in the OS.
 */

type SelfBillRow = {
  id: string;
  reference: string;
  partner_id: string | null;
  partner_name: string | null;
  period: string | null;
  week_label: string | null;
  jobs_count: number | null;
  net_payout: number | null;
  status: string;
  created_at: string;
  approved_at: string | null;
  wise_paid_at: string | null;
  zendesk_ticket_url: string | null;
};

/** Statuses that mean the money question is closed. */
const SETTLED = ["paid", "payout_archived", "rejected"] as const;

const SCOPES = [
  { id: "settled", label: "Settled" },
  { id: "paid", label: "Paid" },
  { id: "rejected", label: "Rejected" },
] as const;

/** Paid date, falling back through the stamps a self-bill collects on its way out. */
function settledAt(row: SelfBillRow): string | null {
  return row.wise_paid_at ?? row.approved_at ?? null;
}

export function SelfBillHistoryClient() {
  const [rows, setRows] = useState<SelfBillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<string>("settled");
  /** "all" · partner_id. Active partners only, same rule as every other partner filter. */
  const [partnerId, setPartnerId] = useState("all");
  const [partners, setPartners] = useState<AssignablePartner[]>([]);
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({ mode: "all", customFrom: "", customTo: "" });
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data } = await getSupabase()
        .from("self_bills")
        .select(
          "id, reference, partner_id, partner_name, period, week_label, jobs_count, net_payout, status, created_at, approved_at, wise_paid_at, zendesk_ticket_url",
        )
        .in("status", [...SETTLED])
        .order("created_at", { ascending: false })
        .limit(5000);
      if (cancelled) return;
      setRows((data ?? []) as SelfBillRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await listAssignablePartners();
      if (!cancelled) setPartners(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bounds = resolveDateFilter(dateFilter);
    return rows.filter((r) => {
      if (partnerId !== "all" && r.partner_id !== partnerId) return false;
      if (scope === "paid" && r.status !== "paid" && r.status !== "payout_archived") return false;
      if (scope === "rejected" && r.status !== "rejected") return false;
      if (bounds) {
        // Filter on when it settled, not when it was raised: that is the date
        // someone means when they ask what we paid in a given month.
        const at = settledAt(r) ?? r.created_at;
        if (at < bounds.fromIso || at > bounds.toIso) return false;
      }
      if (!q) return true;
      return [r.reference, r.partner_name, r.period, r.week_label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, scope, dateFilter, partnerId]);

  const total = useMemo(() => filtered.reduce((sum, r) => sum + (Number(r.net_payout) || 0), 0), [filtered]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Derived, not an effect: narrowing the filter past the current page snaps
  // back to a page that exists instead of showing an empty table for a render.
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage],
  );

  const columns: Column<SelfBillRow>[] = [
    {
      key: "reference",
      label: "Self-bill",
      minWidth: "9rem",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-text-primary">{r.reference}</p>
          <p className="truncate text-[11px] text-text-tertiary">{r.week_label || r.period || "—"}</p>
        </div>
      ),
    },
    {
      key: "partner_name",
      label: "Partner",
      minWidth: "10rem",
      render: (r) => <span className="text-[13px] text-text-primary">{r.partner_name || "—"}</span>,
    },
    {
      key: "jobs_count",
      label: "Jobs",
      minWidth: "4rem",
      align: "right",
      render: (r) => <span className="text-[13px] tabular-nums text-text-secondary">{r.jobs_count ?? 0}</span>,
    },
    {
      key: "settled_at",
      label: "Settled",
      minWidth: "7rem",
      render: (r) => {
        const at = settledAt(r);
        return (
          <span className="text-[12.5px] tabular-nums text-text-secondary">
            {at ? formatBritishDate(at) : "—"}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      minWidth: "6.5rem",
      render: (r) =>
        r.status === "rejected" ? (
          <Badge variant="danger" size="sm">Rejected</Badge>
        ) : r.status === "payout_archived" ? (
          <Badge variant="default" size="sm">Archived</Badge>
        ) : (
          <Badge variant="success" size="sm">Paid</Badge>
        ),
    },
    {
      key: "net_payout",
      label: "Paid out",
      minWidth: "7rem",
      align: "right",
      footer: (
        <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(total)}</span>
      ),
      render: (r) => (
        <span className="text-[13px] font-semibold tabular-nums text-text-primary">
          {formatCurrency(Number(r.net_payout) || 0)}
        </span>
      ),
    },
    {
      key: "ticket",
      label: "",
      minWidth: "3rem",
      align: "right",
      render: (r) =>
        r.zendesk_ticket_url ? (
          <a
            href={r.zendesk_ticket_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex text-text-tertiary hover:text-primary"
            aria-label={`Open ticket for ${r.reference}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null,
    },
  ];

  return (
    <PageTransition className="flex min-h-0 flex-col gap-4">
      <PageHeader
        title="Self-bill history"
        infoTooltip={"Self-bills that are settled: paid, archived after payout, or rejected. Billing keeps the ones still in flight."}
      >
        <Link
          href="/finance/billing"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Billing
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl options={[...SCOPES]} value={scope} onChange={setScope} />
        <div className="ml-auto flex items-center gap-2">
          <select
            aria-label="Partner"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="h-8 max-w-[13rem] rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-text-primary outline-none focus:border-primary/40"
          >
            <option value="all">All partners</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.company_name?.trim() || p.contact_name?.trim() || "Partner"}
              </option>
            ))}
          </select>
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <ExpandingSearch
            value={search}
            onChange={setSearch}
            placeholder="Search reference, partner, period…"
            expandedWidthClass="w-64"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={pageRows}
        getRowId={(r) => r.id}
        loading={loading}
        page={safePage}
        pageSize={pageSize}
        totalItems={filtered.length}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={search.trim() ? "No settled self-bill matches that search." : "No settled self-bills yet."}
      />
    </PageTransition>
  );
}
