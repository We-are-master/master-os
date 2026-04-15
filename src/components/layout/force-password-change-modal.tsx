"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";

/**
 * Blocking modal shown when the authenticated user has
 * `profiles.must_change_password = true` (typically because an admin
 * created the account with a temporary password). The user cannot
 * dismiss it — they must set a new password before accessing the app.
 */
export function ForcePasswordChangeModal() {
  const { profile, refresh } = useProfile();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const open = profile?.must_change_password === true;

  const handleSubmit = async () => {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/team/change-own-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to change password");
      }
      toast.success("Password updated");
      setNewPassword("");
      setConfirm("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        /* non-dismissible */
      }}
      title="Change your password"
      subtitle="An admin created your account with a temporary password. Please set a new one to continue."
      size="sm"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs text-text-secondary rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 px-3 py-2">
          <KeyRound className="h-4 w-4 text-amber-600 shrink-0" />
          <span>Minimum 8 characters. You cannot skip this step.</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            New password
          </label>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Confirm new password
          </label>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            icon={submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
          >
            {submitting ? "Saving..." : "Change password"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
