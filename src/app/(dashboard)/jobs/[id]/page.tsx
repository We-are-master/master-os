"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
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
  CheckCircle2,
  FileText,
  Upload,
  ShieldCheck,
  Plus,
  ExternalLink,
  Info,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { getJob, updateJob } from "@/services/jobs";
import { createSelfBillFromJob } from "@/services/self-bills";
import { listJobPayments, createJobPayment } from "@/services/job-payments";
import { listAssignableUsers, type AssignableUser } from "@/services/profiles";
import { useProfile } from "@/hooks/use-profile";
import { logAudit } from "@/services/audit";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Avatar } from "@/components/ui/avatar";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import type { Job, JobPayment, JobPaymentType } from "@/types/database";
import {
  allConfiguredReportsApproved,
  canAdvanceJob,
  getJobStatusActions,
  normalizeTotalPhases,
  reportPhaseIndices,
  reportPhaseLabel,
} from "@/lib/job-phases";

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
  const [propertyEdit, setPropertyEdit] = useState<ClientAndAddressValue | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [unlinkedAddressDraft, setUnlinkedAddressDraft] = useState("");
  const [savingUnlinkedAddress, setSavingUnlinkedAddress] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);
  const isAdmin = profile?.role === "admin";

  const loadPayments = useCallback(async (jobId: string) => {
    setLoadingPayments(true);
    try {
      const [partner, all] = await Promise.all([
        listJobPayments(jobId, "partner"),
        listJobPayments(jobId),
      ]);
      setPartnerPayments(partner);
      setCustomerPayments(all.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"));
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [j, partner, all] = await Promise.all([
          getJob(id),
          listJobPayments(id, "partner"),
          listJobPayments(id),
        ]);
        if (cancelled) return;
        setJob(j ?? null);
        setPartnerPayments(partner);
        setCustomerPayments(all.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"));
      } catch {
        if (!cancelled) toast.error("Failed to load job");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  useEffect(() => {
    if (!job) {
      setPropertyEdit(null);
      setUnlinkedAddressDraft("");
      return;
    }
    if (job.client_id) {
      setPropertyEdit({
        client_id: job.client_id,
        client_address_id: job.client_address_id,
        client_name: job.client_name,
        client_email: undefined,
        property_address: job.property_address,
      });
      setUnlinkedAddressDraft("");
    } else {
      setPropertyEdit(null);
      setUnlinkedAddressDraft(job.property_address ?? "");
    }
  }, [job?.id, job?.client_id, job?.client_address_id, job?.client_name, job?.property_address]);

  useEffect(() => {
    if (!isAdmin) return;
    listAssignableUsers().then(setAssignableUsers).catch(() => {});
  }, [isAdmin]);

  const handleJobUpdate = useCallback(async (jobId: string, updates: Partial<Job>) => {
    try {
      const updated = await updateJob(jobId, updates);
      setJob(updated);
      toast.success("Job updated");
    } catch {
      toast.error("Failed to update");
    }
  }, []);

  const handleSaveLinkedProperty = useCallback(async () => {
    if (!job || !propertyEdit?.property_address?.trim()) {
      toast.error("Property address is required");
      return;
    }
    setSavingProperty(true);
    try {
      await handleJobUpdate(job.id, {
        property_address: propertyEdit.property_address.trim(),
        client_address_id: propertyEdit.client_address_id,
      });
    } finally {
      setSavingProperty(false);
    }
  }, [job, propertyEdit, handleJobUpdate]);

  const handleSaveUnlinkedProperty = useCallback(async () => {
    if (!job || !unlinkedAddressDraft.trim()) {
      toast.error("Property address is required");
      return;
    }
    setSavingUnlinkedAddress(true);
    try {
      await handleJobUpdate(job.id, { property_address: unlinkedAddressDraft.trim() });
    } finally {
      setSavingUnlinkedAddress(false);
    }
  }, [job, unlinkedAddressDraft, handleJobUpdate]);

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
  const statusActions = getJobStatusActions(job);
  const phaseCount = normalizeTotalPhases(job.total_phases);

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
              {statusActions.map((action, idx) => (
                <Button
                  key={`${action.status}-${idx}`}
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
              <div className="rounded-xl border border-border-light bg-surface-hover/40 p-4 space-y-3 mb-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Job record
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex justify-between gap-2 border-b border-border-light/80 pb-2 sm:border-0 sm:pb-0">
                    <span className="text-text-tertiary">Created</span>
                    <span className="text-text-primary font-medium text-right tabular-nums">
                      {new Date(job.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border-light/80 pb-2 sm:border-0 sm:pb-0">
                    <span className="text-text-tertiary">Last updated</span>
                    <span className="text-text-primary font-medium text-right tabular-nums">
                      {new Date(job.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border-light/80 pb-2 sm:border-0 sm:pb-0">
                    <span className="text-text-tertiary">Phase</span>
                    <span className="text-text-primary font-medium">
                      {job.current_phase} / {phaseCount}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border-light/80 pb-2 sm:border-0 sm:pb-0">
                    <span className="text-text-tertiary">Finance status</span>
                    <Badge variant={job.finance_status === "paid" ? "success" : job.finance_status === "partial" ? "warning" : "default"} size="sm">
                      {job.finance_status === "paid" ? "Paid" : job.finance_status === "partial" ? "Partial" : "Unpaid"}
                    </Badge>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border-light/80 pb-2 sm:border-0 sm:pb-0">
                    <span className="text-text-tertiary">Customer</span>
                    <span className="text-text-primary text-right text-xs leading-snug">
                      Deposit {job.customer_deposit_paid ? "paid" : "due"}
                      {" · "}
                      Final {job.customer_final_paid ? "paid" : "due"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-text-tertiary">Service value</span>
                    <span className="text-text-primary font-medium tabular-nums">{formatCurrency(job.service_value)}</span>
                  </div>
                  {(job.partner_payment_1_paid || job.partner_payment_2_paid || job.partner_payment_3_paid) && (
                    <div className="sm:col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary pt-1">
                      <span className="font-medium text-text-secondary">Legacy partner milestones</span>
                      <span>P1 {job.partner_payment_1_paid ? "paid" : "open"}</span>
                      <span>P2 {job.partner_payment_2_paid ? "paid" : "open"}</span>
                      <span>P3 {job.partner_payment_3_paid ? "paid" : "open"}</span>
                    </div>
                  )}
                </div>
                {(job.cash_in > 0 || job.cash_out > 0 || job.expenses > 0 || job.commission > 0 || job.vat > 0) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-border-light text-[11px] text-text-tertiary">
                    {job.cash_in > 0 && <span>Cash in {formatCurrency(job.cash_in)}</span>}
                    {job.cash_out > 0 && <span>Cash out {formatCurrency(job.cash_out)}</span>}
                    {job.expenses > 0 && <span>Expenses {formatCurrency(job.expenses)}</span>}
                    {job.commission > 0 && <span>Commission {formatCurrency(job.commission)}</span>}
                    {job.vat > 0 && <span>VAT {formatCurrency(job.vat)}</span>}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {job.quote_id && (
                    <Link
                      href="/quotes"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Quote <span className="font-mono text-[10px] opacity-80">{job.quote_id.slice(0, 8)}…</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {job.self_bill_id && (
                    <Link
                      href="/finance/selfbill"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Self-bill linked
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {job.invoice_id && (
                    <Link
                      href="/finance/invoices"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Invoice linked
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {job.partner_id && (
                    <Link href="/partners" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      Partner record
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
                {job.internal_notes?.trim() && (
                  <div className="pt-2 border-t border-border-light">
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Internal notes</p>
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{job.internal_notes}</p>
                  </div>
                )}
                {job.report_notes?.trim() && (
                  <div className="pt-2 border-t border-border-light">
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Report notes</p>
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{job.report_notes}</p>
                  </div>
                )}
              </div>
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
              <p className="text-xs text-text-tertiary mb-3">Client details are read-only. You can update only the property address.</p>
              {job.client_id && propertyEdit ? (
                <>
                  <ClientAddressPicker
                    lockClient
                    value={propertyEdit}
                    onChange={setPropertyEdit}
                    labelClient="Client"
                    labelAddress="Property address *"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    loading={savingProperty}
                    onClick={handleSaveLinkedProperty}
                  >
                    Save property address
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-hover">
                    <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5 text-blue-600" />
                    </div>
                    <p className="text-sm font-semibold text-text-primary">{job.client_name}</p>
                  </div>
                  <p className="text-xs text-text-tertiary mt-2">Not linked to a client record — edit the address text only.</p>
                  <div className="mt-3">
                    <AddressAutocomplete
                      value={unlinkedAddressDraft}
                      onChange={(v) => setUnlinkedAddressDraft(v)}
                      onSelect={(parts) => setUnlinkedAddressDraft(parts.full_address)}
                      label="Property address *"
                      placeholder="Start typing address or postcode..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      loading={savingUnlinkedAddress}
                      onClick={handleSaveUnlinkedProperty}
                    >
                      Save property address
                    </Button>
                  </div>
                </>
              )}
              <LocationMiniMap address={job.property_address} className="mt-3 rounded-xl overflow-hidden" lazy />
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
                  {isAdmin ? (
                    <div className="mt-2 space-y-2">
                      <select
                        value={job.owner_id ?? ""}
                        disabled={savingOwner}
                        onChange={async (e) => {
                          const ownerId = e.target.value || undefined;
                          const owner = assignableUsers.find((u) => u.id === ownerId);
                          setSavingOwner(true);
                          try {
                            await handleJobUpdate(job.id, {
                              owner_id: ownerId,
                              owner_name: owner?.full_name,
                            });
                            toast.success("Owner updated");
                          } catch {
                            toast.error("Failed to update owner");
                          } finally {
                            setSavingOwner(false);
                          }
                        }}
                        className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                      >
                        <option value="">No owner</option>
                        {assignableUsers.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))}
                      </select>
                      {job.owner_name && (
                        <div className="flex items-center gap-2">
                          <Avatar name={job.owner_name} size="sm" />
                          <p className="text-sm font-semibold text-text-primary">{job.owner_name}</p>
                        </div>
                      )}
                    </div>
                  ) : job.owner_name ? (
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
                {reportPhaseIndices(job.total_phases).map((n) => {
                  const uploaded = job[`report_${n}_uploaded` as keyof Job] as boolean;
                  const approved = job[`report_${n}_approved` as keyof Job] as boolean;
                  const uploadedAt = job[`report_${n}_uploaded_at` as keyof Job] as string | undefined;
                  const approvedAt = job[`report_${n}_approved_at` as keyof Job] as string | undefined;
                  const phaseLabel = reportPhaseLabel(n, job.total_phases);
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
              {allConfiguredReportsApproved(job) && (
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
              <p className="text-[11px] text-text-tertiary mb-3">Milestones from dates stored on the job (phase transitions are tracked in History).</p>
              <div className="space-y-2">
                <TimelineItem label="Created" date={job.created_at} active />
                {(job.scheduled_start_at || job.scheduled_date) && (
                  <TimelineItem
                    label="Scheduled"
                    date={job.scheduled_start_at ?? `${job.scheduled_date}T12:00:00`}
                    active
                  />
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
              <AuditTimeline entityType="job" entityId={job.id} deferUntilVisible />
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
