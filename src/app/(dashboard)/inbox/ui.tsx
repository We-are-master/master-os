"use client";

/**
 * Peças pequenas da /inbox: chip com ícone e rótulo (o mesmo do VOS, em tudo),
 * botão de ação que nunca quebra ícone e palavra em duas linhas, avatar com o
 * ponto de online, e os ícones das etapas de cotação e job.
 */

import {
  AlarmClock,
  AlertTriangle,
  Ban,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileCheck,
  FilePlus,
  Gavel,
  Hammer,
  Home,
  PauseCircle,
  PoundSterling,
  Radar,
  Send,
  UserRound,
  UserX,
  Wrench,
  XCircle,
  type LucideIcon,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { rotuloDaEtapa, type ConversaDaCaixa, type EtapaDaConversa } from "./tipos";

export type Tom = "slate" | "blue" | "green" | "amber" | "red" | "violet" | "teal" | "pink";

export const TONS: Record<Tom, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
  amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-200",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-200",
  pink: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950/60 dark:text-pink-200",
};

export const PONTO: Record<Tom, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  pink: "bg-pink-500",
};

export const tomValido = (t: string): Tom => (t in TONS ? (t as Tom) : "slate");

export function Chip({ icone: Icone, tom = "slate", children, title }: { icone?: LucideIcon; tom?: Tom; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-[1px] text-[11px] font-medium leading-[18px]", TONS[tom])}>
      {Icone ? <Icone className="h-3 w-3 shrink-0" /> : null}
      {children}
    </span>
  );
}

/** Botão com ícone e palavra na mesma linha, sempre. */
export function Acao({
  icone: Icone,
  children,
  onClick,
  variante = "secundario",
  disabled,
  ativo,
  title,
  className,
}: {
  icone?: LucideIcon;
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variante?: "primario" | "secundario" | "fantasma";
  disabled?: boolean;
  ativo?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variante === "primario" && "bg-primary text-[var(--on-brand)] hover:bg-primary-hover",
        variante === "secundario" && "border border-[var(--line-2)] bg-card text-text-primary hover:bg-surface-secondary",
        variante === "fantasma" && "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
        ativo && "bg-surface-tertiary text-text-primary",
        className,
      )}
    >
      {Icone ? <Icone className="h-3.5 w-3.5 shrink-0" /> : null}
      {children}
    </button>
  );
}

const ICONE_QUOTE: Record<string, LucideIcon> = {
  draft: FilePlus,
  in_survey: ClipboardList,
  bidding: Gavel,
  quote_ready: FileCheck,
  awaiting_customer: Send,
  awaiting_payment: CreditCard,
  rejected: XCircle,
};
const ICONE_JOB: Record<string, LucideIcon> = {
  unassigned: UserX,
  auto_assigning: Radar,
  scheduled: CalendarCheck,
  late: AlarmClock,
  in_progress: Hammer,
  on_hold: PauseCircle,
  need_attention: AlertTriangle,
  final_check: ClipboardCheck,
  awaiting_payment: PoundSterling,
  completed: CheckCircle2,
  cancelled: Ban,
};

export function iconeDaEtapa(grupo: "quote" | "job", status: string): LucideIcon {
  return (grupo === "quote" ? ICONE_QUOTE : ICONE_JOB)[status] ?? ClipboardList;
}

export function tomDaEtapa(grupo: "quote" | "job", status: string): Tom {
  if (["completed"].includes(status)) return "green";
  if (["cancelled", "rejected", "late", "need_attention"].includes(status)) return "red";
  if (["on_hold", "unassigned", "auto_assigning", "awaiting_payment"].includes(status)) return "amber";
  if (["in_progress", "scheduled", "final_check"].includes(status)) return "blue";
  return grupo === "quote" ? "violet" : "slate";
}

export function ChipDaEtapa({ e }: { e: Pick<EtapaDaConversa, "grupo" | "status"> }) {
  return (
    <Chip icone={iconeDaEtapa(e.grupo, e.status)} tom={tomDaEtapa(e.grupo, e.status)} title={e.grupo === "quote" ? "Quote stage" : "Job stage"}>
      {rotuloDaEtapa(e)}
    </Chip>
  );
}

export function ChipDoTipo({ c }: { c: ConversaDaCaixa }) {
  if (c.tipo === "parceiro") return <Chip icone={Wrench} tom="teal">Partner</Chip>;
  if (c.tipo === "cliente") return <Chip icone={Home} tom="violet">Client</Chip>;
  return <Chip icone={UserRound}>{c.cliente ? "No jobs yet" : "Not on file"}</Chip>;
}

const ONLINE_MS = 5 * 60_000;
const DIGITANDO_MS = 30_000;

/** Online/digitando pelo último evento de presença; velho demais não vale. */
export function presencaAgora(c: ConversaDaCaixa, agora: number): "online" | "digitando" | "gravando" | null {
  if (!c.presenca || !c.presencaEm) return null;
  const idade = agora - new Date(c.presencaEm).getTime();
  if ((c.presenca === "digitando" || c.presenca === "gravando") && idade < DIGITANDO_MS) return c.presenca;
  if (c.presenca !== "offline" && idade < ONLINE_MS) return "online";
  return null;
}

const iniciais = (nome: string) =>
  nome.startsWith("+")
    ? "#"
    : nome
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("");

/**
 * Avatar da conversa, como no VOS: iniciais na cor de quem é (parceiro, cliente,
 * outro), o selo verde do WhatsApp embaixo e o ponto de online em cima.
 */
export function Avatar({
  c,
  grande = false,
  tamanho,
  online = false,
  canal = false,
}: {
  c: ConversaDaCaixa;
  grande?: boolean;
  tamanho?: "sm" | "md";
  online?: boolean;
  canal?: boolean;
}) {
  const t = grande ? "lg" : (tamanho ?? "sm");
  return (
    <span className="relative shrink-0">
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-semibold",
          t === "lg" ? "h-14 w-14 text-base" : t === "md" ? "h-10 w-10 text-[13px]" : "h-9 w-9 text-xs",
          c.tipo === "parceiro" && "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200",
          c.tipo === "cliente" && "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
          c.tipo === "outro" && "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        )}
      >
        {iniciais(c.nome)}
      </span>
      {canal ? (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-[#25D366]">
          <MessageCircle className="h-2 w-2 fill-white text-white" />
        </span>
      ) : null}
      {online ? (
        <span
          className={cn(
            "absolute rounded-full border-2 border-card bg-emerald-500",
            canal ? "-right-0.5 -top-0.5 h-3 w-3" : t === "lg" ? "bottom-0 right-0 h-3.5 w-3.5" : "bottom-0 right-0 h-2.5 w-2.5",
          )}
        />
      ) : null}
    </span>
  );
}
