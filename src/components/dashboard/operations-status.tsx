"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { getSupabase } from "@/services/base";
import { BarChart, Bar, CartesianGrid, Cell, LineChart, Line, PieChart, Pie, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Job, Partner } from "@/types/database";
import { ExternalLink, CheckCircle2 } from "lucide-react";

type DatePreset = "this_week" | "this_month" | "last_30_days" | "custom";
type ChartWindow = "this_month" | "last_30_days" | "all_time";
type TrendWindow = "daily_30" | "monthly_12";

type OpsJob = Pick<
  Job,
  "id" | "reference" | "title" | "client_name" | "status" | "partner_id" | "partner_name" | "scheduled_date" |
  "scheduled_start_at" | "updated_at" | "created_at" | "timer_last_started_at" | "start_report_submitted" | "customer_review_rating"
> & {
  service_type?: string | null;
  squad_name?: string | null;
};

const IN_PROGRESS_STATUSES = new Set<Job["status"]>(["in_progress_phase1", "in_progress_phase2", "in_progress_phase3"]);
const PIPELINE_DEFS = [
  { id: "ready", label: "Ready to Book", color: "bg-amber-500", match: (j: OpsJob) => j.status === "unassigned" },
  { id: "scheduled", label: "Scheduled", color: "bg-sky-500", match: (j: OpsJob) => j.status === "scheduled" || j.status === "late" },
  { id: "progress", label: "In Progress", color: "bg-orange-500", match: (j: OpsJob) => IN_PROGRESS_STATUSES.has(j.status) },
  { id: "final", label: "Final Checks", color: "bg-violet-500", match: (j: OpsJob) => j.status === "final_check" },
  { id: "awaiting", label: "Awaiting Payment", color: "bg-rose-500", match: (j: OpsJob) => j.status === "awaiting_payment" },
] as const;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function safeDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isJobInProgress(j: OpsJob): boolean {
  return IN_PROGRESS_STATUSES.has(j.status);
}
function jobServiceLabel(j: OpsJob): string {
  const raw = String(j.service_type ?? j.title ?? "").trim().toLowerCase();
  if (!raw) return "Other";
  if (raw.includes("handyman") || raw.includes("maintenance")) return "Handyman";
  if (raw.includes("clean")) return "Cleaning";
  if (raw.includes("carpent")) return "Carpentry";
  if (raw.includes("paint")) return "Painting";
  if (raw.includes("plumb")) return "Plumbing";
  if (raw.includes("elect")) return "Electrical";
  if (raw.includes("end of tenancy") || raw.includes("tenancy")) return "End of Tenancy";
  return "Other";
}
function lineKeyDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function lineKeyMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function OperationsStatus() {
  const router = useRouter();
  const [jobs, setJobs] = useState<OpsJob[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [squadFilter, setSquadFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [topJobsWindow, setTopJobsWindow] = useState<ChartWindow>("last_30_days");
  const [serviceWindow, setServiceWindow] = useState<ChartWindow>("last_30_days");
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("daily_30");

  const load = useCallback(async () => {
    const supabase = getSupabase();
    setLoading(true);
    try {
      const [jobsRes, partnersRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, reference, title, client_name, status, partner_id, partner_name, scheduled_date, scheduled_start_at, updated_at, created_at, timer_last_started_at, start_report_submitted, customer_review_rating, service_type, squad_name"),
        supabase.from("partners").select("*"),
      ]);
      setJobs((jobsRes.data ?? []) as OpsJob[]);
      setPartners((partnersRes.data ?? []) as Partner[]);
    } catch {
      setJobs([]);
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const supabase = getSupabase();
    const jobsCh = supabase.channel("ops:jobs").on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
      void load();
    }).subscribe();
    const partnersCh = supabase.channel("ops:partners").on("postgres_changes", { event: "*", schema: "public", table: "partners" }, () => {
      void load();
    }).subscribe();
    return () => {
      supabase.removeChannel(jobsCh);
      supabase.removeChannel(partnersCh);
    };
  }, [load]);

  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7));

  const squadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      const squad = String((j as { squad_name?: string | null }).squad_name ?? "").trim();
      if (squad) set.add(squad);
    }
    return ["all", ...Array.from(set)];
  }, [jobs]);

  const activePartnersCount = useMemo(
    () => partners.filter((p) => String(p.status).toLowerCase() === "active").length,
    [partners]
  );
  const jobsInProgressCount = useMemo(() => jobs.filter(isJobInProgress).length, [jobs]);
  const onSiteTodayCount = useMemo(
    () =>
      jobs.filter((j) => {
        if (!isJobInProgress(j)) return false;
        const timer = safeDate(j.timer_last_started_at);
        const hasTimerToday = !!(timer && isSameLocalDay(timer, now));
        const hasStartReport = !!j.start_report_submitted;
        return hasStartReport || hasTimerToday;
      }).length,
    [jobs, now]
  );
  const cancelledThisMonthCount = useMemo(
    () =>
      jobs.filter((j) => {
        if (j.status !== "cancelled") return false;
        const dt = safeDate(j.updated_at);
        return !!(dt && dt >= monthStart);
      }).length,
    [jobs, monthStart]
  );

  const filterBounds = useMemo(() => {
    if (datePreset === "this_week") return { from: weekStart, to: now };
    if (datePreset === "this_month") return { from: monthStart, to: now };
    if (datePreset === "last_30_days") return { from: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000), to: now };
    const from = safeDate(customFrom ? `${customFrom}T00:00:00` : null);
    const to = safeDate(customTo ? `${customTo}T23:59:59` : null);
    if (!from || !to) return { from: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000), to: now };
    return from <= to ? { from, to } : { from: to, to: from };
  }, [datePreset, customFrom, customTo, weekStart, monthStart, now]);

  const jobsFiltered = useMemo(() => {
    return jobs.filter((j) => {
      const created = safeDate(j.created_at);
      if (!created || created < filterBounds.from || created > filterBounds.to) return false;
      if (squadFilter !== "all") {
        const squad = String((j as { squad_name?: string | null }).squad_name ?? "").trim();
        if (squad !== squadFilter) return false;
      }
      return true;
    });
  }, [jobs, filterBounds, squadFilter]);

  const pipeline = useMemo(
    () =>
      PIPELINE_DEFS.map((stage) => ({
        ...stage,
        count: jobsFiltered.filter(stage.match).length,
      })),
    [jobsFiltered]
  );

  function withinWindow(createdAt: string, window: ChartWindow): boolean {
    if (window === "all_time") return true;
    const dt = safeDate(createdAt);
    if (!dt) return false;
    if (window === "this_month") return dt >= monthStart;
    return dt >= new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  }

  const topPartnersByCompleted = useMemo(() => {
    const map = new Map<string, number>();
    for (const j of jobs) {
      if (j.status !== "completed") continue;
      if (!withinWindow(j.created_at, topJobsWindow)) continue;
      const name = String(j.partner_name ?? "Unassigned").trim();
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [jobs, topJobsWindow, now, monthStart]);

  const topPartnersByRating = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    for (const j of jobsFiltered) {
      const rating = Number(j.customer_review_rating ?? 0);
      if (rating <= 0) continue;
      const name = String(j.partner_name ?? "").trim();
      if (!name) continue;
      const prev = map.get(name) ?? { sum: 0, count: 0 };
      prev.sum += rating;
      prev.count += 1;
      map.set(name, prev);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, avg: Number((v.sum / Math.max(v.count, 1)).toFixed(2)), count: v.count }))
      .filter((r) => r.count >= 3)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);
  }, [jobsFiltered]);

  const jobsByService = useMemo(() => {
    const base = jobs.filter((j) => j.status === "completed" && withinWindow(j.created_at, serviceWindow));
    const labels = ["Handyman", "Cleaning", "Carpentry", "Painting", "Plumbing", "Electrical", "End of Tenancy", "Other"];
    const counts: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
    for (const j of base) {
      const label = jobServiceLabel(j);
      counts[label] = (counts[label] ?? 0) + 1;
    }
    const total = Math.max(base.length, 1);
    return labels.map((label) => ({
      label,
      value: counts[label] ?? 0,
      pct: Math.round(((counts[label] ?? 0) / total) * 100),
    }));
  }, [jobs, serviceWindow, now, monthStart]);

  const completionTrend = useMemo(() => {
    const rows = jobs.filter((j) => j.status === "completed" || j.status === "cancelled");
    const map = new Map<string, { key: string; completed: number; cancelled: number }>();
    if (trendWindow === "daily_30") {
      for (let i = 29; i >= 0; i -= 1) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = lineKeyDate(d);
        map.set(key, { key, completed: 0, cancelled: 0 });
      }
      for (const j of rows) {
        const d = safeDate(j.updated_at);
        if (!d || d < new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)) continue;
        const key = lineKeyDate(d);
        const cur = map.get(key);
        if (!cur) continue;
        if (j.status === "completed") cur.completed += 1;
        if (j.status === "cancelled") cur.cancelled += 1;
      }
      return Array.from(map.values());
    }
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = lineKeyMonth(d);
      map.set(key, { key, completed: 0, cancelled: 0 });
    }
    for (const j of rows) {
      const d = safeDate(j.updated_at);
      if (!d) continue;
      const key = lineKeyMonth(d);
      const cur = map.get(key);
      if (!cur) continue;
      if (j.status === "completed") cur.completed += 1;
      if (j.status === "cancelled") cur.cancelled += 1;
    }
    return Array.from(map.values());
  }, [jobs, trendWindow, now]);

  const alerts = useMemo(() => {
    const partnerRatings = new Map<string, { sum: number; count: number }>();
    for (const j of jobs) {
      const r = Number(j.customer_review_rating ?? 0);
      const name = String(j.partner_name ?? "").trim();
      if (!name || r <= 0) continue;
      const prev = partnerRatings.get(name) ?? { sum: 0, count: 0 };
      prev.sum += r;
      prev.count += 1;
      partnerRatings.set(name, prev);
    }
    const avgByPartner = new Map<string, number>();
    for (const [name, v] of partnerRatings) {
      avgByPartner.set(name, v.sum / Math.max(v.count, 1));
    }

    type AlertRow = { id: string; issue: string; priority: number; when: Date; job: OpsJob };
    const out: AlertRow[] = [];
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const dayStart = startOfDay(now);
    const weekThreshold = new Date(weekStart.getTime());
    for (const j of jobsFiltered) {
      const created = safeDate(j.created_at) ?? now;
      const updated = safeDate(j.updated_at) ?? now;
      const sched = safeDate(j.scheduled_start_at) ?? safeDate(j.scheduled_date ? `${j.scheduled_date}T09:00:00` : null);
      const hasCheckinToday = !!j.start_report_submitted || !!(safeDate(j.timer_last_started_at) && isSameLocalDay(safeDate(j.timer_last_started_at) as Date, now));

      if (j.status === "unassigned" && created < fourHoursAgo) out.push({ id: `${j.id}-nopartner`, issue: "No partner assigned", priority: 2, when: created, job: j });
      if (isJobInProgress(j) && sched && isSameLocalDay(sched, now) && !hasCheckinToday) out.push({ id: `${j.id}-nocheckin`, issue: "Partner not checked in", priority: 3, when: updated, job: j });
      if (j.status === "final_check" && updated < new Date(now.getTime() - 24 * 60 * 60 * 1000)) out.push({ id: `${j.id}-stuckfinal`, issue: "Stuck in Final Checks", priority: 4, when: updated, job: j });
      if (j.status === "scheduled" && sched && sched < dayStart) out.push({ id: `${j.id}-overdue`, issue: "Job overdue", priority: 1, when: sched, job: j });
      const pname = String(j.partner_name ?? "").trim();
      const avg = pname ? (avgByPartner.get(pname) ?? 0) : 0;
      if (isJobInProgress(j) && pname && avg > 0 && avg < 3 && created >= weekThreshold) {
        out.push({ id: `${j.id}-lowrated`, issue: "Low-rated partner", priority: 5, when: updated, job: j });
      }
    }
    return out.sort((a, b) => a.priority - b.priority || b.when.getTime() - a.when.getTime());
  }, [jobs, jobsFiltered, now, weekStart]);

  const clickJobs = (query: string) => router.push(`/jobs?${query}`);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Operations</h3>
          <p className="text-xs text-text-tertiary">Live execution view for Ops Coordinator and COO</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            options={squadOptions.map((s) => ({ value: s, label: s === "all" ? "All squads" : s }))}
            value={squadFilter}
            onChange={(e) => setSquadFilter(e.target.value)}
            className="w-40"
          />
          <Select
            options={[
              { value: "this_week", label: "This Week" },
              { value: "this_month", label: "This Month" },
              { value: "last_30_days", label: "Last 30 Days" },
              { value: "custom", label: "Custom" },
            ]}
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="w-40"
          />
          {datePreset === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-sm bg-card" />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-sm bg-card" />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button className="text-left" onClick={() => router.push("/partners?status=active")}>
          <Card className="h-full">
            <div className="pt-5 px-5 pb-5">
              <p className="text-xs text-text-tertiary uppercase tracking-wide">Active Partners</p>
              <p className="text-3xl font-bold mt-2">{activePartnersCount}</p>
            </div>
          </Card>
        </button>
        <button className="text-left" onClick={() => clickJobs("opsFilter=in_progress")}>
          <Card className="h-full">
            <div className="pt-5 px-5 pb-5">
              <p className="text-xs text-text-tertiary uppercase tracking-wide">Jobs In Progress</p>
              <p className="text-3xl font-bold mt-2">{jobsInProgressCount}</p>
            </div>
          </Card>
        </button>
        <button className="text-left" onClick={() => clickJobs("opsFilter=on_site_today")}>
          <Card className="h-full">
            <div className="pt-5 px-5 pb-5">
              <p className="text-xs text-text-tertiary uppercase tracking-wide">On Site Today</p>
              <p className="text-3xl font-bold mt-2">{onSiteTodayCount}</p>
            </div>
          </Card>
        </button>
        <button className="text-left" onClick={() => clickJobs("opsFilter=cancelled_this_month")}>
          <Card className="h-full">
            <div className="pt-5 px-5 pb-5">
              <p className="text-xs text-text-tertiary uppercase tracking-wide">Cancelled This Month</p>
              <p className="text-3xl font-bold mt-2">{cancelledThisMonthCount}</p>
            </div>
          </Card>
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job Pipeline</CardTitle>
        </CardHeader>
        <div className="px-5 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            {pipeline.map((p, idx) => (
              <div key={p.id} className="flex items-center gap-2">
                <button
                  onClick={() => clickJobs(`opsStage=${p.id}`)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${p.count > 0 ? "border-border text-text-primary bg-card hover:bg-surface-hover" : "border-border-light text-text-tertiary bg-surface-hover/40"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${p.color}`} />
                  {p.label}
                  <Badge size="sm" variant={p.count > 0 ? "primary" : "default"}>{p.count}</Badge>
                </button>
                {idx < pipeline.length - 1 && <span className="text-text-tertiary">→</span>}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top Partners by Jobs Completed</CardTitle>
              <div className="mt-2">
                <Select
                  options={[
                    { value: "this_month", label: "This Month" },
                    { value: "last_30_days", label: "Last 30 Days" },
                    { value: "all_time", label: "All Time" },
                  ]}
                  value={topJobsWindow}
                  onChange={(e) => setTopJobsWindow(e.target.value as ChartWindow)}
                  className="w-36"
                />
              </div>
            </div>
          </CardHeader>
          <div className="px-5 pb-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPartnersByCompleted} layout="vertical" margin={{ left: 20, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} />
                <Tooltip formatter={(v) => [`${v} jobs`, "Completed"]} />
                <Bar dataKey="count" fill="#0ea5e9" onClick={(d) => clickJobs(`partner=${encodeURIComponent(String((d as { name: string }).name))}`)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top Partners by Rating</CardTitle></CardHeader>
          <div className="px-5 pb-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPartnersByRating} layout="vertical" margin={{ left: 20, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis type="number" domain={[0, 5]} />
                <YAxis type="category" dataKey="name" width={130} />
                <Tooltip formatter={(v, _n, p) => [`${Number(v).toFixed(2)} stars`, `${(p?.payload as { count?: number })?.count ?? 0} rated jobs`]} />
                <Bar dataKey="avg" fill="#8b5cf6" onClick={(d) => router.push(`/partners?search=${encodeURIComponent(String((d as { name: string }).name))}`)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Jobs by Service Type</CardTitle>
              <div className="mt-2">
                <Select
                  options={[
                    { value: "this_month", label: "This Month" },
                    { value: "last_30_days", label: "Last 30 Days" },
                    { value: "all_time", label: "All Time" },
                  ]}
                  value={serviceWindow}
                  onChange={(e) => setServiceWindow(e.target.value as ChartWindow)}
                  className="w-36"
                />
              </div>
            </div>
          </CardHeader>
          <div className="px-5 pb-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={jobsByService} dataKey="value" nameKey="label" innerRadius={55} outerRadius={92} onClick={(d) => clickJobs(`service=${encodeURIComponent(String((d as unknown as { label: string }).label))}`)}>
                  {jobsByService.map((_, i) => (
                    <Cell key={i} fill={["#38bdf8", "#22c55e", "#f59e0b", "#f97316", "#14b8a6", "#8b5cf6", "#eab308", "#94a3b8"][i % 8]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, _n, p) => [`${v} jobs`, `${(p?.payload as { pct?: number })?.pct ?? 0}%`]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
              {jobsByService.map((r) => (
                <div key={r.label} className="text-xs flex items-center justify-between">
                  <span className="text-text-secondary">{r.label}</span>
                  <span className="font-semibold">{r.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Jobs Completed vs Cancelled</CardTitle>
              <Select
                options={[
                  { value: "daily_30", label: "Last 30 days" },
                  { value: "monthly_12", label: "Last 12 months" },
                ]}
                value={trendWindow}
                onChange={(e) => setTrendWindow(e.target.value as TrendWindow)}
                className="w-36"
              />
            </div>
          </CardHeader>
          <div className="px-5 pb-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={completionTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="key" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cancelled" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Needs Attention</CardTitle></CardHeader>
        <div className="px-5 pb-5">
          {loading ? (
            <div className="py-8 text-sm text-text-tertiary">Loading alerts...</div>
          ) : alerts.length === 0 ? (
            <div className="py-8 flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>All jobs running smoothly</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-tertiary border-b border-border-light">
                    <th className="py-2 pr-3">Job ID</th>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Service</th>
                    <th className="py-2 pr-3">Stage</th>
                    <th className="py-2 pr-3">Issue</th>
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-0" />
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id} className="border-b border-border-light/60">
                      <td className="py-2 pr-3 font-medium">{a.job.reference}</td>
                      <td className="py-2 pr-3">{a.job.client_name}</td>
                      <td className="py-2 pr-3">{jobServiceLabel(a.job)}</td>
                      <td className="py-2 pr-3">{a.job.status.replaceAll("_", " ")}</td>
                      <td className="py-2 pr-3">{a.issue}</td>
                      <td className="py-2 pr-3 text-text-tertiary">{a.when.toLocaleString()}</td>
                      <td className="py-2 pr-0 text-right">
                        <Button size="sm" variant="outline" onClick={() => router.push(`/jobs/${a.job.id}`)} icon={<ExternalLink className="h-3.5 w-3.5" />}>
                          View Job
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
