"use client";

import { useEffect, useState } from "react";
import { startOfMonth, endOfMonth, formatISO } from "date-fns";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";

type RankedRow = {
  rowId: string;
  name: string;
  /** When grouped by account this is the owner; for direct clients, undefined. */
  ownerName: string | null;
  /** True when this row aggregates clients under a corporate account. */
  isAccount: boolean;
  jobs: number;
  billed: number;
};

export function TopAccounts() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [rows, setRows] = useState<RankedRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRows(null);
    });
    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const start = bounds?.fromIso ?? formatISO(startOfMonth(now));
      const end = bounds?.toIso ?? formatISO(endOfMonth(now));

      // 1. Pull jobs in period — keep both client_id (for parent lookup) and
      //    client_name (fallback display when there's no account).
      const { data: jobsData } = await supabase
        .from("jobs")
        .select("client_id, client_name, client_price, extras_amount")
        .gte("scheduled_start_at", start)
        .lte("scheduled_start_at", end)
        .neq("status", "cancelled")
        .is("deleted_at", null)
        .limit(2000);

      if (cancelled) return;

      type JobRow = {
        client_id: string | null;
        client_name: string | null;
        client_price: number | null;
        extras_amount: number | null;
      };

      // Aggregate per client: revenue + jobs + display name fallback.
      const byClient = new Map<
        string,
        { revenue: number; jobs: number; clientName: string }
      >();
      // Jobs with no client_id at all — purely orphan.
      let orphanRevenue = 0;
      let orphanJobs = 0;
      for (const r of (jobsData ?? []) as JobRow[]) {
        const value = (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0);
        const cid = r.client_id?.trim();
        if (!cid) {
          orphanRevenue += value;
          orphanJobs += 1;
          continue;
        }
        const cur =
          byClient.get(cid) ?? {
            revenue: 0,
            jobs: 0,
            clientName: r.client_name?.trim() || "Client",
          };
        cur.revenue += value;
        cur.jobs += 1;
        // Keep the most descriptive name we've seen.
        if (!cur.clientName && r.client_name) cur.clientName = r.client_name.trim();
        byClient.set(cid, cur);
      }

      const clientIds = [...byClient.keys()];
      const accountByClient = new Map<string, string | null>();
      const accountIds = new Set<string>();

      // 2. Resolve clients → source_account_id
      if (clientIds.length > 0) {
        const { data: clientsData } = await supabase
          .from("clients")
          .select("id, source_account_id")
          .in("id", clientIds);
        type ClientRow = { id: string; source_account_id?: string | null };
        for (const c of (clientsData ?? []) as ClientRow[]) {
          const aid = c.source_account_id?.trim() || null;
          accountByClient.set(c.id, aid);
          if (aid) accountIds.add(aid);
        }
      }

      // 3. Resolve account names + owner profile names
      const accountMeta = new Map<
        string,
        { company_name: string; account_owner_id: string | null }
      >();
      if (accountIds.size > 0) {
        const { data: accountsData } = await supabase
          .from("accounts")
          .select("id, company_name, account_owner_id")
          .in("id", [...accountIds]);
        type AccRow = {
          id: string;
          company_name?: string | null;
          account_owner_id?: string | null;
        };
        for (const a of (accountsData ?? []) as AccRow[]) {
          accountMeta.set(a.id, {
            company_name: a.company_name?.trim() || "Account",
            account_owner_id: a.account_owner_id?.trim() || null,
          });
        }
      }

      const ownerProfileIds = new Set<string>();
      for (const m of accountMeta.values()) {
        if (m.account_owner_id) ownerProfileIds.add(m.account_owner_id);
      }
      const ownerNames = new Map<string, string>();
      if (ownerProfileIds.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", [...ownerProfileIds]);
        type ProfRow = { id: string; full_name?: string | null; email?: string | null };
        for (const p of (profs ?? []) as ProfRow[]) {
          ownerNames.set(p.id, p.full_name?.trim() || p.email?.trim() || "User");
        }
      }

      // 4. Roll up by account. Anything without a parent account is collapsed
      //    into a single "Direct" bucket — the user wants this card to be
      //    purely about corporate accounts (the owner of the client).
      const byAccount = new Map<string, RankedRow>();
      let directRevenue = orphanRevenue;
      let directJobs = orphanJobs;

      for (const [cid, totals] of byClient) {
        const aid = accountByClient.get(cid);
        if (aid && accountMeta.has(aid)) {
          const meta = accountMeta.get(aid)!;
          const ownerName = meta.account_owner_id
            ? ownerNames.get(meta.account_owner_id) ?? null
            : null;
          const cur =
            byAccount.get(aid) ??
            ({
              rowId: `acc:${aid}`,
              name: meta.company_name,
              ownerName,
              isAccount: true,
              jobs: 0,
              billed: 0,
            } as RankedRow);
          cur.jobs += totals.jobs;
          cur.billed += totals.revenue;
          byAccount.set(aid, cur);
        } else {
          directRevenue += totals.revenue;
          directJobs += totals.jobs;
        }
      }

      const merged: RankedRow[] = [...byAccount.values()].sort((a, b) => b.billed - a.billed);

      if (directRevenue > 0) {
        merged.push({
          rowId: "__direct__",
          name: "Direct (No Account)",
          ownerName: null,
          isAccount: false,
          jobs: directJobs,
          billed: directRevenue,
        });
      }

      setRows(merged.slice(0, 5));
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const max = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.billed)) : 1;

  return (
    <SectionCard
      title="Top Accounts"
      subtitle={`By billed value · ${bounds ? rangeLabel : "this month"}`}
      bodyClassName="p-0"
    >
      <div className="flex flex-col">
        {!rows ? (
          <div className="px-5 py-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-fx-paper-2/40 rounded animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-fx-mute text-[13px]">
            No revenue in this period.
          </div>
        ) : (
          rows.map((r, i) => {
            const pct = (r.billed / max) * 100;
            return (
              <div
                key={r.rowId}
                className={
                  i < rows.length - 1
                    ? "px-5 py-3 grid grid-cols-[1fr_auto] gap-2 items-center border-b border-fx-line"
                    : "px-5 py-3 grid grid-cols-[1fr_auto] gap-2 items-center"
                }
              >
                <div className="min-w-0">
                  <div className="font-medium text-text-primary truncate">{r.name}</div>
                  <MicroLabel className="block mt-1 truncate">
                    {r.isAccount
                      ? `${r.ownerName ? `${r.ownerName} · ` : ""}${r.jobs} job${r.jobs === 1 ? "" : "s"}`
                      : `Direct client · ${r.jobs} job${r.jobs === 1 ? "" : "s"}`}
                  </MicroLabel>
                  <div className="h-1 bg-fx-paper-2 rounded-full mt-2 overflow-hidden">
                    <div
                      className={r.isAccount ? "h-full bg-fx-coral" : "h-full bg-fx-blue"}
                      style={{ width: `${Math.max(8, pct)}%` }}
                    />
                  </div>
                </div>
                <div className="font-semibold text-text-primary tabular-nums">
                  {formatGbp(r.billed)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
