"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";
import { pulseMoney } from "@/lib/pulse-money-display";
import { fetchPulseAutoFlow, type PulseAutoFlowMetrics } from "@/lib/pulse-auto-flow";

/**
 * Painel do circuito automático (Fase 4 do auto-flow): mede se o auto assign
 * aloca rápido SEM destruir margem. Velocidade sem margem é derrota disfarçada,
 * então as duas réguas moram no mesmo card.
 */
export function AutoFlow() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [m, setM] = useState<PulseAutoFlowMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setM(null);
    });
    void (async () => {
      try {
        const result = await fetchPulseAutoFlow(getSupabase(), bounds);
        if (!cancelled) setM(result);
      } catch {
        if (!cancelled) {
          setM({
            autoAssignedPct: null,
            autoAssignedCount: 0,
            assignedCount: 0,
            medianTimeToAcceptMin: null,
            unaccepted24h: 0,
            acceptanceRatePct: null,
            invitesSent: 0,
            cancellationAfterAssignmentPct: null,
            customerConfirmationPct: null,
            avgJobValueGbp: null,
            avgPartnerPayoutGbp: null,
            contributionMarginPct: null,
            jobsCreated: 0,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`);
  const fmtMin = (v: number | null) =>
    v == null ? "—" : v < 60 ? `${v}m` : `${Math.floor(v / 60)}h ${v % 60}m`;

  const tiles: Array<{ label: string; value: string; sub: string; alert?: boolean }> = m
    ? [
        {
          label: "Auto-assigned",
          value: fmtPct(m.autoAssignedPct),
          sub: `${m.autoAssignedCount} of ${m.assignedCount} assigned jobs`,
        },
        {
          label: "Median time to accept",
          value: fmtMin(m.medianTimeToAcceptMin),
          sub: "invite → accept",
        },
        {
          label: "Unaccepted 24h+",
          value: String(m.unaccepted24h),
          sub: "waiting right now",
          alert: m.unaccepted24h > 0,
        },
        {
          label: "Acceptance rate",
          value: fmtPct(m.acceptanceRatePct),
          sub: `${m.invitesSent} invite${m.invitesSent === 1 ? "" : "s"} sent`,
        },
        {
          label: "Cancelled after assignment",
          value: fmtPct(m.cancellationAfterAssignmentPct),
          sub: "of assigned jobs",
          alert: (m.cancellationAfterAssignmentPct ?? 0) > 10,
        },
        {
          label: "Customer confirmation",
          value: fmtPct(m.customerConfirmationPct),
          sub: `of ${m.jobsCreated} jobs created`,
        },
        {
          label: "Avg job value",
          value: m.avgJobValueGbp == null ? "—" : pulseMoney(m.avgJobValueGbp),
          sub: "live jobs with a price",
        },
        {
          label: "Avg partner payout",
          value: m.avgPartnerPayoutGbp == null ? "—" : pulseMoney(m.avgPartnerPayoutGbp),
          sub: "suggested or agreed",
        },
        {
          label: "Contribution margin",
          value: fmtPct(m.contributionMarginPct),
          sub: "revenue − partner − materials",
          alert: m.contributionMarginPct != null && m.contributionMarginPct < 30,
        },
      ]
    : [];

  return (
    <SectionCard
      title="Auto-flow"
      subtitle={`Dispatch speed vs margin · ${bounds ? rangeLabel : "this month"}`}
      bodyClassName="p-0"
    >
      {!m ? (
        <div className="grid grid-cols-3 gap-px p-5 sm:grid-cols-3 lg:grid-cols-9">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded bg-fx-paper-2/40" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 lg:grid-cols-9">
          {tiles.map((t, i) => (
            <div
              key={t.label}
              className={`px-4 py-4 ${i % 3 !== 2 ? "border-r border-fx-line" : ""} ${
                i < tiles.length - 3 ? "border-b border-fx-line" : ""
              } lg:border-b-0 ${i < tiles.length - 1 ? "lg:border-r lg:border-fx-line" : ""}`}
            >
              <MicroLabel className="block truncate">{t.label}</MicroLabel>
              <div
                className={`mt-1 text-lg font-semibold tabular-nums ${
                  t.alert ? "text-fx-coral" : "text-text-primary"
                }`}
              >
                {t.value}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-fx-mute">{t.sub}</div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
