"use client";

/**
 * A caixa de atendimento do 7983, no desenho do Atendimento do VOS. Lateral:
 * caixas (abertas, esperando, resolvidas), quem (parceiro, cliente, outros),
 * views por tag e o funil de cotação e job (esconde e mostra). No meio, as
 * conversas e a conversa aberta; à direita, quem está falando.
 *
 * Resolver fecha a conversa até o contato escrever de novo. Criar job ou
 * cotação não tem formulário próprio: a gaveta junta o que a conversa sabe e
 * abre o formulário de sempre já preenchido (src/lib/inbox/prefill.ts).
 * Oferecer job a parceiro é o assign do Jobs. A tela recarrega a cada 10 s.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, MotionConfig, motion as mo } from "framer-motion";
import {
  Briefcase,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Home,
  Archive,
  Clock3,
  CircleAlert,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  ArchiveRestore,
  Inbox,
  MoreHorizontal,
  Link2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Send,
  Smartphone,
  Tag,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Wrench,
  X,
  Building2,
  MailOpen,
  MessageSquarePlus,
  Pin,
  PinOff,
  Pencil,
  Reply,
  Smile,
  type LucideIcon,
} from "lucide-react";
import { guardarPrefill, type TipoDoPrefill } from "@/lib/inbox/prefill";
import { cn } from "@/lib/utils";
import "./inbox.css";
import { Composer } from "./composer";
import { PlayerDeAudio } from "./player-de-audio";
import { NovaConversa, type Escolhido } from "./novo-contato";
import { CHIP, flutuante, tempo } from "./movimento";
import { LinkDeJob } from "./link-de-job";
import { Modal } from "@/components/ui/modal";
import type { MembroDaEquipe } from "@/lib/inbox/equipe";
import { GavetaDeCriar, OfertaDeJob, Painel, ZENDESK, horaCurta, ticketDe } from "./painel";
import { ETAPAS_DE_JOB, ETAPAS_DE_QUOTE, type ConversaDaCaixa, type JobParaOferecer, type MensagemDaCaixa, type TagDaCaixa } from "./tipos";
import { FILTROS_VAZIOS, FiltrosAtivos, PainelDeFiltros, passaNosFiltros, quantosFiltros, SEM_DONO, type Filtros } from "./filtros";
import { Acao, Avatar, Chip, JOB_FEITO, rotuloAoLado, SeletorDeTipo, type TipoRapido, ChipDaEtapa, chegada, corDoAutor, nomeDoAutor, PONTO, iconeDaEtapa, presencaAgora, type Tom } from "./ui";

/** A visão da lateral. Uma por vez, como no VOS. */
type Visao =
  | { k: "abertas" }
  | { k: "esperando" }
  | { k: "resolvidas" }
  | { k: "arquivadas" }
  | { k: "excluidas" }
  | { k: "todas" }
  | { k: "hoje" }
  | { k: "tag"; nome: string }
  | { k: "pessoa"; id: string }
  | { k: "sem_dono" }
  | { k: "etapa"; grupo: "quote" | "job"; status: string };
type Tipo = "todas" | "conta" | "parceiro" | "cliente" | "outro" | "grupo";
/** "Clients" no seletor rápido: cliente, conta e lead juntos (só parceiro e grupo ficam de fora). */
const TIPOS_CLIENTE = ["cliente", "conta", "outro"] as const;
type Gaveta = { k: "criar"; tipo: TipoDoPrefill } | { k: "oferecer" } | null;

const JANELA_MS = 24 * 60 * 60 * 1000;
const CHAVE_ETAPAS = "fixfy:inbox:etapas";
export const SO_ROTULO = new Set(["Photo", "Voice note", "Video", "Audio", "Sticker"]);

/** "10h", "2d", "12:54" hoje: o tempo da lista, como no VOS. */
export const quandoNaLista = (iso: string, agora: number) => {
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const mesmoDia = new Date(iso).toDateString() === new Date(agora).toDateString();
  if (mesmoDia) return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  const d = Math.floor(min / 1440);
  return d < 1 ? `${Math.round(min / 60)}h` : d < 7 ? `${d}d` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
export const diaDaMensagemOuHoje = (iso: string) => {
  const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (dia(new Date(iso)) === dia(hoje)) return "Today";
  if (dia(new Date(iso)) === dia(ontem)) return "Yesterday";
  return diaDaMensagem(iso);
};
const diaDaMensagem = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short" });
const haQuanto = (iso: string, agora: number) => {
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const esperando = (c: ConversaDaCaixa) => c.mensagens[c.mensagens.length - 1]?.direcao === "entrada";
const naoRespondidas = (c: ConversaDaCaixa) => {
  let n = 0;
  for (let i = c.mensagens.length - 1; i >= 0 && c.mensagens[i].direcao === "entrada"; i--) n++;
  return n;
};
/** O contador da lista: entradas depois da última leitura (ou da nossa última resposta). "Mark as unread" vale 1. */
export const naoLidas = (c: ConversaDaCaixa) => {
  let n = 0;
  for (let i = c.mensagens.length - 1; i >= 0; i--) {
    const m = c.mensagens[i];
    if (m.direcao !== "entrada" || (c.lidaEm && m.criadoEm <= c.lidaEm)) break;
    n++;
  }
  return n || (c.naoLida ? 1 : 0);
};
/** Resolvida até o contato escrever depois do "resolver". */
const resolvida = (c: ConversaDaCaixa) => Boolean(c.resolvidaEm && (!c.ultimaEntradaEm || c.ultimaEntradaEm <= c.resolvidaEm));
/** Arquivada fica fora da caixa até desarquivar. */
const arquivada = (c: ConversaDaCaixa) => Boolean(c.arquivadaEm);
/** Excluída some até o contato escrever de novo (como no WhatsApp). */
const excluida = (c: ConversaDaCaixa) => Boolean(c.excluidaEm && (!c.ultimaEntradaEm || c.ultimaEntradaEm <= c.excluidaEm));
export const fora = (c: ConversaDaCaixa) => arquivada(c) || excluida(c);
const janelaAberta = (c: ConversaDaCaixa) => Boolean(c.ultimaEntradaEm && Date.now() - new Date(c.ultimaEntradaEm).getTime() < JANELA_MS);

function passa(c: ConversaDaCaixa, v: Visao): boolean {
  if (v.k === "arquivadas") return arquivada(c);
  if (v.k === "excluidas") return excluida(c);
  if (fora(c)) return false;
  switch (v.k) {
    case "abertas":
      return !resolvida(c);
    case "esperando":
      return !resolvida(c) && esperando(c);
    case "resolvidas":
      return resolvida(c);
    case "todas":
      return true;
    case "hoje":
      return Boolean(c.jobHoje);
    case "tag":
      return c.tags.includes(v.nome);
    case "pessoa":
      return !resolvida(c) && c.atribuidaA === v.id;
    case "sem_dono":
      return !resolvida(c) && !c.atribuidaA;
    case "etapa":
      return c.etapa?.grupo === v.grupo && c.etapa.status === v.status;
  }
}
/** O job que a conversa trata: o de hoje, senão o atual do cliente, senão o próximo do parceiro. */
/** Os jobs ainda abertos e com data da conversa, do mais próximo para o mais longe. */
function jobsAbertos(c: ConversaDaCaixa) {
  return c.jobs
    .filter((j) => j.data && !JOB_FEITO.has(j.status))
    .sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "") || (a.inicio ?? "~").localeCompare(b.inicio ?? "~"));
}

function jobDaConversa(c: ConversaDaCaixa): { id: string; ref: string } | null {
  if (c.jobHoje) return c.jobHoje;
  if (c.etapa?.grupo === "job") return c.etapa;
  return c.tipo === "parceiro" ? (c.jobs[0] ?? null) : null;
}
/** A conversa vazia de quem ainda não recebeu nada: o composer manda, o refresh traz o resto. */
export function conversaRascunho(e: Escolhido): ConversaDaCaixa {
  return {
    contato: e.numero,
    nome: e.nome,
    perfil: null,
    tipo: e.tipo === "conta" || e.tipo === "parceiro" || e.tipo === "cliente" || e.tipo === "grupo" ? e.tipo : "outro",
    ultimaEntradaEm: null,
    mensagens: [],
    resolvidaEm: null,
    arquivadaEm: null,
    excluidaEm: null,
    tags: [],
    presenca: null,
    presencaEm: null,
    lidaEm: null,
    naoLida: false,
    fixadaEm: null,
    atribuidaA: null,
    org: null,
    parceiro: null,
    cliente: null,
    jobs: [],
    jobHoje: null,
    etapa: null,
    quotes: [],
    faturas: [],
  };
}
const mesmaVisao = (a: Visao, b: Visao) => JSON.stringify(a) === JSON.stringify(b);


async function postarConversa(corpo: Record<string, unknown>) {
  const res = await fetch("/api/inbox/conversa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
}

function ItemCurto({ icone: Icone, rotulo, onClick, disabled }: { icone: LucideIcon; rotulo: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-secondary disabled:opacity-40"
    >
      <Icone className="h-4 w-4 shrink-0 text-text-tertiary" />
      {rotulo}
    </button>
  );
}

function ItemDaLateral({
  ativo,
  onClick,
  icone: Icone,
  ponto,
  rotulo,
  n,
  apagado,
  avatar,
  marcado,
}: {
  ativo: boolean;
  /** Filtro ligado (Team, Contacts, Tags): liga e desliga, soma por cima da view. */
  marcado?: boolean;
  onClick: () => void;
  icone?: LucideIcon;
  avatar?: React.ReactNode;
  ponto?: Tom;
  rotulo: string;
  n: number;
  apagado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13.5px] transition-colors",
        ativo || marcado ? "bg-surface-tertiary font-semibold text-text-primary" : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
        apagado && !ativo && "opacity-55",
      )}
    >
      {ativo ? <mo.span layoutId="inbox-lateral-ativa" transition={tempo("lg")} className="absolute -left-2 inset-y-1.5 w-[3px] rounded-r-full bg-primary" /> : null}
      {Icone ? <Icone className={cn("h-4 w-4 shrink-0", ativo || marcado ? "text-text-primary" : "text-text-tertiary")} /> : null}
      {avatar}
      {ponto ? <span className={cn("ml-1 mr-0.5 h-2 w-2 shrink-0 rounded-full", PONTO[ponto])} /> : null}
      <span className="truncate">{rotulo}</span>
      {marcado ? <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-text-primary" aria-label="Filter on" /> : null}
      <span className={cn("text-[11.5px] tabular-nums", !marcado && "ml-auto", ativo || marcado ? "text-text-primary" : "text-text-tertiary")}>{n}</span>
    </button>
  );
}

/** A pessoa da equipe: foto do perfil ou iniciais, do tamanho de um ícone. */
function AvatarDaEquipe({ m }: { m: MembroDaEquipe }) {
  const iniciais = m.nome.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return m.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{iniciais}</span>
  );
}

/** O avatar de quem mandou a mensagem de saída, como no VOS: foto, senão iniciais; do celular, o ícone do aparelho. */
function AvatarDeQuemMandou({ m }: { m: MensagemDaCaixa }) {
  if (m.origem === "celular" || !m.quem)
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-tertiary text-text-tertiary" title={m.origem === "celular" ? "Sent from the phone" : "Fixfy"}>
        <Smartphone className="h-4 w-4" />
      </span>
    );
  const iniciais = m.quem.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return m.quemAvatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.quemAvatar} alt={m.quem} title={m.quem} className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span title={m.quem} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {iniciais}
    </span>
  );
}

/** As reações de um clique, as mesmas do WhatsApp. */
const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const Titulo = ({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) => (
  // A linha em cima separa cada grupo da lateral, como no VOS.
  <p className="mx-1 mt-3 flex items-center border-t border-border-light px-1.5 pb-1.5 pt-3.5 text-[12.5px] font-medium text-text-tertiary">
    <span className="flex-1">{children}</span>
    {acao}
  </p>
);

/** A seção Pipeline da lateral (quotes e jobs por etapa) volta quando o dono pedir. */
const MOSTRAR_PIPELINE = false;

export function CaixaAtendimento({
  conversas: doServidor,
  tags: tagsDoServidor,
  paraOferecer,
  semJanela = false,
  estadoPronto = true,
  inicial = null,
  equipe = [],
}: {
  conversas: ConversaDaCaixa[];
  tags: TagDaCaixa[];
  paraOferecer: JobParaOferecer[];
  semJanela?: boolean;
  estadoPronto?: boolean;
  /** /inbox?c=<número>: abre direto nessa conversa (vem do painel lateral). */
  inicial?: string | null;
  /** Quem pode assumir conversa: o Workforce ativo com login. */
  equipe?: MembroDaEquipe[];
}) {
  const router = useRouter();
  const [visao, setVisao] = useState<Visao>({ k: "abertas" });
  const [tipo, setTipo] = useState<Tipo>("todas");
  const [abertaId, setAbertaId] = useState<string | null>(inicial);
  const [buscaAberta, setBuscaAberta] = useState(false);
  /** O menu do botão direito numa linha da lista. */
  const [menuDaLinha, setMenuDaLinha] = useState<{ contato: string; x: number; y: number } | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  /** Conversa nova, ainda sem mensagem: some quando o primeiro envio chega do servidor. */
  const [rascunho, setRascunho] = useState<Escolhido | null>(null);
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [menu, setMenu] = useState<"acoes" | "tags" | "mais" | "dono" | "jobs" | null>(null);
  const [gaveta, setGaveta] = useState<Gaveta>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState("");
  const [endereco, setEndereco] = useState("");
  const [verEtapas, setVerEtapas] = useState(true);
  const [agora, setAgora] = useState(() => Date.now());
  /** O que a equipe acabou de mudar, até o servidor confirmar no próximo refresh. */
  const [local, setLocal] = useState<
    Record<
      string,
      { resolvidaEm?: string | null; arquivadaEm?: string | null; excluidaEm?: string | null; tags?: string[]; lidaEm?: string | null; naoLida?: boolean; fixadaEm?: string | null; atribuidaA?: string | null; nome?: string }
    >
  >({});
  const [tagsNovas, setTagsNovas] = useState<TagDaCaixa[]>([]);
  const [novaTag, setNovaTag] = useState("");
  /** Nome em edição no cabeçalho da conversa (null = só leitura). */
  const [renomeando, setRenomeando] = useState<string | null>(null);
  /** O menu de tag no modo "New tag": um formulário curto em vez da busca. */
  const [formTag, setFormTag] = useState(false);
  const [criandoView, setCriandoView] = useState(false);
  const [apagadas, setApagadas] = useState<Set<string>>(new Set());
  /** Mensagens que acabaram de sair daqui: aparecem na hora, antes do servidor confirmar. */
  const [pendentes, setPendentes] = useState<Record<string, MensagemDaCaixa[]>>({});
  /** Reply escolhido no balão; vale só na conversa em que foi escolhido. */
  const [respondendo, setRespondendo] = useState<{ contato: string; m: MensagemDaCaixa } | null>(null);
  /** O balão com o seletor de reação aberto. */
  const [reagindo, setReagindo] = useState<string | null>(null);
  /** A nossa reação mudada aqui, até o servidor trazer a linha (null = tirada). */
  const [minhaReacao, setMinhaReacao] = useState<Record<string, string | null>>({});

  const conversas = useMemo(
    () => doServidor.map((c) => (local[c.contato] ? ({ ...c, ...local[c.contato] } as ConversaDaCaixa) : c)),
    [doServidor, local],
  );
  const tags = useMemo(() => {
    const m = new Map(tagsDoServidor.map((t) => [t.nome, t]));
    for (const t of tagsNovas) m.set(t.nome, t);
    for (const n of apagadas) m.delete(n);
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [tagsDoServidor, tagsNovas, apagadas]);

  useEffect(() => {
    try {
      setVerEtapas(localStorage.getItem(CHAVE_ETAPAS) !== "0");
    } catch {
      /* sem storage fica visível */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      router.refresh();
      setAgora(Date.now());
    }, 10_000);
    return () => clearInterval(t);
  }, [router]);


  // Clique fora do seletor de reação fecha.
  useEffect(() => {
    if (!reagindo) return;
    const fechar = (e: MouseEvent) => {
      if (e.composedPath().some((el) => el instanceof HTMLElement && el.dataset.reacoes !== undefined)) return;
      setReagindo(null);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [reagindo]);

  /** As reações do balão, com a nossa trocada pelo que acabou de ser clicado. */
  const reacoesDe = (m: MensagemDaCaixa) => {
    const base = m.reacoes ?? [];
    if (!(m.id in minhaReacao)) return base;
    const nova = minhaReacao[m.id];
    return [...base.filter((r) => !r.deNos), ...(nova ? [{ emoji: nova, deNos: true, quem: "You" }] : [])];
  };

  async function reagir(contato: string, m: MensagemDaCaixa, emoji: string) {
    setReagindo(null);
    if (!m.wamid) return;
    // O mesmo emoji de novo tira a reação, como no celular.
    const novo = reacoesDe(m).find((r) => r.deNos)?.emoji === emoji ? "" : emoji;
    setMinhaReacao((p) => ({ ...p, [m.id]: novo || null }));
    try {
      const res = await fetch("/api/inbox/reagir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contato, wamid: m.wamid, emoji: novo }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setMinhaReacao((p) => {
        const resto = { ...p };
        delete resto[m.id];
        return resto;
      });
      toast.error(e instanceof Error ? e.message : "Could not react");
    }
  }

  /** React e Reply ao lado do balão, no hover, como no WhatsApp Web. */
  function acoesDoBalao(m: MensagemDaCaixa, contato: string) {
    if (!m.wamid || m.id.startsWith("tmp-") || gaveta?.k === "criar") return null;
    const aberto = reagindo === m.id;
    return (
      <span
        data-reacoes
        className={cn(
          "relative flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
          aberto && "opacity-100",
        )}
      >
        <button
          type="button"
          onClick={() => setReagindo(aberto ? null : m.id)}
          className="grid h-7 w-7 place-items-center rounded-full text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
          aria-label="React"
          title="React"
        >
          <Smile className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setRespondendo({ contato, m })}
          className="grid h-7 w-7 place-items-center rounded-full text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
          aria-label="Reply"
          title="Reply"
        >
          <Reply className="h-4 w-4" />
        </button>
        <AnimatePresence>
          {aberto ? (
            <mo.span
              {...flutuante("top")}
              className={cn(
                "absolute bottom-full z-20 mb-1 flex items-center gap-0.5 rounded-full border border-border-light bg-card px-1.5 py-1 shadow-lg",
                m.direcao === "entrada" ? "left-0" : "right-0",
              )}
            >
              {REACOES_RAPIDAS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => void reagir(contato, m, e)}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full text-[18px] transition-transform hover:scale-125 hover:bg-surface-secondary",
                    reacoesDe(m).some((r) => r.deNos && r.emoji === e) && "bg-surface-tertiary",
                  )}
                >
                  {e}
                </button>
              ))}
            </mo.span>
          ) : null}
        </AnimatePresence>
      </span>
    );
  }

  useEffect(() => {
    if (!menu) return;
    // Clique dentro da área dos menus não fecha. `composedPath` porque o botão clicado
    // pode já ter saído do DOM (o "New tag" vira formulário no mesmo clique).
    const fechar = (e: MouseEvent) => {
      if (e.composedPath().some((el) => el instanceof HTMLElement && el.dataset.areaDoMenu !== undefined)) return;
      setMenu(null);
    };
    document.addEventListener("click", fechar);
    return () => document.removeEventListener("click", fechar);
  }, [menu]);

  useEffect(() => {
    if (!menuDaLinha) return;
    const fechar = () => setMenuDaLinha(null);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    document.addEventListener("click", fechar);
    document.addEventListener("scroll", fechar, true);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("click", fechar);
      document.removeEventListener("scroll", fechar, true);
      document.removeEventListener("keydown", tecla);
    };
  }, [menuDaLinha]);

  const contagem = useMemo(() => {
    const n = (f: (c: ConversaDaCaixa) => boolean) => conversas.filter(f).length;
    return {
      abertas: n((c) => passa(c, { k: "abertas" })),
      esperando: n((c) => passa(c, { k: "esperando" })),
      resolvidas: n((c) => passa(c, { k: "resolvidas" })),
      arquivadas: n(arquivada),
      excluidas: n(excluida),
      todas: n((c) => !fora(c)),
      hoje: n((c) => passa(c, { k: "hoje" })),
      conta: n((c) => !fora(c) && c.tipo === "conta"),
      parceiro: n((c) => !fora(c) && c.tipo === "parceiro"),
      cliente: n((c) => !fora(c) && c.tipo === "cliente"),
      outro: n((c) => !fora(c) && c.tipo === "outro"),
      grupo: n((c) => !fora(c) && c.tipo === "grupo"),
      semDono: n((c) => passa(c, { k: "sem_dono" })),
    };
  }, [conversas]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, "");
    const base = conversas.filter((c) => {
      if (!passa(c, visao)) return false;
      if (tipo !== "todas" && c.tipo !== tipo) return false;
      if (!passaNosFiltros(c, filtros, { naoLida: (x) => naoLidas(x) > 0, esperando: (x) => !resolvida(x) && esperando(x) })) return false;
      if (!q) return true;
      if (qDig.length >= 4 && c.contato.includes(qDig)) return true;
      return [c.nome, c.perfil ?? "", c.parceiro?.empresa ?? "", c.parceiro?.oficio ?? "", c.cliente?.postcode ?? "", ...c.tags, ...c.jobs.flatMap((j) => [j.ref, j.endereco ?? ""])].some(
        (v) => v.toLowerCase().includes(q),
      );
    });
    // Fixadas sempre no topo, na ordem em que foram fixadas.
    const fixadas = base.filter((c) => c.fixadaEm).sort((a, b) => (a.fixadaEm ?? "").localeCompare(b.fixadaEm ?? ""));
    if (fixadas.length) return [...fixadas, ...base.filter((c) => !c.fixadaEm)];
    if (visao.k !== "hoje") return base;
    // Em On site today, quem está atrasado ou em risco sobe.
    const peso = (c: ConversaDaCaixa) => (c.jobHoje ? (chegada(c.jobHoje, agora)?.peso ?? 0) : 0);
    return [...base].sort((a, b) => peso(b) - peso(a));
  }, [conversas, visao, tipo, busca, agora, filtros]);

  const tipoRapido: TipoRapido | null = !filtros.tipos.length
    ? "todas"
    : filtros.tipos.length === 1 && filtros.tipos[0] === "parceiro"
      ? "parceiro"
      : filtros.tipos.length === TIPOS_CLIENTE.length && TIPOS_CLIENTE.every((t) => filtros.tipos.includes(t))
        ? "cliente"
        : null;
  const nRapido = useMemo(() => {
    const naView = conversas.filter((c) => passa(c, visao));
    return { todas: naView.length, parceiro: naView.filter((c) => c.tipo === "parceiro").length, cliente: naView.filter((c) => (TIPOS_CLIENTE as readonly string[]).includes(c.tipo)).length };
  }, [conversas, visao]);

  const aberta =
    conversas.find((c) => c.contato === abertaId) ??
    (rascunho && rascunho.numero === abertaId ? conversaRascunho(rascunho) : null) ??
    lista[0] ??
    null;
  const presenca = aberta ? presencaAgora(aberta, agora) : null;

  function irPara(v: Visao) {
    setVisao(v);
    setTipo("todas");
  }

  /** Team, Contacts e Tags da lateral ligam e desligam o mesmo filtro do botão Filters. */
  function alternar(k: "tipos" | "donos" | "tags", v: string) {
    setFiltros((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  }

  /** Abre a conversa do número escolhido em New conversation: a que já existe, senão um rascunho. */
  function abrirNumero(e: Escolhido) {
    const existe = conversas.find((c) => c.contato === e.numero);
    if (existe) return abrir(existe);
    setRascunho(e);
    setAbertaId(e.numero);
  }

  function abrir(c: ConversaDaCaixa) {
    setAbertaId(c.contato);
    fecharGaveta();
    if (naoLidas(c) > 0) void marcarConversa(c, "ler");
  }

  /** Lida, não lida, fixar: muda na hora e grava; sem a migration 354 fica só nesta tela. */
  async function marcarConversa(c: ConversaDaCaixa, acao: "ler" | "nao_ler" | "fixar" | "desafixar") {
    const antes = local[c.contato];
    const agoraIso = new Date().toISOString();
    const patch =
      acao === "ler" ? { lidaEm: agoraIso, naoLida: false } : acao === "nao_ler" ? { naoLida: true } : acao === "fixar" ? { fixadaEm: agoraIso } : { fixadaEm: null };
    setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], ...patch } }));
    if (!estadoPronto) return;
    try {
      await postarConversa({ contato: c.contato, acao });
    } catch (e) {
      setLocal((l) => ({ ...l, [c.contato]: antes ?? {} }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  function abrirCriar(t: TipoDoPrefill) {
    if (!aberta) return;
    setMenu(null);
    // Sem nada marcado, o scope começa com o que o contato escreveu desde a nossa última mensagem.
    const recentes = aberta.mensagens.slice(aberta.mensagens.length - Math.max(naoRespondidas(aberta), 1)).filter((m) => m.direcao === "entrada" && m.texto);
    setMarcadas(new Set(recentes.map((m) => m.id)));
    setScope(recentes.map((m) => m.texto).join("\n"));
    setEndereco([aberta.cliente?.endereco, aberta.cliente?.postcode].filter(Boolean).join(", "));
    setGaveta({ k: "criar", tipo: t });
  }

  function fecharGaveta() {
    setGaveta(null);
    setMarcadas(new Set());
  }

  function marcar(m: MensagemDaCaixa) {
    if (gaveta?.k !== "criar" || !aberta || m.direcao !== "entrada" || !m.texto) return;
    const novas = new Set(marcadas);
    if (novas.has(m.id)) novas.delete(m.id);
    else novas.add(m.id);
    setMarcadas(novas);
    setScope(
      aberta.mensagens
        .filter((x) => novas.has(x.id))
        .map((x) => x.texto)
        .join("\n"),
    );
  }

  function continuar() {
    if (!aberta || gaveta?.k !== "criar") return;
    guardarPrefill(gaveta.tipo, {
      cliente: {
        client_id: aberta.cliente?.id,
        client_name: aberta.cliente?.nome || (aberta.nome.startsWith("+") ? "" : aberta.nome),
        client_email: aberta.cliente?.email ?? undefined,
        property_address: endereco.trim(),
      },
      scope: scope.trim(),
      ticketId: ticketDe(aberta),
      contaId: aberta.cliente?.contaId ?? null,
    });
    router.push(gaveta.tipo === "job" ? "/jobs?new=inbox" : "/quotes?new=inbox");
  }

  async function resolver(c: ConversaDaCaixa, fechar: boolean) {
    const antes = local[c.contato];
    setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], resolvidaEm: fechar ? new Date().toISOString() : null } }));
    try {
      await postarConversa({ contato: c.contato, acao: fechar ? "resolver" : "reabrir" });
      toast.success(fechar ? "Conversation resolved" : "Reopened");
      if (fechar) {
        // Vai para a próxima aberta da lista, como no VOS.
        const proxima = lista.find((x) => x.contato !== c.contato && !resolvida(x));
        setAbertaId(proxima?.contato ?? null);
      }
      router.refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [c.contato]: antes ?? {} }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  /** Arquivar, excluir ou trazer de volta. Some da lista na hora e passa para a próxima. */
  async function mover(c: ConversaDaCaixa, acao: "arquivar" | "excluir" | "restaurar") {
    const antes = local[c.contato];
    const agoraIso = new Date().toISOString();
    const patch =
      acao === "arquivar"
        ? { arquivadaEm: agoraIso, excluidaEm: null }
        : acao === "excluir"
          ? { excluidaEm: agoraIso, arquivadaEm: null }
          : { arquivadaEm: null, excluidaEm: null };
    setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], ...patch } }));
    if (acao !== "restaurar") {
      const proxima = lista.find((x) => x.contato !== c.contato);
      setAbertaId(proxima?.contato ?? null);
    }
    try {
      await postarConversa({ contato: c.contato, acao });
      toast.success(
        acao === "arquivar" ? "Conversation archived" : acao === "excluir" ? "Conversation deleted" : "Conversation restored",
      );
      router.refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [c.contato]: antes ?? {} }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function atribuir(c: ConversaDaCaixa, para: string | null) {
    setMenu(null);
    setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], atribuidaA: para } }));
    try {
      await postarConversa({ contato: c.contato, acao: "atribuir", para });
      toast.success(para ? `Assigned to ${equipe.find((m) => m.id === para)?.nome ?? "them"}` : "Unassigned");
      router.refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], atribuidaA: c.atribuidaA } }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  /** Nome escolhido pela equipe. Parceiro e grupo não entram: parceiro segue a empresa, grupo o WhatsApp. Vazio volta ao nome do cadastro. */
  async function renomear(c: ConversaDaCaixa, nome: string) {
    setRenomeando(null);
    const limpo = nome.trim().slice(0, 80);
    if (limpo === c.nome) return;
    if (limpo) setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], nome: limpo } }));
    try {
      await postarConversa({ contato: c.contato, acao: "renomear", nome: limpo });
      toast.success(limpo ? "Renamed" : "Name reset");
      router.refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], nome: c.nome } }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function alternarTag(c: ConversaDaCaixa, nome: string) {
    const novas = c.tags.includes(nome) ? c.tags.filter((t) => t !== nome) : [...c.tags, nome];
    setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], tags: novas } }));
    try {
      await postarConversa({ contato: c.contato, acao: "tags", tags: novas });
      router.refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [c.contato]: { ...l[c.contato], tags: c.tags } }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function criarTag(paraConversa: ConversaDaCaixa | null) {
    const nome = novaTag.trim();
    if (!nome) return;
    try {
      const res = await fetch("/api/inbox/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, cor: "slate" }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; tag?: TagDaCaixa };
      if (!res.ok || !j.tag) throw new Error(j.error ?? "Could not create the view");
      const criada = j.tag;
      setTagsNovas((t) => [...t, criada]);
      setApagadas((a) => {
        const n = new Set(a);
        n.delete(criada.nome);
        return n;
      });
      setNovaTag("");
      setCriandoView(false);
      if (paraConversa && !paraConversa.tags.includes(criada.nome)) await alternarTag(paraConversa, criada.nome);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the view");
    }
  }

  async function apagarView(nome: string) {
    if (!window.confirm(`Delete the view "${nome}"? Chats keep their messages; only the grouping goes.`)) return;
    setApagadas((a) => new Set(a).add(nome));
    if (visao.k === "tag" && visao.nome === nome) setVisao({ k: "abertas" });
    const res = await fetch(`/api/inbox/tags?nome=${encodeURIComponent(nome)}`, { method: "DELETE" });
    if (!res.ok) {
      setApagadas((a) => {
        const n = new Set(a);
        n.delete(nome);
        return n;
      });
      toast.error("Could not delete the view");
    }
  }

  function alternarEtapas() {
    const v = !verEtapas;
    setVerEtapas(v);
    try {
      localStorage.setItem(CHAVE_ETAPAS, v ? "1" : "0");
    } catch {
      /* só nesta aba */
    }
  }

  const nEtapa = (grupo: "quote" | "job", status: string) => conversas.filter((c) => c.etapa?.grupo === grupo && c.etapa.status === status).length;
  const nTag = (nome: string) => conversas.filter((c) => c.tags.includes(nome)).length;

  const criadorDeTag = (paraConversa: ConversaDaCaixa | null) => (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void criarTag(paraConversa);
      }}
    >
      <div className="flex h-8 items-center gap-2 rounded-lg border border-border-light bg-card px-2.5 focus-within:border-text-tertiary">
        <Tag className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <input
          autoFocus={!paraConversa}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
          placeholder="Tag name"
          value={novaTag}
          onChange={(e) => setNovaTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setNovaTag("");
              setCriandoView(false);
            }
          }}
          disabled={!estadoPronto}
        />
      </div>
      <div className="flex justify-end gap-1.5">
        {paraConversa ? null : (
          <button
            type="button"
            onClick={() => {
              setNovaTag("");
              setCriandoView(false);
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-tertiary"
          >
            Cancel
          </button>
        )}
        <button type="submit" disabled={!novaTag.trim() || !estadoPronto} className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-[var(--on-brand)] disabled:opacity-40">
          {paraConversa ? "Create and tag" : "Create tag"}
        </button>
      </div>
    </form>
  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="cx grid h-screen min-h-[560px] grid-cols-[216px_330px_minmax(0,1fr)_300px] overflow-hidden bg-card">
      {/* Lateral */}
      <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-border-light bg-surface-secondary/40 p-2.5">
        <p className="px-2.5 pb-2 pt-1.5 text-[17px] font-bold tracking-tight text-text-primary">Inbox</p>
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "abertas" }) && tipo === "todas"} onClick={() => irPara({ k: "abertas" })} icone={Inbox} rotulo="Open" n={contagem.abertas} />
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "esperando" })} onClick={() => irPara({ k: "esperando" })} icone={Clock} rotulo="Needs reply" n={contagem.esperando} />
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "hoje" })} onClick={() => irPara({ k: "hoje" })} icone={CalendarClock} rotulo="On site today" n={contagem.hoje} />
        {/* Sem "All": fazia o mesmo que Open. Resolved, Archived e Deleted ficam embaixo. */}

        {equipe.length ? (
          <>
            <Titulo>Team</Titulo>
            <ItemDaLateral ativo={false} marcado={filtros.donos.includes(SEM_DONO)} onClick={() => alternar("donos", SEM_DONO)} icone={UserRound} rotulo="Unassigned" n={contagem.semDono} />
            {equipe.map((m) => (
              <ItemDaLateral
                key={m.id}
                ativo={false}
                marcado={filtros.donos.includes(m.id)}
                onClick={() => alternar("donos", m.id)}
                avatar={<AvatarDaEquipe m={m} />}
                rotulo={m.nome}
                n={conversas.filter((c) => passa(c, { k: "pessoa", id: m.id })).length}
              />
            ))}
          </>
        ) : null}

        <Titulo>Contacts</Titulo>
        {(
          [
            ["conta", Building2, "Accounts"],
            ["parceiro", Wrench, "Partners"],
            ["cliente", Home, "Clients"],
            ["outro", UserRound, "Leads"],
            ["grupo", Users, "Groups"],
          ] as const
        ).map(([k, icone, rotulo]) => (
          <ItemDaLateral key={k} ativo={false} marcado={filtros.tipos.includes(k)} onClick={() => alternar("tipos", k)} icone={icone} rotulo={rotulo} n={contagem[k]} />
        ))}

        <Titulo
          acao={
            <button
              type="button"
              onClick={() => setCriandoView((v) => !v)}
              disabled={!estadoPronto}
              className={cn(
                "grid h-6 w-6 place-items-center rounded-md border border-border-light bg-card text-text-tertiary hover:border-border hover:text-text-primary disabled:opacity-40",
                criandoView && "bg-surface-tertiary text-text-primary",
              )}
              aria-label="New tag"
              title={estadoPronto ? "New tag" : "Needs migration 354"}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          }
        >
          Tags
        </Titulo>
        {tags.map((t) => (
          <div key={t.nome} className="group relative">
            <ItemDaLateral
              ativo={false}
              marcado={filtros.tags.includes(t.nome)}
              onClick={() => alternar("tags", t.nome)}
              icone={Tag}
              rotulo={t.nome}
              n={nTag(t.nome)}
            />
            <button
              type="button"
              onClick={() => void apagarView(t.nome)}
              className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded bg-surface-secondary p-0.5 text-text-tertiary hover:text-[var(--bad-ink)] group-hover:block"
              aria-label={`Delete tag ${t.nome}`}
              title="Delete tag"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {criandoView ? <div className="mx-1 mt-1 rounded-lg border border-border-light bg-card p-2">{criadorDeTag(null)}</div> : null}
        {!tags.length && !criandoView ? <p className="px-2.5 py-1 text-[12px] text-text-tertiary">No tags yet.</p> : null}

        {/* Pipeline fora da lateral por ora (dono, 03/11). */}
        {MOSTRAR_PIPELINE ? (
          <>
        <Titulo
          acao={
            <button type="button" onClick={alternarEtapas} className="inline-flex items-center gap-1 normal-case tracking-normal text-text-tertiary hover:text-text-primary">
              {verEtapas ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {verEtapas ? "Hide" : "Show"}
            </button>
          }
        >
          Pipeline
        </Titulo>
        {verEtapas ? (
          <>
            <p className="px-2.5 pb-0.5 pt-1 text-[11px] font-medium text-text-secondary">Quotes</p>
            {ETAPAS_DE_QUOTE.map((e) => (
              <ItemDaLateral
                key={`q-${e.status}`}
                ativo={mesmaVisao(visao, { k: "etapa", grupo: "quote", status: e.status })}
                onClick={() => irPara({ k: "etapa", grupo: "quote", status: e.status })}
                icone={iconeDaEtapa("quote", e.status)}
                rotulo={e.rotulo}
                n={nEtapa("quote", e.status)}
                apagado={!nEtapa("quote", e.status)}
              />
            ))}
            <p className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-text-secondary">Jobs</p>
            {ETAPAS_DE_JOB.map((e) => (
              <ItemDaLateral
                key={`j-${e.status}`}
                ativo={mesmaVisao(visao, { k: "etapa", grupo: "job", status: e.status })}
                onClick={() => irPara({ k: "etapa", grupo: "job", status: e.status })}
                icone={iconeDaEtapa("job", e.status)}
                rotulo={e.rotulo}
                n={nEtapa("job", e.status)}
                apagado={!nEtapa("job", e.status)}
              />
            ))}
          </>
        ) : null}
          </>
        ) : null}

        <div className="mt-auto pt-4">
          <Titulo>Closed</Titulo>
          <ItemDaLateral ativo={mesmaVisao(visao, { k: "resolvidas" })} onClick={() => irPara({ k: "resolvidas" })} icone={CheckCheck} rotulo="Resolved" n={contagem.resolvidas} />
          <ItemDaLateral ativo={mesmaVisao(visao, { k: "arquivadas" })} onClick={() => irPara({ k: "arquivadas" })} icone={Archive} rotulo="Archived" n={contagem.arquivadas} />
          <ItemDaLateral ativo={mesmaVisao(visao, { k: "excluidas" })} onClick={() => irPara({ k: "excluidas" })} icone={Trash2} rotulo="Deleted" n={contagem.excluidas} />
        </div>
      </aside>

      {/* Conversas */}
      <section className="flex min-h-0 flex-col border-r border-border-light">
        {/* O cabeçalho da lista: o nome da view (a lateral escolhe), o período, a busca que abre e o +. */}
        <div className="relative flex h-14 shrink-0 items-center border-b border-border-light px-4">
          <AnimatePresence initial={false} mode="popLayout">
            {buscaAberta ? (
              <mo.div
                key="busca"
                className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-border-light bg-card px-2.5 focus-within:border-text-tertiary"
                initial={{ opacity: 0, scaleX: 0.6 }}
                animate={{ opacity: 1, scaleX: 1, transition: tempo("md") }}
                exit={{ opacity: 0, scaleX: 0.6, transition: tempo("sm", "saida") }}
                style={{ transformOrigin: "right center" }}
              >
                <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setBusca("");
                      setBuscaAberta(false);
                    }
                  }}
                  placeholder="Search name, number, job ref, tag"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
                />
                <button
                  type="button"
                  onClick={() => {
                    setBusca("");
                    setBuscaAberta(false);
                  }}
                  className="text-text-tertiary hover:text-text-primary"
                  aria-label="Close search"
                >
                  <X className="h-4 w-4" />
                </button>
              </mo.div>
            ) : (
              <mo.div key="titulo" className="relative flex h-full min-w-0 flex-1 items-center" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: tempo("md") }} exit={{ opacity: 0, transition: tempo("xs", "saida") }}>
                <h2 className="text-[16px] font-bold tracking-tight text-text-primary">
                  Conversations <span className="ml-1 text-[13px] font-medium tabular-nums text-text-tertiary">{lista.length}</span>
                </h2>
                <span className="absolute bottom-0 left-0 h-[2px] w-[118px] rounded-full bg-text-primary" aria-hidden />
              </mo.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={() => setNovoAberto(true)}
            className={cn(
              "ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary text-[var(--on-brand)] transition-transform hover:opacity-90 active:scale-95",
              novoAberto && "ring-2 ring-primary/30",
            )}
            aria-label="New conversation"
            title="New conversation"
          >
            <MessageSquarePlus className="h-[18px] w-[18px]" />
          </button>
          {!buscaAberta ? (
            <button
              type="button"
              onClick={() => setBuscaAberta(true)}
              className="ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border-light text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
              aria-label="Search conversations"
              title="Search"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setFiltrosAbertos((v) => !v)}
            className={cn(
              "relative ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border-light text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
              (filtrosAbertos || quantosFiltros(filtros) > 0) && "border-text-tertiary text-text-primary",
            )}
            aria-label="Filters"
            title="Filters"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
            {quantosFiltros(filtros) ? (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-[var(--on-brand)]">
                {quantosFiltros(filtros)}
              </span>
            ) : null}
          </button>
          <AnimatePresence>
            {filtrosAbertos ? (
              <PainelDeFiltros
                filtros={filtros}
                onMudar={setFiltros}
                onFechar={() => setFiltrosAbertos(false)}
                conversas={conversas}
                equipe={equipe}
                tags={tags.map((t) => t.nome)}
              />
            ) : null}
          </AnimatePresence>
          <NovaConversa
            open={novoAberto}
            onFechar={() => setNovoAberto(false)}
            onAbrir={abrirNumero}
            onEnviado={() => router.refresh()}
          />
        </div>
        {/* All · Partners · Clients com a contagem da view: o mesmo filtro de Contacts da lateral. */}
        <div className="shrink-0 px-4 py-3">
          <SeletorDeTipo
            ativo={tipoRapido}
            onTroca={(t) => setFiltros((f) => ({ ...f, tipos: t === "todas" ? [] : t === "parceiro" ? ["parceiro"] : [...TIPOS_CLIENTE] }))}
            n={nRapido}
          />
        </div>
        <FiltrosAtivos filtros={filtros} onMudar={setFiltros} equipe={equipe} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lista.length === 0 ? (
            <p className="px-4 py-6 text-xs text-text-tertiary">{conversas.length === 0 ? "No messages yet. New messages to +44 7983 182332 land here." : "No conversations here."}</p>
          ) : null}
          <AnimatePresence initial={false} mode="popLayout">
          {lista.map((c) => {
            const ultima = c.mensagens[c.mensagens.length - 1];
            const ativa = c.contato === aberta?.contato;
            // A conversa aberta está sendo lida: sem contador nela.
            const n = resolvida(c) || ativa ? 0 : naoLidas(c);
            const p = presencaAgora(c, agora);
            return (
              <mo.button
                key={c.contato}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0, transition: tempo("md") }}
                exit={{ opacity: 0, transition: tempo("sm", "saida") }}
                transition={tempo("lg")}
                type="button"
                onClick={() => abrir(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuDaLinha({ contato: c.contato, x: e.clientX, y: e.clientY });
                }}
                className={cn(
                  "relative flex w-full items-center gap-3 border-b border-border-light px-3.5 py-2 text-left transition-colors hover:bg-surface-secondary/70",
                  ativa && "bg-surface-tertiary/80 hover:bg-surface-tertiary/80",
                )}
              >
                {ativa ? <mo.span layoutId="inbox-conversa-ativa" transition={tempo("lg")} className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary" /> : null}
                <Avatar c={c} tamanho="md" online={Boolean(p)} canal />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("min-w-0 truncate text-[14px] text-text-primary", n > 0 ? "font-bold" : "font-semibold")}>{c.nome}</span>
                    {(() => {
                      const r = rotuloAoLado(c);
                      return r ? <span className={cn("shrink-0 text-[12px] font-medium", r.cls)}>{r.texto}</span> : null;
                    })()}
                    {resolvida(c) ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : null}
                    {c.fixadaEm ? <Pin className="h-3 w-3 shrink-0 rotate-45 text-text-tertiary" aria-label="Pinned" /> : null}
                    <span className={cn("ml-auto shrink-0 text-[11.5px] tabular-nums", n > 0 ? "font-semibold text-[var(--accent)]" : "text-text-tertiary")}>
                      {quandoNaLista(ultima.criadoEm, agora)}
                    </span>
                  </span>
                  {/* Altura fixa do chip: com ou sem chip, toda linha da lista tem a mesma altura. */}
                  <span className="mt-0.5 flex h-[22px] items-center gap-1">
                    {p === "digitando" || p === "gravando" ? (
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-emerald-600">{p === "digitando" ? "typing..." : "recording audio..."}</span>
                    ) : (
                      <>
                        {ultima.direcao === "saida" ? (
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                        ) : (
                          <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                        )}
                        <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", n > 0 ? "font-medium text-text-primary" : "text-text-secondary")}>
                          {ultima.texto ?? `[${ultima.tipo}]`}
                        </span>
                      </>
                    )}
                    {/* Os chips na linha da prévia, à direita: a linha da lista fica com duas alturas só. */}
                    <span className="flex shrink-0 items-center gap-1 pl-1 empty:hidden">
                    {c.etapa ? <ChipDaEtapa e={c.etapa} /> : null}
                    {(() => {
                      const ch = c.jobHoje ? chegada(c.jobHoje, agora) : null;
                      return ch ? (
                        <mo.span key={ch.texto} {...CHIP} className="inline-flex">
                          <Chip icone={ch.icone} tom={ch.tom} title={ch.title}>
                            {ch.texto}
                          </Chip>
                        </mo.span>
                      ) : null;
                    })()}
                    {c.tags.slice(0, 1).map((t) => (
                      <Chip key={t} icone={Tag} tom="slate">
                        {t}
                      </Chip>
                    ))}
                  </span>
                    {n > 0 ? (
                      <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10.5px] font-semibold text-white">
                        {n}
                      </span>
                    ) : null}
                  </span>
                </span>
              </mo.button>
            );
          })}
          </AnimatePresence>
        </div>
      </section>

      {/* A conversa */}
      {aberta ? (
        <section className="flex min-h-0 flex-col bg-surface-secondary/50">
          <div className="flex items-center gap-3 border-b border-border-light bg-card px-4 py-2.5">
            <Avatar c={aberta} tamanho="md" online={Boolean(presenca)} canal />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-[16px] font-semibold text-text-primary">
                {renomeando !== null ? (
                  <input
                    autoFocus
                    value={renomeando}
                    maxLength={80}
                    aria-label="Conversation name"
                    placeholder={aberta.perfil ?? `+${aberta.contato}`}
                    onChange={(e) => setRenomeando(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => void renomear(aberta, renomeando)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenomeando(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[16px] font-semibold text-text-primary outline-none focus:border-primary"
                  />
                ) : aberta.tipo === "parceiro" || aberta.tipo === "grupo" ? (
                  <span className="truncate" title={aberta.tipo === "parceiro" ? "Partner chats use the company name. Change it on the partner." : undefined}>
                    {aberta.nome}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRenomeando(aberta.nome)}
                    title="Click to rename"
                    className="group/nome inline-flex min-w-0 items-center gap-1.5 rounded-md text-left hover:text-primary"
                  >
                    <span className="truncate">{aberta.nome}</span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover/nome:opacity-100" />
                  </button>
                )}
              </p>
              {/* Só um estado: online agora, senão o último sinal (visto ou mensagem). O número fica no painel. */}
              <p className="truncate text-xs text-text-tertiary" title={`+${aberta.contato}`}>
                {presenca === "digitando" ? (
                  <span className="font-medium text-emerald-600">Typing...</span>
                ) : presenca === "gravando" ? (
                  <span className="font-medium text-emerald-600">Recording audio...</span>
                ) : presenca === "online" ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                    Online
                  </span>
                ) : aberta.presencaEm && (!aberta.ultimaEntradaEm || aberta.presencaEm > aberta.ultimaEntradaEm) ? (
                  `Last seen ${haQuanto(aberta.presencaEm, agora)}`
                ) : aberta.ultimaEntradaEm ? (
                  `Last message ${haQuanto(aberta.ultimaEntradaEm, agora)}`
                ) : (
                  "No reply yet"
                )}
              </p>
            </div>
            <div className="relative flex items-center gap-1.5" data-area-do-menu onClick={(e) => e.stopPropagation()}>
              {jobsAbertos(aberta).length > 1 ? (
                // Mais de um job aberto: um botão só, e a lista com data no dropdown.
                <Acao icone={Link2} ativo={menu === "jobs"} onClick={() => setMenu((m) => (m === "jobs" ? null : "jobs"))} title="Open jobs">
                  Jobs ({jobsAbertos(aberta).length})
                  <ChevronDown className="h-3.5 w-3.5" />
                </Acao>
              ) : jobDaConversa(aberta) ? (
                <LinkDeJob id={jobDaConversa(aberta)!.id}>
                  <Acao icone={Link2} title="View the job">
                    {jobDaConversa(aberta)!.ref}
                  </Acao>
                </LinkDeJob>
              ) : aberta.etapa?.grupo === "quote" ? (
                <Link href={`/quotes?quoteId=${aberta.etapa.id}`}>
                  <Acao icone={Link2} title="Open the quote">
                    {aberta.etapa.ref}
                  </Acao>
                </Link>
              ) : null}
              {equipe.length ? (
                <Acao
                  icone={aberta.atribuidaA ? undefined : UserPlus}
                  ativo={menu === "dono"}
                  title={
                    aberta.atribuidaA
                      ? `${equipe.find((m) => m.id === aberta.atribuidaA)?.nome ?? "Someone"} has this conversation. Click to change`
                      : "Assign this conversation"
                  }
                  onClick={() => setMenu((m) => (m === "dono" ? null : "dono"))}
                  disabled={!estadoPronto}
                >
                  {(() => {
                    // Só o rosto de quem assumiu: o nome do contato precisa do espaço do cabeçalho.
                    const dono = equipe.find((m) => m.id === aberta.atribuidaA);
                    return dono ? <AvatarDaEquipe m={dono} /> : null;
                  })()}
                </Acao>
              ) : null}
              <Acao
                icone={Tag}
                ativo={menu === "tags"}
                onClick={() => {
                  setFormTag(false);
                  setMenu((m) => (m === "tags" ? null : "tags"));
                }} disabled={!estadoPronto}>
                Tag
              </Acao>
              {resolvida(aberta) ? (
                <Acao icone={RotateCcw} onClick={() => void resolver(aberta, false)} disabled={!estadoPronto}>
                  Reopen
                </Acao>
              ) : null}
              {fora(aberta) ? (
                <Acao icone={ArchiveRestore} onClick={() => void mover(aberta, "restaurar")} disabled={!estadoPronto}>
                  Restore
                </Acao>
              ) : null}
              <Acao icone={Plus} ativo={menu === "acoes"} onClick={() => setMenu((m) => (m === "acoes" ? null : "acoes"))}>
                Actions
                <ChevronDown className="h-3.5 w-3.5" />
              </Acao>
              {!resolvida(aberta) ? (
                <Acao icone={CheckCheck} variante="primario" onClick={() => void resolver(aberta, true)} disabled={!estadoPronto}>
                  Resolve
                </Acao>
              ) : null}
              <Acao icone={MoreHorizontal} title="More" ativo={menu === "mais"} onClick={() => setMenu((m) => (m === "mais" ? null : "mais"))} />

              <AnimatePresence>
              {menu === "tags" ? (
                // Como as etiquetas do WhatsApp: uma busca que também cria, e um clique marca ou desmarca.
                <mo.div {...flutuante("bottom")} style={{ transformOrigin: "top right" }} className="absolute right-[150px] top-10 z-30 w-60 rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
                  {formTag ? (
                    // Criar tag: nome, uma prévia de como fica e o botão que já marca esta conversa.
                    <form
                      className="p-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const nome = novaTag.trim();
                        if (!nome) return;
                        const existe = tags.find((t) => t.nome.toLowerCase() === nome.toLowerCase());
                        if (existe) {
                          if (!aberta.tags.includes(existe.nome)) void alternarTag(aberta, existe.nome);
                          setNovaTag("");
                        } else void criarTag(aberta);
                        setFormTag(false);
                      }}
                    >
                      <p className="mb-2 text-[12.5px] font-semibold text-text-primary">New tag</p>
                      <input
                        autoFocus
                        className="h-8 w-full rounded-lg border border-border-light bg-card px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary/50"
                        placeholder="e.g. Waiting on access"
                        maxLength={40}
                        value={novaTag}
                        onChange={(e) => setNovaTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setFormTag(false);
                        }}
                      />
                      <p className="mt-1.5 text-[11.5px] leading-snug text-text-tertiary">It is added to this chat and shows up as a view in the sidebar.</p>
                      <div className="mt-2.5 flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFormTag(false);
                            setNovaTag("");
                          }}
                          className="h-7 rounded-md px-2.5 text-[12px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!novaTag.trim() || !estadoPronto}
                          className="h-7 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-[var(--on-brand)] hover:opacity-90 disabled:opacity-45"
                        >
                          Create and add
                        </button>
                      </div>
                    </form>
                  ) : (
                  <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const nome = novaTag.trim();
                      if (!nome) return;
                      const existe = tags.find((t) => t.nome.toLowerCase() === nome.toLowerCase());
                      if (existe) {
                        void alternarTag(aberta, existe.nome);
                        setNovaTag("");
                      } else void criarTag(aberta);
                    }}
                  >
                    <div className="flex h-8 items-center gap-2 rounded-lg bg-surface-secondary px-2.5">
                      <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                      <input
                        autoFocus
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
                        placeholder="Search or create a tag"
                        value={novaTag}
                        onChange={(e) => setNovaTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setMenu(null);
                        }}
                        disabled={!estadoPronto}
                      />
                    </div>
                  </form>
                  <div className="mt-1 max-h-60 overflow-y-auto">
                    {tags
                      .filter((t) => t.nome.toLowerCase().includes(novaTag.trim().toLowerCase()))
                      .map((t) => {
                        const tem = aberta.tags.includes(t.nome);
                        return (
                          <button
                            key={t.nome}
                            type="button"
                            onClick={() => void alternarTag(aberta, t.nome)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-secondary"
                          >
                            <Tag className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                            <span className="flex-1 truncate">{t.nome}</span>
                            {tem ? <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" /> : null}
                          </button>
                        );
                      })}
                    {novaTag.trim() && !tags.some((t) => t.nome.toLowerCase() === novaTag.trim().toLowerCase()) ? (
                      <button
                        type="button"
                        onClick={() => void criarTag(aberta)}
                        disabled={!estadoPronto}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        Create “{novaTag.trim()}”
                      </button>
                    ) : null}
                    {tags.length === 0 && !novaTag.trim() ? <p className="px-2 py-1.5 text-xs text-text-tertiary">No tags yet.</p> : null}
                  </div>
                  <div className="mt-1 border-t border-border-light pt-1">
                    <button
                      type="button"
                      onClick={() => setFormTag(true)}
                      disabled={!estadoPronto}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      New tag
                    </button>
                  </div>
                  </>
                  )}
                </mo.div>
              ) : null}
              </AnimatePresence>

              <AnimatePresence>
              {menu === "jobs" ? (
                <mo.div {...flutuante("bottom")} style={{ transformOrigin: "top left" }} className="absolute left-0 top-10 z-30 max-h-[360px] w-[380px] overflow-y-auto rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
                  <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-text-tertiary">Open jobs</p>
                  {jobsAbertos(aberta).map((j) => (
                    <LinkDeJob key={j.id} id={j.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary">
                      <span className="w-[86px] shrink-0 text-[12px] tabular-nums text-text-secondary">
                        <span className="block font-medium text-text-primary">{new Date(`${j.data}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
                        {j.inicio ? `${horaCurta(j.inicio)}${j.fim ? `–${horaCurta(j.fim)}` : ""}` : "Any time"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text-primary">{j.titulo ?? j.ref}</span>
                        <span className="block truncate text-[11.5px] text-text-tertiary">{j.ref}</span>
                      </span>
                      <ChipDaEtapa e={{ grupo: "job", status: j.status }} />
                    </LinkDeJob>
                  ))}
                </mo.div>
              ) : null}
              {menu === "dono" ? (
                <mo.div {...flutuante("bottom")} style={{ transformOrigin: "top right" }} className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
                  <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-text-tertiary">Assign to</p>
                  {equipe.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => void atribuir(aberta, m.id)}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-secondary", aberta.atribuidaA === m.id && "bg-surface-tertiary font-medium")}
                    >
                      <AvatarDaEquipe m={m} />
                      <span className="flex-1 truncate">{m.nome}</span>
                      {aberta.atribuidaA === m.id ? <Check className="h-3.5 w-3.5 text-text-secondary" /> : null}
                    </button>
                  ))}
                  {aberta.atribuidaA ? (
                    <button type="button" onClick={() => void atribuir(aberta, null)} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border-light px-2 py-1.5 text-left text-[13px] text-text-secondary hover:bg-surface-secondary">
                      <X className="h-3.5 w-3.5" />
                      Unassign
                    </button>
                  ) : null}
                </mo.div>
              ) : null}
              </AnimatePresence>
              <AnimatePresence>
              {menu === "mais" ? (
                <mo.div {...flutuante("bottom")} style={{ transformOrigin: "top right" }} className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
                  {!fora(aberta) ? (
                    <>
                      <ItemDoMenu
                        icone={Archive}
                        titulo="Archive"
                        sub="Kept until you restore it"
                        onClick={() => {
                          setMenu(null);
                          void mover(aberta, "arquivar");
                        }}
                      />
                      <ItemDoMenu
                        icone={Trash2}
                        titulo="Delete"
                        sub="Returns on their next message"
                        onClick={() => {
                          setMenu(null);
                          if (confirm(`Delete the conversation with ${aberta.nome} from the inbox? Messages are kept and it comes back if they write again.`))
                            void mover(aberta, "excluir");
                        }}
                      />
                    </>
                  ) : null}
                  {fora(aberta) ? <p className="px-2 py-1.5 text-xs text-text-tertiary">Restore it first to archive or delete.</p> : null}
                  {!estadoPronto ? <p className="px-2 py-1.5 text-xs text-text-tertiary">Needs migration 354.</p> : null}
                </mo.div>
              ) : null}
              </AnimatePresence>
              <AnimatePresence>
              {menu === "acoes" ? (
                <mo.div {...flutuante("bottom")} style={{ transformOrigin: "top right" }} className="absolute right-0 top-10 z-30 w-72 rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
                  {aberta.tipo === "parceiro" ? (
                    <>
                      <ItemDoMenu
                        icone={Send}
                        titulo="Offer job"
                        sub="Assign an open job, with email and Zendesk"
                        onClick={() => {
                          setMenu(null);
                          setGaveta({ k: "oferecer" });
                        }}
                      />
                      {aberta.parceiro ? <ItemDoMenu icone={Wrench} titulo="Open partner" sub={aberta.parceiro.empresa ?? aberta.nome} href={`/partners/${aberta.parceiro.id}`} /> : null}
                      {aberta.jobHoje ? <ItemDoMenu icone={CalendarClock} titulo={`Open ${aberta.jobHoje.ref}`} sub="Today's job" href={`/jobs/${aberta.jobHoje.id}`} /> : null}
                    </>
                  ) : (
                    <>
                      <ItemDoMenu icone={Briefcase} titulo="Create job" sub="Opens the job form filled from this chat" onClick={() => abrirCriar("job")} />
                      <ItemDoMenu icone={FileText} titulo="Create quote" sub="Bespoke work, with partner bids" onClick={() => abrirCriar("quote")} />
                      {aberta.cliente ? (
                        <ItemDoMenu icone={UserRound} titulo="Open client" sub={aberta.cliente.nome} href={`/clients/${aberta.cliente.id}`} />
                      ) : (
                        <ItemDoMenu
                          icone={UserPlus}
                          titulo="Add as client"
                          sub="Form on the right"
                          onClick={() => {
                            setMenu(null);
                            fecharGaveta();
                          }}
                        />
                      )}
                      {aberta.etapa ? (
                        <ItemDoMenu
                          icone={iconeDaEtapa(aberta.etapa.grupo, aberta.etapa.status)}
                          titulo={`Open ${aberta.etapa.ref}`}
                          sub={aberta.etapa.grupo === "job" ? "Current job" : "Current quote"}
                          href={aberta.etapa.grupo === "job" ? `/jobs/${aberta.etapa.id}` : `/quotes?quoteId=${aberta.etapa.id}`}
                        />
                      ) : null}
                    </>
                  )}
                  {ticketDe(aberta) ? (
                    <ItemDoMenu icone={MessageSquare} titulo={`Zendesk ticket #${ticketDe(aberta)}`} sub="From the latest job" href={`${ZENDESK}${ticketDe(aberta)}`} externo />
                  ) : null}
                  {estadoPronto ? (
                    <ItemDoMenu
                      icone={resolvida(aberta) ? RotateCcw : CheckCheck}
                      titulo={resolvida(aberta) ? "Reopen" : "Resolve"}
                      sub="Reopens on their next message"
                      onClick={() => {
                        setMenu(null);
                        void resolver(aberta, !resolvida(aberta));
                      }}
                    />
                  ) : null}
                  {estadoPronto && fora(aberta) ? (
                    <ItemDoMenu
                      icone={ArchiveRestore}
                      titulo="Restore to inbox"
                      sub={arquivada(aberta) ? "Archived" : "Deleted"}
                      onClick={() => {
                        setMenu(null);
                        void mover(aberta, "restaurar");
                      }}
                    />
                  ) : null}
                </mo.div>
              ) : null}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-border-light bg-card px-4 py-1.5 empty:hidden">
            {aberta.cliente?.conta ? <Chip icone={Users}>{aberta.cliente.conta}</Chip> : null}
            {aberta.etapa ? <ChipDaEtapa e={aberta.etapa} /> : null}
            {aberta.jobHoje ? <ChipDaEtapa e={{ grupo: "job", status: aberta.jobHoje.status }} /> : null}
            {(() => {
              // A mesma etiqueta da lista: muda sozinha (At risk, Late, On site) e some quando acaba.
              const ch = aberta.jobHoje ? chegada(aberta.jobHoje, agora) : null;
              return ch ? (
                <mo.span key={ch.texto} {...CHIP} className="inline-flex">
                  <Chip icone={ch.icone} tom={ch.tom} title={`${aberta.jobHoje!.ref} · ${ch.title}`}>
                    {ch.texto}
                  </Chip>
                </mo.span>
              ) : null;
            })()}
            {aberta.tags.map((t) => (
              <Chip key={t} icone={Tag} tom="slate">
                {t}
                <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" aria-label={`Remove ${t}`} onClick={() => void alternarTag(aberta, t)}>
                  <X className="h-3 w-3" />
                </button>
              </Chip>
            ))}
            {resolvida(aberta) ? (
              <Chip icone={CheckCheck} tom="green">
                Resolved
              </Chip>
            ) : null}
            {arquivada(aberta) ? (
              <Chip icone={Archive} tom="slate">
                Archived
              </Chip>
            ) : null}
            {excluida(aberta) ? (
              <Chip icone={Trash2} tom="red">
                Deleted
              </Chip>
            ) : null}
            {gaveta?.k === "criar" ? <span className="ml-auto text-[11px] text-text-tertiary">Click messages to add them to the scope</span> : null}
          </div>

          {/* column-reverse segura a rolagem no fim; o mb-auto põe a conversa curta no topo, como no WhatsApp. */}
          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-4">
            <mo.div key={aberta.contato} className="mb-auto space-y-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tempo("md")}>
              <AnimatePresence initial={false}>
              {comPendentes(aberta.mensagens, pendentes[aberta.contato]).map((m, i, todas) => {
                const antes = todas[i - 1];
                const novoDia = !antes || new Date(antes.criadoEm).toDateString() !== new Date(m.criadoEm).toDateString();
                const marcavel = Boolean(gaveta?.k === "criar" && m.direcao === "entrada" && m.texto);
                return (
                  <mo.div
                    key={m.id}
                    id={`msg-${m.id}`}
                    layout="position"
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={tempo("lg")}
                    style={{ transformOrigin: m.direcao === "entrada" ? "bottom left" : "bottom right" }}
                  >
                    {novoDia ? (
                      <div className="my-2 flex justify-center">
                        <span className="rounded-full bg-surface-tertiary px-3 py-1 text-[11.5px] font-medium text-text-secondary">{diaDaMensagemOuHoje(m.criadoEm)}</span>
                      </div>
                    ) : null}
                    <div className={cn("group/msg flex items-end gap-2", m.direcao === "entrada" ? "justify-start" : "justify-end", reacoesDe(m).length && "pb-3")}>
                      {m.direcao === "entrada" ? (
                        <span className={cn(antes?.direcao === "entrada" && !novoDia && todas[i + 1]?.direcao === "entrada" ? "invisible" : "")}>
                          <Avatar c={aberta} canal />
                        </span>
                      ) : null}
                      {m.direcao === "saida" ? acoesDoBalao(m, aberta.contato) : null}
                      <div
                        onClick={() => marcar(m)}
                        className={cn(
                          "relative max-w-[68%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug shadow-[0_1px_0_rgba(10,10,31,0.04)]",
                          m.direcao === "entrada"
                            ? "rounded-bl-md border border-border-light bg-card text-text-primary"
                            : "rounded-br-md bg-primary text-[var(--on-brand)]",
                          marcavel && "cursor-pointer hover:ring-1 hover:ring-text-tertiary",
                          marcadas.has(m.id) && "ring-2 ring-text-primary hover:ring-2 hover:ring-text-primary",
                        )}
                      >
                        {m.origem !== "contato" && m.quem ? <p className="mb-0.5 text-[11.5px] font-semibold text-[var(--accent)]">{m.quem}</p> : null}
                        {m.autor && !(antes?.autor && (antes.autor.numero ?? antes.autor.nome) === (m.autor.numero ?? m.autor.nome) && !novoDia) ? (
                          <p className={cn("mb-0.5 text-[11.5px] font-semibold", corDoAutor(m.autor.numero ?? m.autor.nome ?? ""))}>
                            {nomeDoAutor(m.autor)}
                            {m.autor.numero && m.autor.nome ? <span className="ml-1.5 font-normal text-text-tertiary">+{m.autor.numero}</span> : null}
                          </p>
                        ) : null}
                        {m.citada ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              document.getElementById(`msg-${m.citada!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                            className={cn(
                              "mb-1 block w-full rounded-lg border-l-[3px] px-2 py-1 text-left text-[12px]",
                              m.direcao === "saida" ? "border-white/60 bg-white/15" : "border-[var(--accent)] bg-surface-secondary",
                            )}
                          >
                            <span className={cn("block text-[11px] font-semibold", m.direcao === "entrada" && "text-[var(--accent)]")}>
                              {m.citada.deNos ? (m.citada.quem ?? "You") : (m.citada.quem ?? aberta.nome)}
                            </span>
                            <span className="line-clamp-2 opacity-80">{m.citada.texto}</span>
                          </button>
                        ) : null}
                        <Midia m={m} />
                        <div className="flex flex-wrap items-end justify-end gap-x-2.5">
                          {m.texto && !(m.midiaUrl && SO_ROTULO.has(m.texto)) && !(m.midiaUrl && m.tipo === "document") ? (
                            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{m.texto}</p>
                          ) : m.midiaUrl ? null : (
                            <p className="min-w-0 flex-1 opacity-70">[{m.tipo}]</p>
                          )}
                          <span className="ml-auto inline-flex shrink-0 translate-y-0.5 items-center gap-1 text-[10.5px] tabular-nums opacity-65">
                            {m.origem === "celular" ? <Smartphone className="h-3 w-3" aria-label="Sent from the phone app" /> : null}
                            {horaCurta(m.criadoEm)}
                            {m.direcao === "saida" ? <Tique status={m.status} /> : null}
                          </span>
                        </div>
                        {m.status === "failed" ? (
                          <p className="mt-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium text-[#ffd2c2]">Not delivered{m.erro ? `: ${m.erro}` : ""}</p>
                        ) : null}
                        {reacoesDe(m).length ? (
                          <span
                            title={reacoesDe(m).map((r) => `${r.emoji} ${r.deNos ? (r.quem ?? "You") : (r.quem ?? aberta.nome)}`).join("\n")}
                            className={cn(
                              "absolute -bottom-3.5 flex items-center gap-0.5 rounded-full border border-border-light bg-card px-1.5 py-px text-[12px] leading-5 text-text-secondary shadow-sm",
                              m.direcao === "entrada" ? "left-3" : "right-3",
                            )}
                          >
                            {[...new Set(reacoesDe(m).map((r) => r.emoji))].join("")}
                            {reacoesDe(m).length > 1 ? <span className="ml-0.5 text-[10.5px] tabular-nums">{reacoesDe(m).length}</span> : null}
                          </span>
                        ) : null}
                      </div>
                      {m.direcao === "entrada" ? acoesDoBalao(m, aberta.contato) : null}
                      {m.direcao === "saida" ? (
                        // Em sequência da mesma pessoa, o avatar fica só no último balão.
                        <span className={cn(todas[i + 1]?.direcao === "saida" && todas[i + 1]?.quem === m.quem && todas[i + 1]?.origem === m.origem && new Date(todas[i + 1].criadoEm).toDateString() === new Date(m.criadoEm).toDateString() ? "invisible" : "")}>
                          <AvatarDeQuemMandou m={m} />
                        </span>
                      ) : null}
                    </div>
                  </mo.div>
                );
              })}
              </AnimatePresence>
            </mo.div>
          </div>

          <Composer
            respondendo={respondendo?.contato === aberta.contato ? respondendo.m : null}
            onCancelarResposta={() => setRespondendo(null)}
            contato={aberta.contato}
            nome={aberta.nome}
            tipo={aberta.tipo}
            canal="Operations"
            janelaAberta={janelaAberta(aberta)}
            semJanela={semJanela}
            onEnviado={() => router.refresh()}
            onPendente={(m) => setPendentes((p) => ({ ...p, [aberta.contato]: [...(p[aberta.contato] ?? []), m] }))}
            onResolvida={(id, erro) =>
              setPendentes((p) => ({
                ...p,
                [aberta.contato]: (p[aberta.contato] ?? []).map((m) => (m.id === id ? { ...m, status: erro ? "failed" : "sent", erro: erro ?? null } : m)),
              }))
            }
          />
        </section>
      ) : (
        <section className="flex items-center justify-center bg-surface-secondary/50 p-6 text-center text-sm text-text-tertiary">Select a conversation</section>
      )}

      {/* Quem está falando, ou a gaveta por cima. */}
      <aside className="relative min-h-0 overflow-y-auto border-l border-border-light">
        {aberta ? (
          gaveta?.k === "criar" ? (
            <GavetaDeCriar
              tipo={gaveta.tipo}
              c={aberta}
              scope={scope}
              setScope={setScope}
              endereco={endereco}
              setEndereco={setEndereco}
              marcadas={marcadas.size}
              onFechar={fecharGaveta}
              onContinuar={continuar}
            />
          ) : (
            <Painel key={aberta.contato} c={aberta} agora={agora} online={Boolean(presenca)} onCriar={abrirCriar} onOferecer={() => setGaveta({ k: "oferecer" })}
              onAbrirContato={(numero, nome) => abrirNumero({ numero, nome, tipo: "numero" })}
            />
          )
        ) : null}
      </aside>
      {/* Offer a job: modal só com os jobs em Unassigned, o painel continua atrás. */}
      {aberta?.tipo === "parceiro" ? (
        <Modal open={gaveta?.k === "oferecer"} onClose={fecharGaveta} title={`Offer a job to ${aberta.nome.startsWith("+") ? "this partner" : aberta.nome.split(" ")[0]}`} subtitle={`${paraOferecer.length} dated job${paraOferecer.length === 1 ? "" : "s"} without a partner`} size="lg">
          <OfertaDeJob
            emModal
            c={aberta}
            jobs={paraOferecer}
            onFechar={fecharGaveta}
            onEnviado={() => {
              fecharGaveta();
              router.refresh();
            }}
          />
        </Modal>
      ) : null}
      <AnimatePresence>
        {(() => {
          const c = menuDaLinha ? conversas.find((x) => x.contato === menuDaLinha.contato) : null;
          if (!menuDaLinha || !c) return null;
          const lida = naoLidas(c) === 0;
          const fazer = (f: () => void) => () => {
            setMenuDaLinha(null);
            f();
          };
          return (
            <mo.div
              key="menu-da-linha"
              {...flutuante("bottom")}
              style={{ left: menuDaLinha.x, top: Math.min(menuDaLinha.y, window.innerHeight - 180), transformOrigin: "top left" }}
              className="fixed z-50 w-52 rounded-xl border border-border-light bg-card p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <ItemCurto icone={c.fixadaEm ? PinOff : Pin} rotulo={c.fixadaEm ? "Unpin" : "Pin to top"} onClick={fazer(() => void marcarConversa(c, c.fixadaEm ? "desafixar" : "fixar"))} />
              <ItemCurto icone={lida ? MailOpen : CheckCheck} rotulo={lida ? "Mark as unread" : "Mark as read"} onClick={fazer(() => void marcarConversa(c, lida ? "nao_ler" : "ler"))} />
              <div className="my-1 h-px bg-border-light" />
              {fora(c) ? (
                <ItemCurto icone={ArchiveRestore} rotulo="Restore" onClick={fazer(() => void mover(c, "restaurar"))} />
              ) : (
                <ItemCurto icone={Archive} rotulo="Archive" disabled={!estadoPronto} onClick={fazer(() => void mover(c, "arquivar"))} />
              )}
            </mo.div>
          );
        })()}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

/**
 * A conversa com o que acabou de sair daqui. A pendente some quando o servidor
 * já traz a mesma mensagem (mesmo tipo, e mesmo texto se for texto); as que
 * falharam ficam, para a pessoa ver que não foi.
 */
export function comPendentes(doServidor: MensagemDaCaixa[], pendentes: MensagemDaCaixa[] | undefined): MensagemDaCaixa[] {
  if (!pendentes?.length) return doServidor;
  const vivas = pendentes.filter(
    (p) =>
      p.status === "failed" ||
      !doServidor.some(
        (m) =>
          m.direcao === "saida" &&
          m.tipo === p.tipo &&
          (p.tipo !== "text" || (m.texto ?? "") === (p.texto ?? "")) &&
          Date.parse(m.criadoEm) >= Date.parse(p.criadoEm) - 60_000,
      ),
  );
  return vivas.length ? [...doServidor, ...vivas] : doServidor;
}

/** O estado da mensagem que saiu, em ícone: relógio, um tique, dois, dois azuis, alerta. */
export function Tique({ status }: { status: string | null }) {
  if (status === "sending") return <Clock3 className="h-3 w-3" aria-label="Sending" />;
  if (status === "failed") return <CircleAlert className="h-3 w-3 text-[#ffb59a]" aria-label="Failed" />;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" />;
  return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
}

export function Midia({ m }: { m: MensagemDaCaixa }) {
  if (!m.midiaUrl) return null;
  if (m.tipo === "image" || m.tipo === "sticker") {
    return (
      <a href={m.midiaUrl} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto do WhatsApp por URL assinada ou da uazapi */}
        <img src={m.midiaUrl} alt="" className="mb-1 max-h-60 rounded-lg" />
      </a>
    );
  }
  if (m.tipo === "audio")
    return (
      <div className="mb-1 py-0.5">
        <PlayerDeAudio src={m.midiaUrl} />
      </div>
    );
  if (m.tipo === "video") return <video controls preload="metadata" src={m.midiaUrl} className="mb-1 max-h-60 rounded-lg" />;
  return (
    <a href={m.midiaUrl} target="_blank" rel="noreferrer" className="mb-1 inline-flex items-center gap-1.5 rounded-lg border border-current/20 px-2 py-1 underline-offset-2 hover:underline">
      <FileText className="h-3.5 w-3.5" />
      {m.texto ?? "Document"}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function ItemDoMenu({
  icone: Icone,
  titulo,
  sub,
  onClick,
  href,
  externo = false,
}: {
  icone: LucideIcon;
  titulo: string;
  sub?: string;
  onClick?: () => void;
  href?: string;
  externo?: boolean;
}) {
  const corpo = (
    <>
      <Icone className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
      <span className="min-w-0">
        <span className="block text-[13px] text-text-primary">{titulo}</span>
        {sub ? <span className="block truncate text-[11px] text-text-tertiary">{sub}</span> : null}
      </span>
    </>
  );
  const classe = "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-secondary";
  if (href) {
    return externo ? (
      <a href={href} target="_blank" rel="noreferrer" className={classe}>
        {corpo}
      </a>
    ) : (
      <Link href={href} className={classe}>
        {corpo}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classe} disabled={!onClick}>
      {corpo}
    </button>
  );
}
