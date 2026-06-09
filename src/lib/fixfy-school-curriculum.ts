export type SchoolLessonFormat = "html" | "pdf";

export type SchoolLesson = {
  id: string;
  phaseId: SchoolPhaseId;
  title: string;
  description: string;
  format: SchoolLessonFormat;
  /** Path under /public — served as /school/... */
  assetPath: string;
  durationMin: number;
  xp: number;
  order: number;
};

export type SchoolPhaseId = "fixfy-os" | "zendesk" | "trade-portal";

export type SchoolPhase = {
  id: SchoolPhaseId;
  title: string;
  subtitle: string;
  description: string;
  accent: "coral" | "blue" | "emerald";
  order: number;
  lessons: SchoolLesson[];
};

export type SchoolAchievement = {
  id: string;
  title: string;
  description: string;
  emoji: string;
  /** Lesson ids or phase ids required */
  requires: { type: "lesson" | "phase"; id: string }[];
};

export const FIXFY_SCHOOL_PHASES: SchoolPhase[] = [
  {
    id: "zendesk",
    title: "Zendesk Complete",
    subtitle: "Phase 1",
    description: "Tickets, macros, side conversations and how Zendesk connects to Fixfy jobs.",
    accent: "blue",
    order: 1,
    lessons: [
      {
        id: "zendesk-welcome",
        phaseId: "zendesk",
        title: "Welcome & System",
        description: "Team roles, 8-step flow and the agent home screen.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-welcome",
        durationMin: 12,
        xp: 50,
        order: 1,
      },
      {
        id: "zendesk-views",
        phaseId: "zendesk",
        title: "The 9 Views",
        description: "Action Required, Quoting, Jobs, Partner, Finance and more.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-views",
        durationMin: 15,
        xp: 75,
        order: 2,
      },
      {
        id: "zendesk-statuses",
        phaseId: "zendesk",
        title: "Statuses (16)",
        description: "All active statuses and how tickets move between them.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-statuses",
        durationMin: 12,
        xp: 75,
        order: 3,
      },
      {
        id: "zendesk-forms",
        phaseId: "zendesk",
        title: "Forms (7)",
        description: "Required fields for each ticket type.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-forms",
        durationMin: 10,
        xp: 60,
        order: 4,
      },
      {
        id: "zendesk-macros",
        phaseId: "zendesk",
        title: "The 6 Macros",
        description: "Job, Quote, Complaint, Finance, Cancelled, Solved.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-macros",
        durationMin: 18,
        xp: 100,
        order: 5,
      },
      {
        id: "zendesk-workflows",
        phaseId: "zendesk",
        title: "Routing & Workflows",
        description: "Auto-routing to Carlos, Isabela and Victor plus detailed workflows.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-workflows",
        durationMin: 25,
        xp: 125,
        order: 6,
      },
      {
        id: "zendesk-sync",
        phaseId: "zendesk",
        title: "OS Sync",
        description: "Webhooks, sync directions and idempotency.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-sync",
        durationMin: 12,
        xp: 75,
        order: 7,
      },
      {
        id: "zendesk-troubleshoot",
        phaseId: "zendesk",
        title: "Troubleshooting",
        description: "Common errors and when to call dev.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-troubleshoot",
        durationMin: 10,
        xp: 60,
        order: 8,
      },
      {
        id: "zendesk-reference",
        phaseId: "zendesk",
        title: "Reference & FAQ",
        description: "Glossary, FAQ and cheat sheet.",
        format: "html",
        assetPath: "/school/zendesk/guide.en.html#chapter-reference",
        durationMin: 10,
        xp: 100,
        order: 9,
      },
    ],
  },
  {
    id: "fixfy-os",
    title: "Fixfy Operating System",
    subtitle: "Phase 2",
    description: "Learn Pulse, Live View, Leads, Quotes, Jobs, Accounts and Partners — your daily control centre.",
    accent: "coral",
    order: 2,
    lessons: [
      {
        id: "fixfy-os-intro",
        phaseId: "fixfy-os",
        title: "Introduction",
        description: "How Fixfy fits together — the full commercial path from lead to payout.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-intro",
        durationMin: 8,
        xp: 50,
        order: 1,
      },
      {
        id: "fixfy-os-sidebar",
        phaseId: "fixfy-os",
        title: "Sidebar & Navigation",
        description: "What each menu item is for and when to open it.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-sidebar",
        durationMin: 6,
        xp: 40,
        order: 2,
      },
      {
        id: "fixfy-os-pulse",
        phaseId: "fixfy-os",
        title: "Pulse — Operations Overview",
        description: "KPIs, alerts, live board and financial snapshot.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-pulse",
        durationMin: 12,
        xp: 75,
        order: 3,
      },
      {
        id: "fixfy-os-live-view",
        phaseId: "fixfy-os",
        title: "Live View — Live Operations",
        description: "List, Kanban and Map for real-time dispatch.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-live-ops",
        durationMin: 15,
        xp: 100,
        order: 4,
      },
      {
        id: "fixfy-os-leads",
        phaseId: "fixfy-os",
        title: "Leads — work for partners",
        description: "Offer opportunities on Fixfy Trade; partners tap Contact when interested.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-leads",
        durationMin: 10,
        xp: 60,
        order: 5,
      },
      {
        id: "fixfy-os-quotes",
        phaseId: "fixfy-os",
        title: "Quotes — partner first, then customer",
        description: "Send to partner → bid back → check margin → same Zendesk ticket to customer.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-quotes",
        durationMin: 12,
        xp: 75,
        order: 6,
      },
      {
        id: "fixfy-os-jobs",
        phaseId: "fixfy-os",
        title: "Jobs",
        description: "The real work — assignment, execution, reports and billing.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-jobs",
        durationMin: 18,
        xp: 100,
        order: 7,
      },
      {
        id: "fixfy-os-schedule",
        phaseId: "fixfy-os",
        title: "Schedule",
        description: "Planning calendar vs live map — capacity planning.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-schedule",
        durationMin: 8,
        xp: 50,
        order: 8,
      },
      {
        id: "fixfy-os-accounts",
        phaseId: "fixfy-os",
        title: "Accounts",
        description: "Corporate clients, portal users and billing.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-accounts",
        durationMin: 12,
        xp: 75,
        order: 9,
      },
      {
        id: "fixfy-os-partners",
        phaseId: "fixfy-os",
        title: "Partners",
        description: "Trade network, compliance and lifecycle.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-partners",
        durationMin: 12,
        xp: 75,
        order: 10,
      },
      {
        id: "fixfy-os-wrap-up",
        phaseId: "fixfy-os",
        title: "Wrap-up — Day in Ops & FAQ",
        description: "Daily workflow, glossary and common questions.",
        format: "html",
        assetPath: "/school/fixfy-os/guide.html#chapter-wrap-up",
        durationMin: 10,
        xp: 100,
        order: 11,
      },
    ],
  },
  {
    id: "trade-portal",
    title: "Trade Portal",
    subtitle: "Phase 3",
    description: "Partner onboarding, the Fixfy Partner app, leads, bids, documents and payouts.",
    accent: "emerald",
    order: 3,
    lessons: [
      {
        id: "trade-intro",
        phaseId: "trade-portal",
        title: "Fixfy Trade Overview",
        description: "What the partner network is and how the cycle works.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-intro",
        durationMin: 10,
        xp: 50,
        order: 1,
      },
      {
        id: "trade-onboarding",
        phaseId: "trade-portal",
        title: "Apply & Sign in",
        description: "Become a Partner, login code and download the app.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-onboarding",
        durationMin: 12,
        xp: 75,
        order: 2,
      },
      {
        id: "trade-app",
        phaseId: "trade-portal",
        title: "Fixfy Partner App",
        description: "Invitations, schedule, leads, profile and earnings.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-app",
        durationMin: 15,
        xp: 100,
        order: 3,
      },
      {
        id: "trade-leads-bids",
        phaseId: "trade-portal",
        title: "Leads & Bidding",
        description: "Tap Contact on leads; submit prices when invited to bid.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-leads-bids",
        durationMin: 12,
        xp: 100,
        order: 4,
      },
      {
        id: "trade-on-site",
        phaseId: "trade-portal",
        title: "On-site Workflow",
        description: "Accept, travel, start, work, reports and complete.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-on-site",
        durationMin: 18,
        xp: 125,
        order: 5,
      },
      {
        id: "trade-documents",
        phaseId: "trade-portal",
        title: "Documents & Compliance",
        description: "Required files, trade certificates and compliance score.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-documents",
        durationMin: 12,
        xp: 75,
        order: 6,
      },
      {
        id: "trade-payouts",
        phaseId: "trade-portal",
        title: "Payments & Self-bills",
        description: "Weekly self-bills and biweekly payout schedule.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-payouts",
        durationMin: 12,
        xp: 100,
        order: 7,
      },
      {
        id: "trade-rules",
        phaseId: "trade-portal",
        title: "Rules & Expectations",
        description: "Speed, cancellations, quality and coverage.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-rules",
        durationMin: 8,
        xp: 60,
        order: 8,
      },
      {
        id: "trade-faq",
        phaseId: "trade-portal",
        title: "FAQ & Help",
        description: "Common questions and support contact.",
        format: "html",
        assetPath: "/school/trade-portal/guide.html#chapter-faq",
        durationMin: 8,
        xp: 75,
        order: 9,
      },
    ],
  },
];

export const FIXFY_SCHOOL_ACHIEVEMENTS: SchoolAchievement[] = [
  {
    id: "first-lesson",
    title: "First Steps",
    description: "Completed your first lesson.",
    emoji: "🎯",
    requires: [{ type: "lesson", id: "any" }],
  },
  {
    id: "os-graduate",
    title: "OS Graduate",
    description: "Finished Phase 2 — Fixfy Operating System.",
    emoji: "🖥️",
    requires: [{ type: "phase", id: "fixfy-os" }],
  },
  {
    id: "zendesk-pro",
    title: "Zendesk Pro",
    description: "Finished Phase 1 — Zendesk Complete.",
    emoji: "🎫",
    requires: [{ type: "phase", id: "zendesk" }],
  },
  {
    id: "trade-master",
    title: "Trade Master",
    description: "Finished Phase 3 — Trade Portal.",
    emoji: "🔧",
    requires: [{ type: "phase", id: "trade-portal" }],
  },
  {
    id: "fixfy-scholar",
    title: "Fixfy Scholar",
    description: "Completed all three phases. Full certification.",
    emoji: "🏆",
    requires: [
      { type: "phase", id: "fixfy-os" },
      { type: "phase", id: "zendesk" },
      { type: "phase", id: "trade-portal" },
    ],
  },
];

const ALL_LESSONS = FIXFY_SCHOOL_PHASES.flatMap((p) => p.lessons);

export function getSchoolLesson(id: string): SchoolLesson | undefined {
  return ALL_LESSONS.find((l) => l.id === id);
}

export function getSchoolPhase(id: string): SchoolPhase | undefined {
  return FIXFY_SCHOOL_PHASES.find((p) => p.id === id);
}

export function totalSchoolXp(): number {
  return ALL_LESSONS.reduce((s, l) => s + l.xp, 0);
}

export const SCHOOL_XP_PER_LEVEL = 400;

export function levelFromXp(xp: number): { level: number; label: string; progress: number } {
  const level = Math.floor(xp / SCHOOL_XP_PER_LEVEL) + 1;
  const intoLevel = xp % SCHOOL_XP_PER_LEVEL;
  const progress = Math.round((intoLevel / SCHOOL_XP_PER_LEVEL) * 100);
  const labels = ["Rookie", "Operator", "Specialist", "Pro", "Expert", "Master"];
  const label = labels[Math.min(level - 1, labels.length - 1)] ?? "Master";
  return { level, label, progress };
}
