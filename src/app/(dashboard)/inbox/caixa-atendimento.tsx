"use client";

/**
 * A caixa de atendimento do 7983, no desenho do Atendimento do VOS: filtros à
 * esquerda, conversas divididas em Partners e Clients, a conversa e o painel
 * de quem está falando. Texto em inglês como o resto do OS, sem travessão.
 *
 * Criar job ou cotação não tem formulário próprio aqui: a gaveta junta o que a
 * conversa já sabe (cliente, endereço, as mensagens marcadas viram o scope) e
 * abre o formulário de sempre em /jobs ou /quotes já preenchido
 * (src/lib/inbox/prefill.ts). A tela recarrega sozinha a cada 15 s.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Briefcase,
  Clock,
  ExternalLink,
  FileText,
  Home,
  Inbox,
  MessageSquare,
  Plus,
  Receipt,
  Smartphone,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { guardarPrefill, type TipoDoPrefill } from "@/lib/inbox/prefill";
import { cn } from "@/lib/utils";

export type MensagemDaCaixa = {
  id: string;
  direcao: "entrada" | "saida";
  origem: "contato" | "celular" | "os";
  tipo: string;
  texto: string | null;
  midiaUrl: string | null;
  status: string | null;
  erro: string | null;
  quem: string | null;
  criadoEm: string;
};

export type JobDaCaixa = {
  id: string;
  ref: string;
  titulo: string | null;
  data: string | null;
  inicio: string | null;
  endereco: string | null;
  ticket: string | null;
  status: string;
  parceiro: string | null;
};

export type ConversaDaCaixa = {
  contato: string;
  nome: string;
  perfil: string | null;
  tipo: "parceiro" | "cliente";
  ultimaEntradaEm: string | null;
  mensagens: MensagemDaCaixa[];
  parceiro: { id: string; empresa: string | null; oficio: string | null; email: string | null; status: string | null } | null;
  cliente: { id: string; nome: string; email: string | null; endereco: string | null; postcode: string | null; contaId: string | null; conta: string | null } | null;
  jobs: JobDaCaixa[];
  quotes: { id: string; ref: string; titulo: string | null; status: string; total: number }[];
  faturas: { id: string; ref: string; job: string | null; status: string; valor: number; pago: number }[];
};

type Visao = "todas" | "esperando";
type Tipo = "todas" | "parceiro" | "cliente";
type Aba = "info" | "jobs" | "quotes" | "faturas";

const JANELA_MS = 24 * 60 * 60 * 1000;
const ZENDESK = "https://fixfy.zendesk.com/agent/tickets/";
const libra = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

const hora = (iso: string) => {
  const d = new Date(iso);
  const mesmoDia = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(
    "en-GB",
    mesmoDia ? { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" } : { timeZone: "Europe/London", day: "numeric", month: "short" },
  );
};
const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const diaDaMensagem = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short" });
const dia = (data: string | null) => (data ? new Date(`${data}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "No date");

const iniciais = (nome: string) =>
  nome.startsWith("+")
    ? "#"
    : nome
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("");
const primeiroNome = (nome: string) => (nome.startsWith("+") ? "there" : nome.split(" ")[0]);

/** Esperando resposta nossa: a última mensagem da conversa é do contato. */
const esperando = (c: ConversaDaCaixa) => c.mensagens[c.mensagens.length - 1]?.direcao === "entrada";
/** Quantas mensagens do contato chegaram depois da nossa última. */
const naoRespondidas = (c: ConversaDaCaixa) => {
  let n = 0;
  for (let i = c.mensagens.length - 1; i >= 0 && c.mensagens[i].direcao === "entrada"; i--) n++;
  return n;
};
const janelaAberta = (c: ConversaDaCaixa) => Boolean(c.ultimaEntradaEm && Date.now() - new Date(c.ultimaEntradaEm).getTime() < JANELA_MS);
const ticketDe = (c: ConversaDaCaixa) => c.jobs.map((j) => j.ticket).find((t) => t && /^\d+$/.test(t)) ?? null;

const varianteDoStatus = (s: string): "success" | "warning" | "danger" | "info" | "default" => {
  const v = s.toLowerCase();
  if (["paid", "completed", "accepted", "approved", "closed"].includes(v)) return "success";
  if (["overdue", "cancelled", "rejected", "lost", "failed"].includes(v)) return "danger";
  if (["in_progress", "on_site", "scheduled", "sent", "bidding", "awaiting_payment"].includes(v)) return "info";
  if (["on_hold", "draft", "pending", "unassigned", "partially_paid"].includes(v)) return "warning";
  return "default";
};
const rotulo = (s: string) => (s ? s.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : "");

async function postar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/inbox/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
}

function Avatar({ c, grande = false }: { c: ConversaDaCaixa; grande?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        grande ? "h-14 w-14 text-base" : "h-9 w-9 text-xs",
        c.tipo === "parceiro" ? "bg-[var(--ok-bg,#e1f4f1)] text-[var(--ok-ink,#0f6e66)]" : "bg-[#f0ebfd] text-[#5b3bb7] dark:bg-[#2d2350] dark:text-[#cfc3f5]",
      )}
    >
      {iniciais(c.nome)}
    </div>
  );
}

function TipoBadge({ c }: { c: ConversaDaCaixa }) {
  return c.tipo === "parceiro" ? <Badge variant="success">Partner</Badge> : <Badge variant="info">{c.cliente ? "Client" : "New contact"}</Badge>;
}

function ItemDaLateral({ ativo, onClick, icone, rotulo: texto, n }: { ativo: boolean; onClick: () => void; icone: React.ReactNode; rotulo: string; n: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
        ativo ? "bg-surface-tertiary font-medium text-text-primary" : "text-text-secondary hover:bg-surface-secondary",
      )}
    >
      <span className="text-text-tertiary [&>svg]:h-4 [&>svg]:w-4">{icone}</span>
      {texto}
      <span className="ml-auto text-[11px] text-text-tertiary">{n}</span>
    </button>
  );
}

function CartaoDeJob({ j }: { j: JobDaCaixa }) {
  return (
    <div className="rounded-lg border border-border-light px-3 py-2">
      <div className="flex items-center gap-2">
        <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-text-primary hover:underline">
          {j.ref}
        </Link>
        {j.status ? (
          <span className="ml-auto">
            <Badge variant={varianteDoStatus(j.status)}>{rotulo(j.status)}</Badge>
          </span>
        ) : null}
      </div>
      {j.titulo ? <p className="truncate text-xs text-text-secondary">{j.titulo}</p> : null}
      <p className="text-[11px] text-text-tertiary">
        {dia(j.data)}
        {j.inicio ? ` · ${horaCurta(j.inicio)}` : ""}
        {j.parceiro ? ` · ${j.parceiro}` : ""}
      </p>
      {j.endereco ? <p className="truncate text-[11px] text-text-tertiary">{j.endereco}</p> : null}
      {j.ticket && /^\d+$/.test(j.ticket) ? (
        <a className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-primary hover:underline" href={`${ZENDESK}${j.ticket}`} target="_blank" rel="noreferrer">
          Ticket #{j.ticket}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-light px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{titulo}</p>
        {acao}
      </div>
      {children}
    </div>
  );
}

function Campo({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary">{k}</dt>
      <dd className="min-w-0 break-words text-text-primary">{v}</dd>
    </>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="text-xs text-text-tertiary">{texto}</p>;

export function CaixaAtendimento({ conversas, semJanela = false }: { conversas: ConversaDaCaixa[]; semJanela?: boolean }) {
  const router = useRouter();
  const [visao, setVisao] = useState<Visao>("todas");
  const [tipo, setTipo] = useState<Tipo>("todas");
  const [abertaId, setAbertaId] = useState<string | null>(conversas[0]?.contato ?? null);
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [assunto, setAssunto] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("info");
  const [menuAberto, setMenuAberto] = useState(false);
  /** Gaveta de criar: as mensagens marcadas na conversa viram o scope. */
  const [gaveta, setGaveta] = useState<TipoDoPrefill | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState("");
  const [endereco, setEndereco] = useState("");

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    if (!menuAberto) return;
    const fechar = () => setMenuAberto(false);
    document.addEventListener("click", fechar);
    return () => document.removeEventListener("click", fechar);
  }, [menuAberto]);

  const contagem = useMemo(
    () => ({
      todas: conversas.length,
      esperando: conversas.filter(esperando).length,
      parceiro: conversas.filter((c) => c.tipo === "parceiro").length,
      cliente: conversas.filter((c) => c.tipo === "cliente").length,
      semCadastro: conversas.filter((c) => c.tipo === "cliente" && !c.cliente).length,
    }),
    [conversas],
  );

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, "");
    return conversas.filter((c) => {
      if (visao === "esperando" && !esperando(c)) return false;
      if (tipo !== "todas" && c.tipo !== tipo) return false;
      if (!q) return true;
      if (qDig.length >= 4 && c.contato.includes(qDig)) return true;
      return [c.nome, c.parceiro?.empresa ?? "", c.parceiro?.oficio ?? "", c.cliente?.postcode ?? "", ...c.jobs.flatMap((j) => [j.ref, j.endereco ?? ""])].some((v) =>
        v.toLowerCase().includes(q),
      );
    });
  }, [conversas, visao, tipo, busca]);

  const aberta = conversas.find((c) => c.contato === abertaId) ?? lista[0] ?? null;

  function abrir(c: ConversaDaCaixa) {
    setAbertaId(c.contato);
    setAba("info");
    fecharGaveta();
  }

  function abrirGaveta(t: TipoDoPrefill) {
    if (!aberta) return;
    setMenuAberto(false);
    // Sem nada marcado, o scope começa com o que o contato escreveu desde a nossa última mensagem.
    const recentes = aberta.mensagens.slice(aberta.mensagens.length - Math.max(naoRespondidas(aberta), 1)).filter((m) => m.direcao === "entrada" && m.texto);
    setMarcadas(new Set(recentes.map((m) => m.id)));
    setScope(recentes.map((m) => m.texto).join("\n"));
    setEndereco([aberta.cliente?.endereco, aberta.cliente?.postcode].filter(Boolean).join(", "));
    setGaveta(t);
  }

  function fecharGaveta() {
    setGaveta(null);
    setMarcadas(new Set());
  }

  function marcar(m: MensagemDaCaixa) {
    if (!gaveta || !aberta || m.direcao !== "entrada" || !m.texto) return;
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
    if (!aberta || !gaveta) return;
    guardarPrefill(gaveta, {
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
    router.push(gaveta === "job" ? "/jobs?new=inbox" : "/quotes?new=inbox");
  }

  async function enviar(corpo: Record<string, unknown>, chave: string, depois: () => void) {
    if (!aberta) return;
    setEnviando(chave);
    try {
      await postar({ contato: aberta.contato, ...corpo });
      depois();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setEnviando(null);
    }
  }

  const aberto = semJanela || (aberta ? janelaAberta(aberta) : false);
  const canal = semJanela ? "Operations · 7983 via uazapi" : "Operations · 7983";

  return (
    <PageTransition>
      <div className="grid h-[calc(100vh-88px)] min-h-[560px] grid-cols-[200px_320px_minmax(0,1fr)_330px] overflow-hidden rounded-xl border border-border-light bg-card">
        {/* Lateral: visões e tipos, como o Inbox do VOS. */}
        <aside className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-border-light bg-surface-secondary/40 p-2.5">
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary">Inbox</p>
          <ItemDaLateral ativo={visao === "todas" && tipo === "todas"} onClick={() => { setVisao("todas"); setTipo("todas"); }} icone={<Inbox />} rotulo="All" n={contagem.todas} />
          <ItemDaLateral ativo={visao === "esperando"} onClick={() => setVisao("esperando")} icone={<Clock />} rotulo="Awaiting reply" n={contagem.esperando} />
          <p className="px-2.5 pb-1 pt-4 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary">Who</p>
          <ItemDaLateral ativo={visao === "todas" && tipo === "parceiro"} onClick={() => { setVisao("todas"); setTipo("parceiro"); }} icone={<Wrench />} rotulo="Partners" n={contagem.parceiro} />
          <ItemDaLateral ativo={visao === "todas" && tipo === "cliente"} onClick={() => { setVisao("todas"); setTipo("cliente"); }} icone={<Home />} rotulo="Clients" n={contagem.cliente} />
          <div className="mt-auto rounded-lg border border-border-light bg-card p-2.5 text-xs">
            <p className="font-medium text-text-primary">Channel</p>
            <p className="mt-1 flex items-center gap-1.5 text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              +44 7983 182332
            </p>
            <p className="text-[11px] text-text-tertiary">{semJanela ? "via uazapi · phone app stays on" : "via WhatsApp Cloud API"}</p>
          </div>
        </aside>

        {/* Conversas */}
        <section className="flex min-h-0 flex-col border-r border-border-light">
          <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
            <h2 className="flex-1 text-[17px] font-semibold text-text-primary">Conversations</h2>
          </div>
          <div className="px-4 pb-2">
            <SearchInput placeholder="Search name, number, job ref" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="mx-4 mb-2 grid grid-cols-3 rounded-lg bg-surface-secondary p-0.5">
            {(
              [
                ["todas", "All", contagem.todas],
                ["parceiro", "Partners", contagem.parceiro],
                ["cliente", "Clients", contagem.cliente],
              ] as const
            ).map(([k, t, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTipo(k)}
                className={cn(
                  "rounded-md py-1.5 text-xs font-medium transition-colors",
                  tipo === k ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {t} <span className="font-normal text-text-tertiary">{n}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-light">
            {lista.length === 0 ? (
              <p className="px-4 py-6 text-xs text-text-tertiary">{conversas.length === 0 ? "No messages yet. New messages to +44 7983 182332 land here." : "No conversations here."}</p>
            ) : null}
            {lista.map((c) => {
              const ultima = c.mensagens[c.mensagens.length - 1];
              const n = naoRespondidas(c);
              const ativa = c.contato === aberta?.contato;
              const proximo = c.jobs[0];
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
                  <Avatar c={c} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-text-primary">{c.nome}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-text-tertiary">{hora(ultima.criadoEm)}</span>
                      {n > 0 ? <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-text-primary px-1 text-[10.5px] text-card">{n}</span> : null}
                    </span>
                    <span className="block truncate text-xs text-text-secondary">
                      {ultima.direcao === "saida" ? "You: " : ""}
                      {ultima.texto ?? `[${ultima.tipo}]`}
                    </span>
                    <span className="mt-1 flex items-center gap-1">
                      <TipoBadge c={c} />
                      {c.parceiro?.oficio ? <Badge variant="default">{c.parceiro.oficio}</Badge> : null}
                      {c.cliente?.conta ? <Badge variant="default">{c.cliente.conta}</Badge> : null}
                      {proximo ? <Badge variant="default">{proximo.ref}</Badge> : null}
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
              <Avatar c={aberta} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[15px] font-semibold text-text-primary">
                  {aberta.nome}
                  <TipoBadge c={aberta} />
                </p>
                <p className="text-xs text-text-tertiary">
                  +{aberta.contato}
                  {aberta.perfil && aberta.perfil !== aberta.nome ? ` · WhatsApp name: ${aberta.perfil}` : ""}
                </p>
              </div>
              {semJanela ? null : aberto ? (
                <Badge variant="success">
                  <Clock className="mr-1 h-3 w-3" />
                  24h window open
                </Badge>
              ) : (
                <Badge variant="warning">
                  <Clock className="mr-1 h-3 w-3" />
                  Window closed: templates only
                </Badge>
              )}
            </div>

            <div className="relative flex items-center gap-2 border-b border-border-light bg-card px-4 py-2">
              {/* O clique não sobe: senão o "clicar fora" fecha o menu na mesma hora. */}
              <span onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => setMenuAberto((v) => !v)} icon={<Plus className="h-3.5 w-3.5" />}>
                  Actions
                </Button>
              </span>
              {aberta.tipo === "cliente" ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => abrirGaveta("job")} icon={<Briefcase className="h-3.5 w-3.5" />}>
                    Create job
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => abrirGaveta("quote")} icon={<FileText className="h-3.5 w-3.5" />}>
                    Create quote
                  </Button>
                </>
              ) : null}
              <span className="flex-1" />
              {gaveta ? <span className="text-[11px] text-text-tertiary">Click messages to add them to the scope</span> : null}
              {menuAberto ? (
                <div className="absolute left-4 top-11 z-20 w-64 rounded-xl border border-border-light bg-card p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                  {aberta.tipo === "cliente" ? (
                    <>
                      <ItemDoMenu icone={<Briefcase />} titulo="Create job" sub="Opens the job form filled from this chat" onClick={() => abrirGaveta("job")} />
                      <ItemDoMenu icone={<FileText />} titulo="Create quote" sub="Bespoke work, with partner bids" onClick={() => abrirGaveta("quote")} />
                      {aberta.cliente ? (
                        <ItemDoMenu icone={<UserRound />} titulo="Open client" sub={aberta.cliente.nome} href={`/clients/${aberta.cliente.id}`} />
                      ) : (
                        <ItemDoMenu icone={<UserRound />} titulo="No client with this number" sub="The job form can create one" />
                      )}
                    </>
                  ) : (
                    <>
                      {aberta.parceiro ? <ItemDoMenu icone={<Wrench />} titulo="Open partner" sub={aberta.parceiro.empresa ?? aberta.nome} href={`/partners/${aberta.parceiro.id}`} /> : null}
                      {aberta.jobs[0] ? <ItemDoMenu icone={<Briefcase />} titulo={`Open ${aberta.jobs[0].ref}`} sub="Next job" href={`/jobs/${aberta.jobs[0].id}`} /> : null}
                    </>
                  )}
                  {ticketDe(aberta) ? (
                    <ItemDoMenu icone={<MessageSquare />} titulo={`Zendesk ticket #${ticketDe(aberta)}`} sub="From the latest job" href={`${ZENDESK}${ticketDe(aberta)}`} externo />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-4">
              <div className="space-y-2">
                {aberta.mensagens.map((m, i) => {
                  const antes = aberta.mensagens[i - 1];
                  const novoDia = !antes || new Date(antes.criadoEm).toDateString() !== new Date(m.criadoEm).toDateString();
                  const marcavel = Boolean(gaveta && m.direcao === "entrada" && m.texto);
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
                          {m.midiaUrl && m.tipo === "image" ? (
                            <a href={m.midiaUrl} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- foto do WhatsApp por URL externa da uazapi */}
                              <img src={m.midiaUrl} alt="" className="mb-1 max-h-56 rounded-lg" />
                            </a>
                          ) : null}
                          {m.midiaUrl && m.tipo !== "image" ? (
                            <a href={m.midiaUrl} target="_blank" rel="noreferrer" className="mb-1 inline-flex items-center gap-1 underline">
                              Open {m.tipo}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                          {m.texto ? <p className="whitespace-pre-wrap break-words">{m.texto}</p> : m.midiaUrl ? null : <p className="opacity-70">[{m.tipo}]</p>}
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

            <div className="mx-4 mb-3 rounded-xl border border-border-light bg-card px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-medium text-text-primary">{canal}</span>
              </p>
              {aberto ? (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!texto.trim()) return;
                    void enviar({ texto }, "texto", () => setTexto(""));
                  }}
                >
                  <textarea
                    className="min-h-[44px] flex-1 resize-none bg-transparent py-2 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
                    placeholder={`Message ${primeiroNome(aberta.nome)}`}
                    value={texto}
                    rows={2}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (texto.trim()) void enviar({ texto }, "texto", () => setTexto(""));
                      }
                    }}
                  />
                  <Button type="submit" size="sm" loading={enviando === "texto"} disabled={!texto.trim()}>
                    Send
                  </Button>
                </form>
              ) : (
                <div className="space-y-2 py-1.5">
                  <p className="text-xs text-text-tertiary">WhatsApp only allows an approved template until {primeiroNome(aberta.nome)} writes back.</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={enviando === "no_response_followup"}
                    onClick={() => void enviar({ template: "no_response_followup", params: [primeiroNome(aberta.nome)] }, "no_response_followup", () => toast.success("Template sent"))}
                  >
                    <FileText />
                    No response follow-up
                  </Button>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!assunto.trim()) return;
                      void enviar({ template: "conversation_follow_up", params: [primeiroNome(aberta.nome), assunto.trim()] }, "conversation_follow_up", () => {
                        setAssunto("");
                        toast.success("Template sent");
                      });
                    }}
                  >
                    <input
                      className="min-h-[30px] flex-1 rounded-lg border border-border-light bg-card px-3 text-[12px] text-text-primary placeholder:text-text-tertiary"
                      placeholder="Follow up regarding JOB-9812 tomorrow at 10:00"
                      value={assunto}
                      onChange={(e) => setAssunto(e.target.value)}
                    />
                    <Button size="sm" type="submit" variant="secondary" loading={enviando === "conversation_follow_up"} disabled={!assunto.trim()}>
                      Send follow-up
                    </Button>
                  </form>
                </div>
              )}
              <p className="text-right text-[11px] text-text-tertiary">Enter sends · Shift+Enter new line</p>
            </div>
          </section>
        ) : (
          <section className="flex items-center justify-center bg-surface-secondary/50 p-6 text-center text-sm text-text-tertiary">Pick a conversation.</section>
        )}

        {/* Painel de quem está falando, ou a gaveta de criar por cima dele. */}
        <aside className="relative min-h-0 overflow-y-auto border-l border-border-light">
          {aberta ? (
            gaveta ? (
              <GavetaDeCriar
                tipo={gaveta}
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
              <Painel c={aberta} aba={aba} setAba={setAba} onCriar={abrirGaveta} />
            )
          ) : null}
        </aside>
      </div>
    </PageTransition>
  );
}

function ItemDoMenu({ icone, titulo, sub, onClick, href, externo = false }: { icone: React.ReactNode; titulo: string; sub?: string; onClick?: () => void; href?: string; externo?: boolean }) {
  const corpo = (
    <>
      <span className="mt-0.5 text-text-secondary [&>svg]:h-4 [&>svg]:w-4">{icone}</span>
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

function Painel({ c, aba, setAba, onCriar }: { c: ConversaDaCaixa; aba: Aba; setAba: (a: Aba) => void; onCriar: (t: TipoDoPrefill) => void }) {
  const abas: [Aba, string, number | null][] =
    c.tipo === "parceiro"
      ? [
          ["info", "Partner", null],
          ["jobs", "Jobs", c.jobs.length],
        ]
      : [
          ["info", "Client", null],
          ["jobs", "Jobs", c.jobs.length],
          ["quotes", "Quotes", c.quotes.length],
          ["faturas", "Invoices", c.faturas.length],
        ];
  return (
    <div>
      <div className="flex flex-col items-center border-b border-border-light px-4 pb-4 pt-5 text-center">
        <Avatar c={c} grande />
        <p className="mt-2 text-[15px] font-semibold text-text-primary">{c.nome}</p>
        <p className="text-xs text-text-tertiary">
          {c.tipo === "parceiro" ? c.parceiro?.oficio ?? "Partner" : c.cliente?.conta ?? (c.cliente ? "Fixfy direct" : "Not on file yet")}
        </p>
        <div className="mt-3 grid w-full grid-cols-2 gap-2">
          {c.tipo === "cliente" ? (
            <>
              <Button size="sm" onClick={() => onCriar("job")} icon={<Briefcase className="h-3.5 w-3.5" />}>
                Create job
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onCriar("quote")} icon={<FileText className="h-3.5 w-3.5" />}>
                Create quote
              </Button>
            </>
          ) : c.parceiro ? (
            <>
              <Link href={`/partners/${c.parceiro.id}`} className="col-span-2">
                <Button size="sm" variant="secondary" className="w-full" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                  Open partner
                </Button>
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border-light px-2">
        {abas.map(([k, t, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={cn(
              "whitespace-nowrap border-b-2 px-2 py-2.5 text-xs font-medium",
              aba === k ? "border-text-primary text-text-primary" : "border-transparent text-text-tertiary hover:text-text-secondary",
            )}
          >
            {t}
            {n ? <span className="ml-1 text-text-tertiary">{n}</span> : null}
          </button>
        ))}
      </div>

      {aba === "info" ? (
        c.tipo === "parceiro" ? (
          <>
            <Secao titulo="Partner">
              <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1.5 text-xs">
                <Campo k="Company" v={c.parceiro?.empresa ?? "-"} />
                <Campo k="Trade" v={c.parceiro?.oficio ?? "-"} />
                <Campo k="Phone" v={`+${c.contato}`} />
                <Campo k="Email" v={c.parceiro?.email ?? "-"} />
                <Campo k="Status" v={c.parceiro?.status ? rotulo(c.parceiro.status) : "-"} />
              </dl>
            </Secao>
            <Secao titulo="Next jobs">
              <div className="space-y-2">{c.jobs.length ? c.jobs.slice(0, 3).map((j) => <CartaoDeJob key={j.id} j={j} />) : <Vazio texto="Nothing booked." />}</div>
            </Secao>
          </>
        ) : (
          <>
            <Secao titulo="Client" acao={c.cliente ? <Link href={`/clients/${c.cliente.id}`} className="text-xs text-text-primary hover:underline">Open</Link> : null}>
              {c.cliente ? (
                <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1.5 text-xs">
                  <Campo k="Name" v={c.cliente.nome} />
                  <Campo k="Phone" v={`+${c.contato}`} />
                  <Campo k="Email" v={c.cliente.email ?? <span className="text-text-tertiary">Ask in chat</span>} />
                  <Campo k="Address" v={c.cliente.endereco ?? "-"} />
                  <Campo k="Postcode" v={c.cliente.postcode ?? "-"} />
                  <Campo k="Account" v={c.cliente.conta ?? "Fixfy direct"} />
                </dl>
              ) : (
                <p className="text-xs text-text-secondary">No client on file with +{c.contato}. Create a job or quote and the form adds the client.</p>
              )}
            </Secao>
            <Secao titulo="Latest job">{c.jobs[0] ? <CartaoDeJob j={c.jobs[0]} /> : <Vazio texto="No jobs yet." />}</Secao>
            <Secao titulo="Open invoices">
              {c.faturas.filter((f) => f.valor - f.pago > 0.01).length ? (
                <div className="space-y-1.5">
                  {c.faturas
                    .filter((f) => f.valor - f.pago > 0.01)
                    .map((f) => (
                      <div key={f.id} className="flex items-center justify-between text-xs">
                        <span className="text-text-primary">{f.ref}</span>
                        <span className="text-text-secondary">{libra.format(f.valor - f.pago)} due</span>
                      </div>
                    ))}
                </div>
              ) : (
                <Vazio texto="Nothing to pay." />
              )}
            </Secao>
          </>
        )
      ) : null}

      {aba === "jobs" ? (
        <div className="space-y-2 p-4">{c.jobs.length ? c.jobs.map((j) => <CartaoDeJob key={j.id} j={j} />) : <Vazio texto="No jobs." />}</div>
      ) : null}

      {aba === "quotes" ? (
        <div className="space-y-2 p-4">
          {c.quotes.length ? (
            c.quotes.map((q) => (
              <Link key={q.id} href={`/quotes?quoteId=${q.id}`} className="block rounded-lg border border-border-light px-3 py-2 hover:bg-surface-secondary/60">
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">{q.ref}</span>
                  <span className="ml-auto">
                    <Badge variant={varianteDoStatus(q.status)}>{rotulo(q.status)}</Badge>
                  </span>
                </span>
                {q.titulo ? <span className="block truncate text-xs text-text-secondary">{q.titulo}</span> : null}
                <span className="block text-[11px] text-text-tertiary">{libra.format(q.total)}</span>
              </Link>
            ))
          ) : (
            <Vazio texto="No quotes." />
          )}
        </div>
      ) : null}

      {aba === "faturas" ? (
        <div className="space-y-2 p-4">
          {c.faturas.length ? (
            c.faturas.map((f) => (
              <div key={f.id} className="rounded-lg border border-border-light px-3 py-2">
                <span className="flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-xs font-semibold text-text-primary">{f.ref}</span>
                  <span className="ml-auto">
                    <Badge variant={varianteDoStatus(f.status)}>{rotulo(f.status)}</Badge>
                  </span>
                </span>
                <span className="block text-[11px] text-text-tertiary">
                  {f.job ?? ""} · {libra.format(f.valor)}
                  {f.pago > 0.01 ? ` · ${libra.format(f.pago)} paid` : ""}
                </span>
              </div>
            ))
          ) : (
            <Vazio texto="No invoices." />
          )}
        </div>
      ) : null}
    </div>
  );
}

function GavetaDeCriar({
  tipo,
  c,
  scope,
  setScope,
  endereco,
  setEndereco,
  marcadas,
  onFechar,
  onContinuar,
}: {
  tipo: TipoDoPrefill;
  c: ConversaDaCaixa;
  scope: string;
  setScope: (v: string) => void;
  endereco: string;
  setEndereco: (v: string) => void;
  marcadas: number;
  onFechar: () => void;
  onContinuar: () => void;
}) {
  const ticket = ticketDe(c);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        {tipo === "job" ? <Briefcase className="h-4 w-4 text-text-primary" /> : <FileText className="h-4 w-4 text-text-primary" />}
        <p className="flex-1 text-[15px] font-semibold text-text-primary">{tipo === "job" ? "New job from this chat" : "New quote from this chat"}</p>
        <button type="button" onClick={onFechar} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs">
        <p className="rounded-lg bg-info-light px-3 py-2 text-[var(--info-ink)]">
          {tipo === "job"
            ? "Check what the chat gave us, then continue in the job form for service, date, price and partner. Price never goes in the scope."
            : "Bespoke work goes by quote. Standard handyman work can be booked as a job at £72/h."}
        </p>
        <div>
          <p className="mb-1 font-medium text-text-secondary">Client</p>
          <p className="rounded-lg border border-border-light px-2.5 py-2 text-text-primary">
            {c.cliente?.nome || c.nome} · +{c.contato}
            {c.cliente ? null : <span className="block text-[11px] text-text-tertiary">New client: the form creates it.</span>}
          </p>
        </div>
        <div>
          <p className="mb-1 font-medium text-text-secondary">Property address</p>
          <input
            className="w-full rounded-lg border border-border-light bg-card px-2.5 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
            placeholder="Flat 3, 22 Latchmere Road, SW11 5QT"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
          />
        </div>
        <div>
          <p className="mb-1 flex justify-between font-medium text-text-secondary">
            Scope (for the partner)
            <span className="font-normal text-text-tertiary">{marcadas} message{marcadas === 1 ? "" : "s"} picked</span>
          </p>
          <textarea
            className="min-h-[120px] w-full rounded-lg border border-border-light bg-card px-2.5 py-2 text-xs leading-relaxed text-text-primary"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
        </div>
        <div>
          <p className="mb-1 font-medium text-text-secondary">Zendesk ticket</p>
          <p className="rounded-lg border border-border-light px-2.5 py-2 text-text-primary">{ticket ? `#${ticket} · from the latest job` : "Pick or create one in the form"}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3">
        <Button size="sm" variant="ghost" onClick={onFechar}>
          Cancel
        </Button>
        <Button size="sm" onClick={onContinuar}>
          {tipo === "job" ? "Continue to job form" : "Continue to quote form"}
        </Button>
      </div>
    </div>
  );
}
