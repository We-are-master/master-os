"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";

import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { isWorkforceDocMandatory } from "@/lib/workforce-required-docs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CountrySelect } from "@/components/ui/country-select";
import { Avatar } from "@/components/ui/avatar";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  InternalCost,
  InternalCostStatus,
  PayrollInternalEmploymentType,
  PayrollInternalProfile,
  SelfBill,
  BusinessUnit,
  WorkforceCommissionBasis,
} from "@/types/database";
import {
  PAYROLL_FREQUENCY_OPTIONS,
  PAYROLL_COST_CATEGORIES,
  PAYROLL_UPLOAD_LABELS,
  PROFILE_PHOTO_DOC_KEY,
  payrollDocsRowCompletion,
  payrollUploadKeysForRow,
  type PayrollDocumentFileMeta,
} from "@/lib/payroll-doc-checklist";
import { requestWorkforceOnboardingLink } from "@/lib/workforce-payment-options";
import {
  buildPayLineDescription,
  parsePayLineDescription,
  WORKFORCE_DEPARTMENT_SELECT_OPTIONS,
} from "@/lib/workforce-departments";
import { uploadPayrollDocumentFile, getPayrollDocumentSignedUrl } from "@/services/payroll-documents-storage";
import { getSupabase } from "@/services/base";
import { listInternalSelfBillsForCost } from "@/services/internal-self-bills";
import { WorkforceAccessTab } from "./workforce-access-tab";
import {
  WORKFORCE_CONTRACTOR_FEE_LABEL,
  WORKFORCE_DRAWER_TAB_CONFIG,
  WorkforceDrawerStatusBadge,
  WorkforceDrawerTabs,
  WorkforceSectionTitle,
  workforceFieldClass,
  workforceSectionFormClass,
  workforceSectionHeroClass,
  type WorkforceDrawerTab,
} from "./workforce-ui";
import { activateWorkforcePerson } from "@/lib/workforce-lifecycle";
import {
  applyContractorTaxNumberToProfile,
  contractorTaxNumberFromProfile,
  isUkWorkCountry,
} from "@/lib/workforce-contractor-agreement";
import {
  WORKFORCE_MONTHLY_PAY_DAY,
  accrueMonthlyFixedPayToDate,
  computeWorkforcePayDueDate,
  countWorkforceCalendarPayableDays,
  getPayPeriodBounds,
  parseWorkforceDaysOff,
  parseWorkforceStartDate,
  workforcePayDayOfMonth,
} from "@/lib/workforce-pay-schedule";
import { format } from "date-fns";
import {
  FileText,
  Wallet,
  Trash2,
  Calendar,
  ExternalLink,
  Loader2,
  Download,
  CheckCircle2,
  Link2,
  Mail,
  Plus,
} from "lucide-react";

function parsePayrollDocumentFiles(raw: unknown): Record<string, PayrollDocumentFileMeta> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, PayrollDocumentFileMeta> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && v !== null && "path" in v) {
      const p = (v as { path?: unknown }).path;
      const fn = (v as { file_name?: unknown }).file_name;
      if (typeof p === "string" && p.length > 0) {
        out[k] = { path: p, file_name: typeof fn === "string" ? fn : "" };
      }
    }
  }
  return out;
}

function parsePayrollProfile(raw: unknown): PayrollInternalProfile {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const vatReg = o.vat_registered;
  const entityType = o.contractor_entity_type;
  return {
    email: str("email"),
    utr: str("utr"),
    ni_number: str("ni_number"),
    tax_code: str("tax_code"),
    position: str("position"),
    phone: str("phone"),
    address: str("address"),
    vat_number: str("vat_number"),
    vat_registered: vatReg === true || vatReg === "true",
    company_registration: str("company_registration"),
    country_of_operation: str("country_of_operation"),
    contractor_entity_type: entityType === "company" ? "company" : entityType === "individual" ? "individual" : undefined,
    start_date: str("start_date")?.slice(0, 10),
    days_off: parseWorkforceDaysOff(o),
  };
}

function normalizeDaysOff(days: string[] | undefined): string[] {
  return [
    ...new Set(
      (days ?? [])
        .map((d) => d.trim().slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ].sort();
}

const INTERNAL_STATUSES: InternalCostStatus[] = ["pending", "paid"];

type TabId = WorkforceDrawerTab;

export function WorkforcePersonDrawer({
  person,
  bus,
  open,
  onClose,
  onSaved,
  initialTab = "overview",
}: {
  person: InternalCost | null;
  bus: BusinessUnit[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialTab?: WorkforceDrawerTab;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [removePhotoPending, setRemovePhotoPending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | undefined>>({});

  // Danger-zone modal state
  const [offboardOpen, setOffboardOpen] = useState(false);
  const [offboardReason, setOffboardReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [payeeName, setPayeeName] = useState("");
  const [payLineDept, setPayLineDept] = useState("");
  const [payLineRoleTitle, setPayLineRoleTitle] = useState("");
  const [payLineOther, setPayLineOther] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [payFrequency, setPayFrequency] = useState<string>("");
  const [paymentDay, setPaymentDay] = useState("");
  const [status, setStatus] = useState<InternalCostStatus>("pending");
  const [profile, setProfile] = useState<PayrollInternalProfile>({});
  const [buId, setBuId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [payoutBankSort, setPayoutBankSort] = useState("");
  const [payoutBankAccount, setPayoutBankAccount] = useState("");
  const [payoutBankHolder, setPayoutBankHolder] = useState("");
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commissionRate, setCommissionRate] = useState("");
  const [commissionBasis, setCommissionBasis] = useState<WorkforceCommissionBasis>("gross_profit");
  const [employmentTypeEdit, setEmploymentTypeEdit] = useState<PayrollInternalEmploymentType>("employee");
  const [commissionPreview, setCommissionPreview] = useState<{
    estimatedNet: number;
    jobCount: number;
    fixedPay: number;
    commissionAmount: number;
  } | null>(null);
  const [sendingWelcome, setSendingWelcome] = useState(false);
  const [onboardingLinkBusy, setOnboardingLinkBusy] = useState(false);
  const [generatingBill, setGeneratingBill] = useState(false);

  const [internalBills, setInternalBills] = useState<SelfBill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [daysOffPick, setDaysOffPick] = useState("");
  const [contractorTaxNumber, setContractorTaxNumber] = useState("");
  const { workforceDocumentRules } = useFrontendSetup();
  const payslipFileRef = useRef<HTMLInputElement>(null);
  const payslipKeyRef = useRef<string | null>(null);

  const employmentType = employmentTypeEdit;
  const isEmployee = employmentType === "employee";
  const isContractor = employmentType === "self_employed";

  const requiredDocKeys = useMemo(
    () => [
      ...payrollUploadKeysForRow(
        employmentType ?? null,
        person?.has_equity ?? false,
        workforceDocumentRules,
      ),
    ],
    [employmentType, person?.has_equity, workforceDocumentRules],
  );

  const docsProgress = useMemo(() => {
    if (!person) return { done: 0, total: 0, missing: 0 };
    const files = parsePayrollDocumentFiles(person.payroll_document_files);
    const { done, total } = payrollDocsRowCompletion(
      employmentType ?? null,
      files,
      person.documents_on_file ?? null,
      person.has_equity ?? false,
      workforceDocumentRules,
    );
    return { done, total, missing: Math.max(0, total - done) };
  }, [person, employmentType, workforceDocumentRules]);

  const visibleDrawerTabs = useMemo(
    () =>
      WORKFORCE_DRAWER_TAB_CONFIG.filter(
        (t) => !t.contractorOnly || isContractor,
      ),
    [isContractor],
  );

  const workEmail = (profile.email ?? "").trim();

  const handleCopyOnboardingLink = useCallback(async () => {
    if (!person) return;
    if (!workEmail) {
      toast.error("Set work email on Profile first");
      setTab("overview");
      return;
    }
    setOnboardingLinkBusy(true);
    try {
      const { onboardingUrl, warning } = await requestWorkforceOnboardingLink(person.id, { sendEmail: false });
      await navigator.clipboard.writeText(onboardingUrl);
      toast.success("Onboarding link copied — person can upload docs and update profile");
      if (warning) toast.warning(warning);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create onboarding link");
    } finally {
      setOnboardingLinkBusy(false);
    }
  }, [person, workEmail]);

  const handleSendOnboardingEmail = useCallback(async () => {
    if (!person) return;
    if (!workEmail) {
      toast.error("Set work email on Profile first");
      setTab("overview");
      return;
    }
    if (!paymentMethod.trim()) {
      toast.error("Set payment method in Finance before emailing the invite");
      setTab("finance");
      return;
    }
    setSendingWelcome(true);
    try {
      const { sentTo, warning } = await requestWorkforceOnboardingLink(person.id, { sendEmail: true });
      toast.success(`Onboarding invite sent to ${sentTo ?? workEmail}`);
      if (warning) toast.warning(warning);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send onboarding invite");
    } finally {
      setSendingWelcome(false);
    }
  }, [person, workEmail, paymentMethod]);

  const syncFromPerson = useCallback(async () => {
    if (!person) return;
    setPendingFiles({});
    setRemovePhotoPending(false);
    setPayeeName(person.payee_name ?? "");
    {
      const parsed = parsePayLineDescription(person.description ?? "");
      setPayLineDept(parsed.department);
      setPayLineRoleTitle(parsed.roleTitle);
      setPayLineOther(parsed.otherFull);
    }
    setAmount(String(person.amount ?? ""));
    setCategory(person.category ?? "");
    setDueDate(person.due_date ?? "");
    setPayFrequency(person.pay_frequency ?? "");
    setPaymentDay(
      person.payment_day_of_month != null && person.payment_day_of_month >= 1
        ? String(person.payment_day_of_month)
        : String(WORKFORCE_MONTHLY_PAY_DAY),
    );
    setStatus(person.status === "paid" ? "paid" : "pending");
    const parsedProfile = parsePayrollProfile(person.payroll_profile);
    setProfile(parsedProfile);
    setContractorTaxNumber(contractorTaxNumberFromProfile(parsedProfile));
    setBuId(person.bu_id ?? "");
    setPaymentMethod(person.payment_method ?? "");
    setPayoutBankSort(person.payout_bank_sort_code ?? "");
    setPayoutBankAccount(person.payout_bank_account_number ?? "");
    setPayoutBankHolder(person.payout_bank_account_holder ?? "");
    setCommissionEnabled(!!person.commission_enabled);
    setCommissionRate(person.commission_rate_percent != null ? String(person.commission_rate_percent) : "");
    setCommissionBasis(person.commission_basis ?? "gross_profit");
    setEmploymentTypeEdit(
      person.employment_type === "self_employed" ? "self_employed" : "employee",
    );
    const files = parsePayrollDocumentFiles(person.payroll_document_files);
    const photoMeta = files[PROFILE_PHOTO_DOC_KEY];
    if (photoMeta?.path) {
      try {
        // xl Avatar = 64 px (drawer hero). Thumbnail transform keeps payload small.
        const u = await getPayrollDocumentSignedUrl(photoMeta.path, 3600, {
          width: 192,
          height: 192,
          resize: "cover",
        });
        setPhotoUrl(u);
      } catch {
        setPhotoUrl(null);
      }
    } else {
      setPhotoUrl(null);
    }
  }, [person]);

  useEffect(() => {
    void syncFromPerson();
  }, [syncFromPerson]);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab, person?.id]);

  useEffect(() => {
    if (!person?.id || !open || tab !== "finance") return;
    let cancelled = false;
    const params = new URLSearchParams({
      enabled: commissionEnabled ? "1" : "0",
      fixedPay: amount || "0",
    });
    if (commissionEnabled && commissionRate.trim()) params.set("rate", commissionRate.trim());
    if (commissionEnabled) params.set("basis", commissionBasis);
    void fetch(`/api/admin/workforce/${person.id}/commission-preview?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setCommissionPreview({
            estimatedNet: data.estimatedNet,
            jobCount: data.jobCount,
            fixedPay: data.fixedPay,
            commissionAmount: data.commission?.commissionAmount ?? 0,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [person?.id, open, tab, commissionEnabled, commissionRate, commissionBasis, amount, person?.profile_id]);

  const loadBills = useCallback(async () => {
    if (!person?.id || !isContractor) return;
    setLoadingBills(true);
    try {
      const list = await listInternalSelfBillsForCost(person.id);
      setInternalBills(list);
    } catch {
      setInternalBills([]);
      toast.error("Could not load internal self-bills");
    } finally {
      setLoadingBills(false);
    }
  }, [person?.id, isContractor]);

  const syncSelfBillsForPerson = useCallback(() => {
    if (!person?.id || !isContractor) return;
    void fetch("/api/workforce/sync-self-bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: person.id }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok === false) toast.warning(data.error ?? "Self-bill sync failed");
        else void loadBills();
      })
      .catch(() => toast.warning("Self-bill sync failed"));
  }, [person?.id, isContractor, loadBills]);

  useEffect(() => {
    if (open && person && isContractor && (tab === "finance" || tab === "schedule")) void loadBills();
  }, [open, person, isContractor, tab, loadBills]);

  useEffect(() => {
    if (!open || !person?.id || !isContractor || (tab !== "finance" && tab !== "schedule")) return;
    let cancelled = false;
    void fetch("/api/workforce/sync-self-bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: person.id }),
    })
      .then(() => {
        if (!cancelled) void loadBills();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, person?.id, isContractor, tab, loadBills]);

  const mergeUploads = async (
    costId: string,
    base: Record<string, PayrollDocumentFileMeta>,
  ): Promise<Record<string, PayrollDocumentFileMeta>> => {
    const out = { ...base };
    for (const [docKey, file] of Object.entries(pendingFiles)) {
      if (!file) continue;
      const up = await uploadPayrollDocumentFile(costId, docKey, file);
      out[docKey] = { path: up.path, file_name: up.file_name };
    }
    return out;
  };

  const handleSaveProfile = async () => {
    if (!person) return;
    if (!payeeName.trim()) {
      toast.error("Display name is required");
      return;
    }
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      const baseFiles = parsePayrollDocumentFiles(person.payroll_document_files);
      const mergedFiles = await mergeUploads(person.id, baseFiles);
      if (removePhotoPending) {
        delete mergedFiles[PROFILE_PHOTO_DOC_KEY];
      }
      let payroll_profile: PayrollInternalProfile = {
        ...profile,
        email: profile.email?.trim() || undefined,
        phone: profile.phone?.trim() || undefined,
        position: profile.position?.trim() || undefined,
        address: profile.address?.trim() || undefined,
        start_date: profile.start_date?.trim().slice(0, 10) || undefined,
        days_off: normalizeDaysOff(profile.days_off),
      };
      if (isContractor) {
        payroll_profile = applyContractorTaxNumberToProfile(payroll_profile, contractorTaxNumber);
        payroll_profile.ni_number = undefined;
        payroll_profile.tax_code = undefined;
      } else {
        payroll_profile.ni_number = profile.ni_number?.trim() || undefined;
        payroll_profile.tax_code = profile.tax_code?.trim() || undefined;
        payroll_profile.utr = undefined;
        payroll_profile.vat_number = undefined;
        payroll_profile.company_registration = undefined;
        payroll_profile.country_of_operation = undefined;
        payroll_profile.contractor_entity_type = undefined;
      }
      const { error } = await supabase
        .from("payroll_internal_costs")
        .update({
          payee_name: payeeName.trim(),
          payroll_profile,
          payroll_document_files: mergedFiles,
          employment_type: employmentTypeEdit,
          updated_at: now,
        })
        .eq("id", person.id);
      if (error) throw error;
      const prevProfile = parsePayrollProfile(person.payroll_profile);
      const startChanged =
        isContractor &&
        (prevProfile.start_date ?? "") !== (payroll_profile.start_date ?? "");
      if (startChanged) syncSelfBillsForPerson();
      setPendingFiles({});
      setRemovePhotoPending(false);
      toast.success("Profile saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!person || !isContractor) return;
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      const prevProfile = parsePayrollProfile(person.payroll_profile);
      const payroll_profile: PayrollInternalProfile = {
        ...parsePayrollProfile(person.payroll_profile),
        days_off: normalizeDaysOff(profile.days_off),
      };
      const { error } = await supabase
        .from("payroll_internal_costs")
        .update({ payroll_profile, updated_at: now })
        .eq("id", person.id);
      if (error) throw error;
      const daysChanged =
        normalizeDaysOff(prevProfile.days_off).join(",") !==
        normalizeDaysOff(payroll_profile.days_off).join(",");
      if (daysChanged) syncSelfBillsForPerson();
      toast.success("Schedule saved");
      onSaved();
      void syncFromPerson();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save schedule");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOverview = async () => {
    if (!person) return;
    const desc = buildPayLineDescription(payLineDept, payLineRoleTitle, payLineOther).trim();
    if (!desc) {
      toast.error("Department / description is required");
      return;
    }
    if (payLineDept === "Other" && !payLineOther.trim()) {
      toast.error("Enter a description when department is Other");
      return;
    }
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt < 0) {
      toast.error(
        isContractor
          ? `Enter a valid ${WORKFORCE_CONTRACTOR_FEE_LABEL.toLowerCase()} in the Finance tab`
          : "Enter a valid amount in the Finance tab",
      );
      return;
    }
    if (commissionEnabled) {
      const rate = Number(commissionRate);
      if (!commissionRate.trim() || Number.isNaN(rate) || rate <= 0 || rate > 100) {
        toast.error("Commission must be a percentage between 0 and 100");
        return;
      }
      if (!person.profile_id?.trim()) {
        toast.error("Link dashboard access first — commission uses jobs where this person is owner");
        return;
      }
    }
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      const baseFiles = parsePayrollDocumentFiles(person.payroll_document_files);
      const mergedFiles = await mergeUploads(person.id, baseFiles);
      if (removePhotoPending) {
        delete mergedFiles[PROFILE_PHOTO_DOC_KEY];
      }
      const payroll_profile: PayrollInternalProfile = {
        ...profile,
        email: profile.email?.trim() || undefined,
        phone: profile.phone?.trim() || undefined,
        position: profile.position?.trim() || undefined,
        address: profile.address?.trim() || undefined,
        ni_number: profile.ni_number?.trim() || undefined,
        tax_code: profile.tax_code?.trim() || undefined,
        utr: profile.utr?.trim() || undefined,
        vat_number: profile.vat_number?.trim() || undefined,
        start_date: profile.start_date?.trim().slice(0, 10) || undefined,
        days_off: normalizeDaysOff(profile.days_off),
      };
      const updates: Record<string, unknown> = {
        description: desc,
        amount: amt,
        category: category.trim() || null,
        due_date: dueDate.trim() || null,
        payee_name: payeeName.trim() || null,
        pay_frequency: payFrequency.trim() || null,
        payment_day_of_month: paymentDay.trim() ? Number(paymentDay) : WORKFORCE_MONTHLY_PAY_DAY,
        bu_id: buId.trim() || null,
        payroll_profile,
        payroll_document_files: mergedFiles,
        updated_at: now,
        status,
        payment_method: paymentMethod.trim() || null,
        payout_bank_sort_code: payoutBankSort.trim() || null,
        payout_bank_account_number: payoutBankAccount.trim() || null,
        payout_bank_account_holder: payoutBankHolder.trim() || null,
        commission_enabled: commissionEnabled,
        commission_rate_percent: commissionEnabled && commissionRate.trim() ? Number(commissionRate) : null,
        commission_basis: commissionEnabled ? commissionBasis : null,
        employment_type: employmentTypeEdit,
      };
      if (status === "paid") updates.paid_at = now.split("T")[0];
      const { error } = await supabase.from("payroll_internal_costs").update(updates).eq("id", person.id);
      if (error && String(error.message ?? "").toLowerCase().includes("bu_id")) {
        const noBu = { ...updates };
        delete noBu.bu_id;
        const retry = await supabase.from("payroll_internal_costs").update(noBu).eq("id", person.id);
        if (retry.error) throw retry.error;
        toast.warning("Saved without BU — apply migration 137 for bu_id column.");
      } else if (error) {
        throw error;
      }

      // If this person has dashboard access linked, propagate the profile
      // changes (email + name) to auth.users + profiles so they can still
      // sign in with their updated details.
      if (person.profile_id) {
        const authPatch: Record<string, unknown> = {};
        const prevProfile = parsePayrollProfile(person.payroll_profile);
        const nextEmail = payroll_profile.email ?? "";
        if (nextEmail && nextEmail !== (prevProfile.email ?? "")) {
          authPatch.email = nextEmail;
        }
        const nextName = payeeName.trim();
        if (nextName && nextName !== (person.payee_name ?? "").trim()) {
          authPatch.full_name = nextName;
        }
        if (Object.keys(authPatch).length > 0) {
          try {
            const res = await fetch(`/api/admin/team/user/${person.profile_id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(authPatch),
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              toast.warning(
                `Payroll saved, but dashboard login sync failed: ${errBody.error ?? "unknown"}`,
              );
            }
          } catch {
            toast.warning("Payroll saved, but dashboard login sync failed");
          }
        }
      }

      const typeChanged =
        (person.employment_type === "self_employed" ? "self_employed" : "employee") !== employmentTypeEdit;
      toast.success(
        typeChanged
          ? `Saved — now listed under ${employmentTypeEdit === "employee" ? "Employees" : "Contractors"}`
          : "Saved",
      );
      setPendingFiles({});
      setRemovePhotoPending(false);
      onSaved();
      void syncFromPerson();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDocPick = (docKey: string, file: File | null) => {
    if (docKey === PROFILE_PHOTO_DOC_KEY) {
      if (file) {
        setRemovePhotoPending(false);
        setPhotoUrl(URL.createObjectURL(file));
        setPendingFiles((prev) => ({ ...prev, [docKey]: file }));
        return;
      }
      setPhotoUrl(null);
      setRemovePhotoPending(true);
      setPendingFiles((prev) => {
        const next = { ...prev };
        delete next[docKey];
        return next;
      });
      return;
    }
    setPendingFiles((prev) => ({ ...prev, [docKey]: file ?? undefined }));
  };

  const handleOffboardConfirm = async () => {
    if (!person) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // Offboarding = hide from active roster + stop all payroll:
      //   - amount = 0 (zero out recurring salary/fee)
      //   - status = "paid" (nothing outstanding → excluded from Pay Run)
      //   - pay_frequency = null + payment_day_of_month = null (no future schedule)
      //   - recurring_approved_at = null (breaks recurring generator)
      //   - lifecycle_stage = "offboard" (hidden from Workforce active lists)
      const { error } = await getSupabase()
        .from("payroll_internal_costs")
        .update({
          lifecycle_stage: "offboard",
          offboard_at: now,
          offboard_reason: offboardReason.trim() || null,
          amount: 0,
          status: "paid",
          pay_frequency: null,
          payment_day_of_month: null,
          recurring_approved_at: null,
          updated_at: now,
        })
        .eq("id", person.id);
      if (error) throw error;

      // If there's a linked profile, deactivate the dashboard access
      // (cannot sign in anymore; history preserved)
      if (person.profile_id) {
        try {
          await fetch(`/api/admin/team/user/${person.profile_id}`, { method: "DELETE" });
        } catch {
          /* best effort */
        }
      }

      toast.success("Person offboarded — dashboard access revoked, payroll stopped");
      setOffboardOpen(false);
      setOffboardReason("");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to offboard");
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!person) return;
    setSaving(true);
    try {
      await activateWorkforcePerson(person.id);
      toast.success("Person activated — pay counts in company costs and Pay Run when due.");
      onSaved();
      void syncFromPerson();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to activate");
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async () => {
    if (!person) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await getSupabase()
        .from("payroll_internal_costs")
        .update({
          lifecycle_stage: "active",
          offboard_at: null,
          offboard_reason: null,
          updated_at: now,
        })
        .eq("id", person.id);
      if (error) throw error;

      // Reactivate linked profile too
      if (person.profile_id) {
        try {
          await fetch(`/api/admin/team/user/${person.profile_id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: true }),
          });
        } catch {
          /* best effort */
        }
      }

      toast.success("Person reactivated");
      onSaved();
      void syncFromPerson();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reactivate");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!person) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // payroll_internal_costs has no deleted_at — hide via offboard + stop payroll (same as offboard flow).
      const { error } = await getSupabase()
        .from("payroll_internal_costs")
        .update({
          lifecycle_stage: "offboard",
          offboard_at: now,
          offboard_reason: "Removed from workforce",
          amount: 0,
          status: "paid",
          pay_frequency: null,
          payment_day_of_month: null,
          recurring_approved_at: null,
          updated_at: now,
        })
        .eq("id", person.id);
      if (error) throw error;

      // Deactivate linked profile
      if (person.profile_id) {
        try {
          const res = await fetch(`/api/admin/team/user/${person.profile_id}`, { method: "DELETE" });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            toast.warning(
              `Person removed, but dashboard access revoke failed: ${body.error ?? "unknown"}`,
            );
          }
        } catch {
          toast.warning("Person removed, but dashboard access revoke failed");
        }
      }

      toast.success("Person removed");
      setDeleteOpen(false);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDocumentsOnly = async () => {
    if (!person) return;
    if (Object.keys(pendingFiles).length === 0) {
      toast.message("No new files selected");
      return;
    }
    setSaving(true);
    try {
      const baseFiles = parsePayrollDocumentFiles(person.payroll_document_files);
      const merged = await mergeUploads(person.id, baseFiles);
      const { error } = await getSupabase()
        .from("payroll_internal_costs")
        .update({
          payroll_document_files: merged,
          updated_at: new Date().toISOString(),
        })
        .eq("id", person.id);
      if (error) throw error;
      toast.success("Documents updated");
      setPendingFiles({});
      onSaved();
      void syncFromPerson();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  const payslipArchiveKeys = useMemo(() => {
    if (!person) return [];
    const files = parsePayrollDocumentFiles(person.payroll_document_files);
    const keys = new Set(
      Object.keys(files).filter((k) => k === "payslip" || k.startsWith("payslip_")),
    );
    for (const k of Object.keys(pendingFiles)) {
      if (k === "payslip" || k.startsWith("payslip_")) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [person, pendingFiles]);

  const selfBillSchedule = useMemo(() => {
    if (!isContractor) return null;
    const todayYmd = format(new Date(), "yyyy-MM-dd");
    const bounds = getPayPeriodBounds(
      (payFrequency as "weekly" | "biweekly" | "monthly" | null) ?? "monthly",
      new Date(),
    );
    const workforceStart = parseWorkforceStartDate(profile, person?.created_at);
    const daysOff = parseWorkforceDaysOff(profile);
    const payDay = workforcePayDayOfMonth(paymentDay.trim() ? Number(paymentDay) : null);
    const nextPayment = computeWorkforcePayDueDate(bounds.periodEnd, payDay);
    const { payableDays } = countWorkforceCalendarPayableDays(
      bounds.periodStart,
      bounds.periodEnd,
      todayYmd,
      workforceStart,
      daysOff,
    );
    const fixedPreview = accrueMonthlyFixedPayToDate(
      Number(amount) || 0,
      bounds.periodStart,
      bounds.periodEnd,
      todayYmd,
      workforceStart,
      daysOff,
    );
    return { bounds, nextPayment, payableDays, fixedPreview, payDay };
  }, [isContractor, payFrequency, profile, person?.created_at, paymentDay, amount]);

  const openSigned = async (path: string) => {
    try {
      const u = await getPayrollDocumentSignedUrl(path);
      window.open(u, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open file");
    }
  };

  const triggerPayslipPicker = () => {
    const key = `payslip_${new Date().toISOString().slice(0, 10)}_${Date.now().toString(36).slice(-4)}`;
    payslipKeyRef.current = key;
    payslipFileRef.current?.click();
  };

  const onPayslipFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const k = payslipKeyRef.current;
    payslipKeyRef.current = null;
    e.target.value = "";
    if (f && k) handleDocPick(k, f);
  };

  if (!person) {
    return (
      <Drawer open={false} onClose={onClose}>
        <div />
      </Drawer>
    );
  }

  const commissionBasisLabel = commissionBasis === "revenue" ? "revenue" : "gross margin";
  const feeLabel = isContractor ? WORKFORCE_CONTRACTOR_FEE_LABEL : "Fixed pay";

  const scheduleTabContent = isContractor && selfBillSchedule ? (
    <div className="space-y-5">
      <div className={workforceSectionHeroClass}>
        <WorkforceSectionTitle subtitle="Live preview for the accumulating monthly self-bill">
          Self-bill schedule
        </WorkforceSectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Work period</label>
            <Input
              readOnly
              value={`${formatDate(selfBillSchedule.bounds.periodStart)} – ${formatDate(selfBillSchedule.bounds.periodEnd)}`}
              className={cn(workforceFieldClass, "bg-white/60 dark:bg-black/20")}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Next payment</label>
            <Input
              readOnly
              value={formatDate(selfBillSchedule.nextPayment)}
              className={cn(workforceFieldClass, "bg-white/60 dark:bg-black/20")}
            />
            <p className="text-[10px] text-text-tertiary mt-1">Pay · day {selfBillSchedule.payDay} after period end</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary rounded-xl bg-white/70 dark:bg-black/20 border border-primary/15 px-3 py-2.5">
          <strong className="text-[#020040] dark:text-text-primary">{selfBillSchedule.payableDays}</strong> day
          {selfBillSchedule.payableDays === 1 ? "" : "s"} ·{" "}
          <strong className="text-[#020040] dark:text-text-primary">{formatCurrency(selfBillSchedule.fixedPreview)}</strong>{" "}
          {WORKFORCE_CONTRACTOR_FEE_LABEL.toLowerCase()}
          {commissionEnabled && commissionPreview ? (
            <>
              {" "}
              + <strong>{formatCurrency(commissionPreview.commissionAmount)}</strong> commission
            </>
          ) : null}
        </p>
      </div>

      <div className={workforceSectionFormClass}>
        <WorkforceSectionTitle subtitle="Unpaid days reduce service fee on the SB-INT draft">
          Days off
        </WorkforceSectionTitle>
        <div className="flex gap-2">
          <Input
            type="date"
            value={daysOffPick}
            onChange={(e) => setDaysOffPick(e.target.value)}
            className={workforceFieldClass}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!daysOffPick}
            onClick={() => {
              const ymd = daysOffPick.trim().slice(0, 10);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
              setProfile((p) => ({
                ...p,
                days_off: normalizeDaysOff([...(p.days_off ?? []), ymd]),
              }));
              setDaysOffPick("");
            }}
          >
            Add
          </Button>
        </div>
        {(profile.days_off ?? []).length > 0 ? (
          <ul className="space-y-1">
            {normalizeDaysOff(profile.days_off).map((d) => (
              <li
                key={d}
                className="flex items-center justify-between text-xs rounded-lg border border-border-light px-2 py-1.5"
              >
                <span>{formatDate(d)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${d}`}
                  onClick={() =>
                    setProfile((p) => ({
                      ...p,
                      days_off: normalizeDaysOff((p.days_off ?? []).filter((x) => x !== d)),
                    }))
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-text-tertiary">No days off — all calendar days in range count toward service fee.</p>
        )}
        <Button disabled={saving} onClick={() => void handleSaveSchedule()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save schedule"}
        </Button>
      </div>
    </div>
  ) : null;

  const financePayrollMeta = (
    <div className={workforceSectionFormClass}>
      <p className="text-sm font-semibold text-text-primary">Role & payroll</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Select
            label="Department"
            value={payLineDept}
            onChange={(e) => {
              setPayLineDept(e.target.value);
              if (e.target.value !== "Other") setPayLineOther("");
              if (!e.target.value) setPayLineRoleTitle("");
            }}
            options={WORKFORCE_DEPARTMENT_SELECT_OPTIONS}
            className="min-w-0"
          />
        </div>
        {payLineDept === "Other" && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-secondary mb-1">Role / pay line description</label>
            <Input
              value={payLineOther}
              onChange={(e) => setPayLineOther(e.target.value)}
              placeholder="Describe the pay line"
              className="w-full min-w-0"
            />
          </div>
        )}
        {!!payLineDept && payLineDept !== "Other" && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-secondary mb-1">Role title (optional)</label>
            <Input
              value={payLineRoleTitle}
              onChange={(e) => setPayLineRoleTitle(e.target.value)}
              placeholder="e.g. Coordinator"
              className="w-full min-w-0"
            />
          </div>
        )}
        <div>
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[{ value: "", label: "—" }, ...PAYROLL_COST_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]}
          />
        </div>
        <div>
          <Select
            label="Payment status"
            value={status}
            onChange={(e) => setStatus(e.target.value as InternalCostStatus)}
            options={INTERNAL_STATUSES.map((s) => ({
              value: s,
              label: s === "paid" ? "Paid" : "Pending",
            }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Select
            label="Business Unit"
            value={buId}
            onChange={(e) => setBuId(e.target.value)}
            options={[
              { value: "", label: "— No BU" },
              ...bus.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
      </div>
    </div>
  );

  const financePaymentSetup = (
    <div className={workforceSectionFormClass}>
      <WorkforceSectionTitle
        subtitle={
          isContractor
            ? `Monthly cutoff → Ready to pay in Billing (pay day ${WORKFORCE_MONTHLY_PAY_DAY}). Pro-rata by start date on Profile.`
            : `Monthly cadence — Ready to pay in Billing (due day ${WORKFORCE_MONTHLY_PAY_DAY}).`
        }
      >
        Payment setup
      </WorkforceSectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            {isContractor ? `${WORKFORCE_CONTRACTOR_FEE_LABEL} (£)` : "Fixed pay (£)"}
          </label>
          <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={workforceFieldClass} />
        </div>
        <div>
          <Select
            label="Pay frequency"
            value={payFrequency}
            onChange={(e) => setPayFrequency(e.target.value)}
            options={[{ value: "", label: "—" }, ...PAYROLL_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
          />
        </div>
        <div className={commissionEnabled ? "sm:col-span-2" : ""}>
          <div className={cn("grid gap-3", commissionEnabled ? "sm:grid-cols-3" : "grid-cols-1")}>
            <Select
              label="Commission"
              value={commissionEnabled ? "yes" : "no"}
              onChange={(e) => setCommissionEnabled(e.target.value === "yes")}
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
            />
            {commissionEnabled ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Rate (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value)}
                    placeholder="e.g. 10"
                    className={workforceFieldClass}
                  />
                </div>
                <Select
                  label="Commission on"
                  value={commissionBasis}
                  onChange={(e) => setCommissionBasis(e.target.value as WorkforceCommissionBasis)}
                  options={[
                    { value: "revenue", label: "Revenue" },
                    { value: "gross_profit", label: "Gross margin" },
                  ]}
                />
              </>
            ) : null}
          </div>
        </div>
        {!isContractor ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Next due date</label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={workforceFieldClass} />
          </div>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Pay day of month (1–28)</label>
          <Input
            type="number"
            min={1}
            max={28}
            value={paymentDay}
            onChange={(e) => setPaymentDay(e.target.value)}
            placeholder={String(WORKFORCE_MONTHLY_PAY_DAY)}
          />
          <p className="text-[10px] text-text-tertiary mt-1">Standard: day {WORKFORCE_MONTHLY_PAY_DAY}</p>
        </div>
        <div>
          <Select
            label="Payment method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            options={[
              { value: "", label: "—" },
              { value: "bank_transfer", label: "Bank transfer" },
              { value: "wise", label: "Wise" },
            ]}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border-light bg-card p-3 space-y-3 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Payout details</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Account holder</label>
            <Input value={payoutBankHolder} onChange={(e) => setPayoutBankHolder(e.target.value)} className={workforceFieldClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Sort code</label>
            <Input value={payoutBankSort} onChange={(e) => setPayoutBankSort(e.target.value)} className={workforceFieldClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Account number</label>
            <Input value={payoutBankAccount} onChange={(e) => setPayoutBankAccount(e.target.value)} className={workforceFieldClass} />
          </div>
        </div>
      </div>

      {commissionEnabled && commissionRate.trim() ? (
        <p className="text-sm text-text-secondary rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
          <strong className="text-[#020040] dark:text-text-primary">{formatCurrency(Number(amount) || 0)}</strong> {feeLabel.toLowerCase()}
          {" + "}
          <strong className="text-[#020040] dark:text-text-primary">{commissionRate}%</strong> commission on {commissionBasisLabel}
          {commissionPreview ? (
            <>
              {" "}
              → est. <strong>{formatCurrency(commissionPreview.estimatedNet)}</strong>
              {commissionPreview.jobCount > 0 ? ` (${commissionPreview.jobCount} owner job${commissionPreview.jobCount === 1 ? "" : "s"})` : ""}
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-text-secondary rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
          {feeLabel} only: <strong className="text-[#020040] dark:text-text-primary">{formatCurrency(Number(amount) || 0)}</strong>
        </p>
      )}

      {!person.profile_id && commissionEnabled ? (
        <p className="text-xs text-amber-700">Link dashboard access — commission is calculated on jobs where this person is job owner.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={() => void handleSaveOverview()}>
          Save payment setup
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<Mail className="h-3.5 w-3.5" />}
          disabled={sendingWelcome || !workEmail || !paymentMethod}
          onClick={() => void handleSendOnboardingEmail()}
        >
          {sendingWelcome ? "Sending…" : "Resend invite"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={generatingBill}
          onClick={async () => {
            setGeneratingBill(true);
            try {
              const res = await fetch("/api/workforce/close-pay-period", { method: "POST" });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "Generate failed");
              toast.success(`Generated ${data.count ?? 0} self-bill(s) for due period`);
              if (isContractor) void loadBills();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not generate self-bill");
            } finally {
              setGeneratingBill(false);
            }
          }}
        >
          {generatingBill ? "Generating…" : "Generate self-bill now"}
        </Button>
      </div>
    </div>
  );

  const stage = person.lifecycle_stage ?? "active";

  const onboardingInviteCard = (
    <div className={workforceSectionFormClass}>
      <p className="text-sm font-semibold text-text-primary">Onboarding link</p>
      <p className="text-xs text-text-secondary">
        Send a self-service link so {payeeName || "this person"} can see what&apos;s missing
        {docsProgress.total > 0 ? (
          <>
            {" "}
            (<strong className="font-medium text-text-primary">{docsProgress.missing}</strong> of{" "}
            {docsProgress.total} document{docsProgress.total === 1 ? "" : "s"} still needed)
          </>
        ) : null}
        , upload files, and update their profile.
      </p>
      {!workEmail ? (
        <p className="text-xs text-amber-700">Add a work email on Profile before sending the link.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={onboardingLinkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          disabled={onboardingLinkBusy || sendingWelcome || !workEmail}
          onClick={() => void handleCopyOnboardingLink()}
        >
          {onboardingLinkBusy ? "Creating…" : "Copy link"}
        </Button>
        <Button
          type="button"
          size="sm"
          icon={sendingWelcome ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          disabled={sendingWelcome || onboardingLinkBusy || !workEmail || !paymentMethod.trim()}
          onClick={() => void handleSendOnboardingEmail()}
        >
          {sendingWelcome ? "Sending…" : "Send link"}
        </Button>
      </div>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={payeeName || person.payee_name || "Person"}
      subtitle={
        isEmployee
          ? "Employee · internal team"
          : isContractor
            ? "Contractor · self-employed"
            : "Workforce"
      }
      width="w-[min(100vw-1rem,580px)]"
      className="bg-gradient-to-b from-[#020040]/[0.04] via-card to-card"
      headerLeading={
        <Avatar
          name={payeeName || person.payee_name || "?"}
          size="lg"
          src={photoUrl ?? undefined}
          className="ring-2 ring-primary/30 shadow-sm"
        />
      }
      titleAddon={
        <div className="flex flex-wrap items-center gap-1.5">
          <WorkforceDrawerStatusBadge stage={stage} />
          {isContractor ? (
            <Badge variant="info" size="sm" className="text-[9px] uppercase tracking-wide">
              Contractor
            </Badge>
          ) : isEmployee ? (
            <Badge variant="default" size="sm" className="text-[9px] uppercase tracking-wide">
              Employee
            </Badge>
          ) : null}
        </div>
      }
      headerExtra={
        stage === "onboarding" ? (
          <div className="flex flex-wrap items-center gap-2">
            {person.pay_frequency ? (
              <span className="text-xs text-text-tertiary">
                Pay {PAYROLL_FREQUENCY_OPTIONS.find((o) => o.value === person.pay_frequency)?.label ?? person.pay_frequency}
                {person.due_date ? ` · next due ${formatDate(person.due_date)}` : ""}
              </span>
            ) : null}
            <Button
              size="sm"
              className="ml-auto rounded-xl"
              disabled={saving}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={() => void handleActivate()}
            >
              Activate
            </Button>
          </div>
        ) : person.pay_frequency ? (
          <span className="text-xs text-text-tertiary">
            Pay {PAYROLL_FREQUENCY_OPTIONS.find((o) => o.value === person.pay_frequency)?.label ?? person.pay_frequency}
            {person.due_date ? ` · next due ${formatDate(person.due_date)}` : ""}
          </span>
        ) : undefined
      }
    >
      <div className="px-4 sm:px-6 pt-1 pb-0 border-b border-[#020040]/10 bg-card/95 backdrop-blur-sm sticky top-0 z-[1]">
        <WorkforceDrawerTabs
          tabs={visibleDrawerTabs}
          activeTab={tab}
          onChange={(id) => setTab(id)}
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-card p-4 sm:p-6 space-y-5">
        {tab === "overview" && (
          <div className="space-y-5">
            {stage === "onboarding" && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
                <p className="text-sm text-text-primary font-medium">Ready to go live?</p>
                <p className="text-xs text-text-secondary">
                  While onboarding, this person&apos;s pay is not included in company costs or Pay Run. Activate when
                  they should count as active workforce (employee or contractor).
                </p>
                <Button
                  disabled={saving}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  onClick={() => void handleActivate()}
                >
                  Activate person
                </Button>
              </div>
            )}
            <div className={workforceSectionFormClass}>
              <p className="text-sm font-semibold text-text-primary">Personal details</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {isContractor ? "Company or display name" : "Full name"}
                  </label>
                  <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Full name" className={workforceFieldClass} />
                </div>
                <div>
                  <Select
                    label="Team type"
                    value={employmentTypeEdit}
                    onChange={(e) => {
                      const next = e.target.value as PayrollInternalEmploymentType;
                      setEmploymentTypeEdit(next);
                      if (!category.trim()) {
                        setCategory(next === "employee" ? "Salary" : "Contractor");
                      }
                    }}
                    options={[
                      { value: "employee", label: "Employee (internal team / PAYE)" },
                      { value: "self_employed", label: "Contractor (self-employed)" },
                    ]}
                    className="min-w-0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Work email</label>
                  <Input
                    type="email"
                    value={profile.email ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                    placeholder="name@company.com"
                    className={workforceFieldClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
                  <Input
                    value={profile.phone ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    className={workforceFieldClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Role / position</label>
                  <Input
                    value={profile.position ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, position: e.target.value }))}
                    className={workforceFieldClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Address</label>
                  <Input
                    value={profile.address ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                    className={workforceFieldClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Start date</label>
                  <Input
                    type="date"
                    value={profile.start_date ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, start_date: e.target.value }))}
                    className={workforceFieldClass}
                  />
                  <p className="text-[10px] text-text-tertiary mt-1">
                    {isContractor
                      ? "First day as contractor — drives monthly self-bill period and pro-rata service fee."
                      : "Mid-month start pro-rates the first month\u2019s pay (cutoff last day of month)."}
                  </p>
                </div>
              </div>
            </div>

            {onboardingInviteCard}

            {isEmployee && (
              <div className={workforceSectionFormClass}>
                <p className="text-sm font-semibold text-text-primary">Tax & identifiers (PAYE)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">NI number</label>
                    <Input
                      value={profile.ni_number ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, ni_number: e.target.value }))}
                      className={workforceFieldClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Tax code</label>
                    <Input
                      value={profile.tax_code ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, tax_code: e.target.value }))}
                      className={workforceFieldClass}
                    />
                  </div>
                </div>
              </div>
            )}

            {isContractor && (
              <div className={workforceSectionFormClass}>
                <p className="text-sm font-semibold text-text-primary">Tax identifier</p>
                <div className="space-y-3">
                  <CountrySelect
                    label="Country of operation"
                    value={profile.country_of_operation ?? ""}
                    onChange={(country) => setProfile((p) => ({ ...p, country_of_operation: country }))}
                    className={workforceFieldClass}
                  />
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {isUkWorkCountry(profile.country_of_operation)
                        ? profile.contractor_entity_type === "company"
                          ? "Company registration or VAT number"
                          : "UTR"
                        : "Tax / registration number"}
                    </label>
                    <Input
                      value={contractorTaxNumber}
                      onChange={(e) => setContractorTaxNumber(e.target.value)}
                      placeholder={
                        isUkWorkCountry(profile.country_of_operation) ? "UTR or Companies House / VAT" : "Local tax ID"
                      }
                      className={workforceFieldClass}
                    />
                    <p className="text-[10px] text-text-tertiary mt-1">
                      {isUkWorkCountry(profile.country_of_operation)
                        ? "UK contractors — one identifier is enough here."
                        : "Outside the UK — NI and tax code are not used."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button className="w-full sm:w-auto" disabled={saving} onClick={() => void handleSaveProfile()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save profile"}
              </Button>
            </div>

            {/* Danger zone — offboard / reactivate / remove */}
            <div className="pt-5 mt-2 border-t border-dashed border-border-light">
              <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">
                Danger zone
              </p>
              <p className="text-xs text-text-tertiary mb-3">
                {stage === "offboard"
                  ? "This person is offboarded. Reactivate to bring them back, or remove permanently."
                  : "Offboard keeps the record (hides from active lists). Remove soft-deletes the payroll row and deactivates the linked dashboard access. History is always preserved."}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                {stage === "offboard" ? (
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={saving}
                    onClick={() => void handleReactivate()}
                  >
                    Reactivate person
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={saving}
                    onClick={() => {
                      setOffboardReason("");
                      setOffboardOpen(true);
                    }}
                  >
                    Offboard
                  </Button>
                )}
                <Button
                  variant="danger"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={() => setDeleteOpen(true)}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Remove person
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === "documents" && (
          <div className="space-y-4">
            {onboardingInviteCard}
            <div className={workforceSectionFormClass}>
            <p className="text-sm text-text-secondary">
              Required compliance documents. Same storage as Payroll — upload PDF or images.
            </p>
            <ul className="space-y-3">
              {requiredDocKeys.map((key) => {
                const files = parsePayrollDocumentFiles(person.payroll_document_files);
                const has = !!files[key]?.path || !!pendingFiles[key];
                const mandatory = isWorkforceDocMandatory(
                  workforceDocumentRules,
                  employmentType ?? null,
                  key,
                );
                return (
                  <li
                    key={key}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between rounded-xl border border-border-light bg-card p-3 shadow-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                      <span className="text-sm font-medium text-text-primary truncate">
                        {PAYROLL_UPLOAD_LABELS[key] ?? key}
                      </span>
                      <Badge variant={has ? "success" : mandatory ? "warning" : "default"} size="sm">
                        {has ? "File" : mandatory ? "Missing" : "Optional"}
                      </Badge>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {files[key]?.path && (
                        <Button type="button" size="sm" variant="outline" onClick={() => void openSigned(files[key]!.path)}>
                          Open
                        </Button>
                      )}
                      <label
                        className={cn(
                          "inline-flex h-8 px-3 text-xs font-semibold rounded-lg cursor-pointer items-center justify-center",
                          "bg-stone-900 text-white hover:bg-stone-800 shadow-sm dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200",
                        )}
                      >
                        Replace
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf,image/*,.doc,.docx"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocPick(key, f);
                          }}
                        />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button disabled={saving || Object.keys(pendingFiles).length === 0} onClick={() => void handleSaveDocumentsOnly()}>
              Save document uploads
            </Button>
            </div>
          </div>
        )}

        {tab === "finance" && isEmployee && (
          <div className="space-y-6">
            {financePayrollMeta}
            {financePaymentSetup}
            <div className={workforceSectionFormClass}>
              <p className="text-sm font-semibold text-text-primary">P60 & P45</p>
              <p className="text-xs text-text-tertiary">HMRC forms and leaving documents. Store PDFs securely.</p>
              {(["p60", "p45"] as const).map((key) => {
                const files = parsePayrollDocumentFiles(person.payroll_document_files);
                const meta = files[key];
                return (
                  <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                    <span className="text-sm">{PAYROLL_UPLOAD_LABELS[key]}</span>
                    <div className="flex gap-2">
                      {meta?.path && (
                        <Button type="button" size="sm" variant="outline" onClick={() => void openSigned(meta.path)}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Open
                        </Button>
                      )}
                      <label
                        className={cn(
                          "inline-flex h-8 px-3 text-xs font-semibold rounded-lg cursor-pointer items-center justify-center",
                          "bg-stone-900 text-white hover:bg-stone-800 shadow-sm dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200",
                        )}
                      >
                        {meta ? "Replace" : "Upload"}
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf,image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocPick(key, f);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={workforceSectionFormClass}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-text-primary">Payslips</p>
                <input ref={payslipFileRef} type="file" className="sr-only" accept=".pdf,image/*" onChange={onPayslipFile} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={triggerPayslipPicker}
                >
                  Add payslip
                </Button>
              </div>
              <ul className="space-y-2">
                {payslipArchiveKeys.map((k) => {
                  const files = parsePayrollDocumentFiles(person.payroll_document_files);
                  const m = files[k];
                  const pending = pendingFiles[k];
                  if (!m?.path && !pending) return null;
                  return (
                    <li key={k} className="flex items-center justify-between text-sm border border-border-light bg-card rounded-lg px-3 py-2 shadow-sm">
                      <span className="font-mono text-xs">{k}{pending ? " (pending upload)" : ""}</span>
                      {m?.path ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => void openSigned(m.path)}>
                          Open
                        </Button>
                      ) : (
                        <span className="text-xs text-amber-600">Save to upload</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {payslipArchiveKeys.length === 0 && (
                <p className="text-xs text-text-tertiary">No payslips yet. Use “Add payslip” then save uploads below.</p>
              )}
            </div>

            <Button disabled={saving || Object.keys(pendingFiles).length === 0} onClick={() => void handleSaveDocumentsOnly()}>
              Save finance uploads
            </Button>
          </div>
        )}

        {tab === "schedule" && isContractor && scheduleTabContent}

        {tab === "schedule" && !isContractor && (
          <p className="text-sm text-text-tertiary">Schedule is only available for contractors.</p>
        )}

        {tab === "finance" && isContractor && (
          <div className="space-y-6">
            {financePayrollMeta}
            {financePaymentSetup}
            <div className={workforceSectionFormClass}>
              <WorkforceSectionTitle subtitle="Auto-generated SB-INT drafts from service fee + commission">
                Linked self-bills
              </WorkforceSectionTitle>
              <div className="flex items-center justify-end -mt-2 mb-2">
                <Link
                  href="/finance/billing/selfbill"
                  className={cn(
                    "inline-flex h-8 px-3 text-xs font-semibold rounded-lg items-center gap-1",
                    "bg-card text-text-primary border border-border hover:bg-surface-tertiary hover:border-border shadow-sm",
                  )}
                >
                  Self-billing <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              {loadingBills ? (
                <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
              ) : internalBills.length === 0 ? (
                <p className="text-sm text-text-tertiary">No internal bills yet.</p>
              ) : (
                <ul className="space-y-2">
                  {internalBills.map((sb) => {
                    const bd = sb.payout_breakdown;
                    const period =
                      sb.week_start && sb.week_end
                        ? `${formatDate(sb.week_start)} – ${formatDate(sb.week_end)}`
                        : (sb.week_label ?? sb.period ?? "—");
                    const payLabel = sb.due_date ? `Pay · ${formatDate(sb.due_date)}` : null;
                    const daysLabel =
                      bd?.payable_days != null
                        ? `${bd.payable_days} day${bd.payable_days === 1 ? "" : "s"}`
                        : null;
                    const amountLabel =
                      bd != null
                        ? `${formatCurrency(Number(bd.fixed_pay ?? 0))} ${WORKFORCE_CONTRACTOR_FEE_LABEL.toLowerCase()} + ${formatCurrency(Number(bd.commission_amount ?? 0))} commission`
                        : null;
                    const subtitle = [period, payLabel, daysLabel, amountLabel, sb.status.replace(/_/g, " ")]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li
                        key={sb.id}
                        className="rounded-xl border border-border-light bg-card px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 shadow-sm"
                      >
                        <div>
                          <p className="text-sm font-medium">{sb.reference}</p>
                          <p className="text-xs text-text-tertiary">{subtitle}</p>
                        </div>
                        <p className="text-sm font-semibold text-emerald-600">{formatCurrency(Number(sb.net_payout))}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "finance" && !isEmployee && !isContractor && (
          <p className="text-sm text-text-tertiary">Set employment type on the Payroll page to unlock finance tools.</p>
        )}

        {tab === "access" && (
          <WorkforceAccessTab person={person} onSaved={onSaved} />
        )}
      </div>

      {/* Offboard confirmation modal */}
      <Modal
        open={offboardOpen}
        onClose={() => !saving && setOffboardOpen(false)}
        title={`Offboard ${person?.payee_name ?? "this person"}?`}
        subtitle={
          isContractor
            ? "Revokes dashboard access, zeroes the service fee, and removes them from Pay Run / Payroll."
            : "Revokes dashboard access, zeroes the salary, and removes them from Pay Run / Payroll."
        }
        size="sm"
      >
        <div className="p-6 space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 p-3 space-y-1 text-xs text-text-secondary">
            <p className="font-semibold text-amber-700 dark:text-amber-400">This will:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Deactivate their dashboard login (if any) — cannot sign in anymore</li>
              <li>
                {isContractor
                  ? "Zero out their service fee"
                  : "Zero out their salary / recurring pay"}
              </li>
              <li>Remove them from Pay Run and Payroll going forward</li>
              <li>Hide them from the active Workforce roster</li>
              <li>Preserve history (jobs, quotes, audit logs)</li>
            </ul>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Reason (optional)
            </label>
            <Input
              value={offboardReason}
              onChange={(e) => setOffboardReason(e.target.value)}
              placeholder="e.g. End of contract"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setOffboardOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleOffboardConfirm()}
              disabled={saving}
              icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
            >
              {saving ? "Offboarding..." : "Offboard"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove (soft delete) confirmation modal */}
      <Modal
        open={deleteOpen}
        onClose={() => !saving && setDeleteOpen(false)}
        title={`Remove ${person?.payee_name ?? "this person"}?`}
        subtitle="Soft-deletes the payroll record and deactivates any linked dashboard access."
        size="sm"
      >
        <div className="p-6 space-y-4">
          <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/40 p-3 text-xs text-text-secondary">
            <p className="font-semibold text-red-700 dark:text-red-400 mb-1">Destructive action</p>
            <p>
              This hides the person from every list in Workforce. The linked dashboard login is deactivated. History (jobs, quotes, audit logs) is preserved and can still be queried by reference.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleDeleteConfirm()}
              disabled={saving}
              icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            >
              {saving ? "Removing..." : "Remove person"}
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}
