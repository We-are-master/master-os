"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency, cn } from "@/lib/utils";
import { jobBillableRevenue } from "@/lib/job-financials";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { Award, Star } from "lucide-react";

interface OwnerStat {
  name: string;
  revenue: number;
  jobCount: number;
}

function currentMonthLocalBounds(): { fromDay: string; toDay: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return {
    fromDay: `${y}-${pad(m + 1)}-01`,
    toDay: `${y}-${pad(m + 1)}-${pad(last)}`,
    label: new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

export function BestSellersByOwner() {
  const [data, setData] = useState<OwnerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const monthMeta = useMemo(() => currentMonthLocalBounds(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      const { fromDay, toDay } = monthMeta;
      const selFull = "owner_name, client_price, extras_amount, status";
      const selLegacy = "owner_name, client_price, status";

      async function run(columns: string) {
        return supabase
          .from("jobs")
          .select(columns)
          .is("deleted_at", null)
          .not("scheduled_finish_date", "is", null)
          .gte("scheduled_finish_date", fromDay)
          .lte("scheduled_finish_date", toDay)
          .neq("status", "cancelled");
      }

      let res = await run(selFull);
      if (res.error && isPostgrestWriteRetryableError(res.error)) {
        res = await run(selLegacy);
      }
      if (cancelled) return;
      if (res.error) {
        setData([]);
        setLoading(false);
        return;
      }

      const rows = (res.data ?? []) as {
        owner_name?: string | null;
        client_price?: number;
        extras_amount?: number | null;
        status?: string;
      }[];

      const map = new Map<string, OwnerStat>();
      for (const j of rows) {
        const name = (j.owner_name?.trim() || "Unassigned") as string;
        const row = map.get(name) ?? { name, revenue: 0, jobCount: 0 };
        row.jobCount += 1;
        row.revenue += jobBillableRevenue(j as Parameters<typeof jobBillableRevenue>[0]);
        map.set(name, row);
      }

      const list = Array.from(map.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      setData(list);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [monthMeta.fromDay, monthMeta.toDay]);

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <Card padding="none" className="h-full border-border-light overflow-hidden">
      <CardHeader className="px-5 pt-4 pb-2 flex flex-row items-start justify-between gap-3 mb-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center shrink-0">
            <Award className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Best sellers</CardTitle>
            <p className="text-xs text-text-tertiary mt-0.5">
              Expected revenue by job owner · jobs with expected finish in {monthMeta.label}
            </p>
          </div>
        </div>
      </CardHeader>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-hover" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-text-tertiary py-8 text-center">No jobs scheduled to finish this month</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.map((row, i) => (
              <li
                key={row.name}
                className="rounded-xl border border-border-light/80 bg-surface-hover/30 p-3 flex flex-col gap-2 min-h-[5.5rem]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold",
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : i === 1
                          ? "bg-slate-100 text-slate-600"
                          : i === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-surface-hover text-text-tertiary",
                    )}
                  >
                    {i === 0 ? <Star className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <p className="text-sm font-semibold text-text-primary truncate flex-1">{row.name}</p>
                  <p className="text-sm font-bold tabular-nums text-text-primary shrink-0">{formatCurrency(row.revenue)}</p>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden mt-auto">
                  <div
                    className="h-full rounded-full bg-emerald-500/80 transition-all duration-500"
                    style={{ width: `${(row.revenue / maxRev) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-text-tertiary">{row.jobCount} job{row.jobCount === 1 ? "" : "s"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
