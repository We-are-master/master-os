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
  UsersRound,
  UserX,
  MapPin,
  TriangleAlert,
  CalendarClock,
  XCircle,
  type LucideIcon,
  Building2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { rotuloDaEtapa, type ConversaDaCaixa, type EtapaDaConversa, type JobDaCaixa } from "./tipos";

export const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });


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
    <span title={title} className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 text-[11px] font-medium leading-[20px] [&]:border-transparent", TONS[tom])}>
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

/** O ofício do parceiro em uma palavra para a lista: qualquer limpeza vira "Cleaner"; o resto fica como está. */
export function oficioCurto(oficio: string | null | undefined): string | null {
  if (!oficio) return null;
  return /clean/i.test(oficio) ? "Cleaner" : oficio;
}

/**
 * O rótulo curto ao lado do nome na lista: o ofício do parceiro (Cleaner para
 * qualquer limpeza) e, para o resto, o que o contato é: Account, Client, Group ou Lead.
 */
export function rotuloAoLado(c: ConversaDaCaixa): { texto: string; cls: string } | null {
  if (c.tipo === "parceiro") return { texto: oficioCurto(c.parceiro?.oficio) ?? "Partner", cls: "text-teal-700 dark:text-teal-300" };
  if (c.tipo === "conta") return { texto: "Account", cls: "text-blue-700 dark:text-blue-300" };
  if (c.tipo === "cliente") return { texto: "Client", cls: "text-violet-700 dark:text-violet-300" };
  if (c.tipo === "grupo") return { texto: "Group", cls: "text-emerald-700 dark:text-emerald-300" };
  return { texto: "Lead", cls: "text-amber-700 dark:text-amber-300" };
}

export function ChipDoTipo({ c }: { c: ConversaDaCaixa }) {
  if (c.tipo === "conta") return <Chip icone={Building2} tom="blue">Account</Chip>;
  // Parceiro não tem chip: o ofício curto vai ao lado do nome (oficioCurto).
  if (c.tipo === "parceiro") return null;
  if (c.tipo === "cliente") return <Chip icone={Home} tom="violet">Client</Chip>;
  if (c.tipo === "grupo") return <Chip icone={UsersRound} tom="green">Group</Chip>;
  return <Chip icone={UserRound}>{c.cliente ? "No jobs yet" : "Unknown"}</Chip>;
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

/** O glifo do WhatsApp (o mesmo do VOS, icones-de-canal.tsx), em currentColor. */
export function IconeWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="m187.58 144.84l-32-16a8 8 0 0 0-8 .5l-14.69 9.8a40.55 40.55 0 0 1-16-16l9.8-14.69a8 8 0 0 0 .5-8l-16-32A8 8 0 0 0 104 64a40 40 0 0 0-40 40a88.1 88.1 0 0 0 88 88a40 40 0 0 0 40-40a8 8 0 0 0-4.42-7.16M152 176a72.08 72.08 0 0 1-72-72a24 24 0 0 1 19.29-23.54l11.48 23L101 118a8 8 0 0 0-.73 7.51a56.47 56.47 0 0 0 30.15 30.15A8 8 0 0 0 138 155l14.61-9.74l23 11.48A24 24 0 0 1 152 176M128 24a104 104 0 0 0-91.82 152.88l-11.35 34.05a16 16 0 0 0 20.24 20.24l34.05-11.35A104 104 0 1 0 128 24m0 192a87.87 87.87 0 0 1-44.06-11.81a8 8 0 0 0-6.54-.67L40 216l12.47-37.4a8 8 0 0 0-.66-6.54A88 88 0 1 1 128 216"
      />
    </svg>
  );
}

/**
 * O avatar de quem a busca achou (Link, New conversation): a logo da conta em
 * círculo (cliente: a conta a que pertence), a foto do parceiro, ou as
 * iniciais na cor do tipo.
 */
export function AvatarDoAchado({
  a,
  tamanho = "sm",
}: {
  a: { tipo: "conta" | "parceiro" | "cliente" | "lead"; nome: string; logo?: string | null; logoDe?: string | null };
  tamanho?: "sm" | "md";
}) {
  return (
    <span
      title={a.logoDe ?? undefined}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        tamanho === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[10.5px]",
        a.logo
          ? "bg-white ring-1 ring-border-light"
          : a.tipo === "conta"
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
            : a.tipo === "parceiro"
              ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200"
              : a.tipo === "cliente"
                ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {a.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo de bucket/URL externa, tamanho fixo
        <img src={a.logo} alt={a.logoDe ?? ""} className="h-full w-full object-cover" />
      ) : (
        iniciais(a.nome)
      )}
    </span>
  );
}

/** A linha de baixo de quem a busca achou: o postcode primeiro, depois o resto. */
export const linhaDoAchado = (a: { postcode?: string | null; sub: string | null }, ...mais: (string | null | undefined)[]) =>
  [...mais, a.postcode, a.sub].filter(Boolean).join(" · ");

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
    <span className="relative inline-flex h-fit shrink-0 self-start">
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-semibold",
          t === "lg" ? "h-14 w-14 text-base" : t === "md" ? "h-10 w-10 text-[13px]" : "h-9 w-9 text-xs",
          c.tipo === "conta" && "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
          c.tipo === "parceiro" && "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200",
          c.tipo === "cliente" && "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
          c.tipo === "outro" && "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
          c.tipo === "grupo" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
          c.org?.logo && "overflow-hidden ring-1 ring-border-light",
        )}
        title={c.org?.nome}
      >
        {c.org?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo de bucket/URL externa, tamanho fixo; cobre o círculo todo
          <img src={c.org.logo} alt={c.org.nome} className="h-full w-full object-cover" />
        ) : c.tipo === "grupo" ? (
          <UsersRound className={t === "lg" ? "h-6 w-6" : "h-[45%] w-[45%]"} aria-label="Group" />
        ) : (
          iniciais(c.org?.nome ?? c.nome)
        )}
      </span>
      {canal ? (
        <span
          className={cn(
            "absolute -bottom-px -right-px flex items-center justify-center rounded-full bg-[#25D366] text-white ring-2 ring-card",
            t === "sm" ? "h-[15px] w-[15px]" : "h-[17px] w-[17px]",
          )}
          aria-label="WhatsApp"
        >
          <IconeWhatsApp className={t === "sm" ? "h-[10px] w-[10px]" : "h-[11px] w-[11px]"} />
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

/** Trabalho terminado: a etiqueta de chegada some. */
export const JOB_FEITO = new Set(["final_check", "awaiting_payment", "completed", "cancelled", "deleted"]);
const MIN = 60_000;
const atraso = (ms: number) => {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `+${m}m`;
  if (m >= 120) return "+2h+";
  return `+1h${String(m - 60).padStart(2, "0")}`;
};

/**
 * A chegada do job de hoje, na lista: muda sozinha com o relógio. At risk nos
 * últimos 30 min da janela sem começar; Late quando a janela fechou (sem fim de
 * janela: 15 e 30 min depois do início).
 */
export function chegada(j: JobDaCaixa, agora: number): { tom: Tom; icone: LucideIcon; texto: string; title: string; peso: number } | null {
  if (JOB_FEITO.has(j.status)) return null;
  const janela = j.inicio ? `${horaCurta(j.inicio)}${j.fim ? `–${horaCurta(j.fim)}` : ""}` : "";
  if (j.status === "in_progress") return { tom: "green", icone: MapPin, texto: "On site", title: "Partner on site", peso: 0 };
  const ini = j.inicio ? new Date(j.inicio).getTime() : null;
  const fim = j.fim ? new Date(j.fim).getTime() : null;
  const limite = fim ?? (ini !== null ? ini + 30 * MIN : null);
  const risco = fim !== null ? fim - 30 * MIN : ini !== null ? ini + 15 * MIN : null;
  if (j.status === "late" || (limite !== null && agora >= limite)) {
    const passou = limite !== null && agora > limite ? agora - limite : 0;
    return { tom: "red", icone: TriangleAlert, texto: passou ? `Late ${atraso(passou)}` : "Late", title: `Late · not started${janela ? `, window ${janela}` : ""}`, peso: 2 };
  }
  if (risco !== null && agora >= risco) return { tom: "amber", icone: TriangleAlert, texto: `At risk ${janela}`, title: `At risk · window closes ${j.fim ? horaCurta(j.fim) : "soon"}, not started`, peso: 1 };
  return { tom: "blue", icone: CalendarClock, texto: `Today${janela ? ` ${janela}` : ""}`, title: `Arrival window today${janela ? ` ${janela}` : ""}`, peso: 0 };
}

/** A cor de quem fala no grupo, fixa por pessoa (como no WhatsApp). */
const CORES_DO_AUTOR = ["text-teal-700", "text-violet-700", "text-blue-700", "text-amber-700", "text-rose-700", "text-emerald-700", "text-indigo-700", "text-orange-700"];
export function corDoAutor(chave: string) {
  let h = 0;
  for (const ch of chave) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_DO_AUTOR[h % CORES_DO_AUTOR.length];
}

/** Rótulo de quem mandou no grupo: o nome do WhatsApp, senão o número. */
export const nomeDoAutor = (a: { numero: string | null; nome: string | null }) => a.nome || (a.numero ? `+${a.numero}` : "Member");

export type TipoRapido = "todas" | "conta" | "cliente" | "parceiro";

/** Em que aba rápida a conversa cai: conta é Accounts; cliente e lead (outro) são Clients. Grupo só em All. */
export function abaDoTipo(tipo: string): Exclude<TipoRapido, "todas"> | null {
  if (tipo === "conta") return "conta";
  if (tipo === "parceiro") return "parceiro";
  if (tipo === "cliente" || tipo === "outro") return "cliente";
  return null;
}

/** Contagem por aba (All, Accounts, Clients, Partners) para o SeletorDeTipo. */
export function contarPorAba(lista: { tipo: string }[]): Record<TipoRapido, number> {
  const n: Record<TipoRapido, number> = { todas: lista.length, conta: 0, cliente: 0, parceiro: 0 };
  for (const c of lista) {
    const a = abaDoTipo(c.tipo);
    if (a) n[a]++;
  }
  return n;
}

/**
 * All · Accounts · Clients · Partners com a contagem, segmentado (como no VOS). A /inbox e o
 * Atendimento lateral usam o mesmo. Accounts (dono, 10/11/2026) é conta B2B; Clients junta cliente e lead.
 */
export function SeletorDeTipo({
  ativo,
  onTroca,
  n,
  naoLidas,
}: {
  ativo: TipoRapido | null;
  onTroca: (t: TipoRapido) => void;
  n: Record<TipoRapido, number>;
  /** Conversas com mensagem não lida em cada aba: laranja, antes do total. */
  naoLidas?: Record<TipoRapido, number>;
}) {
  const opcoes: [TipoRapido, string, LucideIcon | null][] = [
    ["todas", "All", null],
    ["conta", "Accounts", Building2],
    ["cliente", "Clients", Home],
    ["parceiro", "Partners", Wrench],
  ];
  return (
    <div role="tablist" aria-label="Contact type" className="@container grid grid-cols-4 rounded-lg bg-surface-tertiary p-0.5">
      {opcoes.map(([k, t, Icone]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={ativo === k}
          onClick={() => onTroca(k)}
          className={cn(
            // Quatro abas da mesma largura (dono, 10/11/2026): nada quebra nem vaza; o ícone só entra com espaço.
            "flex h-7 min-w-0 items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap rounded-md px-0.5 text-[12px] font-medium transition-colors",
            ativo === k ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
          )}
        >
          {Icone ? <Icone className="hidden h-3 w-3 shrink-0 @[352px]:block" /> : null}
          <span className="truncate">{t}</span>
          {/* Com não lidas, a bolinha laranja ocupa o lugar do total (dono, 10/11/2026): mesma largura, nada corta nem cobre. */}
          {naoLidas?.[k] ? (
            <span
              className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold tabular-nums leading-none text-white"
              aria-label={`${naoLidas[k]} unread of ${n[k]}`}
              title={`${naoLidas[k]} unread of ${n[k]}`}
            >
              {naoLidas[k]}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{n[k]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
