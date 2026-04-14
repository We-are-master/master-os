"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp, staggerItem } from "@/lib/motion";
import { Plus, Loader2, FileText, Wallet, Building2, Pencil, Trash2, Users, HardHat } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { InternalCost, InternalCostStatus, PayrollInternalEmploymentType, BusinessUnit } from "@/types/database";
import { getSupabase } from "@/services/base";
import { listBusinessUnits, createBusinessUnit, updateBusinessUnit, deleteBusinessUnit } from "@/services/teams";
import { BuModal } from "@/components/teams/bu-modal";
import {
  PAYROLL_FREQUENCY_OPTIONS,
  PAYROLL_COST_CATEGORIES,
  PROFILE_PHOTO_DOC_KEY,
  payrollDocsRowCompletion,
  type PayrollDocumentFileMeta,
} from "@/lib/payroll-doc-checklist";
import { getPayrollDocumentSignedUrl } from "@/services/payroll-documents-storage";
import { WorkforcePersonDrawer } from "@/components/people/workforce-person-drawer";
import { buildPayLineDescription, WORKFORCE_DEPARTMENT_SELECT_OPTIONS } from "@/lib/workforce-departments";
import { insertPayrollInternalCostWithCompat } from "@/lib/payroll-internal-insert-compat";

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

function payrollProfileEmail(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = (raw as Record<string, unknown>).email;
  return typeof e === "string" && e.trim() ? e.trim() : undefined;
}

type PeopleTab = "internal" | "contractors";

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
  const [section, setSection] = useState<PeopleTab>("internal");
  const [rows, setRows] = useState<PeopleRow[]>([]);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [buFilter, setBuFilter] = useState<string>("all");
  const [selected, setSelected] = useState<PeopleRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formPayee, setFormPayee] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formRoleTitle, setFormRoleTitle] = useState("");
  const [formOtherDesc, setFormOtherDesc] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState("Salary");
  const [formDue, setFormDue] = useState("");
  const [formFreq, setFormFreq] = useState<"" | "weekly" | "biweekly" | "monthly">("monthly");
  const [formEmployment, setFormEmployment] = useState<PayrollInternalEmploymentType>("employee");
  const [formBuId, setFormBuId] = useState("");
  const [formCreateAccess, setFormCreateAccess] = useState(false);
  const [formAccessEmail, setFormAccessEmail] = useState("");
  const [formAccessRole, setFormAccessRole] = useState<"admin" | "manager" | "operator">("operator");
  const [formAccessPassword, setFormAccessPassword] = useState("");

  const [buModalOpen, setBuModalOpen] = useState(false);
  const [editingBu, setEditingBu] = useState<BusinessUnit | null>(null);
  const [buSaving, setBuSaving] = useState(false);

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

  const filtered = useMemo(() => {
    const want: PayrollInternalEmploymentType =
      section === "internal" ? "employee" : "self_employed";
    let list = rows.filter((r) => r.employment_type === want);
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
    list = list.filter((r) => (r.lifecycle_stage ?? "active") !== "offboard");
    return list;
  }, [rows, section, search, buFilter]);

  const rosterCounts = useMemo(() => {
    const base = rows.filter((r) => (r.lifecycle_stage ?? "active") !== "offboard");
    return {
      internal: base.filter((r) => r.employment_type === "employee").length,
      contractors: base.filter((r) => r.employment_type === "self_employed").length,
    };
  }, [rows]);

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
      const out: Record<string, string> = {};
      await Promise.all(
        filtered.map(async (r) => {
          const f = parsePayrollDocumentFiles(r.payroll_document_files);
          const p = f[PROFILE_PHOTO_DOC_KEY]?.path;
          if (!p) return;
          try {
            out[r.id] = await getPayrollDocumentSignedUrl(p);
          } catch {
            /* bucket / RLS — card falls back to initials */
          }
        }),
      );
      if (!cancelled) setPhotoUrlsById(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [photoPathsKey, filtered]);

  const openPerson = (r: PeopleRow) => {
    setSelected(r);
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

  const handleCreatePerson = async () => {
    const desc = buildPayLineDescription(formDept, formRoleTitle, formOtherDesc);
    if (!formPayee.trim() || !desc.trim()) {
      toast.error("Name and department are required");
      return;
    }
    if (formDept === "Other" && !formOtherDesc.trim()) {
      toast.error("Enter a description when department is Other");
      return;
    }
    const amt = Number(formAmount);
    if (Number.isNaN(amt) || amt < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    const supabase = getSupabase();
    const now = new Date().toISOString();
    try {
      const row = {
        description: desc.trim(),
        amount: amt,
        category: formCategory.trim() || null,
        due_date: formDue.trim() || null,
        payee_name: formPayee.trim(),
        employment_type: formEmployment,
        pay_frequency: formFreq || null,
        payment_day_of_month: null as number | null,
        payroll_document_files: {} as Record<string, PayrollDocumentFileMeta>,
        status: "pending" as InternalCostStatus,
        paid_at: null as string | null,
        lifecycle_stage: "onboarding" as const,
        has_equity: false,
        equity_percent: null as number | null,
        equity_vesting_notes: null as string | null,
        equity_start_date: null as string | null,
        payroll_profile: {},
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
      toast.success("Person added — complete profile in the drawer");
      setAddOpen(false);
      setFormPayee("");
      setFormDept("");
      setFormRoleTitle("");
      setFormOtherDesc("");
      setFormAmount("");
      setFormDue("");
      setFormBuId("");

      // Optional: create dashboard access alongside the workforce row
      if (formCreateAccess && inserted) {
        const insertedId = (inserted as InternalCost).id;
        const accessEmail = formAccessEmail.trim().toLowerCase();
        const accessPassword = formAccessPassword;
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
              full_name: formPayee.trim(),
              role: formAccessRole,
              password: accessPassword,
              payroll_internal_cost_id: insertedId,
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? "Failed to create dashboard access");
          }
          toast.success("Dashboard access created");
        } catch (err) {
          toast.warning(
            err instanceof Error
              ? `Person saved, but access failed: ${err.message}`
              : "Person saved, but access failed",
          );
        } finally {
          setFormCreateAccess(false);
          setFormAccessEmail("");
          setFormAccessPassword("");
          setFormAccessRole("operator");
        }
      }

      await load();
      if (inserted) {
        const ic = inserted as InternalCost;
        const sn = ic.bu_id ? bus.find((s) => s.id === ic.bu_id)?.name ?? null : null;
        setSelected({ ...ic, bu_name: sn });
        setDrawerOpen(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
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
          title="Workforce"
          subtitle="Working roster — internal employees and self-employed contractors. Open a card for profile photo, contact details, compliance documents, and pay. Business Units group people the same way as the field teams."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Building2 className="h-4 w-4" />}
              onClick={openAddBu}
            >
              Add BU
            </Button>
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setFormEmployment(section === "internal" ? "employee" : "self_employed");
                setFormBuId(buFilter !== "all" && buFilter !== "unassigned" ? buFilter : "");
                setAddOpen(true);
              }}
            >
              Add person
            </Button>
          </div>
        </PageHeader>

        <p className="text-xs text-text-tertiary -mt-2 max-w-3xl">
          <span className="font-medium text-text-secondary">Working</span> lists everyone except offboard. Use{" "}
          <span className="font-medium text-text-secondary">Internal team</span> for PAYE staff and{" "}
          <span className="font-medium text-text-secondary">Contractors</span> for self-billed partners. Finance → Payroll keeps commission runs and recurring bills; people live here.
        </p>

        {bus.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-xs font-medium text-text-tertiary">Business Units:</span>
            {bus.map((s) => (
              <div key={s.id} className="inline-flex items-center gap-0.5 rounded-full border border-border-light bg-surface-hover/50 pl-2.5 pr-1 py-0.5">
                <span className="text-xs font-medium text-text-primary">{s.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => openEditBu(s)}
                  icon={<Pencil className="h-3 w-3" />}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-600"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => void handleDeleteBu(s)}
                  icon={<Trash2 className="h-3 w-3" />}
                />
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border-light bg-card/80 backdrop-blur-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-border-light flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              variant="pills"
              tabs={[
                {
                  id: "internal",
                  label: "Internal team",
                  count: rosterCounts.internal,
                },
                {
                  id: "contractors",
                  label: "Contractors",
                  count: rosterCounts.contractors,
                },
              ]}
              activeTab={section}
              onChange={(id) => setSection(id as PeopleTab)}
            />
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full lg:max-w-2xl">
              <Select
                value={buFilter}
                onChange={(e) => setBuFilter(e.target.value)}
                options={buFilterOptions}
                className="min-w-[160px] shrink-0"
              />
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, role, BU…"
                className="flex-1 w-full min-w-0"
              />
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
              </div>
            ) : filtered.length === 0 ? (
              <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="text-center py-16">
                <div className="inline-flex items-center justify-center rounded-full bg-surface-hover p-3 mb-3">
                  {section === "internal" ? (
                    <Users className="h-8 w-8 text-text-tertiary" />
                  ) : (
                    <HardHat className="h-8 w-8 text-text-tertiary" />
                  )}
                </div>
                <p className="text-text-secondary font-medium">
                  {section === "internal" ? "No internal team members yet" : "No contractors yet"}
                </p>
                <p className="text-sm text-text-tertiary mt-2 max-w-md mx-auto">
                  {section === "internal"
                    ? "Add PAYE employees with salary lines. You can upload passport, contract, and payroll setup from each person’s drawer."
                    : "Add self-employed people for internal contractor fees and self-bill workflow. Documents differ from employees (e.g. self-bill agreement)."}
                </p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    setFormEmployment(section === "internal" ? "employee" : "self_employed");
                    setAddOpen(true);
                  }}
                >
                  Add {section === "internal" ? "employee" : "contractor"}
                </Button>
              </motion.div>
            ) : (
              <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((r) => {
                  const emailLine = payrollProfileEmail(r.payroll_profile);
                  const files = parsePayrollDocumentFiles(r.payroll_document_files);
                  const { done, total } = payrollDocsRowCompletion(
                    r.employment_type ?? null,
                    files,
                    r.documents_on_file ?? null,
                    r.has_equity ?? false,
                  );
                  const stage = r.lifecycle_stage ?? "active";
                  return (
                    <motion.button
                      type="button"
                      key={r.id}
                      variants={staggerItem}
                      onClick={() => openPerson(r)}
                      className="text-left rounded-2xl border border-border-light bg-surface-hover/20 hover:bg-surface-hover/50 hover:border-primary/20 transition-all p-4 flex flex-col gap-3 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar name={r.payee_name ?? "?"} size="lg" src={photoUrlsById[r.id]} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-text-primary truncate">{r.payee_name ?? "Unnamed"}</p>
                          {emailLine ? <p className="text-xs text-text-secondary truncate">{emailLine}</p> : null}
                          <p className="text-xs text-text-tertiary line-clamp-2">{r.description}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.bu_name ? (
                              <Badge variant="default" size="sm" className="max-w-[140px] truncate">
                                {r.bu_name}
                              </Badge>
                            ) : null}
                            <Badge variant={stage === "active" ? "success" : "info"} size="sm">
                              {stage === "onboarding" ? "Onboarding" : stage === "active" ? "Active" : stage}
                            </Badge>
                            {total > 0 && (
                              <Badge variant={done >= total ? "success" : "warning"} size="sm">
                                Docs {done}/{total}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs border-t border-border-light pt-3">
                        <div>
                          <p className="text-text-tertiary uppercase tracking-wide">Amount</p>
                          <p className="font-semibold text-text-primary">{formatCurrency(Number(r.amount))}</p>
                        </div>
                        <div>
                          <p className="text-text-tertiary uppercase tracking-wide">Next due</p>
                          <p className="font-medium text-text-primary">{r.due_date ? formatDate(r.due_date) : "—"}</p>
                        </div>
                        <div className="col-span-2 flex items-center gap-3 text-text-tertiary">
                          <span className="inline-flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" />
                            Documents
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Wallet className="h-3.5 w-3.5" />
                            Finance
                          </span>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </StaggerContainer>
            )}
          </div>
        </div>
      </div>

      <WorkforcePersonDrawer
        person={selected}
        bus={bus}
        open={drawerOpen && !!selected}
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
        onClose={() => setAddOpen(false)}
        title="Add person"
        subtitle={section === "internal" ? "Creates an employee payroll row (PAYE)." : "Creates an internal contractor (self-employed) row."}
        size="md"
        className="w-[min(100%,calc(100vw-1.5rem))] sm:max-w-lg"
      >
        <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5 min-w-0">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Display name</label>
            <Input value={formPayee} onChange={(e) => setFormPayee(e.target.value)} placeholder="Full name" className="w-full min-w-0" />
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2 min-w-0">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-text-secondary mb-1">Amount (GBP)</label>
              <Input type="number" min={0} step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="w-full min-w-0" />
            </div>
            <div className="min-w-0">
              <Select
                label="Category"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                options={PAYROLL_COST_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                className="min-w-0"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Next due date</label>
            <Input type="date" value={formDue} onChange={(e) => setFormDue(e.target.value)} className="w-full min-w-0" />
          </div>
          <Select
            label="Pay frequency"
            value={formFreq}
            onChange={(e) => setFormFreq(e.target.value as typeof formFreq)}
            options={[{ value: "", label: "—" }, ...PAYROLL_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
            className="min-w-0"
          />
          <Select
            label="Employment type"
            value={formEmployment}
            onChange={(e) => setFormEmployment(e.target.value as PayrollInternalEmploymentType)}
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
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={formCreateAccess}
                onChange={(e) => setFormCreateAccess(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">Create dashboard access</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  Grant this person a Master OS web login. You can also add this later from the Dashboard Access tab.
                </p>
              </div>
            </label>
            {formCreateAccess && (
              <div className="space-y-2.5 pt-1 pl-6">
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">Email</label>
                  <Input
                    type="email"
                    value={formAccessEmail}
                    onChange={(e) => setFormAccessEmail(e.target.value)}
                    placeholder="person@example.com"
                    className="w-full min-w-0"
                  />
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
            <Button disabled={saving} className="w-full sm:w-auto shrink-0" onClick={() => void handleCreatePerson()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
