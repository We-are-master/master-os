"use client";

/**
 * "New conversation", como o Iniciar atendimento do VOS: um modal só, sem
 * passos. Em cima por onde sai (o WhatsApp da operação), no meio quem é (busca
 * em contas, parceiros, clientes e leads, ou nome e número digitados) e
 * embaixo a primeira mensagem. Send cria e manda; "Open without sending" só
 * abre a conversa (a que já existe ou um rascunho vazio).
 *
 * No alto, Conversation ou Group: o grupo nasce no 7983 com quem foi
 * escolhido (vários, em chips) e a primeira mensagem, se houver, vai nele.
 */

import { useEffect, useState } from "react";
import { Building2, Home, MessageCircle, Search, Sparkles, UserPlus, UsersRound, Wrench, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { createClient } from "@/services/clients";
import { listActiveAccountsForFilter, type FilterableAccount } from "@/services/accounts";
import { cn } from "@/lib/utils";
import type { ContatoAchado } from "@/app/api/inbox/contatos/route";
import { AvatarDoAchado, linhaDoAchado } from "./ui";

export type Escolhido = { numero: string; nome: string; tipo: ContatoAchado["tipo"] | "numero" | "grupo" };

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

/**
 * Quem ainda não está no OS: nome, número e a conta. Salva na hora como cliente
 * (o mesmo "Add as client" do painel) e já entra na conversa ou no grupo.
 */
function NovoContatoRapido({ inicial, onSalvo, onCancelar }: { inicial: string; onSalvo: (numero: string, nome: string) => void; onCancelar: () => void }) {
  const soDigitos = /^[\d\s+()-]+$/.test(inicial.trim());
  const [nome, setNome] = useState(soDigitos ? "" : inicial.trim());
  const [numero, setNumero] = useState(soDigitos ? inicial.trim() : "");
  const [contas, setContas] = useState<FilterableAccount[]>([]);
  const [conta, setConta] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void listActiveAccountsForFilter().then((l) => {
      setContas(l);
      setConta((atual) => atual || l.find((a) => /^fixfy\b/i.test(a.name))?.id || "");
    });
  }, []);

  async function salvar() {
    const n = paraWhatsApp(numero);
    if (!nome.trim()) return toast.error("Add the name");
    if (!n) return toast.error("Add a valid WhatsApp number");
    if (!conta) return toast.error("Pick the account");
    setSalvando(true);
    try {
      await createClient({
        full_name: nome.trim(),
        phone: `+${n}`,
        client_type: "residential",
        source: "direct",
        status: "active",
        source_account_id: conta,
      });
      toast.success(`${nome.trim()} saved as a client`);
      onSalvo(n, nome.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the contact");
    } finally {
      setSalvando(false);
    }
  }

  const campo = "h-9 w-full rounded-lg border border-border-light bg-card px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary/50";
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-border-light bg-surface-secondary/40 p-2.5">
      <p className="text-[12px] font-medium text-text-primary">New contact</p>
      <div className="grid grid-cols-2 gap-2">
        <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Full name" className={campo} />
        <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="tel" placeholder="+44 7..." className={cn(campo, "tabular-nums")} />
      </div>
      <Select
        aria-label="Account"
        value={conta}
        onChange={(e) => setConta(e.target.value)}
        className="h-9 text-[13px]"
        options={[{ value: "", label: contas.length ? "Account" : "Loading accounts..." }, ...contas.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="h-8 rounded-lg px-2.5 text-[12.5px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary">
          Cancel
        </button>
        <button
          type="button"
          disabled={salvando}
          onClick={() => void salvar()}
          className="h-8 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-[var(--on-brand)] hover:opacity-90 disabled:opacity-45"
        >
          {salvando ? "Saving..." : "Save contact"}
        </button>
      </div>
    </div>
  );
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
  const [modo, setModo] = useState<"conversa" | "grupo">("conversa");
  const [nomeDoGrupo, setNomeDoGrupo] = useState("");
  const [membros, setMembros] = useState<{ numero: string; nome: string }[]>([]);
  const [criandoContato, setCriandoContato] = useState(false);

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
    setModo("conversa");
    setNomeDoGrupo("");
    setMembros([]);
    setCriandoContato(false);
    onFechar();
  }

  function escolher(a: ContatoAchado) {
    if (!a.numero) return;
    if (modo === "grupo") return incluir(a.numero, a.nome);
    setEscolhido(a);
    setNome(a.nome);
    setNumero(`+${a.numero}`);
    setQ("");
  }

  function incluir(n: string, nomeDele: string) {
    setMembros((ms) => (ms.some((x) => x.numero === n) ? ms : [...ms, { numero: n, nome: nomeDele }]));
    setQ("");
  }

  async function criarGrupo() {
    if (!nomeDoGrupo.trim() || !membros.length) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/inbox/grupo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nomeDoGrupo.trim(), participantes: membros.map((m) => m.numero) }),
      });
      const j = (await r.json().catch(() => ({}))) as { contato?: string; nome?: string; falharam?: string[]; error?: string };
      if (!r.ok || !j.contato) throw new Error(j.error ?? `Failed (${r.status})`);
      if (texto.trim()) {
        const env = await fetch("/api/inbox/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contato: j.contato, texto: texto.trim() }),
        });
        if (!env.ok) toast.error("Group created, but the first message did not go out");
      }
      const fora = (j.falharam ?? []).map((n) => membros.find((m) => m.numero === n)?.nome ?? `+${n}`);
      if (fora.length) toast.warning(`Not added: ${fora.join(", ")}. They may need an invite link.`);
      else toast.success(`Group "${j.nome}" created`);
      onAbrir({ numero: j.contato, nome: j.nome ?? nomeDoGrupo.trim(), tipo: "grupo" });
      onEnviado();
      fechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the group");
    } finally {
      setEnviando(false);
    }
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
      title={modo === "grupo" ? "New group" : "New conversation"}
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
          {modo === "grupo" ? (
            <button
              type="button"
              disabled={!nomeDoGrupo.trim() || !membros.length || enviando}
              onClick={() => void criarGrupo()}
              className="h-9 rounded-lg bg-primary px-4 text-[13px] font-semibold text-[var(--on-brand)] hover:opacity-90 disabled:opacity-45"
            >
              {enviando ? "Creating..." : texto.trim() ? "Create and send" : "Create group"}
            </button>
          ) : (
          <>
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
          </>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-secondary p-1">
          {(
            [
              ["conversa", "Conversation", MessageCircle],
              ["grupo", "Group", UsersRound],
            ] as const
          ).map(([k, t, Icone]) => (
            <button
              key={k}
              type="button"
              onClick={() => setModo(k)}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium transition-colors",
                modo === k ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
              )}
            >
              <Icone className="h-3.5 w-3.5" />
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-text-secondary">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#25D366]/15 text-[#128C7E]">
            <MessageCircle className="h-3.5 w-3.5" />
          </span>
          Via WhatsApp, operations line
        </div>

        {modo === "grupo" ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">Group name</span>
              <input
                value={nomeDoGrupo}
                onChange={(e) => setNomeDoGrupo(e.target.value)}
                maxLength={100}
                placeholder="e.g. JOB-9806 Kings Cross"
                className="h-9 w-full rounded-lg border border-border-light bg-card px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary/50"
              />
            </label>
            {membros.length ? (
              <div className="flex flex-wrap gap-1.5">
                {membros.map((m) => (
                  <span key={m.numero} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-secondary pl-2.5 pr-1 text-[12px] text-text-primary">
                    {m.nome}
                    <button
                      type="button"
                      onClick={() => setMembros((ms) => ms.filter((x) => x.numero !== m.numero))}
                      className="grid h-5 w-5 place-items-center rounded-full text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
                      aria-label={`Remove ${m.nome}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {/* Quem: escolhido da busca vira um cartão; sem escolher, a busca e os campos. */}
        {modo === "conversa" && escolhido ? (
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
                {[linhaDoAchado(escolhido, ROTULO[escolhido.tipo]), `+${escolhido.numero}`].filter(Boolean).join(" · ")}
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
            <div className="mb-1.5 flex items-center">
              <label className="flex-1 text-[12px] font-medium text-text-secondary">{modo === "grupo" ? "Add people" : "Contact"}</label>
              {!criandoContato ? (
                <button type="button" onClick={() => setCriandoContato(true)} className="inline-flex items-center gap-1 text-[12px] font-medium text-text-secondary hover:text-text-primary">
                  <UserPlus className="h-3.5 w-3.5" />
                  New contact
                </button>
              ) : null}
            </div>
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
            {criandoContato ? (
              <NovoContatoRapido
                inicial={q}
                onCancelar={() => setCriandoContato(false)}
                onSalvo={(n, nomeDele) => {
                  setCriandoContato(false);
                  if (modo === "grupo") return incluir(n, nomeDele);
                  setEscolhido({ tipo: "cliente", id: n, nome: nomeDele, sub: "New client", numero: n, postcode: null, logo: null, logoDe: null });
                  setNome(nomeDele);
                  setNumero(`+${n}`);
                  setQ("");
                }}
              />
            ) : null}
            {!curto && !criandoContato ? (
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
                        if (modo === "grupo") return incluir(numeroDaBusca, `+${numeroDaBusca}`);
                        setNumero(`+${numeroDaBusca}`);
                        setQ("");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#25D366]/15 text-[#128C7E]">
                        <MessageCircle className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text-primary">
                          {modo === "grupo" ? "Add" : "Message"} +{numeroDaBusca}
                        </span>
                        <span className="block truncate text-[11.5px] text-text-tertiary">Not on file</span>
                      </span>
                    </button>
                  ) : null}
                  {lista.map((a) => {
                    return (
                      <button
                        key={`${a.tipo}-${a.id}`}
                        type="button"
                        disabled={!a.numero}
                        onClick={() => escolher(a)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                      >
                        <AvatarDoAchado a={a} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text-primary">{a.nome}</span>
                          <span className="block truncate text-[11.5px] text-text-tertiary">{linhaDoAchado(a, ROTULO[a.tipo])}</span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{a.numero ? `+${a.numero}` : "No phone"}</span>
                      </button>
                    );
                  })}
                  {buscando || (!lista.length && !numeroDaBusca) ? (
                    <p className="px-2 py-2 text-[12px] text-text-tertiary">
                      {buscando ? (
                        "Searching..."
                      ) : (
                        <>
                          Nobody found.{" "}
                          <button type="button" onClick={() => setCriandoContato(true)} className="font-medium text-text-primary underline-offset-2 hover:underline">
                            Add them as a new contact
                          </button>
                        </>
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {modo === "conversa" ? (
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
            ) : null}
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">Message</span>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void (modo === "grupo" ? criarGrupo() : enviar());
            }}
            rows={4}
            placeholder={modo === "grupo" ? "Optional first message to the group" : quem ? `Write to ${quem.nome}` : "Write the first message"}
            className="w-full resize-none rounded-lg border border-border-light bg-card px-3 py-2 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary/50"
          />
        </label>
      </div>
    </Modal>
  );
}
