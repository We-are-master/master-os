import { getSupabase } from "./base";
import type { NavGroup, NavItem } from "@/lib/constants";
import type { PermissionKey, PermissionsByRole, RoleKey, UserPermissionOverride } from "@/types/admin-config";

const SERVICES_NAV_ITEM = {
  label: "Services",
  href: "/services",
  icon: "wrench",
  permission: "service_catalog" as const,
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

const SETTINGS_NAV_ITEM = {
  label: "Settings",
  href: "/settings",
  icon: "settings",
  permission: "settings" as const,
};

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

/** Sync item labels/icons from DEFAULT_NAVIGATION so code-side renames propagate on next load. */
function syncItemLabels(nav: NavGroup[]): NavGroup[] {
  const byHref = new Map<string, NavItem>(
    DEFAULT_NAVIGATION.flatMap((g) => g.items.map((i) => [i.href, i]))
  );
  return nav.map((g) => ({
    ...g,
    items: g.items.map((item) => {
      const canonical = byHref.get(item.href);
      return canonical ? { ...item, label: canonical.label, icon: canonical.icon } : item;
    }),
  }));
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

/**
 * Migrate stored navigation: Services → Admin; strip duplicates; Team → People; Payroll nav item stripped (hidden).
 */
function normalizeNavigation(nav: NavGroup[]): NavGroup[] {
  const strip = new Set(["/finance/payroll", "/services"]);
  const next = nav.map((g) => ({
    ...g,
    label: g.label === LEGACY_TEAM_GROUP_LABEL ? PEOPLE_GROUP_LABEL : g.label,
    items: g.items.filter((i) => !strip.has(i.href)),
  }));

  const peopleIdx = next.findIndex((g) => g.label === PEOPLE_GROUP_LABEL);
  if (peopleIdx >= 0) {
    const items = next[peopleIdx].items.map((i) =>
      i.href === "/team" ? { ...i, ...TEAM_CORE_ITEM } : i
    );
    const extras = items.filter(
      (i) => i.href !== "/people" && i.href !== "/team" && i.href !== "/finance/payroll"
    );
    const peopleItem = items.find((i) => i.href === "/people") ?? { ...PEOPLE_DIRECTORY_ITEM };
    const teamItem = items.find((i) => i.href === "/team") ?? { ...TEAM_CORE_ITEM };
    next[peopleIdx] = {
      ...next[peopleIdx],
      items: [peopleItem, teamItem, ...extras],
    };
  } else {
    next.push({
      label: PEOPLE_GROUP_LABEL,
      items: [{ ...PEOPLE_DIRECTORY_ITEM }, { ...TEAM_CORE_ITEM }],
    });
  }

  const adminIdx = next.findIndex((g) => g.label === "Admin");
  if (adminIdx >= 0) {
    const items = [...next[adminIdx].items];
    if (!items.some((i) => i.href === "/services")) items.push({ ...SERVICES_NAV_ITEM });
    if (!items.some((i) => i.href === "/settings")) items.unshift({ ...SETTINGS_NAV_ITEM });
    next[adminIdx] = { ...next[adminIdx], items };
  } else {
    next.push({
      label: "Admin",
      items: [{ ...SETTINGS_NAV_ITEM }, { ...SERVICES_NAV_ITEM }],
    });
  }

  const financeIdx = next.findIndex((g) => g.label === "Finance");
  const peopleNavIdx = next.findIndex((g) => g.label === PEOPLE_GROUP_LABEL);
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

const DEFAULT_NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: "grid-2x2", permission: "dashboard" },
      { label: "Live View", href: "/schedule", icon: "calendar", permission: "jobs" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Requests", href: "/requests", icon: "inbox", permission: "requests" },
      { label: "Quotes", href: "/quotes", icon: "file-text", permission: "quotes" },
      { label: "Jobs", href: "/jobs", icon: "briefcase", permission: "jobs" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Accounts", href: "/accounts", icon: "building", permission: "accounts" },
      { label: "Clients", href: "/clients", icon: "user-circle", permission: "partners" },
      { label: "Partners", href: "/partners", icon: "users", permission: "partners" },
    ],
  },
  {
    label: PEOPLE_GROUP_LABEL,
    items: [
      { label: "Workforce", href: "/people", icon: "contact", permission: "team" },
      { label: "Users Access", href: "/team", icon: "users-2", permission: "team" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/finance/invoices", icon: "receipt", permission: "finance" },
      { label: "Self-billing", href: "/finance/selfbill", icon: "wallet", permission: "finance" },
      { label: "Expenses", href: "/finance/bills", icon: "file-check", permission: "finance" },
      { label: "Payouts", href: "/finance/pay-run", icon: "calendar-clock", permission: "finance" },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Settings", href: "/settings", icon: "settings", permission: "settings" },
      { label: "Services", href: "/services", icon: "wrench", permission: "service_catalog" },
    ],
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
