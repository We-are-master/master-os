"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Plus, Users, Building2, Loader2, Pencil, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Squad, TeamMember, TeamMemberRole, TeamMemberStatus } from "@/types/database";
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

export default function TeamPage() {
  const [squads, setSquads] = useState<Squad[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [squadModalOpen, setSquadModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingSquad, setEditingSquad] = useState<Squad | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([listSquads(), listTeamMembers()]);
      setSquads(s);
      setMembers(m);
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

  const openAddMember = () => {
    setEditingMember(null);
    setMemberModalOpen(true);
  };

  const openEditMember = (m: TeamMember) => {
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
        });
        toast.success("Member added");
      }
      setMemberModalOpen(false);
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
          <Button size="sm" onClick={openAddMember} icon={<Plus className="h-3.5 w-3.5" />}>
            Add Member
          </Button>
        </PageHeader>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card padding="md">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Squads
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-text-tertiary">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <ul className="space-y-2">
                {squads.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-surface-hover"
                  >
                    <span className="text-sm font-medium text-text-primary">{s.name}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditSquad(s)} icon={<Pencil className="h-3.5 w-3.5" />} />
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteSquad(s.id)} className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} />
                    </div>
                  </li>
                ))}
                {squads.length === 0 && (
                  <p className="text-sm text-text-tertiary py-4">No squads yet. Add one to route requests by postcode.</p>
                )}
              </ul>
            )}
          </Card>

          <Card padding="md">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" /> Members
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-text-tertiary">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-surface-hover flex-wrap gap-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-text-primary">{m.full_name}</p>
                      <p className="text-xs text-text-tertiary">
                        {ROLE_LABELS[m.role]} {m.squad_name ? `· ${m.squad_name}` : ""}
                        {m.base_salary != null ? ` · ${formatCurrency(m.base_salary)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={m.status === "active" ? "success" : "default"} size="sm">
                        {m.status}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => openEditMember(m)} icon={<Pencil className="h-3.5 w-3.5" />} />
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteMember(m.id)} className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} />
                    </div>
                  </li>
                ))}
                {members.length === 0 && (
                  <p className="text-sm text-text-tertiary py-4">No members yet. Add members and assign to squads.</p>
                )}
              </ul>
            )}
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
          onClose={() => { setMemberModalOpen(false); setEditingMember(null); }}
          initial={editingMember}
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
    setName(initial?.name ?? "");
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

function MemberModal({
  open,
  onClose,
  initial,
  squads,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: TeamMember | null;
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

  useEffect(() => {
    if (open) {
      setFullName(initial?.full_name ?? "");
      setEmail(initial?.email ?? "");
      setPhone(initial?.phone ?? "");
      setRole(initial?.role ?? "am");
      setSquadId(initial?.squad_id ?? "");
      setBaseSalary(initial?.base_salary != null ? String(initial.base_salary) : "");
      setStartDate(initial?.start_date ?? "");
      setStatus(initial?.status ?? "active");
    }
  }, [open, initial]);

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
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit member" : "Add member"} size="md">
      <form onSubmit={submit} className="p-6 space-y-4">
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
          options={[{ value: "", label: "— None —" }, ...squads.map((s) => ({ value: s.id, label: s.name }))]}
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
