"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { getSupabase } from "@/services/base";
import { FxAvatar, LiveIndicator, MicroLabel, Pill, SectionCard } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";

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

const ACTIVE_STATUSES = ["in_progress", "late", "final_check", "scheduled"] as const;

export function LiveJobs() {
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const [topJobs, totalActive] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, reference, title, client_name, property_address, partner_name, status, scheduled_start_at, scheduled_end_at, client_price, extras_amount")
          .in("status", ["in_progress", "late", "final_check"])
          .is("deleted_at", null)
          .order("scheduled_start_at", { ascending: true })
          .limit(5),
        supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .in("status", ACTIVE_STATUSES as unknown as string[])
          .is("deleted_at", null),
      ]);
      if (cancelled) return;
      setJobs((topJobs.data ?? []) as LiveJob[]);
      setActiveCount(totalActive.count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SectionCard
      title={
        <div className="flex items-center gap-3">
          <span>Live Jobs</span>
          <LiveIndicator label={`${activeCount} active`} />
        </div>
      }
      actions={
        <Link
          href="/schedule"
          className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors"
        >
          Open Live View →
        </Link>
      }
      bodyClassName="p-0 overflow-x-auto"
    >
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
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-fx-mute">
                Loading live jobs…
              </td>
            </tr>
          ) : jobs.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-fx-mute">
                Nothing live right now.
              </td>
            </tr>
          ) : (
            jobs.map((j) => (
              <tr key={j.id} className="border-b border-fx-line last:border-0 hover:bg-fx-paper transition-colors">
                <td className="px-4 py-3 align-middle">
                  <div className="font-medium text-text-primary">{j.title}</div>
                  <MicroLabel className="block mt-0.5">{j.reference}</MicroLabel>
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="font-medium text-text-primary">{j.client_name}</div>
                  {j.property_address && <MicroLabel className="block mt-0.5">{shortAddress(j.property_address)}</MicroLabel>}
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
                  <StatusPill status={j.status} />
                </td>
                <td className="px-4 py-3 align-middle font-mono text-[11.5px] text-fx-mute">
                  {formatWindow(j.scheduled_start_at, j.scheduled_end_at)}
                </td>
                <td className="px-4 py-3 align-middle font-medium text-text-primary tabular-nums">
                  {formatGbp(Number(j.client_price) + (Number(j.extras_amount) || 0))}
                </td>
                <td className="px-4 py-3 align-middle text-right">
                  <Link
                    href={`/jobs/${j.id}`}
                    className="text-[12px] font-medium text-fx-mute hover:text-text-primary px-2 py-1 rounded hover:bg-fx-paper transition-colors"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </SectionCard>
  );
}

function StatusPill({ status }: { status: string }) {
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
    case "completed":
      return <Pill tone="ok">{label}</Pill>;
    case "unassigned":
      return <Pill tone="bad">{label}</Pill>;
    default:
      return <Pill tone="ghost">{label}</Pill>;
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
  // Take first 2 segments only for compactness
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
