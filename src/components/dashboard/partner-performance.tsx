"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency } from "@/lib/utils";
import { TrendingUp, Star } from "lucide-react";

interface PartnerStat {
  name: string;
  jobCount: number;
  revenue: number;
  avgMargin: number;
  completedCount: number;
}

export function PartnerPerformance() {
  const [data, setData] = useState<PartnerStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const { data: jobs } = await supabase
          .from("jobs")
          .select("partner_name, client_price, margin_percent, status")
          .not("partner_name", "is", null);

        const map = new Map<string, PartnerStat>();
        for (const j of (jobs ?? []) as { partner_name: string; client_price?: number; margin_percent?: number; status: string }[]) {
          const name = j.partner_name;
          const existing = map.get(name) ?? { name, jobCount: 0, revenue: 0, avgMargin: 0, completedCount: 0 };
          existing.jobCount++;
          existing.revenue += Number(j.client_price ?? 0);
          existing.avgMargin += Number(j.margin_percent ?? 0);
          if (j.status === "completed") existing.completedCount++;
          map.set(name, existing);
        }

        const result = Array.from(map.values())
          .map((p) => ({ ...p, avgMargin: p.jobCount > 0 ? Math.round((p.avgMargin / p.jobCount) * 10) / 10 : 0 }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8);

        setData(result);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Top Partners</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">Ranked by revenue generated</p>
        </div>
        <TrendingUp className="h-4 w-4 text-text-tertiary" />
      </CardHeader>
      <div className="px-5 pb-5 space-y-2">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="h-7 w-7 rounded-full animate-pulse bg-surface-tertiary flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-28 animate-pulse bg-surface-tertiary rounded" />
                  <div className="h-2 w-full animate-pulse bg-surface-hover rounded-full" />
                </div>
                <div className="h-3 w-16 animate-pulse bg-surface-tertiary rounded" />
              </div>
            ))
          : data.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-text-tertiary">No partner data</p>
              </div>
            )
          : data.map((partner, i) => (
              <div key={partner.name} className="flex items-center gap-3 py-1.5 group">
                {/* rank badge */}
                <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
                  i === 0 ? "bg-amber-100 text-amber-700" :
                  i === 1 ? "bg-slate-100 text-slate-600" :
                  i === 2 ? "bg-orange-100 text-orange-700" :
                  "bg-surface-hover text-text-tertiary"
                }`}>
                  {i === 0 ? <Star className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-text-primary truncate max-w-[140px]">{partner.name}</p>
                    <p className="text-xs font-bold text-text-primary ml-2 flex-shrink-0">{formatCurrency(partner.revenue)}</p>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${(partner.revenue / maxRevenue) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-text-tertiary">{partner.jobCount} jobs</span>
                    <span className="text-[10px] text-text-tertiary">{partner.completedCount} completed</span>
                    <span className={`text-[10px] font-medium ${partner.avgMargin >= 20 ? "text-emerald-600" : "text-red-500"}`}>
                      {partner.avgMargin}% margin
                    </span>
                  </div>
                </div>
              </div>
            ))}
      </div>
    </Card>
  );
}
