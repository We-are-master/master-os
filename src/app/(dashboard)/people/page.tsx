"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CountrySelect } from "@/components/ui/country-select";
import { motion } from "framer-motion";
import { fadeInUp, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Plus, Loader2, Users, HardHat } from "lucide-react";
import { activateWorkforcePerson } from "@/lib/workforce-lifecycle";
import { toast } from "sonner";
import type { InternalCost, InternalCostStatus, PayrollInternalEmploymentType, BusinessUnit, WorkforceCommissionBasis, WorkforcePaymentMethod } from "@/types/database";
import { getSupabase } from "@/services/base";
import { listBusinessUnits, createBusinessUnit, updateBusinessUnit, deleteBusinessUnit } from "@/services/teams";
import { BuModal } from "@/components/teams/bu-modal";
import {
  PAYROLL_FREQUENCY_OPTIONS,
  PROFILE_PHOTO_DOC_KEY,
  payrollDocsRowCompletion,
  type PayrollDocumentFileMeta,
} from "@/lib/payroll-doc-checklist";
import { getPayrollDocumentSignedUrls } from "@/services/payroll-documents-storage";
import { WorkforcePersonDrawer } from "@/components/people/workforce-person-drawer";
import {
  WorkforceAddCard,
  WorkforceAddListRow,
  WorkforceBuStrip,
  WorkforceKpiGrid,
  WorkforcePersonCard,
  WorkforcePersonListRow,
  WorkforceStagePills,
  WorkforceTypeSegment,
  WorkforceViewToggle,
  type WorkforceDrawerTab,
  type WorkforcePeopleTab,
} from "@/components/people/workforce-ui";
import { buildPayLineDescription, WORKFORCE_DEPARTMENT_SELECT_OPTIONS } from "@/lib/workforce-departments";
import { insertPayrollInternalCostWithCompat } from "@/lib/payroll-internal-insert-compat";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import {
  requestWorkforceOnboardingLink,
  WORKFORCE_COMMISSION_BASIS_OPTIONS,
  WORKFORCE_PAYMENT_METHOD_OPTIONS,
} from "@/lib/workforce-payment-options";
import {
  computeWorkforceNextDueDate,
  WORKFORCE_MONTHLY_PAY_DAY,
} from "@/lib/workforce-pay-schedule";
import {
  applyContractorTaxNumberToProfile,
  contractorInviteFiscalComplete,
  isUkWorkCountry,
} from "@/lib/workforce-contractor-agreement";

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

const WORKFORCE_VIEW_STORAGE_KEY = "workforce-view-mode";

type WorkforceDisplayMode = "grid" | "list";

/** Payroll row + joined BU name for cards */
export type PeopleRow = InternalCost & { bu_name?: string | null };

function mapCostRows(
  data: unknown,
): PeopleRow[] {
  const list = (data ?? []) as (InternalCost & { business_units?: { name: string } | null })[];
  return list.map((r) => {
    const { business_units, ...rest } = r;
    return { ...rest, bu_name: business_units?.name ?? null };
  });
}

export default function PeoplePage() {
  const { workforceDocumentRules } = useFrontendSetup();
  const [section, setSection] = useState<WorkforcePeopleTab>("all");
  const [displayMode, setDisplayMode] = useState<WorkforceDisplayMode>("grid");
  const [stageFilter, setStageFilter] = useState<"all" | "onboarding" | "active" | "offboard">("active");
  const [rows, setRows] = useState<PeopleRow[]>([]);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [buFilter, setBuFilter] = useState<string>("all");
  const [selected, setSelected] = useState<PeopleRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitialTab, setDrawerInitialTab] = useState<WorkforceDrawerTab>("overview");

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formPayee, setFormPayee] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formRoleTitle, setFormRoleTitle] = useState("");
  const [formOtherDesc, setFormOtherDesc] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState("Salary");
  const [formFreq, setFormFreq] = useState<"" | "weekly" | "biweekly" | "monthly">("monthly");
  const [formEmployment, setFormEmployment] = useState<PayrollInternalEmploymentType>("employee");
  const [formBuId, setFormBuId] = useState("");
  const [formPaymentMethod, setFormPaymentMethod] = useState<WorkforcePaymentMethod | "">("bank_transfer");
  const [formCommissionEnabled, setFormCommissionEnabled] = useState(false);
  const [formCommissionRate, setFormCommissionRate] = useState("");
  const [formCommissionBasis, setFormCommissionBasis] = useState<WorkforceCommissionBasis>("gross_profit");
  const [formStartDate, setFormStartDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [formCreateAccess, setFormCreateAccess] = useState(false);
  const [formAccessEmail, setFormAccessEmail] = useState("");
  const [formAccessRole, setFormAccessRole] = useState<"admin" | "manager" | "operator">("operator");
  const [formAccessPassword, setFormAccessPassword] = useState("");
  const [formContractorEntity, setFormContractorEntity] = useState<"individual" | "company">("individual");
  const [formContractorCountry, setFormContractorCountry] = useState("");
  const [formContractorTaxNumber, setFormContractorTaxNumber] = useState("");
  const [formContractorAddress, setFormContractorAddress] = useState("");

  const [buModalOpen, setBuModalOpen] = useState(false);
  const [editingBu, setEditingBu] = useState<BusinessUnit | null>(null);
  const [buSaving, setBuSaving] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [onboardingCopyBusyId, setOnboardingCopyBusyId] = useState<string | null>(null);
  const [onboardingSendBusyId, setOnboardingSendBusyId] = useState<string | null>(null);

  const resetInviteForm = () => {
    setFormPayee("");
    setFormEmail("");
    setFormDept("");
    setFormRoleTitle("");
    setFormOtherDesc("");
    setFormAmount("");
    setFormCategory("Salary");
    setFormFreq("monthly");
    setFormBuId("");
    setFormPaymentMethod("bank_transfer");
    setFormCommissionEnabled(false);
    setFormCommissionRate("");
    setFormCommissionBasis("gross_profit");
    setFormStartDate(format(new Date(), "yyyy-MM-dd"));
    setFormCreateAccess(false);
    setFormAccessEmail("");
    setFormAccessPassword("");
    setFormAccessRole("operator");
    setFormContractorEntity("individual");
    setFormContractorCountry("");
    setFormContractorTaxNumber("");
    setFormContractorAddress("");
  };

  const rowWorkEmail = (row: PeopleRow) => {
    const p = row.payroll_profile;
    if (!p || typeof p !== "object" || !("email" in p)) return "";
    return String((p as { email?: string }).email ?? "").trim();
  };

  const handleCopyOnboardingLink = async (row: PeopleRow) => {
    if (!rowWorkEmail(row)) {
      toast.error("Add work email on Profile first");
      openPerson(row, "overview");
      return;
    }
    setOnboardingCopyBusyId(row.id);
    try {
      const { onboardingUrl, warning } = await requestWorkforceOnboardingLink(row.id, { sendEmail: false });
      await navigator.clipboard.writeText(onboardingUrl);
      toast.success("Onboarding link copied");
      if (warning) toast.warning(warning);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate link");
    } finally {
      setOnboardingCopyBusyId(null);
    }
  };

  const handleSendOnboardingLink = async (row: PeopleRow) => {
    const email = rowWorkEmail(row);
    if (!email) {
      toast.error("Add work email on Profile first");
      openPerson(row, "overview");
      return;
    }
    if (!row.payment_method?.trim()) {
      toast.error("Set payment method in Finance before sending");
      openPerson(row, "finance");
      return;
    }
    setOnboardingSendBusyId(row.id);
    try {
      const { sentTo, warning } = await requestWorkforceOnboardingLink(row.id, { sendEmail: true });
      toast.success(`Onboarding link sent to ${sentTo ?? email}`);
      if (warning) toast.warning(warning);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send link");
    } finally {
      setOnboardingSendBusyId(null);
    }
  };

  const handleActivatePerson = async (row: PeopleRow) => {
    setActivatingId(row.id);
    try {
      await activateWorkforcePerson(row.id);
      toast.success(`${row.payee_name ?? "Person"} activated`);
      await load();
      if (selected?.id === row.id) {
        const { data } = await getSupabase()
          .from("payroll_internal_costs")
          .select("*, business_units(name)")
          .eq("id", row.id)
          .maybeSingle();
        if (data) setSelected(mapCostRows([data])[0] ?? null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to activate");
    } finally {
      setActivatingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [sq, costsRes] = await Promise.all([
        listBusinessUnits(),
        supabase
          .from("payroll_internal_costs")
          .select("*, business_units(name)")
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
      ]);
      setBus(sq);
      if (costsRes.error) {
        const { data: fallback, error: fbErr } = await supabase
          .from("payroll_internal_costs")
          .select("*")
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });
        if (fbErr) throw fbErr;
        setRows((fallback ?? []) as PeopleRow[]);
      } else {
        setRows(mapCostRows(costsRes.data));
      }
    } catch {
      toast.error("Could not load people.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(WORKFORCE_VIEW_STORAGE_KEY);
      if (v === "grid" || v === "list") setDisplayMode(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WORKFORCE_VIEW_STORAGE_KEY, displayMode);
    } catch {
      /* ignore */
    }
  }, [displayMode]);

  const filtered = useMemo(() => {
    let list =
      section === "all"
        ? rows
        : rows.filter(
            (r) =>
              r.employment_type === (section === "internal" ? "employee" : "self_employed"),
          );
    if (buFilter === "unassigned") {
      list = list.filter((r) => !r.bu_id);
    } else if (buFilter !== "all") {
      list = list.filter((r) => r.bu_id === buFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const name = (r.payee_name ?? "").toLowerCase();
        const desc = (r.description ?? "").toLowerCase();
        const sq = (r.bu_name ?? "").toLowerCase();
        return name.includes(q) || desc.includes(q) || sq.includes(q);
      });
    }
    if (stageFilter === "all") {
      list = list.filter((r) => (r.lifecycle_stage ?? "active") !== "offboard");
    } else if (stageFilter === "active") {
      list = list.filter((r) => {
        const stage = r.lifecycle_stage ?? "active";
        return stage === "active" || stage === "needs_attention";
      });
    } else {
      list = list.filter((r) => (r.lifecycle_stage ?? "active") === stageFilter);
    }
    return list;
  }, [rows, section, search, buFilter, stageFilter]);

  const rosterCounts = useMemo(() => {
    const base = rows.filter((r) => (r.lifecycle_stage ?? "active") !== "offboard");
    return {
      all: base.length,
      internal: base.filter((r) => r.employment_type === "employee").length,
      contractors: base.filter((r) => r.employment_type === "self_employed").length,
    };
  }, [rows]);

  const inviteEmploymentType = (tab: WorkforcePeopleTab): PayrollInternalEmploymentType =>
    tab === "contractors" ? "self_employed" : "employee";

  const inviteLabel =
    section === "internal"
      ? "Invite employee"
      : section === "contractors"
        ? "Invite contractor"
        : "Invite team";

  const rosterRows = useMemo(
    () => rows.filter((r) => (r.lifecycle_stage ?? "active") !== "offboard"),
    [rows],
  );

  const workforceKpis = useMemo(() => {
    const active = rosterRows.filter((r) => {
      const stage = r.lifecycle_stage ?? "active";
      return stage === "active" || stage === "needs_attention";
    }).length;
    const onboarding = rosterRows.filter((r) => (r.lifecycle_stage ?? "active") === "onboarding").length;
    const payrollPeople = rosterRows.filter((r) => Number(r.amount ?? 0) > 0);
    const monthlyPayroll = payrollPeople.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    let docsOutstanding = 0;
    for (const r of rosterRows) {
      const files = parsePayrollDocumentFiles(r.payroll_document_files);
      const { done, total } = payrollDocsRowCompletion(
        r.employment_type ?? null,
        files,
        r.documents_on_file ?? null,
        r.has_equity ?? false,
        workforceDocumentRules,
      );
      docsOutstanding += Math.max(0, total - done);
    }

    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");
    const dueThisMonth = rosterRows.filter((r) => {
      const due = r.due_date?.slice(0, 10);
      return !!due && due >= monthStart && due <= monthEnd;
    });
    const dueThisMonthTotal = dueThisMonth.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    return {
      headcount: rosterRows.length,
      active,
      onboarding,
      monthlyPayroll,
      payrollPeople: payrollPeople.length,
      docsOutstanding,
      dueThisMonthCount: dueThisMonth.length,
      dueThisMonthTotal,
    };
  }, [rosterRows, workforceDocumentRules]);

  const selfBillSyncRef = useRef(false);
  useEffect(() => {
    if (selfBillSyncRef.current) return;
    selfBillSyncRef.current = true;
    void fetch("/api/workforce/sync-self-bills", { method: "POST" }).catch(() => {});
  }, []);

  const photoPathsKey = useMemo(
    () =>
      filtered
        .map((r) => {
          const f = parsePayrollDocumentFiles(r.payroll_document_files);
          const p = f[PROFILE_PHOTO_DOC_KEY]?.path ?? "";
          return `${r.id}:${p}`;
        })
        .sort()
        .join("|"),
    [filtered],
  );

  const [photoUrlsById, setPhotoUrlsById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Build path→id map + collect paths for a SINGLE batch request
      const pathToIds: Record<string, string[]> = {};
      for (const r of filtered) {
        const f = parsePayrollDocumentFiles(r.payroll_document_files);
        const p = f[PROFILE_PHOTO_DOC_KEY]?.path;
        if (!p) continue;
        (pathToIds[p] ??= []).push(r.id);
      }
      const paths = Object.keys(pathToIds);
      if (paths.length === 0) {
        if (!cancelled) setPhotoUrlsById({});
        return;
      }
      try {
        // Thumbnail transform: 144×144 cover fits the largest Avatar (xl)
        // while cutting payload from ~2–5 MB to ~15–30 KB per photo.
        const urls = await getPayrollDocumentSignedUrls(paths, 3600, {
          width: 144,
          height: 144,
          resize: "cover",
        });
        if (cancelled) return;
        const out: Record<string, string> = {};
        for (const [p, ids] of Object.entries(pathToIds)) {
          const u = urls[p];
          if (!u) continue;
          for (const id of ids) out[id] = u;
        }
        setPhotoUrlsById(out);
      } catch {
        /* bucket / RLS — cards fall back to initials */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoPathsKey, filtered]);

  const openPerson = (r: PeopleRow, tab: WorkforceDrawerTab = "overview") => {
    setSelected(r);
    setDrawerInitialTab(tab);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelected(null);
  };

  const handleDrawerSaved = useCallback(async () => {
    const id = selected?.id;
    await load();
    if (!id) return;
    const supabase = getSupabase();
    const { data, error } = await supabase.from("payroll_internal_costs").select("*, business_units(name)").eq("id", id).maybeSingle();
    if (error) {
      const { data: fb } = await supabase.from("payroll_internal_costs").select("*").eq("id", id).maybeSingle();
      if (fb) setSelected(fb as PeopleRow);
      return;
    }
    if (data) setSelected(mapCostRows([data])[0] ?? null);
  }, [load, selected?.id]);

  const handleInviteTeam = async () => {
    const desc = buildPayLineDescription(formDept, formRoleTitle, formOtherDesc);
    const email = formEmail.trim().toLowerCase();
    if (!formPayee.trim() || !desc.trim()) {
      toast.error(
        formEmployment === "self_employed"
          ? "Company/display name and department are required"
          : "Name and department are required",
      );
      return;
    }
    if (formEmployment === "self_employed") {
      const inviteProfile = applyContractorTaxNumberToProfile(
        {
          country_of_operation: formContractorCountry,
          contractor_entity_type: formContractorEntity,
          address: formContractorAddress,
        },
        formContractorTaxNumber,
      );
      if (!contractorInviteFiscalComplete(inviteProfile)) {
        toast.error("Enter country and tax/registration number for the contractor");
        return;
      }
    }
    if (!email.includes("@")) {
      toast.error("Enter a valid email for the onboarding invite");
      return;
    }
    if (formDept === "Other" && !formOtherDesc.trim()) {
      toast.error("Enter a description when department is Other");
      return;
    }
    if (!formPaymentMethod) {
      toast.error("Select a payment method");
      return;
    }
    const amt = formAmount.trim() === "" ? 0 : Number(formAmount);
    if (Number.isNaN(amt) || amt < 0) {
      toast.error("Enter a valid fixed payment amount (0 if commission-only)");
      return;
    }
    if (!formCommissionEnabled && amt <= 0) {
      toast.error("Enter fixed payment or enable commission");
      return;
    }
    if (formCommissionEnabled) {
      const rate = Number(formCommissionRate);
      if (!formCommissionRate.trim() || Number.isNaN(rate) || rate <= 0 || rate > 100) {
        toast.error("Commission rate must be between 0 and 100");
        return;
      }
    }
    const shouldCreateAccess = formEmployment === "employee" || formCreateAccess;
    if (shouldCreateAccess) {
      const accessEmail = formAccessEmail.trim().toLowerCase() || email;
      if (!accessEmail.includes("@")) {
        toast.error("Enter a valid email for dashboard access");
        return;
      }
      if (formAccessPassword.length < 8) {
        toast.error("Temporary password must be at least 8 characters");
        return;
      }
    }
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      const startDate = formStartDate.trim().slice(0, 10) || format(new Date(), "yyyy-MM-dd");
      const isContractorInvite = formEmployment === "self_employed";
      const payrollProfile: Record<string, string> = { email, start_date: startDate };
      if (isContractorInvite) {
        const inviteProfile = applyContractorTaxNumberToProfile(
          {
            country_of_operation: formContractorCountry.trim(),
            contractor_entity_type: formContractorEntity,
            address: formContractorAddress.trim() || undefined,
          },
          formContractorTaxNumber,
        );
        Object.assign(payrollProfile, inviteProfile);
      }
      const row = {
        description: desc.trim(),
        amount: amt,
        category: formCategory.trim() || (formEmployment === "employee" ? "Salary" : "Contractor"),
        due_date: computeWorkforceNextDueDate(WORKFORCE_MONTHLY_PAY_DAY, new Date(startDate)),
        payee_name: formPayee.trim(),
        employment_type: formEmployment,
        pay_frequency: formFreq || "monthly",
        payment_day_of_month: WORKFORCE_MONTHLY_PAY_DAY,
        payroll_document_files: {} as Record<string, PayrollDocumentFileMeta>,
        status: "pending" as InternalCostStatus,
        paid_at: null as string | null,
        lifecycle_stage: isContractorInvite ? ("onboarding" as const) : ("active" as const),
        recurring_approved_at: isContractorInvite ? null : now,
        has_equity: false,
        equity_percent: null as number | null,
        equity_vesting_notes: null as string | null,
        equity_start_date: null as string | null,
        payroll_profile: payrollProfile,
        payment_method: formPaymentMethod,
        commission_enabled: formCommissionEnabled,
        commission_rate_percent: formCommissionEnabled && formCommissionRate.trim() ? Number(formCommissionRate) : null,
        commission_basis: formCommissionEnabled ? formCommissionBasis : null,
        bu_id: formBuId.trim() || null,
        created_at: now,
        updated_at: now,
      };
      const { data: inserted, error: insErr, compatLevel } = await insertPayrollInternalCostWithCompat(
        supabase,
        row as Record<string, unknown>,
      );
      if (insErr) {
        throw new Error(insErr.message || "Insert failed");
      }
      if (compatLevel === 1) {
        toast.warning("Person created — apply migration 096 to enable business units.");
      } else if (compatLevel >= 2 && compatLevel <= 3) {
        toast.warning("Person created — DB missing lifecycle/profile columns; run migration 093 when you can.");
      } else if (compatLevel >= 4 && compatLevel <= 5) {
        toast.warning("Person created — DB missing pay_frequency / document files columns; run migration 092 when you can.");
      } else if (compatLevel >= 6) {
        toast.warning("Person created with minimal payroll row — apply migrations 092–096 to match the full Workforce model.");
      }
      if (!inserted) {
        throw new Error("Insert failed");
      }
      const insertedId = (inserted as InternalCost).id;

      if (isContractorInvite) {
        toast.success("Contractor created — sending onboarding invite…");
        try {
          const { sentTo, warning } = await requestWorkforceOnboardingLink(insertedId, {
            sendEmail: true,
          });
          toast.success(`Onboarding invite sent to ${sentTo ?? email}`);
          if (warning) toast.warning(warning);
        } catch (err) {
          toast.warning(
            err instanceof Error
              ? `Person saved, but invite failed: ${err.message}`
              : "Person saved, but invite email failed",
          );
        }
      } else {
        toast.success("Employee added — active on payroll (no contractor onboarding).");
      }

      if (shouldCreateAccess && inserted) {
        const insertedId = (inserted as InternalCost).id;
        const accessEmail = formAccessEmail.trim().toLowerCase() || email;
        const accessPassword = formAccessPassword;
        const accessRole = formAccessRole;
        const accessName = formPayee.trim();
        try {
          if (!accessEmail.includes("@")) {
            throw new Error("Valid email is required for dashboard access");
          }
          if (accessPassword.length < 8) {
            throw new Error("Temporary password must be at least 8 characters");
          }
          const res = await fetch("/api/admin/team/create-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: accessEmail,
              full_name: accessName,
              role: accessRole,
              password: accessPassword,
              payroll_internal_cost_id: insertedId,
            }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            welcomeEmailSent?: boolean;
            welcomeEmailWarning?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? "Failed to create dashboard access");
          }
          if (body.welcomeEmailSent) {
            toast.success(`Dashboard access created — login invite sent to ${accessEmail}`);
          } else {
            toast.success("Dashboard access created");
          }
          if (body.welcomeEmailWarning) toast.warning(body.welcomeEmailWarning);
        } catch (err) {
          toast.warning(
            err instanceof Error
              ? `Person saved, but access failed: ${err.message}`
              : "Person saved, but access failed",
          );
        }
      }

      setAddOpen(false);
      resetInviteForm();
      await load();
      if (inserted) {
        const ic = inserted as InternalCost;
        const sn = ic.bu_id ? bus.find((s) => s.id === ic.bu_id)?.name ?? null : null;
        setSelected({ ...ic, bu_name: sn });
        setDrawerInitialTab("overview");
        setDrawerOpen(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setSaving(false);
    }
  };

  const buFilterOptions = useMemo(
    () => [
      { value: "all", label: "All BUs" },
      { value: "unassigned", label: "No BU" },
      ...bus.map((s) => ({ value: s.id, label: s.name })),
    ],
    [bus],
  );

  const openAddBu = () => {
    setEditingBu(null);
    setBuModalOpen(true);
  };

  const openEditBu = (s: BusinessUnit) => {
    setEditingBu(s);
    setBuModalOpen(true);
  };

  const handleSaveBu = async (name: string) => {
    setBuSaving(true);
    try {
      if (editingBu) {
        await updateBusinessUnit(editingBu.id, { name });
        toast.success("BU updated");
      } else {
        await createBusinessUnit(name);
        toast.success("BU created");
      }
      setBuModalOpen(false);
      setEditingBu(null);
      await load();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in (e as object)
            ? String((e as { message: unknown }).message)
            : "Failed to save BU";
      console.error("Save BU failed", e);
      toast.error(msg);
    } finally {
      setBuSaving(false);
    }
  };

  const handleDeleteBu = async (s: BusinessUnit) => {
    if (!confirm(`Remove BU “${s.name}”? People in this BU will become unassigned.`)) return;
    try {
      await deleteBusinessUnit(s.id);
      toast.success("BU removed");
      if (buFilter === s.id) setBuFilter("all");
      await load();
    } catch {
      toast.error("Failed to delete BU");
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          eyebrow="People · Internal team & contractors"
          title="Workforce"
          infoTooltip={"Working roster — internal employees and self-employed contractors. Open a card for profile photo, contact details, compliance documents, and pay.\n\nWorking lists everyone except offboard. Use Employees for PAYE staff and Contractors for self-billed. Finance → Payroll keeps commission runs and recurring bills."}
        >
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              const emp = inviteEmploymentType(section);
              setFormEmployment(emp);
              setFormCreateAccess(emp === "employee");
              setFormBuId(buFilter !== "all" && buFilter !== "unassigned" ? buFilter : "");
              setAddOpen(true);
            }}
          >
            Invite team
          </Button>
        </PageHeader>

        <WorkforceKpiGrid
          headcount={workforceKpis.headcount}
          active={workforceKpis.active}
          onboarding={workforceKpis.onboarding}
          monthlyPayroll={workforceKpis.monthlyPayroll}
          payrollPeople={workforceKpis.payrollPeople}
          docsOutstanding={workforceKpis.docsOutstanding}
          dueThisMonthCount={workforceKpis.dueThisMonthCount}
          dueThisMonthTotal={workforceKpis.dueThisMonthTotal}
        />

        {bus.length > 0 && (
          <WorkforceBuStrip
            bus={bus}
            buFilter={buFilter}
            onFilter={setBuFilter}
            onAdd={openAddBu}
            onEdit={openEditBu}
            onDelete={(s) => void handleDeleteBu(s)}
          />
        )}

        <div className="rounded-xl border border-border-light bg-card shadow-sm overflow-hidden">
          <div className="px-3 sm:px-4 pt-3 pb-2 border-b border-border-light flex flex-col gap-2">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <WorkforceTypeSegment
                value={section}
                counts={rosterCounts}
                onChange={(id) => {
                  setSection(id);
                  setStageFilter("active");
                }}
              />
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full lg:max-w-2xl">
                <WorkforceViewToggle mode={displayMode} onChange={setDisplayMode} />
                <Select
                  value={buFilter}
                  onChange={(e) => setBuFilter(e.target.value)}
                  options={buFilterOptions}
                  className="min-w-[160px] shrink-0 rounded-xl"
                />
                <SearchInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, role…"
                  className="flex-1 w-full min-w-0 rounded-xl"
                />
              </div>
            </div>
            <WorkforceStagePills value={stageFilter} onChange={setStageFilter} />
          </div>

          <div className="p-2 sm:p-3">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
              </div>
            ) : (
              <>
                {filtered.length === 0 && (
                  <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="text-center py-10 mb-4">
                    <div className="inline-flex items-center justify-center rounded-full bg-surface-hover p-3 mb-3">
                      {section === "contractors" ? (
                        <HardHat className="h-8 w-8 text-text-tertiary" />
                      ) : (
                        <Users className="h-8 w-8 text-text-tertiary" />
                      )}
                    </div>
                    <p className="text-text-secondary font-medium">
                      {search.trim() || buFilter !== "all" || stageFilter !== "all"
                        ? "No matches for your filters"
                        : section === "internal"
                          ? "No internal team members yet"
                          : section === "contractors"
                            ? "No contractors yet"
                            : "No people yet"}
                    </p>
                    {!search.trim() && buFilter === "all" && stageFilter === "all" && (
                      <p className="text-sm text-text-tertiary mt-2 max-w-md mx-auto">
                        {section === "internal"
                          ? "Add PAYE employees with salary lines. Upload passport, contract, and payroll setup from each person’s drawer."
                          : section === "contractors"
                            ? "Add self-employed people for internal contractor fees and self-bill workflow."
                            : "Invite employees and contractors — use the type filter or Employment type when inviting."}
                      </p>
                    )}
                  </motion.div>
                )}
                {displayMode === "list" ? (
                  <div className="rounded-xl border border-border-light overflow-hidden -mx-1 sm:mx-0">
                    <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(7.5rem,1fr)_auto] gap-2 border-b border-border-light bg-surface-hover/50 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
                      <span>
                        {section === "contractors" ? "Contractor" : section === "internal" ? "Employee" : "Person"}
                      </span>
                      <span>Status</span>
                      <span className="text-right">Schedule</span>
                      <span className="text-right">Actions</span>
                    </div>
                    {filtered.map((r, index) => {
                      const files = parsePayrollDocumentFiles(r.payroll_document_files);
                      const { done, total } = payrollDocsRowCompletion(
                        r.employment_type ?? null,
                        files,
                        r.documents_on_file ?? null,
                        r.has_equity ?? false,
                        workforceDocumentRules,
                      );
                      return (
                        <WorkforcePersonListRow
                          key={r.id}
                          rowIndex={index}
                          row={r}
                          photoUrl={photoUrlsById[r.id]}
                          employmentType={r.employment_type ?? "employee"}
                          docsDone={done}
                          docsTotal={total}
                          activating={activatingId === r.id}
                          onboardingCopyBusy={onboardingCopyBusyId === r.id}
                          onboardingSendBusy={onboardingSendBusyId === r.id}
                          onOpen={() => openPerson(r)}
                          onOpenDocuments={() => openPerson(r, "documents")}
                          onOpenFinance={() => openPerson(r, "finance")}
                          onActivate={() => void handleActivatePerson(r)}
                          onCopyOnboardingLink={() => void handleCopyOnboardingLink(r)}
                          onSendOnboardingLink={() => void handleSendOnboardingLink(r)}
                        />
                      );
                    })}
                    <WorkforceAddListRow
                      label={inviteLabel}
                      onClick={() => {
                        setFormEmployment(inviteEmploymentType(section));
                        setFormBuId(buFilter !== "all" && buFilter !== "unassigned" ? buFilter : "");
                        setAddOpen(true);
                      }}
                    />
                  </div>
                ) : (
                  <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {filtered.map((r) => {
                      const files = parsePayrollDocumentFiles(r.payroll_document_files);
                      const { done, total } = payrollDocsRowCompletion(
                        r.employment_type ?? null,
                        files,
                        r.documents_on_file ?? null,
                        r.has_equity ?? false,
                        workforceDocumentRules,
                      );
                      return (
                        <motion.div key={r.id} variants={staggerItem} className="min-w-0">
                          <WorkforcePersonCard
                            row={r}
                            photoUrl={photoUrlsById[r.id]}
                            employmentType={r.employment_type ?? "employee"}
                            docsDone={done}
                            docsTotal={total}
                            activating={activatingId === r.id}
                            onboardingCopyBusy={onboardingCopyBusyId === r.id}
                            onboardingSendBusy={onboardingSendBusyId === r.id}
                            onOpen={() => openPerson(r)}
                            onOpenDocuments={() => openPerson(r, "documents")}
                            onOpenFinance={() => openPerson(r, "finance")}
                            onActivate={() => void handleActivatePerson(r)}
                            onCopyOnboardingLink={() => void handleCopyOnboardingLink(r)}
                            onSendOnboardingLink={() => void handleSendOnboardingLink(r)}
                          />
                        </motion.div>
                      );
                    })}
                    <motion.div variants={staggerItem} className="min-w-0">
                      <WorkforceAddCard
                        label={inviteLabel}
                        onClick={() => {
                          setFormEmployment(inviteEmploymentType(section));
                          setFormBuId(buFilter !== "all" && buFilter !== "unassigned" ? buFilter : "");
                          setAddOpen(true);
                        }}
                      />
                    </motion.div>
                  </StaggerContainer>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <WorkforcePersonDrawer
        person={selected}
        bus={bus}
        open={drawerOpen && !!selected}
        initialTab={drawerInitialTab}
        onClose={closeDrawer}
        onSaved={handleDrawerSaved}
      />

      <BuModal
        open={buModalOpen}
        onClose={() => {
          setBuModalOpen(false);
          setEditingBu(null);
        }}
        initial={editingBu}
        onSave={handleSaveBu}
        saving={buSaving}
      />

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          resetInviteForm();
        }}
        title="Invite team"
        subtitle={
          section === "contractors"
            ? "Contractor onboarding — fiscal details, Independent Contractor Agreement, documents and payment."
            : section === "internal"
              ? "Add an internal employee — PAYE payroll row and optional dashboard access."
              : "Pick employment type — contractors get onboarding + contract; employees are added directly."
        }
        size="md"
        className="w-[min(100%,calc(100vw-1.5rem))] sm:max-w-lg"
      >
        <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5 min-w-0">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {formEmployment === "self_employed" ? "Company or display name" : "Full name"}
            </label>
            <Input
              value={formPayee}
              onChange={(e) => setFormPayee(e.target.value)}
              placeholder={formEmployment === "self_employed" ? "Trading name or legal entity" : "Full name"}
              className="w-full min-w-0"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
            <Input
              type="email"
              value={formEmail}
              onChange={(e) => {
                const v = e.target.value;
                setFormEmail(v);
                if (formEmployment === "employee" || formCreateAccess) {
                  setFormAccessEmail(v);
                }
              }}
              placeholder="person@example.com"
              className="w-full min-w-0"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              {formEmployment === "self_employed"
                ? "Contractor onboarding link is emailed when you send the invite."
                : "Used for payroll and dashboard access — no onboarding email for employees."}
            </p>
          </div>
          {formEmployment === "self_employed" ? (
            <div className="rounded-xl border border-border-light p-3 space-y-3">
              <p className="text-xs font-semibold text-text-primary">Fiscal details</p>
              <Select
                label="Entity type"
                value={formContractorEntity}
                onChange={(e) => setFormContractorEntity(e.target.value as "individual" | "company")}
                options={[
                  { value: "individual", label: "Self-employed / sole trader" },
                  { value: "company", label: "Registered company" },
                ]}
                className="min-w-0"
              />
              <CountrySelect
                label="Country *"
                value={formContractorCountry}
                onChange={setFormContractorCountry}
                className="w-full min-w-0"
                required
              />
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {isUkWorkCountry(formContractorCountry)
                    ? formContractorEntity === "company"
                      ? "Company registration or VAT"
                      : "UTR"
                    : "Tax / fiscal number"}{" "}
                  <span className="text-coral">*</span>
                </label>
                <Input
                  value={formContractorTaxNumber}
                  onChange={(e) => setFormContractorTaxNumber(e.target.value)}
                  placeholder={
                    isUkWorkCountry(formContractorCountry)
                      ? "UTR or Companies House / VAT"
                      : "CNPJ, local tax ID, etc."
                  }
                  className="w-full min-w-0"
                />
                <p className="text-[11px] text-text-tertiary mt-1">
                  {isUkWorkCountry(formContractorCountry)
                    ? "UK: UTR for sole traders; company number or VAT for companies."
                    : "Outside UK: one local fiscal number is enough — no UK VAT/UTR."}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Operating address (optional)</label>
                <Input
                  value={formContractorAddress}
                  onChange={(e) => setFormContractorAddress(e.target.value)}
                  placeholder="Can confirm in onboarding"
                  className="w-full min-w-0"
                />
              </div>
            </div>
          ) : null}
          <Select
            label="Department"
            value={formDept}
            onChange={(e) => {
              setFormDept(e.target.value);
              if (e.target.value !== "Other") setFormOtherDesc("");
              if (!e.target.value) setFormRoleTitle("");
            }}
            options={WORKFORCE_DEPARTMENT_SELECT_OPTIONS}
            className="min-w-0"
          />
          {formDept === "Other" && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Role / pay line description</label>
              <Input
                value={formOtherDesc}
                onChange={(e) => setFormOtherDesc(e.target.value)}
                placeholder="e.g. Head of partnerships"
                className="w-full min-w-0"
              />
            </div>
          )}
          {!!formDept && formDept !== "Other" && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Role title (optional)</label>
              <Input
                value={formRoleTitle}
                onChange={(e) => setFormRoleTitle(e.target.value)}
                placeholder="e.g. Coordinator"
                className="w-full min-w-0"
              />
            </div>
          )}
          <div className="rounded-xl border border-border-light p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Payment</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2 min-w-0">
              <div className="min-w-0">
                <label className="block text-xs font-medium text-text-secondary mb-1">Fixed payment (£)</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0 if commission-only"
                  className="w-full min-w-0"
                />
              </div>
              <div className="min-w-0">
                <Select
                  label="Pay frequency"
                  value={formFreq}
                  onChange={(e) => setFormFreq(e.target.value as typeof formFreq)}
                  options={[{ value: "", label: "—" }, ...PAYROLL_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
                  className="min-w-0"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2 min-w-0">
              <div className="min-w-0">
                <Select
                  label="Commission"
                  value={formCommissionEnabled ? "yes" : "no"}
                  onChange={(e) => setFormCommissionEnabled(e.target.value === "yes")}
                  options={[
                    { value: "no", label: "Fixed pay only" },
                    { value: "yes", label: "Fixed + commission" },
                  ]}
                  className="min-w-0"
                />
              </div>
              {formCommissionEnabled ? (
                <>
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-text-secondary mb-1">Commission rate (%)</label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={formCommissionRate}
                      onChange={(e) => setFormCommissionRate(e.target.value)}
                      placeholder="e.g. 10"
                      className="w-full min-w-0"
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <Select
                      label="Commission on"
                      value={formCommissionBasis}
                      onChange={(e) => setFormCommissionBasis(e.target.value as WorkforceCommissionBasis)}
                      options={WORKFORCE_COMMISSION_BASIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      className="min-w-0"
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2 min-w-0">
              <div className="min-w-0">
                <label className="block text-xs font-medium text-text-secondary mb-1">Start date</label>
                <Input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  className="w-full min-w-0"
                />
                <p className="text-[10px] text-text-tertiary mt-1">
                  Pay day {WORKFORCE_MONTHLY_PAY_DAY} · cutoff last day of month · pro-rate if mid-month.
                </p>
              </div>
              <div className="min-w-0">
                <Select
                  label="Payment method"
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value as WorkforcePaymentMethod)}
                  options={WORKFORCE_PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  className="min-w-0"
                />
              </div>
            </div>
          </div>
          <Select
            label="Employment type"
            value={formEmployment}
            onChange={(e) => {
              const next = e.target.value as PayrollInternalEmploymentType;
              setFormEmployment(next);
              if (next === "employee") {
                setFormCreateAccess(true);
                if (formEmail.trim()) setFormAccessEmail(formEmail);
              } else {
                setFormCreateAccess(false);
                setFormCategory("Contractor");
              }
            }}
            options={[
              { value: "employee", label: "Employee (internal team)" },
              { value: "self_employed", label: "Self-employed (contractor)" },
            ]}
            className="min-w-0"
          />
          <Select
            label="Business Unit"
            value={formBuId}
            onChange={(e) => setFormBuId(e.target.value)}
            options={[{ value: "", label: "— No BU" }, ...bus.map((s) => ({ value: s.id, label: s.name }))]}
            className="min-w-0"
          />

          <div className="rounded-xl border border-border-light p-3 space-y-3">
            {formEmployment === "employee" ? (
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">Create dashboard access</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  Included for internal team — grants a Fixfy OS web login. You can adjust this later from Login Details.
                </p>
              </div>
            ) : (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formCreateAccess}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormCreateAccess(checked);
                    if (checked && formEmail.trim()) setFormAccessEmail(formEmail);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">Create dashboard access</p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    Grant this person a Fixfy OS web login. You can also add this later from the Login Details tab.
                  </p>
                </div>
              </label>
            )}
            {(formEmployment === "employee" || formCreateAccess) && (
              <div className="space-y-2.5 pt-1 pl-6">
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">Login email</label>
                  <Input
                    type="email"
                    value={formEmployment === "employee" ? formEmail : formAccessEmail}
                    onChange={
                      formEmployment === "employee"
                        ? undefined
                        : (e) => setFormAccessEmail(e.target.value)
                    }
                    readOnly={formEmployment === "employee"}
                    placeholder={formEmail.trim() || "person@example.com"}
                    className={cn(
                      "w-full min-w-0",
                      formEmployment === "employee" && "bg-surface-hover/60 text-text-secondary",
                    )}
                  />
                  {formEmployment === "employee" ? (
                    <p className="text-[11px] text-text-tertiary mt-1">Same as work email above.</p>
                  ) : null}
                </div>
                <Select
                  label="Role"
                  value={formAccessRole}
                  onChange={(e) => setFormAccessRole(e.target.value as typeof formAccessRole)}
                  options={[
                    { value: "admin", label: "Admin" },
                    { value: "manager", label: "Manager" },
                    { value: "operator", label: "Operator" },
                  ]}
                  className="min-w-0"
                />
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">Temporary password</label>
                  <Input
                    type="password"
                    value={formAccessPassword}
                    onChange={(e) => setFormAccessPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full min-w-0"
                    autoComplete="new-password"
                  />
                  <p className="text-[11px] text-text-tertiary mt-1">User will be forced to change it on first login.</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:justify-end sm:gap-2 sm:pt-2 sticky bottom-0 z-[1] bg-card pb-3 -mx-4 px-4 sm:static sm:z-0 sm:mx-0 sm:px-0 sm:pb-0 border-t border-border-light/80 sm:border-0 mt-1 sm:mt-0">
            <Button variant="outline" className="w-full sm:w-auto shrink-0" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} className="w-full sm:w-auto shrink-0" onClick={() => void handleInviteTeam()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
