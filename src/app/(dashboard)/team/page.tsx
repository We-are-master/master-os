"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import type { AssignableUser } from "@/services/profiles";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Plus, Users, Building2, Loader2, Pencil, Trash2, Shield, ExternalLink, UserPlus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Profile, Squad, TeamMember, TeamMemberRole, TeamMemberStatus } from "@/types/database";
import { getSupabase } from "@/services/base";
import {
  listSquads,
  listTeamMembers,
  createSquad,
  updateSquad,
  deleteSquad,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from "@/services/teams";

const ROLE_LABELS: Record<TeamMemberRole, string> = {
  am: "Account Manager",
  ops_coord: "Ops Coordinator",
  biz_dev: "Biz Dev",
  head_ops: "Head Ops",
  ceo: "CEO",
  it: "IT",
};

const APP_ROLE_LABELS: Record<Profile["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
};

function profileIsActive(p: Pick<Profile, "is_active">): boolean {
  return p.is_active !== false;
}

function payrollRowForProfile(members: TeamMember[], p: Profile): TeamMember | undefined {
  return members.find(
    (m) =>
      (m.profile_id && m.profile_id === p.id) ||
      (m.email && p.email && m.email.toLowerCase() === p.email.toLowerCase())
  );
}

export default function TeamPage() {
  const [squads, setSquads] = useState<Squad[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [appUsers, setAppUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [squadModalOpen, setSquadModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingSquad, setEditingSquad] = useState<Squad | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [memberPresetSquadId, setMemberPresetSquadId] = useState<string | undefined>();
  const [memberPresetSquadName, setMemberPresetSquadName] = useState<string | undefined>();
  const [memberPresetProfile, setMemberPresetProfile] = useState<Profile | undefined>();
  const [saving, setSaving] = useState(false);

  const squadIds = useMemo(() => new Set(squads.map((s) => s.id)), [squads]);

  const unassignedPayroll = useMemo(
    () => members.filter((m) => !m.squad_id || !squadIds.has(m.squad_id)),
    [members, squadIds]
  );

  const membersInSquad = useCallback(
    (squadId: string) => members.filter((m) => m.squad_id === squadId),
    [members]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([listSquads(), listTeamMembers()]);
      setSquads(s);
      setMembers(m);
      const { data: profs, error: pErr } = await getSupabase()
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at, updated_at")
        .order("full_name", { ascending: true });
      if (pErr) {
        setAppUsers([]);
        toast.error(pErr.message || "Could not load app users");
      } else {
        setAppUsers((profs ?? []) as Profile[]);
      }
    } catch {
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAddSquad = () => {
    setEditingSquad(null);
    setSquadModalOpen(true);
  };

  const openEditSquad = (s: Squad) => {
    setEditingSquad(s);
    setSquadModalOpen(true);
  };

  const openAddMember = (opts?: { squadId?: string; squadName?: string; profile?: Profile }) => {
    setEditingMember(null);
    setMemberPresetSquadId(opts?.squadId);
    setMemberPresetSquadName(opts?.squadName);
    setMemberPresetProfile(opts?.profile);
    setMemberModalOpen(true);
  };

  const closeMemberModal = () => {
    setMemberModalOpen(false);
    setEditingMember(null);
    setMemberPresetSquadId(undefined);
    setMemberPresetSquadName(undefined);
    setMemberPresetProfile(undefined);
  };

  const openEditMember = (m: TeamMember) => {
    setMemberPresetSquadId(undefined);
    setMemberPresetSquadName(undefined);
    setMemberPresetProfile(undefined);
    setEditingMember(m);
    setMemberModalOpen(true);
  };

  const handleSaveSquad = async (name: string) => {
    setSaving(true);
    try {
      if (editingSquad) {
        await updateSquad(editingSquad.id, { name });
        toast.success("Squad updated");
      } else {
        await createSquad(name);
        toast.success("Squad created");
      }
      setSquadModalOpen(false);
      load();
    } catch {
      toast.error("Failed to save squad");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSquad = async (id: string) => {
    if (!confirm("Remove this squad? Members will be unassigned.")) return;
    try {
      await deleteSquad(id);
      toast.success("Squad removed");
      load();
    } catch {
      toast.error("Failed to delete squad");
    }
  };

  const handleSaveMember = async (form: Partial<TeamMember>) => {
    setSaving(true);
    try {
      if (editingMember) {
        await updateTeamMember(editingMember.id, {
          full_name: form.full_name!,
          email: form.email,
          phone: form.phone,
          role: form.role!,
          squad_id: form.squad_id || undefined,
          base_salary: form.base_salary != null ? Number(form.base_salary) : undefined,
          start_date: form.start_date || undefined,
          status: form.status!,
          profile_id: form.profile_id ?? null,
        });
        toast.success("Member updated");
      } else {
        await createTeamMember({
          full_name: form.full_name!,
          email: form.email,
          phone: form.phone,
          role: form.role!,
          squad_id: form.squad_id || undefined,
          base_salary: form.base_salary != null ? Number(form.base_salary) : undefined,
          start_date: form.start_date,
          status: (form.status as TeamMemberStatus) ?? "active",
          profile_id: form.profile_id,
        });
        toast.success("Member added");
      }
      closeMemberModal();
      load();
    } catch {
      toast.error("Failed to save member");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMember = async (id: string) => {
    if (!confirm("Remove this team member from the list?")) return;
    try {
      await deleteTeamMember(id);
      toast.success("Member removed");
      load();
    } catch {
      toast.error("Failed to delete member");
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="Team"
          subtitle="Internal squads and team members. Feeds payroll and commission."
        >
          <Button variant="outline" size="sm" onClick={openAddSquad} icon={<Building2 className="h-3.5 w-3.5" />}>
            Add Squad
          </Button>
          <Button size="sm" onClick={() => openAddMember()} icon={<Plus className="h-3.5 w-3.5" />}>
            Add payroll member
          </Button>
        </PageHeader>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card padding="md" className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1 flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Squads &amp; payroll
              </h3>
              <p className="text-xs text-text-tertiary mb-3">
                Add people to a squad for commission / payroll. Use <strong className="text-text-secondary">Add employee</strong> inside each squad, or move someone from <strong className="text-text-secondary">No squad</strong> via edit.
              </p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-text-tertiary">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                {squads.map((s) => {
                  const inSquad = membersInSquad(s.id);
                  return (
                    <div
                      key={s.id}
                      className="rounded-xl border border-border-light bg-surface-hover/40 overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border-light bg-surface-hover/80">
                        <span className="text-sm font-semibold text-text-primary">{s.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary"
                            onClick={() => openAddMember({ squadId: s.id, squadName: s.name })}
                            icon={<UserPlus className="h-3.5 w-3.5" />}
                            title="Add employee to this squad"
                          >
                            <span className="hidden sm:inline">Add employee</span>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditSquad(s)} icon={<Pencil className="h-3.5 w-3.5" />} />
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteSquad(s.id)} className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} />
                        </div>
                      </div>
                      <ul className="divide-y divide-border-light/80">
                        {inSquad.length === 0 ? (
                          <li className="px-3 py-3 text-xs text-text-tertiary">No employees in this squad yet.</li>
                        ) : (
                          inSquad.map((m) => (
                            <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate">{m.full_name}</p>
                                <p className="text-[11px] text-text-tertiary truncate">
                                  {ROLE_LABELS[m.role]}
                                  {m.base_salary != null ? ` · ${formatCurrency(m.base_salary)}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant={m.status === "active" ? "success" : "default"} size="sm">
                                  {m.status}
                                </Badge>
                                <Button variant="ghost" size="sm" onClick={() => openEditMember(m)} icon={<Pencil className="h-3.5 w-3.5" />} />
                                <Button variant="ghost" size="sm" onClick={() => handleDeleteMember(m.id)} className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} />
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  );
                })}
                {squads.length === 0 && (
                  <p className="text-sm text-text-tertiary py-2">No squads yet. Create one with <strong className="text-text-secondary">Add Squad</strong>.</p>
                )}

                {squads.length > 0 && (
                  <div className="rounded-xl border border-dashed border-amber-500/35 bg-amber-500/5">
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-amber-500/20">
                      <span className="text-sm font-semibold text-text-primary">No squad assigned</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAddMember()}
                        icon={<UserPlus className="h-3.5 w-3.5" />}
                      >
                        Add (unassigned)
                      </Button>
                    </div>
                    <p className="text-[11px] text-text-tertiary px-3 py-2 border-b border-amber-500/10">
                      Payroll members not linked to any squad — assign a squad when you edit them, or add new rows here and pick a squad in the form.
                    </p>
                    <ul className="divide-y divide-border-light/80">
                      {unassignedPayroll.length === 0 ? (
                        <li className="px-3 py-3 text-xs text-text-tertiary">Everyone is assigned to a squad.</li>
                      ) : (
                        unassignedPayroll.map((m) => (
                          <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-text-primary truncate">{m.full_name}</p>
                              <p className="text-[11px] text-text-tertiary truncate">{ROLE_LABELS[m.role]}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button variant="ghost" size="sm" onClick={() => openEditMember(m)} icon={<Pencil className="h-3.5 w-3.5" />} title="Assign to a squad" />
                              <Button variant="ghost" size="sm" onClick={() => handleDeleteMember(m.id)} className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} />
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card padding="md" className="space-y-6">
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <Shield className="h-4 w-4" /> App users
                </h3>
                <Link
                  href="/settings"
                  className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  Settings <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <p className="text-xs text-text-tertiary mb-3">
                People who can sign in. Invite or change app roles in <strong className="text-text-secondary">Settings → Team Members</strong>.
                Use <strong className="text-text-secondary">Add to payroll</strong> to put them on a squad for commission.
              </p>
              {loading ? (
                <div className="flex items-center justify-center py-6 text-text-tertiary">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <ul className="space-y-2">
                  {appUsers.map((u) => {
                    const row = payrollRowForProfile(members, u);
                    return (
                      <li
                        key={u.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-surface-hover flex-wrap gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary">{u.full_name}</p>
                          <p className="text-xs text-text-tertiary truncate">{u.email}</p>
                          <p className="text-[11px] text-text-tertiary mt-0.5">
                            App: {APP_ROLE_LABELS[u.role] ?? u.role}
                            {row && (
                              <>
                                {" · "}
                                <span className="text-text-secondary">
                                  Payroll: {row.squad_name ?? "No squad"} · {ROLE_LABELS[row.role]}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <Badge variant={profileIsActive(u) ? "success" : "default"} size="sm">
                            {profileIsActive(u) ? "Active" : "Inactive"}
                          </Badge>
                          {!row ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => openAddMember({ profile: u })}
                            >
                              Add to payroll
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px]"
                              onClick={() => openEditMember(row)}
                            >
                              Edit payroll
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {appUsers.length === 0 && (
                    <p className="text-sm text-text-tertiary py-3">No app users found. Check profiles access or invite from Settings.</p>
                  )}
                </ul>
              )}
            </div>

            <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
              <p className="text-xs text-text-tertiary flex items-start gap-2">
                <Users className="h-4 w-4 shrink-0 mt-0.5 text-text-tertiary" />
                <span>
                  The <strong className="text-text-secondary">payroll list</strong> is organised by squad on the left. Use <strong className="text-text-secondary">Add payroll member</strong> (top) for someone who is not in the app yet, or <strong className="text-text-secondary">Add to payroll</strong> next to an app user.
                </span>
              </p>
            </div>
          </Card>
        </motion.div>

        <SquadModal
          open={squadModalOpen}
          onClose={() => { setSquadModalOpen(false); setEditingSquad(null); }}
          initial={editingSquad}
          onSave={handleSaveSquad}
          saving={saving}
        />
        <MemberModal
          open={memberModalOpen}
          onClose={closeMemberModal}
          initial={editingMember}
          presetSquadId={memberPresetSquadId}
          presetSquadName={memberPresetSquadName}
          presetProfile={memberPresetProfile}
          profiles={appUsers}
          squads={squads}
          onSave={handleSaveMember}
          saving={saving}
        />
      </div>
    </PageTransition>
  );
}

function SquadModal({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: Squad | null;
  onSave: (name: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    queueMicrotask(() => setName(initial?.name ?? ""));
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    onSave(name.trim());
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit squad" : "Add squad"} size="sm">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Squad name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Squad London" required />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving..." : initial ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function profilesToAssignableActive(profiles: Profile[]): AssignableUser[] {
  return profiles
    .filter((p) => profileIsActive(p))
    .map((p) => ({
      id: p.id,
      full_name: p.full_name?.trim() || p.email?.trim() || "User",
      email: p.email ?? undefined,
      role: p.role,
      is_active: true,
    }));
}

function profileToAssignable(p: Profile): AssignableUser {
  return {
    id: p.id,
    full_name: p.full_name?.trim() || p.email?.trim() || "User",
    email: p.email ?? undefined,
    role: p.role,
    is_active: p.is_active !== false,
  };
}

function MemberModal({
  open,
  onClose,
  initial,
  presetSquadId,
  presetSquadName,
  presetProfile,
  profiles,
  squads,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: TeamMember | null;
  presetSquadId?: string;
  presetSquadName?: string;
  presetProfile?: Profile;
  profiles: Profile[];
  squads: Squad[];
  onSave: (form: Partial<TeamMember>) => void;
  saving: boolean;
}) {
  const [full_name, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<TeamMemberRole>("am");
  const [squad_id, setSquadId] = useState("");
  const [base_salary, setBaseSalary] = useState("");
  const [start_date, setStartDate] = useState("");
  const [status, setStatus] = useState<TeamMemberStatus>("active");
  /** App user link for payroll row (null = explicit no link) */
  const [linkedProfileId, setLinkedProfileId] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState("");

  const pickerUsers = (() => {
    const base = profilesToAssignableActive(profiles);
    if (!initial?.profile_id) return base;
    const linked = profiles.find((p) => p.id === initial.profile_id);
    if (!linked || base.some((u) => u.id === linked.id)) return base;
    return [profileToAssignable(linked), ...base];
  })();

  const filteredPickerUsers = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    let list = q
      ? pickerUsers.filter(
          (u) =>
            u.full_name.toLowerCase().includes(q) ||
            (u.email?.toLowerCase().includes(q) ?? false)
        )
      : pickerUsers;
    if (linkedProfileId && !list.some((u) => u.id === linkedProfileId)) {
      const extra = pickerUsers.find((u) => u.id === linkedProfileId);
      if (extra) list = [extra, ...list];
    }
    return list;
  }, [pickerUsers, profileSearch, linkedProfileId]);

  useEffect(() => {
    if (!open) queueMicrotask(() => setProfileSearch(""));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (initial) {
        setFullName(initial.full_name ?? "");
        setEmail(initial.email ?? "");
        setPhone(initial.phone ?? "");
        setRole(initial.role ?? "am");
        setSquadId(initial.squad_id ?? "");
        setBaseSalary(initial.base_salary != null ? String(initial.base_salary) : "");
        setStartDate(initial.start_date ?? "");
        setStatus(initial.status ?? "active");
        setLinkedProfileId(initial.profile_id ?? null);
      } else {
        setFullName(presetProfile?.full_name ?? "");
        setEmail(presetProfile?.email ?? "");
        setPhone("");
        setRole("am");
        setSquadId(presetSquadId ?? "");
        setBaseSalary("");
        setStartDate("");
        setStatus("active");
        setLinkedProfileId(presetProfile?.id ?? null);
      }
    });
  }, [open, initial, presetSquadId, presetProfile]);

  const handlePickProfile = (id: string | undefined) => {
    setLinkedProfileId(id ?? null);
    if (id) {
      const p = profiles.find((x) => x.id === id);
      if (p) {
        setFullName(p.full_name?.trim() || p.email?.trim() || "");
        setEmail(p.email ?? "");
      }
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!full_name.trim()) {
      toast.error("Full name is required");
      return;
    }
    onSave({
      full_name: full_name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      role,
      squad_id: squad_id || undefined,
      base_salary: base_salary ? parseFloat(base_salary) : undefined,
      start_date: start_date || undefined,
      status,
      profile_id: linkedProfileId,
    });
  };

  const modalTitle = initial
    ? "Edit payroll member"
    : presetProfile
      ? "Add to payroll (app user)"
      : presetSquadName
        ? `Add employee — ${presetSquadName}`
        : "Add payroll member";

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} size="md">
      <form onSubmit={submit} className="p-6 space-y-4">
        {presetProfile && !initial && (
          <p className="text-xs text-text-tertiary rounded-lg bg-surface-hover px-3 py-2 border border-border-light">
            Linking payroll to app login <strong className="text-text-secondary">{presetProfile.email}</strong>
            {presetSquadName ? ` · Squad: ${presetSquadName}` : ""}
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">App user (active)</label>
          <p className="text-[11px] text-text-tertiary mb-2">
            Select someone who can sign in to pre-fill payroll details, or leave empty and type below for someone without an account.
          </p>
          <Input
            value={profileSearch}
            onChange={(e) => setProfileSearch(e.target.value)}
            placeholder="Search name or email…"
            className="mb-2"
          />
          <JobOwnerSelect
            value={linkedProfileId ?? undefined}
            fallbackName={linkedProfileId ? full_name || undefined : undefined}
            users={filteredPickerUsers}
            emptyLabel="None — manual entry"
            onChange={handlePickProfile}
          />
          {profiles.length === 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
              No profiles loaded — check access to <code className="text-text-secondary">profiles</code> or invite users in Settings → Team Members.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Full name</label>
          <Input value={full_name} onChange={(e) => setFullName(e.target.value)} placeholder="John Smith" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@company.com" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 ..." />
        </div>
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as TeamMemberRole)}
          options={(Object.keys(ROLE_LABELS) as TeamMemberRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        <Select
          label="Squad"
          value={squad_id}
          onChange={(e) => setSquadId(e.target.value)}
          options={[{ value: "", label: "— No squad —" }, ...squads.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Base salary (optional)</label>
          <Input type="number" step="0.01" min={0} value={base_salary} onChange={(e) => setBaseSalary(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Start date (optional)</label>
          <Input type="date" value={start_date} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as TeamMemberStatus)}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving..." : initial ? "Update" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
