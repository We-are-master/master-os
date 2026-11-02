"use client";

/**
 * A caixa de atendimento do 7983. Texto em inglês como o resto do OS, sem
 * travessão. Três colunas: conversas por parceiro, a conversa com o rascunho
 * do Harvey, e o job do dia ao lado. Os dados são de exemplo e tudo fica na
 * tela: aprovar ou responder só acrescenta a mensagem localmente.
 */

import { useMemo, useState } from "react";
import { Clock, ExternalLink, FileText, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Autor = "parceiro" | "harvey" | "equipe";

type Mensagem = { id: string; autor: Autor; texto: string; hora: string };

type Rascunho = { para: string; texto: string };

type Estado = "rascunho" | "precisa" | "gravado" | null;

type Conversa = {
  id: string;
  nome: string;
  oficio: string;
  telefone: string;
  janelaAberta: boolean;
  estado: Estado;
  mensagens: Mensagem[];
  rascunho: Rascunho | null;
  job: { ref: string; servico: string; postcode: string; janela: string; eta: string | null; ticket: string } | null;
  proximos: string[];
};

const EXEMPLO: Conversa[] = [
  {
    id: "c1",
    nome: "Marcos",
    oficio: "Handyman",
    telefone: "+44 7700 900123",
    janelaAberta: true,
    estado: "rascunho",
    mensagens: [
      { id: "m1", autor: "parceiro", texto: "Morning, on my way to N5. Running 30 min late, traffic on the A1", hora: "09:42" },
      { id: "m2", autor: "harvey", texto: "Thanks Marcos. What time will you get there?", hora: "09:43" },
      { id: "m3", autor: "parceiro", texto: "Around 10:30", hora: "09:44" },
    ],
    rascunho: { para: "Customer on JOB-9812 (email, ticket #51803)", texto: "Hi Sarah, your handyman is running a little late and will arrive around 10:30. Sorry for the wait." },
    job: { ref: "JOB-9812", servico: "Handyman", postcode: "N5 1HZ", janela: "09:00 to 12:00", eta: "10:30", ticket: "51803" },
    proximos: ["Thu · JOB-9820 · E14", "Fri · JOB-9826 · SW6"],
  },
  {
    id: "c2",
    nome: "Kelvin",
    oficio: "Plumber",
    telefone: "+44 7700 900456",
    janelaAberta: true,
    estado: "precisa",
    mensagens: [
      { id: "m1", autor: "parceiro", texto: "I'm at the property. Customer didn't buy the tap, what do you want me to do?", hora: "Yesterday 14:10" },
      { id: "m2", autor: "harvey", texto: "Thanks Kelvin, checking with the office now.", hora: "Yesterday 14:11" },
    ],
    rascunho: null,
    job: { ref: "JOB-9807", servico: "Plumbing", postcode: "NW11 6UG", janela: "13:00 to 17:00", eta: "13:40", ticket: "51960" },
    proximos: [],
  },
  {
    id: "c3",
    nome: "F&V Cleaning",
    oficio: "Cleaning",
    telefone: "+44 7700 900789",
    janelaAberta: true,
    estado: "gravado",
    mensagens: [
      { id: "m1", autor: "harvey", texto: "Hi, can you do a re-clean at E14 9HD on Wednesday between 9 and 3?", hora: "09:02" },
      { id: "m2", autor: "parceiro", texto: "Yes we can do Wednesday, 10am", hora: "09:15" },
      { id: "m3", autor: "harvey", texto: "Great, booked for Wednesday 10:00. Thank you.", hora: "09:16" },
    ],
    rascunho: null,
    job: { ref: "JOB-9790", servico: "End of tenancy clean", postcode: "E14 9HD", janela: "Wed 10:00", eta: null, ticket: "51641" },
    proximos: ["Wed · JOB-9790 · E14"],
  },
  {
    id: "c4",
    nome: "Ana",
    oficio: "Cleaner",
    telefone: "+44 7700 900321",
    janelaAberta: false,
    estado: null,
    mensagens: [
      { id: "m1", autor: "parceiro", texto: "Photos sent, all done", hora: "Mon 16:20" },
      { id: "m2", autor: "equipe", texto: "Thanks Ana, all received.", hora: "Mon 16:31" },
    ],
    rascunho: null,
    job: null,
    proximos: ["Thu · JOB-9818 · SE7"],
  },
];

const TEMPLATES = ["schedule_confirmation", "reschedule", "no_response_followup", "conversation_follow_up"];

const ROTULO_ESTADO: Record<Exclude<Estado, null>, { texto: string; variant: "info" | "warning" | "success" }> = {
  rascunho: { texto: "Draft ready", variant: "info" },
  precisa: { texto: "Needs you", variant: "warning" },
  gravado: { texto: "Saved to job", variant: "success" },
};

const agora = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export function CaixaAtendimento() {
  const [conversas, setConversas] = useState(EXEMPLO);
  const [abertaId, setAbertaId] = useState(EXEMPLO[0].id);
  const [filtro, setFiltro] = useState<"precisa" | "todas">("todas");
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState(false);

  const aberta = conversas.find((c) => c.id === abertaId) ?? conversas[0];
  const pedemVoce = conversas.filter((c) => c.estado === "rascunho" || c.estado === "precisa").length;

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return conversas.filter((c) => {
      if (filtro === "precisa" && c.estado !== "rascunho" && c.estado !== "precisa") return false;
      if (!q) return true;
      return [c.nome, c.oficio, c.telefone, c.job?.ref ?? "", c.job?.postcode ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [conversas, filtro, busca]);

  function mudar(id: string, fn: (c: Conversa) => Conversa) {
    setConversas((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  }

  function enviar() {
    const t = texto.trim();
    if (!t) return;
    mudar(aberta.id, (c) => ({ ...c, mensagens: [...c.mensagens, { id: crypto.randomUUID(), autor: "equipe", texto: t, hora: agora() }] }));
    setTexto("");
  }

  function aprovar() {
    mudar(aberta.id, (c) => ({ ...c, rascunho: null, estado: "gravado" }));
    setEditando(false);
  }

  return (
    <PageTransition>
      <div className="space-y-3">
        <PageHeader title="Inbox" subtitle="Operations WhatsApp (+44 7983 182332): partners and team. Harvey drafts, you approve." />

        <p className="rounded-lg bg-warning-light px-3 py-2 text-xs font-medium text-[var(--warn-ink)]">
          Preview with sample conversations. Nothing here is sent on WhatsApp yet.
        </p>

        <div className="grid h-[calc(100vh-190px)] min-h-[520px] grid-cols-[260px_minmax(0,1fr)_240px] overflow-hidden rounded-xl border border-border-light bg-card">
          <aside className="flex min-h-0 flex-col border-r border-border-light">
            <div className="space-y-2 p-3">
              <SearchInput placeholder="Search partner, job or postcode" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <div className="flex gap-1.5">
                <Button size="xs" variant={filtro === "precisa" ? "primary" : "ghost"} onClick={() => setFiltro("precisa")}>
                  Needs you {pedemVoce}
                </Button>
                <Button size="xs" variant={filtro === "todas" ? "primary" : "ghost"} onClick={() => setFiltro("todas")}>
                  All {conversas.length}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {lista.length === 0 ? <p className="px-2 py-4 text-xs text-text-tertiary">No conversations.</p> : null}
              {lista.map((c) => {
                const ultima = c.mensagens[c.mensagens.length - 1];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setAbertaId(c.id);
                      setEditando(false);
                    }}
                    className={cn(
                      "mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-secondary",
                      c.id === aberta.id && "bg-surface-tertiary hover:bg-surface-tertiary",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">{c.nome}</span>
                      <span className="shrink-0 text-[11px] text-text-tertiary">{ultima?.hora}</span>
                    </div>
                    <p className="truncate text-xs text-text-secondary">{ultima?.texto}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[11px] text-text-tertiary">{c.oficio}</span>
                      {c.estado ? <Badge variant={ROTULO_ESTADO[c.estado].variant}>{ROTULO_ESTADO[c.estado].texto}</Badge> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-surface-secondary">
            <div className="flex items-center justify-between gap-3 border-b border-border-light bg-card px-4 py-2.5">
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-text-primary">{aberta.nome}</span>
                <span className="ml-2 text-xs text-text-tertiary">{aberta.telefone}</span>
              </div>
              {aberta.janelaAberta ? (
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

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {aberta.mensagens.map((m) => (
                <div key={m.id} className={cn("flex", m.autor === "parceiro" ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-xl px-3 py-2 text-[13px] leading-snug",
                      m.autor === "parceiro" ? "border border-border-light bg-card text-text-primary" : "bg-info-light text-[var(--info-ink)]",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.texto}</p>
                    <p className="mt-0.5 text-[11px] opacity-70">
                      {m.autor === "harvey" ? "Harvey · " : m.autor === "equipe" ? "Team · " : ""}
                      {m.hora}
                    </p>
                  </div>
                </div>
              ))}

              {aberta.rascunho ? (
                <div className="rounded-lg border border-dashed border-[var(--line-2)] bg-card p-3">
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-text-tertiary">
                    <Sparkles className="h-3 w-3" />
                    Harvey draft · to {aberta.rascunho.para}
                  </p>
                  {editando ? (
                    <textarea
                      className="w-full rounded-lg border border-border-light bg-card p-2 text-[13px] text-text-primary"
                      rows={3}
                      value={aberta.rascunho.texto}
                      onChange={(e) => mudar(aberta.id, (c) => ({ ...c, rascunho: c.rascunho ? { ...c.rascunho, texto: e.target.value } : null }))}
                    />
                  ) : (
                    <p className="text-[13px] leading-snug text-text-primary">{aberta.rascunho.texto}</p>
                  )}
                  <div className="mt-2 flex gap-1.5">
                    <Button size="sm" onClick={aprovar}>
                      Approve and send
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditando((v) => !v)}>
                      {editando ? "Done editing" : "Edit"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => mudar(aberta.id, (c) => ({ ...c, rascunho: null, estado: null }))}>
                      Discard
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-border-light bg-card p-3">
              {aberta.janelaAberta ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    enviar();
                  }}
                >
                  <input
                    className="min-h-9 flex-1 rounded-lg border border-border-light bg-card px-3 text-[13px] text-text-primary placeholder:text-text-tertiary"
                    placeholder={`Reply to ${aberta.nome}`}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                  <Button type="submit" variant="secondary">
                    Send
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-text-tertiary">Send a template:</span>
                  {TEMPLATES.map((t) => (
                    <Button
                      key={t}
                      size="xs"
                      variant="secondary"
                      onClick={() => mudar(aberta.id, (c) => ({ ...c, mensagens: [...c.mensagens, { id: crypto.randomUUID(), autor: "equipe", texto: `Template: ${t}`, hora: agora() }] }))}
                    >
                      <FileText />
                      {t}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto border-l border-border-light p-3">
            {aberta.job ? (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-text-tertiary">Today&apos;s job</p>
                <p className="text-[13px] font-semibold text-text-primary">{aberta.job.ref}</p>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {aberta.job.servico} · {aberta.job.postcode}
                  <br />
                  Window {aberta.job.janela}
                </p>
                {aberta.job.eta ? (
                  <p className="mt-2 rounded-lg bg-success-light px-2 py-1.5 text-xs font-medium text-[var(--ok-ink)]">ETA saved: {aberta.job.eta}</p>
                ) : null}
                <a
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-text-primary underline-offset-2 hover:underline"
                  href={`https://fixfy.zendesk.com/agent/tickets/${aberta.job.ticket}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ticket #{aberta.job.ticket}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">No job today.</p>
            )}
            <div className="mt-4 space-y-1">
              <p className="text-[11px] font-medium text-text-tertiary">Next jobs</p>
              {aberta.proximos.length === 0 ? <p className="text-xs text-text-tertiary">None booked.</p> : null}
              {aberta.proximos.map((p) => (
                <p key={p} className="text-xs text-text-secondary">
                  {p}
                </p>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </PageTransition>
  );
}
