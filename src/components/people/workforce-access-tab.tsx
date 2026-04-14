"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, KeyRound, Shield, UserX, UserCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/services/base";
import type { InternalCost, Profile } from "@/types/database";

interface WorkforceAccessTabProps {
  person: InternalCost;
  /** Called after role/active/password changes so the parent can refresh. */
  onSaved: () => void | Promise<void>;
}

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "operator", label: "Operator" },
];

/**
 * Dashboard access (internal users) tab for the Workforce drawer.
 *
 * States:
 *   - No profile linked → shows a "Create dashboard access" form
 *     (email / role / temp password) that POSTs /api/admin/team/create-user
 *     and links the resulting profile.id back to this payroll row.
 *   - Profile linked → shows role selector, active toggle, reset
 *     password, and deactivate/delete actions.
 */
export function WorkforceAccessTab({ person, onSaved }: WorkforceAccessTabProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Create form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "operator">("operator");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit form
  const [editRole, setEditRole] = useState<"admin" | "manager" | "operator">("operator");
  const [savingRole, setSavingRole] = useState(false);
  const [savingActive, setSavingActive] = useState(false);
  const [resettingPw, setResettingPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const payrollEmail = (() => {
    const p = person.payroll_profile as unknown;
    if (p && typeof p === "object" && "email" in p) {
      const e = (p as { email?: unknown }).email;
      return typeof e === "string" ? e : "";
    }
    return "";
  })();

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      if (!person.profile_id) {
        setProfile(null);
        return;
      }
      const supabase = getSupabase();
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", person.profile_id)
        .maybeSingle();
      setProfile(data as Profile | null);
      if (data) {
        setEditRole((data as Profile).role);
      }
    } finally {
      setLoading(false);
    }
  }, [person.profile_id]);

  useEffect(() => {
    void loadProfile();
    setEmail(payrollEmail);
  }, [loadProfile, payrollEmail]);

  const handleCreate = async () => {
    const fullName = (person.payee_name ?? "").trim();
    if (!fullName) {
      toast.error("Set the person's full name in Profile before creating access");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error("Valid email is required");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/team/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          full_name: fullName,
          role,
          password,
          payroll_internal_cost_id: person.id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create user");
      }
      toast.success(`Dashboard access created. ${fullName} must change password on first login.`);
      setPassword("");
      await onSaved();
      await loadProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const patchProfile = async (
    updates: Record<string, unknown>,
    successMsg: string,
  ): Promise<boolean> => {
    if (!profile) return false;
    const res = await fetch(`/api/admin/team/user/${profile.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to update");
      return false;
    }
    toast.success(successMsg);
    return true;
  };

  const handleRoleSave = async () => {
    if (!profile || editRole === profile.role) return;
    setSavingRole(true);
    try {
      if (await patchProfile({ role: editRole }, "Role updated")) {
        await loadProfile();
      }
    } finally {
      setSavingRole(false);
    }
  };

  const toggleActive = async () => {
    if (!profile) return;
    const next = profile.is_active === false;
    setSavingActive(true);
    try {
      if (
        await patchProfile(
          { is_active: next },
          next ? "User reactivated" : "User deactivated",
        )
      ) {
        await loadProfile();
      }
    } finally {
      setSavingActive(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile) return;
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setResettingPw(true);
    try {
      if (
        await patchProfile(
          { new_password: newPassword },
          "Password reset. User must change on next login.",
        )
      ) {
        setNewPassword("");
        await loadProfile();
      }
    } finally {
      setResettingPw(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!profile) return;
    if (
      !window.confirm(
        `Deactivate ${profile.full_name}? They will no longer be able to sign in. History is preserved.`,
      )
    )
      return;
    setSavingActive(true);
    try {
      const res = await fetch(`/api/admin/team/user/${profile.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to deactivate");
        return;
      }
      toast.success("User deactivated");
      await loadProfile();
    } finally {
      setSavingActive(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // ─── No linked profile — create dashboard access form ───
  if (!profile) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/30 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Shield className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">
                No dashboard access
              </p>
              <p className="text-xs text-text-tertiary mt-0.5">
                This person does not have a Master OS login. Create one below so they can access the web dashboard.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              autoComplete="off"
            />
          </div>
          <div>
            <Select
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              options={ROLE_OPTIONS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Temporary password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              The user will be required to change this on first login.
            </p>
          </div>
          <Button
            onClick={handleCreate}
            disabled={creating}
            icon={
              creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCheck className="h-3.5 w-3.5" />
              )
            }
          >
            {creating ? "Creating..." : "Create dashboard access"}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Profile linked — manage access ───
  const active = profile.is_active !== false;

  return (
    <div className="space-y-5">
      {/* Identity card */}
      <div className="rounded-xl border border-border-light bg-surface-hover/30 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-text-primary">{profile.full_name}</p>
            <p className="text-xs text-text-tertiary">{profile.email}</p>
          </div>
          <Badge variant={active ? "success" : "default"} size="sm">
            {active ? "Active" : "Deactivated"}
          </Badge>
        </div>
        {profile.must_change_password && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <KeyRound className="h-3 w-3" />
            User must change password on next login
          </div>
        )}
      </div>

      {/* Role */}
      <div className="space-y-2">
        <Select
          label="Role"
          value={editRole}
          onChange={(e) => setEditRole(e.target.value as typeof editRole)}
          options={ROLE_OPTIONS}
        />
        {editRole !== profile.role && (
          <Button size="sm" onClick={handleRoleSave} disabled={savingRole}>
            {savingRole ? "Saving..." : "Save role change"}
          </Button>
        )}
      </div>

      {/* Reset password */}
      <div className="space-y-2 rounded-xl border border-border-light p-4">
        <p className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Reset password
        </p>
        <p className="text-[11px] text-text-tertiary">
          Sets a new temporary password. The user will be required to change it on next login.
        </p>
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New temporary password"
          autoComplete="new-password"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleResetPassword}
          disabled={resettingPw || newPassword.length < 8}
        >
          {resettingPw ? "Resetting..." : "Reset password"}
        </Button>
      </div>

      {/* Deactivate / reactivate */}
      <div className="flex flex-col gap-2 rounded-xl border border-border-light p-4">
        <p className="text-xs font-semibold text-text-secondary">Account status</p>
        <p className="text-[11px] text-text-tertiary">
          {active
            ? "Deactivating prevents sign-in but preserves history (jobs, quotes, audit logs)."
            : "Reactivate so the user can sign in again."}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={active ? "outline" : "primary"}
            onClick={toggleActive}
            disabled={savingActive}
            icon={
              active ? (
                <UserX className="h-3.5 w-3.5" />
              ) : (
                <UserCheck className="h-3.5 w-3.5" />
              )
            }
          >
            {active ? "Deactivate" : "Reactivate"}
          </Button>
          {active && (
            <Button
              size="sm"
              variant="danger"
              onClick={handleSoftDelete}
              disabled={savingActive}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Remove access
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
