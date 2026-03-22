"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  AlertTriangle,
  CreditCard,
  RefreshCw,
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
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import type { Invoice, Job, JobPayment, JobPaymentType } from "@/types/database";
import { listInvoicesLinkedToJob } from "@/services/invoices";
import {
  allConfiguredReportsApproved,
  canAdvanceJob,
  canApproveReport,
  canMarkReportUploaded,
  canSendReportAndRequestFinalPayment,
  getJobStatusActions,
  normalizeTotalPhases,
  reportPhaseIndices,
  reportPhaseLabel,
} from "@/lib/job-phases";
import {
  jobBillableRevenue,
  jobDirectCost,
  jobProfit,
  jobMarginPercent,
  deriveStoredJobFinancials,
  partnerPaymentCap,
  customerScheduledTotal,
} from "@/lib/job-financials";

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
  capHint,
}: {
  totalDue: number;
  payments: JobPayment[];
  loading: boolean;
  onAddPayment: () => void;
  /** e.g. max you can still register under the job cap */
  capHint?: string;
}) {
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, totalDue - totalPaid);
  return (
    <div className="space-y-3">
      {capHint && (
        <p className="text-[11px] text-text-tertiary flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {capHint}
        </p>
      )}
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
  const [finForm, setFinForm] = useState({
    client_price: "",
    extras_amount: "",
    partner_cost: "",
    materials_cost: "",
    partner_agreed_value: "",
    customer_deposit: "",
    customer_final_payment: "",
  });
  const [savingFin, setSavingFin] = useState(false);
  const [jobInvoices, setJobInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [syncingInvoiceId, setSyncingInvoiceId] = useState<string | null>(null);
  const isAdmin = profile?.role === "admin";
  const jobRef = useRef<Job | null>(null);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

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

  const loadJobInvoices = useCallback(async (j: Job) => {
    if (!j.reference?.trim()) {
      setJobInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    try {
      const rows = await listInvoicesLinkedToJob(j.reference, j.invoice_id);
      setJobInvoices(rows);
    } catch {
      toast.error("Failed to load invoices");
      setJobInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const refreshJobFinance = useCallback(async () => {
    if (!id) return;
    try {
      const j = await getJob(id);
      setJob(j);
      if (j) {
        await Promise.all([loadPayments(j.id), loadJobInvoices(j)]);
      }
    } catch {
      toast.error("Failed to refresh");
    }
  }, [id, loadPayments, loadJobInvoices]);

  const handleStripeInvoiceSync = useCallback(
    async (inv: Invoice) => {
      if (!inv.stripe_payment_link_id) {
        toast.error("This invoice has no Stripe payment link yet — open it in Invoices to create one.");
        return;
      }
      setSyncingInvoiceId(inv.id);
      try {
        const res = await fetch("/api/stripe/check-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: inv.id, paymentLinkId: inv.stripe_payment_link_id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        if (data.paymentStatus === "paid") {
          toast.success("Stripe payment confirmed — job deposit/final flags and payment lines updated.");
        } else {
          toast.info(`Stripe: ${data.paymentStatus ?? "unchanged"}`);
        }
        await refreshJobFinance();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncingInvoiceId(null);
      }
    },
    [refreshJobFinance]
  );

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
    if (!job?.reference?.trim()) {
      setJobInvoices([]);
      return;
    }
    void loadJobInvoices(job);
  }, [job?.id, job?.reference, job?.invoice_id, job?.updated_at, loadJobInvoices]);

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

  useEffect(() => {
    if (!job) return;
    setFinForm({
      client_price: String(job.client_price ?? 0),
      extras_amount: String(job.extras_amount ?? 0),
      partner_cost: String(job.partner_cost ?? 0),
      materials_cost: String(job.materials_cost ?? 0),
      partner_agreed_value: String(job.partner_agreed_value ?? 0),
      customer_deposit: String(job.customer_deposit ?? 0),
      customer_final_payment: String(job.customer_final_payment ?? 0),
    });
  }, [job?.id, job?.updated_at]);

  const handleJobUpdate = useCallback(async (jobId: string, updates: Partial<Job>) => {
    const current = jobRef.current;
    try {
      let payload: Partial<Job> = { ...updates };
      if (current && current.id === jobId) {
        const merged = { ...current, ...updates } as Job;
        const touchesMargin =
          updates.client_price !== undefined ||
          updates.partner_cost !== undefined ||
          updates.materials_cost !== undefined ||
          updates.extras_amount !== undefined;
        if (touchesMargin) {
          const derived = deriveStoredJobFinancials(merged);
          payload = { ...payload, ...derived };
        }
      }
      const updated = await updateJob(jobId, payload);
      setJob(updated);
      toast.success("Job updated");
    } catch {
      toast.error("Failed to update");
    }
  }, []);

  const handleSaveFinancials = useCallback(async () => {
    if (!job) return;
    setSavingFin(true);
    try {
      const client_price = parseFloat(finForm.client_price) || 0;
      const extras_amount = parseFloat(finForm.extras_amount) || 0;
      const partner_cost = parseFloat(finForm.partner_cost) || 0;
      const materials_cost = parseFloat(finForm.materials_cost) || 0;
      const partner_agreed_value = parseFloat(finForm.partner_agreed_value) || 0;
      const customer_deposit = parseFloat(finForm.customer_deposit) || 0;
      const customer_final_payment = parseFloat(finForm.customer_final_payment) || 0;
      await handleJobUpdate(job.id, {
        client_price,
        extras_amount,
        partner_cost,
        materials_cost,
        partner_agreed_value,
        customer_deposit,
        customer_final_payment,
      });
    } finally {
      setSavingFin(false);
    }
  }, [job, finForm, handleJobUpdate]);

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
    const amount = Number(addPaymentAmount);
    const partnerCap = partnerPaymentCap(job);
    const partnerPaid = partnerPayments.reduce((s, p) => s + Number(p.amount), 0);
    const maxPartner = Math.max(0, partnerCap - partnerPaid);
    const depPaid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    const finPaid = customerPayments.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
    const maxDep = Math.max(0, (job.customer_deposit ?? 0) - depPaid);
    const maxFin = Math.max(0, (job.customer_final_payment ?? 0) - finPaid);

    if (addPaymentType === "partner" && amount > maxPartner + 1e-6) {
      toast.error(`Partner payment cannot exceed remaining cap (${formatCurrency(maxPartner)}).`);
      return;
    }
    if (addPaymentType === "customer_deposit" && amount > maxDep + 1e-6) {
      toast.error(`Deposit payment cannot exceed scheduled deposit remaining (${formatCurrency(maxDep)}).`);
      return;
    }
    if (addPaymentType === "customer_final" && amount > maxFin + 1e-6) {
      toast.error(`Final payment cannot exceed scheduled final remaining (${formatCurrency(maxFin)}).`);
      return;
    }

    setAddingPayment(true);
    try {
      await createJobPayment({
        job_id: job.id,
        type: addPaymentType,
        amount,
        payment_date: addPaymentDate,
        note: addPaymentNote.trim() || undefined,
      });
      toast.success("Payment registered");
      setAddPaymentOpen(false);
      setAddPaymentAmount("");
      setAddPaymentDate(new Date().toISOString().slice(0, 10));
      setAddPaymentNote("");
      await refreshJobFinance();
    } catch {
      toast.error("Failed to register payment");
    } finally {
      setAddingPayment(false);
    }
  }, [
    job,
    addPaymentAmount,
    addPaymentDate,
    addPaymentNote,
    addPaymentType,
    refreshJobFinance,
    partnerPayments,
    customerPayments,
  ]);

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
  const billableRevenue = jobBillableRevenue(job);
  const directCost = jobDirectCost(job);
  const profit = jobProfit(job);
  const marginPct = jobMarginPercent(job);
  const partnerCap = partnerPaymentCap(job);
  const partnerPaidTotal = partnerPayments.reduce((s, p) => s + Number(p.amount), 0);
  const partnerPayRemaining = Math.max(0, partnerCap - partnerPaidTotal);
  const customerDepositPaid = customerPayments
    .filter((p) => p.type === "customer_deposit")
    .reduce((s, p) => s + Number(p.amount), 0);
  const customerFinalPaidSum = customerPayments
    .filter((p) => p.type === "customer_final")
    .reduce((s, p) => s + Number(p.amount), 0);
  const maxCustomerDepositPay = Math.max(0, (job.customer_deposit ?? 0) - customerDepositPaid);
  const maxCustomerFinalPay = Math.max(0, (job.customer_final_payment ?? 0) - customerFinalPaidSum);
  const scheduledCustomerTotal = customerScheduledTotal(job);
  const customerScheduleMismatch = Math.abs(billableRevenue - scheduledCustomerTotal) > 0.02;

  const paymentAmountMax =
    addPaymentType === "partner"
      ? partnerPayRemaining
      : addPaymentType === "customer_deposit"
        ? maxCustomerDepositPay
        : addPaymentType === "customer_final"
          ? maxCustomerFinalPay
          : 0;

  const statusActions = getJobStatusActions(job);
  const phaseCount = normalizeTotalPhases(job.total_phases);
  const sendReportFinalCheck = canSendReportAndRequestFinalPayment(job);

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
                    <span className="text-text-tertiary">Billable total (client + extras)</span>
                    <span className="text-text-primary font-medium tabular-nums">{formatCurrency(billableRevenue)}</span>
                  </div>
                  {(Number(job.extras_amount ?? 0) > 0 || job.client_price !== billableRevenue) && (
                    <div className="sm:col-span-2 text-[11px] text-text-tertiary">
                      Base price {formatCurrency(job.client_price)}
                      {Number(job.extras_amount ?? 0) > 0 && (
                        <> · Extras {formatCurrency(Number(job.extras_amount ?? 0))}</>
                      )}
                    </div>
                  )}
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
                  <p className="text-lg font-bold text-emerald-700">{formatCurrency(billableRevenue)}</p>
                  <p className="text-[10px] text-emerald-600/80 mt-1">client + extras</p>
                </div>
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 text-center">
                  <p className="text-[10px] font-semibold text-red-700 uppercase">Cost</p>
                  <p className="text-lg font-bold text-red-700">{formatCurrency(directCost)}</p>
                  <p className="text-[10px] text-red-600/80 mt-1">partner + materials</p>
                </div>
                <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 text-center">
                  <p className="text-[10px] font-semibold text-blue-700 uppercase">Profit</p>
                  <p className={`text-lg font-bold ${profit >= 0 ? "text-blue-700" : "text-red-600"}`}>{formatCurrency(profit)}</p>
                </div>
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-center">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase">Margin</p>
                  <p className={`text-lg font-bold ${marginPct >= 20 ? "text-amber-700" : "text-red-600"}`}>{marginPct}%</p>
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

            <Section title="Pricing & customer schedule">
              <p className="text-xs text-text-tertiary mb-3">
                Update amounts here — <strong className="text-text-secondary">margin</strong> and <strong className="text-text-secondary">service value</strong> are recalculated from client price + extras minus costs.
                Partner payment registrations cannot exceed the partner cap; each customer line is capped by deposit / final schedules.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Client price</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.client_price}
                    onChange={(e) => setFinForm((f) => ({ ...f, client_price: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Extras (add-ons)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.extras_amount}
                    onChange={(e) => setFinForm((f) => ({ ...f, extras_amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner cost</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.partner_cost}
                    onChange={(e) => setFinForm((f) => ({ ...f, partner_cost: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Materials cost</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.materials_cost}
                    onChange={(e) => setFinForm((f) => ({ ...f, materials_cost: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner pay cap</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.partner_agreed_value}
                    onChange={(e) => setFinForm((f) => ({ ...f, partner_agreed_value: e.target.value }))}
                  />
                  <p className="text-[10px] text-text-tertiary mt-1">Max total partner payments (if 0, cap uses partner cost).</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Customer deposit (scheduled)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.customer_deposit}
                    onChange={(e) => setFinForm((f) => ({ ...f, customer_deposit: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Customer final (scheduled)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={finForm.customer_final_payment}
                    onChange={(e) => setFinForm((f) => ({ ...f, customer_final_payment: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="button" size="sm" variant="primary" loading={savingFin} onClick={handleSaveFinancials}>
                Save pricing & schedule
              </Button>
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
                    <div className="mt-2">
                      <JobOwnerSelect
                        value={job.owner_id}
                        fallbackName={job.owner_name}
                        users={assignableUsers}
                        disabled={savingOwner}
                        onChange={async (ownerId) => {
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
                      />
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
              <p className="text-xs text-text-tertiary mb-3">
                Partner uploads reports after each work phase. Ops approves them before payment. You cannot record reports while the job is still <strong className="text-text-secondary">Scheduled</strong> — use{" "}
                <strong className="text-text-secondary">Start Phase 1</strong> first.
              </p>
              <div className="space-y-3">
                {reportPhaseIndices(job.total_phases).map((n) => {
                  const uploaded = job[`report_${n}_uploaded` as keyof Job] as boolean;
                  const approved = job[`report_${n}_approved` as keyof Job] as boolean;
                  const uploadedAt = job[`report_${n}_uploaded_at` as keyof Job] as string | undefined;
                  const approvedAt = job[`report_${n}_approved_at` as keyof Job] as string | undefined;
                  const phaseLabel = reportPhaseLabel(n, job.total_phases);
                  const uploadCheck = canMarkReportUploaded(job, n);
                  const approveCheck = canApproveReport(job, n);
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
                      <div className="flex flex-col gap-2 mt-3">
                        {!uploaded && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<Upload className="h-3.5 w-3.5" />}
                              disabled={!uploadCheck.ok}
                              title={uploadCheck.message}
                              onClick={() => {
                                if (!uploadCheck.ok) {
                                  toast.error(uploadCheck.message ?? "Cannot upload yet");
                                  return;
                                }
                                handleJobUpdate(job.id, { [`report_${n}_uploaded`]: true, [`report_${n}_uploaded_at`]: new Date().toISOString() } as Partial<Job>);
                              }}
                            >
                              Mark as Uploaded
                            </Button>
                            {!uploadCheck.ok && uploadCheck.message && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">{uploadCheck.message}</p>
                            )}
                          </>
                        )}
                        {uploaded && !approved && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<ShieldCheck className="h-3.5 w-3.5" />}
                              disabled={!approveCheck.ok}
                              title={approveCheck.message}
                              onClick={() => {
                                if (!approveCheck.ok) {
                                  toast.error(approveCheck.message ?? "Cannot approve yet");
                                  return;
                                }
                                handleJobUpdate(job.id, { [`report_${n}_approved`]: true, [`report_${n}_approved_at`]: new Date().toISOString() } as Partial<Job>);
                              }}
                            >
                              Approve Report
                            </Button>
                            {!approveCheck.ok && approveCheck.message && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">{approveCheck.message}</p>
                            )}
                          </>
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
                  {!sendReportFinalCheck.ok && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {sendReportFinalCheck.message}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="mt-3"
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    disabled={!sendReportFinalCheck.ok}
                    title={sendReportFinalCheck.message}
                    onClick={() => {
                      if (!sendReportFinalCheck.ok) {
                        toast.error(sendReportFinalCheck.message ?? "Cannot proceed");
                        return;
                      }
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
                totalDue={partnerCap}
                capHint={`You can register up to ${formatCurrency(partnerPayRemaining)} more; total partner lines cannot exceed ${formatCurrency(partnerCap)} (partner pay cap).`}
                payments={partnerPayments}
                loading={loadingPayments}
                onAddPayment={() => { setAddPaymentType("partner"); setAddPaymentOpen(true); }}
              />
            </Section>

            <Section title="Customer payments">
              {customerScheduleMismatch && (
                <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 text-sm text-amber-900 dark:text-amber-100">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Scheduled total ≠ billable total</p>
                    <p className="text-xs mt-1 opacity-90">
                      Deposit + final = {formatCurrency(scheduledCustomerTotal)} but client price + extras = {formatCurrency(billableRevenue)}.
                      Align the amounts in <strong className="font-medium">Pricing & customer schedule</strong> so payments match the quote.
                    </p>
                  </div>
                </div>
              )}
              <JobPaymentBlock
                totalDue={scheduledCustomerTotal}
                capHint={`Per line: up to ${formatCurrency(maxCustomerDepositPay)} on deposit type, ${formatCurrency(maxCustomerFinalPay)} on final type (against scheduled amounts).`}
                payments={customerPayments}
                loading={loadingPayments}
                onAddPayment={() => { setAddPaymentType("customer_deposit"); setAddPaymentOpen(true); }}
              />
              <p className="text-[11px] text-text-tertiary mt-3">
                <strong className="text-text-secondary">Stripe:</strong> when the customer pays via a linked invoice, the webhook (or <strong className="text-text-secondary">Sync Stripe</strong> below) updates this job — deposit/final flags and a matching line in the list above.
              </p>
            </Section>

            <Section title="Invoices & Stripe">
              <p className="text-xs text-text-tertiary mb-3">
                Invoices with job reference <span className="font-mono text-text-secondary">{job.reference}</span> and the primary invoice on this job. Generate payment links in{" "}
                <Link href="/finance/invoices" className="text-primary font-medium hover:underline inline-flex items-center gap-0.5">
                  Finance → Invoices <ExternalLink className="h-3 w-3" />
                </Link>
                .
              </p>
              {loadingInvoices ? (
                <div className="text-sm text-text-tertiary py-4">Loading invoices…</div>
              ) : jobInvoices.length === 0 ? (
                <div className="rounded-xl border border-border-light bg-surface-hover p-4 text-sm text-text-tertiary">
                  No invoices linked yet. Use job reference <span className="font-mono">{job.reference}</span> when creating an invoice, or accept a quote with deposit to create one automatically.
                </div>
              ) : (
                <div className="space-y-3">
                  {jobInvoices.map((inv) => {
                    const stripePaid = inv.stripe_payment_status === "paid";
                    const isPrimary = job.invoice_id === inv.id;
                    return (
                      <div
                        key={inv.id}
                        className="rounded-xl border border-border-light bg-surface-hover/50 p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-text-primary">{inv.reference}</p>
                              {isPrimary && (
                                <Badge variant="info" size="sm">Primary on job</Badge>
                              )}
                              <Badge variant={inv.status === "paid" ? "success" : "warning"} size="sm">
                                {inv.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-text-tertiary mt-0.5">{inv.client_name}</p>
                            <p className="text-sm font-bold text-text-primary mt-1">{formatCurrency(inv.amount)}</p>
                          </div>
                          {inv.stripe_payment_link_url && (
                            <div className="flex flex-wrap gap-1.5 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                icon={<CreditCard className="h-3.5 w-3.5" />}
                                onClick={() => window.open(inv.stripe_payment_link_url!, "_blank", "noopener,noreferrer")}
                              >
                                Pay link
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={syncingInvoiceId === inv.id}
                                icon={<RefreshCw className="h-3.5 w-3.5" />}
                                onClick={() => void handleStripeInvoiceSync(inv)}
                              >
                                Sync Stripe
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                          <span>Stripe:</span>
                          <Badge variant={stripePaid ? "success" : inv.stripe_payment_status === "failed" ? "danger" : "default"} size="sm">
                            {inv.stripe_payment_status ?? "none"}
                          </Badge>
                          {!inv.stripe_payment_link_url && inv.status !== "paid" && (
                            <span className="text-amber-600 dark:text-amber-400">No link — create in Invoices drawer</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
            <Input
              type="number"
              min={0}
              max={paymentAmountMax > 0 ? paymentAmountMax : undefined}
              step="0.01"
              placeholder="0.00"
              value={addPaymentAmount}
              onChange={(e) => setAddPaymentAmount(e.target.value)}
            />
            <p className="text-[11px] text-text-tertiary mt-1.5">
              Maximum for this payment type: <strong className="text-text-secondary">{formatCurrency(paymentAmountMax)}</strong>
              {paymentAmountMax <= 0 && (
                <span className="block text-amber-600 dark:text-amber-400 mt-1">Nothing left to register for this type under current schedules.</span>
              )}
            </p>
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
            <Button
              size="sm"
              loading={addingPayment}
              disabled={!addPaymentAmount || Number(addPaymentAmount) <= 0 || paymentAmountMax <= 0}
              onClick={handleAddPayment}
            >
              Register
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
