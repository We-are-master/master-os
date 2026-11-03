"use client";

/**
 * "New conversation", como o Iniciar atendimento do VOS: um modal só, sem
 * passos. Em cima por onde sai (o WhatsApp da operação), no meio quem é (busca
 * em contas, parceiros, clientes e leads, ou nome e número digitados) e
 * embaixo a primeira mensagem. Send cria e manda; "Open without sending" só
 * abre a conversa (a que já existe ou um rascunho vazio).
 */

import { useEffect, useState } from "react";
import { Building2, Home, MessageCircle, Search, Sparkles, Wrench, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { ContatoAchado } from "@/app/api/inbox/contatos/route";

export type Escolhido = { numero: string; nome: string; tipo: ContatoAchado["tipo"] | "numero" };

type Filtro = "todos" | ContatoAchado["tipo"];
const FILTROS: [Filtro, string][] = [
  ["todos", "All"],
  ["conta", "Accounts"],
  ["parceiro", "Partners"],
  ["cliente", "Clients"],
  ["lead", "Leads"],
];
const ICONE: Record<ContatoAchado["tipo"], LucideIcon> = { conta: Building2, parceiro: Wrench, cliente: Home, lead: Sparkles };
const ROTULO: Record<ContatoAchado["tipo"], string> = { conta: "Account", parceiro: "Partner", cliente: "Client", lead: "Lead" };

/** "07123 456789" e "+44 7123..." viram "447123456789", como na busca do servidor. */
function paraWhatsApp(bruto: string): string | null {
  const d = bruto.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) return `44${d.slice(1)}`;
  if (d.startsWith("00")) return d.slice(2);
  return d.length >= 10 ? d : null;
}

export function NovaConversa({
  open,
  onFechar,
  onAbrir,
  onEnviado,
}: {
  open: boolean;
  onFechar: () => void;
  /** Abre a conversa do número (a que existe ou um rascunho). */
  onAbrir: (e: Escolhido) => void;
  /** A primeira mensagem saiu: quem chama recarrega a lista. */
  onEnviado: () => void;
}) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [achados, setAchados] = useState<ContatoAchado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [escolhido, setEscolhido] = useState<ContatoAchado | null>(null);
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Busca com uma pausa curta entre teclas; a última resposta vence.
  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/inbox/contatos?q=${encodeURIComponent(termo)}`);
        const j = (await r.json().catch(() => ({}))) as { contatos?: ContatoAchado[] };
        if (vivo) setAchados(j.contatos ?? []);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  function fechar() {
    setQ("");
    setAchados([]);
    setEscolhido(null);
    setNome("");
    setNumero("");
    setTexto("");
    onFechar();
  }

  function escolher(a: ContatoAchado) {
    if (!a.numero) return;
    setEscolhido(a);
    setNome(a.nome);
    setNumero(`+${a.numero}`);
    setQ("");
  }

  const destino = paraWhatsApp(numero);
  const quem: Escolhido | null = destino ? { numero: destino, nome: nome.trim() || `+${destino}`, tipo: escolhido?.tipo ?? "numero" } : null;

  async function enviar() {
    if (!quem || !texto.trim()) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contato: quem.numero, texto: texto.trim() }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      onAbrir(quem);
      onEnviado();
      fechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not sent");
    } finally {
      setEnviando(false);
    }
  }

  const curto = q.trim().length < 2;
  /** Um número digitado na busca: dá para escrever para ele mesmo sem cadastro. */
  const numeroDaBusca = /^[\d\s+()-]+$/.test(q.trim()) ? paraWhatsApp(q) : null;
  const lista = curto ? [] : achados.filter((a) => filtro === "todos" || a.tipo === filtro);

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="New conversation"
      size="sm"
      manageFocus
      footer={
        <div className="flex gap-2 px-4 py-3">
          <button
            type="button"
            onClick={fechar}
            className="h-9 rounded-lg border border-border-light px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <span className="flex-1" />
          <button
            type="button"
            disabled={!quem || enviando}
            onClick={() => {
              if (!quem) return;
              onAbrir(quem);
              fechar();
            }}
            className="h-9 rounded-lg border border-border-light px-3 text-[13px] font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-45"
          >
            Open without sending
          </button>
          <button
            type="button"
            disabled={!quem || !texto.trim() || enviando}
            onClick={() => void enviar()}
            className="h-9 rounded-lg bg-primary px-4 text-[13px] font-semibold text-[var(--on-brand)] hover:opacity-90 disabled:opacity-45"
          >
            {enviando ? "Sending..." : "Send"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2 text-[12.5px] text-text-secondary">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#25D366]/15 text-[#128C7E]">
            <MessageCircle className="h-3.5 w-3.5" />
          </span>
          Via WhatsApp, operations line
        </div>

        {/* Quem: escolhido da busca vira um cartão; sem escolher, a busca e os campos. */}
        {escolhido ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-border-light px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-secondary text-text-secondary">
              {(() => {
                const Icone = ICONE[escolhido.tipo];
                return <Icone className="h-4 w-4" />;
              })()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-text-primary">{escolhido.nome}</span>
              <span className="block truncate text-[11.5px] text-text-tertiary">
                {[ROTULO[escolhido.tipo], escolhido.sub, `+${escolhido.numero}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setEscolhido(null);
                setNome("");
                setNumero("");
              }}
              className="grid h-7 w-7 place-items-center rounded-md text-text-tertiary hover:bg-surface-secondary hover:text-text-primary"
              aria-label="Change contact"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">Contact</label>
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border-light bg-card px-2.5 focus-within:border-primary/50">
              <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search accounts, partners, clients, leads"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
            {!curto ? (
              <div className="mt-1.5 rounded-lg border border-border-light p-1">
                <div className="flex gap-1 overflow-x-auto px-0.5 pb-1">
                  {FILTROS.map(([k, t]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFiltro(k)}
                      className={cn(
                        "h-6 shrink-0 rounded-md px-2 text-[11.5px] font-medium transition-colors",
                        filtro === k ? "bg-primary text-[var(--on-brand)]" : "text-text-secondary hover:bg-surface-secondary",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {numeroDaBusca && !achados.some((a) => a.numero === numeroDaBusca) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNumero(`+${numeroDaBusca}`);
                        setQ("");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#25D366]/15 text-[#128C7E]">
                        <MessageCircle className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text-primary">Message +{numeroDaBusca}</span>
                        <span className="block truncate text-[11.5px] text-text-tertiary">Not on file</span>
                      </span>
                    </button>
                  ) : null}
                  {lista.map((a) => {
                    const Icone = ICONE[a.tipo];
                    return (
                      <button
                        key={`${a.tipo}-${a.id}`}
                        type="button"
                        disabled={!a.numero}
                        onClick={() => escolher(a)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-secondary text-text-secondary">
                          <Icone className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text-primary">{a.nome}</span>
                          <span className="block truncate text-[11.5px] text-text-tertiary">{[ROTULO[a.tipo], a.sub].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{a.numero ? `+${a.numero}` : "No phone"}</span>
                      </button>
                    );
                  })}
                  {buscando || (!lista.length && !numeroDaBusca) ? (
                    <p className="px-2 py-2 text-[12px] text-text-tertiary">{buscando ? "Searching..." : "Nobody found. Type the name and number below."}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">Name</span>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={120}
                  className="h-9 w-full rounded-lg border border-border-light bg-card px-2.5 text-[13px] text-text-primary outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">WhatsApp number</span>
                <input
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  inputMode="tel"
                  placeholder="+44 7..."
                  className="h-9 w-full rounded-lg border border-border-light bg-card px-2.5 text-[13px] tabular-nums text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary/50"
                />
              </label>
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">Message</span>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void enviar();
            }}
            rows={4}
            placeholder={quem ? `Write to ${quem.nome}` : "Write the first message"}
            className="w-full resize-none rounded-lg border border-border-light bg-card px-3 py-2 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary/50"
          />
        </label>
      </div>
    </Modal>
  );
}
