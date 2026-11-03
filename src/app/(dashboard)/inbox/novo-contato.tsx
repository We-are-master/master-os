"use client";

/**
 * "New conversation": um popover com uma busca só, que procura em contas,
 * parceiros, clientes e leads do site. Escolher alguém abre a conversa (a que
 * já existe ou um rascunho vazio). Um número digitado que não está no cadastro
 * aparece no topo como "Message +44 ...".
 */

import { useEffect, useRef, useState } from "react";
import { Building2, Home, MessageSquarePlus, Search, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { motion as mo } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ContatoAchado } from "@/app/api/inbox/contatos/route";
import { flutuante } from "./movimento";

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

export function NovoContato({ onEscolher, onFechar }: { onEscolher: (e: Escolhido) => void; onFechar: () => void }) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [achados, setAchados] = useState<ContatoAchado[]>([]);
  const [numero, setNumero] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // Clique fora fecha (o + que abriu também fecha: ele está fora daqui e alterna).
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement;
      if (caixa.current?.contains(alvo) || alvo.closest('[aria-label="New conversation"]')) return;
      onFechar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [onFechar]);

  // Busca com uma pausa curta entre teclas; a última resposta vence.
  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/inbox/contatos?q=${encodeURIComponent(termo)}`);
        const j = (await r.json().catch(() => ({}))) as { contatos?: ContatoAchado[]; numero?: string | null };
        if (!vivo) return;
        setAchados(j.contatos ?? []);
        setNumero(j.numero ?? null);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  const curto = q.trim().length < 2;
  const lista = curto ? [] : achados.filter((a) => filtro === "todos" || a.tipo === filtro);

  return (
    <mo.div
      ref={caixa}
      {...flutuante("bottom")}
      style={{ transformOrigin: "top right" }}
      className="absolute right-3 top-12 z-40 w-[300px] rounded-xl border border-border-light bg-card p-1.5 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") onFechar();
      }}
    >
      <div className="flex h-8 items-center gap-2 rounded-lg bg-surface-secondary px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, company, postcode or number"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      <div className="mt-1.5 flex gap-1 overflow-x-auto px-0.5">
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
      <div className="mt-1 max-h-72 overflow-y-auto">
        {!curto && numero && !achados.some((a) => a.numero === numero) ? (
          <Linha icone={MessageSquarePlus} nome={`Message +${numero}`} sub="Not on file" onClick={() => onEscolher({ numero, nome: `+${numero}`, tipo: "numero" })} />
        ) : null}
        {lista.map((a) => (
          <Linha
            key={`${a.tipo}-${a.id}`}
            icone={ICONE[a.tipo]}
            nome={a.nome}
            sub={[ROTULO[a.tipo], a.sub].filter(Boolean).join(" · ")}
            fim={a.numero ? `+${a.numero}` : "No phone on file"}
            desligado={!a.numero}
            onClick={() => a.numero && onEscolher({ numero: a.numero, nome: a.nome, tipo: a.tipo })}
          />
        ))}
        <p className="px-2 py-2 text-[12px] text-text-tertiary">
          {curto ? "Type at least 2 letters." : buscando ? "Searching..." : lista.length || numero ? "" : "Nobody found."}
        </p>
      </div>
    </mo.div>
  );
}

function Linha({
  icone: Icone,
  nome,
  sub,
  fim,
  desligado,
  onClick,
}: {
  icone: LucideIcon;
  nome: string;
  sub?: string;
  fim?: string;
  desligado?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desligado}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-secondary text-text-secondary">
        <Icone className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-primary">{nome}</span>
        {sub ? <span className="block truncate text-[11.5px] text-text-tertiary">{sub}</span> : null}
      </span>
      {fim ? <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{fim}</span> : null}
    </button>
  );
}
