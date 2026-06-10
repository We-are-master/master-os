import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  CalendarClock,
  ClipboardList,
  DollarSign,
  Users,
} from "lucide-react";

export const SETUP_SECTION_IDS = [
  "working-calendar",
  "operations",
  "finance",
  "partners",
  "workforce",
] as const;

export type SetupSectionId = (typeof SETUP_SECTION_IDS)[number];

export const DEFAULT_SETUP_SECTION: SetupSectionId = "working-calendar";

export type SetupSectionMeta = {
  id: SetupSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  count?: number;
};

export const SETUP_SECTIONS: SetupSectionMeta[] = [
  {
    id: "working-calendar",
    label: "Working calendar",
    description: "Office hours and the days you operate.",
    icon: CalendarClock,
  },
  {
    id: "operations",
    label: "Operations",
    description: "SLA rules, access fees, margins, and job reason presets.",
    icon: AlarmClock,
    count: 6,
  },
  {
    id: "finance",
    label: "Finance",
    description: "Pulse revenue goal and fixed-cost targets.",
    icon: DollarSign,
  },
  {
    id: "partners",
    label: "Partners",
    description: "Payout schedule, levels, and document requirements.",
    icon: Users,
    count: 3,
  },
  {
    id: "workforce",
    label: "Workforce",
    description: "Employee and contractor document rules.",
    icon: ClipboardList,
  },
];

/** Badge on the top-level Setup tab (Operations card count). */
export const SETUP_TAB_BADGE_COUNT = 6;

export function parseSetupSectionFromUrl(param: string | null | undefined): SetupSectionId {
  if (param && SETUP_SECTION_IDS.includes(param as SetupSectionId)) {
    return param as SetupSectionId;
  }
  return DEFAULT_SETUP_SECTION;
}

export function setupSectionMeta(id: SetupSectionId): SetupSectionMeta {
  return SETUP_SECTIONS.find((s) => s.id === id) ?? SETUP_SECTIONS[0]!;
}
