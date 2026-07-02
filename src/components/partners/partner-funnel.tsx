"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Globe, UserCog, LogIn, TrendingDown } from "lucide-react";
import { getSupabase } from "@/services/base";

type FunnelCounts = {
  website: number;
  onboarding: number;
  portal: number;
};

const STAGE_META = [
  {
    key: "website" as const,
    label: "Website",
    hint: "All partners captured through the website / directory signup",
    icon: Globe,
    color: "from-sky-500/25 to-sky-500/5",
    text: "text-sky-600 dark:text-sky-400",
    bar: "bg-sky-500",
  },
  {
    key: "onboarding" as const,
    label: "Onboarding",
    hint: "In compliance / document review — not yet taking work",
    icon: UserCog,
    color: "from-amber-500/25 to-amber-500/5",
    text: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  {
    key: "portal" as const,
    label: "Portal partner",
    hint: "Active partner with a Trade Portal login (auth_user_id set)",
    icon: LogIn,
    color: "from-emerald-500/25 to-emerald-500/5",
    text: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
];

export function PartnerFunnel() {
  const [counts, setCounts] = useState<FunnelCounts>({ website: 0, onboarding: 0, portal: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const supabase = getSupabase();
        const base = () =>
          supabase.from("partners").select("id", { count: "exact", head: true }).is("deleted_at", null);
        const [total, onboarding, portal] = await Promise.all([
          base(),
          base().eq("status", "onboarding"),
          base().not("auth_user_id", "is", null),
        ]);
        if (cancelled) return;
        setCounts({
          website: total.count ?? 0,
          onboarding: onboarding.count ?? 0,
          portal: portal.count ?? 0,
        });
      } catch {
        if (!cancelled) setCounts({ website: 0, onboarding: 0, portal: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = counts.website;
  const overallConversion =
    total > 0 ? Math.round((counts.portal / total) * 1000) / 10 : 0;

  return (
    <Card padding="none" className="overflow-hidden border-border-light">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-border-light">
        <div>
          <p className="text-sm font-semibold text-text-primary">Partner funnel</p>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            Website signup → onboarding → activated portal partner
          </p>
        </div>
        {!loading && total > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              Website → Portal
            </p>
            <p
              className={`text-sm font-bold tabular-nums inline-flex items-center gap-1 ${
                overallConversion >= 50 ? "text-emerald-600" : "text-text-primary"
              }`}
            >
              {overallConversion < 100 && overallConversion > 0 && (
                <TrendingDown className="h-3 w-3 text-text-tertiary" />
              )}
              {overallConversion}%
            </p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border-light">
        {STAGE_META.map((stage, i) => {
          const value = counts[stage.key];
          const prev = i === 0 ? value : counts[STAGE_META[i - 1].key];
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          const stepConv =
            i === 0
              ? 100
              : prev > 0
                ? Math.round((value / prev) * 100)
                : 0;
          const Icon = stage.icon;
          return (
            <div key={stage.key} className="p-4">
              <div className="flex items-start gap-3">
                <div
                  className={`h-8 w-8 rounded-lg bg-gradient-to-br ${stage.color} flex items-center justify-center shrink-0`}
                >
                  <Icon className={`h-3.5 w-3.5 ${stage.text}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                      {stage.label}
                    </p>
                    {i > 0 && (
                      <span className="text-[10px] tabular-nums text-text-tertiary">
                        {stepConv}% from prev
                      </span>
                    )}
                  </div>
                  <p className={`text-2xl font-bold tabular-nums mt-0.5 ${stage.text}`}>
                    {loading ? "—" : value}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug">{stage.hint}</p>
                </div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-surface-hover overflow-hidden">
                <div
                  className={`h-full rounded-full ${stage.bar} transition-all duration-500`}
                  style={{ width: `${Math.max(4, pct)}%` }}
                  aria-label={`${pct}% of directory`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
