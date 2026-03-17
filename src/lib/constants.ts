export const APP_NAME = "Master OS";
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
      { label: "Dashboard", href: "/", icon: "grid-2x2" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Requests", href: "/requests", icon: "inbox", badge: 12 },
      { label: "Quotes", href: "/quotes", icon: "file-text" },
      { label: "Jobs", href: "/jobs", icon: "briefcase" },
      { label: "Schedule", href: "/schedule", icon: "calendar" },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { label: "Partners Pipeline", href: "/pipelines/partners", icon: "git-branch" },
      { label: "Corporate Clients", href: "/pipelines/corporate", icon: "building-2" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Clients", href: "/clients", icon: "user-circle" },
      { label: "Partners", href: "/partners", icon: "users" },
      { label: "Accounts", href: "/accounts", icon: "building" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/finance/invoices", icon: "receipt" },
      { label: "Self-billing", href: "/finance/selfbill", icon: "wallet" },
      { label: "Bills", href: "/finance/bills", icon: "file-check" },
      { label: "Payroll", href: "/finance/payroll", icon: "circle-dollar-sign" },
      { label: "Pay Run", href: "/finance/pay-run", icon: "calendar-clock" },
    ],
  },
  { label: "Team", items: [{ label: "Team", href: "/team", icon: "users-2" }] },
  {
    label: "Admin",
    items: [
      { label: "Settings", href: "/settings", icon: "settings" },
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
