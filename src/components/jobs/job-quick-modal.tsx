"use client";

import { useEffect, useMemo, useState } from "react";
import { formatBritishDate } from "@/lib/utils/date";
import Link from "next/link";
import { ExternalLink, CalendarClock, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MarginValue } from "@/components/shared/margin-value";
import { AssignPartnerModal } from "@/components/jobs/assign-partner-modal";
import { getJob } from "@/services/jobs";
import { rescheduleJob } from "@/lib/reschedule-job";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { formatCurrency } from "@/lib/utils";
import type { Job } from "@/types/database";

/**
 * The job, without leaving the calendar: who, where, when, what it is worth —
 * and the two things the office actually does from a calendar, reschedule and
 * assign. Anything deeper opens the job itself.
 */
export function JobQuickModal({
  jobId,
  isOpen,
  onClose,
  onChanged,
}: {
  jobId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged?: (job: Job) => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  useEffect(() => {
    if (!isOpen || !jobId) return;
    let cancelled = false;
    setLoading(true);
    setRescheduling(false);
    void (async () => {
      const row = await getJob(jobId);
      if (cancelled) return;
      setJob(row);
      setDate(row?.scheduled_date ?? "");
      setStartTime(ukTime(row?.scheduled_start_at ?? null));
      setEndTime(ukTime(row?.scheduled_end_at ?? null));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, jobId]);

  const money = useMemo(() => {
    if (!job) return null;
    const amount = (Number(job.client_price) || 0) + (Number(job.extras_amount) || 0);
    const cost = Number(job.partner_cost) || 0;
    const profit = Math.round((amount - cost) * 100) / 100;
    const pct = amount > 0 && cost > 0 ? Math.round((profit / amount) * 100) : null;
    return { amount, cost, profit, pct };
  }, [job]);

  const saveReschedule = async () => {
    if (!job) return;
    setSaving(true);
    try {
      const updated = await rescheduleJob(job, {
        date,
        startAt: isoAt(date, startTime),
        endAt: isoAt(date, endTime),
      });
      setJob(updated);
      setRescheduling(false);
      toast.success(`${updated.reference} rescheduled`);
      onChanged?.(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reschedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={isOpen && !assignOpen}
        onClose={onClose}
        title={job ? normalizeTypeOfWork(job.title) || job.title : "Job"}
        subtitle={job?.reference}
        size="md"
      >
        <div className="space-y-4 p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-text-tertiary">Loading…</p>
          ) : !job ? (
            <p className="py-8 text-center text-sm text-text-tertiary">Job not found.</p>
          ) : (
            <>
              <dl className="space-y-2 text-[13px] leading-snug">
                <Row label="Status" value={jobStatusLabel(job.status)} />
                <Row label="Client" value={job.client_name || "—"} />
                <Row label="Address" value={job.property_address?.trim() || "—"} />
                <Row label="Partner" value={job.partner_name?.trim() || "Unassigned"} />
                <Row
                  label="When"
                  value={
                    job.scheduled_date
                      ? `${formatDay(job.scheduled_date)}${arrivalWindow(job) ? ` · ${arrivalWindow(job)}` : ""}`
                      : "Not scheduled"
                  }
                />
              </dl>

              {money ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border-light pt-3">
                  <Money label="Job amount" value={formatCurrency(money.amount)} />
                  <Money label="Cost" value={formatCurrency(money.cost)} />
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Margin</p>
                    <MarginValue value={money.profit} pct={money.pct} size="md" />
                  </div>
                </div>
              ) : null}

              {job.scope?.trim() ? (
                <div className="border-t border-border-light pt-3">
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Scope of work
                  </p>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-snug text-text-secondary">
                    {job.scope}
                  </p>
                </div>
              ) : null}

              {rescheduling ? (
                <div className="space-y-2 rounded-lg border border-border-light bg-surface-hover p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">New visit</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs text-text-secondary">
                      <span>Date</span>
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-text-secondary">
                      <span>Arrival from</span>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-text-secondary">
                      <span>Arrival to</span>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </label>
                  </div>
                  <p className="text-[11px] leading-snug text-text-tertiary">
                    Saving notifies the assigned partner. The client is told too, when messaging is on for their account.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setRescheduling(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button size="sm" loading={saving} disabled={!date} onClick={() => void saveReschedule()}>
                      Save new date
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<CalendarClock className="h-3.5 w-3.5" />}
                    onClick={() => setRescheduling(true)}
                  >
                    Reschedule
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<UserPlus className="h-3.5 w-3.5" />}
                    onClick={() => setAssignOpen(true)}
                  >
                    {job.partner_id ? "Change partner" : "Assign partner"}
                  </Button>
                  <Link
                    href={`/jobs/${job.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary hover:underline"
                  >
                    Open job
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {job ? (
        <AssignPartnerModal
          jobId={job.id}
          jobReference={job.reference}
          isOpen={assignOpen}
          onClose={() => setAssignOpen(false)}
          onAssigned={(updated) => {
            setJob(updated);
            setAssignOpen(false);
            onChanged?.(updated);
          }}
        />
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[62px] shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 text-text-primary">{value}</dd>
    </div>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

const UK_HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO instant → "HH:MM" in UK time, for the <input type="time"> fields. */
function ukTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : UK_HHMM.format(d);
}

/** "YYYY-MM-DD" + "HH:MM" → ISO instant. Null when either half is missing. */
function isoAt(date: string, time: string): string | null {
  if (!date.trim() || !time.trim()) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? ymd
    : formatBritishDate(d);
}

function arrivalWindow(job: Job): string {
  const a = ukTime(job.scheduled_start_at ?? null);
  const b = ukTime(job.scheduled_end_at ?? null);
  if (!a && !b) return "";
  return a && b && a !== b ? `${a}–${b}` : a || b;
}
