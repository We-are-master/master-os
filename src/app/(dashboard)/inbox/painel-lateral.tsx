"use client";

/**
 * Atendimento lateral (como o do VOS): o ícone no topo do OS abre a caixa do
 * 7983 por cima de qualquer tela. A lista com busca e abas, e a conversa com o
 * mesmo composer da /inbox. O ↗ leva à /inbox completa na mesma conversa.
 * Os dados vêm de /api/inbox/lista (a mesma montagem da /inbox, dados.ts).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion as mo } from "framer-motion";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Search, X } from "lucide-react";
import { ChatsCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import "./inbox.css";
import { Composer } from "./composer";
import { Midia, SO_ROTULO, Tique, comPendentes, conversaRascunho, diaDaMensagemOuHoje, fora, naoLidas, quandoNaLista } from "./caixa-atendimento";
import { EVENTO_ABRIR_CONVERSA, type PedidoDeConversa } from "@/lib/inbox/abrir-conversa";
import { tempo } from "./movimento";
import type { ConversaDaCaixa, MensagemDaCaixa } from "./tipos";
import { Avatar, ChipDoTipo, SeletorDeTipo, corDoAutor, nomeDoAutor, type TipoRapido } from "./ui";

/** Clients junta cliente, conta e lead, como na /inbox. */
const DE_CLIENTE = new Set(["cliente", "conta", "outro"]);

const LARGURA_PADRAO = 400;
const LARGURA_MIN = 340;
const LARGURA_MAX = 760;
const CHAVE_LARGURA = "inbox-lateral-largura";

type Lista = { conversas: ConversaDaCaixa[]; semJanela: boolean; estadoPronto: boolean };

export function AtendimentoLateral() {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  // Lembra a largura que a pessoa deixou (só conveniência deste navegador). O painel
  // nasce fechado, então ler no primeiro render não dá diferença com o servidor.
  const [largura, setLargura] = useState(() => {
    try {
      const w = Number(typeof window === "undefined" ? 0 : localStorage.getItem(CHAVE_LARGURA));
      return w >= LARGURA_MIN && w <= LARGURA_MAX ? w : LARGURA_PADRAO;
    } catch {
      return LARGURA_PADRAO;
    }
  });
  const [dados, setDados] = useState<Lista | null>(null);
  const [aba, setAba] = useState<TipoRapido>("todas");
  const [busca, setBusca] = useState("");
  const [contato, setContato] = useState<string | null>(null);
  const [conversa, setConversa] = useState<ConversaDaCaixa | null>(null);
  const [pendentes, setPendentes] = useState<MensagemDaCaixa[]>([]);
  const [agora, setAgora] = useState(() => Date.now());
  const [erro, setErro] = useState(false);

  const carregarLista = useCallback(async () => {
    const r = await fetch("/api/inbox/lista", { cache: "no-store" }).catch(() => null);
    setErro(!r?.ok);
    if (!r?.ok) return;
    setDados((await r.json()) as Lista);
    setAgora(Date.now());
  }, []);

  const carregarConversa = useCallback(async (numero: string) => {
    const r = await fetch(`/api/inbox/lista?contato=${numero}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const j = (await r.json()) as { conversa: ConversaDaCaixa };
    setConversa(j.conversa);
  }, []);

  // Fechado: só o contador, a cada 30 s. Aberto: a cada 10 s (e a conversa aberta junto).
  useEffect(() => {
    const primeira = setTimeout(() => void carregarLista(), 0);
    const t = setInterval(
      () => {
        void carregarLista();
        if (aberto && contato) void carregarConversa(contato);
      },
      aberto ? 10_000 : 30_000,
    );
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [aberto, contato, carregarLista, carregarConversa]);

  // Um número clicado em outra tela (o telefone do cliente no job) abre aqui a conversa,
  // a que já existe ou um rascunho para começar.
  useEffect(() => {
    const ouvir = (e: Event) => {
      const d = (e as CustomEvent<PedidoDeConversa>).detail;
      if (!d?.numero) return;
      setAberto(true);
      setContato(d.numero);
      setPendentes([]);
      setConversa(dados?.conversas.find((c) => c.contato === d.numero) ?? conversaRascunho({ numero: d.numero, nome: d.nome, tipo: d.tipo ?? "cliente" }));
      void carregarConversa(d.numero);
    };
    window.addEventListener(EVENTO_ABRIR_CONVERSA, ouvir);
    return () => window.removeEventListener(EVENTO_ABRIR_CONVERSA, ouvir);
  }, [dados, carregarConversa]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [aberto]);

  // Encaixado como no VOS: a página abre espaço do tamanho do painel.
  const visivel = aberto && !(pathname === "/inbox" || pathname.startsWith("/inbox/"));
  useEffect(() => {
    const raiz = document.documentElement;
    if (visivel) raiz.style.setProperty("--inbox-lateral", `${largura}px`);
    else raiz.style.removeProperty("--inbox-lateral");
    return () => {
      raiz.style.removeProperty("--inbox-lateral");
    };
  }, [visivel, largura]);

  // Na própria /inbox o painel não faz sentido.
  if (pathname === "/inbox" || pathname.startsWith("/inbox/")) return null;

  const conversas = (dados?.conversas ?? []).filter((c) => !fora(c));
  const comNaoLidas = conversas.filter((c) => naoLidas(c) > 0).length;
  const q = busca.trim().toLowerCase();
  const lista = conversas.filter((c) => {
    if (aba === "parceiro" && c.tipo !== "parceiro") return false;
    if (aba === "cliente" && !DE_CLIENTE.has(c.tipo)) return false;
    if (!q) return true;
    return [c.nome, c.contato, c.org?.nome ?? "", ...c.tags].some((v) => v.toLowerCase().includes(q));
  });

  function arrastar(e: React.PointerEvent) {
    e.preventDefault();
    const raiz = document.documentElement;
    raiz.dataset.arrastando = "1";
    let ultima = largura;
    const mover = (ev: PointerEvent) => {
      ultima = Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, window.innerWidth - ev.clientX));
      setLargura(ultima);
    };
    const soltar = () => {
      delete raiz.dataset.arrastando;
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      try {
        localStorage.setItem(CHAVE_LARGURA, String(ultima));
      } catch {}
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function abrir(c: ConversaDaCaixa) {
    setContato(c.contato);
    setConversa(c);
    setPendentes([]);
    void carregarConversa(c.contato);
    if (naoLidas(c) > 0 && dados?.estadoPronto) {
      // Lida ao abrir, como na /inbox; a lista acerta o contador no próximo refresh.
      setDados((d) => d && { ...d, conversas: d.conversas.map((x) => (x.contato === c.contato ? { ...x, lidaEm: new Date().toISOString(), naoLida: false } : x)) });
      void fetch("/api/inbox/conversa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contato: c.contato, acao: "ler" }) });
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "relative flex h-[27px] w-[27px] items-center justify-center rounded-lg transition-colors",
          aberto ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
        )}
        title="Inbox"
        aria-label="Inbox"
      >
        <ChatsCircle className="h-[16px] w-[16px]" />
        <AnimatePresence>
          {comNaoLidas > 0 ? (
            <mo.span
              key={comNaoLidas}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: tempo("md") }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9.5px] font-bold text-white ring-2 ring-surface"
            >
              {comNaoLidas}
            </mo.span>
          ) : null}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {aberto ? (
          <mo.aside
            key="atendimento-lateral"
            className="cx fixed bottom-0 right-0 top-0 z-[60] flex max-w-[100vw] flex-col border-l border-border-light bg-card shadow-2xl lg:shadow-none"
            style={{ width: largura }}
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1, transition: tempo("lg") }}
            exit={{ x: 32, opacity: 0, transition: tempo("md", "saida") }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inbox"
              onPointerDown={arrastar}
              onDoubleClick={() => setLargura(LARGURA_PADRAO)}
              className="group absolute -left-1.5 bottom-0 top-0 z-10 hidden w-3 cursor-col-resize lg:block"
            >
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/40 group-active:bg-primary" />
            </div>
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-light px-4">
              {contato && conversa ? (
                <>
                  <button type="button" onClick={() => setContato(null)} className="-ml-1 grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-surface-secondary" aria-label="Back">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <Avatar c={conversa} tamanho="sm" canal />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-text-primary">{conversa.nome}</span>
                    <span className="block truncate text-[11.5px] text-text-tertiary">{conversa.org?.nome ?? `+${conversa.contato}`}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[16px] font-bold tracking-tight text-text-primary">Inbox</span>
                  {comNaoLidas ? <span className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold leading-[18px] text-white">{comNaoLidas}</span> : null}
                  <span className="flex-1" />
                </>
              )}
              <Link
                href={contato ? `/inbox?c=${contato}` : "/inbox"}
                onClick={() => setAberto(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                title="Open in Inbox"
                aria-label="Open in Inbox"
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <button type="button" onClick={() => setAberto(false)} className="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-surface-secondary hover:text-text-primary" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {contato && conversa ? (
                <mo.div key={`c-${contato}`} className="flex min-h-0 flex-1 flex-col" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1, transition: tempo("md") }} exit={{ x: 24, opacity: 0, transition: tempo("sm", "saida") }}>
                  <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-surface-secondary/50 px-3 py-3">
                    <div className="mb-auto space-y-1.5">
                      {comPendentes(conversa.mensagens, pendentes).map((m, i, todas) => {
                        const antes = todas[i - 1];
                        const novoDia = !antes || new Date(antes.criadoEm).toDateString() !== new Date(m.criadoEm).toDateString();
                        const entrada = m.direcao === "entrada";
                        return (
                          <mo.div key={m.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={tempo("md")}>
                            {novoDia ? (
                              <div className="my-2 flex justify-center">
                                <span className="rounded-full bg-surface-tertiary px-2.5 py-0.5 text-[11px] font-medium text-text-secondary">{diaDaMensagemOuHoje(m.criadoEm)}</span>
                              </div>
                            ) : null}
                            <div className={cn("flex", entrada ? "justify-start" : "justify-end")}>
                              <div
                                className={cn(
                                  "max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug shadow-sm",
                                  entrada ? "rounded-bl-md border border-border-light bg-card text-text-primary" : "rounded-br-md bg-primary text-[var(--on-brand)]",
                                )}
                              >
                                {m.autor && !(antes?.autor && (antes.autor.numero ?? antes.autor.nome) === (m.autor.numero ?? m.autor.nome) && !novoDia) ? (
                                  <p className={cn("text-[11px] font-semibold", corDoAutor(m.autor.numero ?? m.autor.nome ?? ""))}>{nomeDoAutor(m.autor)}</p>
                                ) : null}
                                <Midia m={m} />
                                {m.texto && !(m.midiaUrl && SO_ROTULO.has(m.texto)) && !(m.midiaUrl && m.tipo === "document") ? <p className="whitespace-pre-wrap break-words">{m.texto}</p> : null}
                                <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10.5px]", entrada ? "text-text-tertiary" : "text-white/70")}>
                                  {new Date(m.criadoEm).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}
                                  {entrada ? null : <Tique status={m.status} />}
                                </span>
                              </div>
                            </div>
                          </mo.div>
                        );
                      })}
                    </div>
                  </div>
                  <Composer
                    contato={conversa.contato}
                    nome={conversa.nome}
                    tipo={conversa.tipo}
                    canal="Operations"
                    janelaAberta={Boolean(conversa.ultimaEntradaEm && agora - new Date(conversa.ultimaEntradaEm).getTime() < 24 * 3_600_000)}
                    semJanela={dados?.semJanela ?? false}
                    onEnviado={() => {
                      void carregarConversa(conversa.contato);
                      void carregarLista();
                    }}
                    onPendente={(m) => setPendentes((p) => [...p, m])}
                    onResolvida={(id, erro) => setPendentes((p) => p.map((m) => (m.id === id ? { ...m, status: erro ? "failed" : "sent", erro: erro ?? null } : m)))}
                  />
                </mo.div>
              ) : (
                <mo.div key="lista" className="flex min-h-0 flex-1 flex-col" initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1, transition: tempo("md") }} exit={{ x: -24, opacity: 0, transition: tempo("sm", "saida") }}>
                  <div className="px-4 pt-3">
                    <label className="flex h-9 items-center gap-2 rounded-lg border border-border-light px-2.5 focus-within:border-text-tertiary">
                      <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
                      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary" />
                    </label>
                  </div>
                  <div className="border-b border-border-light px-4 py-2.5">
                    <SeletorDeTipo
                      ativo={aba}
                      onTroca={setAba}
                      n={{ todas: conversas.length, parceiro: conversas.filter((c) => c.tipo === "parceiro").length, cliente: conversas.filter((c) => DE_CLIENTE.has(c.tipo)).length }}
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {!dados ? <p className="px-4 py-6 text-xs text-text-tertiary">{erro ? "Could not load the inbox. Try again in a moment." : "Loading..."}</p> : lista.length === 0 ? <p className="px-4 py-6 text-xs text-text-tertiary">No conversations here.</p> : null}
                    <AnimatePresence initial={false}>
                      {lista.map((c) => {
                        const ultima = c.mensagens[c.mensagens.length - 1];
                        const n = naoLidas(c);
                        return (
                          <mo.button
                            key={c.contato}
                            layout="position"
                            type="button"
                            onClick={() => abrir(c)}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={tempo("md")}
                            className="flex w-full items-center gap-3 border-b border-border-light/60 px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary/70"
                          >
                            <Avatar c={c} tamanho="md" canal />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className={cn("truncate text-[14px] text-text-primary", n ? "font-bold" : "font-semibold")}>{c.nome}</span>
                                <ChipDoTipo c={c} />
                                <span className={cn("ml-auto shrink-0 text-[11.5px] tabular-nums", n ? "font-semibold text-[var(--accent)]" : "text-text-tertiary")}>
                                  {ultima ? quandoNaLista(ultima.criadoEm, agora) : ""}
                                </span>
                              </span>
                              <span className="mt-0.5 flex items-center gap-1">
                                {ultima?.direcao === "saida" ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" /> : <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />}
                                <span className={cn("truncate text-[12.5px]", n ? "text-text-primary" : "text-text-secondary")}>{ultima?.texto ?? (ultima ? `[${ultima.tipo}]` : "")}</span>
                                {n ? (
                                  <span className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10.5px] font-semibold text-white">{n}</span>
                                ) : null}
                              </span>
                            </span>
                          </mo.button>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </mo.div>
              )}
            </AnimatePresence>
          </mo.aside>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
