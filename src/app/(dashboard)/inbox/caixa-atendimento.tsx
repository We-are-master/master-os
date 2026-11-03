"use client";

/**
 * A caixa de atendimento do 7983. Texto em inglês como o resto do OS, sem
 * travessão. Três colunas: conversas por número, a conversa, e o parceiro com
 * os próximos jobs. A tela recarrega sozinha a cada 15 s; o que alguém manda
 * pelo celular entra como eco e aparece aqui também.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, ExternalLink, FileText, MessageSquare, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type MensagemDaCaixa = {
  id: string;
  direcao: "entrada" | "saida";
  origem: "contato" | "celular" | "os";
  tipo: string;
  texto: string | null;
  status: string | null;
  erro: string | null;
  quem: string | null;
  criadoEm: string;
};

export type ConversaDaCaixa = {
  contato: string;
  nome: string;
  empresa: string | null;
  oficio: string | null;
  partnerId: string | null;
  ultimaEntradaEm: string | null;
  mensagens: MensagemDaCaixa[];
  jobs: { id: string; ref: string; titulo: string | null; data: string; inicio: string | null; endereco: string | null; ticket: string | null }[];
};

const JANELA_MS = 24 * 60 * 60 * 1000;
const ZENDESK = "https://fixfy.zendesk.com/agent/tickets/";

const hora = (iso: string) => {
  const d = new Date(iso);
  const mesmoDia = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("en-GB", mesmoDia ? { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" } : { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const dia = (data: string) => new Date(`${data}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

const primeiroNome = (nome: string) => (nome.startsWith("+") ? "there" : nome.split(" ")[0]);

/** Esperando resposta nossa: a última mensagem da conversa é do contato. */
const esperando = (c: ConversaDaCaixa) => c.mensagens[c.mensagens.length - 1]?.direcao === "entrada";

const janelaAberta = (c: ConversaDaCaixa) => Boolean(c.ultimaEntradaEm && Date.now() - new Date(c.ultimaEntradaEm).getTime() < JANELA_MS);

async function postar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/inbox/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
}

export function CaixaAtendimento({ conversas }: { conversas: ConversaDaCaixa[] }) {
  const router = useRouter();
  const [abertaId, setAbertaId] = useState<string | null>(conversas[0]?.contato ?? null);
  const [filtro, setFiltro] = useState<"esperando" | "todas">("todas");
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [assunto, setAssunto] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);

  const aberta = conversas.find((c) => c.contato === abertaId) ?? conversas[0] ?? null;
  const qtdEsperando = conversas.filter(esperando).length;

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, "");
    return conversas.filter((c) => {
      if (filtro === "esperando" && !esperando(c)) return false;
      if (!q) return true;
      if (qDig.length >= 4 && c.contato.includes(qDig)) return true;
      return [c.nome, c.empresa ?? "", c.oficio ?? "", ...c.jobs.flatMap((j) => [j.ref, j.endereco ?? ""])].some((v) => v.toLowerCase().includes(q));
    });
  }, [conversas, filtro, busca]);

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

  const aberto = aberta ? janelaAberta(aberta) : false;

  return (
    <PageTransition>
      <div className="space-y-3">
        <PageHeader title="Inbox" subtitle="Operations WhatsApp (+44 7983 182332): partners and team. Messages sent from the phone app show up here too." />

        <div className="grid h-[calc(100vh-150px)] min-h-[520px] grid-cols-[260px_minmax(0,1fr)_240px] overflow-hidden rounded-xl border border-border-light bg-card">
          <aside className="flex min-h-0 flex-col border-r border-border-light">
            <div className="space-y-2 p-3">
              <SearchInput placeholder="Search partner, job or number" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <div className="flex gap-1.5">
                <Button size="xs" variant={filtro === "esperando" ? "primary" : "ghost"} onClick={() => setFiltro("esperando")}>
                  Awaiting reply {qtdEsperando}
                </Button>
                <Button size="xs" variant={filtro === "todas" ? "primary" : "ghost"} onClick={() => setFiltro("todas")}>
                  All {conversas.length}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {lista.length === 0 ? (
                <p className="px-2 py-4 text-xs text-text-tertiary">{conversas.length === 0 ? "No messages yet. New messages to +44 7983 182332 land here." : "No conversations."}</p>
              ) : null}
              {lista.map((c) => {
                const ultima = c.mensagens[c.mensagens.length - 1];
                return (
                  <button
                    key={c.contato}
                    type="button"
                    onClick={() => setAbertaId(c.contato)}
                    className={cn(
                      "mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-secondary",
                      c.contato === aberta?.contato && "bg-surface-tertiary hover:bg-surface-tertiary",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">{c.nome}</span>
                      <span className="shrink-0 text-[11px] text-text-tertiary">{hora(ultima.criadoEm)}</span>
                    </div>
                    <p className="truncate text-xs text-text-secondary">
                      {ultima.direcao === "saida" ? "You: " : ""}
                      {ultima.texto ?? `[${ultima.tipo}]`}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="truncate text-[11px] text-text-tertiary">{c.partnerId ? c.oficio ?? "Partner" : "Not a partner"}</span>
                      {esperando(c) ? <Badge variant="warning">Awaiting reply</Badge> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {aberta ? (
            <section className="flex min-h-0 flex-col bg-surface-secondary">
              <div className="flex items-center justify-between gap-3 border-b border-border-light bg-card px-4 py-2.5">
                <div className="min-w-0 truncate">
                  <span className="text-[13px] font-semibold text-text-primary">{aberta.nome}</span>
                  <span className="ml-2 text-xs text-text-tertiary">+{aberta.contato}</span>
                </div>
                {aberto ? (
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

              <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-3">
                <div className="space-y-2">
                  {aberta.mensagens.map((m) => (
                    <div key={m.id} className={cn("flex", m.direcao === "entrada" ? "justify-start" : "justify-end")}>
                      <div
                        className={cn(
                          "max-w-[75%] rounded-xl px-3 py-2 text-[13px] leading-snug",
                          m.direcao === "entrada" ? "border border-border-light bg-card text-text-primary" : "bg-info-light text-[var(--info-ink)]",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.texto ?? `[${m.tipo}]`}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] opacity-70">
                          {m.origem === "celular" ? (
                            <>
                              <Smartphone className="h-3 w-3" />
                              Phone app ·{" "}
                            </>
                          ) : m.origem === "os" ? (
                            `${m.quem ?? "Team"} · `
                          ) : null}
                          {hora(m.criadoEm)}
                          {m.direcao === "saida" && m.status ? ` · ${m.status}` : ""}
                        </p>
                        {m.status === "failed" ? <p className="mt-0.5 text-[11px] text-[var(--bad-ink)]">Not delivered{m.erro ? `: ${m.erro}` : ""}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border-light bg-card p-3">
                {aberto ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!texto.trim()) return;
                      void enviar({ texto }, "texto", () => setTexto(""));
                    }}
                  >
                    <input
                      className="min-h-9 flex-1 rounded-lg border border-border-light bg-card px-3 text-[13px] text-text-primary placeholder:text-text-tertiary"
                      placeholder={`Reply to ${aberta.nome}`}
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                    />
                    <Button type="submit" variant="secondary" loading={enviando === "texto"} disabled={!texto.trim()}>
                      Send
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-text-tertiary">WhatsApp only allows an approved template until {primeiroNome(aberta.nome)} writes back.</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={enviando === "no_response_followup"}
                        onClick={() => void enviar({ template: "no_response_followup", params: [primeiroNome(aberta.nome)] }, "no_response_followup", () => toast.success("Template sent"))}
                      >
                        <FileText />
                        No response follow-up
                      </Button>
                    </div>
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
                        placeholder="Follow up regarding… (e.g. JOB-9812 tomorrow at 10:00)"
                        value={assunto}
                        onChange={(e) => setAssunto(e.target.value)}
                      />
                      <Button size="sm" type="submit" variant="secondary" loading={enviando === "conversation_follow_up"} disabled={!assunto.trim()}>
                        <MessageSquare />
                        Send follow-up
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="flex items-center justify-center bg-surface-secondary p-6 text-center text-sm text-text-tertiary">
              No messages yet. Once +44 7983 182332 is connected, partner messages show up here.
            </section>
          )}

          <aside className="min-h-0 overflow-y-auto border-l border-border-light p-3">
            {aberta ? (
              <>
                <p className="text-[11px] font-medium text-text-tertiary">{aberta.partnerId ? "Partner" : "Contact"}</p>
                {aberta.partnerId ? (
                  <Link href={`/partners/${aberta.partnerId}`} className="block text-[13px] font-semibold text-text-primary hover:underline">
                    {aberta.empresa || aberta.nome}
                  </Link>
                ) : (
                  <p className="text-[13px] font-semibold text-text-primary">{aberta.nome}</p>
                )}
                <p className="text-xs text-text-secondary">{aberta.partnerId ? aberta.oficio ?? "" : "This number isn't on any partner."}</p>

                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-medium text-text-tertiary">Next jobs</p>
                  {aberta.jobs.length === 0 ? <p className="text-xs text-text-tertiary">None booked.</p> : null}
                  {aberta.jobs.map((j) => (
                    <div key={j.id} className="rounded-lg border border-border-light px-2.5 py-2">
                      <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-text-primary hover:underline">
                        {j.ref}
                      </Link>
                      <p className="text-[11px] text-text-secondary">
                        {dia(j.data)}
                        {j.inicio ? ` · ${new Date(j.inicio).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}` : ""}
                      </p>
                      {j.endereco ? <p className="truncate text-[11px] text-text-tertiary">{j.endereco}</p> : null}
                      {j.ticket && /^\d+$/.test(j.ticket) ? (
                        <a className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-primary hover:underline" href={`${ZENDESK}${j.ticket}`} target="_blank" rel="noreferrer">
                          Ticket #{j.ticket}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </PageTransition>
  );
}
