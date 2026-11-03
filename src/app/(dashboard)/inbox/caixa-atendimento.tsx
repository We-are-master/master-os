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
  Inbox,
  Layers,
  Link2,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Smartphone,
  Tag,
  UserPlus,
  UserRound,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { SearchInput } from "@/components/ui/input";
import { guardarPrefill, type TipoDoPrefill } from "@/lib/inbox/prefill";
import { cn } from "@/lib/utils";
import "./inbox.css";
import { Composer } from "./composer";
import { PlayerDeAudio } from "./player-de-audio";
import { GavetaDeCriar, OfertaDeJob, Painel, ZENDESK, horaCurta, ticketDe } from "./painel";
import { ETAPAS_DE_JOB, ETAPAS_DE_QUOTE, type ConversaDaCaixa, type JobParaOferecer, type MensagemDaCaixa, type TagDaCaixa } from "./tipos";
import { Acao, Avatar, Chip, ChipDaEtapa, ChipDoTipo, PONTO, TONS, iconeDaEtapa, presencaAgora, tomValido, type Tom } from "./ui";

/** A visão da lateral. Uma por vez, como no VOS. */
type Visao =
  | { k: "abertas" }
  | { k: "esperando" }
  | { k: "resolvidas" }
  | { k: "todas" }
  | { k: "hoje" }
  | { k: "tag"; nome: string }
  | { k: "etapa"; grupo: "quote" | "job"; status: string };
type Tipo = "todas" | "parceiro" | "cliente" | "outro";
type Periodo = "hoje" | "semana" | "mes" | "60d";
const PERIODOS: [Periodo, string, number][] = [
  ["hoje", "Today", 0],
  ["semana", "Week", 7],
  ["mes", "Month", 30],
  ["60d", "60d", 60],
];
/** A conversa teve mensagem dentro do período (hoje = desde a meia-noite de Londres). */
function noPeriodo(c: ConversaDaCaixa, p: Periodo, agora: number): boolean {
  const ultima = c.mensagens[c.mensagens.length - 1]?.criadoEm;
  if (!ultima) return false;
  if (p === "hoje") {
    const fmt = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    return fmt(new Date(ultima)) === fmt(new Date(agora));
  }
  const dias = PERIODOS.find((x) => x[0] === p)![2];
  return agora - new Date(ultima).getTime() <= dias * 86_400_000;
}
type Gaveta = { k: "criar"; tipo: TipoDoPrefill } | { k: "oferecer" } | null;

const JANELA_MS = 24 * 60 * 60 * 1000;
const CHAVE_ETAPAS = "fixfy:inbox:etapas";
const SO_ROTULO = new Set(["Photo", "Voice note", "Video", "Audio", "Sticker"]);

const hora = (iso: string) => {
  const d = new Date(iso);
  const mesmoDia = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(
    "en-GB",
    mesmoDia ? { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" } : { timeZone: "Europe/London", day: "numeric", month: "short" },
  );
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
/** Resolvida até o contato escrever depois do "resolver". */
const resolvida = (c: ConversaDaCaixa) => Boolean(c.resolvidaEm && (!c.ultimaEntradaEm || c.ultimaEntradaEm <= c.resolvidaEm));
const janelaAberta = (c: ConversaDaCaixa) => Boolean(c.ultimaEntradaEm && Date.now() - new Date(c.ultimaEntradaEm).getTime() < JANELA_MS);

function passa(c: ConversaDaCaixa, v: Visao): boolean {
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
    case "etapa":
      return c.etapa?.grupo === v.grupo && c.etapa.status === v.status;
  }
}
/** O job que a conversa trata: o de hoje, senão o atual do cliente, senão o próximo do parceiro. */
function jobDaConversa(c: ConversaDaCaixa): { id: string; ref: string } | null {
  if (c.jobHoje) return c.jobHoje;
  if (c.etapa?.grupo === "job") return c.etapa;
  return c.tipo === "parceiro" ? (c.jobs[0] ?? null) : null;
}
const mesmaVisao = (a: Visao, b: Visao) => JSON.stringify(a) === JSON.stringify(b);

async function postarConversa(corpo: Record<string, unknown>) {
  const res = await fetch("/api/inbox/conversa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
}

function ItemDaLateral({
  ativo,
  onClick,
  icone: Icone,
  ponto,
  rotulo,
  n,
  apagado,
}: {
  ativo: boolean;
  onClick: () => void;
  icone?: LucideIcon;
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
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
        ativo ? "bg-surface-tertiary font-medium text-text-primary" : "text-text-secondary hover:bg-surface-secondary",
        apagado && !ativo && "opacity-55",
      )}
    >
      {Icone ? <Icone className="h-4 w-4 shrink-0 text-text-tertiary" /> : null}
      {ponto ? <span className={cn("ml-1 mr-0.5 h-2 w-2 shrink-0 rounded-full", PONTO[ponto])} /> : null}
      <span className="truncate">{rotulo}</span>
      <span className="ml-auto text-[11px] text-text-tertiary">{n}</span>
    </button>
  );
}

const Titulo = ({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) => (
  <p className="flex items-center px-2.5 pb-1 pt-4 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
    <span className="flex-1">{children}</span>
    {acao}
  </p>
);

export function CaixaAtendimento({
  conversas: doServidor,
  tags: tagsDoServidor,
  paraOferecer,
  semJanela = false,
  estadoPronto = true,
}: {
  conversas: ConversaDaCaixa[];
  tags: TagDaCaixa[];
  paraOferecer: JobParaOferecer[];
  semJanela?: boolean;
  estadoPronto?: boolean;
}) {
  const router = useRouter();
  const [visao, setVisao] = useState<Visao>({ k: "abertas" });
  const [tipo, setTipo] = useState<Tipo>("todas");
  const [periodo, setPeriodo] = useState<Periodo>("60d");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [menu, setMenu] = useState<"acoes" | "tags" | null>(null);
  const [gaveta, setGaveta] = useState<Gaveta>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState("");
  const [endereco, setEndereco] = useState("");
  const [verEtapas, setVerEtapas] = useState(true);
  const [agora, setAgora] = useState(() => Date.now());
  const [canal, setCanal] = useState<{ conectado: boolean; estado: string } | null>(null);
  /** O que a equipe acabou de mudar, até o servidor confirmar no próximo refresh. */
  const [local, setLocal] = useState<Record<string, { resolvidaEm?: string | null; tags?: string[] }>>({});
  const [tagsNovas, setTagsNovas] = useState<TagDaCaixa[]>([]);
  const [novaTag, setNovaTag] = useState("");
  const [corNova, setCorNova] = useState<Tom>("blue");
  const [criandoView, setCriandoView] = useState(false);
  const [apagadas, setApagadas] = useState<Set<string>>(new Set());

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
  const corDaTag = (nome: string) => tomValido(tags.find((t) => t.nome === nome)?.cor ?? "slate");

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

  useEffect(() => {
    let vivo = true;
    const ler = () =>
      fetch("/api/inbox/canal")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (vivo && j) setCanal(j);
        })
        .catch(() => undefined);
    void ler();
    const t = setInterval(ler, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const fechar = () => setMenu(null);
    document.addEventListener("click", fechar);
    return () => document.removeEventListener("click", fechar);
  }, [menu]);

  const contagem = useMemo(() => {
    const n = (f: (c: ConversaDaCaixa) => boolean) => conversas.filter(f).length;
    return {
      abertas: n((c) => !resolvida(c)),
      esperando: n((c) => !resolvida(c) && esperando(c)),
      resolvidas: n(resolvida),
      todas: conversas.length,
      hoje: n((c) => Boolean(c.jobHoje)),
      parceiro: n((c) => c.tipo === "parceiro"),
      cliente: n((c) => c.tipo === "cliente"),
      outro: n((c) => c.tipo === "outro"),
    };
  }, [conversas]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, "");
    return conversas.filter((c) => {
      if (!passa(c, visao)) return false;
      if (!noPeriodo(c, periodo, agora)) return false;
      if (tipo !== "todas" && c.tipo !== tipo) return false;
      if (!q) return true;
      if (qDig.length >= 4 && c.contato.includes(qDig)) return true;
      return [c.nome, c.perfil ?? "", c.parceiro?.empresa ?? "", c.parceiro?.oficio ?? "", c.cliente?.postcode ?? "", ...c.tags, ...c.jobs.flatMap((j) => [j.ref, j.endereco ?? ""])].some(
        (v) => v.toLowerCase().includes(q),
      );
    });
  }, [conversas, visao, tipo, busca, periodo, agora]);

  const aberta = conversas.find((c) => c.contato === abertaId) ?? lista[0] ?? null;
  const presenca = aberta ? presencaAgora(aberta, agora) : null;

  function irPara(v: Visao) {
    setVisao(v);
    setTipo("todas");
  }

  function abrir(c: ConversaDaCaixa) {
    setAbertaId(c.contato);
    fecharGaveta();
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
      toast.success(fechar ? "Resolved. It reopens when they write again." : "Reopened");
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
      const res = await fetch("/api/inbox/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, cor: corNova }) });
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
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PONTO[corNova])} />
        <input
          autoFocus={!paraConversa}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
          placeholder="View name"
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
      <div className="flex items-center gap-1.5">
        {(Object.keys(TONS) as Tom[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={`Colour ${t}`}
            onClick={() => setCorNova(t)}
            className={cn("h-3.5 w-3.5 rounded-full transition-transform hover:scale-110", PONTO[t], corNova === t && "ring-2 ring-text-primary ring-offset-2 ring-offset-card")}
          />
        ))}
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
          {paraConversa ? "Create and tag" : "Create view"}
        </button>
      </div>
    </form>
  );

  return (
    <div className="cx grid h-screen min-h-[560px] grid-cols-[216px_330px_minmax(0,1fr)_300px] overflow-hidden bg-card">
      {/* Lateral */}
      <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-border-light bg-surface-secondary/40 p-2.5">
        <p className="px-2.5 pb-1 pt-1.5 text-[15px] font-semibold text-text-primary">Inbox</p>
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "abertas" }) && tipo === "todas"} onClick={() => irPara({ k: "abertas" })} icone={Inbox} rotulo="Open" n={contagem.abertas} />
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "esperando" })} onClick={() => irPara({ k: "esperando" })} icone={Clock} rotulo="Awaiting reply" n={contagem.esperando} />
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "hoje" })} onClick={() => irPara({ k: "hoje" })} icone={CalendarClock} rotulo="Job today" n={contagem.hoje} />
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "resolvidas" })} onClick={() => irPara({ k: "resolvidas" })} icone={CheckCheck} rotulo="Resolved" n={contagem.resolvidas} />
        <ItemDaLateral ativo={mesmaVisao(visao, { k: "todas" }) && tipo === "todas"} onClick={() => irPara({ k: "todas" })} icone={Layers} rotulo="All" n={contagem.todas} />

        <Titulo>Who</Titulo>
        <ItemDaLateral
          ativo={mesmaVisao(visao, { k: "todas" }) && tipo === "parceiro"}
          onClick={() => {
            setVisao({ k: "todas" });
            setTipo("parceiro");
          }}
          icone={Wrench}
          rotulo="Partners"
          n={contagem.parceiro}
        />
        <ItemDaLateral
          ativo={mesmaVisao(visao, { k: "todas" }) && tipo === "cliente"}
          onClick={() => {
            setVisao({ k: "todas" });
            setTipo("cliente");
          }}
          icone={Home}
          rotulo="Clients"
          n={contagem.cliente}
        />
        <ItemDaLateral
          ativo={mesmaVisao(visao, { k: "todas" }) && tipo === "outro"}
          onClick={() => {
            setVisao({ k: "todas" });
            setTipo("outro");
          }}
          icone={UserRound}
          rotulo="Not on file"
          n={contagem.outro}
        />

        <Titulo
          acao={
            estadoPronto ? (
              <button type="button" onClick={() => setCriandoView((v) => !v)} className="rounded p-0.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary" aria-label="New view" title="New view">
                <Plus className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        >
          Views
        </Titulo>
        {tags.map((t) => (
          <div key={t.nome} className="group relative">
            <ItemDaLateral
              ativo={mesmaVisao(visao, { k: "tag", nome: t.nome })}
              onClick={() => irPara({ k: "tag", nome: t.nome })}
              ponto={tomValido(t.cor)}
              rotulo={t.nome}
              n={nTag(t.nome)}
            />
            <button
              type="button"
              onClick={() => void apagarView(t.nome)}
              className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded bg-surface-secondary p-0.5 text-text-tertiary hover:text-[var(--bad-ink)] group-hover:block"
              aria-label={`Delete view ${t.nome}`}
              title="Delete view"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {criandoView ? (
          <div className="mx-1 mt-1 rounded-lg border border-border-light bg-card p-2">{criadorDeTag(null)}</div>
        ) : (
          <button
            type="button"
            onClick={() => setCriandoView(true)}
            disabled={!estadoPronto}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-tertiary hover:bg-surface-secondary hover:text-text-secondary disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {tags.length ? "New view" : "New view, e.g. Follow up"}
          </button>
        )}

        <Titulo
          acao={
            <button type="button" onClick={alternarEtapas} className="inline-flex items-center gap-1 normal-case tracking-normal text-text-tertiary hover:text-text-primary">
              {verEtapas ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {verEtapas ? "Hide" : "Show"}
            </button>
          }
        >
          Stages
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

        <div className="mt-auto pt-4">
          <div className="rounded-lg border border-border-light bg-card p-2.5 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-text-primary">
              <span className={cn("h-2 w-2 rounded-full", canal == null ? "bg-slate-300" : canal.conectado ? "bg-emerald-500" : "bg-red-500")} />
              {canal == null ? "Checking channel" : canal.conectado ? "Connected" : "Disconnected"}
            </p>
            <p className="mt-0.5 text-text-secondary">+44 7983 182332</p>
            <p className="text-[11px] text-text-tertiary">{semJanela ? "via uazapi · phone app stays on" : "via WhatsApp Cloud API"}</p>
          </div>
          {estadoPronto ? null : <p className="mt-2 px-1 text-[11px] text-[var(--bad-ink)]">Resolve and views need migration 354.</p>}
        </div>
      </aside>

      {/* Conversas */}
      <section className="flex min-h-0 flex-col border-r border-border-light">
        <div className="flex items-center px-4 pb-2 pt-3.5">
          <h2 className="flex-1 text-[17px] font-semibold text-text-primary">Conversations</h2>
        </div>
        <div className="px-4 pb-2">
          <SearchInput placeholder="Search name, number, job ref, tag" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="mx-4 mb-2 grid grid-cols-3 rounded-lg bg-surface-secondary p-0.5">
          {(
            [
              ["todas", "All"],
              ["parceiro", "Partners"],
              ["cliente", "Clients"],
            ] as const
          ).map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTipo(k)}
              className={cn("rounded-md py-1.5 text-xs font-medium transition-colors", tipo === k ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}
            >
              {t} <span className="font-normal text-text-tertiary">{conversas.filter((c) => passa(c, visao) && noPeriodo(c, periodo, agora) && (k === "todas" || c.tipo === k)).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 px-4 pb-2.5">
          {PERIODOS.map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPeriodo(k)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                periodo === k ? "border-primary bg-primary text-[var(--on-brand)]" : "border-border-light text-text-secondary hover:bg-surface-secondary",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-light">
          {lista.length === 0 ? (
            <p className="px-4 py-6 text-xs text-text-tertiary">{conversas.length === 0 ? "No messages yet. New messages to +44 7983 182332 land here." : "Nothing in this view."}</p>
          ) : null}
          {lista.map((c) => {
            const ultima = c.mensagens[c.mensagens.length - 1];
            const n = resolvida(c) ? 0 : naoRespondidas(c);
            const ativa = c.contato === aberta?.contato;
            const p = presencaAgora(c, agora);
            return (
              <button
                key={c.contato}
                type="button"
                onClick={() => abrir(c)}
                className={cn(
                  "relative flex w-full gap-2.5 border-b border-border-light/60 px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary/60",
                  ativa && "bg-surface-tertiary/70 hover:bg-surface-tertiary/70",
                )}
              >
                {ativa ? <span className="absolute inset-y-0 left-0 w-[3px] bg-text-primary" /> : null}
                <Avatar c={c} online={Boolean(p)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-text-primary">{c.nome}</span>
                    {resolvida(c) ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : null}
                    <span className="ml-auto shrink-0 text-[11px] text-text-tertiary">{hora(ultima.criadoEm)}</span>
                    {n > 0 ? <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-text-primary px-1 text-[10.5px] text-card">{n}</span> : null}
                  </span>
                  <span className={cn("block truncate text-xs", p === "digitando" || p === "gravando" ? "text-emerald-600" : "text-text-secondary")}>
                    {p === "digitando"
                      ? "typing..."
                      : p === "gravando"
                        ? "recording audio..."
                        : `${ultima.direcao === "saida" ? "You: " : ""}${ultima.texto ?? `[${ultima.tipo}]`}`}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <ChipDoTipo c={c} />
                    {c.etapa ? <ChipDaEtapa e={c.etapa} /> : null}
                    {c.jobHoje ? (
                      <Chip icone={CalendarClock} tom="blue">
                        Today{c.jobHoje.inicio ? ` ${horaCurta(c.jobHoje.inicio)}` : ""}
                      </Chip>
                    ) : null}
                    {c.tags.slice(0, 2).map((t) => (
                      <Chip key={t} icone={Tag} tom={corDaTag(t)}>
                        {t}
                      </Chip>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* A conversa */}
      {aberta ? (
        <section className="flex min-h-0 flex-col bg-surface-secondary/50">
          <div className="flex items-center gap-3 border-b border-border-light bg-card px-4 py-2.5">
            <Avatar c={aberta} online={Boolean(presenca)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-text-primary">{aberta.nome}</p>
              <p className="truncate text-xs text-text-tertiary">
                {presenca === "digitando" ? (
                  <span className="text-emerald-600">typing...</span>
                ) : presenca === "gravando" ? (
                  <span className="text-emerald-600">recording audio...</span>
                ) : presenca === "online" ? (
                  <span className="text-emerald-600">online</span>
                ) : aberta.ultimaEntradaEm ? (
                  `last message ${haQuanto(aberta.ultimaEntradaEm, agora)}`
                ) : (
                  "no reply yet"
                )}
                {" · "}+{aberta.contato}
                {aberta.perfil && aberta.perfil !== aberta.nome ? ` · WhatsApp: ${aberta.perfil}` : ""}
              </p>
            </div>
            <div className="relative flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {jobDaConversa(aberta) ? (
                <Link href={`/jobs/${jobDaConversa(aberta)!.id}`}>
                  <Acao icone={Link2} title="Open the job">
                    {jobDaConversa(aberta)!.ref}
                  </Acao>
                </Link>
              ) : aberta.etapa?.grupo === "quote" ? (
                <Link href={`/quotes?quoteId=${aberta.etapa.id}`}>
                  <Acao icone={Link2} title="Open the quote">
                    {aberta.etapa.ref}
                  </Acao>
                </Link>
              ) : null}
              <Acao icone={Tag} ativo={menu === "tags"} onClick={() => setMenu((m) => (m === "tags" ? null : "tags"))} disabled={!estadoPronto}>
                Tag
              </Acao>
              {resolvida(aberta) ? (
                <Acao icone={RotateCcw} onClick={() => void resolver(aberta, false)} disabled={!estadoPronto}>
                  Reopen
                </Acao>
              ) : (
                <Acao icone={CheckCheck} onClick={() => void resolver(aberta, true)} disabled={!estadoPronto}>
                  Resolve
                </Acao>
              )}
              <Acao icone={Plus} variante="primario" onClick={() => setMenu((m) => (m === "acoes" ? null : "acoes"))}>
                Actions
                <ChevronDown className="h-3.5 w-3.5" />
              </Acao>

              {menu === "tags" ? (
                <div className="absolute right-[150px] top-10 z-30 w-60 rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
                  <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Add to views</p>
                  {tags.length === 0 ? <p className="px-2 py-1 text-xs text-text-tertiary">No views yet. Create one below.</p> : null}
                  {tags.map((t) => (
                    <label key={t.nome} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-text-primary hover:bg-surface-secondary">
                      <input type="checkbox" checked={aberta.tags.includes(t.nome)} onChange={() => void alternarTag(aberta, t.nome)} />
                      <span className={cn("h-2 w-2 rounded-full", PONTO[tomValido(t.cor)])} />
                      {t.nome}
                    </label>
                  ))}
                  <div className="mt-1.5 border-t border-border-light px-1 pt-2">{criadorDeTag(aberta)}</div>
                </div>
              ) : null}

              {menu === "acoes" ? (
                <div className="absolute right-0 top-10 z-30 w-72 rounded-xl border border-border-light bg-card p-1.5 shadow-lg">
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
                      sub="Reopens by itself when they write"
                      onClick={() => {
                        setMenu(null);
                        void resolver(aberta, !resolvida(aberta));
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-border-light bg-card px-4 py-1.5">
            <ChipDoTipo c={aberta} />
            {aberta.parceiro?.oficio ? <Chip icone={Wrench}>{aberta.parceiro.oficio}</Chip> : null}
            {aberta.cliente?.conta ? <Chip icone={Users}>{aberta.cliente.conta}</Chip> : null}
            {aberta.etapa ? <ChipDaEtapa e={aberta.etapa} /> : null}
            {aberta.jobHoje ? <ChipDaEtapa e={{ grupo: "job", status: aberta.jobHoje.status }} /> : null}
            {aberta.jobHoje ? (
              <Chip icone={CalendarClock} tom="blue">
                {aberta.jobHoje.ref} today{aberta.jobHoje.inicio ? ` ${horaCurta(aberta.jobHoje.inicio)}` : ""}
              </Chip>
            ) : null}
            {aberta.tags.map((t) => (
              <Chip key={t} icone={Tag} tom={corDaTag(t)}>
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
            {gaveta?.k === "criar" ? <span className="ml-auto text-[11px] text-text-tertiary">Click messages to add them to the scope</span> : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              {aberta.mensagens.map((m, i) => {
                const antes = aberta.mensagens[i - 1];
                const novoDia = !antes || new Date(antes.criadoEm).toDateString() !== new Date(m.criadoEm).toDateString();
                const marcavel = Boolean(gaveta?.k === "criar" && m.direcao === "entrada" && m.texto);
                return (
                  <div key={m.id}>
                    {novoDia ? (
                      <div className="my-2 flex justify-center">
                        <span className="rounded-full border border-border-light bg-card px-2.5 py-0.5 text-[11px] text-text-tertiary">{diaDaMensagem(m.criadoEm)}</span>
                      </div>
                    ) : null}
                    <div className={cn("flex", m.direcao === "entrada" ? "justify-start" : "justify-end")}>
                      <div
                        onClick={() => marcar(m)}
                        className={cn(
                          "max-w-[68%] rounded-xl px-3 py-2 text-[13px] leading-snug",
                          m.direcao === "entrada" ? "border border-border-light bg-card text-text-primary" : "bg-info-light text-[var(--info-ink)]",
                          marcavel && "cursor-pointer hover:ring-1 hover:ring-text-tertiary",
                          marcadas.has(m.id) && "ring-2 ring-text-primary hover:ring-2 hover:ring-text-primary",
                        )}
                      >
                        {m.origem === "os" && m.quem ? <p className="mb-0.5 text-[11px] font-medium opacity-80">{m.quem}</p> : null}
                        <Midia m={m} />
                        {m.texto && !(m.midiaUrl && SO_ROTULO.has(m.texto)) && !(m.midiaUrl && m.tipo === "document") ? (
                          <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                        ) : m.midiaUrl ? null : (
                          <p className="opacity-70">[{m.tipo}]</p>
                        )}
                        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] opacity-70">
                          {m.origem === "celular" ? (
                            <>
                              <Smartphone className="h-3 w-3" />
                              Phone app ·
                            </>
                          ) : null}
                          {horaCurta(m.criadoEm)}
                          {m.direcao === "saida" && m.status ? ` · ${m.status}` : ""}
                        </p>
                        {m.status === "failed" ? <p className="mt-0.5 text-[11px] text-[var(--bad-ink)]">Not delivered{m.erro ? `: ${m.erro}` : ""}</p> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Composer
            contato={aberta.contato}
            nome={aberta.nome}
            tipo={aberta.tipo}
            canal={`${aberta.tipo === "parceiro" ? "Partners" : aberta.tipo === "cliente" ? "Clients" : "Operations"} · 7983${semJanela ? " via uazapi" : ""}`}
            janelaAberta={janelaAberta(aberta)}
            semJanela={semJanela}
            onEnviado={() => router.refresh()}
          />
        </section>
      ) : (
        <section className="flex items-center justify-center bg-surface-secondary/50 p-6 text-center text-sm text-text-tertiary">Pick a conversation.</section>
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
          ) : gaveta?.k === "oferecer" && aberta.tipo === "parceiro" ? (
            <OfertaDeJob
              c={aberta}
              jobs={paraOferecer}
              onFechar={fecharGaveta}
              onEnviado={() => {
                fecharGaveta();
                router.refresh();
              }}
            />
          ) : (
            <Painel key={aberta.contato} c={aberta} online={Boolean(presenca)} onCriar={abrirCriar} onOferecer={() => setGaveta({ k: "oferecer" })} />
          )
        ) : null}
      </aside>
    </div>
  );
}

function Midia({ m }: { m: MensagemDaCaixa }) {
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
