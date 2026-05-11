export const APP_NAME = "Fixfy OS";
export const APP_DESCRIPTION = "Master Operations System";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: string | number;
  permission?: string;
  children?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
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
      { label: "Quotes", href: "/quotes", icon: "file-text" },
      { label: "Schedule", href: "/operations/schedule", icon: "calendar-clock" },
      { label: "Jobs", href: "/jobs", icon: "briefcase" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Accounts", href: "/accounts", icon: "building" },
      { label: "Partners", href: "/partners", icon: "users" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Workforce", href: "/people", icon: "contact", permission: "team" },
    ],
  },
  // Users Access (/team) intentionally hidden from sidebar (accessible via settings)
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/finance/invoices", icon: "receipt", permission: "finance" },
      { label: "Self-Billing", href: "/finance/selfbill", icon: "wallet", permission: "finance" },
      { label: "Expenses", href: "/finance/bills", icon: "file-check", permission: "finance" },
      { label: "Payouts", href: "/payout", icon: "calendar-clock", permission: "finance" },
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
