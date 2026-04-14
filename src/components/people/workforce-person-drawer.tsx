"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
} from "@/types/database";
import {
  PAYROLL_FREQUENCY_OPTIONS,
  PAYROLL_COST_CATEGORIES,
  PAYROLL_UPLOAD_LABELS,
  PROFILE_PHOTO_DOC_KEY,
  payrollUploadKeysForRow,
  type PayrollDocumentFileMeta,
} from "@/lib/payroll-doc-checklist";
import {
  buildPayLineDescription,
  parsePayLineDescription,
  WORKFORCE_DEPARTMENT_SELECT_OPTIONS,
} from "@/lib/workforce-departments";
import { uploadPayrollDocumentFile, getPayrollDocumentSignedUrl } from "@/services/payroll-documents-storage";
import { getSupabase } from "@/services/base";
import {
  createInternalSelfBill,
  listInternalSelfBillsForCost,
  type InternalSelfBillLine,
} from "@/services/internal-self-bills";
import { WorkforceAccessTab } from "./workforce-access-tab";
import {
  FileText,
  Wallet,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Download,
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
  };
}

const INTERNAL_STATUSES: InternalCostStatus[] = ["pending", "paid"];

const lifecycleLabel: Record<string, string> = {
  onboarding: "Onboarding",
  active: "Active",
  needs_attention: "Needs attention",
  offboard: "Offboard",
};

type TabId = "overview" | "documents" | "finance" | "access";

export function WorkforcePersonDrawer({
  person,
  bus,
  open,
  onClose,
  onSaved,
}: {
  person: InternalCost | null;
  bus: BusinessUnit[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
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

  const [internalBills, setInternalBills] = useState<SelfBill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [billBase, setBillBase] = useState("");
  const [billLines, setBillLines] = useState<InternalSelfBillLine[]>([]);
  const [creatingBill, setCreatingBill] = useState(false);
  const payslipFileRef = useRef<HTMLInputElement>(null);
  const payslipKeyRef = useRef<string | null>(null);

  const employmentType = person?.employment_type as PayrollInternalEmploymentType | null | undefined;
  const isEmployee = employmentType === "employee";
  const isContractor = employmentType === "self_employed";

  const requiredDocKeys = useMemo(
    () => [...payrollUploadKeysForRow(employmentType ?? null, person?.has_equity ?? false)],
    [employmentType, person?.has_equity],
  );

  const syncFromPerson = useCallback(async () => {
    if (!person) return;
    setTab("overview");
    setPendingFiles({});
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
    setPaymentDay(person.payment_day_of_month != null ? String(person.payment_day_of_month) : "");
    setStatus(person.status === "paid" ? "paid" : "pending");
    setProfile(parsePayrollProfile(person.payroll_profile));
    setBuId(person.bu_id ?? "");
    const files = parsePayrollDocumentFiles(person.payroll_document_files);
    const photoMeta = files[PROFILE_PHOTO_DOC_KEY];
    if (photoMeta?.path) {
      try {
        const u = await getPayrollDocumentSignedUrl(photoMeta.path);
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

  useEffect(() => {
    if (open && person && isContractor && tab === "finance") void loadBills();
  }, [open, person, isContractor, tab, loadBills]);

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
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      const baseFiles = parsePayrollDocumentFiles(person.payroll_document_files);
      const mergedFiles = await mergeUploads(person.id, baseFiles);
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
      };
      const updates: Record<string, unknown> = {
        description: desc,
        amount: amt,
        category: category.trim() || null,
        due_date: dueDate.trim() || null,
        payee_name: payeeName.trim() || null,
        pay_frequency: payFrequency.trim() || null,
        payment_day_of_month: paymentDay.trim() ? Number(paymentDay) : null,
        bu_id: buId.trim() || null,
        payroll_profile,
        payroll_document_files: mergedFiles,
        updated_at: now,
        status,
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
      toast.success("Saved");
      setPendingFiles({});
      onSaved();
      void syncFromPerson();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDocPick = (docKey: string, file: File | null) => {
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
      // Soft delete via deleted_at (consistent with softDeleteById pattern)
      const { error } = await getSupabase()
        .from("payroll_internal_costs")
        .update({
          deleted_at: now,
          lifecycle_stage: "offboard",
          updated_at: now,
        })
        .eq("id", person.id);
      if (error) throw error;

      // Deactivate linked profile
      if (person.profile_id) {
        try {
          await fetch(`/api/admin/team/user/${person.profile_id}`, { method: "DELETE" });
        } catch {
          /* best effort */
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

  const addBillLine = () => {
    setBillLines((prev) => [...prev, { kind: "deduction", label: "", amount: 0 }]);
  };

  const handleCreateInternalBill = async () => {
    if (!person || !isContractor) return;
    const base = Number(billBase);
    if (Number.isNaN(base) || base <= 0) {
      toast.error("Enter a positive gross amount for this period");
      return;
    }
    for (const line of billLines) {
      if (!line.label.trim()) {
        toast.error("Each line needs a label");
        return;
      }
      if (!Number(line.amount) || Number(line.amount) <= 0) {
        toast.error("Each line needs a positive amount");
        return;
      }
    }
    setCreatingBill(true);
    try {
      await createInternalSelfBill({
        internalCost: {
          id: person.id,
          payee_name: person.payee_name,
          pay_frequency: person.pay_frequency ?? undefined,
        },
        baseAmount: base,
        lines: billLines,
      });
      toast.success("Internal self-bill created — review under Finance → Self-billing");
      setBillBase("");
      setBillLines([]);
      void loadBills();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create self-bill");
    } finally {
      setCreatingBill(false);
    }
  };

  if (!person) {
    return (
      <Drawer open={false} onClose={onClose}>
        <div />
      </Drawer>
    );
  }

  const drawerTabs = [
    { id: "overview" as const, label: "Profile" },
    { id: "documents" as const, label: "Documents" },
    { id: "finance" as const, label: "Finance" },
    { id: "access" as const, label: "Dashboard Access" },
  ];

  const stage = person.lifecycle_stage ?? "active";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={payeeName || person.payee_name || "Person"}
      subtitle={isEmployee ? "Internal team (employee)" : isContractor ? "Internal contractor" : "Workforce"}
      width="w-[min(100vw-1rem,560px)]"
    >
      <div className="px-6 pt-2 pb-4 border-b border-border-light flex flex-wrap items-center gap-2">
        <Badge variant={stage === "active" ? "success" : stage === "onboarding" ? "info" : "default"} size="sm">
          {lifecycleLabel[stage] ?? stage}
        </Badge>
        {person.pay_frequency && (
          <span className="text-xs text-text-tertiary">
            Pay {PAYROLL_FREQUENCY_OPTIONS.find((o) => o.value === person.pay_frequency)?.label ?? person.pay_frequency}
            {person.due_date ? ` · next due ${formatDate(person.due_date)}` : ""}
          </span>
        )}
      </div>

      <div className="px-6 pt-3 pb-0 border-b border-border-light">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={(id) => setTab(id as TabId)} />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="flex flex-col items-center gap-2">
                <Avatar name={payeeName || "?"} size="xl" src={photoUrl ?? undefined} />
                <label className="text-xs text-text-secondary cursor-pointer text-center max-w-[140px]">
                  <span className="text-primary font-medium">Change photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleDocPick(PROFILE_PHOTO_DOC_KEY, f);
                    }}
                  />
                  <span className="block text-[10px] text-text-tertiary mt-1 leading-snug">
                    Saved with <strong className="font-medium text-text-secondary">Save profile</strong> below
                  </span>
                </label>
              </div>
              <div className="flex-1 space-y-3 w-full min-w-0">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Display name</label>
                  <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Full name" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Work email</label>
                  <Input
                    type="email"
                    value={profile.email ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                    placeholder="name@company.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
                  <Input
                    value={profile.phone ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Role / position</label>
                  <Input
                    value={profile.position ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, position: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Address</label>
                  <Input
                    value={profile.address ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-sm font-semibold text-text-primary">Payroll & payment</p>
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
                  <label className="block text-xs font-medium text-text-secondary mb-1">Amount (GBP)</label>
                  <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div>
                  <Select
                    label="Category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    options={[{ value: "", label: "—" }, ...PAYROLL_COST_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Next due date</label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div>
                  <Select
                    label="Pay frequency"
                    value={payFrequency}
                    onChange={(e) => setPayFrequency(e.target.value)}
                    options={[{ value: "", label: "—" }, ...PAYROLL_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Pay day of month (1–28)</label>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={paymentDay}
                    onChange={(e) => setPaymentDay(e.target.value)}
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

            {(isEmployee || isContractor) && (
              <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
                <p className="text-sm font-semibold text-text-primary">Tax & identifiers</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">NI number</label>
                    <Input
                      value={profile.ni_number ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, ni_number: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Tax code</label>
                    <Input
                      value={profile.tax_code ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, tax_code: e.target.value }))}
                    />
                  </div>
                  {isContractor && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">UTR</label>
                        <Input
                          value={profile.utr ?? ""}
                          onChange={(e) => setProfile((p) => ({ ...p, utr: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">VAT number</label>
                        <Input
                          value={profile.vat_number ?? ""}
                          onChange={(e) => setProfile((p) => ({ ...p, vat_number: e.target.value }))}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button className="w-full sm:w-auto" disabled={saving} onClick={() => void handleSaveOverview()}>
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
            <p className="text-sm text-text-secondary">
              Required compliance documents. Same storage as Payroll — upload PDF or images.
            </p>
            <ul className="space-y-3">
              {requiredDocKeys.map((key) => {
                const files = parsePayrollDocumentFiles(person.payroll_document_files);
                const has = !!files[key]?.path || !!pendingFiles[key];
                return (
                  <li
                    key={key}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between rounded-xl border border-border-light p-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                      <span className="text-sm font-medium text-text-primary truncate">
                        {PAYROLL_UPLOAD_LABELS[key] ?? key}
                      </span>
                      <Badge variant={has ? "success" : "warning"} size="sm">
                        {has ? "File" : "Missing"}
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
        )}

        {tab === "finance" && isEmployee && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
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

            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
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
                    <li key={k} className="flex items-center justify-between text-sm border border-border-light rounded-lg px-3 py-2">
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

        {tab === "finance" && isContractor && (
          <div className="space-y-6">
            <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3">
              <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                New internal self-bill
              </p>
              <p className="text-xs text-text-secondary">
                Gross for the period, then add deductions (tax, pension) or extras (bonus). Net = gross + extras − deductions.
                Creates a row in Self-billing tagged Internal.
              </p>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Gross (base) £</label>
                <Input type="number" min={0} step="0.01" value={billBase} onChange={(e) => setBillBase(e.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Lines</span>
                  <Button type="button" size="sm" variant="outline" onClick={addBillLine} icon={<Plus className="h-3.5 w-3.5" />}>
                    Add line
                  </Button>
                </div>
                {billLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-lg border border-border-light p-2">
                    <div className="sm:col-span-3">
                      <Select
                        label={idx === 0 ? "Type" : undefined}
                        value={line.kind}
                        onChange={(e) => {
                          const kind = e.target.value as InternalSelfBillLine["kind"];
                          setBillLines((rows) => rows.map((r, i) => (i === idx ? { ...r, kind } : r)));
                        }}
                        options={[
                          { value: "deduction", label: "Deduction" },
                          { value: "extra", label: "Extra" },
                        ]}
                      />
                    </div>
                    <div className="sm:col-span-6">
                      <Input
                        placeholder="Label"
                        value={line.label}
                        onChange={(e) =>
                          setBillLines((rows) => rows.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="£"
                        value={line.amount || ""}
                        onChange={(e) =>
                          setBillLines((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, amount: Number(e.target.value) || 0 } : r)),
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Remove line"
                        onClick={() => setBillLines((rows) => rows.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button disabled={creatingBill} onClick={() => void handleCreateInternalBill()}>
                {creatingBill ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate & create self-bill"}
              </Button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-text-primary">Linked internal self-bills</p>
                <Link
                  href="/finance/selfbill"
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
                  {internalBills.map((sb) => (
                    <li
                      key={sb.id}
                      className="rounded-xl border border-border-light px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                    >
                      <div>
                        <p className="text-sm font-medium">{sb.reference}</p>
                        <p className="text-xs text-text-tertiary">
                          {sb.week_label ?? sb.period} · {sb.status.replace(/_/g, " ")}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-emerald-600">{formatCurrency(Number(sb.net_payout))}</p>
                    </li>
                  ))}
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
        subtitle="Revokes dashboard access, zeroes the salary, and removes them from Pay Run / Payroll."
        size="sm"
      >
        <div className="p-6 space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 p-3 space-y-1 text-xs text-text-secondary">
            <p className="font-semibold text-amber-700 dark:text-amber-400">This will:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Deactivate their dashboard login (if any) — cannot sign in anymore</li>
              <li>Zero out their salary / recurring fee</li>
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
