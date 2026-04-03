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
import { Plus, Loader2, FileText, Wallet, Building2, Pencil, Trash2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { InternalCost, InternalCostStatus, PayrollInternalEmploymentType, Squad } from "@/types/database";
import { getSupabase } from "@/services/base";
import { listSquads, createSquad, updateSquad, deleteSquad } from "@/services/teams";
import { SquadModal } from "@/components/teams/squad-modal";
import {
  PAYROLL_FREQUENCY_OPTIONS,
  PAYROLL_COST_CATEGORIES,
  payrollDocsRowCompletion,
  type PayrollDocumentFileMeta,
} from "@/lib/payroll-doc-checklist";
import { WorkforcePersonDrawer } from "@/components/people/workforce-person-drawer";

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

type PeopleTab = "internal" | "contractors";

/** Payroll row + joined squad name for cards */
export type PeopleRow = InternalCost & { squad_name?: string | null };

function mapCostRows(
  data: unknown,
): PeopleRow[] {
  const list = (data ?? []) as (InternalCost & { squads?: { name: string } | null })[];
  return list.map((r) => {
    const { squads, ...rest } = r;
    return { ...rest, squad_name: squads?.name ?? null };
  });
}

export default function PeoplePage() {
  const [section, setSection] = useState<PeopleTab>("internal");
  const [rows, setRows] = useState<PeopleRow[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [squadFilter, setSquadFilter] = useState<string>("all");
  const [selected, setSelected] = useState<PeopleRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formPayee, setFormPayee] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState("Salary");
  const [formDue, setFormDue] = useState("");
  const [formFreq, setFormFreq] = useState<"" | "weekly" | "biweekly" | "monthly">("monthly");
  const [formEmployment, setFormEmployment] = useState<PayrollInternalEmploymentType>("employee");
  const [formSquadId, setFormSquadId] = useState("");

  const [squadModalOpen, setSquadModalOpen] = useState(false);
  const [editingSquad, setEditingSquad] = useState<Squad | null>(null);
  const [squadSaving, setSquadSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [sq, costsRes] = await Promise.all([
        listSquads(),
        supabase
          .from("payroll_internal_costs")
          .select("*, squads(name)")
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
      ]);
      setSquads(sq);
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
    if (squadFilter === "unassigned") {
      list = list.filter((r) => !r.squad_id);
    } else if (squadFilter !== "all") {
      list = list.filter((r) => r.squad_id === squadFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const name = (r.payee_name ?? "").toLowerCase();
        const desc = (r.description ?? "").toLowerCase();
        const sq = (r.squad_name ?? "").toLowerCase();
        return name.includes(q) || desc.includes(q) || sq.includes(q);
      });
    }
    list = list.filter((r) => (r.lifecycle_stage ?? "active") !== "offboard");
    return list;
  }, [rows, section, search, squadFilter]);

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
    const { data, error } = await supabase.from("payroll_internal_costs").select("*, squads(name)").eq("id", id).maybeSingle();
    if (error) {
      const { data: fb } = await supabase.from("payroll_internal_costs").select("*").eq("id", id).maybeSingle();
      if (fb) setSelected(fb as PeopleRow);
      return;
    }
    if (data) setSelected(mapCostRows([data])[0] ?? null);
  }, [load, selected?.id]);

  const handleCreatePerson = async () => {
    if (!formPayee.trim() || !formDesc.trim()) {
      toast.error("Name and description are required");
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
        description: formDesc.trim(),
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
        squad_id: formSquadId.trim() || null,
        created_at: now,
        updated_at: now,
      };
      let { data: inserted, error } = await supabase.from("payroll_internal_costs").insert(row).select("*").single();
      if (error && String(error.message ?? "").toLowerCase().includes("squad")) {
        const { squad_id: _s, ...noSq } = row as typeof row & { squad_id?: string | null };
        const retry = await supabase.from("payroll_internal_costs").insert(noSq).select("*").single();
        inserted = retry.data;
        error = retry.error;
        if (!error) toast.warning("Person created — apply migration 096 to enable squads.");
      }
      if (error) throw error;
      toast.success("Person added — complete profile in the drawer");
      setAddOpen(false);
      setFormPayee("");
      setFormDesc("");
      setFormAmount("");
      setFormDue("");
      setFormSquadId("");
      await load();
      if (inserted) {
        const ic = inserted as InternalCost;
        const sn = ic.squad_id ? squads.find((s) => s.id === ic.squad_id)?.name ?? null : null;
        setSelected({ ...ic, squad_name: sn });
        setDrawerOpen(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const sectionTabs = [
    { id: "internal" as const, label: "Internal team" },
    { id: "contractors" as const, label: "Contractors" },
  ];

  const squadFilterOptions = useMemo(
    () => [
      { value: "all", label: "All squads" },
      { value: "unassigned", label: "No squad" },
      ...squads.map((s) => ({ value: s.id, label: s.name })),
    ],
    [squads],
  );

  const openAddSquad = () => {
    setEditingSquad(null);
    setSquadModalOpen(true);
  };

  const openEditSquad = (s: Squad) => {
    setEditingSquad(s);
    setSquadModalOpen(true);
  };

  const handleSaveSquad = async (name: string) => {
    setSquadSaving(true);
    try {
      if (editingSquad) {
        await updateSquad(editingSquad.id, { name });
        toast.success("Squad updated");
      } else {
        await createSquad(name);
        toast.success("Squad created");
      }
      setSquadModalOpen(false);
      setEditingSquad(null);
      await load();
    } catch {
      toast.error("Failed to save squad");
    } finally {
      setSquadSaving(false);
    }
  };

  const handleDeleteSquad = async (s: Squad) => {
    if (!confirm(`Remove squad “${s.name}”? People in this squad will become unassigned.`)) return;
    try {
      await deleteSquad(s.id);
      toast.success("Squad removed");
      if (squadFilter === s.id) setSquadFilter("all");
      await load();
    } catch {
      toast.error("Failed to delete squad");
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="Workforce"
          subtitle="Employees and contractors by squad — profile, documents, finance, and Pay Run data in one place. Squads replace the old payroll roster list."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Building2 className="h-4 w-4" />}
              onClick={openAddSquad}
            >
              Add squad
            </Button>
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setFormEmployment(section === "internal" ? "employee" : "self_employed");
                setFormSquadId(squadFilter !== "all" && squadFilter !== "unassigned" ? squadFilter : "");
                setAddOpen(true);
              }}
            >
              Add person
            </Button>
          </div>
        </PageHeader>

        {squads.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-xs font-medium text-text-tertiary">Squads:</span>
            {squads.map((s) => (
              <div key={s.id} className="inline-flex items-center gap-0.5 rounded-full border border-border-light bg-surface-hover/50 pl-2.5 pr-1 py-0.5">
                <span className="text-xs font-medium text-text-primary">{s.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => openEditSquad(s)}
                  icon={<Pencil className="h-3 w-3" />}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-600"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => void handleDeleteSquad(s)}
                  icon={<Trash2 className="h-3 w-3" />}
                />
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border-light bg-card/80 backdrop-blur-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-border-light flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              tabs={sectionTabs.map((t) => ({ id: t.id, label: t.label }))}
              activeTab={section}
              onChange={(id) => setSection(id as PeopleTab)}
            />
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full lg:max-w-2xl">
              <Select
                value={squadFilter}
                onChange={(e) => setSquadFilter(e.target.value)}
                options={squadFilterOptions}
                className="min-w-[160px] shrink-0"
              />
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, role, squad…"
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
                <p className="text-text-secondary">No one in this list yet.</p>
                <p className="text-sm text-text-tertiary mt-2 max-w-md mx-auto">
                  Add employees or contractors, assign a squad, then open their profile for documents and finance.
                </p>
                <Button className="mt-4" onClick={() => setAddOpen(true)}>
                  Add first person
                </Button>
              </motion.div>
            ) : (
              <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((r) => {
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
                        <Avatar name={r.payee_name ?? "?"} size="lg" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-text-primary truncate">{r.payee_name ?? "Unnamed"}</p>
                          <p className="text-xs text-text-tertiary line-clamp-2">{r.description}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.squad_name ? (
                              <Badge variant="default" size="sm" className="max-w-[140px] truncate">
                                {r.squad_name}
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
        squads={squads}
        open={drawerOpen && !!selected}
        onClose={closeDrawer}
        onSaved={handleDrawerSaved}
      />

      <SquadModal
        open={squadModalOpen}
        onClose={() => {
          setSquadModalOpen(false);
          setEditingSquad(null);
        }}
        initial={editingSquad}
        onSave={handleSaveSquad}
        saving={squadSaving}
      />

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add person"
        subtitle={section === "internal" ? "Creates an employee payroll row (PAYE)." : "Creates an internal contractor (self-employed) row."}
      >
        <div className="space-y-3 p-1">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Display name</label>
            <Input value={formPayee} onChange={(e) => setFormPayee(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Role / pay line description</label>
            <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="e.g. Operations coordinator" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Amount (GBP)</label>
              <Input type="number" min={0} step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
            </div>
            <div>
              <Select
                label="Category"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                options={PAYROLL_COST_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Next due date</label>
            <Input type="date" value={formDue} onChange={(e) => setFormDue(e.target.value)} />
          </div>
          <Select
            label="Pay frequency"
            value={formFreq}
            onChange={(e) => setFormFreq(e.target.value as typeof formFreq)}
            options={[{ value: "", label: "—" }, ...PAYROLL_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
          />
          <Select
            label="Employment type"
            value={formEmployment}
            onChange={(e) => setFormEmployment(e.target.value as PayrollInternalEmploymentType)}
            options={[
              { value: "employee", label: "Employee (internal team)" },
              { value: "self_employed", label: "Self-employed (contractor)" },
            ]}
          />
          <Select
            label="Squad"
            value={formSquadId}
            onChange={(e) => setFormSquadId(e.target.value)}
            options={[{ value: "", label: "— No squad" }, ...squads.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void handleCreatePerson()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
