import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import type { NavGroup, NavItem } from "@/lib/constants";
import type { PermissionKey, PermissionsByRole, RoleKey, UserPermissionOverride } from "@/types/admin-config";

const SETTINGS_NAV_ITEM = {
  label: "Settings",
  href: "/settings",
  icon: "settings",
  permission: "settings" as const,
};

const PEOPLE_DIRECTORY_ITEM = {
  label: "Workforce",
  href: "/people",
  icon: "contact",
  permission: "team" as const,
};

const TEAM_CORE_ITEM = {
  label: "Users Access",
  href: "/team",
  icon: "users-2",
  permission: "team" as const,
};

const PEOPLE_GROUP_LABEL = "People";
const LEGACY_TEAM_GROUP_LABEL = "Team";

const INBOX_GROUP_LABEL = "Inbox";
const INBOX_HREFS = ["/tickets", "/outreach"] as const;

function defaultInboxItem(href: (typeof INBOX_HREFS)[number]): NavItem {
  if (href === "/tickets") return { label: "Tickets", href: "/tickets", icon: "message-square" };
  return { label: "Outreach", href: "/outreach", icon: "mail-plus" };
}

/** Strip the Inbox group (Tickets + Outreach) from stored nav — hidden from sidebar. */
function relocateInboxItems(nav: NavGroup[]): NavGroup[] {
  return nav
    .filter((g) => g.label !== INBOX_GROUP_LABEL)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.href !== "/tickets" && i.href !== "/outreach"),
    }))
    .filter((g) => g.items.length > 0);
}

const PIPELINE_SIDEBAR_HREFS = new Set(["/pipelines/partners", "/pipelines/corporate"]);

/** Hide partner/corporate pipeline pages from the sidebar (routes remain reachable by URL). */
function removePipelineSidebarNav(nav: NavGroup[]): NavGroup[] {
  return nav
    .filter((g) => g.label !== "Pipeline")
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !PIPELINE_SIDEBAR_HREFS.has(i.href)),
    }))
    .filter((g) => g.items.length > 0);
}

/** Activity log moved to header; drop legacy sidebar link. */
function removeActivitySidebarNav(nav: NavGroup[]): NavGroup[] {
  return nav
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.href !== "/activity"),
    }))
    .filter((g) => g.items.length > 0);
}

/** Applies canonical labels/icons (+ nested children) onto stored rows; keeps orphan links at the end of the group. */
function syncNavItemAgainstCanonical(canonicalItem: NavItem, storedOpt?: NavItem): NavItem {
  const stored = storedOpt ?? { ...canonicalItem, children: undefined };
  let childrenOut: NavItem[] | undefined;
  if (canonicalItem.children?.length) {
    childrenOut = canonicalItem.children.map((ch) => {
      const prev = stored.children?.find((x) => x.href === ch.href);
      const base = prev ?? ch;
      return {
        ...base,
        label: ch.label,
        icon: ch.icon,
        permission: ch.permission ?? base.permission,
      };
    });
  } else if (stored.children?.length) {
    childrenOut = stored.children;
  }

  return {
    ...stored,
    label: canonicalItem.label,
    icon: canonicalItem.icon,
    permission: canonicalItem.permission ?? stored.permission,
    ...(childrenOut !== undefined ? { children: childrenOut } : {}),
  };
}

/** Sync item labels/icons AND order from DEFAULT_NAVIGATION so code-side changes propagate on next load. */
function syncItemLabels(nav: NavGroup[]): NavGroup[] {
  return nav.map((g) => {
    const canonical = DEFAULT_NAVIGATION.find((c) => c.label === g.label);
    if (!canonical) return g;
    const order = new Map(canonical.items.map((i, idx) => [i.href, idx]));
    const canonTopHrefs = new Set(canonical.items.map((i) => i.href));
    const merged = canonical.items.map((cItem) => {
      const stored = g.items.find((x) => x.href === cItem.href);
      return syncNavItemAgainstCanonical(cItem, stored);
    });
    const orphans = g.items.filter((x) => !canonTopHrefs.has(x.href));
    const combined = [...merged, ...orphans];
    combined.sort((a, b) => (order.get(a.href) ?? 999) - (order.get(b.href) ?? 999));
    return { ...g, items: combined };
  });
}

/** Move /schedule out of Operations and into Overview (below Dashboard) if stored there. */
function relocateScheduleToOverview(nav: NavGroup[]): NavGroup[] {
  let scheduleItem: NavItem | undefined;
  const stripped = nav.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (i.href === "/schedule" && g.label !== "Overview") {
        scheduleItem = i;
        return false;
      }
      return true;
    }),
  }));
  if (!scheduleItem) return nav;
  const overviewIdx = stripped.findIndex((g) => g.label === "Overview");
  if (overviewIdx < 0) return nav;
  const alreadyInOverview = stripped[overviewIdx].items.some((i) => i.href === "/schedule");
  if (alreadyInOverview) return stripped;
  const out = stripped.map((g, i) =>
    i === overviewIdx ? { ...g, items: [...g.items, scheduleItem!] } : g
  );
  return out;
}

/** Drop legacy top-level Service catalog link — catalog is a tab inside Settings. */
function stripLegacyServicesNavItem(group: NavGroup): NavGroup {
  if (group.label !== "Admin") return group;
  const items = group.items
    .filter((i) => i.href !== "/services")
    .map((i) => {
      if (i.href !== "/settings") return i;
      const children = i.children?.filter((c) => c.href !== "/services");
      return { ...i, children: children?.length ? children : undefined };
    });
  if (!items.some((i) => i.href === "/settings")) {
    items.unshift({ ...SETTINGS_NAV_ITEM });
  }
  return { ...group, items };
}

/**
 * Migrate stored navigation: Services → Admin; strip duplicates; Team → People; Payroll nav item stripped (hidden).
 */
function normalizeNavigation(nav: NavGroup[]): NavGroup[] {
  // "/finance/pay-run" (legacy Pay Run tab) and "/finance/dashboard" (removed
  // intermediate page) are stripped from any persisted nav so the sidebar
  // reflects the current canonical Finance group without stale entries.
  const strip = new Set([
    "/finance/payroll",
    "/finance/pay-run",
    "/finance/dashboard",
    "/finance/invoices",
    "/finance/selfbill",
    "/team",
    "/requests",
    "/compliance",
    "/ppm",
  ]);
  const next = nav.map((g) => ({
    ...g,
    label: g.label === LEGACY_TEAM_GROUP_LABEL ? PEOPLE_GROUP_LABEL : g.label,
    items: g.items.filter((i) => !strip.has(i.href)),
  }));

  const peopleIdx = next.findIndex((g) => g.label === PEOPLE_GROUP_LABEL);
  if (peopleIdx >= 0) {
    const items = next[peopleIdx].items;
    const extras = items.filter((i) => i.href !== "/people" && i.href !== "/finance/payroll");
    const peopleItem = items.find((i) => i.href === "/people") ?? { ...PEOPLE_DIRECTORY_ITEM };
    next[peopleIdx] = {
      ...next[peopleIdx],
      items: [peopleItem, ...extras],
    };
  } else {
    next.push({
      label: PEOPLE_GROUP_LABEL,
      items: [{ ...PEOPLE_DIRECTORY_ITEM }],
    });
  }

  const adminIdx = next.findIndex((g) => g.label === "Admin");
  if (adminIdx >= 0) {
    const items = [...next[adminIdx].items];
    if (!items.some((i) => i.href === "/settings")) items.unshift({ ...SETTINGS_NAV_ITEM, children: [] });
    next[adminIdx] = stripLegacyServicesNavItem({ ...next[adminIdx], items });
  } else {
    next.push({
      label: "Admin",
      items: [{ ...SETTINGS_NAV_ITEM }],
    });
  }

  const financeIdx = next.findIndex((g) => g.label === "Finance");
  const peopleNavIdx = next.findIndex((g) => g.label === PEOPLE_GROUP_LABEL);
  const canonicalFinance = DEFAULT_NAVIGATION.find((g) => g.label === "Finance");
  if (financeIdx >= 0 && canonicalFinance) {
    const seen = new Set(next[financeIdx].items.map((i) => i.href));
    const merged = [...next[financeIdx].items];
    for (const item of canonicalFinance.items) {
      if (!seen.has(item.href)) {
        merged.push({ ...item });
        seen.add(item.href);
      }
    }
    next[financeIdx] = { ...next[financeIdx], items: merged };
  }
  if (peopleNavIdx >= 0 && financeIdx >= 0 && peopleNavIdx > financeIdx) {
    const [peopleGroup] = next.splice(peopleNavIdx, 1);
    next.splice(financeIdx, 0, peopleGroup);
  }

  const relocated = relocateScheduleToOverview(removePipelineSidebarNav(removeActivitySidebarNav(relocateInboxItems(next))));
  return syncItemLabels(relocated);
}

function mergePermissionsWithDefaults(stored: PermissionsByRole): PermissionsByRole {
  const roles: RoleKey[] = ["admin", "manager", "operator"];
  const out = { ...stored };
  for (const role of roles) {
    out[role] = { ...DEFAULT_PERMISSIONS[role], ...(stored[role] ?? {}) } as Record<PermissionKey, boolean>;
  }
  return out;
}

/** Server/API routes: same merged matrix as client `getAdminConfig("permissions")`. */
export async function loadMergedPermissions(supabase: SupabaseClient): Promise<PermissionsByRole> {
  const { data, error } = await supabase.from("admin_config").select("value").eq("key", "permissions").maybeSingle();
  if (error || !data) return DEFAULT_PERMISSIONS;
  return mergePermissionsWithDefaults(data.value as PermissionsByRole);
}

const DEFAULT_NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Pulse", href: "/", icon: "grid-2x2", permission: "dashboard" },
      { label: "Live View", href: "/schedule", icon: "calendar", permission: "jobs" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Quotes", href: "/quotes", icon: "file-text", permission: "quotes" },
      { label: "Schedule", href: "/operations/schedule", icon: "calendar-clock", permission: "jobs" },
      { label: "Jobs", href: "/jobs", icon: "briefcase", permission: "jobs" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Accounts", href: "/accounts", icon: "building", permission: "accounts" },
      { label: "Partners", href: "/partners", icon: "users", permission: "partners" },
    ],
  },
  {
    label: PEOPLE_GROUP_LABEL,
    items: [
      { label: "Workforce", href: "/people", icon: "contact", permission: "team" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Billing", href: "/finance/billing/invoices", icon: "receipt", permission: "finance" },
      { label: "Expenses", href: "/finance/bills", icon: "file-check", permission: "finance" },
      { label: "Payouts", href: "/payout", icon: "calendar-clock", permission: "finance" },
    ],
  },
  {
    label: "Admin",
    items: [{ ...SETTINGS_NAV_ITEM }],
  },
];

const DEFAULT_PERMISSIONS: PermissionsByRole = {
  admin: {
    dashboard: true,
    requests: true,
    quotes: true,
    jobs: true,
    service_catalog: true,
    partners: true,
    accounts: true,
    finance: true,
    team: true,
    settings: true,
    manage_team: true,
    manage_roles: true,
    delete_data: true,
    export_data: true,
  },
  manager: {
    dashboard: true,
    requests: true,
    quotes: true,
    jobs: true,
    service_catalog: false,
    partners: true,
    accounts: true,
    finance: true,
    team: true,
    settings: false,
    manage_team: false,
    manage_roles: false,
    delete_data: false,
    export_data: true,
  },
  operator: {
    dashboard: true,
    requests: true,
    quotes: true,
    jobs: true,
    service_catalog: false,
    partners: false,
    accounts: false,
    finance: false,
    team: false,
    settings: false,
    manage_team: false,
    manage_roles: false,
    delete_data: false,
    export_data: false,
  },
};

export async function getAdminConfig<K extends keyof { navigation: NavGroup[]; permissions: PermissionsByRole }>(
  key: K
): Promise<K extends "navigation" ? NavGroup[] : K extends "permissions" ? PermissionsByRole : never> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("admin_config").select("value").eq("key", key).maybeSingle();
  if (key === "navigation") {
    if (error || !data) return DEFAULT_NAVIGATION as never;
    return normalizeNavigation(data.value as NavGroup[]) as never;
  }
  if (key === "permissions") {
    if (error || !data) return DEFAULT_PERMISSIONS as never;
    return mergePermissionsWithDefaults(data.value as PermissionsByRole) as never;
  }
  return DEFAULT_PERMISSIONS as never;
}

export async function setAdminConfig(
  key: "navigation" | "permissions",
  value: NavGroup[] | PermissionsByRole
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("admin_config")
    .upsert({ key, value: value as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Persist per-user permission overrides to profiles.custom_permissions. Pass null to clear all overrides. */
export async function saveUserPermissions(
  userId: string,
  overrides: UserPermissionOverride | null
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ custom_permissions: overrides && Object.keys(overrides).length > 0 ? overrides : null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Resolve the effective boolean for a single permission for a given user,
 * applying user overrides on top of the role defaults.
 * Admin role always returns true regardless of overrides.
 */
export function resolvePermission(
  permission: PermissionKey,
  role: RoleKey,
  rolePerms: Record<PermissionKey, boolean>,
  overrides: UserPermissionOverride | null | undefined
): boolean {
  if (role === "admin") return true;
  if (overrides && permission in overrides) return overrides[permission] === true;
  return rolePerms[permission] ?? false;
}

/**
 * Build the full effective permissions map for a user (12 keys → boolean).
 */
export function resolveEffectivePermissions(
  role: RoleKey,
  rolePerms: Record<PermissionKey, boolean>,
  overrides: UserPermissionOverride | null | undefined
): Record<PermissionKey, boolean> {
  const keys = Object.keys(rolePerms) as PermissionKey[];
  return Object.fromEntries(
    keys.map((k) => [k, resolvePermission(k, role, rolePerms, overrides)])
  ) as Record<PermissionKey, boolean>;
}
