"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";
import {
  User, Shield, Users, Cog, Save, Plus, Trash2,
  Mail, Phone, Building2, Key, Eye, EyeOff,
  CheckCircle2, AlertTriangle, Lock, Unlock,
  Palette, Globe, Upload, FileText, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { getSupabase } from "@/services/base";
import type { Profile } from "@/types/database";
import type { NavGroup } from "@/lib/constants";
import type { PermissionKey, RoleKey } from "@/types/admin-config";

const settingsTabs = [
  { id: "profile", label: "My Profile" },
  { id: "team", label: "Team Members" },
  { id: "navigation", label: "Navigation" },
  { id: "permissions", label: "Roles & Permissions" },
  { id: "system", label: "System" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("profile");
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          subtitle="Manage your profile, team, and system configuration."
        >
          {isAdmin && (
            <Badge variant="primary" dot size="md">
              Admin Access
            </Badge>
          )}
        </PageHeader>

        <Tabs
          tabs={isAdmin ? settingsTabs : [settingsTabs[0]]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "team" && isAdmin && <TeamTab />}
          {activeTab === "navigation" && isAdmin && <NavigationTab />}
          {activeTab === "permissions" && isAdmin && <PermissionsTab />}
          {activeTab === "system" && isAdmin && <SystemTab />}
        </motion.div>
      </div>
    </PageTransition>
  );
}

function ProfileTab() {
  const { profile, refresh } = useProfile();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    department: "",
    job_title: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    new_password: "",
    confirm: "",
  });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        department: profile.department || "",
        job_title: profile.job_title || "",
      });
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: profile.id,
          email: profile.email,
          full_name: form.full_name,
          phone: form.phone || null,
          department: form.department || null,
          job_title: form.job_title || null,
          role: profile.role,
          is_active: profile.is_active,
        });

      if (error) throw error;
      toast.success("Profile updated successfully");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm) {
      toast.error("Passwords don't match");
      return;
    }
    if (passwordForm.new_password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.new_password,
      });
      if (error) throw error;
      toast.success("Password changed successfully");
      setPasswordForm({ current: "", new_password: "", confirm: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password");
    }
  };

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Profile Info */}
      <div className="lg:col-span-2 space-y-6">
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Personal Information</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-4 mb-6">
              <Avatar name={form.full_name || "User"} size="xl" />
              <div>
                <p className="text-lg font-bold text-text-primary">{form.full_name || "Your Name"}</p>
                <p className="text-sm text-text-tertiary">{form.email}</p>
                {profile?.role && (
                  <Badge variant="primary" size="sm" className="mt-1">
                    {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Full Name</label>
                <Input
                  value={form.full_name}
                  onChange={(e) => update("full_name", e.target.value)}
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
                <Input value={form.email} disabled className="opacity-60 cursor-not-allowed" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="+44 7700 900000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Job Title</label>
                <Input
                  value={form.job_title}
                  onChange={(e) => update("job_title", e.target.value)}
                  placeholder="e.g. Operations Director"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Department</label>
              <Input
                value={form.department}
                onChange={(e) => update("department", e.target.value)}
                placeholder="e.g. Operations"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button
                icon={<Save className="h-3.5 w-3.5" />}
                onClick={handleSaveProfile}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Change Password */}
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Change Password</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <div className="relative">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">New Password</label>
              <Input
                type={showPassword ? "text" : "password"}
                value={passwordForm.new_password}
                onChange={(e) => setPasswordForm((p) => ({ ...p, new_password: e.target.value }))}
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[30px] text-text-tertiary hover:text-text-secondary"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Confirm Password</label>
              <Input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
                placeholder="Confirm new password"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                icon={<Key className="h-3.5 w-3.5" />}
                onClick={handleChangePassword}
                disabled={!passwordForm.new_password || !passwordForm.confirm}
              >
                Update Password
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Activity Sidebar */}
      <div className="space-y-6">
        <Card padding="none">
          <CardHeader className="px-5 pt-5">
            <CardTitle>Account Info</CardTitle>
          </CardHeader>
          <div className="px-5 pb-5 space-y-3">
            <InfoRow label="Member Since" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "-"} />
            <InfoRow label="Last Login" value={profile?.last_login_at ? new Date(profile.last_login_at).toLocaleDateString() : "Current session"} />
            <InfoRow label="Status" value={profile?.is_active ? "Active" : "Inactive"} />
            <InfoRow label="Role" value={profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : "-"} />
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="px-5 pt-5">
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <div className="px-5 pb-5 space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-hover">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-sm text-text-primary">Email Verified</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-hover">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-text-primary">2FA</span>
              </div>
              <Badge variant="warning" size="sm">Not Enabled</Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border-light last:border-0">
      <span className="text-xs font-medium text-text-tertiary">{label}</span>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

function TeamTab() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    async function loadTeam() {
      const supabase = getSupabase();
      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: true });
        setMembers((data ?? []) as Profile[]);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    loadTeam();
  }, []);

  const handleRoleChange = async (memberId: string, newRole: Profile["role"]) => {
    const supabase = getSupabase();
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole })
        .eq("id", memberId);
      if (error) throw error;
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      toast.success("Role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const handleToggleActive = async (member: Profile) => {
    const supabase = getSupabase();
    const newActive = !member.is_active;
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: newActive })
        .eq("id", member.id);
      if (error) throw error;
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, is_active: newActive } : m))
      );
      toast.success(newActive ? "User activated" : "User deactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Team Members</h3>
          <p className="text-sm text-text-tertiary">{members.length} members in your organization</p>
        </div>
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setInviteOpen(true)}>
          Invite Member
        </Button>
      </div>

      <Card padding="none">
        <div className="divide-y divide-border-light">
          {loading && (
            <div className="p-6 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse flex items-center gap-4">
                  <div className="h-10 w-10 bg-surface-tertiary rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-surface-tertiary rounded w-48" />
                    <div className="h-3 bg-surface-tertiary rounded w-32" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && members.length === 0 && (
            <div className="p-12 text-center">
              <Users className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-tertiary">No team members found</p>
            </div>
          )}
          {!loading &&
            members.map((member) => (
              <motion.div
                key={member.id}
                variants={staggerItem}
                className="flex items-center gap-4 px-6 py-4 hover:bg-surface-hover/60 transition-colors"
              >
                <Avatar name={member.full_name} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text-primary">{member.full_name}</p>
                    {!member.is_active && (
                      <Badge variant="default" size="sm">Inactive</Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-tertiary">{member.email}</p>
                  {member.job_title && (
                    <p className="text-xs text-text-tertiary">{member.job_title}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value as Profile["role"])}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="operator">Operator</option>
                  </select>
                  <button
                    onClick={() => handleToggleActive(member)}
                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                      member.is_active
                        ? "text-emerald-600 hover:bg-emerald-50 dark:bg-emerald-950/30"
                        : "text-text-tertiary hover:bg-surface-tertiary"
                    }`}
                    title={member.is_active ? "Deactivate user" : "Activate user"}
                  >
                    {member.is_active ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  </button>
                </div>
              </motion.div>
            ))}
        </div>
      </Card>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function NavigationTab() {
  const { navigation, setNavigation, loading } = useAdminConfig();
  const [localNav, setLocalNav] = useState<NavGroup[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalNav(navigation.length ? navigation : []);
  }, [navigation]);

  const updateGroup = (groupIndex: number, updates: Partial<NavGroup>) => {
    setLocalNav((prev) =>
      prev.map((g, i) => (i === groupIndex ? { ...g, ...updates } : g))
    );
  };

  const updateItem = (groupIndex: number, itemIndex: number, updates: Partial<NavGroup["items"][0]>) => {
    setLocalNav((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? { ...g, items: g.items.map((it, j) => (j === itemIndex ? { ...it, ...updates } : it)) }
          : g
      )
    );
  };

  const addGroup = () => {
    setLocalNav((prev) => [...prev, { label: "New group", items: [] }]);
  };

  const addItem = (groupIndex: number) => {
    setLocalNav((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? { ...g, items: [...g.items, { label: "New item", href: "/", icon: "grid-2x2", permission: "dashboard" }] }
          : g
      )
    );
  };

  const removeGroup = (groupIndex: number) => {
    setLocalNav((prev) => prev.filter((_, i) => i !== groupIndex));
  };

  const removeItem = (groupIndex: number, itemIndex: number) => {
    setLocalNav((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, items: g.items.filter((_, j) => j !== itemIndex) } : g
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setNavigation(localNav);
      toast.success("Navigation saved. Sidebar will update.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const permissionOptions = [
    "dashboard", "requests", "quotes", "jobs", "partners", "accounts", "finance", "settings",
  ];

  if (loading && localNav.length === 0) {
    return (
      <div className="p-8 text-center text-text-tertiary">
        <Cog className="h-8 w-8 animate-spin mx-auto mb-2" />
        Loading navigation...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Navigation (Sidebar)</h3>
          <p className="text-sm text-text-tertiary">Edit menu groups and items. Changes apply by permission per role.</p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="space-y-4">
        {localNav.map((group, gi) => (
          <Card key={gi} padding="md">
            <div className="flex items-center justify-between mb-3">
              <Input
                value={group.label}
                onChange={(e) => updateGroup(gi, { label: e.target.value })}
                placeholder="Group label"
                className="font-semibold max-w-xs"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => addItem(gi)}>+ Item</Button>
                <Button variant="ghost" size="sm" onClick={() => removeGroup(gi)} className="text-red-600">Remove group</Button>
              </div>
            </div>
            <div className="space-y-2 pl-2 border-l-2 border-border-light">
              {group.items.map((item, ii) => (
                <div key={ii} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-surface-hover">
                  <Input value={item.label} onChange={(e) => updateItem(gi, ii, { label: e.target.value })} placeholder="Label" className="w-32" />
                  <Input value={item.href} onChange={(e) => updateItem(gi, ii, { href: e.target.value })} placeholder="/path" className="w-40" />
                  <Input value={item.icon} onChange={(e) => updateItem(gi, ii, { icon: e.target.value })} placeholder="icon name" className="w-28" />
                  <select
                    value={item.permission ?? ""}
                    onChange={(e) => updateItem(gi, ii, { permission: e.target.value || undefined })}
                    className="text-xs px-2 py-1.5 rounded-lg border border-border bg-card"
                  >
                    <option value="">— permission —</option>
                    {permissionOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => removeItem(gi, ii)} className="text-red-600">×</Button>
                </div>
              ))}
            </div>
          </Card>
        ))}
        <Button variant="outline" onClick={addGroup} icon={<Plus className="h-3.5 w-3.5" />}>
          Add group
        </Button>
      </div>
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ email: "", full_name: "", role: "operator" });
  const [sending, setSending] = useState(false);

  const handleInvite = async () => {
    if (!form.email || !form.full_name) {
      toast.error("Please fill in all fields");
      return;
    }
    setSending(true);
    toast.success(`Invitation sent to ${form.email}`);
    setSending(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative bg-card rounded-2xl shadow-modal border border-border w-full max-w-md p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-text-primary">Invite Team Member</h3>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Full Name</label>
          <Input value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="John Smith" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
          <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="john@company.com" />
        </div>
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
          options={[
            { value: "admin", label: "Admin" },
            { value: "manager", label: "Manager" },
            { value: "operator", label: "Operator" },
          ]}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleInvite} disabled={sending} icon={<Mail className="h-3.5 w-3.5" />}>
            {sending ? "Sending..." : "Send Invite"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function PermissionsTab() {
  const roles = [
    {
      name: "Admin",
      description: "Full system access with all permissions",
      color: "text-red-600 bg-red-50 dark:bg-red-950/30",
      permissions: {
        dashboard: true, requests: true, quotes: true, jobs: true,
        partners: true, accounts: true, finance: true, settings: true,
        manage_team: true, manage_roles: true, delete_data: true, export_data: true,
      },
    },
    {
      name: "Manager",
      description: "Operational management with limited admin access",
      color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
      permissions: {
        dashboard: true, requests: true, quotes: true, jobs: true,
        partners: true, accounts: true, finance: true, settings: false,
        manage_team: false, manage_roles: false, delete_data: false, export_data: true,
      },
    },
    {
      name: "Operator",
      description: "Day-to-day operations with read-only finance",
      color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
      permissions: {
        dashboard: true, requests: true, quotes: true, jobs: true,
        partners: false, accounts: false, finance: false, settings: false,
        manage_team: false, manage_roles: false, delete_data: false, export_data: false,
      },
    },
  ];

  const permissionLabels: Record<string, string> = {
    dashboard: "View Dashboard",
    requests: "Manage Requests",
    quotes: "Manage Quotes",
    jobs: "Manage Jobs",
    partners: "Manage Partners",
    accounts: "Manage Accounts",
    finance: "Access Finance",
    settings: "System Settings",
    manage_team: "Manage Team",
    manage_roles: "Manage Roles",
    delete_data: "Delete Records",
    export_data: "Export Data",
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">Roles & Permissions</h3>
        <p className="text-sm text-text-tertiary">Configure what each role can access in the system</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {roles.map((role) => (
          <Card key={role.name} padding="none">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${role.color}`}>
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-base font-bold text-text-primary">{role.name}</p>
                  <p className="text-xs text-text-tertiary">{role.description}</p>
                </div>
              </div>

              <div className="space-y-1.5 mt-4">
                {Object.entries(role.permissions).map(([key, enabled]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-xs font-medium text-text-secondary">
                      {permissionLabels[key]}
                    </span>
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center ${
                      enabled ? "bg-emerald-100 text-emerald-600" : "bg-surface-tertiary text-text-tertiary"
                    }`}>
                      {enabled ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SystemTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: "",
    email: "",
    phone: "",
    address: "",
    website: "",
    vat_number: "",
    vat_percent: "20",
    primary_color: "#F97316",
    tagline: "",
    logo_url: "",
    quote_footer_notes: "",
  });
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const { data } = await supabase.from("company_settings").select("*").limit(1).single();
      if (data) {
        setSettingsId(data.id);
        setForm({
          company_name: data.company_name ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          address: data.address ?? "",
          website: data.website ?? "",
          vat_number: data.vat_number ?? "",
          vat_percent: data.vat_percent != null ? String(data.vat_percent) : "20",
          primary_color: data.primary_color ?? "#F97316",
          tagline: data.tagline ?? "",
          logo_url: data.logo_url ?? "",
          quote_footer_notes: data.quote_footer_notes ?? "",
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const supabase = getSupabase();
      const payload = { ...form, vat_percent: Number(form.vat_percent) || 20 };
      if (settingsId) {
        const { error } = await supabase.from("company_settings").update(payload).eq("id", settingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("company_settings").insert(payload).select().single();
        if (error) throw error;
        setSettingsId(data.id);
      }
      toast.success("Company settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">System Configuration</h3>
        <p className="text-sm text-text-tertiary">Company branding, PDF templates, and system preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Details */}
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Company Details</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Company Name</label>
              <Input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
                <Input value={form.email} onChange={(e) => update("email", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Address</label>
              <Input value={form.address} onChange={(e) => update("address", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Website</label>
                <Input value={form.website} onChange={(e) => update("website", e.target.value)} placeholder="www.company.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">VAT Number</label>
                <Input value={form.vat_number} onChange={(e) => update("vat_number", e.target.value)} placeholder="GB123456789" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">VAT % (quote line items)</label>
              <Input type="number" min={0} max={100} step={0.5} value={form.vat_percent} onChange={(e) => update("vat_percent", e.target.value)} placeholder="20" />
              <p className="text-[10px] text-text-tertiary mt-1">Applied when VAT is ticked on manual quote lines (e.g. 20 for 20%).</p>
            </div>
          </div>
        </Card>

        {/* Branding */}
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Branding & PDF</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Logo URL</label>
              <Input value={form.logo_url} onChange={(e) => update("logo_url", e.target.value)} placeholder="https://your-domain.com/logo.png" />
              {form.logo_url && (
                <div className="mt-2 p-3 rounded-xl bg-surface-hover flex items-center gap-3">
                  <img src={form.logo_url} alt="Logo preview" className="h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className="text-xs text-text-tertiary">Logo preview</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Tagline</label>
              <Input value={form.tagline} onChange={(e) => update("tagline", e.target.value)} placeholder="Professional Property Services" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Brand Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.primary_color} onChange={(e) => update("primary_color", e.target.value)} className="h-10 w-10 rounded-lg border border-border cursor-pointer" />
                <Input value={form.primary_color} onChange={(e) => update("primary_color", e.target.value)} className="flex-1 font-mono" placeholder="#F97316" />
              </div>
              <div className="mt-2 h-2 rounded-full" style={{ backgroundColor: form.primary_color }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Quote Footer Notes</label>
              <textarea
                value={form.quote_footer_notes}
                onChange={(e) => update("quote_footer_notes", e.target.value)}
                placeholder="Default notes to include at the bottom of every quote PDF..."
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none h-20"
              />
            </div>

            <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary">PDF Preview</span>
              </div>
              <p className="text-[11px] text-text-tertiary">
                These settings are used when generating Quote PDFs. Changes apply to all future PDFs sent via the &quot;Send PDF&quot; tab in Quotes.
              </p>
            </div>
          </div>
        </Card>

        {/* Preferences */}
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Cog className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Preferences</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <Select
              label="Currency"
              defaultValue="GBP"
              options={[
                { value: "GBP", label: "GBP (£)" },
                { value: "USD", label: "USD ($)" },
                { value: "EUR", label: "EUR (€)" },
                { value: "BRL", label: "BRL (R$)" },
              ]}
            />
            <Select
              label="Date Format"
              defaultValue="DD/MM/YYYY"
              options={[
                { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
                { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
                { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
              ]}
            />
            <Select
              label="Timezone"
              defaultValue="Europe/London"
              options={[
                { value: "Europe/London", label: "London (GMT)" },
                { value: "America/New_York", label: "New York (EST)" },
                { value: "America/Sao_Paulo", label: "São Paulo (BRT)" },
              ]}
            />
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-hover mt-4">
              <div>
                <p className="text-sm font-medium text-text-primary">Email Notifications</p>
                <p className="text-xs text-text-tertiary">Receive alerts for critical events</p>
              </div>
              <ToggleSwitch defaultChecked />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-hover">
              <div>
                <p className="text-sm font-medium text-text-primary">Auto-assign Jobs</p>
                <p className="text-xs text-text-tertiary">Automatically assign jobs to available partners</p>
              </div>
              <ToggleSwitch />
            </div>
          </div>
        </Card>

        {/* System Info */}
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-text-tertiary" />
              <CardTitle>System Info</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Version</p>
                <p className="text-sm font-bold text-text-primary mt-1">1.0.0</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Environment</p>
                <p className="text-sm font-bold text-text-primary mt-1">Production</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Database</p>
                <p className="text-sm font-bold text-emerald-600 mt-1">Connected</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">API Status</p>
                <p className="text-sm font-bold text-emerald-600 mt-1">Healthy</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Save All */}
      <div className="flex justify-end">
        <Button icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save All Settings"}
        </Button>
      </div>
    </div>
  );
}

function ToggleSwitch({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <button
      onClick={() => setChecked(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
