import {
  FIXFY_SCHOOL_PHASES,
  FIXFY_SCHOOL_ACHIEVEMENTS,
  type SchoolAchievement,
  type SchoolLesson,
  type SchoolPhase,
  type SchoolPhaseId,
} from "@/lib/fixfy-school-curriculum";
import { localizeZendeskAssetPath, type SchoolLocale } from "@/lib/fixfy-school-locale";
import {
  FIXFY_SCHOOL_QUIZZES,
  type SchoolQuizQuestion,
} from "@/lib/fixfy-school-quizzes";

const ZENDESK_PHASE_PT: Pick<SchoolPhase, "title" | "description"> = {
  title: "Zendesk Completo",
  description: "Tickets, macros, side conversations e ligação com jobs no Fixfy.",
};

const ZENDESK_LESSONS_PT: Record<string, Pick<SchoolLesson, "title" | "description">> = {
  "zendesk-welcome": {
    title: "Bem-vindo & Sistema",
    description: "Time, fluxo em 8 passos e tela inicial do agente.",
  },
  "zendesk-views": {
    title: "As 9 Views",
    description: "Action Required, Quoting, Jobs, Partner, Finance e mais.",
  },
  "zendesk-statuses": {
    title: "Statuses (16)",
    description: "Todos os status ativos e como tickets se movem.",
  },
  "zendesk-forms": {
    title: "Forms (7)",
    description: "Campos obrigatórios por tipo de ticket.",
  },
  "zendesk-macros": {
    title: "As 6 Macros",
    description: "Job, Quote, Complaint, Finance, Cancelled, Solved.",
  },
  "zendesk-workflows": {
    title: "Routing & Workflows",
    description: "Auto-routing Carlos/Isabela/Victor e workflows detalhados.",
  },
  "zendesk-sync": {
    title: "Sync com o OS",
    description: "Webhooks, direções de sync e idempotência.",
  },
  "zendesk-troubleshoot": {
    title: "Problemas",
    description: "Erros comuns e quando chamar dev.",
  },
  "zendesk-reference": {
    title: "Referência & FAQ",
    description: "Glossário, FAQ e cheat sheet.",
  },
};

const ZENDESK_QUIZ_PT: SchoolQuizQuestion[] = [
  {
    id: "zd-1",
    prompt: "Qual view você abre primeiro no início do dia?",
    options: [
      "Customer Support :: Solved",
      "Customer Support :: Action Required",
      "Finance :: Finance Support",
      "Partner Support :: Inquiries",
    ],
    correctIndex: 1,
    explanation: "Action Required é a fila de triagem — sempre pegue o ticket mais antigo de cima.",
  },
  {
    id: "zd-2",
    prompt: "Quantas macros ativas existem no Fixfy Zendesk?",
    options: ["4", "5", "6", "8"],
    correctIndex: 2,
    explanation: "As 6 macros: Job, Quote, Complaint, Finance, Cancelled e Solved.",
  },
  {
    id: "zd-3",
    prompt: "Tickets com status Finance são roteados automaticamente para quem?",
    options: ["Carlos", "Isabela", "Victor", "Qualquer agente"],
    correctIndex: 2,
    explanation: "Status Finance → Victor. Jobs/ops → Isabela. Quote/new/open → Carlos.",
  },
  {
    id: "zd-4",
    prompt: "Para converter um ticket em Job no OS, qual macro você aplica?",
    options: ["Move to Quote", "Mark as Solved", "Move to Job", "Move to Finance"],
    correctIndex: 2,
    explanation: "Move to Job cria o job no Fixfy OS e sincroniza o ticket.",
  },
  {
    id: "zd-5",
    prompt: "Na macro Move to Quote, o modo Bid significa:",
    options: [
      "Preço manual direto ao cliente, sem partner",
      "Envia para partners licitarem no Partner app",
      "Fecha o ticket como Solved",
      "Abre Complaint automaticamente",
    ],
    correctIndex: 1,
    explanation: "Bid envia o quote para partners. Manual é quando ops já tem o preço.",
  },
];

const ACHIEVEMENTS_PT: Partial<Record<string, Pick<SchoolAchievement, "title" | "description">>> = {
  "zendesk-pro": {
    title: "Zendesk Pro",
    description: "Concluiu a Fase 1 — Zendesk Completo.",
  },
};

function localizeLesson(lesson: SchoolLesson, locale: SchoolLocale): SchoolLesson {
  const pt = locale === "pt" ? ZENDESK_LESSONS_PT[lesson.id] : undefined;
  return {
    ...lesson,
    ...pt,
    assetPath: localizeZendeskAssetPath(lesson.assetPath, locale),
  };
}

function localizePhase(phase: SchoolPhase, locale: SchoolLocale): SchoolPhase {
  const ptMeta = locale === "pt" && phase.id === "zendesk" ? ZENDESK_PHASE_PT : null;
  return {
    ...phase,
    ...ptMeta,
    lessons: phase.lessons.map((l) => localizeLesson(l, locale)),
  };
}

export function getLocalizedPhases(locale: SchoolLocale): SchoolPhase[] {
  return FIXFY_SCHOOL_PHASES.map((p) => localizePhase(p, locale));
}

export function getLocalizedPhase(id: string, locale: SchoolLocale): SchoolPhase | undefined {
  return getLocalizedPhases(locale).find((p) => p.id === id);
}

export function getLocalizedLesson(id: string, locale: SchoolLocale): SchoolLesson | undefined {
  for (const phase of getLocalizedPhases(locale)) {
    const lesson = phase.lessons.find((l) => l.id === id);
    if (lesson) return lesson;
  }
  return undefined;
}

export function getLocalizedQuiz(phaseId: SchoolPhaseId, locale: SchoolLocale): SchoolQuizQuestion[] {
  if (locale === "pt" && phaseId === "zendesk") return ZENDESK_QUIZ_PT;
  return FIXFY_SCHOOL_QUIZZES[phaseId] ?? [];
}

export function getLocalizedAchievements(locale: SchoolLocale): SchoolAchievement[] {
  if (locale === "en") return FIXFY_SCHOOL_ACHIEVEMENTS;
  return FIXFY_SCHOOL_ACHIEVEMENTS.map((a) => ({
    ...a,
    ...ACHIEVEMENTS_PT[a.id],
  }));
}
