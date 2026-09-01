"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
  PermissionKey,
  PermissionsByRole,
  RoleKey,
  UserPermissionOverride,
} from "@/types/admin-config";
import { DEFAULT_PERMISSIONS } from "@/services/admin-config";

/**
 * Only keys that actually change what a non-admin sees. Workforce (`team`) and
 * Settings (`settings`) stay OUT on purpose: /people is hard admin-only (nav +
 * server guard) and the Settings admin tabs are role-gated — a checkbox here
 * would promise access the rest of the system refuses to give.
 */
const PAGE_PERMISSIONS: { key: PermissionKey; label: string; hint?: string }[] = [
  { key: "dashboard", label: "Pulse", hint: "Overview dashboard" },
  { key: "jobs", label: "Jobs", hint: "Jobs, Live View & Schedule" },
  { key: "leads", label: "Leads" },
  { key: "quotes", label: "Quotes" },
  { key: "requests", label: "Requests", hint: "Reachable by direct link only" },
  { key: "accounts", label: "Accounts & Clients" },
  { key: "partners", label: "Partners" },
  { key: "finance", label: "Finance", hint: "Billing, expenses, payroll" },
  { key: "service_catalog", label: "Services & pricing" },
];

const ACTION_PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: "manage_team", label: "Manage team" },
  { key: "manage_roles", label: "Manage roles" },
  { key: "delete_data", label: "Delete data" },
  { key: "export_data", label: "Export data" },
];

interface PermissionsPickerProps {
  role: RoleKey;
  /** Merged role matrix from admin_config; falls back to code defaults while loading. */
  matrix?: PermissionsByRole | null;
  /** Current per-user overrides (diff vs the role defaults). */
  value: UserPermissionOverride;
  onChange: (next: UserPermissionOverride) => void;
  disabled?: boolean;
}

/**
 * Per-user access picker. Checkboxes start at the role's defaults; toggling
 * away from the default records an override in `value` (true = grant,
 * false = revoke), toggling back removes it. Admin role is always full
 * access — the engine ignores overrides for admins, so we disable the UI.
 */
export function PermissionsPicker({ role, matrix, value, onChange, disabled }: PermissionsPickerProps) {
  const roleDefaults = useMemo(() => {
    const m = matrix && matrix[role] && Object.keys(matrix[role]).length > 0 ? matrix : DEFAULT_PERMISSIONS;
    return m[role] ?? DEFAULT_PERMISSIONS[role];
  }, [matrix, role]);

  const isAdmin = role === "admin";
  const overrideCount = Object.keys(value).length;

  const toggle = (key: PermissionKey, checked: boolean) => {
    const roleDefault = roleDefaults[key] === true;
    const next: UserPermissionOverride = { ...value };
    if (checked === roleDefault) {
      delete next[key];
    } else {
      next[key] = checked;
    }
    onChange(next);
  };

  const renderGroup = (
    title: string,
    entries: { key: PermissionKey; label: string; hint?: string }[],
  ) => (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">{title}</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {entries.map(({ key, label, hint }) => {
          const effective = isAdmin ? true : key in value ? value[key] === true : roleDefaults[key] === true;
          const overridden = !isAdmin && key in value;
          return (
            <label
              key={key}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-2.5 py-1.5",
                isAdmin || disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-surface-hover/50",
                overridden ? "border-primary/50 bg-primary/5" : "border-border-light",
              )}
            >
              <input
                type="checkbox"
                checked={effective}
                disabled={isAdmin || disabled}
                onChange={(e) => toggle(key, e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-text-primary leading-tight">
                  {label}
                  {overridden && (
                    <span className="ml-1.5 text-[10px] font-semibold text-primary align-middle">override</span>
                  )}
                </span>
                {hint && <span className="block text-[10px] text-text-tertiary leading-tight mt-0.5">{hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {isAdmin ? (
        <p className="text-[11px] text-text-tertiary">
          Admin role always has full access. Pick Manager or Operator to limit what this person sees.
        </p>
      ) : (
        <p className="text-[11px] text-text-tertiary">
          Starts at the {role} defaults. Untick to hide an area from this person, tick to grant one the role
          does not include.
          {overrideCount > 0 && (
            <span className="ml-1 font-medium text-text-secondary">
              {overrideCount} override{overrideCount === 1 ? "" : "s"}.
            </span>
          )}
        </p>
      )}
      {renderGroup("Pages", PAGE_PERMISSIONS)}
      {renderGroup("Actions", ACTION_PERMISSIONS)}
    </div>
  );
}
