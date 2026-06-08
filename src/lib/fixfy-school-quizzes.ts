import type { SchoolPhaseId } from "@/lib/fixfy-school-curriculum";

export type SchoolQuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  /** Index of correct option (0-based). */
  correctIndex: number;
  explanation: string;
};

export const SCHOOL_QUIZ_SIZE = 5;

export const FIXFY_SCHOOL_QUIZZES: Record<SchoolPhaseId, SchoolQuizQuestion[]> = {
  zendesk: [
    {
      id: "zd-1",
      prompt: "Which view do you open first at the start of the day?",
      options: ["Customer Support :: Solved", "Customer Support :: Action Required", "Finance :: Finance Support", "Partner Support :: Inquiries"],
      correctIndex: 1,
      explanation: "Action Required is the triage queue — always pick the oldest ticket at the top.",
    },
    {
      id: "zd-2",
      prompt: "How many active macros exist in Fixfy Zendesk?",
      options: ["4", "5", "6", "8"],
      correctIndex: 2,
      explanation: "The 6 macros: Job, Quote, Complaint, Finance, Cancelled and Solved.",
    },
    {
      id: "zd-3",
      prompt: "Tickets with Finance status are automatically routed to whom?",
      options: ["Carlos", "Isabela", "Victor", "Any agent"],
      correctIndex: 2,
      explanation: "Finance status → Victor. Jobs/ops → Isabela. Quote/new/open → Carlos.",
    },
    {
      id: "zd-4",
      prompt: "To convert a ticket into a Job in the OS, which macro do you apply?",
      options: ["Move to Quote", "Mark as Solved", "Move to Job", "Move to Finance"],
      correctIndex: 2,
      explanation: "Move to Job creates the job in Fixfy OS and syncs the ticket.",
    },
    {
      id: "zd-5",
      prompt: "In the Move to Quote macro, Bid mode means:",
      options: [
        "Manual price straight to the customer, no partner",
        "Sends to partners to bid in the Partner app",
        "Closes the ticket as Solved",
        "Opens a Complaint automatically",
      ],
      correctIndex: 1,
      explanation: "Bid sends the quote to partners. Manual is when ops already has the price.",
    },
  ],
  "fixfy-os": [
    {
      id: "os-1",
      prompt: "What is a Lead in Fixfy OS?",
      options: [
        "A customer enquiry waiting for a quote",
        "Work you offer to partners on Fixfy Trade",
        "An invoice sent to the client",
        "A completed job in the system",
      ],
      correctIndex: 1,
      explanation: "Leads are opportunities published to the partner network — not customer CRM leads.",
    },
    {
      id: "os-2",
      prompt: "What is the most common Quote workflow?",
      options: [
        "Customer approves first, then partner bids",
        "Send to partner → bid back → check margin → customer on same ticket",
        "Lead auto-converts to job",
        "Partner sends proposal directly to customer",
      ],
      correctIndex: 1,
      explanation: "Partner bidding first, margin check, then customer proposal on the same Zendesk ticket.",
    },
    {
      id: "os-3",
      prompt: "Live View vs Schedule — what is the difference?",
      options: [
        "They are the same screen",
        "Live View = real-time triage; Schedule = planning calendar",
        "Schedule shows partners on the map",
        "Live View is only for finance",
      ],
      correctIndex: 1,
      explanation: "Live View is dispatch now. Schedule is capacity planning ahead.",
    },
    {
      id: "os-4",
      prompt: "Which partners can receive job invitations and bids?",
      options: ["Onboarding partners", "Any partner in the directory", "Only Active partners", "Only partners in London"],
      correctIndex: 2,
      explanation: "Only Active partners are eligible for invites and assignments.",
    },
    {
      id: "os-5",
      prompt: "What does Pulse show?",
      options: [
        "Only the live map",
        "Partner compliance documents",
        "KPIs, alerts, live board and financial snapshot",
        "Zendesk ticket inbox",
      ],
      correctIndex: 2,
      explanation: "Pulse is the operations overview — health of the business at a glance.",
    },
  ],
  "trade-portal": [
    {
      id: "tr-1",
      prompt: "What are the two places a partner uses?",
      options: [
        "Fixfy OS and Zendesk",
        "Fixfy Trade website (login) and Fixfy Partner app",
        "Customer portal and Pulse",
        "Email and WhatsApp only",
      ],
      correctIndex: 1,
      explanation: "Trade website for login/apply; Partner app for daily work.",
    },
    {
      id: "tr-2",
      prompt: "When a partner taps Contact on a Lead, it means:",
      options: [
        "The job is confirmed and scheduled",
        "They want to be involved — expression of interest",
        "They reject the opportunity",
        "Payment has been sent",
      ],
      correctIndex: 1,
      explanation: "Contact means interest — ops sees who raised their hand.",
    },
    {
      id: "tr-3",
      prompt: "Does the partner invoice the customer directly?",
      options: [
        "Yes, always",
        "Only for large jobs",
        "No — Fixfy invoices the customer; partner receives self-bill payout",
        "Only limited companies",
      ],
      correctIndex: 2,
      explanation: "Fixfy handles customer billing. Partners get paid via self-bills.",
    },
    {
      id: "tr-4",
      prompt: "Partner status Onboarding means:",
      options: [
        "Fully active and receiving jobs",
        "Application in review — cannot receive work yet",
        "On break voluntarily",
        "Banned from the network",
      ],
      correctIndex: 1,
      explanation: "Onboarding = under review until Fixfy activates the account.",
    },
    {
      id: "tr-5",
      prompt: "When are payouts typically made?",
      options: [
        "Same day as job completion",
        "Monthly only",
        "Regular cycle — typically every two weeks on a Friday",
        "Partners invoice Fixfy weekly by email",
      ],
      correctIndex: 2,
      explanation: "Weekly self-bills grouped; payout on biweekly Friday schedule.",
    },
  ],
};

export function getPhaseQuiz(phaseId: SchoolPhaseId): SchoolQuizQuestion[] {
  return FIXFY_SCHOOL_QUIZZES[phaseId] ?? [];
}

export const SCHOOL_QUIZ_PASS_STARS = 5;
