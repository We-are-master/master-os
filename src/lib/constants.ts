export const APP_NAME = "Fixfy OS";
export const APP_DESCRIPTION = "Master Operations System";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: string | number;
  permission?: string;
  /** Visible only to the Admin role — never granted to other roles via the
   *  permissions config. Enforced by href in the nav filter so it holds even
   *  for nav saved in the DB without this flag. */
  adminOnly?: boolean;
  children?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    label: "Learn",
    items: [
      { label: "Fixfy School", href: "/school", icon: "graduation-cap", badge: "NEW" },
    ],
  },
  {
    label: "Overview",
    items: [
      { label: "Pulse", href: "/", icon: "grid-2x2" },
      { label: "Live View", href: "/schedule", icon: "calendar" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Leads", href: "/leads", icon: "user-circle" },
      { label: "Quotes", href: "/quotes", icon: "file-text" },
      { label: "Jobs", href: "/jobs", icon: "briefcase" },
      { label: "Schedule", href: "/operations/schedule", icon: "calendar-clock" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Accounts", href: "/accounts", icon: "building" },
      { label: "Partners", href: "/partners", icon: "users" },
      { label: "Workforce", href: "/people", icon: "contact", permission: "team", adminOnly: true },
    ],
  },
  // Users Access (/team) intentionally hidden from sidebar (accessible via settings)
  {
    label: "Finance",
    items: [
      { label: "Billing", href: "/finance/billing", icon: "receipt", permission: "finance" },
      { label: "Expenses", href: "/finance/bills", icon: "file-check", permission: "finance" },
      // Payouts (/payout) hidden for now — billing + expenses cover partner payments.
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Settings", href: "/settings", icon: "settings", permission: "settings" },
    ],
  },
];

/** Hrefs of nav items flagged `adminOnly` — derived from NAVIGATION so it stays
 *  the single source of truth. The nav filter drops these for non-admins by
 *  href, which also covers nav loaded from the DB (which won't carry the flag). */
export const ADMIN_ONLY_NAV_HREFS: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      if (item.adminOnly) set.add(item.href);
      if (item.children?.length) walk(item.children);
    }
  };
  for (const group of NAVIGATION) walk(group.items);
  return set;
})();

export const STATUS_COLORS = {
  active: "emerald",
  pending: "amber",
  inactive: "slate",
  urgent: "red",
  completed: "emerald",
  "in-progress": "blue",
  "on-hold": "amber",
  draft: "slate",
  cancelled: "red",
  paid: "emerald",
  overdue: "red",
  processing: "blue",
} as const;

/** Extra visits tab + ⋮ “Add visit” on job detail — off until multi-visit / recurrence UX is shipped. */
export const JOB_DETAIL_MULTI_VISITS_UI_ENABLED = false;
