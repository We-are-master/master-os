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
      { label: "Training", href: "/school", icon: "graduation-cap", badge: "New" },
    ],
  },
  // Ordem do dono (10/11/2026): Overview e Live ops | CRM e Inbox | Quotes, Jobs e Schedule.
  // O merge da nav salva tira cada item do grupo antigo e põe aqui; o grupo
  // "Live" antigo fica vazio e some da barra.
  {
    label: "Overview",
    items: [
      { label: "Overview", href: "/", icon: "grid-2x2", permission: "dashboard" },
      { label: "Live", href: "/schedule", icon: "calendar", permission: "jobs" },
    ],
  },
  {
    label: "Sales",
    items: [
      // CRM (06/11/2026): Pipeline e Leads de B2C e B2B em /leads; a tela antiga /crm saiu do menu.
      { label: "CRM", href: "/leads", icon: "user-circle", permission: "leads" },
      // Atendimento do WhatsApp de operação (7983), parceiros e equipe (02/11/2026).
      { label: "Inbox", href: "/inbox", icon: "message-square", permission: "jobs" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Quotes", href: "/quotes", icon: "file-text", permission: "quotes" },
      { label: "Jobs", href: "/jobs", icon: "briefcase", permission: "jobs" },
      { label: "Schedule", href: "/operations/schedule", icon: "calendar-clock", permission: "jobs" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Accounts", href: "/accounts", icon: "building", permission: "accounts" },
      { label: "Clients", href: "/clients", icon: "user-circle", permission: "accounts" },
      { label: "Partners", href: "/partners", icon: "users", permission: "partners" },
      { label: "Workforce", href: "/people", icon: "contact", permission: "team", adminOnly: true },
    ],
  },
  // Users Access (/team) intentionally hidden from sidebar (accessible via settings)
  {
    label: "Finance",
    items: [
      { label: "Billing", href: "/finance/billing", icon: "receipt", permission: "finance" },
      { label: "Expenses", href: "/finance/bills", icon: "file-check", permission: "finance" },
      // O motor de preço (Catalog/Labour/Materials/Quote) mora em Settings →
      // Services; este atalho existe porque cotar é rotina de Finance (dono,
      // 17/08/2026), e /services redireciona pra lá.
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

/**
 * Visitas extras no job card.
 *
 * Ficou desligada enquanto a visita não tinha para onde mandar o dinheiro: o
 * custo do parceiro da visita 2 não entrava em self-bill nenhum. Agora entra:
 * um documento por parceiro, valor contando desde o rascunho e o "done"
 * liberando o pagamento (migrações 274 a 277).
 *
 * O que ainda NÃO existe, e é bom saber antes de usar: o parceiro de uma visita
 * extra recebe o email de confirmação, mas não vê o job no app do parceiro e
 * não envia o relatório dela. Toda query de parceiro lê `jobs.partner_id`, que
 * é o dono da visita 1.
 */
export const JOB_DETAIL_MULTI_VISITS_UI_ENABLED = true;
