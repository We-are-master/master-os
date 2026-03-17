"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Play,
  Pause,
  CheckCircle2,
  RotateCcw,
  TrendingUp,
  FileText,
  Upload,
  ShieldCheck,
  Plus,
  CreditCard,
  DollarSign,
  Calendar,
  History,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { getJob, updateJob } from "@/services/jobs";
import { createSelfBillFromJob } from "@/services/self-bills";
import { listJobPayments, createJobPayment } from "@/services/job-payments";
import { useProfile } from "@/hooks/use-profile";
import { logAudit } from "@/services/audit";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { Avatar } from "@/components/ui/avatar";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import type { Job, JobPayment, JobPaymentType } from "@/types/database";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  scheduled: { label: "Scheduled", variant: "info", dot: true },
  in_progress_phase1: { label: "Phase 1", variant: "primary", dot: true },
  in_progress_phase2: { label: "Phase 2", variant: "primary", dot: true },
  in_progress_phase3: { label: "Phase 3", variant: "primary", dot: true },
  final_check: { label: "Final Check", variant: "warning", dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: "danger", dot: true },
  need_attention: { label: "Need attention", variant: "warning", dot: true },
  completed: { label: "Completed", variant: "success", dot: true },
};

function getStatusActions(currentStatus: string) {
  switch (currentStatus) {
    case "scheduled":
      return [{ label: "Start Phase 1", status: "in_progress_phase1", icon: Play, primary: true }];
    case "in_progress_phase1":
      return [
        { label: "Advance to Phase 2", status: "in_progress_phase2", icon: TrendingUp, primary: true },
        { label: "Pause", status: "scheduled", icon: Pause, primary: false },
      ];
    case "in_progress_phase2":
      return [
        { label: "Advance to Phase 3", status: "in_progress_phase3", icon: TrendingUp, primary: true },
        { label: "Back to Phase 1", status: "in_progress_phase1", icon: RotateCcw, primary: false },
      ];
    case "in_progress_phase3":
      return [
        { label: "Final Check", status: "final_check", icon: CheckCircle2, primary: true },
        { label: "Back to Phase 2", status: "in_progress_phase2", icon: RotateCcw, primary: false },
      ];
    case "final_check":
      return [
        { label: "Awaiting Payment", status: "awaiting_payment", icon: CreditCard, primary: true },
        { label: "Back to Phase 3", status: "in_progress_phase3", icon: RotateCcw, primary: false },
      ];
    case "awaiting_payment":
      return [{ label: "Mark Completed", status: "completed", icon: CheckCircle2, primary: true }];
    case "need_attention":
      return [
        { label: "Validate & complete", status: "completed", icon: ShieldCheck, primary: true },
        { label: "Back to Phase 3", status: "in_progress_phase3", icon: RotateCcw, primary: false },
      ];
    case "completed":
      return [{ label: "Reopen", status: "scheduled", icon: RotateCcw, primary: false }];
    default:
      return [];
  }
}

function canAdvanceJob(job: Job, nextStatus: string): { ok: boolean; message?: string } {
  if (nextStatus === "in_progress_phase1") {
    if (!job.partner_id && !job.partner_name?.trim()) return { ok: false, message: "Assign a partner before starting the job." };
    if (!job.scheduled_date && !job.scheduled_start_at) return { ok: false, message: "Set scheduled date before starting the job." };
  }
  if (nextStatus === "final_check") {
    const hasReport = job.report_1_uploaded || job.report_2_uploaded || job.report_3_uploaded;
    if (!hasReport) return { ok: false, message: "Upload at least one post-job report/photo before Final Check." };
  }
  if (nextStatus === "awaiting_payment") {
    const approved = job.report_1_approved || job.report_2_approved || job.report_3_approved;
    if (!approved) return { ok: false, message: "Ops must approve at least one report before Awaiting Payment." };
  }
  return { ok: true };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-primary border-b border-border-light pb-2 flex items-center gap-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function JobPaymentBlock({
  totalDue,
  payments,
  loading,
  onAddPayment,
}: {
  totalDue: number;
  payments: JobPayment[];
  loading: boolean;
  onAddPayment: () => void;
}) {
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, totalDue - totalPaid);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total due</p>
            <p className="text-lg font-bold text-text-primary">{formatCurrency(totalDue)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Paid</p>
            <p className="text-lg font-bold text-emerald-600">{formatCurrency(totalPaid)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Remaining</p>
            <p className={`text-lg font-bold ${remaining > 0 ? "text-amber-600" : "text-text-primary"}`}>{formatCurrency(remaining)}</p>
          </div>
        </div>
        <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={onAddPayment}>Register payment</Button>
      </div>
      {loading ? (
        <div className="p-4 rounded-xl border border-border-light bg-surface-hover animate-pulse">Loading payments…</div>
      ) : payments.length > 0 ? (
        <div className="rounded-xl border border-border-light overflow-hidden">
          <div className="bg-surface-tertiary/50 px-3 py-2 flex items-center gap-2 text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
            <span className="w-24">Date</span>
            <span className="flex-1">Amount</span>
            <span className="flex-1">Note</span>
          </div>
          {payments.map((p) => (
            <div key={p.id} className="px-3 py-2.5 flex items-center gap-2 border-t border-border-light text-sm">
              <span className="w-24 text-text-secondary">{new Date(p.payment_date).toLocaleDateString()}</span>
              <span className="flex-1 font-semibold text-text-primary">{formatCurrency(p.amount)}</span>
              <span className="flex-1 text-text-tertiary truncate">{p.note || "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-border-light bg-surface-hover text-sm text-text-tertiary">No payments registered yet.</div>
      )}
    </div>
  );
}

function TimelineItem({ label, date, active }: { label: string; date: string; active: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-1 h-3 w-3 rounded-full border-2 ${active ? "border-primary bg-primary" : "border-border bg-card"}`} />
      <div>
        <p className={`text-sm font-medium ${active ? "text-text-primary" : "text-text-tertiary"}`}>{label}</p>
        <p className="text-[11px] text-text-tertiary">{new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const { profile } = useProfile();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [partnerPayments, setPartnerPayments] = useState<JobPayment[]>([]);
  const [customerPayments, setCustomerPayments] = useState<JobPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const [addPaymentType, setAddPaymentType] = useState<JobPaymentType>("partner");
  const [addPaymentAmount, setAddPaymentAmount] = useState("");
  const [addPaymentDate, setAddPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addPaymentNote, setAddPaymentNote] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);

  const loadPayments = useCallback(async (jobId: string) => {
    setLoadingPayments(true);
    try {
      const [partner, customer] = await Promise.all([
        listJobPayments(jobId, "partner"),
        listJobPayments(jobId),
      ]);
      setPartnerPayments(partner);
      setCustomerPayments(customer.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"));
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getJob(id).then((j) => {
      setJob(j ?? null);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (job?.id) loadPayments(job.id);
  }, [job?.id, loadPayments]);

  useEffect(() => {
    if (job?.scheduled_start_at) {
      const d = new Date(job.scheduled_start_at);
      setScheduleDate(d.toISOString().slice(0, 10));
      setScheduleTime(d.toTimeString().slice(0, 5));
    } else if (job?.scheduled_date) {
      setScheduleDate(job.scheduled_date);
      setScheduleTime("");
    } else {
      setScheduleDate("");
      setScheduleTime("");
    }
  }, [job?.id, job?.scheduled_start_at, job?.scheduled_date]);

  const handleStatusChange = useCallback(async (j: Job, newStatus: Job["status"]) => {
    const check = canAdvanceJob(j, newStatus);
    if (!check.ok) {
      toast.error(check.message ?? "Complete the current step before advancing.");
      return;
    }
    try {
      let selfBillId: string | undefined = j.self_bill_id ?? undefined;
      if (newStatus === "awaiting_payment" && !j.self_bill_id) {
        const selfBill = await createSelfBillFromJob({
          id: j.id,
          reference: j.reference,
          partner_name: j.partner_name ?? "Unassigned",
          partner_cost: j.partner_cost,
          materials_cost: j.materials_cost,
        });
        selfBillId = selfBill.id;
      }
      const updated = await updateJob(j.id, { status: newStatus, ...(selfBillId ? { self_bill_id: selfBillId } : {}) });
      await logAudit({ entityType: "job", entityId: j.id, entityRef: j.reference, action: "status_changed", fieldName: "status", oldValue: j.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
      setJob(updated);
      toast.success(selfBillId ? "Self-bill created. Job updated." : "Job updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }, [profile?.id, profile?.full_name]);

  const handleJobUpdate = useCallback(async (jobId: string, updates: Partial<Job>) => {
    try {
      const updated = await updateJob(jobId, updates);
      setJob(updated);
      toast.success("Job updated");
    } catch {
      toast.error("Failed to update");
    }
  }, []);

  const handleScheduleChange = useCallback((j: Job, date: string, time: string) => {
    const scheduled_date = date || undefined;
    const scheduled_start_at = date && time ? `${date}T${time}:00` : date ? `${date}T09:00:00` : undefined;
    handleJobUpdate(j.id, { scheduled_start_at, scheduled_date } as Partial<Job>);
  }, [handleJobUpdate]);

  const handleAddPayment = useCallback(async () => {
    if (!job || !addPaymentAmount || Number(addPaymentAmount) <= 0) return;
    setAddingPayment(true);
    try {
      await createJobPayment({
        job_id: job.id,
        type: addPaymentType,
        amount: Number(addPaymentAmount),
        payment_date: addPaymentDate,
        note: addPaymentNote.trim() || undefined,
      });
      toast.success("Payment registered");
      setAddPaymentOpen(false);
      setAddPaymentAmount("");
      setAddPaymentDate(new Date().toISOString().slice(0, 10));
      setAddPaymentNote("");
      loadPayments(job.id);
    } catch {
      toast.error("Failed to register payment");
    } finally {
      setAddingPayment(false);
    }
  }, [job, addPaymentAmount, addPaymentDate, addPaymentNote, addPaymentType, loadPayments]);

  if (loading || !id) {
    return (
      <PageTransition>
        <div className="min-h-[60vh] flex items-center justify-center text-text-tertiary">Loading job…</div>
      </PageTransition>
    );
  }

  if (!job) {
    return (
      <PageTransition>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-text-secondary">
          <p>Job not found.</p>
          <Button variant="outline" onClick={() => router.push("/jobs")}>Back to Jobs</Button>
        </div>
      </PageTransition>
    );
  }

  const config = statusConfig[job.status] ?? { label: job.status, variant: "default" as const };
  const profit = job.client_price - job.partner_cost - job.materials_cost;
  const statusActions = getStatusActions(job.status);

  return (
    <PageTransition>
      <div className="space-y-6 pb-12">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push("/jobs")}>
            Back to Jobs
          </Button>
        </div>

        <PageHeader
          title={job.reference}
          subtitle={job.title}
          children={
            <div className="flex items-center gap-2">
              <Badge variant={config.variant} dot={config.dot} size="md">{config.label}</Badge>
              {statusActions.map((action) => (
                <Button
                  key={action.status}
                  variant={action.primary ? "primary" : "outline"}
                  size="sm"
                  icon={<action.icon className="h-3.5 w-3.5" />}
                  onClick={() => handleStatusChange(job, action.status as Job["status"])}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column: overview, client, partner, schedule */}
          <div className="lg:col-span-2 space-y-8">
            <Section title="Overview">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-center">
                  <p className="text-[10px] font-semibold text-emerald-700 uppercase">Revenue</p>
                  <p className="text-lg font-bold text-emerald-700">{formatCurrency(job.client_price)}</p>
                </div>
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 text-center">
                  <p className="text-[10px] font-semibold text-red-700 uppercase">Cost</p>
                  <p className="text-lg font-bold text-red-700">{formatCurrency(job.partner_cost + job.materials_cost)}</p>
                </div>
                <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 text-center">
                  <p className="text-[10px] font-semibold text-blue-700 uppercase">Profit</p>
                  <p className={`text-lg font-bold ${profit >= 0 ? "text-blue-700" : "text-red-600"}`}>{formatCurrency(profit)}</p>
                </div>
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-center">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase">Margin</p>
                  <p className={`text-lg font-bold ${job.margin_percent >= 20 ? "text-amber-700" : "text-red-600"}`}>{job.margin_percent}%</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase">Progress</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={job.progress} size="md" color={job.progress === 100 ? "emerald" : "primary"} className="flex-1 max-w-[200px]" />
                    <span className="text-sm font-bold text-text-primary">{job.progress}%</span>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Client & property">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-hover">
                <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <p className="text-sm font-semibold text-text-primary">{job.client_name}</p>
              </div>
              <div className="flex items-start gap-2 mt-2">
                <MapPin className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
                <p className="text-sm text-text-primary">{job.property_address}</p>
              </div>
              <LocationMiniMap address={job.property_address} className="mt-2 rounded-xl overflow-hidden" />
            </Section>

            {job.scope && (
              <Section title="Scope">
                <p className="text-sm text-text-primary whitespace-pre-wrap">{job.scope}</p>
              </Section>
            )}

            <Section title="Partner & owner">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-surface-hover">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner</p>
                  {job.partner_name ? (
                    <div className="flex items-center gap-2 mt-2">
                      <Avatar name={job.partner_name} size="sm" />
                      <p className="text-sm font-semibold text-text-primary">{job.partner_name}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-text-tertiary italic mt-2">Unassigned</p>
                  )}
                </div>
                <div className="p-4 rounded-xl bg-surface-hover">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job owner</p>
                  {job.owner_name ? (
                    <div className="flex items-center gap-2 mt-2">
                      <Avatar name={job.owner_name} size="sm" />
                      <p className="text-sm font-semibold text-text-primary">{job.owner_name}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-text-tertiary italic mt-2">No owner</p>
                  )}
                </div>
              </div>
            </Section>

            <Section title="Schedule">
              <div className="grid grid-cols-2 gap-3 max-w-sm">
                <div>
                  <label className="block text-[10px] text-text-tertiary mb-1">Date</label>
                  <Input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => {
                      setScheduleDate(e.target.value);
                      handleScheduleChange(job, e.target.value, scheduleTime);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-text-tertiary mb-1">Time</label>
                  <Input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => {
                      setScheduleTime(e.target.value);
                      handleScheduleChange(job, scheduleDate, e.target.value);
                    }}
                  />
                </div>
              </div>
            </Section>

            <Section title="Reports">
              <p className="text-xs text-text-tertiary mb-3">Partner uploads reports. Approve before releasing partner payment.</p>
              <div className="space-y-3">
                {[1, 2, 3].map((n) => {
                  const uploaded = job[`report_${n}_uploaded` as keyof Job] as boolean;
                  const approved = job[`report_${n}_approved` as keyof Job] as boolean;
                  const uploadedAt = job[`report_${n}_uploaded_at` as keyof Job] as string | undefined;
                  const approvedAt = job[`report_${n}_approved_at` as keyof Job] as string | undefined;
                  const phaseLabel = n === 1 ? "Report 1 — Start & Complete" : n === 2 ? "Report 2 — 50% Done" : "Final Report — Work Finished";
                  return (
                    <div
                      key={n}
                      className={`p-4 rounded-xl border ${approved ? "border-emerald-200 bg-emerald-50/50" : uploaded ? "border-amber-200 bg-amber-50/50" : "border-border bg-surface-hover"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {approved ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : uploaded ? <Upload className="h-4 w-4 text-amber-600" /> : <FileText className="h-4 w-4 text-text-tertiary" />}
                          <p className="text-sm font-semibold text-text-primary">{phaseLabel}</p>
                        </div>
                        <Badge variant={approved ? "success" : uploaded ? "warning" : "default"} size="sm">
                          {approved ? "Approved" : uploaded ? "Pending Approval" : "Not uploaded"}
                        </Badge>
                      </div>
                      {uploadedAt && <p className="text-xs text-text-tertiary">Uploaded: {new Date(uploadedAt).toLocaleDateString()}</p>}
                      {approvedAt && <p className="text-xs text-emerald-600">Approved: {new Date(approvedAt).toLocaleDateString()}</p>}
                      <div className="flex gap-2 mt-3">
                        {!uploaded && (
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<Upload className="h-3.5 w-3.5" />}
                            onClick={() => handleJobUpdate(job.id, { [`report_${n}_uploaded`]: true, [`report_${n}_uploaded_at`]: new Date().toISOString() } as Partial<Job>)}
                          >
                            Mark as Uploaded
                          </Button>
                        )}
                        {uploaded && !approved && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<ShieldCheck className="h-3.5 w-3.5" />}
                            onClick={() => handleJobUpdate(job.id, { [`report_${n}_approved`]: true, [`report_${n}_approved_at`]: new Date().toISOString() } as Partial<Job>)}
                          >
                            Approve Report
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {job.report_3_uploaded && job.report_3_approved && (
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 mt-3">
                  <p className="text-sm font-semibold text-text-primary">All reports approved</p>
                  <p className="text-xs text-text-tertiary mt-0.5">Send to customer and request final payment.</p>
                  <Button
                    size="sm"
                    className="mt-3"
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    onClick={() => {
                      handleJobUpdate(job.id, { report_submitted: true, report_submitted_at: new Date().toISOString() } as Partial<Job>);
                      handleStatusChange(job, "awaiting_payment");
                    }}
                  >
                    Send Report & Request Final Payment
                  </Button>
                </div>
              )}
            </Section>
          </div>

          {/* Right column: finance, timeline, history */}
          <div className="space-y-8">
            <Section title="Finance summary">
              <div className="p-4 rounded-xl bg-surface-hover space-y-2">
                <div className="flex justify-between"><span className="text-sm text-text-secondary">Revenue</span><span className="text-sm font-semibold">{formatCurrency(job.client_price)}</span></div>
                <div className="flex justify-between"><span className="text-sm text-text-secondary">Partner cost</span><span className="text-sm text-red-600">-{formatCurrency(job.partner_cost)}</span></div>
                <div className="flex justify-between"><span className="text-sm text-text-secondary">Materials</span><span className="text-sm text-red-600">-{formatCurrency(job.materials_cost)}</span></div>
                <div className="border-t border-border pt-2 flex justify-between">
                  <span className="text-sm font-semibold">Profit</span>
                  <span className={`font-bold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(profit)}</span>
                </div>
                <p className="text-xs text-text-tertiary">Margin {job.margin_percent}%</p>
              </div>
            </Section>

            <Section title="Partner payments">
              <JobPaymentBlock
                totalDue={(job.partner_agreed_value ?? job.partner_cost) || 0}
                payments={partnerPayments}
                loading={loadingPayments}
                onAddPayment={() => { setAddPaymentType("partner"); setAddPaymentOpen(true); }}
              />
            </Section>

            <Section title="Customer payments">
              <JobPaymentBlock
                totalDue={(job.customer_deposit ?? 0) + (job.customer_final_payment ?? 0)}
                payments={customerPayments}
                loading={loadingPayments}
                onAddPayment={() => { setAddPaymentType("customer_deposit"); setAddPaymentOpen(true); }}
              />
            </Section>

            {job.customer_final_paid && (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700">Job fully paid</p>
                </div>
              </div>
            )}

            <Section title="Timeline">
              <div className="space-y-2">
                <TimelineItem label="Created" date={job.created_at} active />
                {job.scheduled_date && <TimelineItem label="Scheduled" date={job.scheduled_date} active />}
                {["in_progress_phase1", "in_progress_phase2", "in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed"].includes(job.status) && (
                  <TimelineItem label="Phase 1 Started" date={job.updated_at} active />
                )}
                {["in_progress_phase2", "in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed"].includes(job.status) && (
                  <TimelineItem label="Phase 2" date={job.updated_at} active />
                )}
                {["in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed"].includes(job.status) && (
                  <TimelineItem label="Phase 3" date={job.updated_at} active />
                )}
                {["final_check", "awaiting_payment", "need_attention", "completed"].includes(job.status) && (
                  <TimelineItem label="Final Check" date={job.updated_at} active />
                )}
                {job.report_submitted && (
                  <TimelineItem label="Report sent to customer" date={job.report_submitted_at ?? job.updated_at} active />
                )}
                {job.status === "completed" && (
                  <TimelineItem label="Completed" date={job.completed_date ?? job.updated_at} active />
                )}
              </div>
            </Section>

            <Section title="History">
              <AuditTimeline entityType="job" entityId={job.id} />
            </Section>
          </div>
        </div>
      </div>

      <Modal open={addPaymentOpen} onClose={() => { setAddPaymentOpen(false); setAddPaymentAmount(""); setAddPaymentNote(""); }} title="Register payment">
        <div className="space-y-4 p-4">
          {(addPaymentType === "customer_deposit" || addPaymentType === "customer_final") && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Type</label>
              <Select
                value={addPaymentType}
                onChange={(e) => setAddPaymentType(e.target.value as JobPaymentType)}
                options={[
                  { value: "customer_deposit", label: "Deposit" },
                  { value: "customer_final", label: "Final payment" },
                ]}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
            <Input type="number" min={0} step="0.01" placeholder="0.00" value={addPaymentAmount} onChange={(e) => setAddPaymentAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Date</label>
            <Input type="date" value={addPaymentDate} onChange={(e) => setAddPaymentDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Bank transfer ref"
              value={addPaymentNote}
              onChange={(e) => setAddPaymentNote(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={() => { setAddPaymentOpen(false); setAddPaymentAmount(""); setAddPaymentNote(""); }}>Cancel</Button>
            <Button size="sm" loading={addingPayment} disabled={!addPaymentAmount || Number(addPaymentAmount) <= 0} onClick={handleAddPayment}>Register</Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
