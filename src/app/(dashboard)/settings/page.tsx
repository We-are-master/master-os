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
  Palette, Globe, Upload, FileText, Loader2, Moon, Sun, Image,
  SlidersHorizontal, X, MinusCircle, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { getSupabase } from "@/services/base";
import { listCommissionTiers, listCommissionPoolShares, updateCommissionTier, updateCommissionPoolShare, getCurrentMonthRevenue } from "@/services/tiers";
import { formatCurrency, setAppCurrencyCode } from "@/lib/utils";
import type { Profile, CommissionTier, CommissionPoolShare } from "@/types/database";
import type { NavGroup } from "@/lib/constants";
import type { PermissionKey, RoleKey, PermissionsByRole, UserPermissionOverride } from "@/types/admin-config";
import { saveUserPermissions, resolvePermission } from "@/services/admin-config";
import { AiBriefsTab } from "./ai-briefs-tab";

const settingsTabs = [
  { id: "profile", label: "My Profile" },
  { id: "team", label: "Team Members" },
  { id: "tiers", label: "Commission Tiers" },
  { id: "ai-briefs", label: "AI & Daily brief" },
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
          subtitle={isAdmin ? "The system is modular — only the Admin profile can change navigation, permissions and system configuration. All other profiles use what is configured." : "Manage your profile."}
        >
          {isAdmin && (
            <Badge variant="primary" dot size="md">
              Admin access only
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
          {activeTab === "tiers" && isAdmin && <TiersTab />}
          {activeTab === "ai-briefs" && isAdmin && <AiBriefsTab />}
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
          is_active: profile.is_active !== false,
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
            <InfoRow label="Status" value={profile?.is_active !== false ? "Active" : "Inactive"} />
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

/** DB may store `is_active` as NULL — treat as active (only explicit `false` is inactive). */
function profileIsActive(member: Pick<Profile, "is_active">): boolean {
  return member.is_active !== false;
}

function TeamRoleSelect({
  value,
  onChange,
}: {
  value: Profile["role"];
  onChange: (r: Profile["role"]) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Profile["role"])}
        className="appearance-none min-w-[118px] text-xs font-semibold pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-text-primary shadow-sm hover:bg-surface-hover hover:border-primary/25 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
      >
        <option value="admin">Admin</option>
        <option value="manager">Manager</option>
        <option value="operator">Operator</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
    </div>
  );
}

function TeamTab() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [permTarget, setPermTarget] = useState<Profile | null>(null);
  const { permissions } = useAdminConfig();

  const loadTeam = useCallback(async () => {
    const supabase = getSupabase();
    setLoading(true);
    try {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      setMembers((data ?? []) as Profile[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

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
    const newActive = !profileIsActive(member);
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

  const handlePermissionsSaved = (memberId: string, overrides: UserPermissionOverride | null) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, custom_permissions: overrides } : m))
    );
    setPermTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Team Members</h3>
          <p className="text-sm text-text-tertiary">{members.length} members · click the sliders icon to set per-user permission overrides</p>
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
            members.map((member) => {
              const overrideCount = member.custom_permissions
                ? Object.keys(member.custom_permissions).length
                : 0;
              return (
                <motion.div
                  key={member.id}
                  variants={staggerItem}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-surface-hover/60 transition-colors"
                >
                  <Avatar name={member.full_name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">{member.full_name}</p>
                      {!profileIsActive(member) && (
                        <Badge variant="default" size="sm">Inactive</Badge>
                      )}
                      {overrideCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                          <SlidersHorizontal className="h-2.5 w-2.5" />
                          {overrideCount} override{overrideCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-tertiary">{member.email}</p>
                    {member.job_title && (
                      <p className="text-xs text-text-tertiary">{member.job_title}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <TeamRoleSelect
                      value={member.role}
                      onChange={(r) => handleRoleChange(member.id, r)}
                    />
                    <button
                      onClick={() => setPermTarget(member)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Edit user permissions"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(member)}
                      className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                        profileIsActive(member)
                          ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          : "text-text-tertiary hover:bg-surface-tertiary"
                      }`}
                      title={profileIsActive(member) ? "Deactivate user" : "Activate user"}
                    >
                      {profileIsActive(member) ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>
              );
            })}
        </div>
      </Card>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onInvited={() => void loadTeam()} />}
      {permTarget && (
        <UserPermissionsModal
          member={permTarget}
          permissions={permissions}
          onClose={() => setPermTarget(null)}
          onSaved={handlePermissionsSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-user permission override modal
// ---------------------------------------------------------------------------

const ALL_PERMISSIONS: PermissionKey[] = [
  "dashboard", "requests", "quotes", "jobs", "service_catalog", "partners",
  "accounts", "finance", "team", "settings", "manage_team", "manage_roles",
  "delete_data", "export_data",
];

const PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  { label: "Operations", keys: ["dashboard", "requests", "quotes", "jobs", "service_catalog"] },
  { label: "Network & Finance", keys: ["partners", "accounts", "finance", "team"] },
  { label: "Administration", keys: ["settings", "manage_team", "manage_roles", "delete_data", "export_data"] },
];

function UserPermissionsModal({
  member,
  permissions,
  onClose,
  onSaved,
}: {
  member: Profile;
  permissions: PermissionsByRole;
  onClose: () => void;
  onSaved: (memberId: string, overrides: UserPermissionOverride | null) => void;
}) {
  // localOverrides: null = inherit, true = grant, false = revoke
  const [localOverrides, setLocalOverrides] = useState<Record<PermissionKey, boolean | null>>(() => {
    const base: Record<PermissionKey, boolean | null> = {} as Record<PermissionKey, boolean | null>;
    for (const key of ALL_PERMISSIONS) {
      const existing = member.custom_permissions;
      base[key] = existing && key in existing ? (existing[key] ?? null) : null;
    }
    return base;
  });
  const [saving, setSaving] = useState(false);

  const rolePerms = permissions[member.role as RoleKey] ?? {};
  const isAdmin = member.role === "admin";

  const setState = (key: PermissionKey, value: boolean | null) => {
    setLocalOverrides((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const overrides: UserPermissionOverride = {};
      for (const key of ALL_PERMISSIONS) {
        if (localOverrides[key] !== null) {
          overrides[key] = localOverrides[key] as boolean;
        }
      }
      await saveUserPermissions(member.id, Object.keys(overrides).length > 0 ? overrides : null);
      toast.success(`Permissions saved for ${member.full_name}`);
      onSaved(member.id, Object.keys(overrides).length > 0 ? overrides : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = () => {
    const reset: Record<PermissionKey, boolean | null> = {} as Record<PermissionKey, boolean | null>;
    for (const key of ALL_PERMISSIONS) reset[key] = null;
    setLocalOverrides(reset);
  };

  const overrideCount = Object.values(localOverrides).filter((v) => v !== null).length;
  const grantCount = Object.values(localOverrides).filter((v) => v === true).length;
  const revokeCount = Object.values(localOverrides).filter((v) => v === false).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 260 }}
        className="relative h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border-light">
          <div className="flex items-center gap-3">
            <Avatar name={member.full_name} size="md" />
            <div>
              <p className="text-sm font-bold text-text-primary">{member.full_name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-text-tertiary capitalize">{member.role}</span>
                {overrideCount > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    {overrideCount} override{overrideCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isAdmin ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <Shield className="h-10 w-10 text-red-500 mx-auto mb-3" />
              <p className="text-sm font-semibold text-text-primary">Admin has full access</p>
              <p className="text-xs text-text-tertiary mt-1">Permission overrides cannot be applied to the Admin role.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Legend */}
            <div className="px-6 pt-5 pb-3">
              <p className="text-xs text-text-tertiary mb-3">
                Each permission can be <span className="font-semibold text-text-secondary">inherited</span> from the role default, <span className="font-semibold text-emerald-600">explicitly granted</span>, or <span className="font-semibold text-red-500">explicitly revoked</span> — regardless of what the role allows.
              </p>
              <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-border inline-block" /> Inherited</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Granted</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> Revoked</span>
              </div>
            </div>

            {/* Permission list */}
            <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-4">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">{group.label}</p>
                  <div className="space-y-1">
                    {group.keys.map((key) => {
                      const roleDefault = (rolePerms as Record<string, boolean>)[key] ?? false;
                      const override = localOverrides[key];
                      const effective = override !== null ? override : roleDefault;

                      return (
                        <div key={key} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-surface-hover/60 transition-colors">
                          {/* Effective indicator */}
                          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${effective ? "bg-emerald-500" : "bg-border"}`} />

                          {/* Label + role default */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-text-primary">{permissionLabels[key] ?? key}</p>
                            <p className="text-[10px] text-text-tertiary">
                              Role default: {roleDefault ? "allowed" : "denied"}
                              {override !== null && (
                                <span className={`ml-1 font-semibold ${override ? "text-emerald-600" : "text-red-500"}`}>
                                  · overridden to {override ? "grant" : "revoke"}
                                </span>
                              )}
                            </p>
                          </div>

                          {/* 3-state toggle */}
                          <div className="flex items-center rounded-lg border border-border overflow-hidden text-[10px] font-semibold flex-shrink-0">
                            <button
                              onClick={() => setState(key, null)}
                              className={`px-2 py-1.5 transition-colors ${override === null ? "bg-surface-tertiary text-text-primary" : "text-text-tertiary hover:bg-surface-hover"}`}
                              title="Inherit from role"
                            >
                              Inherit
                            </button>
                            <button
                              onClick={() => setState(key, true)}
                              className={`px-2 py-1.5 transition-colors border-l border-border ${override === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" : "text-text-tertiary hover:bg-surface-hover"}`}
                              title="Always grant"
                            >
                              Grant
                            </button>
                            <button
                              onClick={() => setState(key, false)}
                              className={`px-2 py-1.5 transition-colors border-l border-border ${override === false ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400" : "text-text-tertiary hover:bg-surface-hover"}`}
                              title="Always revoke"
                            >
                              Revoke
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary + footer */}
            <div className="border-t border-border-light p-5 space-y-4">
              {overrideCount > 0 ? (
                <div className="flex items-center justify-between text-xs text-text-tertiary">
                  <span>
                    {grantCount > 0 && <span className="text-emerald-600 font-semibold">{grantCount} granted</span>}
                    {grantCount > 0 && revokeCount > 0 && <span className="mx-1">·</span>}
                    {revokeCount > 0 && <span className="text-red-500 font-semibold">{revokeCount} revoked</span>}
                  </span>
                  <button onClick={handleClearAll} className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors">
                    <MinusCircle className="h-3 w-3" /> Clear all overrides
                  </button>
                </div>
              ) : (
                <p className="text-xs text-text-tertiary text-center">All permissions inherited from role defaults</p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                <Button className="flex-1" onClick={handleSave} disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function TiersTab() {
  const [tiers, setTiers] = useState<CommissionTier[]>([]);
  const [poolShares, setPoolShares] = useState<CommissionPoolShare[]>([]);
  const [revenue, setRevenue] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p, r] = await Promise.all([
        listCommissionTiers(),
        listCommissionPoolShares(),
        getCurrentMonthRevenue(),
      ]);
      setTiers(t);
      setPoolShares(p);
      setRevenue(r);
    } catch {
      toast.error("Failed to load tiers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveTier = async (id: string, breakeven_amount: number, rate_percent: number) => {
    setSavingId(id);
    try {
      await updateCommissionTier(id, { breakeven_amount, rate_percent });
      setTiers((prev) => prev.map((x) => (x.id === id ? { ...x, breakeven_amount, rate_percent } : x)));
      toast.success("Tier updated");
    } catch {
      toast.error("Failed to update tier");
    } finally {
      setSavingId(null);
    }
  };

  const handleSavePool = async (id: string, share_percent: number) => {
    setSavingId(id);
    try {
      await updateCommissionPoolShare(id, { share_percent });
      setPoolShares((prev) => prev.map((x) => (x.id === id ? { ...x, share_percent } : x)));
      toast.success("Pool share updated");
    } catch {
      toast.error("Failed to update pool share");
    } finally {
      setSavingId(null);
    }
  };

  const roleLabel: Record<string, string> = { head_ops: "Head Ops", am: "Account Managers", biz_dev: "Biz Dev" };
  const currentTier = tiers.slice().sort((a, b) => b.breakeven_amount - a.breakeven_amount).find((t) => revenue >= t.breakeven_amount) ?? tiers[0];

  if (loading && tiers.length === 0) {
    return (
      <div className="p-8 text-center text-text-tertiary">
        <Cog className="h-8 w-8 animate-spin mx-auto mb-2" />
        Loading tiers...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">Commission Tiers</h3>
        <p className="text-sm text-text-tertiary">Breakeven and rates per tier. Used by Run Commission in Payroll.</p>
      </div>

      <Card padding="md">
        <h4 className="text-sm font-semibold text-text-primary mb-2">Current month revenue vs tiers</h4>
        <p className="text-2xl font-bold text-primary">{formatCurrency(revenue)}</p>
        <p className="text-xs text-text-tertiary mt-1">
          Current tier: Tier {currentTier?.tier_number ?? "-"} ({currentTier?.rate_percent ?? 0}% on excess above {formatCurrency(currentTier?.breakeven_amount ?? 0)})
        </p>
      </Card>

      <Card padding="md">
        <h4 className="text-sm font-semibold text-text-primary mb-3">Tier structure</h4>
        <div className="space-y-2">
          {tiers.map((t) => (
            <TierRow
              key={t.id}
              tier={t}
              onSave={handleSaveTier}
              saving={savingId === t.id}
            />
          ))}
        </div>
      </Card>

      <Card padding="md">
        <h4 className="text-sm font-semibold text-text-primary mb-3">Pool distribution</h4>
        <p className="text-xs text-text-tertiary mb-3">Share of commission pool by role (must total 100%).</p>
        <div className="space-y-2">
          {poolShares.map((p) => (
            <PoolRow
              key={p.id}
              share={p}
              label={roleLabel[p.role] ?? p.role}
              onSave={handleSavePool}
              saving={savingId === p.id}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function TierRow({
  tier,
  onSave,
  saving,
}: {
  tier: CommissionTier;
  onSave: (id: string, breakeven_amount: number, rate_percent: number) => void;
  saving: boolean;
}) {
  const [breakeven, setBreakeven] = useState(String(tier.breakeven_amount));
  const [rate, setRate] = useState(String(tier.rate_percent));

  useEffect(() => {
    setBreakeven(String(tier.breakeven_amount));
    setRate(String(tier.rate_percent));
  }, [tier.id, tier.breakeven_amount, tier.rate_percent]);

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-surface-hover">
      <span className="text-sm font-medium text-text-primary w-20">Tier {tier.tier_number}</span>
      <Input
        type="number"
        value={breakeven}
        onChange={(e) => setBreakeven(e.target.value)}
        placeholder="Breakeven"
        className="w-28"
      />
      <Input
        type="number"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        placeholder="Rate %"
        className="w-20"
      />
      <Button
        size="sm"
        disabled={saving}
        icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        onClick={() => onSave(tier.id, parseFloat(breakeven) || 0, parseFloat(rate) || 0)}
      >
        Save
      </Button>
    </div>
  );
}

function PoolRow({
  share,
  label,
  onSave,
  saving,
}: {
  share: CommissionPoolShare;
  label: string;
  onSave: (id: string, share_percent: number) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(String(share.share_percent));

  useEffect(() => {
    setVal(String(share.share_percent));
  }, [share.id, share.share_percent]);

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-surface-hover">
      <span className="text-sm font-medium text-text-primary w-32">{label}</span>
      <Input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="%"
        className="w-20"
      />
      <Button
        size="sm"
        disabled={saving}
        icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        onClick={() => onSave(share.id, parseFloat(val) || 0)}
      >
        Save
      </Button>
    </div>
  );
}

function NavigationTab() {
  const { navigation, setNavigation, loading, canEditConfig } = useAdminConfig();
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
    "dashboard", "requests", "quotes", "jobs", "service_catalog", "partners", "accounts", "finance", "team", "settings",
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
          <p className="text-sm text-text-tertiary">The menu is modular. Only Admin can edit groups and items; visibility depends on each role's permissions.</p>
        </div>
        {canEditConfig && (
          <Button size="sm" onClick={handleSave} disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}>
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
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
                disabled={!canEditConfig}
              />
              <div className="flex gap-2">
                {canEditConfig && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => addItem(gi)}>+ Item</Button>
                    <Button variant="ghost" size="sm" onClick={() => removeGroup(gi)} className="text-red-600">Remove group</Button>
                  </>
                )}
              </div>
            </div>
            <div className="space-y-2 pl-2 border-l-2 border-border-light">
              {group.items.map((item, ii) => (
                <div key={ii} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-surface-hover">
                  <Input value={item.label} onChange={(e) => updateItem(gi, ii, { label: e.target.value })} placeholder="Label" className="w-32" disabled={!canEditConfig} />
                  <Input value={item.href} onChange={(e) => updateItem(gi, ii, { href: e.target.value })} placeholder="/path" className="w-40" disabled={!canEditConfig} />
                  <Input value={item.icon} onChange={(e) => updateItem(gi, ii, { icon: e.target.value })} placeholder="icon name" className="w-28" disabled={!canEditConfig} />
                  <select
                    value={item.permission ?? ""}
                    onChange={(e) => updateItem(gi, ii, { permission: e.target.value || undefined })}
                    className="text-xs px-2 py-1.5 rounded-lg border border-border bg-card"
                    disabled={!canEditConfig}
                  >
                    <option value="">— permission —</option>
                    {permissionOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  {canEditConfig && <Button variant="ghost" size="sm" onClick={() => removeItem(gi, ii)} className="text-red-600">×</Button>}
                </div>
              ))}
            </div>
          </Card>
        ))}
        {canEditConfig && (
          <Button variant="outline" onClick={addGroup} icon={<Plus className="h-3.5 w-3.5" />}>
            Add group
          </Button>
        )}
      </div>
    </div>
  );
}

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [form, setForm] = useState({ email: "", full_name: "", role: "operator" });
  const [sending, setSending] = useState(false);

  const handleInvite = async () => {
    if (!form.email?.trim() || !form.full_name?.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: form.role,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Invite failed");
        return;
      }
      toast.success(`Invitation sent to ${form.email.trim()}. They will receive an email to set their password.`);
      onInvited();
      onClose();
      setForm({ email: "", full_name: "", role: "operator" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setSending(false);
    }
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
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Role</label>
          <TeamRoleSelect
            value={form.role as Profile["role"]}
            onChange={(r) => setForm((p) => ({ ...p, role: r }))}
          />
        </div>
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

const ROLE_META: Record<RoleKey, { name: string; description: string; color: string }> = {
  admin: { name: "Admin", description: "Full access; only this profile can change the modular configuration.", color: "text-red-600 bg-red-50 dark:bg-red-950/30" },
  manager: { name: "Manager", description: "Operational management with limited access to settings.", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
  operator: { name: "Operator", description: "Day-to-day operations; access limited to permitted areas.", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" },
};

const permissionLabels: Record<string, string> = {
  dashboard: "Dashboard",
  requests: "Requests",
  quotes: "Quotes",
  jobs: "Jobs",
  service_catalog: "Service catalog (admin pricing templates)",
  partners: "Partners",
  accounts: "Accounts",
  finance: "Finance",
  team: "Team",
  settings: "System Settings",
  manage_team: "Manage Team",
  manage_roles: "Manage Roles",
  delete_data: "Delete Records",
  export_data: "Export Data",
};

function PermissionsTab() {
  const { permissions, setPermissions, canEditConfig } = useAdminConfig();
  const [localPerms, setLocalPerms] = useState<PermissionsByRole>(() => permissions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (Object.keys(permissions).length > 0) setLocalPerms(permissions);
  }, [permissions]);

  const togglePermission = (role: RoleKey, key: PermissionKey) => {
    if (!canEditConfig) return;
    setLocalPerms((prev) => ({
      ...prev,
      [role]: { ...prev[role], [key]: !prev[role][key] },
    }));
  };

  const handleSave = async () => {
    if (!canEditConfig) return;
    setSaving(true);
    try {
      const full: PermissionsByRole = {
        admin: {} as Record<PermissionKey, boolean>,
        manager: {} as Record<PermissionKey, boolean>,
        operator: {} as Record<PermissionKey, boolean>,
      };
      for (const role of roles) {
        for (const key of ALL_PERMISSIONS) {
          full[role][key] = localPerms[role]?.[key] ?? false;
        }
      }
      await setPermissions(full);
      toast.success("Permissions saved. Menu visibility and access are governed by these settings.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const roles: RoleKey[] = ["admin", "manager", "operator"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Roles & Permissions</h3>
          <p className="text-sm text-text-tertiary">The system is modular: each role sees only what is enabled. Only Admin can make changes.</p>
        </div>
        {canEditConfig && (
          <Button size="sm" onClick={handleSave} disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}>
            {saving ? "Saving..." : "Save"}
        </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {roles.map((roleKey) => {
          const meta = ROLE_META[roleKey];
          const perms = localPerms[roleKey] ?? {};
          return (
            <Card key={roleKey} padding="none">
              <div className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${meta.color}`}>
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-text-primary">{meta.name}</p>
                    <p className="text-xs text-text-tertiary">{meta.description}</p>
                  </div>
                </div>

                <div className="space-y-1.5 mt-4">
                  {ALL_PERMISSIONS.map((key) => {
                    const enabled = perms[key];
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-xs font-medium text-text-secondary">
                          {permissionLabels[key] ?? key}
                        </span>
                        {canEditConfig ? (
                          <button
                            type="button"
                            onClick={() => togglePermission(roleKey, key)}
                            className={`h-5 w-5 rounded-full flex items-center justify-center transition-colors ${
                              enabled ? "bg-emerald-100 text-emerald-600" : "bg-surface-tertiary text-text-tertiary"
                            } hover:opacity-80`}
                          >
                            {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3 w-3" />}
                          </button>
                        ) : (
                          <div className={`h-5 w-5 rounded-full flex items-center justify-center ${enabled ? "bg-emerald-100 text-emerald-600" : "bg-surface-tertiary text-text-tertiary"}`}>
                            {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3 w-3" />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SystemTab() {
  const { canEditConfig } = useAdminConfig();
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
    logo_light_theme_url: "",
    logo_dark_theme_url: "",
    favicon_url: "",
    quote_footer_notes: "",
    currency: "GBP",
    job_auto_assign_offer_minutes: "5",
  });
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const { data } = await supabase.from("company_settings").select("*").limit(1).single();
      if (data) {
        setSettingsId(data.id);
        const row = data as typeof data & { currency?: string | null };
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
          logo_light_theme_url: (data as { logo_light_theme_url?: string | null }).logo_light_theme_url ?? "",
          logo_dark_theme_url: (data as { logo_dark_theme_url?: string | null }).logo_dark_theme_url ?? "",
          favicon_url: (data as { favicon_url?: string | null }).favicon_url ?? "",
          quote_footer_notes: data.quote_footer_notes ?? "",
          currency: row.currency && ["GBP", "USD", "EUR", "BRL"].includes(row.currency) ? row.currency : "GBP",
          job_auto_assign_offer_minutes: String(
            (data as { job_auto_assign_offer_minutes?: number | null }).job_auto_assign_offer_minutes ?? 5,
          ),
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleSave = async () => {
    if (!canEditConfig) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const jam = Math.max(1, Math.min(240, Math.floor(Number(form.job_auto_assign_offer_minutes) || 5)));
      const payload = {
        ...form,
        vat_percent: Number(form.vat_percent) || 20,
        currency: ["GBP", "USD", "EUR", "BRL"].includes(form.currency) ? form.currency : "GBP",
        logo_light_theme_url: form.logo_light_theme_url.trim() || null,
        logo_dark_theme_url: form.logo_dark_theme_url.trim() || null,
        favicon_url: form.favicon_url.trim() || null,
        job_auto_assign_offer_minutes: jam,
      };
      if (settingsId) {
        const { error } = await supabase.from("company_settings").update(payload).eq("id", settingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("company_settings").insert(payload).select().single();
        if (error) throw error;
        setSettingsId(data.id);
      }
      setAppCurrencyCode(payload.currency);
      toast.success("Company settings saved");
      window.dispatchEvent(new Event("master-os-company-settings"));
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
        <p className="text-sm text-text-tertiary">Company branding, PDF templates and system preferences. Admin only.</p>
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
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 space-y-3">
              <p className="text-xs font-semibold text-text-primary flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                App sidebar (light / dark theme)
              </p>
              <p className="text-[11px] text-text-tertiary leading-snug">
                The sidebar switches logo when users toggle light or dark mode. Use a light mark on transparent or dark background for <strong>dark theme</strong>, and a dark mark for <strong>light theme</strong>. If one is empty, the other (or the PDF logo below) is used as fallback.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1.5">
                    <Moon className="h-3.5 w-3.5 text-text-tertiary" />
                    Logo — dark theme
                  </label>
                  <Input
                    value={form.logo_dark_theme_url}
                    onChange={(e) => update("logo_dark_theme_url", e.target.value)}
                    placeholder="https://…/logo-dark-mode.png"
                  />
                  {form.logo_dark_theme_url ? (
                    <div className="mt-2 p-3 rounded-xl bg-[#0a0a0a] border border-white/10 flex items-center justify-center min-h-[52px]">
                      <img
                        src={form.logo_dark_theme_url}
                        alt=""
                        className="max-h-9 max-w-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1.5">
                    <Sun className="h-3.5 w-3.5 text-text-tertiary" />
                    Logo — light theme
                  </label>
                  <Input
                    value={form.logo_light_theme_url}
                    onChange={(e) => update("logo_light_theme_url", e.target.value)}
                    placeholder="https://…/logo-light-mode.png"
                  />
                  {form.logo_light_theme_url ? (
                    <div className="mt-2 p-3 rounded-xl bg-white border border-border flex items-center justify-center min-h-[52px]">
                      <img
                        src={form.logo_light_theme_url}
                        alt=""
                        className="max-h-9 max-w-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">PDF &amp; email logo URL</label>
              <Input value={form.logo_url} onChange={(e) => update("logo_url", e.target.value)} placeholder="https://your-domain.com/logo.png" />
              {form.logo_url && (
                <div className="mt-2 p-3 rounded-xl bg-surface-hover flex items-center gap-3">
                  <img src={form.logo_url} alt="Logo preview" className="h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className="text-xs text-text-tertiary">Used on quote PDFs and customer emails only</span>
                </div>
              )}
            </div>
            <div className="p-3 rounded-xl bg-surface-hover border border-border-light space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Image className="h-3.5 w-3.5 text-text-tertiary" />
                Favicon (browser tab)
              </label>
              <p className="text-[11px] text-text-tertiary leading-snug">
                Public URL to a square <strong className="text-text-secondary">.ico</strong>, <strong className="text-text-secondary">.png</strong> or <strong className="text-text-secondary">.svg</strong> (e.g. from your Supabase storage). Leave empty to use the default site icon.
              </p>
              <Input
                value={form.favicon_url}
                onChange={(e) => update("favicon_url", e.target.value)}
                placeholder="https://…/favicon.png"
              />
              {form.favicon_url ? (
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-10 w-10 rounded-lg border border-border bg-card flex items-center justify-center overflow-hidden shrink-0">
                    <img
                      src={form.favicon_url}
                      alt=""
                      className="max-h-8 max-w-8 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-tertiary">Updates the tab icon after you save (all pages).</span>
                </div>
              ) : null}
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
              value={form.currency}
              onChange={(e) => update("currency", e.target.value)}
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
                { value: "America/Sao_Paulo", label: "Sao Paulo (BRT)" },
              ]}
            />
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-hover mt-4">
              <div>
                <p className="text-sm font-medium text-text-primary">Email Notifications</p>
                <p className="text-xs text-text-tertiary">Receive alerts for critical events</p>
              </div>
              <ToggleSwitch defaultChecked />
            </div>
            <div className="rounded-xl border border-border-light bg-card p-3 space-y-2">
              <div>
                <p className="text-sm font-medium text-text-primary">Auto-assign offer window</p>
                <p className="text-xs text-text-tertiary">
                  Default minutes partners have to accept a job when you choose Auto assign (overridable per job).
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={240}
                  className="max-w-[100px]"
                  value={form.job_auto_assign_offer_minutes}
                  onChange={(e) => update("job_auto_assign_offer_minutes", e.target.value)}
                />
                <span className="text-xs text-text-tertiary">minutes</span>
              </div>
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
        <Button
          icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          onClick={handleSave}
          disabled={saving || !canEditConfig}
        >
          {saving ? "Saving..." : "Save Settings"}
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
